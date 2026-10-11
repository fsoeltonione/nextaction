import assert from "node:assert/strict";

const rawBaseUrl = process.env.STAGING_BASE_URL?.trim();
if (!rawBaseUrl) {
  throw new Error("Missing STAGING_BASE_URL; this smoke test must run against staging.");
}

const baseUrl = new URL(rawBaseUrl);
if (baseUrl.protocol !== "https:") {
  throw new Error("STAGING_BASE_URL must use HTTPS.");
}
if (!baseUrl.hostname.endsWith(".workers.dev") || baseUrl.hostname === "workers.dev") {
  throw new Error("Refusing scanner security smoke outside the known staging workers.dev host.");
}

const targets = [...new Set([
  baseUrl.hostname,
  "nextaction.fsoeltoni-one.workers.dev",
])];

for (const hostname of targets) {
  const response = await fetch(new URL("/api/analyze", baseUrl), {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
    body: JSON.stringify({ url: `https://${hostname}/api/health` }),
  });

  const payload = await response.json().catch(() => null);
  assert.equal(
    response.status,
    400,
    `Expected self-origin scanner URL ${hostname} to be rejected with HTTP 400`,
  );
  assert.equal(
    payload?.error?.code,
    "self_origin_not_allowed",
    `Expected stable self-origin rejection for ${hostname}`,
  );
  assert.equal(
    response.headers.get("cache-control"),
    "no-store",
    "Scanner security error must not be cached.",
  );

  console.log(`Staging scanner self-origin rejection: OK (${hostname})`);
}

console.log("Controlled staging scanner security smoke: OK");
