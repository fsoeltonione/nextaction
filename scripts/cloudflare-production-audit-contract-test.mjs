import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [audit, releaseWorkflow, auditOnlyWorkflow] = await Promise.all([
  readFile("scripts/cloudflare-production-audit.mjs", "utf8"),
  readFile(".github/workflows/release.yml", "utf8"),
  readFile(".github/workflows/cloudflare-production-audit.yml", "utf8"),
]);

// Cloudflare's API error payload must be visible enough to diagnose permissions
// and account-scope failures without printing the API token.
assert.match(audit, /const apiErrors = Array\.isArray\(body\?\.errors\)/);
assert.match(audit, /error\?\.code/);
assert.match(audit, /error\?\.message/);
assert.match(
  audit,
  /Cloudflare API failed for \${path} \(HTTP \${response\.status}\)\${details}/,
);

// Core safety assertions must remain required regardless of domain configuration.
assert.match(audit, /\/workers\/scripts\/\$\{encodeURIComponent\(workerName\)\}\/deployments/);
assert.match(audit, /\/workers\/scripts\/\$\{encodeURIComponent\(workerName\)\}\/secrets/);
assert.match(audit, /\/workers\/scripts\/\$\{encodeURIComponent\(workerName\)\}\/versions/);
assert.match(audit, /totalPercentage !== 100/);
assert.match(audit, /Number\(version\.percentage \?\? 0\) <= 0/);
assert.match(audit, /Required Cloudflare Worker secret binding is missing/);

// The public hostname is verified over HTTPS. workers.dev uses the app health
// endpoint; custom hostnames additionally require a Cloudflare Worker Domain mapping.
assert.match(audit, /const normalizedHostname = expectedHostname\.toLowerCase\(\)/);
assert.match(audit, /normalizedHostname\.endsWith\("\.workers\.dev"\)/);
assert.match(audit, /https:\/\/\$\{normalizedHostname\}\/api\/health/);
assert.match(audit, /healthBody\?\.service !== workerName/);
assert.match(audit, /healthBody\?\.environment !== environment/);
assert.match(
  audit,
  /if \(!isWorkersDevHostname\) \{[\s\S]*?const domainResponse = await cloudflareRequest\([\s\S]*?workers\/domains\?/,
);
assert.match(
  audit,
  /CLOUDFLARE_EXPECTED_HOSTNAME is not set; skipping public hostname verification\./,
);
assert.match(audit, /expected_hostname_checked: Boolean\(expectedHostname\)/);
assert.match(audit, /hostname_check: hostnameCheck/);
assert.match(
  releaseWorkflow,
  /CLOUDFLARE_EXPECTED_HOSTNAME:\s*\$\{\{\s*vars\.CLOUDFLARE_EXPECTED_HOSTNAME\s*\|\|\s*'nextaction\.fsoeltoni-one\.workers\.dev'\s*\}\}/,
  "Release Gate must default to the hostname verified in the production deploy log",
);
assert.match(
  auditOnlyWorkflow,
  /CLOUDFLARE_EXPECTED_HOSTNAME:\s*\$\{\{\s*vars\.CLOUDFLARE_EXPECTED_HOSTNAME\s*\|\|\s*'nextaction\.fsoeltoni-one\.workers\.dev'\s*\}\}/,
  "Read-only workflow must use the same known production hostname by default",
);

// A diagnostic rerun must not deploy production or pass through the approval gate.
assert.match(auditOnlyWorkflow, /on:\s*\n\s+workflow_dispatch:/);
assert.match(auditOnlyWorkflow, /npm run cloudflare:production-audit/);
assert.doesNotMatch(auditOnlyWorkflow, /npm run deploy:cloudflare|deploy_production|hold_production/);
assert.match(auditOnlyWorkflow, /CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}/);

console.log("Cloudflare production audit contract: OK");
