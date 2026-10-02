import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const target = process.argv[2];

const targets = new Set(["staging", "production"]);
if (!target || !targets.has(target)) {
  console.error("Usage: npm run deploy:cloudflare -- staging|production");
  process.exit(2);
}

if (
  target === "production" &&
  process.env.CIRCLECI === "true" &&
  process.env.NEXTACTION_RELEASE_BRANCH !== "master"
) {
  console.error(
    "Production Cloudflare deployment is permitted from master only.",
  );
  process.exit(2);
}

const required = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "ANALYSIS_API_KEY",
  "ANALYSIS_BASE_URL",
  "ANALYSIS_MODEL",
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(
    `Missing required deployment environment variables: ${missing.join(", ")}`,
  );
  process.exit(2);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function run(command, args) {
  const result = spawnSync(command, args, {
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const code = result.status ?? 1;
    throw new Error(`Command failed with exit code ${code}`);
  }
}

process.env.NEXT_PUBLIC_APP_ENV = target;
process.env.CLOUDFLARE_ENV = target;
console.log(`Deploying NextAction to Cloudflare environment: ${target}`);
console.log(`Cloudflare Vite environment: ${process.env.CLOUDFLARE_ENV}`);

run(process.execPath, ["scripts/cloudflare-vinext-build.mjs"]);

const secretDir = mkdtempSync(join(tmpdir(), "nextaction-secrets-"));
const secretFile = join(secretDir, "secrets.json");

writeFileSync(
  secretFile,
  JSON.stringify(
    {
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      ANALYSIS_API_KEY: process.env.ANALYSIS_API_KEY,
    },
    null,
    2,
  ),
  { encoding: "utf8", mode: 0o600 },
);

try {
  run(npx, [
    "--yes",
    "wrangler@4.139.0",
    "deploy",
    "--env",
    target,
    "--secrets-file",
    secretFile,
    "--var",
    "ANALYSIS_BASE_URL:" + process.env.ANALYSIS_BASE_URL,
    "--var",
    "ANALYSIS_MODEL:" + process.env.ANALYSIS_MODEL,
  ]);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Cloudflare deployment failed.",
  );
  process.exit(1);
} finally {
  rmSync(secretDir, { recursive: true, force: true });
}
