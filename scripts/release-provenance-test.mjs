import assert from "node:assert/strict";
import { test } from "node:test";
import { waitForReleaseProvenance } from "./release-provenance.mjs";

const expectedReleaseSha = "d8e0a73f8f3b6ba76f50cd97dc8dc99c2571ef22";
const previousReleaseSha = "d8b5fb4babd3a9d2fb21f14bb93771e4926b5652";

function healthResponse(releaseSha, overrides = {}) {
  return {
    status: overrides.httpStatus ?? 200,
    async json() {
      return {
        status: "ok",
        service: "nextaction",
        environment: "staging",
        release_sha: releaseSha,
        ...overrides.body,
      };
    },
  };
}

test("waits through old release identity until expected release is active", async () => {
  let clock = 0;
  let attempts = 0;
  const result = await waitForReleaseProvenance({
    expectedReleaseSha,
    expectedEnvironment: "staging",
    requestHealth: async () => {
      attempts += 1;
      return healthResponse(attempts === 1 ? previousReleaseSha : expectedReleaseSha);
    },
    timeoutMs: 3_000,
    intervalMs: 1_000,
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
  });

  assert.equal(attempts, 2);
  assert.equal(result.attempts, 2);
  assert.equal(result.body.release_sha, expectedReleaseSha);
});

test("does not accept a matching SHA from the wrong environment", async () => {
  let clock = 0;
  await assert.rejects(
    waitForReleaseProvenance({
      expectedReleaseSha,
      expectedEnvironment: "staging",
      requestHealth: async () => healthResponse(expectedReleaseSha, {
        body: { environment: "production" },
      }),
      timeoutMs: 2_000,
      intervalMs: 1_000,
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
    }),
    /Timed out after 2000ms.*environment.*production/,
  );
});

test("times out with the last observed SHA when staging remains stale", async () => {
  let clock = 0;
  let attempts = 0;
  await assert.rejects(
    waitForReleaseProvenance({
      expectedReleaseSha,
      requestHealth: async () => {
        attempts += 1;
        return healthResponse(previousReleaseSha);
      },
      timeoutMs: 2_000,
      intervalMs: 1_000,
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
    }),
    new RegExp(`Timed out after 2000ms.*${previousReleaseSha}`),
  );
  assert.equal(attempts, 3);
});

test("rejects malformed expected SHA without making a request", async () => {
  let attempts = 0;
  await assert.rejects(
    waitForReleaseProvenance({
      expectedReleaseSha: "not-a-sha",
      requestHealth: async () => { attempts += 1; },
    }),
    /valid 40-character Git SHA/,
  );
  assert.equal(attempts, 0);
});
