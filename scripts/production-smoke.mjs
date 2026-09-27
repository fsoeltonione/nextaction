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
    body: JSON.stringify(args),
  });
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
      "Production runtime smoke requires an existing authenticated user.",
    );
  }

  const result = await rpc("production_runtime_smoke", {
    p_user_id: userId,
  });

  const snapshot = Array.isArray(result) ? result[0] : result;

  if (
    snapshot?.track_created !== true ||
    snapshot.worker_processed !== 1 ||
    snapshot.worker_failed !== 0 ||
    snapshot.queue_message_enqueued !== true ||
    snapshot.queue_message_deleted !== true ||
    snapshot.moment_occurrence_created !== true ||
    snapshot.decision_outcome !== "filled" ||
    snapshot.delivery_created !== true ||
    snapshot.click_outcome !== "created" ||
    snapshot.qualification_status !== "qualified" ||
    snapshot.qualified_click_created !== true ||
    snapshot.settlement_outcome !== "settled" ||
    snapshot.settlement_replay_outcome !== "replayed" ||
    snapshot.settlement_charge_cents !== 100 ||
    snapshot.publisher_share_cents !== 75 ||
    snapshot.platform_share_cents !== 25 ||
    snapshot.currency !== "USD" ||
    snapshot.settlement_count !== 1 ||
    snapshot.financial_entry_count !== 3 ||
    snapshot.financial_debit_cents !== 100 ||
    snapshot.financial_credit_cents !== 100 ||
    snapshot.credit_available_units !== 0 ||
    snapshot.queue_messages_for_event !== 0
  ) {
    throw new Error("Production transactional runtime smoke returned an invalid result.");
  }

  console.log(
    JSON.stringify(
      {
        track_created: snapshot.track_created,
        worker_processed: snapshot.worker_processed,
        moment_occurrence_created: snapshot.moment_occurrence_created,
        decision_outcome: snapshot.decision_outcome,
        delivery_created: snapshot.delivery_created,
        click_outcome: snapshot.click_outcome,
        qualification_status: snapshot.qualification_status,
        settlement_outcome: snapshot.settlement_outcome,
        settlement_replay_outcome: snapshot.settlement_replay_outcome,
        settlement_charge_cents: snapshot.settlement_charge_cents,
        publisher_share_cents: snapshot.publisher_share_cents,
        platform_share_cents: snapshot.platform_share_cents,
        financial_entry_count: snapshot.financial_entry_count,
        queue_messages_for_event: snapshot.queue_messages_for_event,
      },
      null,
      2,
    ),
  );

  console.log("Production Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement: OK");
  console.log("Production runtime smoke is transactional; no fixture rows persist.");
  console.log("Production runtime smoke: PASS");
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Production runtime smoke failed.",
  );
  process.exitCode = 1;
}
