const baseUrl = process.env.PRODUCTION_BASE_URL;
const supabaseUrl = process.env.PRODUCTION_NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecretKey = process.env.PRODUCTION_SUPABASE_SECRET_KEY;
const analyzeSmokeUrl =
  process.env.PRODUCTION_ANALYZE_SMOKE_URL ?? "https://carrd.com";

const missing = [
  ["PRODUCTION_BASE_URL", baseUrl],
  ["PRODUCTION_NEXT_PUBLIC_SUPABASE_URL", supabaseUrl],
  ["PRODUCTION_SUPABASE_SECRET_KEY", supabaseSecretKey],
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length > 0) {
  console.error(
    `Missing required production smoke environment variables: ${missing.join(", ")}`,
  );
  process.exit(2);
}

const applicationUrl = new URL(baseUrl);
const databaseUrl = new URL(supabaseUrl);
const analysisUrl = new URL(analyzeSmokeUrl);
if (analysisUrl.protocol !== "https:") {
  console.error("PRODUCTION_ANALYZE_SMOKE_URL must use HTTPS.");
  process.exit(2);
}

if (applicationUrl.protocol !== "https:" || databaseUrl.protocol !== "https:") {
  console.error("Production smoke targets must use HTTPS.");
  process.exit(2);
}

async function appRequest(path, options = {}) {
  return fetch(new URL(path, applicationUrl), {
    redirect: "manual",
    ...options,
    headers: {
      ...(options.headers ?? {}),
      "cache-control": "no-store",
    },
  });
}

async function supabaseRequest(path, options = {}) {
  const url = new URL(path, databaseUrl);
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: supabaseSecretKey,
      Authorization: `Bearer ${supabaseSecretKey}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Supabase request failed: HTTP ${response.status} ${response.statusText}\n${text}`,
    );
  }

  return response.json();
}

async function rpc(name, body) {
  return supabaseRequest(`/rest/v1/rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

try {
  const health = await appRequest("/api/health");
  if (health.status !== 200) {
    throw new Error(`Production health check failed: HTTP ${health.status}`);
  }

  const healthBody = await health.json();
  if (
    healthBody?.status !== "ok" ||
    healthBody?.service !== "nextaction" ||
    healthBody?.environment !== "production"
  ) {
    throw new Error(
      "Production health check returned an unexpected deployment identity.",
    );
  }

  console.log("Production health check: OK");

  const analyze = await appRequest("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: analysisUrl.toString() }),
  });

  if (analyze.status !== 200) {
    throw new Error(`Production analyze check expected HTTP 200, got ${analyze.status}`);
  }
  console.log("Production analysis scanner live-path smoke: OK");

  const unauthTrack = await appRequest("/v1/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "smoke", occurred_at: new Date().toISOString(), data: {} }),
  });
  if (unauthTrack.status !== 401) throw new Error("Auth guard failed on /track");

  const unauthOffer = await appRequest("/v1/offer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ moment_key: "smoke" }),
  });
  if (unauthOffer.status !== 401) throw new Error("Auth guard failed on /offer");

  const missingClick = await appRequest("/v1/click/production-smoke-invalid-token");
  if (missingClick.status !== 404) throw new Error("Guard failed on /click");

  console.log("Production public API auth/negative-path guards: OK");

  const members = await supabaseRequest(
    "/rest/v1/workspace_members?select=user_id&order=created_at.asc&limit=1",
  );
  const userId = Array.isArray(members) ? members[0]?.user_id : null;

  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error(
      "Production runtime smoke requires an existing authenticated user.",
    );
  }

  // --- BEGIN NEW HTTP ECONOMIC SMOKE ---

  const crypto = globalThis.crypto;
  const smokeId = crypto.randomUUID().replace(/-/g, "");
  const deliveryToken = "na_prod_smoke_" + smokeId;
  const credentialHashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deliveryToken));
  const credentialHash = Array.from(new Uint8Array(credentialHashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

  // 1. Provision fixture
  const fixtureResult = await rpc("production_smoke_fixture_create", {
    p_smoke_id: smokeId,
    p_user_id: userId,
    p_credential_hash: credentialHash,
  });
  const fixture = Array.isArray(fixtureResult) ? fixtureResult[0] : fixtureResult;
  if (!fixture || !fixture.result_integration_id || !fixture.result_moment_key) {
    throw new Error("Failed to provision smoke fixture");
  }

  try {
    const integrationToken = deliveryToken; // Used as integration token
    const idempotencyKey = `prod-smoke-${crypto.randomUUID()}`;
    const trackBody = JSON.stringify({
      type: fixture.result_moment_key,
      occurred_at: new Date().toISOString(),
      data: { smoke_id: smokeId },
    });

    const track = await appRequest("/v1/track", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${integrationToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: trackBody,
    });
    if (track.status !== 202) throw new Error(`Track failed: HTTP ${track.status}`);

    const trackReplay = await appRequest("/v1/track", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${integrationToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: trackBody,
    });
    if (trackReplay.status !== 202) throw new Error("Track replay failed");
    console.log("Event idempotency HTTP smoke: OK");

    const offer = await appRequest("/v1/offer", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${integrationToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ moment_key: fixture.result_moment_key, context: { source: "prod-smoke" } }),
    });
    if (offer.status !== 200) throw new Error(`Offer failed: HTTP ${offer.status}`);
    const offerBody = await offer.json();
    const resolvedDeliveryToken = offerBody?.delivery?.token;
    if (typeof resolvedDeliveryToken !== "string" || resolvedDeliveryToken.length < 20) {
      throw new Error("Offer returned no delivery token");
    }
    console.log("Decision -> Delivery HTTP smoke: OK");

    const clickPath = `/v1/click/${encodeURIComponent(resolvedDeliveryToken)}`;
    const clickFirst = await appRequest(clickPath);
    if (clickFirst.status !== 302) throw new Error(`Click first expected 302, got ${clickFirst.status}`);

    const clickReplay = await appRequest(clickPath);
    if (clickReplay.status !== 302) throw new Error(`Click replay expected 302, got ${clickReplay.status}`);
    
    console.log("Click -> Settlement HTTP smoke: OK");

  } finally {
    await rpc("production_smoke_fixture_cleanup", { p_smoke_id: smokeId });
    console.log("Production HTTP smoke fixture cleaned up.");
  }
} catch (error) {
  console.error("Production smoke failed:");
  console.error(error);
  process.exit(1);
}
