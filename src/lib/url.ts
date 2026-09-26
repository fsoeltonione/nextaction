import { isIpAddress, isPublicIpAddress } from "@/lib/ip-address";

const IPV4_RE = /^(\d{1,3})(?:\.(\d{1,3})){3}$/;

function ipv4ToNumber(hostname: string): number | null {
  if (!IPV4_RE.test(hostname)) return null;

  const parts = hostname.split(".").map(Number);
  if (parts.some((part) => part < 0 || part > 255)) return null;

  return (
    parts[0] * 256 ** 3 +
    parts[1] * 256 ** 2 +
    parts[2] * 256 +
    parts[3]
  );
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.$/, "");

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "local" ||
    host.endsWith(".local")
  ) {
    return true;
  }

  if (isIpAddress(host)) return !isPublicIpAddress(host);

  return false;
}

export interface NormalizedProductUrl {
  value: string;
  origin: string;
  hostname: string;
}

export function normalizeProductUrl(input: unknown): NormalizedProductUrl {
  if (typeof input !== "string") {
    throw new Error("A product URL is required.");
  }

  const raw = input.trim();
  if (!raw || raw.length > 2048) {
    throw new Error("The product URL is invalid.");
  }

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw)
    ? raw
    : "https://" + raw;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("The product URL is invalid.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only HTTP and HTTPS product URLs are supported.");
  }

  if (url.username || url.password) {
    throw new Error("Product URLs cannot contain embedded credentials.");
  }

  if (isBlockedHostname(url.hostname)) {
    throw new Error("This product URL is not allowed.");
  }

  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLowerCase();

  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }

  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  const value = `${url.origin}${url.pathname === "/" ? "" : url.pathname}`;

  return {
    value,
    origin: url.origin,
    hostname: url.hostname,
  };
}
