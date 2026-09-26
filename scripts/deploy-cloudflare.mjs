import { spawnSync } from "node:child_process";

const target = process.argv[2];

const targets = new Set(["staging", "production"]);
if (!target || !targets.has(target)) {
  console.error("Usage: npm run deploy:cloudflare -- staging|production");
  process.exit(2);
}

const required = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(
    `Missing required deployment environment variables: ${missing.join(", ")}`,
  );
  process.exit(2);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function run(command, args, input) {
  const result = spawnSync(command, args, {
    env: process.env,
    stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    input,
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`Deploying NextAction to Cloudflare environment: ${target}`);

run(process.execPath, ["scripts/cloudflare-vinext-build.mjs"]);

run(
  npx,
  [
    "--yes",
    "wrangler@4.139.0",
    "secret",
    "put",
    "SUPABASE_SECRET_KEY",
    "--env",
    target,
  ],
  process.env.SUPABASE_SECRET_KEY,
);

run(
  npx,
  [
    "--yes",
    "wrangler@4.139.0",
    "deploy",
    "--env",
    target,
    "--var",
    `NEXT_PUBLIC_SUPABASE_URL:${process.env.NEXT_PUBLIC_SUPABASE_URL}`,
    "--var",
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:${process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`,
  ],
);
