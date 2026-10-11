import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import testFn from "node:test";

const route = await readFile(
  new URL("../src/app/api/_internal/dns-rebind-runtime-probe/route.ts", import.meta.url),
  "utf8",
);

testFn("runtime DNS probe is gated to staging and an explicit probe header", () => {
  assert.match(
    route,
    /process\.env\.APP_ENV\?\.trim\(\)\.toLowerCase\(\) !== "staging"/,
    "raw runtime fetch must be disabled outside staging",
  );
  assert.match(
    route,
    /x-nextaction-dns-probe.*PROBE_HEADER/,
    "the route must require the explicit probe header",
  );
  assert.match(route, /const PROBE_HEADER = "issue-104-runtime"/);
});

testFn("runtime DNS probe cannot accept arbitrary URLs or private destinations", () => {
  assert.match(
    route,
    /s-7f000001\.7f000001-/,
    "the test hostname must be fixed to the loopback-only rebind fixture",
  );
  assert.match(route, /const EXPECTED_TARGET_ADDRESS = "127\.0\.0\.1"/);
  assert.doesNotMatch(
    route,
    /body\.url|body\.hostname|new URL\(String\(/,
    "callers must not supply URL or hostname data",
  );
  assert.doesNotMatch(
    route,
    /scanProductUrl\(/,
    "the diagnostic must remain separate from the product scanner path",
  );
});

testFn("runtime probe invokes fetch only after validating the fixed loopback fixture", () => {
  const dnsCheck = route.indexOf("preflightAddresses = await resolveDnsAddresses(hostname)");
  const fetchCall = route.indexOf("const response = await fetch(target.toString()");
  const postflight = route.indexOf("const postflightAddresses = await resolveDnsAddresses(hostname)");

  assert.ok(dnsCheck >= 0, "runtime DNS preflight must be recorded");
  assert.ok(fetchCall > dnsCheck, "fetch must follow the loopback fixture check");
  assert.ok(postflight > fetchCall, "postflight DNS must follow the actual fetch attempt");
  assert.match(route, /fetch_attempted: false/);
  assert.match(route, /phase: "fetch_result"/);
  assert.match(route, /phase: "postflight_dns"/);
  assert.match(route, /cause: describeCause\(error\)/);
});
