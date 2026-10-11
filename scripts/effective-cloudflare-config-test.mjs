import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT = fileURLToPath(
  new URL("./verify-effective-cloudflare-config.mjs", import.meta.url),
);
const REQUIRED_FLAG = "global_fetch_strictly_public";

function validConfig(overrides = {}) {
  return {
    name: "nextaction",
    compatibility_date: "2026-09-25",
    compatibility_flags: [
      "nodejs_compat",
      "nodejs_compat_populate_process_env",
      REQUIRED_FLAG,
    ],
    env: {
      staging: { name: "nextaction-staging" },
      production: { name: "nextaction" },
    },
    ...overrides,
  };
}

async function runGate(config, target = "staging") {
  const directory = await mkdtemp(join(tmpdir(), "nextaction-effective-config-"));
  const configPath = join(directory, "wrangler.json");

  try {
    await writeFile(
      configPath,
      typeof config === "string" ? config : JSON.stringify(config),
      "utf8",
    );
    return spawnSync(
      process.execPath,
      [SCRIPT, target, configPath],
      { encoding: "utf8" },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("passes when the generated config inherits the required public-fetch flag", async () => {
  const result = await runGate(validConfig());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"result":"PASS"/);
  assert.match(result.stdout, /"target":"staging"/);
  assert.match(result.stdout, /"worker_name":"nextaction-staging"/);
  assert.match(result.stdout, /"compatibility_date":"2026-09-25"/);
  assert.match(result.stdout, /"flags_source":"top_level_inherited"/);
  assert.match(result.stdout, new RegExp(REQUIRED_FLAG));
  assert.doesNotMatch(result.stdout, /SUPABASE|API_KEY|publishable/i);
});

test("fails closed when the generated top-level config drops the required flag", async () => {
  const config = validConfig({
    compatibility_flags: ["nodejs_compat"],
  });
  const result = await runGate(config);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /top-level compatibility_flags is missing/);
});

test("fails when the staging environment overrides flags without the required flag", async () => {
  const config = validConfig();
  config.env.staging.compatibility_flags = ["nodejs_compat"];
  const result = await runGate(config);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /effective compatibility flags for staging omit/);
});

test("passes and records an explicit environment override that retains the required flag", async () => {
  const config = validConfig();
  config.env.staging.compatibility_flags = ["nodejs_compat", REQUIRED_FLAG];
  const result = await runGate(config);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"flags_source":"target_environment_override"/);
  assert.match(result.stdout, /"target_environment_flags":\["nodejs_compat","global_fetch_strictly_public"\]/);
});

test("fails for an invalid compatibility date", async () => {
  const result = await runGate(validConfig({ compatibility_date: "2026-02-31" }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /valid YYYY-MM-DD compatibility_date/);
});

test("fails closed when generated config introduces an outbound/network override", async () => {
  const config = validConfig({ outbound: { worker: "unexpected" } });
  const result = await runGate(config);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /network\/outbound override keys requiring explicit security review/);
});

test("fails on malformed generated JSON", async () => {
  const result = await runGate("{ definitely not json");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Could not read valid generated Wrangler JSON/);
});

test("rejects unsupported deployment targets", async () => {
  const result = await runGate(validConfig(), "preview");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /staging\|production/);
});
