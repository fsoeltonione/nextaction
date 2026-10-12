import { randomBytes } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const baseUrl = requiredEnv("STAGING_BASE_URL").replace(/\/+$/, "");
const supabaseUrl = requiredEnv("STAGING_NEXT_PUBLIC_SUPABASE_URL");
const publishableKey = requiredEnv("STAGING_NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const secretKey = requiredEnv("STAGING_SUPABASE_SECRET_KEY");
const productUrl = "https://linear.app";

const browserCookieOptions = {
  path: "/",
  sameSite: "Lax",
  secure: baseUrl.startsWith("https://"),
  httpOnly: false,
};

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function assertResponse(ok, message) {
  if (!ok) throw new Error(message);
}

function cookieSameSite(value) {
  if (typeof value !== "string") return "Lax";
  const normalized = value.toLowerCase();
  if (normalized === "strict") return "Strict";
  if (normalized === "none") return "None";
  return "Lax";
}

async function buildAuthCookies(session) {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieJar = new Map();

  const serverClient = createServerClient(supabaseUrl, publishableKey, {
    cookieOptions: { name: cookieName, ...browserCookieOptions },
    cookies: {
      getAll() {
        return [...cookieJar.values()].map(({ name, value }) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          if (!cookie.value || cookie.options?.maxAge === 0) {
            cookieJar.delete(cookie.name);
          } else {
            cookieJar.set(cookie.name, cookie);
          }
        }
      },
    },
  });

  const { error } = await serverClient.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) throw new Error("Could not initialize the temporary staging session.");

  // createServerClient persists its session through its setAll cookie adapter.
  // Wait only for that in-process write; this is not a remote polling loop.
  if (cookieJar.size === 0) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assertResponse(cookieJar.size > 0, "Supabase did not emit staging auth cookies.");

  return [...cookieJar.values()].map(({ name, value, options }) => {
    const result = {
      name,
      value,
      // Playwright requires either `url` OR `domain` + `path`, not both.
      // Using `url` lets Chromium infer the cookie path from the staging origin.
      url: baseUrl,
      secure: options?.secure ?? browserCookieOptions.secure,
      httpOnly: options?.httpOnly ?? false,
      sameSite: cookieSameSite(options?.sameSite),
    };
    if (typeof options?.maxAge === "number" && options.maxAge > 0) {
      result.expires = Math.floor(Date.now() / 1000) + options.maxAge;
    }
    return result;
  });
}

async function fetchActivationStateWithRetry(page, maxAttempts = 3) {
  let lastResponse = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastResponse = await page.evaluate(async () => {
      const response = await fetch("/api/onboarding/state", { cache: "no-store" });
      return { status: response.status, body: await response.json().catch(() => ({})) };
    });
    if (lastResponse.status === 200) return lastResponse;

    const retryable = lastResponse.status === 408 || lastResponse.status === 429 || lastResponse.status >= 500;
    if (!retryable || attempt === maxAttempts) break;
    await page.waitForTimeout(150 * attempt);
  }

  return lastResponse;
}

