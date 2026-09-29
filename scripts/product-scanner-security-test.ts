import assert from "node:assert/strict";
import test from "node:test";
import { isPublicIpAddress } from "../src/lib/ip-address.ts";
import {
  PRODUCT_SCANNER_LIMITS,
  ProductScannerError,
  scanProductUrl,
  resolveDnsAddresses,
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

test("DNS resolver classifies no-record and transient failures", async () => {
  await assert.rejects(
    () => resolveDnsAddresses("internal.example", noAddresses, noAddresses),
    (error: unknown) =>
      error instanceof ProductScannerError &&
      error.code === "dns_no_address",
  );

  const dnsTransientFailure = async () => {
    const error = new Error("temporary DNS failure") as Error & { code: string };
    error.code = "EAI_AGAIN";
    throw error;
  };

  await assert.rejects(
    () =>
      resolveDnsAddresses(
        "internal.example",
        dnsTransientFailure,
        async () => ["93.184.216.34"],
      ),
    (error: unknown) =>
      error instanceof ProductScannerError &&
      error.code === "dns_unavailable",
  );
});

test("scanner retries a transient non-public DNS answer before fetch", async () => {
  let resolveCalls = 0;
  let fetchCalls = 0;

  const transientResolver = async () => {
    resolveCalls += 1;
    return resolveCalls === 1 ? ["10.0.0.1"] : ["93.184.216.34"];
  };

  const result = await scanProductUrl(
    "https://example.com",
    async () => {
      fetchCalls += 1;
      return new Response(
        '<html><title>Example</title><body>OK</body></html>',
        {
          status: 200,
          headers: { "content-type": "text/html" },
        },
      );
    },
    transientResolver,
  );

  assert.equal(result.title, "Example");
  assert.equal(resolveCalls, 3);
  assert.equal(fetchCalls, 1);
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

test("scanner rejects embedded credentials and unsupported ports", async () => {
  await assert.rejects(
    () => scanProductUrl("https://user:pass@example.com"),
    (error: unknown) =>
      error instanceof ProductScannerError &&
      error.code === "invalid_url",
  );

  for (const url of ["https://example.com:444", "http://example.com:8080"]) {
    await assert.rejects(
      () => scanProductUrl(url),
      (error: unknown) =>
        error instanceof ProductScannerError &&
        error.code === "unsupported_port",
    );
  }
});

test("scanner enforces fetch timeout", async () => {
  const hangingFetch = async (
    _url: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> =>
    await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const abort = () => reject(new DOMException("Aborted", "AbortError"));

      if (signal?.aborted) {
        abort();
        return;
      }

      signal?.addEventListener("abort", abort, { once: true });
    });

  await assert.rejects(
    () =>
      scanProductUrl(
        "https://example.com",
        hangingFetch,
        publicAddresses,
      ),
    (error: unknown) =>
      error instanceof ProductScannerError &&
      error.code === "fetch_timeout",
  );
});

test("scanner bounds oversized streaming responses without failing the analysis path", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode("<html><title>Example</title><body>"),
      );
      controller.enqueue(
        new Uint8Array(PRODUCT_SCANNER_LIMITS.maxResponseBytes),
      );
      controller.enqueue(encoder.encode("</body></html>"));
      controller.close();
    },
  });

  const result = await scanProductUrl(
    "https://example.com",
    async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    publicAddresses,
  );

  assert.equal(result.title, "Example");
  assert.ok(
    encoder.encode(result.text).byteLength <= PRODUCT_SCANNER_LIMITS.maxTextChars,
  );
});

test("scanner does not reject an oversized content-length before applying the stream bound", async () => {
  const result = await scanProductUrl(
    "https://example.com",
    async () =>
      new Response(
        "<html><title>Example</title><body>Bounded</body></html>",
        {
          status: 200,
          headers: {
            "content-type": "text/html",
            "content-length": String(PRODUCT_SCANNER_LIMITS.maxResponseBytes + 1),
          },
        },
      ),
    publicAddresses,
  );

  assert.equal(result.title, "Example");
  assert.match(result.text, /Bounded/);
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

});

test("scanner rejects redirect targets containing credentials", async () => {
  await assert.rejects(
    () =>
      scanProductUrl(
        "https://example.com",
        async () =>
          new Response(null, {
            status: 302,
            headers: {
              location: "https://user:pass@example.com/final",
            },
          }),
        publicAddresses,
      ),
    (error: unknown) =>
      error instanceof ProductScannerError &&
      error.code === "invalid_url",
  );
});

test("scanner limits redirects", async () => {
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

test("scanner detects a real redirect loop", async () => {
  const calls: string[] = [];

  await assert.rejects(
    () =>
      scanProductUrl(
        "https://example.com/a",
        async (url) => {
          const current = String(url);
          calls.push(current);

          if (calls.length === 1) {
            return new Response(null, {
              status: 302,
              headers: { location: "https://example.com/b" },
            });
          }

          return new Response(null, {
            status: 302,
            headers: { location: "https://example.com/a" },
          });
        },
        publicAddresses,
      ),
    (error: unknown) =>
      error instanceof ProductScannerError &&
      error.code === "redirect_loop",
  );

  assert.deepEqual(calls, [
    "https://example.com/a",
    "https://example.com/b",
  ]);
});
