import dns from "node:dns";
import { isIpAddress, isPublicIpAddress } from "./ip-address.ts";
import { isBlockedHostname, normalizeProductUrl } from "./url.ts";

export const PRODUCT_SCANNER_LIMITS = Object.freeze({
  maxRedirects: 3,
  timeoutMs: 8_000,
  maxResponseBytes: 256 * 1024,
  maxTextChars: 16_000,
  maxUrlLength: 2_048,
});

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NO_DATA_DNS_CODES = new Set(["ENODATA", "ENOTFOUND"]);
const BLOCKED_APP_HOSTNAMES = new Set([
  "nextaction.fsoeltoni-one.workers.dev",
  "nextaction-staging.fsoeltoni-one.workers.dev",
]);

export type ProductScanResult = {
  finalUrl: string;
  redirects: Array<{ from: string; to: string }>;
  contentType: string;
  resolvedAddresses: string[];
  title: string;
  description: string;
  text: string;
};

export class ProductScannerError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 503) {
    super(message);
    this.name = "ProductScannerError";
    this.code = code;
    this.status = status;
  }
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value : undefined;
}

function normalizeScannerUrl(input: string | URL): URL {
  const raw = input instanceof URL ? input.toString() : input;
  if (raw.length > PRODUCT_SCANNER_LIMITS.maxUrlLength) {
    throw new ProductScannerError("invalid_url", "A valid product URL is required.", 400);
  }

  const candidate = raw.includes("://") ? raw : "https://" + raw;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ProductScannerError("invalid_url", "A valid product URL is required.", 400);
  }

  const hostname = parsed.hostname.replaceAll("[", "").replaceAll("]", "");

  if (isIpAddress(hostname)) {
    throw new ProductScannerError(
      "ip_literal_not_allowed",
      "A public hostname is required for product analysis.",
      400,
    );
  }

  if (isBlockedHostname(hostname)) {
    throw new ProductScannerError(
      "blocked_hostname",
      "This product URL is not allowed.",
      400,
    );
  }

  if (BLOCKED_APP_HOSTNAMES.has(hostname.toLowerCase().replace(/\.$/, ""))) {
    throw new ProductScannerError(
      "self_origin_not_allowed",
      "NextAction cannot analyze its own application endpoint.",
      400,
    );
  }

  const port = parsed.port
    ? Number(parsed.port)
    : parsed.protocol === "https:"
      ? 443
      : 80;

  if (port !== 80 && port !== 443) {
    throw new ProductScannerError(
      "unsupported_port",
      "Only ports 80 and 443 are supported for product analysis.",
      400,
    );
  }

  let normalized: ReturnType<typeof normalizeProductUrl>;
  try {
    normalized = normalizeProductUrl(parsed.toString());
  } catch {
    throw new ProductScannerError("invalid_url", "A valid product URL is required.", 400);
  }

  return new URL(normalized.value);
}

export async function resolveDnsAddresses(
  hostname: string,
  resolve4: DnsFamilyResolver = (host) => dns.promises.resolve4(host),
  resolve6: DnsFamilyResolver = (host) => dns.promises.resolve6(host),
): Promise<string[]> {
  const results = await Promise.allSettled([
    resolve4(hostname),
    resolve6(hostname),
  ]);

  const addresses: string[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      addresses.push(...result.value);
      continue;
    }

    if (!NO_DATA_DNS_CODES.has(errorCode(result.reason) ?? "")) {
      throw new ProductScannerError(
        "dns_unavailable",
        "Product host DNS could not be validated.",
      );
    }
  }

  const unique = [...new Set(addresses)];
  if (unique.length === 0) {
    throw new ProductScannerError(
      "dns_no_address",
      "Product host did not resolve to a usable address.",
    );
  }

  return unique;
}

