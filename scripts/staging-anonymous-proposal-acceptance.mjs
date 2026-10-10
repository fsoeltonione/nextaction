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

    // Start as a true anonymous browser: no Supabase cookies, local storage,
    // auth headers, or previously authenticated context are installed.
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

    await page.getByRole("heading", { name: "Confirm product understanding" }).waitFor({
      state: "visible",
      timeout: 75_000,
    });

    const proposalPageUrl = new URL(page.url());
    const proposalUrl = proposalPageUrl.searchParams.get("url");
    assert.equal(proposalPageUrl.pathname, "/onboarding");
    assert.ok(proposalUrl, "the pending normalized product URL must remain in the proposal URL");
    assert.equal(new URL(proposalUrl).hostname, "linear.app");

    const productName = (await page.getByLabel("Product name").inputValue()).trim();
    const momentCount = await page.getByLabel("Moment key").count();
    assert.ok(productName.length > 0, "anonymous analysis must show a product name");
    assert.ok(
      momentCount >= 3 && momentCount <= 8,
      `anonymous analysis returned an unexpected Moment count: ${momentCount}`,
    );

    // Confirmation is the persistence boundary. The API must reject the save
    // before writing Product/Moment data, and the UI must preserve the draft URL
    // while redirecting to login. Do not sign in or create any staging data.
    const confirmResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/products/confirm" && response.request().method() === "POST";
    });
    await page.getByRole("button", { name: "Confirm product" }).click();
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
      proposalUrl,
      "login redirect must preserve the exact normalized pending proposal URL",
    );
    assert.ok(
      loginUrl.searchParams.has("url"),
      "login must retain activation context instead of falling back to a generic login",
    );

    console.log("Staging anonymous URL-first proposal acceptance: PASS");
    console.log(
      `Verified: pre-auth Product Understanding, ${momentCount} Moments, private state (401), save denied before auth (401), and pending URL preserved at login.`,
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(
    `Staging anonymous proposal acceptance failed: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
});
