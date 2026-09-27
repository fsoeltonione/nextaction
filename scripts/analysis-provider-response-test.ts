import assert from "node:assert/strict";
import test from "node:test";
import { parseAnalysisProviderResponse } from "../src/lib/runtime/analysis-provider-response.ts";

const providerResponse =
  '{"id":"19ab4ba2e8324bbe8d1a161b20cc0f11","object":"chat.completion","created":1790532084,"model":"cb-deepseek-v4.1-flash","choices":[{"index":0,"message":{"role":"assistant","content":"{\"ok\":true}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":83,"completion_tokens":5,"total_tokens":88,"completion_tokens_details":{"accepted_prediction_tokens":0,"audio_tokens":0,"reasoning_tokens":0,"rejected_prediction_tokens":0,"cached_tokens":0}}}data: [DONE]\n';

test("parses a normal JSON provider response", () => {
  const value = parseAnalysisProviderResponse('{"ok":true}');
  assert.deepEqual(value, { ok: true });
});

test("parses OpenAgentic JSON followed by the exact DONE trailer", () => {
  const value = parseAnalysisProviderResponse(providerResponse);
  assert.equal(typeof value, "object");
  assert.deepEqual(
    value?.choices?.[0]?.message?.content,
    '{"ok":true}',
  );
});

test("allows whitespace before the exact DONE trailer", () => {
  const value = parseAnalysisProviderResponse('{"ok":true}\n\ndata: [DONE]\n');
  assert.deepEqual(value, { ok: true });
});

test("rejects malformed JSON before the DONE trailer", () => {
  assert.throws(() =>
    parseAnalysisProviderResponse('{"ok":true,data: [DONE]'),
  );
});

test("rejects content after the DONE trailer", () => {
  assert.throws(() =>
    parseAnalysisProviderResponse('{"ok":true}data: [DONE]\njunk'),
  );
});

test("rejects SSE framing instead of treating it as a JSON envelope", () => {
  assert.throws(() =>
    parseAnalysisProviderResponse('data: {"ok":true}\n\ndata: [DONE]'),
  );
});

test("rejects a DONE marker without a JSON envelope", () => {
  assert.throws(() => parseAnalysisProviderResponse('data: [DONE]'));
});
