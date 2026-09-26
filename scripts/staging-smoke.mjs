const baseUrl = process.env.STAGING_BASE_URL;
const integrationToken = process.env.STAGING_INTEGRATION_TOKEN;
const momentKey = process.env.STAGING_MOMENT_KEY ?? "stage14_smoke_moment";
const expectedEnvironment =
  process.env.EXPECTED_ENVIRONMENT ?? "staging";

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
  process.exit(1);
}

console.log(`${expectedEnvironment} health check: OK`);

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
  type: "stage14.smoke",
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

const offer = await request("/v1/offer", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${integrationToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    moment_key: momentKey,
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
