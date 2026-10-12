const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_INTERVAL_MS = 3_000;

const defaultSleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Cloudflare may need a short propagation window after Wrangler reports a
 * successful deployment. Wait for the exact release identity instead of
 * accepting an older Worker or weakening the provenance assertion.
 */
export async function waitForReleaseProvenance({
  expectedReleaseSha,
  expectedEnvironment = "staging",
  requestHealth,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  now = Date.now,
  sleep = defaultSleep,
}) {
  if (!/^[0-9a-f]{40}$/i.test(expectedReleaseSha ?? "")) {
    throw new Error("Expected release SHA must be a valid 40-character Git SHA.");
  }
  if (typeof requestHealth !== "function") {
    throw new TypeError("requestHealth must be a function.");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError("timeoutMs must be a non-negative finite number.");
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError("intervalMs must be a positive finite number.");
  }

  const deadline = now() + timeoutMs;
  let attempts = 0;
  let lastObservation = null;
  let firstObservation = null;

  while (true) {
    attempts += 1;
    try {
      const response = await requestHealth();
      let body = null;
      try {
        body = await response.json();
      } catch {
        // Record an invalid body as an observation and continue within bounds.
      }

      lastObservation = {
        http_status: response.status,
        health_status: body?.status ?? null,
        service: body?.service ?? null,
        environment: body?.environment ?? null,
        release_sha: body?.release_sha ?? null,
      };
      if (firstObservation === null) firstObservation = lastObservation;

      if (
        response.status === 200 &&
        body?.status === "ok" &&
        body?.service === "nextaction" &&
        body?.environment === expectedEnvironment &&
        body?.release_sha === expectedReleaseSha
      ) {
        return { body, attempts, firstObservation };
      }
    } catch (error) {
      lastObservation = {
        request_error: error instanceof Error ? error.message : "Unknown health request error.",
      };
      if (firstObservation === null) firstObservation = lastObservation;
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(intervalMs, remainingMs));
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for staging release ${expectedReleaseSha}. Last health observation: ${JSON.stringify(lastObservation)}`,
  );
}
