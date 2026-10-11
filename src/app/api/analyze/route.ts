import { jsonError } from "@/lib/http";
import { createRequestId } from "@/lib/http";

/**
 * Product URL analysis was intentionally removed from the MVP.
 * Publishers now declare Moments explicitly and call show_ads() from their own actions.
 * Keep this route as a short-lived compatibility response so old clients fail closed
 * instead of accidentally re-enabling crawling or an AI provider.
 */
export async function POST() {
  const requestId = createRequestId();
  return jsonError(
    requestId,
    410,
    "product_analysis_removed",
    "Product URL analysis has been removed. Define Moments explicitly and use the NextAction embed.",
  );
}
