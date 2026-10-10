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

    await page.goto(`${baseUrl}/onboarding?url=${encodeURIComponent(productUrl)}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    await page.getByRole("heading", { name: "Confirm product understanding" }).waitFor({
      state: "visible",
      timeout: 75_000,
    });

    const productName = (await page.getByLabel("Product name").inputValue()).trim();
    const momentCount = await page.getByLabel("Moment key").count();
    assertResponse(productName.length > 0, "Product analysis did not return a product name.");
    assertResponse(momentCount >= 3 && momentCount <= 8, "Product analysis returned an unexpected Moment count.");

    await page.getByRole("button", { name: "Confirm product" }).click();
    await page.getByRole("heading", { name: "Choose your goal" }).waitFor({ state: "visible" });

    // Verify the confirmed product and Moments survive a fresh browser navigation.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Choose your goal" }).waitFor({ state: "visible" });

    await page.getByRole("button", { name: /Both/ }).click();
    await page.getByRole("button", { name: "Save goal" }).click();
    await page.getByRole("heading", { name: "Make Money" }).waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "Reach Customers" }).waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Create connection" }).click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("div")].some((element) =>
        /^na_live_[A-Za-z0-9_-]+$/.test((element.textContent ?? "").trim()),
      ),
    );

    // The credential stays in memory only: never print it, capture a screenshot,
    // write it to an artifact, or commit it.
    const integrationToken = await page.evaluate(() => {
      const tokenNode = [...document.querySelectorAll("div")].find((element) =>
        /^na_live_[A-Za-z0-9_-]+$/.test((element.textContent ?? "").trim()),
      );
      return tokenNode?.textContent?.trim() ?? "";
    });
    assertResponse(integrationToken.startsWith("na_live_"), "The staging integration credential was not issued.");

    await page.getByPlaceholder("Offer title").fill("Automated staging acceptance offer");
    await page.getByPlaceholder("Offer description").fill("Temporary offer used only by the automated staging acceptance workflow.");
    await page.getByPlaceholder("https://...").fill("https://example.com");
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByRole("button", { name: "Create starter offer" }).click();
    await page.getByRole("heading", { name: "Verify your server connection" }).waitFor({ state: "visible" });

    const verifyResponse = await fetch(`${baseUrl}/v1/connection/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${integrationToken}` },
    });
    const verifyPayload = await verifyResponse.json().catch(() => ({}));
    assertResponse(
      verifyResponse.ok && verifyPayload.verified === true,
      "The temporary staging integration did not verify successfully.",
    );

    await page.getByRole("button", { name: /Refresh connection status/ }).click();
    await page.getByRole("heading", { name: "You are ready" }).waitFor({ state: "visible" });

    // Confirm activation state persists after a full reload.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "You are ready" }).waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Open dashboard" }).click();
    await page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 30_000 });
    assertResponse(new URL(page.url()).origin === baseUrl, "Dashboard navigation left the staging origin.");

    console.log("Staging authenticated acceptance: PASS");
    console.log("Verified: URL analysis, product/Moment persistence, both capabilities, integration verification, starter offer, Ready state, and dashboard navigation.");
  } finally {
    if (browser) await browser.close().catch(() => undefined);

    if (testUserId) {
      // Remove the temporary workspace first so dependent staging rows cascade,
      // then delete the auth user. Cleanup failure fails the job for visibility.
      const { data: workspaces, error: workspaceLookupError } = await admin
        .from("workspaces")
        .select("id")
        .eq("user_id", testUserId);

      if (workspaceLookupError) {
        console.error("Acceptance cleanup could not enumerate the temporary workspace.");
        cleanupFailed = true;
      } else if ((workspaces ?? []).length > 0) {
        const workspaceIds = workspaces.map((workspace) => workspace.id);
        const { error: workspaceDeleteError } = await admin
          .from("workspaces")
          .delete()
          .in("id", workspaceIds);
        if (workspaceDeleteError) {
          console.error("Acceptance cleanup could not delete the temporary workspace.");
          cleanupFailed = true;
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
