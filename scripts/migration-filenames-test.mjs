import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const directory = "supabase/migrations";
const files = (await readdir(directory))
  .filter((name) => name.endsWith(".sql"))
  .sort();

const byPrefix = new Map();
for (const file of files) {
  const match = file.match(/^(\d{14})_.+\.sql$/);
  assert.ok(match, `Invalid migration filename: ${join(directory, file)}`);
  const entries = byPrefix.get(match[1]) ?? [];
  entries.push(file);
  byPrefix.set(match[1], entries);
}

const actualDuplicates = [...byPrefix.entries()]
  .filter(([, names]) => names.length > 1)
  .map(([prefix, names]) => [prefix, names.sort()])
  .sort(([a], [b]) => a.localeCompare(b));

assert.deepEqual(
  actualDuplicates,
  [],
  "Every migration filename must have a unique 14-digit timestamp prefix. Historical collisions must be resolved in source, not normalized only in CI.",
);

console.log(`Migration filename contract: OK (${files.length} unique migrations)`);
