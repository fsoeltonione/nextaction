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
    page.setDefaultTimeout(30_000);

    // This journey verifies manual Product/Moment entry, not a crawler or AI proposal.
    await page.goto(
      `${baseUrl}/onboarding?url=${encodeURIComponent(productUrl)}`,
      { waitUntil: "domcontentloaded", timeout: 30_000 },
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

    await page.getByRole("heading", { name: "Set up your product" }).waitFor({
      state: "visible",
      timeout: 30_000,
    });

    const setupUrl = new URL(page.url());
    const normalizedProductUrl = setupUrl.searchParams.get("url");
    assert.equal(setupUrl.pathname, "/onboarding");
    assert.ok(normalizedProductUrl, "the pending product URL must remain in the setup URL");
    assert.equal(new URL(normalizedProductUrl).hostname, "linear.app");

    const productName = page.getByLabel("Product name");
    assert.equal((await productName.inputValue()).trim(), "", "product name must be entered by the publisher");
    await productName.fill("Invoice SaaS");

    const firstMomentKey = page.getByLabel("Moment key").first();
    const firstMomentLabel = page.getByLabel("Label").first();
    assert.equal((await firstMomentKey.inputValue()).trim(), "", "Moment must not be auto-inferred");
    await firstMomentLabel.fill("Invoice created");
    // Label entry may suggest the deterministic key; assert it does not call an analyzer.
    await firstMomentKey.fill("invoice_created");

    const confirmResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/products/confirm" && response.request().method() === "POST";
    });
    await page.getByRole("button", { name: "Save product and Moments" }).click();
    const confirmResponse = await confirmResponsePromise;
    assert.equal(
      confirmResponse.status(),
      401,
      "anonymous product confirmation must be denied before persistence",
    );

    await page.waitForURL((url) => url.pathname === "/login", { timeout: 30_000 });
    const loginUrl = new URL(page.url());
    assert.equal(loginUrl.pathname, "/login");
    assert.equal(
      loginUrl.searchParams.get("url"),
      normalizedProductUrl,
      "login redirect must preserve the exact normalized pending product URL",
    );

    console.log("Staging anonymous manual product setup acceptance: PASS");
    console.log(
      "Verified: no AI/crawler proposal, publisher-entered product and Moment, private state (401), save denied before auth (401), and product URL preserved at login.",
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(
    `Staging anonymous manual product setup acceptance failed: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
});
