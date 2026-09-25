import { createClient } from "@/utils/supabase/server";
import { normalizeProductUrl } from "@/lib/url";
import {
  createRequestId,
  jsonError,
  jsonSuccess,
  readJsonBody,
  isRecord,
  HttpError,
} from "@/lib/http";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const requestId = createRequestId();

  try {
    const body = await readJsonBody(request);
    if (!isRecord(body)) {
      throw new HttpError(400, "invalid_payload", "Invalid product confirmation payload.");
    }

    const { data: { user } } = await (await createClient()).auth.getUser();
    if (!user) return jsonError(requestId, 401, "unauthorized", "Authentication is required.");

    const urlInput = body.url;
    const name = asString(body.name);
    const description = asString(body.description);
    const rawMoments = body.moments;

    const normalized = normalizeProductUrl(urlInput);
    if (!name || name.length > 160) {
      throw new HttpError(400, "invalid_product_name", "Product name is invalid.");
    }
    if (description.length > 2000) {
      throw new HttpError(400, "invalid_product_description", "Product description is too long.");
    }
    if (!Array.isArray(rawMoments) || rawMoments.length < 1 || rawMoments.length > 20) {
      throw new HttpError(400, "invalid_moments", "Provide between 1 and 20 moments.");
    }

    const moments = rawMoments.map((item) => {
      if (!isRecord(item)) {
        throw new HttpError(400, "invalid_moment", "Each moment must be an object.");
      }
      const key = asString(item.key ?? item.id);
      const label = asString(item.label);
      const momentDescription = asString(item.description);
      if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key) || key.length > 100 || !label || label.length > 160) {
        throw new HttpError(400, "invalid_moment", "A moment definition is invalid.");
      }
      return { key, label, description: momentDescription || null };
    });

    if (new Set(moments.map((moment) => moment.key)).size !== moments.length) {
      throw new HttpError(409, "duplicate_moment_key", "Moment keys must be unique.");
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("confirm_product_activation", {
      p_canonical_url: normalized.value,
      p_domain: normalized.hostname,
      p_name: name,
      p_description: description || "",
      p_moments: moments,
    });

    if (error) {
      if (error.code === "42501") return jsonError(requestId, 403, "not_authorized", "You are not authorized to activate this workspace.");
      if (error.code === "22023") return jsonError(requestId, 400, "invalid_payload", "The product confirmation is invalid.");
      if (error.code === "23505") return jsonError(requestId, 409, "activation_conflict", "This activation conflicts with existing data.");
      console.error("Product confirmation failed", { requestId, code: error.code });
      return jsonError(requestId, 500, "product_confirmation_failed", "Unable to confirm the product.");
    }

    const result = data?.[0];
    if (!result) return jsonError(requestId, 500, "product_confirmation_failed", "Unable to confirm the product.");

    return jsonSuccess({
      product: {
        id: result.result_product_id,
        workspace_id: result.result_workspace_id,
        moment_count: result.result_moment_count,
        canonical_url: normalized.value,
      },
    }, requestId);
  } catch (error) {
    if (error instanceof HttpError) return jsonError(requestId, error.status, error.code, error.message);
    console.error("Product confirmation route failed", { requestId, error });
    return jsonError(requestId, 500, "product_confirmation_failed", "Unable to confirm the product.");
  }
}