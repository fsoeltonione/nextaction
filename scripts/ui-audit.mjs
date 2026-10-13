import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const baseURL = new URL(process.env.UI_AUDIT_BASE_URL || "http://127.0.0.1:3000");
const outputDir = path.resolve(process.env.UI_AUDIT_OUTPUT_DIR || "artifacts/ui-audit");
const viewports = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "desktop-1440", width: 1440, height: 900 },
];
const routes = [
  { name: "home", path: "/", heading: "Put your SaaS moments to work." },
  { name: "login", path: "/login", heading: "Continue to NextAction" },
  { name: "activation", path: "/activate", heading: "NextAction Activation" },
  { name: "dashboard-guard", path: "/dashboard", heading: "Continue to NextAction", expectedPath: "/login" },
];

function sameOrigin(url) {
  try {
    return new URL(url).origin === baseURL.origin;
  } catch {
    return false;
  }
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const report = {
    startedAt: new Date().toISOString(),
    baseURL: baseURL.origin,
    viewports,
    cases: [],
    failures: [],
    accessibility: { violationCount: 0, seriousOrCriticalCount: 0, violations: [] },
  };

  try {
    for (const viewport of viewports) {
      for (const route of routes) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          reducedMotion: "reduce",
        });
        const page = await context.newPage();
        const caseResult = {
          route: route.name,
          requestedPath: route.path,
          viewport: viewport.name,
          finalURL: null,
          title: null,
          heading: null,
          responseStatus: null,
          horizontalOverflow: null,
          unnamedControls: [],
          consoleErrors: [],
          pageErrors: [],
          expectedAuthResponses: [],
          failedSameOriginResponses: [],
          axeViolations: [],
          screenshot: null,
        };

        page.on("console", (message) => {
          if (message.type() === "error") caseResult.consoleErrors.push(message.text());
        });
        page.on("pageerror", (error) => caseResult.pageErrors.push(error.message));
        page.on("response", (response) => {
          if (
            route.name === "activation" &&
            response.status() === 401 &&
            new URL(response.url()).pathname === "/api/onboarding/state"
          ) {
            caseResult.expectedAuthResponses.push({
              status: response.status(),
              url: response.url(),
              reason: "Unauthenticated activation state is expected to be auth-gated.",
            });
          }
          if (
            sameOrigin(response.url()) &&
            (response.status() === 404 || response.status() >= 500)
          ) {
            caseResult.failedSameOriginResponses.push({
              status: response.status(),
              url: response.url(),
            });
          }
        });

        try {
          const response = await page.goto(new URL(route.path, baseURL).toString(), {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          caseResult.responseStatus = response?.status() ?? null;
          await page.getByRole("heading", { name: route.heading, exact: true }).waitFor({
            state: "visible",
            timeout: 15000,
          });
          await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(300);

          caseResult.finalURL = page.url();
          caseResult.title = await page.title();
          caseResult.heading = await page.locator("h1").first().innerText();

          if (route.expectedPath) {
            const actualPath = new URL(page.url()).pathname;
            if (actualPath !== route.expectedPath) {
              report.failures.push(
                `${viewport.name} ${route.name}: expected redirect to ${route.expectedPath}, got ${actualPath}`,
              );
            }
          }

          const metrics = await page.evaluate(() => {
            const width = window.innerWidth;
            const rootWidth = document.documentElement.scrollWidth;
            const bodyWidth = document.body.scrollWidth;
            const overflowing = Array.from(document.querySelectorAll("body *"))
              .map((element) => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return {
                  tag: element.tagName.toLowerCase(),
                  text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 70),
                  right: Math.round(rect.right),
                  width: Math.round(rect.width),
                  position: style.position,
                };
              })
              .filter((element) => element.right > width + 1 && element.position !== "fixed")
              .slice(0, 10);

            const unnamedControls = Array.from(
              document.querySelectorAll("a, button, input:not([type='hidden']), textarea, select"),
            )
              .filter((element) => {
                const ariaLabel = element.getAttribute("aria-label")?.trim();
                const labelledBy = element.getAttribute("aria-labelledby")?.trim();
                const hasLabel = "labels" in element && element.labels?.length > 0;
                const text = (element.innerText || element.textContent || "").trim();
                const imageAlt = element.querySelector("img[alt]")?.getAttribute("alt")?.trim();
                return !ariaLabel && !labelledBy && !hasLabel && !text && !imageAlt;
              })
              .map((element) => ({
                tag: element.tagName.toLowerCase(),
                type: element.getAttribute("type"),
                placeholder: element.getAttribute("placeholder"),
              }));

            return {
              viewportWidth: width,
              documentWidth: rootWidth,
              bodyWidth,
              horizontalOverflow: rootWidth > width + 1 || bodyWidth > width + 1,
              overflowingElements: overflowing,
              unnamedControls,
              mainLandmarks: document.querySelectorAll("main, [role='main']").length,
            };
          });
          caseResult.horizontalOverflow = metrics.horizontalOverflow;
          caseResult.unnamedControls = metrics.unnamedControls;
          caseResult.layout = metrics;

          if (metrics.horizontalOverflow) {
            report.failures.push(
              `${viewport.name} ${route.name}: horizontal overflow (${metrics.documentWidth}px document in ${metrics.viewportWidth}px viewport)`,
            );
          }
          if (metrics.unnamedControls.length > 0) {
            report.failures.push(
              `${viewport.name} ${route.name}: ${metrics.unnamedControls.length} interactive control(s) have no programmatic accessible name`,
            );
          }
          if (metrics.mainLandmarks === 0) {
            report.accessibility.violations.push({
              route: route.name,
              viewport: viewport.name,
              rule: "main-landmark",
              impact: "moderate",
              description: "Page has no main landmark.",
            });
          }

          if (route.name === "home") {
            const sample = await page.locator("main code").innerText();
            caseResult.publisherCodeSample = sample;
            if (sample !== 'show_ads("your_moment")') {
              report.failures.push(
                `${viewport.name} home: publisher code sample rendered incorrectly: ${JSON.stringify(sample)}`,
              );
            }
          }

          const axe = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
            .analyze();
          caseResult.axeViolations = axe.violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            description: violation.description,
            help: violation.help,
            helpUrl: violation.helpUrl,
            nodes: violation.nodes.slice(0, 8).map((node) => ({
              target: node.target,
              summary: node.failureSummary,
            })),
          }));
          report.accessibility.violationCount += axe.violations.length;
          for (const violation of caseResult.axeViolations) {
            report.accessibility.violations.push({
              route: route.name,
              viewport: viewport.name,
              ...violation,
            });
            if (["critical", "serious"].includes(violation.impact)) {
              report.accessibility.seriousOrCriticalCount += 1;
              report.failures.push(
                `${viewport.name} ${route.name}: axe ${violation.impact} violation ${violation.id}`,
              );
            }
          }

          const expectedUnauthorizedConsoleMessage =
            /Failed to load resource: the server responded with a status of 401 \\(Unauthorized\\)/i;
          caseResult.consoleErrors = caseResult.consoleErrors.filter(
            (message) =>
              !(
                route.name === "activation" &&
                caseResult.expectedAuthResponses.length > 0 &&
                expectedUnauthorizedConsoleMessage.test(message)
              ),
          );
          if (caseResult.consoleErrors.length) {
            report.failures.push(
              `${viewport.name} ${route.name}: browser console error(s): ${caseResult.consoleErrors.join(" | ")}`,
            );
          }
          if (caseResult.pageErrors.length) {
            report.failures.push(
              `${viewport.name} ${route.name}: uncaught browser error(s): ${caseResult.pageErrors.join(" | ")}`,
            );
          }
          if (caseResult.failedSameOriginResponses.length) {
            report.failures.push(
              `${viewport.name} ${route.name}: failed same-origin response(s): ${JSON.stringify(caseResult.failedSameOriginResponses)}`,
            );
          }
        } catch (error) {
          report.failures.push(`${viewport.name} ${route.name}: ${error.message}`);
          caseResult.testError = error.message;
        } finally {
          const screenshotPath = path.join(outputDir, `${viewport.name}-${route.name}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: true }).catch((error) => {
            caseResult.screenshotError = error.message;
          });
          caseResult.screenshot = screenshotPath;
          report.cases.push(caseResult);
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  report.completedAt = new Date().toISOString();
  report.status = report.failures.length === 0 ? "passed" : "failed";
  const reportPath = path.join(outputDir, "report.json");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  const summary = [
    "## NextAction UI audit",
    "",
    `**Status:** ${report.status.toUpperCase()}`,
    `**Pages/viewports checked:** ${report.cases.length} (${routes.length} routes × ${viewports.length} viewports)`,
    `**Horizontal overflow cases:** ${report.cases.filter((item) => item.horizontalOverflow).length}`,
    `**Axe violations recorded:** ${report.accessibility.violationCount} (critical/serious: ${report.accessibility.seriousOrCriticalCount})`,
    `**Browser console/page/network failures:** ${report.failures.length}`,
    "",
    "### Findings",
    ...(report.failures.length ? report.failures.map((failure) => `- ❌ ${failure}`) : ["- ✅ No blocking UI audit findings."]),
    "",
    "Full JSON and screenshots are attached as the `ui-audit-artifacts` workflow artifact.",
  ].join("\n") + "\n";
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
  }
  console.log(summary);
  console.log(`UI audit report written to ${reportPath}`);

  if (report.failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
