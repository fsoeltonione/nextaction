export type PostgrestResultLike = {
  error: { code?: string } | null;
};

export type PostgrestRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * Retry read-only PostgREST calls when the gateway reports the transient
 * JWT-claims validation error PGRST303. Other errors are returned immediately.
 *
 * Do not use this helper for writes/RPCs: retrying a mutation after a lost
 * response can repeat a side effect.
 */
export async function retryPostgrestJwtValidation<T extends PostgrestResultLike>(
  operation: () => PromiseLike<T>,
  options: PostgrestRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 100);
  const wait = options.sleep ?? sleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await operation();
    if (result.error?.code !== "PGRST303" || attempt === maxAttempts) {
      return result;
    }

    await wait(baseDelayMs * attempt);
  }

  throw new Error("Unreachable PostgREST retry state.");
}
