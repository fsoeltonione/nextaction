import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAnalysisProviderContent,
  AnalysisContentParseError,
} from "../src/lib/runtime/analysis-provider-content.ts";

test("parses plain JSON assistant content", () => {
  assert.deepEqual(
    parseAnalysisProviderContent('{"name":"Example","moments":[]}'),
    { name: "Example", moments: [] },
  );
});

test("parses fenced JSON assistant content", () => {
  assert.deepEqual(
    parseAnalysisProviderContent('```json\n{"name":"Example"}\n```'),
    { name: "Example" },
  );
});

test("parses BOM-prefixed JSON assistant content", () => {
  assert.deepEqual(
    parseAnalysisProviderContent('\uFEFF{"name":"Example"}'),
    { name: "Example" },
  );
});

test("rejects prose around the JSON document", () => {
  assert.throws(
    () => parseAnalysisProviderContent('Here is the JSON: {"name":"Example"}'),
    (error) =>
      error instanceof AnalysisContentParseError &&
      error.reason === "malformed_json",
  );
});

test("rejects empty assistant content", () => {
  assert.throws(
    () => parseAnalysisProviderContent("   "),
    (error) =>
      error instanceof AnalysisContentParseError &&
      error.reason === "empty_content",
  );
});

test("rejects an unclosed code fence", () => {
  assert.throws(
    () => parseAnalysisProviderContent('```json\n{"name":"Example"}'),
    (error) =>
      error instanceof AnalysisContentParseError &&
      error.reason === "malformed_json",
  );
});