async function main() {
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const signInClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  let testUserId = null;
  let browser = null;
  let cleanupFailed = false;

  try {
    const suffix = randomBytes(6).toString("hex");
    const appName = `Automated staging publisher ${suffix}`;
    const email = `staging-acceptance-${Date.now()}-${suffix}@example.com`;
    const password = randomBytes(32).toString("base64url") + "Aa9!";

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        purpose: "automated-staging-acceptance",
        run: process.env.GITHUB_RUN_ID ?? "manual",
      },
    });
    if (createError || !created.user) {
      throw new Error("Could not create the temporary staging acceptance user.");
    }
    testUserId = created.user.id;

    const { data: signedIn, error: signInError } = await signInClient.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError || !signedIn.session) {
      throw new Error("Could not sign in the temporary staging acceptance user. Check that email/password auth is enabled for staging.");
    }

    const cookies = await buildAuthCookies(signedIn.session);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addCookies(cookies);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const failedApiResponses = [];
    const pageErrors = [];
    const consoleErrors = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin === baseUrl && url.pathname.startsWith("/api/") && response.status() >= 400) {
        failedApiResponses.push(`${response.request().method()} ${response.status()} ${url.pathname}`);
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 300)));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
    });

    await page.goto(`${baseUrl}/onboarding?url=${encodeURIComponent(productUrl)}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForURL((url) => url.pathname === "/activate", { timeout: 15_000 });
    assertResponse(new URL(page.url()).origin === baseUrl, "Activation navigation left the staging origin.");
    assertResponse(
      new URL(page.url()).searchParams.get("url") === productUrl,
      "The onboarding redirect did not preserve the pending publisher URL.",
    );

    await page.getByRole("heading", { name: "NextAction Activation" }).waitFor({ state: "visible" });
    const urlInput = page.getByPlaceholder("https://invoice-app.com");
    await urlInput.waitFor({ state: "visible" });
    assertResponse(
      (await urlInput.inputValue()) === productUrl,
      "The pending publisher URL was not prefilled as metadata.",
    );

    try {
      await page.waitForFunction(
        () => {
          const saveButton = [...document.querySelectorAll("button")].find(
            (button) => button.textContent?.trim() === "Simpan Publisher",
          );
          return saveButton instanceof HTMLButtonElement && !saveButton.disabled;
        },
        undefined,
        { timeout: 20_000 },
      );
    } catch {
      const visibleUi = (await page.locator("main").innerText()).slice(-800);
      const apiDiagnostic = failedApiResponses.slice(-8).join("; ") || "none";
      const pageDiagnostic = pageErrors.slice(-3).join(" | ") || "none";
      const consoleDiagnostic = consoleErrors.slice(-3).join(" | ") || "none";
      throw new Error(
        `Activation UI did not become ready. Visible UI: ${visibleUi}. Failed API responses: ${apiDiagnostic}. Page errors: ${pageDiagnostic}. Console errors: ${consoleDiagnostic}.`,
      );
    }

    const initialStateResponse = await fetchActivationStateWithRetry(page);
    assertResponse(initialStateResponse?.status === 200, `Authenticated activation state did not load after bounded retries (HTTP ${initialStateResponse?.status ?? "no response"}).`);
    assertResponse(
      Array.isArray(initialStateResponse.body?.state?.workspaces),
      "Authenticated activation state did not return the workspace list.",
    );

    await page.getByPlaceholder("Nama aplikasi").fill(appName);
    await page.getByPlaceholder("Deskripsi singkat").fill("Temporary publisher created only for staging acceptance.");
    await page.getByPlaceholder("invoice_created").fill("invoice_created");
    await page.getByPlaceholder("Invoice Created").fill("Invoice Created");
    await page.getByPlaceholder("Optional description").fill("After an invoice has been created.");
    await page.getByRole("button", { name: "Simpan Publisher" }).click();

    try {
      await page.getByText(
        "Publisher dan Moment tersimpan. Lanjutkan untuk membuat publisher key.",
        { exact: true },
      ).waitFor({ state: "visible", timeout: 30_000 });
    } catch {
      const visibleUi = (await page.locator("main").innerText()).slice(-1000);
      const apiDiagnostic = failedApiResponses.slice(-10).join("; ") || "none";
      const pageDiagnostic = pageErrors.slice(-3).join(" | ") || "none";
      const consoleDiagnostic = consoleErrors.slice(-3).join(" | ") || "none";
      throw new Error(
        `Publisher save did not reach the success state. Visible UI: ${visibleUi}. Failed API responses: ${apiDiagnostic}. Page errors: ${pageDiagnostic}. Console errors: ${consoleDiagnostic}.`,
      );
    }

    const savedStateResponse = await fetchActivationStateWithRetry(page);
    assertResponse(savedStateResponse?.status === 200, `Saved activation state could not be reloaded after bounded retries (HTTP ${savedStateResponse?.status ?? "no response"}).`);
    const savedState = savedStateResponse.body?.state;
    assertResponse(savedState?.product?.name === appName, "The manually entered publisher name did not persist.");
    assertResponse(
      new URL(savedState.product.canonical_url).hostname === "linear.app",
      "The publisher URL was not retained as metadata.",
    );
    assertResponse(
      Array.isArray(savedState.product.moments) &&
        savedState.product.moments.some((moment) => moment.moment_key === "invoice_created"),
      "The publisher-defined Moment did not persist.",
    );
    assertResponse(
      Array.isArray(savedState.capabilities) && savedState.capabilities.includes("make_money"),
      "The Make Money capability was not saved for the publisher.",
    );
    const effectiveWorkspaceId = savedState?.workspace?.id;
    assertResponse(
      typeof effectiveWorkspaceId === "string" && effectiveWorkspaceId.length > 0,
      "Activation did not resolve a workspace after saving the first publisher.",
    );

    await page.getByRole("button", { name: "Buat Publisher Key" }).click();
    await page.getByRole("heading", { name: "3. Panggil iklan di action yang tepat" }).waitFor({
      state: "visible",
      timeout: 30_000,
    });

    const preBlocks = (await page.locator("pre").allTextContents()).map((value) => value.trim());
    const publisherKey = preBlocks[0] ?? "";
    assertResponse(publisherKey.length > 0, "The public publisher identifier was not displayed.");
    assertResponse(
      preBlocks.some((value) => value.includes(`data-publisher-key="${publisherKey}"`) && value.includes("/nextaction.js")),
      "The generated embed script does not contain the displayed publisher identifier.",
    );
    assertResponse(
      preBlocks.some((value) => value.includes('show_ads("invoice_created")')),
      "The embed example does not trigger the publisher-defined Moment.",
    );
    assertResponse(
      (await page.locator("main").innerText()).includes("Tanpa crawling. Tanpa AI."),
      "Activation no longer reflects the embed-only MVP contract.",
    );

    console.log("Staging authenticated embed-first activation acceptance: PASS");
    console.log("Verified: pending URL metadata, authenticated state, first-time workspace resolution, product/Moment persistence, public publisher key, and the zero-SDK embed snippet.");
  } finally {
    if (browser) await browser.close().catch(() => undefined);

    if (testUserId) {
      // Delete all workspaces reachable from the temporary user before deleting
      // the auth user so related activation rows can cascade cleanly.
      const { data: memberships, error: membershipLookupError } = await admin
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", testUserId);

      if (membershipLookupError) {
        console.error("Acceptance cleanup could not enumerate the temporary user's workspaces.");
        cleanupFailed = true;
      } else {
        const workspaceIds = [...new Set((memberships ?? []).map((row) => row.workspace_id))];
        if (workspaceIds.length > 0) {
          const { error: workspaceDeleteError } = await admin
            .from("workspaces")
            .delete()
            .in("id", workspaceIds);
          if (workspaceDeleteError) {
            console.error("Acceptance cleanup could not delete the temporary workspace.");
            cleanupFailed = true;
          }
        }
      }

      const { error: deleteUserError } = await admin.auth.admin.deleteUser(testUserId);
      if (deleteUserError) {
        console.error("Acceptance cleanup could not delete the temporary auth user.");
        cleanupFailed = true;
      }
    }

    if (cleanupFailed) {
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(`Staging authenticated acceptance failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
