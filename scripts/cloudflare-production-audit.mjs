const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const workerName = process.env.CLOUDFLARE_WORKER_NAME ?? "nextaction";
const environment = process.env.CLOUDFLARE_ENVIRONMENT ?? "production";
const expectedHostname = process.env.CLOUDFLARE_EXPECTED_HOSTNAME?.trim();

if (!accountId || !apiToken) {
  console.error("Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN.");
  process.exit(2);
}

async function cloudflareRequest(path) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
      },
    },
  );

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `Cloudflare API returned non-JSON for ${path} (HTTP ${response.status})`,
    );
  }

  if (!response.ok || body?.success !== true) {
    const apiErrors = Array.isArray(body?.errors)
      ? body.errors
          .map((error) => {
            const code =
              typeof error?.code === "number" || typeof error?.code === "string"
                ? String(error.code)
                : "unknown";
            const message =
              typeof error?.message === "string"
                ? error.message
                : "Unknown Cloudflare API error";
            return `${code}: ${message}`;
          })
          .join("; ")
      : "";
    const details = apiErrors ? `: ${apiErrors}` : "";
    throw new Error(
      `Cloudflare API failed for ${path} (HTTP ${response.status})${details}`,
    );
  }

  return body.result;
}

const deploymentResponse = await cloudflareRequest(
  `/workers/scripts/${encodeURIComponent(workerName)}/deployments?per_page=5`,
);
const deployments = Array.isArray(deploymentResponse)
  ? deploymentResponse
  : deploymentResponse?.deployments;

if (!Array.isArray(deployments) || deployments.length === 0) {
  throw new Error(`No active deployments found for Worker ${workerName}.`);
}

const latestDeployment = deployments[0];
const versions = latestDeployment?.versions;

if (!Array.isArray(versions) || versions.length === 0) {
  throw new Error("Latest Worker deployment has no active versions.");
}

const totalPercentage = versions.reduce(
  (sum, version) => sum + Number(version.percentage ?? 0),
  0,
);

if (totalPercentage !== 100) {
  throw new Error(
    `Latest Worker deployment traffic does not total 100% (got ${totalPercentage}).`,
  );
}

if (versions.some((version) => Number(version.percentage ?? 0) <= 0)) {
  throw new Error("Latest Worker deployment contains a non-positive traffic allocation.");
}

const latestVersionId = versions[0].version_id;
if (typeof latestVersionId !== "string" || latestVersionId.length === 0) {
  throw new Error("Latest Worker deployment did not expose a version id.");
}

const secretBindings = await cloudflareRequest(
  `/workers/scripts/${encodeURIComponent(workerName)}/secrets`,
);

if (!Array.isArray(secretBindings)) {
  throw new Error(`Cloudflare returned an invalid secret-binding list for ${workerName}.`);
}

const secretNames = new Set(
  secretBindings
    .filter((binding) => binding && typeof binding.name === "string")
    .map((binding) => binding.name),
);

for (const requiredSecret of ["SUPABASE_SECRET_KEY", "ANALYSIS_API_KEY"]) {
  if (!secretNames.has(requiredSecret)) {
    throw new Error(
      `Required Cloudflare Worker secret binding is missing: ${requiredSecret}`,
    );
  }
}

const latestVersionResponse = await cloudflareRequest(
  `/workers/scripts/${encodeURIComponent(workerName)}/versions?per_page=5`,
);
const latestVersions = Array.isArray(latestVersionResponse)
  ? latestVersionResponse
  : latestVersionResponse?.items;

if (!Array.isArray(latestVersions) || latestVersions.length === 0) {
  throw new Error(`No Worker versions found for ${workerName}.`);
}

if (!latestVersions.some((version) => version.id === latestVersionId)) {
  throw new Error("Latest active deployment version is not present in the Worker version list.");
}

// Always verify the configured public hostname over HTTPS. Cloudflare's Worker
// Domains API is for custom hostnames, so workers.dev hosts are checked through the
// deployed app's health endpoint instead of being incorrectly looked up as custom domains.
let domains = [];
let hostnameCheck = null;
if (expectedHostname) {
  const normalizedHostname = expectedHostname.toLowerCase();
  if (
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$/.test(
      normalizedHostname,
    )
  ) {
    throw new Error("CLOUDFLARE_EXPECTED_HOSTNAME must be a hostname without a scheme, path, or port.");
  }

  const healthResponse = await fetch(
    `https://${normalizedHostname}/api/health`,
    {
      headers: {
        Accept: "application/json",
        "cache-control": "no-store",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!healthResponse.ok) {
    throw new Error(
      `Expected production hostname health check failed for ${normalizedHostname} (HTTP ${healthResponse.status}).`,
    );
  }

  let healthBody;
  try {
    healthBody = await healthResponse.json();
  } catch {
    throw new Error(
      `Expected production hostname returned non-JSON health data: ${normalizedHostname}.`,
    );
  }

  if (
    healthBody?.status !== "ok" ||
    healthBody?.service !== workerName ||
    healthBody?.environment !== environment
  ) {
    throw new Error(
      `Expected production hostname returned the wrong service or environment: ${normalizedHostname}.`,
    );
  }

  const isWorkersDevHostname = normalizedHostname.endsWith(".workers.dev");
  hostnameCheck = {
    hostname: normalizedHostname,
    mode: isWorkersDevHostname ? "workers_dev_health_endpoint" : "custom_worker_domain",
    http_status: healthResponse.status,
    service: healthBody.service,
    environment: healthBody.environment,
  };

  if (!isWorkersDevHostname) {
    const domainParams = new URLSearchParams({
      service: workerName,
      environment,
      hostname: normalizedHostname,
      per_page: "100",
    });

    const domainResponse = await cloudflareRequest(
      `/workers/domains?${domainParams.toString()}`,
    );
    domains = Array.isArray(domainResponse) ? domainResponse : [];

    const matching = domains.filter(
      (domain) =>
        typeof domain.hostname === "string" &&
        domain.hostname.toLowerCase() === normalizedHostname &&
        domain.service === workerName &&
        (!domain.environment || domain.environment === environment),
    );

    if (matching.length === 0) {
      throw new Error(
        `Expected Cloudflare Worker custom hostname was not found for ${workerName} (${environment}): ${normalizedHostname}`,
      );
    }

    hostnameCheck.custom_domain_api_verified = true;
  }
} else {
  console.log(
    "CLOUDFLARE_EXPECTED_HOSTNAME is not set; skipping public hostname verification.",
  );
}

console.log(
  JSON.stringify(
    {
      worker: workerName,
      environment,
      latest_deployment_id: latestDeployment.id,
      latest_version_id: latestVersionId,
      traffic_percentages: versions.map((version) => ({
        version_id: version.version_id,
        percentage: version.percentage,
      })),
      worker_domains: domains.map((domain) => ({
        hostname: domain.hostname,
        environment: domain.environment,
        service: domain.service,
      })),
      secret_bindings_checked: [
        "SUPABASE_SECRET_KEY",
        "ANALYSIS_API_KEY",
      ],
      expected_hostname_checked: Boolean(expectedHostname),
      hostname_check: hostnameCheck,
    },
    null,
    2,
  ),
);

console.log("Cloudflare production deployment audit: PASS");
