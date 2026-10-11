import { NextResponse } from "next/server";
import { createRequestId, jsonError } from "@/lib/http";
import { resolveDnsAddresses } from "@/lib/product-scanner";

const PROBE_HEADER = "issue-104-runtime";
const FETCH_TIMEOUT_MS = 8_000;
const EXPECTED_TARGET_ADDRESS = "127.0.0.1";

type ProbeEvent = Record<string, unknown>;

function describeCause(error: unknown): Array<{
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
      name: typeof record.name === "string" ? record.name.slice(0, 80) : "Error",
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

function probeResponse(
  requestId: string,
  sessionId: string,
  events: ProbeEvent[],
  status = 200,
) {
  const response = NextResponse.json(
    {
      mode: "staging-runtime-fetch-boundary-only",
      request_id: requestId,
      test_id: sessionId,
      target_host: `s-7f000001.7f000001-${sessionId}-ma-e.d.rebind.it`,
      trace: events,
    },
    { status },
  );
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Request-Id", requestId);
  return response;
}

export async function POST(request: Request) {
  const requestId = createRequestId();

  // Never expose the raw-fetch path in production, even if the route is called directly.
  if (process.env.APP_ENV?.trim().toLowerCase() !== "staging") {
    return jsonError(requestId, 404, "not_found", "Not found.");
  }

  // This diagnostic has a fixed loopback-only target; it accepts no URL or hostname from callers.
  if (request.headers.get("x-nextaction-dns-probe") !== PROBE_HEADER) {
    return jsonError(requestId, 404, "not_found", "Not found.");
  }

  const sessionId = Date.now().toString();
  const hostname = `s-7f000001.7f000001-${sessionId}-ma-e.d.rebind.it`;
  const target = new URL(`http://${hostname}:80/__na_runtime_${sessionId}`);
  const events: ProbeEvent[] = [];

  // This route intentionally bypasses the product scanner's public-address validation
  // only to isolate the Worker runtime boundary. Do not allow arbitrary targets here.
  let preflightAddresses: string[];
  try {
    preflightAddresses = await resolveDnsAddresses(hostname);
    events.push({
      phase: "runtime_preflight_dns",
      timestamp: new Date().toISOString(),
      outcome: "resolved",
      addresses: preflightAddresses,
    });
  } catch (error) {
    events.push({
      phase: "runtime_preflight_dns",
      timestamp: new Date().toISOString(),
      outcome: "resolver_exception",
      cause: describeCause(error),
    });
    return probeResponse(requestId, sessionId, events);
  }

  if (
    preflightAddresses.length !== 1 ||
    preflightAddresses[0] !== EXPECTED_TARGET_ADDRESS
  ) {
    events.push({
      phase: "runtime_preflight_validation",
      timestamp: new Date().toISOString(),
      outcome: "rejected_fixture_mismatch",
      expected_address: EXPECTED_TARGET_ADDRESS,
      addresses: preflightAddresses,
      fetch_attempted: false,
    });
    return probeResponse(requestId, sessionId, events);
  }

  events.push({
    phase: "runtime_preflight_validation",
    timestamp: new Date().toISOString(),
    outcome: "accepted_loopback_fixture_for_runtime_test",
    addresses: preflightAddresses,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    try {
      const response = await fetch(target.toString(), {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "text/plain",
          "User-Agent": "NextActionDnsRebindRuntimeProbe/1.0",
        },
      });
      events.push({
        phase: "fetch_result",
        timestamp: new Date().toISOString(),
        outcome: "http_response",
        status: response.status,
        response_ok: response.ok,
      });
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "AbortError";
      events.push({
        phase: "fetch_result",
        timestamp: new Date().toISOString(),
        outcome: timedOut ? "timeout" : "exception",
        mapped_error_code: timedOut ? "fetch_timeout" : "fetch_failed",
        cause: describeCause(error),
      });
    }
  } finally {
    clearTimeout(timeout);
  }

  // Resolve only after fetch so the diagnostic does not prime the DNS cache beforehand.
  try {
    const postflightAddresses = await resolveDnsAddresses(hostname);
    events.push({
      phase: "postflight_dns",
      timestamp: new Date().toISOString(),
      outcome: "resolved_after_fetch",
      addresses: postflightAddresses,
    });
    events.push({
      phase: "postflight_validation",
      timestamp: new Date().toISOString(),
      outcome:
        postflightAddresses.length === 1 &&
        postflightAddresses[0] === EXPECTED_TARGET_ADDRESS
          ? "confirmed_loopback_fixture"
          : "fixture_changed",
      expected_address: EXPECTED_TARGET_ADDRESS,
      addresses: postflightAddresses,
    });
  } catch (error) {
    events.push({
      phase: "postflight_dns",
      timestamp: new Date().toISOString(),
      outcome: "resolver_exception_after_fetch",
      cause: describeCause(error),
    });
  }

  return probeResponse(requestId, sessionId, events);
}
