import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isGenericMomentKey, isMeaningfulMomentKey } from "../src/lib/moment-key.ts";

test("accepts stable semantic lower_snake_case Moment keys", () => {
  for (const key of [
    "invoice_created",
    "subscription_cancelled",
    "team_invited",
    "report_generated",
    "issue_moved_to_sprint",
    "oauth2_connection_verified",
  ]) {
    assert.equal(isMeaningfulMomentKey(key), true, key);
    assert.equal(isGenericMomentKey(key), false, key);
  }
});

test("rejects generic Moment placeholders", () => {
  for (const key of [
    "moment_1",
    "moment_2",
    "new_moment_3",
    "new_1",
    "new",
    "temp",
    "thing",
    "foo",
  ]) {
    assert.equal(isGenericMomentKey(key), true, key);
    assert.equal(isMeaningfulMomentKey(key), false, key);
  }
});

test("rejects malformed, oversized, or non-canonical keys", () => {
  for (const key of [
    "",
    " ",
    "Invoice_Created",
    "invoice-created",
    "invoice created",
    "_invoice_created",
    "invoice_created_",
    "invoice__created",
    "invoice.created",
    "x".repeat(101),
  ]) {
    assert.equal(isMeaningfulMomentKey(key), false, JSON.stringify(key));
  }
});

test("database trigger enforces the same semantic-key boundary", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20261011010000_stage_16_moment_key_semantics.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.guard_moment_key_semantics/);
  assert.match(migration, /CREATE TRIGGER moments_semantic_key_guard/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OF moment_key ON public\.moments/);
  assert.match(migration, /moment_key must be meaningful lower_snake_case/i);
  assert.match(migration, /'new',[\s\S]*'temp',[\s\S]*'thing',[\s\S]*'foo'/);
  assert.match(migration, /\^\(\?:moment\|new_moment\|new\)_\[0-9\]\+/);
});
