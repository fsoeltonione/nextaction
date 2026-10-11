import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const directory = "supabase/migrations";
const files = (await readdir(directory))
  .filter((name) => name.endsWith(".sql"))
  .sort();

const legacyDuplicatePrefixes = new Map([
  ["20260926030000", [
    "20260926030000_stage_12_qualified_click_runtime.sql",
    "20260926030000_stage_9_runtime_core.sql",
  ].sort()],
  ["20260926040000", [
    "20260926040000_stage_13_atomic_settlement_runtime.sql",
    "20260926040000_stage_9_hardening.sql",
  ].sort()],
]);

const byPrefix = new Map();
for (const file of files) {
  const match = file.match(/^(\d{14})_.+\.sql$/);
  assert.ok(match, `Invalid migration filename: ${join(directory, file)}`);
  const prefix = match[1];
  const entries = byPrefix.get(prefix) ?? [];
  entries.push(file);
  byPrefix.set(prefix, entries);
}

const actualDuplicates = [...byPrefix.entries()]
  .filter(([, names]) => names.length > 1)
  .map(([prefix, names]) => [prefix, names.sort()])
  .sort(([a], [b]) => a.localeCompare(b));
const expectedDuplicates = [...legacyDuplicatePrefixes.entries()]
  .map(([prefix, names]) => [prefix, names])
  .sort(([a], [b]) => a.localeCompare(b));

assert.deepEqual(
  actualDuplicates,
  expectedDuplicates,
  "Only the explicitly documented legacy migration timestamp collisions are allowed. Every new migration must have a unique 14-digit timestamp prefix.",
);

console.log(`Migration filename contract: OK (${files.length} migrations; only the two documented historical timestamp collisions)`);
