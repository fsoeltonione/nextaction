import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const configUrl = new URL("../wrangler.jsonc", import.meta.url);
const config = JSON.parse(await readFile(configUrl, "utf8"));

assert.ok(
  config.compatibility_flags.includes("global_fetch_strictly_public"),
  "Global fetch must be restricted to the public-Internet route to close the Worker-zone-origin exception.",
);
assert.ok(
  !config.compatibility_flags.includes("global_fetch_private_origin"),
  "The compatibility flag that routes global fetch to a private zone origin must not be enabled.",
);

for (const environment of ["staging", "production"]) {
  const envFlags = config.env?.[environment]?.compatibility_flags ?? [];
  assert.ok(
    !envFlags.includes("global_fetch_private_origin"),
    `${environment} must not override strict-public routing with global_fetch_private_origin.`,
  );
}

console.log("Cloudflare strict-public global fetch contract: OK (staging + production config)");
