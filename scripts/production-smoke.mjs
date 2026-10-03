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

async function verifyFixture(integrationId, eventId) {
  const state = await rpc("production_smoke_fixture_verify", {
    p_integration_id: integrationId,
    p_event_id: eventId,
  });
  return Array.isArray(state) ? state[0] : state;
}

async function waitForEventProcessing(integrationId, eventId, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await verifyFixture(integrationId, eventId);
    if (
      snapshot?.event_found === true &&
      snapshot?.occurrence_found === true &&
      snapshot?.queue_messages_for_event === 0
    ) {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Timed out waiting for Event → Moment processing.");
}

async function waitForSettlement(integrationId, eventId, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await verifyFixture(integrationId, eventId);
    if (
      snapshot?.settlement_count === 1 &&
      snapshot?.financial_entry_count === 3
    ) {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Timed out waiting for settlement verification.");
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
  const crypto = globalThis.crypto;
  const smokeId = crypto.randomUUID().replace(/-/g, "");
  const deliveryToken = `na_prod_smoke_${smokeId}`;
  const credentialHashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(deliveryToken),
  );
  const credentialHash = Array.from(
    new Uint8Array(credentialHashBuffer),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

  const fixtureResult = await rpc("production_smoke_fixture_create", {
    p_smoke_id: smokeId,
    p_user_id: userId,
    p_credential_hash: credentialHash,
  });
  const fixture = Array.isArray(fixtureResult)
    ? fixtureResult[0]
    : fixtureResult;

  if (
    !fixture ||
    typeof fixture.result_integration_id !== "string" ||
    typeof fixture.result_moment_key !== "string" ||
    typeof fixture.result_expected_available_units_after_settlement !== "number"
  ) {
    throw new Error("Production smoke fixture provisioning failed.");
  }

  const integrationToken = deliveryToken;
  const idempotencyKey = `prod-smoke-${smokeId}`;
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
  if (track.status !== 202) {
    throw new Error(`Track failed: HTTP ${track.status}`);
  }

  const trackBodyJson = await track.json();
  if (
    trackBodyJson?.accepted !== true ||
    typeof trackBodyJson.event_id !== "string"
  ) {
    throw new Error("Track returned an invalid acceptance response.");
  }

  const trackReplay = await appRequest("/v1/track", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${integrationToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: trackBody,
  });
  if (trackReplay.status !== 202) {
    throw new Error(`Track replay failed: HTTP ${trackReplay.status}`);
  }

  const trackReplayBody = await trackReplay.json();
  if (
    trackReplayBody?.idempotent_replay !== true ||
    trackReplayBody.event_id !== trackBodyJson.event_id
  ) {
    throw new Error("Track replay did not return the original event.");
  }

  console.log("Event ingestion + idempotency HTTP smoke: OK");

  const processed = await waitForEventProcessing(
    fixture.result_integration_id,
    trackBodyJson.event_id,
  );
  if (
    processed?.event_found !== true ||
    processed?.occurrence_found !== true ||
    processed?.queue_messages_for_event !== 0
  ) {
    throw new Error("Event → Moment processing invariant failed.");
  }
  console.log("Event → Moment processing HTTP smoke: OK");

  const offer = await appRequest("/v1/offer", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${integrationToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      moment_key: fixture.result_moment_key,
      context: { source: "production-smoke" },
    }),
  });
  if (offer.status !== 200) {
    throw new Error(`Offer failed: HTTP ${offer.status}`);
  }

  const offerBody = await offer.json();
  const deliveryTokenFromOffer = offerBody?.delivery?.token;
  if (
    typeof deliveryTokenFromOffer !== "string" ||
    deliveryTokenFromOffer.length < 20
  ) {
    throw new Error("Offer returned no valid delivery token.");
  }
  console.log("Decision → Delivery HTTP smoke: OK");

  const clickPath = `/v1/click/${encodeURIComponent(deliveryTokenFromOffer)}`;
  const clickFirst = await appRequest(clickPath);
  if (clickFirst.status !== 302) {
    throw new Error(`Click first expected HTTP 302, got ${clickFirst.status}`);
  }

  const firstLocation = clickFirst.headers.get("location");
  if (!firstLocation) {
    throw new Error("First click did not return a Location header.");
  }
  const destination = new URL(firstLocation);
  if (destination.protocol !== "http:" && destination.protocol !== "https:") {
    throw new Error("First click returned a non-HTTP destination.");
  }

  const settlement = await waitForSettlement(
    fixture.result_integration_id,
    trackBodyJson.event_id,
  );
  if (
    settlement.settlement_count !== 1 ||
    settlement.financial_entry_count !== 3 ||
    settlement.settlement_charge_cents !== 100 ||
    settlement.publisher_share_cents !== 75 ||
    settlement.platform_share_cents !== 25 ||
    settlement.currency !== "USD" ||
    settlement.financial_debit_cents !== 100 ||
    settlement.financial_credit_cents !== 100 ||
    settlement.credit_available_units !==
      fixture.result_expected_available_units_after_settlement
  ) {
    throw new Error("Production economic settlement invariants failed.");
  }

  const clickReplay = await appRequest(clickPath);
  if (clickReplay.status !== 302) {
    throw new Error(`Click replay expected HTTP 302, got ${clickReplay.status}`);
  }

  const replayLocation = clickReplay.headers.get("location");
  if (replayLocation !== firstLocation) {
    throw new Error("Click replay changed the redirect destination.");
  }

  const replaySnapshot = await verifyFixture(
    fixture.result_integration_id,
    trackBodyJson.event_id,
  );
  if (
    replaySnapshot?.settlement_count !== 1 ||
    replaySnapshot?.financial_entry_count !== 3
  ) {
    throw new Error("Click replay created duplicate economic entries.");
  }

  console.log("Click → Qualified Click → Settlement + replay economic smoke: OK");
  console.log(JSON.stringify({
    event_found: settlement.event_found,
    occurrence_found: settlement.occurrence_found,
    queue_messages_for_event: settlement.queue_messages_for_event,
    decision_count: settlement.decision_count,
    delivery_count: settlement.delivery_count,
    click_count: settlement.click_count,
    qualified_click_count: settlement.qualified_click_count,
    settlement_count: settlement.settlement_count,
    financial_entry_count: settlement.financial_entry_count,
    settlement_charge_cents: settlement.settlement_charge_cents,
    publisher_share_cents: settlement.publisher_share_cents,
    platform_share_cents: settlement.platform_share_cents,
    credit_available_units: settlement.credit_available_units,
  }, null, 2));

  console.log(
    "Production Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement: OK",
  );
  console.log(
    "Production smoke uses a dedicated persistent canary because financial history is immutable.",
  );
  console.log("Production runtime smoke: PASS");
} catch (error) {
  console.error("Production smoke failed:");
  console.error(error);
  process.exit(1);
}
