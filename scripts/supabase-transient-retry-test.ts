import assert from "node:assert/strict";
import { test } from "node:test";
import { retryPostgrestJwtValidation } from "../src/lib/supabase-transient-retry.ts";

type Result = {
  data: string[] | null;
  error: { code: string } | null;
};

const noWait = async () => undefined;

test("retries PGRST303 reads and returns the first successful result", async () => {
  let attempts = 0;
  const result = await retryPostgrestJwtValidation<Result>(
    async () => {
      attempts += 1;
      if (attempts === 1) return { data: null, error: { code: "PGRST303" } };
      return { data: ["workspace"], error: null };
    },
    { sleep: noWait },
  );

  assert.equal(attempts, 2);
  assert.deepEqual(result, { data: ["workspace"], error: null });
});

test("does not retry authorization or validation errors", async () => {
  let attempts = 0;
  const result = await retryPostgrestJwtValidation<Result>(
    async () => {
      attempts += 1;
      return { data: null, error: { code: "42501" } };
    },
    { sleep: noWait },
  );

  assert.equal(attempts, 1);
  assert.deepEqual(result, { data: null, error: { code: "42501" } });
});

test("bounds retries and returns the final PGRST303 response", async () => {
  let attempts = 0;
  const result = await retryPostgrestJwtValidation<Result>(
    async () => {
      attempts += 1;
      return { data: null, error: { code: "PGRST303" } };
    },
    { maxAttempts: 3, sleep: noWait },
  );

  assert.equal(attempts, 3);
  assert.deepEqual(result, { data: null, error: { code: "PGRST303" } });
});
