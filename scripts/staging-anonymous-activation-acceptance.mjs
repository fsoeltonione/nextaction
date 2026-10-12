import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = requiredEnv("STAGING_BASE_URL").replace(/\/+$/, "");
const productUrl = "https://linear.app";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const requestedUrls = [];
    page.on("request", (request) => requestedUrls.push(request.url()));
    page.setDefaultTimeout(30_000);

    // URL-first is a convenience for entering publisher metadata only. The
    // active embed-only product must not crawl the supplied site or call AI.
    await page.goto(
      `${baseUrl}/onboarding?url=${encodeURIComponent(productUrl)}`,
      { waitUntil: "domcontentloaded", timeout: 30_000 },
    );
    await page.waitForURL((url) => url.pathname === "/activate", { timeout: 15_000 });

    const activationUrl = new URL(page.url());
    assert.equal(activationUrl.origin, baseUrl);
    assert.equal(activationUrl.pathname, "/activate");
    assert.equal(
      activationUrl.searchParams.get("url"),
      productUrl,
      "the pending publisher URL must survive the onboarding redirect as metadata",
    );

    await page.getByRole("heading", { name: "NextAction Activation" }).waitFor({
      state: "visible",
      timeout: 30_000,
    });
    const urlInput = page.getByPlaceholder("https://invoice-app.com");
    await urlInput.waitFor({ state: "visible" });
    assert.equal(
      await urlInput.inputValue(),
      productUrl,
      "the pending URL should prefill the publisher metadata field",
    );

    const activationText = await page.locator("main").innerText();
    assert.match(
      activationText,
      /Tanpa SDK\.\s+Tanpa crawling\.\s+Tanpa AI\./,
      "the activation page must communicate the active embed-only flow",
    );
    assert.doesNotMatch(
      activationText,
      /Confirm product understanding|Product analysis|AI-generated Moment/i,
      "retired URL analysis must not reappear in the activation UI",
    );

    const anonymousStateStatus = await page.evaluate(async () => {
      const response = await fetch("/api/onboarding/state", { cache: "no-store" });
      return response.status;
    });
    assert.equal(
      anonymousStateStatus,
      401,
      "activation state must remain private to authenticated users",
    );

    const anonymousSaveStatus = await page.evaluate(async () => {
      const response = await fetch("/api/products/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      return response.status;
    });
    assert.equal(
      anonymousSaveStatus,
      401,
      "anonymous publisher writes must be denied before any persistence",
    );

    assert.ok(
      !requestedUrls.some((value) => new URL(value).pathname === "/api/analyze"),
      "the embed-only activation flow must not call the retired analysis endpoint",
    );
    assert.ok(
      !requestedUrls.some((value) => new URL(value).hostname === "linear.app"),
      "the browser must not navigate to or fetch the publisher URL during metadata entry",
    );

    console.log("Staging anonymous embed-first activation acceptance: PASS");
    console.log(
      "Verified: onboarding URL preserved as metadata, manual Moment flow only, no browser crawl/AI request, activation state private (401), and anonymous save denied (401).",
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(
    `Staging anonymous activation acceptance failed: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
});
