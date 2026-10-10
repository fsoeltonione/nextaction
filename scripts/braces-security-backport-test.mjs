import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const braces = require("braces");
const installedPackage = require("braces/package.json");

const MAX_DEPTH = 100;
const oversizedBracePattern = (depth) =>
  "{".repeat(depth) + "a,b" + "}".repeat(depth);
const oversizedParenPattern = (depth) =>
  "(".repeat(depth) + "a" + ")".repeat(depth);

function nestedAst(depth) {
  let node = { type: "text", value: "x" };
  for (let i = 0; i < depth; i += 1) {
    node = { type: "brace", nodes: [node] };
  }
  return { type: "root", nodes: [node] };
}

assert.equal(
  installedPackage.version,
  "3.0.4-nextaction.1",
  "runtime must resolve the reviewed local braces backport, not registry braces@3.0.3",
);

for (const pattern of [
  oversizedBracePattern(MAX_DEPTH + 1),
  oversizedParenPattern(MAX_DEPTH + 1),
]) {
  assert.throws(() => braces.parse(pattern), /exceeds max depth/i);
  assert.throws(() => braces(pattern), /exceeds max depth/i);
  assert.throws(() => braces.compile(pattern), /exceeds max depth/i);
  assert.throws(() => braces.expand(pattern), /exceeds max depth/i);
  assert.throws(() => braces.stringify(pattern), /exceeds max depth/i);
}

assert.doesNotThrow(() => braces.parse(oversizedBracePattern(MAX_DEPTH)));
assert.doesNotThrow(() => braces.parse(oversizedParenPattern(MAX_DEPTH)));

for (const operation of [
  (ast) => braces.compile(ast),
  (ast) => braces.expand(ast),
  (ast) => braces.stringify(ast),
]) {
  assert.throws(() => operation(nestedAst(MAX_DEPTH + 1)), /exceeds max depth/i);
}

const cyclicParent = { type: "paren", nodes: [{ type: "text", value: "x" }] };
cyclicParent.parent = cyclicParent;
assert.throws(
  () => braces.expand(cyclicParent),
  /parent chain contains a cycle/i,
  "caller-supplied AST parent cycles must be rejected",
);

// Representative non-adversarial inputs retain normal brace behavior.
assert.deepEqual(braces.expand("{a,b}"), ["a", "b"]);
assert.deepEqual(braces.expand("v{1..3}"), ["v1", "v2", "v3"]);
assert.equal(braces.compile("src/{a,b}.ts"), "src/(a|b).ts");

console.log("Local braces security backport: depth guards, AST guards, and compatibility PASS");
