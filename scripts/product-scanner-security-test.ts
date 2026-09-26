import assert from "node:assert/strict";
import dns from "node:dns";
import test from "node:test";
import { isPublicIpAddress } from "../src/lib/ip-address.ts";
import {
  PRODUCT_SCANNER_LIMITS,
  ProductScannerError,
  scanProductUrl,
} from "../src/lib/product-scanner.ts";

async function withDns(
  resolve4: (hostname: string) => Promise<string[]>,
  resolve6: (hostname: string) => Promise<string[]>,
  callback: () => Promise<void>,
) {
  const original4 = dns.promises.resolve4;
  const original6 = dns.promises.resolve6;
  dns.promises.resolve4 = resolve4;
  dns.promises.resolve6 = resolve6;

  try {
    await callback();
  } finally {
    dns.promises.resolve4 = original4;
    dns.promises.resolve6 = original6;
  }
}

function noDataError(): Error & { code: string } {
  const error = new Error("no DNS record") as Error & { code: string };
  error.code = "ENODATA";
  return error;
}

test("IP classifier rejects private, reserved and mapped-private addresses", () => {
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
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

test("scanner rejects IP-literal targets", async () => {
  await assert.rejects(
    () => scanProductUrl("https://127.0.0.1"),
    (error: unknown) =>
      error instanceof ProductScannerError &&
      error.code === "ip_literal_not_allowed",
  );
});

test("scanner rejects non-public DNS answers before fetch", async () => {
  let fetchCalled = false;

  await withDns(
    async () => ["10.0.0.1"],
    async () => {
      throw noDataError();
    },
    async () => {
      await assert.rejects(
        () =>
          scanProductUrl("https://internal.example", async () => {
            fetchCalled = true;
            return new Response("<html></html>", {
              status: 200,
              headers: { "content-type": "text/html" },
            });
          }),
        (error: unknown) =>
          error instanceof ProductScannerError &&
          error.code === "non_public_address",
      );
    },
  );

  assert.equal(fetchCalled, false);
});

test("scanner uses manual redirects and does not forward caller credentials", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];

  await withDns(
    async () => ["93.184.216.34"],
    async () => {
      throw noDataError();
    },
    async () => {
      const result = await scanProductUrl("https://example.com", async (url, init) => {
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
      });

      assert.equal(result.title, "Example");
      assert.equal(result.description, "Demo");
      assert.equal(result.text.includes("Hello world"), true);
      assert.equal(result.redirects.length, 1);
      assert.equal(calls[0]?.init.redirect, "manual");

      const headers = new Headers(calls[0]?.init.headers);
      assert.equal(headers.get("authorization"), null);
      assert.equal(headers.get("cookie"), null);
      assert.equal(headers.get("accept"), "text/html,application/xhtml+xml");
    },
  );
});

test("scanner rejects redirect downgrade and private redirect targets", async () => {
  await withDns(
    async () => ["93.184.216.34"],
    async () => {
      throw noDataError();
    },
    async () => {
      await assert.rejects(
        () =>
          scanProductUrl("https://example.com", async () =>
            new Response(null, {
              status: 302,
              headers: { location: "http://example.com/insecure" },
            }),
          ),
        (error: unknown) =>
          error instanceof ProductScannerError &&
          error.code === "redirect_downgrade",
      );
    },
  );

  await assert.rejects(
    () =>
      scanProductUrl("https://example.com", async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/private" },
        }),
      ),
    (error: unknown) =>
      error instanceof ProductScannerError &&
      error.code === "ip_literal_not_allowed",
  );
});

test("scanner enforces content type and response size", async () => {
  await withDns(
    async () => ["93.184.216.34"],
    async () => {
      throw noDataError();
    },
    async () => {
      await assert.rejects(
        () =>
          scanProductUrl("https://example.com", async () =>
            new Response("data", {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          ),
        (error: unknown) =>
          error instanceof ProductScannerError &&
          error.code === "unsupported_content_type",
      );

      await assert.rejects(
        () =>
          scanProductUrl("https://example.com", async () =>
            new Response("data", {
              status: 200,
              headers: {
                "content-type": "text/html",
                "content-length": String(PRODUCT_SCANNER_LIMITS.maxResponseBytes + 1),
              },
            }),
          ),
        (error: unknown) =>
          error instanceof ProductScannerError &&
          error.code === "response_too_large",
      );
    },
  );
});

test("scanner limits redirects and detects redirect loops", async () => {
  await withDns(
    async () => ["93.184.216.34"],
    async () => {
      throw noDataError();
    },
    async () => {
      let calls = 0;

      await assert.rejects(
        () =>
          scanProductUrl("https://example.com", async (url) => {
            calls += 1;
            return new Response(null, {
              status: 302,
              headers: {
                location:
                  calls === 1 ? "https://example.com/a" : "https://example.com",
              },
            });
          }),
        (error: unknown) =>
          error instanceof ProductScannerError &&
          error.code === "redirect_loop",
      );
    },
  );
});

console.log("Product scanner security tests registered.");
