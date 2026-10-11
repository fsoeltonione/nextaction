import assert from "node:assert/strict";
import test from "node:test";
import { HttpError, readJsonBody } from "../src/lib/http.ts";

test("reads a valid JSON body from a stream without Content-Length", async () => {
  const request = new Request("https://nextaction.test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: "trial", count: 1 }),
  });
  assert.deepEqual(await readJsonBody(request), { event: "trial", count: 1 });
});

test("rejects an oversized streamed body before buffering the remainder", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("12345678"));
      controller.enqueue(new TextEncoder().encode("oversized remainder"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://nextaction.test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  await assert.rejects(
    () => readJsonBody(request, 8),
    (error) =>
      error instanceof HttpError &&
      error.status === 413 &&
      error.code === "request_body_too_large",
  );
  assert.equal(cancelled, true);
});

test("accepts a body exactly at the configured byte limit", async () => {
  const request = new Request("https://nextaction.test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"a":1}',
  });
  assert.deepEqual(await readJsonBody(request, 7), { a: 1 });
});

test("rejects malformed JSON with the stable 400 contract", async () => {
  const request = new Request("https://nextaction.test/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not-json}",
  });
  await assert.rejects(
    () => readJsonBody(request),
    (error) =>
      error instanceof HttpError &&
      error.status === 400 &&
      error.code === "invalid_json",
  );
});
