const baseUrl = process.env.PRODUCTION_BASE_URL;
const supabaseUrl = process.env.PRODUCTION_NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecretKey = process.env.PRODUCTION_SUPABASE_SECRET_KEY;
const expectedReleaseSha =
  process.env.PRODUCTION_EXPECTED_RELEASE_SHA ?? process.env.CIRCLE_SHA1;

const missing = [
  ["PRODUCTION_BASE_URL", baseUrl],
  ["PRODUCTION_NEXT_PUBLIC_SUPABASE_URL", supabaseUrl],
  ["PRODUCTION_SUPABASE_SECRET_KEY", supabaseSecretKey],
  ["PRODUCTION_EXPECTED_RELEASE_SHA", expectedReleaseSha],
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length > 0) {
  console.error(
    `Missing required production release proof environment variables: ${missing.join(", ")}`,
  );
  process.exit(2);
}

if (!/^[0-9a-f]{40}$/i.test(expectedReleaseSha)) {
  console.error("PRODUCTION_EXPECTED_RELEASE_SHA must be a valid 40-character Git SHA.");
  process.exit(2);
}

const applicationUrl = new URL(baseUrl);
const databaseUrl = new URL(supabaseUrl);

if (applicationUrl.protocol !== "https:" || databaseUrl.protocol !== "https:") {
  console.error("Production release proof targets must use HTTPS.");
  process.exit(2);
}

async function appRequest(path) {
  return fetch(new URL(path, applicationUrl), {
    redirect: "manual",
    headers: {
      "cache-control": "no-store",
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

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Supabase request failed: HTTP ${response.status} ${response.statusText}\n${responseText}`,
    );
  }

  return response.json();
}

async function rpc(name, body = {}) {
  return supabaseRequest(`/rest/v1/rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

try {
  const health = await appRequest("/api/health");
  if (health.status !== 200) {
    throw new Error(`Production release proof health check failed: HTTP ${health.status}`);
  }

  const healthBody = await health.json();
  if (
    healthBody?.status !== "ok" ||
    healthBody?.service !== "nextaction" ||
    healthBody?.environment !== "production" ||
    healthBody?.release_sha !== expectedReleaseSha
  ) {
    throw new Error(
      `Production release provenance mismatch: ${JSON.stringify({
        expected_release_sha: expectedReleaseSha,
        health_body: healthBody,
      })}`,
    );
  }

  console.log("Production release provenance: OK");

  const proofResult = await rpc("runtime_release_proof");
  const proof = Array.isArray(proofResult) ? proofResult[0] : proofResult;

  if (!proof || proof.status !== "ready") {
    throw new Error(
      `Production runtime release proof failed: ${JSON.stringify(proof)}`,
    );
  }

  const readiness = proof.readiness;
  const integrity = proof.integrity;
  const lifecycle = proof.runtime_lifecycle;
  const migrations = proof.required_migrations;

  if (
    readiness?.status !== "ready" ||
    readiness?.queue?.exists !== true ||
    readiness?.queue?.count !== 0 ||
    readiness?.worker?.function_exists !== true ||
    readiness?.worker?.schedule_active !== true ||
    readiness?.worker?.recent_success !== true ||
    readiness?.operations?.schedule_active !== true ||
    readiness?.operations?.recent_success !== true
  ) {
    throw new Error(
      `Production readiness proof failed: ${JSON.stringify(readiness)}`,
    );
  }

  if (
    integrity?.status !== "ok" ||
    integrity?.anomaly_count !== 0
  ) {
    throw new Error(
      `Production integrity proof failed: ${JSON.stringify(integrity)}`,
    );
  }

  if (
    lifecycle?.dead_letter_count !== 0 ||
    lifecycle?.stale_rate_limit_bucket_count !== 0
  ) {
    throw new Error(
      `Production runtime lifecycle proof failed: ${JSON.stringify(lifecycle)}`,
    );
  }

  if (
    migrations?.h2_1_runtime_failure_containment !== true ||
    migrations?.h2_2_recovery_operations !== true ||
    migrations?.h2_2_runtime_ops_hardening !== true ||
    migrations?.h2_3_release_reliability_proof !== true
  ) {
    throw new Error(
      `Production migration proof failed: ${JSON.stringify(migrations)}`,
    );
  }

  console.log("Production runtime readiness: OK");
  console.log("Production runtime integrity: OK");
  console.log("Production runtime lifecycle: OK");
  console.log("Production hardening migration presence: OK");
  console.log(
    JSON.stringify(
      {
        status: proof.status,
        release_sha: expectedReleaseSha,
        checked_at: proof.checked_at,
        worker_last_run: readiness.worker.last_run_started_at,
        operations_last_run: readiness.operations.last_run_started_at,
        queue_count: readiness.queue.count,
        dead_letter_count: lifecycle.dead_letter_count,
        stale_rate_limit_bucket_count: lifecycle.stale_rate_limit_bucket_count,
        integrity_anomaly_count: integrity.anomaly_count,
      },
      null,
      2,
    ),
  );
  console.log("Production release proof: PASS");
} catch (error) {
  console.error("Production release proof failed:");
  console.error(error);
  process.exit(1);
}
