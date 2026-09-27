import { createHash, randomUUID } from "node:crypto";

const baseUrl = process.env.PRODUCTION_BASE_URL;
const supabaseUrl = process.env.PRODUCTION_NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecretKey = process.env.PRODUCTION_SUPABASE_SECRET_KEY;

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

if (applicationUrl.protocol !== "https:" || databaseUrl.protocol !== "https:") {
  console.error("Production smoke endpoints must use HTTPS.");
  process.exit(2);
}

const smokeId = randomUUID().replaceAll("-", "");
const integrationToken = `na_prod_smoke_${smokeId}`;
const credentialHash = createHash("sha256")
  .update(integrationToken, "utf8")
  .digest("hex");
const momentKey = `production_smoke_${smokeId.slice(0, 24)}`;
const destinationUrl =
  `https://example.com/?nextaction_production_smoke=${smokeId}`;

let fixtureCreated = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function appRequest(path, options = {}) {
  return fetch(new URL(path, applicationUrl), {
    redirect: "manual",
    ...options,
    headers: {
      "cache-control": "no-store",
      ...(options.headers ?? {}),
    },
  });
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(new URL(path, databaseUrl), {
    ...options,
    headers: {
      apikey: supabaseSecretKey,
      Authorization: `Bearer ${supabaseSecretKey}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(
        `Supabase returned non-JSON for ${path} (HTTP ${response.status})`,
      );
    }
  }

  if (!response.ok) {
    throw new Error(`Supabase request failed: HTTP ${response.status} ${path}`);
  }

  return body;
}

async function rpc(functionName, args) {
  return supabaseRequest(`/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      Prefer: "return=representation",
    },
    body: JSON.stringify(args),
  });
}

