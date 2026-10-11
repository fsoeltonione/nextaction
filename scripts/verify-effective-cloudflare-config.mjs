import { readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

const REQUIRED_FLAG = "global_fetch_strictly_public";
const VALID_TARGETS = new Set(["staging", "production"]);
const NETWORK_OVERRIDE_KEY = /^(?:network|outbound|egress|vpc|tcp[_-]?sockets?)$/i;

function fail(message) {
  console.error(`[effective-cloudflare-config] FAIL: ${message}`);
  process.exit(1);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectNetworkOverrideKeys(value, path = "$", found = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectNetworkOverrideKeys(entry, `${path}[${index}]`, found));
    return found;
  }

  if (!isRecord(value)) return found;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (NETWORK_OVERRIDE_KEY.test(key)) found.push(childPath);
    collectNetworkOverrideKeys(child, childPath, found);
  }

  return found;
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

const target = process.argv[2];
if (!VALID_TARGETS.has(target)) {
  console.error(
    "[effective-cloudflare-config] Usage: node scripts/verify-effective-cloudflare-config.mjs staging|production [config-path]",
  );
  process.exit(2);
}

const configPath = resolve(process.argv[3] ?? "dist/server/wrangler.json");
let config;
try {
  config = JSON.parse(await readFile(configPath, "utf8"));
} catch (error) {
  fail(
    `Could not read valid generated Wrangler JSON at ${relative(process.cwd(), configPath)}: ${error instanceof Error ? error.message : "unknown read/parse error"}`,
  );
}

if (!isRecord(config)) fail("generated Wrangler configuration must be a JSON object");

const rootFlags = config.compatibility_flags;
if (!Array.isArray(rootFlags) || !rootFlags.every((flag) => typeof flag === "string")) {
  fail("generated config must declare compatibility_flags as an array of strings");
}
if (!rootFlags.includes(REQUIRED_FLAG)) {
  fail(`generated top-level compatibility_flags is missing required security flag: ${REQUIRED_FLAG}`);
}

if (!isValidDate(config.compatibility_date)) {
  fail("generated config must declare a valid YYYY-MM-DD compatibility_date");
}

const environment = isRecord(config.env) && isRecord(config.env[target])
  ? config.env[target]
  : null;
const hasEnvironmentFlagOverride =
  environment !== null &&
  Object.prototype.hasOwnProperty.call(environment, "compatibility_flags");

if (
  hasEnvironmentFlagOverride &&
  (!Array.isArray(environment.compatibility_flags) ||
    !environment.compatibility_flags.every((flag) => typeof flag === "string"))
) {
  fail(`env.${target}.compatibility_flags override must be an array of strings`);
}

const effectiveFlags = hasEnvironmentFlagOverride
  ? environment.compatibility_flags
  : rootFlags;

if (!effectiveFlags.includes(REQUIRED_FLAG)) {
  fail(
    `effective compatibility flags for ${target} omit required security flag ${REQUIRED_FLAG}; target environment overrides are checked as well as top-level defaults`,
  );
}

const networkOverrideKeys = collectNetworkOverrideKeys(config);
if (networkOverrideKeys.length > 0) {
  fail(
    `generated config contains network/outbound override keys requiring explicit security review: ${networkOverrideKeys.join(", ")}`,
  );
}

const report = {
  gate: "effective-cloudflare-runtime-config",
  result: "PASS",
  target,
  worker_name: environment?.name ?? config.name ?? "unknown",
  config_path: relative(process.cwd(), configPath),
  compatibility_date: config.compatibility_date,
  required_security_flag: REQUIRED_FLAG,
  root_compatibility_flags: rootFlags,
  target_environment_flags: hasEnvironmentFlagOverride
    ? environment.compatibility_flags
    : null,
  effective_compatibility_flags: effectiveFlags,
  flags_source: hasEnvironmentFlagOverride ? "target_environment_override" : "top_level_inherited",
  network_override_keys_found: networkOverrideKeys,
  secret_values_logged: false,
};
console.log(`[effective-cloudflare-config] ${JSON.stringify(report)}`);