function validatePublicAddresses(
  addresses: string[],
  code: "non_public_address" | "non_public_address_after_fetch",
): void {
  if (addresses.length === 0) {
    throw new ProductScannerError(
      "dns_no_address",
      "Product host did not resolve to a usable address.",
    );
  }

  for (const address of addresses) {
    if (!isPublicIpAddress(address)) {
      throw new ProductScannerError(
        code,
        code === "non_public_address"
          ? "Product host resolves to a non-public network address."
          : "Product host resolved to a non-public network address after retrieval.",
        400,
      );
    }
  }
}

async function resolvePublicAddresses(
  hostname: string,
  resolveAddresses: ResolveAddresses,
): Promise<string[]> {
  const addresses = await resolveAddresses(hostname);
  // Fail closed: any private/reserved answer rejects this hostname immediately.
  // Re-resolving after a blocked answer could let a rebinding domain pass on
  // a later public answer, making the pre-fetch policy dependent on DNS timing.
  validatePublicAddresses(addresses, "non_public_address");
  return addresses;
}

async function readLimitedBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) {
    const bytes = new TextEncoder().encode(await response.text());
    return new TextDecoder().decode(bytes.subarray(0, maxBytes));
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (totalBytes < maxBytes) {
      const result = await reader.read();
      if (result.done) break;

      const remainingBytes = maxBytes - totalBytes;
      if (result.value.byteLength > remainingBytes) {
        if (remainingBytes > 0) {
          chunks.push(result.value.subarray(0, remainingBytes));
          totalBytes += remainingBytes;
        }
        await reader.cancel().catch(() => undefined);
        break;
      }

      chunks.push(result.value);
      totalBytes += result.value.byteLength;

      if (totalBytes >= maxBytes) {
        // The scanner only needs a bounded HTML prefix for metadata and text
        // extraction. Cancel any remainder instead of rejecting large pages
        // or buffering the complete document.
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

function extractHtmlSignals(html: string) {
  const bounded = html.slice(0, PRODUCT_SCANNER_LIMITS.maxTextChars * 3);

  const title = (
    bounded.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

  const description = (
    bounded.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
    )?.[1] ??
    bounded.match(
      /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i,
    )?.[1] ??
    ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);

  const text = bounded
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PRODUCT_SCANNER_LIMITS.maxTextChars);

  return { title, description, text };
}

function isHttpsDowngrade(from: URL, to: URL): boolean {
  return from.protocol === "https:" && to.protocol === "http:";
}

export type ResolveAddresses = (hostname: string) => Promise<string[]>;
type DnsFamilyResolver = (hostname: string) => Promise<string[]>;

export type ScannerTraceContext = {
  requestId: string;
  environment: string;
};

type DnsRebindProbeTrace = {
  requestId: string;
  testId: string;
  strategy: string;
  hostname: string;
};

const DNS_REBIND_PROBE_HOST =
  /^s-23b9cea5\.7f000001-([0-9]{6,20})-(fs|rd|rr|ma)-e\.d\.rebind\.it$/i;

function createDnsRebindProbeTrace(
  hostname: string,
  context?: ScannerTraceContext,
): DnsRebindProbeTrace | null {
  if (context?.environment.trim().toLowerCase() !== "staging") return null;
  const match = hostname.toLowerCase().match(DNS_REBIND_PROBE_HOST);
  if (!match) return null;
  return {
    requestId: context.requestId,
    testId: match[1],
    strategy: match[2].toLowerCase(),
    hostname: hostname.toLowerCase(),
  };
}

function describeProbeError(error: unknown): Array<{
  name: string;
  message: string;
  code?: string;
}> {
  const chain: Array<{ name: string; message: string; code?: string }> = [];
  let current: unknown = error;
  while (current && typeof current === "object" && chain.length < 3) {
    const record = current as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      cause?: unknown;
    };
    const item: { name: string; message: string; code?: string } = {
      name:
        typeof record.name === "string"
          ? record.name.slice(0, 80)
          : "Error",
      message:
        typeof record.message === "string"
          ? record.message.slice(0, 240)
          : "No error message",
    };
    if (typeof record.code === "string") item.code = record.code.slice(0, 80);
    chain.push(item);
    current = record.cause;
  }
  if (chain.length === 0) {
    chain.push({ name: "Unknown", message: String(error).slice(0, 240) });
  }
  return chain;
}

function logDnsRebindProbe(
  trace: DnsRebindProbeTrace | null,
  phase: string,
  fields: Record<string, unknown>,
): void {
  if (!trace) return;
  console.log(
    "[nextaction-dns-rebind-probe] " +
      JSON.stringify({
        event: "nextaction_dns_rebind_probe",
        request_id: trace.requestId,
        test_id: trace.testId,
        strategy: trace.strategy,
        hostname: trace.hostname,
        phase,
        timestamp: new Date().toISOString(),
        ...fields,
      }),
  );
}

export async function scanProductUrl(
  input: string,
  fetchImpl: typeof fetch = fetch,
  resolveAddresses: ResolveAddresses = resolveDnsAddresses,
  traceContext?: ScannerTraceContext,
): Promise<ProductScanResult> {
  let current = normalizeScannerUrl(input);
  const visited = new Set<string>();
  const redirects: Array<{ from: string; to: string }> = [];
  let firstResolvedAddresses: string[] | null = null;

  for (let hop = 0; hop <= PRODUCT_SCANNER_LIMITS.maxRedirects; hop += 1) {
    current = normalizeScannerUrl(current);
    const currentValue = current.toString();

    if (visited.has(currentValue)) {
      throw new ProductScannerError(
        "redirect_loop",
        "Product redirects formed a loop.",
        400,
      );
    }
    visited.add(currentValue);

    const probeTrace = createDnsRebindProbeTrace(
      current.hostname,
      traceContext,
    );
    let resolvedBefore: string[];
    try {
      resolvedBefore = await resolveAddresses(current.hostname);
      logDnsRebindProbe(probeTrace, "preflight_dns", {
        outcome: "resolved",
        addresses: resolvedBefore,
      });
      validatePublicAddresses(resolvedBefore, "non_public_address");
      logDnsRebindProbe(probeTrace, "preflight_validation", {
        outcome: "accepted",
        addresses: resolvedBefore,
      });
    } catch (error) {
      logDnsRebindProbe(probeTrace, "preflight_validation", {
        outcome: "rejected",
        error_code:
          error instanceof ProductScannerError ? error.code : errorCode(error) ?? "dns_error",
        cause: describeProbeError(error),
      });
      throw error;
    }
    if (firstResolvedAddresses === null) {
      firstResolvedAddresses = resolvedBefore;
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      PRODUCT_SCANNER_LIMITS.timeoutMs,
    );

    let response: Response;

    try {
      try {
        response = await fetchImpl(currentValue, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "User-Agent": "NextActionProductScanner/1.0",
          },
        });
        logDnsRebindProbe(probeTrace, "fetch_result", {
          outcome: "http_response",
          status: response.status,
          response_ok: response.ok,
        });
      } catch (error) {
        const timedOut = error instanceof DOMException && error.name === "AbortError";
        logDnsRebindProbe(probeTrace, "fetch_result", {
          outcome: timedOut ? "timeout" : "exception",
          mapped_error_code: timedOut ? "fetch_timeout" : "fetch_failed",
          cause: describeProbeError(error),
        });

        if (probeTrace) {
          try {
            const resolvedAfterFailure = await resolveAddresses(current.hostname);
            logDnsRebindProbe(probeTrace, "postflight_dns", {
              outcome: "resolved_after_fetch_exception",
              addresses: resolvedAfterFailure,
              all_addresses_public: resolvedAfterFailure.every(isPublicIpAddress),
            });
            try {
              validatePublicAddresses(
                resolvedAfterFailure,
                "non_public_address_after_fetch",
              );
              logDnsRebindProbe(probeTrace, "postflight_validation", {
                outcome: "accepted",
                addresses: resolvedAfterFailure,
              });
            } catch (validationError) {
              logDnsRebindProbe(probeTrace, "postflight_validation", {
                outcome: "rejected",
                error_code:
                  validationError instanceof ProductScannerError
                    ? validationError.code
                    : "dns_validation_error",
                cause: describeProbeError(validationError),
              });
            }
          } catch (postflightError) {
            logDnsRebindProbe(probeTrace, "postflight_dns", {
              outcome: "resolver_exception_after_fetch_exception",
              cause: describeProbeError(postflightError),
            });
          }
        }

        if (timedOut) {
          throw new ProductScannerError(
            "fetch_timeout",
            "Product analysis timed out.",
            504,
          );
        }

        throw new ProductScannerError(
          "fetch_failed",
          "Product page could not be retrieved.",
        );
      }

      let resolvedAfter: string[];
      try {
        resolvedAfter = await resolveAddresses(current.hostname);
        logDnsRebindProbe(probeTrace, "postflight_dns", {
          outcome: "resolved_after_http_response",
          addresses: resolvedAfter,
          all_addresses_public: resolvedAfter.every(isPublicIpAddress),
        });
      } catch (postflightError) {
        logDnsRebindProbe(probeTrace, "postflight_dns", {
          outcome: "resolver_exception_after_http_response",
          cause: describeProbeError(postflightError),
        });
        throw postflightError;
      }

      try {
        validatePublicAddresses(resolvedAfter, "non_public_address_after_fetch");
        logDnsRebindProbe(probeTrace, "postflight_validation", {
          outcome: "accepted",
          addresses: resolvedAfter,
        });
      } catch (validationError) {
        logDnsRebindProbe(probeTrace, "postflight_validation", {
          outcome: "rejected",
          error_code:
            validationError instanceof ProductScannerError
              ? validationError.code
              : "dns_validation_error",
          cause: describeProbeError(validationError),
        });
        throw validationError;
      }

      if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();

      if (!location) {
        throw new ProductScannerError(
          "redirect_without_location",
          "Product redirect did not provide a destination.",
          502,
        );
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentValue);
      } catch {
        throw new ProductScannerError(
          "invalid_redirect",
          "Product redirect destination is invalid.",
          400,
        );
      }

      if (isHttpsDowngrade(current, nextUrl)) {
        throw new ProductScannerError(
          "redirect_downgrade",
          "HTTPS product URLs cannot redirect to HTTP.",
          400,
        );
      }

      if (hop === PRODUCT_SCANNER_LIMITS.maxRedirects) {
        throw new ProductScannerError(
          "redirect_limit",
          "Product exceeded the redirect limit.",
          400,
        );
      }

      current = normalizeScannerUrl(nextUrl);
      redirects.push({ from: currentValue, to: current.toString() });
      continue;
    }

      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel();
        throw new ProductScannerError(
          "upstream_status",
          "Product page could not be retrieved.",
        );
      }

      const contentType =
        response.headers.get("content-type")?.trim().toLowerCase() ?? "";
      const mediaType = contentType.split(";", 1)[0];

      if (mediaType !== "text/html" && mediaType !== "application/xhtml+xml") {
        await response.body?.cancel();
        throw new ProductScannerError(
          "unsupported_content_type",
          "Product response is not an HTML document.",
          415,
        );
      }

      // readLimitedBody enforces maxResponseBytes on the decoded stream.
      // Content-Length may describe a large page; only its bounded prefix is needed.
      const body = await readLimitedBody(
        response,
        PRODUCT_SCANNER_LIMITS.maxResponseBytes,
      );
      const signals = extractHtmlSignals(body);

      return {
        finalUrl: currentValue,
        redirects,
        contentType,
        resolvedAddresses: firstResolvedAddresses ?? resolvedBefore,
        ...signals,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ProductScannerError(
          "fetch_timeout",
          "Product analysis timed out.",
          504,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new ProductScannerError(
    "redirect_limit",
    "Product exceeded the redirect limit.",
    400,
  );
}
