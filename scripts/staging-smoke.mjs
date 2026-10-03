import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const baseUrl = process.env.STAGING_BASE_URL;
const integrationToken = process.env.STAGING_INTEGRATION_TOKEN;
const stagingSupabaseUrl = process.env.STAGING_NEXT_PUBLIC_SUPABASE_URL;
const stagingSupabaseSecretKey = process.env.STAGING_SUPABASE_SECRET_KEY;

// Stage 14 is a fixed release-gate fixture. Its Moment key is part of the
// fixture contract and must not be supplied by mutable CI configuration.
const STAGE14_SMOKE_MOMENT_KEY = "stage14_smoke_moment";
const expectedEnvironment =
  process.env.EXPECTED_ENVIRONMENT ?? "staging";
const defaultAnalyzeSmokeUrl = "https://carrd.com";
const expectedReleaseSha = process.env.STAGING_EXPECTED_RELEASE_SHA ?? process.env.CIRCLE_SHA1;

if (!baseUrl) {
  console.error("Missing STAGING_BASE_URL.");
  process.exit(2);
}

const url = new URL(baseUrl);
if (url.protocol !== "https:") {
  console.error("STAGING_BASE_URL must use HTTPS.");
  process.exit(2);
}

async function request(path, options = {}) {
  return fetch(new URL(path, url), {
    redirect: "manual",
    ...options,
    headers: {
      ...(options.headers ?? {}),
      "cache-control": "no-store",
    },
  });
}

const health = await request("/api/health");
if (health.status !== 200) {
  console.error(`Health check failed: HTTP ${health.status}`);
  process.exit(1);
}

