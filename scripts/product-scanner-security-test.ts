import assert from "node:assert/strict";
import test from "node:test";
import { isPublicIpAddress } from "../src/lib/ip-address.ts";
import {
  PRODUCT_SCANNER_LIMITS,
  ProductScannerError,
  scanProductUrl,
} from "../src/lib/product-scanner.ts";

const publicAddresses = async () => ["93.184.216.34"];
const noAddresses = async () => {
  const error = new Error("no DNS record") as Error & { code: string };
  error.code = "ENODATA";
  throw error;
};

test("IP classifier rejects private, reserved and mapped-private addresses", () => {
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
  assert.equal(isPublicIpAddress("127.0.0.1"), false);
  assert.equal(isPublicIpAddress("10.0.0.1"), false);
  assert.equal(isPublicIpAddress("192.168.1.1"), false);
  assert.equal(isPublicIpAddress("169.254.1.1"), false);
  assert.equal(isPublicIpAddress("224.0.0.1"), false);
  assert.equal(isPublicIpAddress("::1"), false);
  assert.equal(isPublicIpAddress("fc00::1"), false);
  assert.equal(isPublicIpAddress("fe80::1"), false);
  assert.equal(isPublicIpAddress("2001:db8::1"), false);
  assert.equal(isPublicIpAddress("::ffff:127.0.0.1"), false);
  assert.equal(isPublicIpAddress("::ffff:8.8.8.8"), true);
});

test("scanner rejects IP-literal targets, including alternate IPv4 notation", async () => {
  for (const url of ["https://127.0.0.1", "https://2130706433"]) {
    await assert.rejects(
      () => scanProductUrl(url),
      (error: unknown) =>
        error instanceof ProductScannerError &&
        error.code === "ip_literal_not_allowed",
    );
  }
});

test("scanner rejects non-public DNS answers before fetch", async () => {
  let fetchCalled = false;

  await assert.rejects(
    () =>
      scanProductUrl(
        "https://internal.example",
        async () => {
          fetchCalled = true;
          return new Response("<html></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        },
        async () => ["10.0.0.1"],
      ),
    (error: unknown) =>
      error instanceof ProductScannerError &&
      error.code === "non_public_address",
  );

  assert.equal(fetchCalled, false);
});

test("scanner uses manual redirects and does not forward caller credentials", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];

  const result = await scanProductUrl(
    "https://example.com",
    async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });

      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://example.com/final" },
        });
      }

      return new Response(
        '<html><title>Example</title><meta name="description" content="Demo"><body>Hello world</body></html>',
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    },
    publicAddresses,
  );

  assert.equal(result.title, "Example");
  assert.equal(result.description, "Demo");
  assert.equal(result.text.includes("Hello world"), true);
  assert.equal(result.redirects.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.init.redirect, "manual");

  const headers = new Headers(calls[0]?.init.headers);
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("accept"), "text/html,application/xhtml+xml");
});

test("scanner rejects HTTPS downgrade and private redirect targets", async () => {
  await assert.rejects(
    () =>
      scanProductUrl(
        "https://example.com",
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "http://example.com/insecure" },
          }),
        publicAddresses,
      ),
    (error: unknown) =>
      error instanceof ProductScannerError &&
      error.code === "redirect_downgrade",
  );

  await assert.rejects(
    () =>
      scanProductUrl(
        "https://example.com",
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://127.0.0.1/private" },
          }),
        publicAddresses,
      ),
    (error: unknown) =>
      error instanceof ProductScannerError &&
      error.code === "ip_literal_not_allowed",
  );
});

test("scanner rejects an observed DNS rebind to a non-public address", async () => {
  let resolveCalls = 0;
  const rebindingResolver = async () => {
    resolveCalls += 1;
    return resolveCalls === 1 ? ["93.184.216.34"] : ["10.0.0.1"];
  };

  await assert.rejects(
    () =>
      scanProductUrl(
        "https://example.com",
        async () =>
          new Response("<html></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
        rebindingResolver,
      ),
    (error: unknown) =>
      error instanceof ProductScannerError &&
      error.code === "non_public_address_after_fetch",
  );
});

test("scanner enforces content type and response size", async () => {
  await assert.rejects(
    () =>
      scanProductUrl(
        "https://example.com",
        async () =>
          new Response("data", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        publicAddresses,
      ),
    (error: unknown) =>
      error instanceof ProductScannerError &&
      error.code === "unsupported_content_type",
  );

  await assert.rejects(
    () =>
      scanProductUrl(
        "https://example.com",
        async () =>
          new Response("data", {
            status: 200,
            headers: {
              "content-type": "text/html",
              "content-length": String(PRODUCT_SCANNER_LIMITS.maxResponseBytes + 1),
            },
          }),
        publicAddresses,
      ),
    (error: unknown) =>
      error instanceof ProductScannerError &&
      error.code === "response_too_large",
  );
});

test("scanner limits redirects and detects loops", async () => {
  let redirectCount = 0;
  await assert.rejects(
    () =>
      scanProductUrl(
        "https://example.com",
        async () => {
          redirectCount += 1;
          return new Response(null, {
            status: 302,
            headers: { location: "https://example.com/path-" + redirectCount },
          });
        },
        publicAddresses,
      ),
    (error: unknown) =>
      error instanceof ProductScannerError &&
      error.code === "redirect_limit",
  );
});
