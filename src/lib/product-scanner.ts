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
const NON_PUBLIC_DNS_RETRIES = 2;
const NON_PUBLIC_DNS_RETRY_DELAY_MS = 75;

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

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}

async function resolvePublicAddressesWithRetry(
  hostname: string,
  resolveAddresses: ResolveAddresses,
): Promise<string[]> {
  for (let attempt = 0; attempt <= NON_PUBLIC_DNS_RETRIES; attempt += 1) {
    const addresses = await resolveAddresses(hostname);

    try {
      validatePublicAddresses(addresses, "non_public_address");
      return addresses;
    } catch (error) {
      if (
        !(error instanceof ProductScannerError) ||
        error.code !== "non_public_address" ||
        attempt === NON_PUBLIC_DNS_RETRIES
      ) {
        throw error;
      }

      await sleep(NON_PUBLIC_DNS_RETRY_DELAY_MS);
    }
  }

  throw new ProductScannerError(
    "non_public_address",
    "Product host resolves to a non-public network address.",
    400,
  );
}

async function readLimitedBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new ProductScannerError(
        "response_too_large",
        "Product response is too large.",
        413,
      );
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;

      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new ProductScannerError(
          "response_too_large",
          "Product response is too large.",
          413,
        );
      }

      chunks.push(result.value);
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

export async function scanProductUrl(
  input: string,
  fetchImpl: typeof fetch = fetch,
  resolveAddresses: ResolveAddresses = resolveDnsAddresses,
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

    const resolvedBefore = await resolveAddresses(current.hostname);
    validatePublicAddresses(resolvedBefore, "non_public_address");
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
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
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

      const resolvedAfter = await resolveAddresses(current.hostname);
      validatePublicAddresses(resolvedAfter, "non_public_address_after_fetch");

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

      const contentLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(contentLength) &&
        contentLength > PRODUCT_SCANNER_LIMITS.maxResponseBytes
      ) {
        await response.body?.cancel();
        throw new ProductScannerError(
          "response_too_large",
          "Product response is too large.",
          413,
        );
      }

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