const healthBody = await health.json();
if (
  healthBody?.status !== "ok" ||
  healthBody?.service !== "nextaction" ||
  healthBody?.environment !== expectedEnvironment
) {
  console.error("Health check returned an unexpected deployment identity.");
  console.error(
    JSON.stringify(
      {
        expected_environment: expectedEnvironment,
        health_body: healthBody,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

if (expectedReleaseSha) {
  if (!/^[0-9a-f]{40}$/i.test(expectedReleaseSha)) {
    console.error("STAGING_EXPECTED_RELEASE_SHA must be a valid 40-character Git SHA.");
    process.exit(2);
  }
  if (healthBody?.release_sha !== expectedReleaseSha) {
    console.error("Runtime release SHA does not match the CI source revision.");
    console.error(JSON.stringify({ expected_release_sha: expectedReleaseSha, actual_release_sha: healthBody?.release_sha }, null, 2));
    process.exit(1);
  }
  console.log(`${expectedEnvironment} release provenance check: OK`);
}

console.log(`${expectedEnvironment} health check: OK`);

const readiness = await request("/api/health/ready");
if (readiness.status !== 200) {
  console.error(`Runtime readiness check failed: HTTP ${readiness.status}`);
  console.error("Readiness response body:", await readiness.text());
  process.exit(1);
}

const readinessBody = await readiness.json();
if (
  readinessBody?.status !== "ready" ||
  readinessBody?.queue?.exists !== true ||
  readinessBody?.worker?.function_exists !== true ||
  readinessBody?.worker?.schedule_active !== true ||
  readinessBody?.worker?.recent_success !== true ||
  readinessBody?.operations?.schedule_active !== true
) {
  console.error("Runtime readiness returned an unexpected state.");
  console.error(JSON.stringify(readinessBody, null, 2));
  process.exit(1);
}

console.log(`${expectedEnvironment} runtime readiness check: OK`);

if (!integrationToken) {
  if (expectedEnvironment === "production") {
    console.log("Production health smoke: OK");
    process.exit(0);
  }

  console.error("Missing STAGING_INTEGRATION_TOKEN.");
  process.exit(2);
}

const idempotencyKey = `stage14-smoke-${crypto.randomUUID()}`;
const trackBody = JSON.stringify({
  type: "stage14.smoke.moment",
  occurred_at: new Date().toISOString(),
  data: {
    smoke_id: crypto.randomUUID(),
  },
});

const track = await request("/v1/track", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${integrationToken}`,
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
  },
  body: trackBody,
});

if (track.status !== 202) {
  console.error(`Track smoke expected HTTP 202, got ${track.status}`);
  console.error("Track response body:", await track.text());
  process.exit(1);
}

const trackBodyJson = await track.json();
if (!trackBodyJson?.accepted || !trackBodyJson?.event_id) {
  console.error("Track smoke returned an invalid acceptance response.");
  process.exit(1);
}

const trackReplay = await request("/v1/track", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${integrationToken}`,
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
  },
  body: trackBody,
});

if (trackReplay.status !== 202) {
  console.error(
    `Track replay smoke expected HTTP 202, got ${trackReplay.status}`,
  );
  console.error("Track replay response body:", await trackReplay.text());
  process.exit(1);
}

const trackReplayBody = await trackReplay.json();
if (
  !trackReplayBody?.idempotent_replay ||
  trackReplayBody.event_id !== trackBodyJson.event_id
) {
  console.error("Track replay did not return the original Event.");
  process.exit(1);
}

console.log("Event idempotency smoke: OK");
console.log(
  `Stage 14 Moment contract: ${STAGE14_SMOKE_MOMENT_KEY}`,
);

if (!stagingSupabaseUrl || !stagingSupabaseSecretKey) {
  console.error(
    "Missing STAGING_NEXT_PUBLIC_SUPABASE_URL or STAGING_SUPABASE_SECRET_KEY.",
  );
  process.exit(2);
}

const stagingSupabase = createClient(
  stagingSupabaseUrl,
  stagingSupabaseSecretKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

const EVENT_PROCESSING_TIMEOUT_MS = 90_000;

async function waitForEventProcessing(
  eventId,
  timeoutMs = EVENT_PROCESSING_TIMEOUT_MS,
) {
  const { data: integrationRows, error: integrationError } =
    await stagingSupabase.rpc("resolve_runtime_integration", {
      p_credential_hash: crypto
        .createHash("sha256")
        .update(integrationToken)
        .digest("hex"),
    });

  if (integrationError) {
    throw new Error(
      `Unable to resolve staging smoke integration: ${integrationError.message}`,
    );
  }

  const integration = Array.isArray(integrationRows)
    ? integrationRows[0]
    : integrationRows;
  const integrationId = integration?.result_integration_id;

  if (typeof integrationId !== "string" || integrationId.length === 0) {
    throw new Error("Staging smoke integration resolution returned no integration id.");
  }

  const startedAt = Date.now();
  let lastSnapshot = null;

  while (Date.now() - startedAt < timeoutMs) {
    const { data, error } = await stagingSupabase.rpc(
      "production_smoke_fixture_verify",
      {
        p_integration_id: integrationId,
        p_event_id: eventId,
      },
    );

    if (error) {
      throw new Error(
        `Unable to verify staging Event processing: ${error.message}`,
      );
    }

    const snapshot = Array.isArray(data) ? data[0] : data;
    lastSnapshot = snapshot;

    if (
      snapshot?.event_found === true &&
      snapshot?.occurrence_found === true &&
      snapshot?.queue_messages_for_event === 0
    ) {
      return snapshot;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(
    `Timed out waiting for Event → Moment processing. Last state: ${JSON.stringify(lastSnapshot)}`,
  );
}

await waitForEventProcessing(trackBodyJson.event_id);
console.log("Event → Moment processing smoke: OK");

const offer = await request("/v1/offer", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${integrationToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    moment_key: STAGE14_SMOKE_MOMENT_KEY,
    context: {
      source: "stage14-smoke",
    },
  }),
});

if (offer.status !== 200) {
  console.error(`Offer smoke expected HTTP 200, got ${offer.status}`);
  process.exit(1);
}

const offerBody = await offer.json();
const deliveryToken = offerBody?.delivery?.token;
if (typeof deliveryToken !== "string" || deliveryToken.length < 20) {
  console.error("Offer smoke returned no valid Delivery token.");
  process.exit(1);
}

console.log("Decision → Delivery smoke: OK");

const clickPath = `/v1/click/${encodeURIComponent(deliveryToken)}`;
const first = await request(clickPath);
if (first.status !== 302) {
  console.error(`First click smoke expected HTTP 302, got ${first.status}`);
  process.exit(1);
}

const location = first.headers.get("location");
if (!location) {
  console.error("First click smoke returned no Location header.");
  process.exit(1);
}

const destination = new URL(location);
if (destination.protocol !== "http:" && destination.protocol !== "https:") {
  console.error("First click smoke returned a non-HTTP destination.");
  process.exit(1);
}

const replay = await request(clickPath);
if (replay.status !== 302) {
  console.error(`Replay click smoke expected HTTP 302, got ${replay.status}`);
  process.exit(1);
}

const replayLocation = replay.headers.get("location");
if (replayLocation !== location) {
  console.error("Replay click smoke changed the redirect destination.");
  process.exit(1);
}

console.log(
  "Click → Qualified Click → Settlement + replay smoke: OK",
);

if (expectedEnvironment === "staging") {
  const analyzeTarget =
    process.env.STAGING_ANALYZE_SMOKE_URL ?? defaultAnalyzeSmokeUrl;

  const analyze = await request("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: analyzeTarget }),
  });

  if (analyze.status !== 200) {
    console.error(
      `Analyze smoke expected HTTP 200, got ${analyze.status}`,
    );
    console.error("Analyze response body:", await analyze.text());
    process.exit(1);
  }

  const analyzeBody = await analyze.json();
  const analysis = analyzeBody?.analysis;

  if (
    !analysis ||
    typeof analysis.name !== "string" ||
    analysis.name.trim().length === 0 ||
    typeof analysis.description !== "string" ||
    analysis.description.trim().length === 0 ||
    !Array.isArray(analysis.moments) ||
    analysis.moments.length < 1 ||
    analysis.moments.length > 10
  ) {
    console.error("Analyze smoke returned an invalid analysis shape.");
    console.error(JSON.stringify(analyzeBody, null, 2));
    process.exit(1);
  }

  console.log("Product analysis → scanner live-path smoke: OK");
}