async function waitFor(fn, timeoutMs, intervalMs, description) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${description}`);
}

try {
  console.log("Production runtime smoke: starting.");

  const health = await appRequest("/api/health");
  if (health.status !== 200) {
    throw new Error(`Production health expected HTTP 200, got ${health.status}`);
  }

  const healthBody = await health.json();
  if (
    healthBody?.status !== "ok" ||
    healthBody?.service !== "nextaction" ||
    healthBody?.environment !== "production"
  ) {
    throw new Error("Production health returned unexpected deployment identity.");
  }

  console.log("Production health: OK");

  const analyze = await appRequest("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: "https://example.com" }),
  });

  if (analyze.status !== 200) {
    throw new Error(
      `Production product analysis expected HTTP 200, got ${analyze.status}`,
    );
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
    throw new Error("Production product analysis returned an invalid analysis shape.");
  }

  console.log("Production analysis → scanner/provider path: OK");

  const members = await supabaseRequest(
    "/rest/v1/workspace_members?select=user_id&order=created_at.asc&limit=1",
  );
  const userId = Array.isArray(members) ? members[0]?.user_id : null;

  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error(
      "Production smoke requires an existing authenticated user for the isolated fixture.",
    );
  }

  const created = await rpc("production_smoke_fixture_create", {
    p_smoke_id: smokeId,
    p_user_id: userId,
    p_credential_hash: credentialHash,
    p_destination_url: destinationUrl,
  });

  const fixture = Array.isArray(created) ? created[0] : created;
  if (
    !fixture?.publisher_workspace_id ||
    !fixture?.advertiser_workspace_id ||
    !fixture?.product_id ||
    !fixture?.moment_id ||
    !fixture?.integration_id ||
    !fixture?.offer_id ||
    fixture.moment_key !== momentKey
  ) {
    throw new Error("Production smoke fixture creation returned an invalid result.");
  }

  fixtureCreated = true;
  console.log("Production smoke fixture: OK");

  const idempotencyKey = `production-smoke-${smokeId}`;
  const trackBody = JSON.stringify({
    type: momentKey,
    occurred_at: new Date().toISOString(),
    data: {
      smoke_id: smokeId,
      purpose: "production-runtime-smoke",
    },
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
    throw new Error(`Production track expected HTTP 202, got ${track.status}`);
  }

  const trackBodyJson = await track.json();
  if (!trackBodyJson?.accepted || !trackBodyJson?.event_id) {
    throw new Error("Production track returned an invalid acceptance response.");
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
    throw new Error(
      `Production track replay expected HTTP 202, got ${trackReplay.status}`,
    );
  }

  const trackReplayBody = await trackReplay.json();
  if (
    !trackReplayBody?.idempotent_replay ||
    trackReplayBody.event_id !== trackBodyJson.event_id
  ) {
    throw new Error("Production track replay did not return the original Event.");
  }

  console.log("Production Event acceptance + idempotency: OK");

  const offer = await waitFor(
    async () => {
      const response = await appRequest("/v1/offer", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${integrationToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          moment_key: momentKey,
          context: {
            source: "production-smoke",
            smoke_id: smokeId,
          },
        }),
      });

      if (response.status !== 200) return null;

      const body = await response.json();
      return typeof body?.delivery?.token === "string" ? body : null;
    },
    90_000,
    2_000,
    "Decision → Delivery",
  );

  const deliveryToken = offer.delivery.token;
  console.log("Production Decision → Delivery: OK");

  const clickPath = `/v1/click/${encodeURIComponent(deliveryToken)}`;
  const firstClick = await appRequest(clickPath);

  if (firstClick.status !== 302) {
    throw new Error(
      `Production first click expected HTTP 302, got ${firstClick.status}`,
    );
  }

  const location = firstClick.headers.get("location");
  if (location !== destinationUrl) {
    throw new Error("Production first click returned the wrong destination.");
  }

  const replayClick = await appRequest(clickPath);
  if (replayClick.status !== 302) {
    throw new Error(
      `Production replay click expected HTTP 302, got ${replayClick.status}`,
    );
  }

  if (replayClick.headers.get("location") !== location) {
    throw new Error("Production replay click changed its redirect destination.");
  }

  console.log("Production Click + replay redirect: OK");

  const verified = await waitFor(
    async () => {
      const result = await rpc("production_smoke_fixture_verify", {
        p_smoke_id: smokeId,
      });
      const snapshot = Array.isArray(result) ? result[0] : result;

      if (!snapshot) return null;

      const checks = {
        workspaces: snapshot.workspaces === 2,
        products: snapshot.products === 1,
        moments: snapshot.moments === 1,
        integrations: snapshot.integrations === 1,
        offers: snapshot.offers === 1,
        events: snapshot.events === 1,
        processed_events: snapshot.processed_events === 1,
        moment_occurrences: snapshot.moment_occurrences === 1,
        decisions: snapshot.decisions >= 1,
        deliveries: snapshot.deliveries === 1,
        clicks: snapshot.clicks === 1,
        qualified_clicks: snapshot.qualified_clicks === 1,
        settlements: snapshot.settlements === 1,
        financial_entries: snapshot.financial_entries === 3,
        queue_messages_for_event: snapshot.queue_messages_for_event === 0,
        split_mismatch: snapshot.split_mismatch === 0,
        ledger_mismatch: snapshot.ledger_mismatch === 0,
        credit_available_units: snapshot.credit_available_units === 0,
      };

      return Object.values(checks).every(Boolean) ? snapshot : null;
    },
    90_000,
    2_000,
    "production runtime chain verification",
  );

  console.log(
    JSON.stringify(
      {
        events: verified.events,
        processed_events: verified.processed_events,
        moment_occurrences: verified.moment_occurrences,
        decisions: verified.decisions,
        deliveries: verified.deliveries,
        clicks: verified.clicks,
        qualified_clicks: verified.qualified_clicks,
        settlements: verified.settlements,
        financial_entries: verified.financial_entries,
        split_mismatch: verified.split_mismatch,
        ledger_mismatch: verified.ledger_mismatch,
      },
      null,
      2,
    ),
  );

  console.log("Production Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement: OK");
  console.log("Production runtime smoke: PASS");
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Production runtime smoke failed.",
  );
  process.exitCode = 1;
} finally {
  const cleanup = await rpc("production_smoke_fixture_cleanup", {
    p_smoke_id: smokeId,
  }).catch((error) => {
    console.error(
      error instanceof Error
        ? `Production smoke cleanup failed: ${error.message}`
        : "Production smoke cleanup failed.",
    );
    return null;
  });

  if (cleanup) {
    const snapshot = Array.isArray(cleanup) ? cleanup[0] : cleanup;
    if (snapshot?.remaining_workspaces !== 0) {
      console.error("Production smoke cleanup left temporary workspace data behind.");
      process.exitCode = 1;
    } else {
      console.log("Production smoke cleanup: OK");
    }
  }

  void fixtureCreated;
}
