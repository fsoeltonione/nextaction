const baseUrl = process.env.STAGING_BASE_URL;
const deliveryToken = process.env.STAGING_DELIVERY_TOKEN;

if (!baseUrl) {
  console.error("Missing STAGING_BASE_URL.");
  process.exit(2);
}

const url = new URL(baseUrl);
if (url.protocol !== "https:") {
  console.error("STAGING_BASE_URL must use HTTPS.");
  process.exit(2);
}

async function get(path, options = {}) {
  const response = await fetch(new URL(path, url), {
    redirect: "manual",
    ...options,
  });

  return response;
}

const health = await get("/api/health");
if (health.status !== 200) {
  console.error(`Health check failed: HTTP ${health.status}`);
  process.exit(1);
}

const healthBody = await health.json();
if (
  healthBody?.status !== "ok" ||
  healthBody?.service !== "nextaction" ||
  healthBody?.environment !== "staging"
) {
  console.error("Health check returned an unexpected deployment identity.");
  process.exit(1);
}

console.log("Staging health check: OK");

if (!deliveryToken) {
  console.log(
    "No STAGING_DELIVERY_TOKEN configured; runtime click smoke was not executed.",
  );
  process.exit(0);
}

const clickPath = `/v1/click/${encodeURIComponent(deliveryToken)}`;
const first = await get(clickPath);
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

const replay = await get(clickPath);
if (replay.status !== 302) {
  console.error(`Replay click smoke expected HTTP 302, got ${replay.status}`);
  process.exit(1);
}

const replayLocation = replay.headers.get("location");
if (replayLocation !== location) {
  console.error("Replay click smoke changed the redirect destination.");
  process.exit(1);
}

console.log("Staging click smoke: first click + replay OK");
