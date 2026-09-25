import { isIP } from "node:net";

import { normalizeProductUrl } from "@/lib/url";

export function normalizeHttpDestinationUrl(input: unknown): string {
  if (typeof input !== "string") throw new Error("A destination URL is required.");
  const raw = input.trim();
  if (!raw || raw.length > 2048) throw new Error("The destination URL is invalid.");

  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("The destination URL is invalid."); }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only HTTP and HTTPS destination URLs are supported.");
  }
  if (url.username || url.password) {
    throw new Error("Destination URLs cannot contain embedded credentials.");
  }
  if (isIP(url.hostname) !== 0 && normalizeProductUrl(url).hostname !== url.hostname) {
    throw new Error("The destination URL is invalid.");
  }

  return url.toString();
}