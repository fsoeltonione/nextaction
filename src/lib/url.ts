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

function isBlockedHostname(hostname: string): boolean {
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

  const ipv4 = ipv4ToNumber(host);
  if (ipv4 !== null) {
    const ranges = [
      [0, 256 ** 2 - 1], // 0.0.0.0/16 and "this network" edge cases
      [10 * 256 ** 3, 10 * 256 ** 3 + 256 ** 3 - 1], // 10.0.0.0/8
      [100 * 256 ** 3 + 64 * 256 ** 2, 100 * 256 ** 3 + 127 * 256 ** 2 + 255 * 256 + 255], // 100.64.0.0/10
      [127 * 256 ** 3, 127 * 256 ** 3 + 256 ** 3 - 1], // 127.0.0.0/8
      [169 * 256 ** 2 + 254 * 256, 169 * 256 ** 2 + 254 * 256 + 255], // 169.254.0.0/16
      [172 * 256 ** 2 + 16 * 256, 172 * 256 ** 2 + 31 * 256 + 255], // 172.16.0.0/12
      [192 * 256 ** 2 + 168 * 256, 192 * 256 ** 2 + 168 * 256 + 255], // 192.168.0.0/16
      [198 * 256 ** 2 + 18 * 256, 198 * 256 ** 2 + 19 * 256 + 255], // 198.18.0.0/15
      [224 * 256 ** 3, 240 * 256 ** 3 - 1], // multicast/reserved
      [255 * 256 ** 3 + 255 * 256 ** 2 + 255 * 256 + 255, Number.MAX_SAFE_INTEGER],
    ];

    return ranges.some(([start, end]) => ipv4 >= start && ipv4 <= end);
  }

  if (host.includes(":")) {
    if (
      host === "::" ||
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe8") ||
      host.startsWith("fe9") ||
      host.startsWith("fea") ||
      host.startsWith("feb") ||
      host.startsWith("ff")
    ) {
      return true;
    }

    const mappedIpv4 = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mappedIpv4) return ipv4ToNumber(mappedIpv4[1]) !== null;
  }

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

  const value = url.toString();

  return {
    value,
    origin: url.origin,
    hostname: url.hostname,
  };
}
