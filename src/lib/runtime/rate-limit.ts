import { createAdminClient } from "@/utils/supabase/admin";
import { sha256Hex } from "@/lib/credentials";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
  request_count: number;
};

export async function checkRateLimit(
  scope: string,
  subject: string,
  limit: number,
): Promise<RateLimitResult> {
  const admin = createAdminClient();
  const subjectHash = await sha256Hex(subject);

  const { data, error } = await admin.rpc("check_runtime_rate_limit", {
    p_scope: scope,
    p_subject_hash: subjectHash,
    p_limit: limit,
    p_window_seconds: 60,
  });

  if (error) {
    throw new Error("Rate limit service unavailable.");
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error("Rate limit service returned no result.");
  }

  return {
    allowed: Boolean(row.allowed),
    remaining: Number(row.remaining),
    retry_after_seconds: Number(row.retry_after_seconds),
    request_count: Number(row.request_count),
  };
}
