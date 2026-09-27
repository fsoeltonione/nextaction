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
    throw new Error(
      `Cloudflare API failed for ${path} (HTTP ${response.status})`,
    );
  }

  return body.result;
}

const deployments = await cloudflareRequest(
  `/workers/scripts/${encodeURIComponent(workerName)}/deployments`,
);

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

const latestVersions = await cloudflareRequest(
  `/workers/scripts/${encodeURIComponent(workerName)}/versions?per_page=5`,
);

if (!Array.isArray(latestVersions) || latestVersions.length === 0) {
  throw new Error(`No Worker versions found for ${workerName}.`);
}

if (!latestVersions.some((version) => version.id === latestVersionId)) {
  throw new Error("Latest active deployment version is not present in the Worker version list.");
}

const domainParams = new URLSearchParams({
  service: workerName,
  environment,
  per_page: "100",
});

const domains = await cloudflareRequest(
  `/workers/domains?${domainParams.toString()}`,
);

if (expectedHostname) {
  const matching = Array.isArray(domains)
    ? domains.filter((domain) => domain.hostname === expectedHostname)
    : [];

  if (matching.length === 0) {
    throw new Error(
      `Expected Cloudflare Worker hostname was not found: ${expectedHostname}`,
    );
  }
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
      worker_domains: Array.isArray(domains)
        ? domains.map((domain) => ({
            hostname: domain.hostname,
            environment: domain.environment,
            service: domain.service,
          }))
        : [],
      secret_bindings_checked: [
        "SUPABASE_SECRET_KEY",
        "ANALYSIS_API_KEY",
      ],
      expected_hostname_checked: Boolean(expectedHostname),
    },
    null,
    2,
  ),
);

console.log("Cloudflare production deployment audit: PASS");
