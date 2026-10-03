import { createClient } from "@/utils/supabase/server";
import { normalizeHttpDestinationUrl } from "@/lib/external-url";
import {
  createRequestId,
  jsonError,
  jsonSuccess,
  readJsonBody,
  isRecord,
  HttpError,
} from "@/lib/http";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNetworkMomentKeys(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new HttpError(
      400,
      "invalid_offer_network_moments",
      "network_moment_keys must be an array.",
    );
  }

  const keys = value.map(asString);
  if (
    keys.length < 1 ||
    keys.length > 20 ||
    keys.some(
      (key) =>
        !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key) || key.length > 100,
    ) ||
    new Set(keys).size !== keys.length
  ) {
    throw new HttpError(
      400,
      "invalid_offer_network_moments",
      "Select one or more valid target network moments.",
    );
  }

  return keys;
}

export async function POST(request: Request) {
  const requestId = createRequestId();

  try {
    const body = await readJsonBody(request);
    if (!isRecord(body)) {
      throw new HttpError(
        400,
        "invalid_payload",
        "Invalid offer payload.",
      );
    }

    const workspaceId = asString(body.workspace_id);
    if (!workspaceId) {
      throw new HttpError(
        409,
        "workspace_selection_required",
        "Select a workspace before creating the offer.",
      );
    }

    const title = asString(body.title);
    const description = asString(body.description);
    const ctaLabel = asString(body.cta_label) || "Learn More";
    const destinationInput =
      asString(body.destination_url) || asString(body.cta_url);

    if (!title || title.length > 160) {
      throw new HttpError(
        400,
        "invalid_offer_title",
        "Offer title is invalid.",
      );
    }

    if (description.length > 2000) {
      throw new HttpError(
        400,
        "invalid_offer_description",
        "Offer description is too long.",
      );
    }

    if (ctaLabel.length > 80) {
      throw new HttpError(
        400,
        "invalid_cta_label",
        "CTA label is invalid.",
      );
    }

    let destinationUrl: string;
    try {
      destinationUrl = normalizeHttpDestinationUrl(destinationInput);
    } catch {
      throw new HttpError(
        400,
        "invalid_destination_url",
        "A valid destination URL is required.",
      );
    }

    const rawMomentIds = Array.isArray(body.moment_ids)
      ? body.moment_ids
      : null;
    const rawTargetKeys = Array.isArray(body.target_moments)
      ? body.target_moments
      : null;
    const hasNetworkMomentKeys = Object.prototype.hasOwnProperty.call(
      body,
      "network_moment_keys",
    );
    const networkMomentKeys = hasNetworkMomentKeys
      ? normalizeNetworkMomentKeys(body.network_moment_keys)
      : null;

    const legacyTargetingSelected =
      rawMomentIds !== null || rawTargetKeys !== null;

    if (networkMomentKeys && legacyTargetingSelected) {
      throw new HttpError(
        400,
        "conflicting_offer_targets",
        "Network Moment targets cannot be combined with legacy Moment targets.",
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return jsonError(
        requestId,
        401,
        "unauthorized",
        "Authentication is required.",
      );
    }

    const { data: membership } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return jsonError(
        requestId,
        403,
        "not_authorized",
        "You are not authorized for this workspace.",
      );
    }

    const { data: capability } = await supabase
      .from("workspace_capabilities")
      .select("capability")
      .eq("workspace_id", workspaceId)
      .eq("capability", "reach_customers")
      .eq("status", "active")
      .maybeSingle();

    if (!capability) {
      return jsonError(
        requestId,
        409,
        "capability_not_selected",
        "Select Reach Customers before creating an offer.",
      );
    }

    let offerId: string | null = null;

    if (networkMomentKeys) {
      const { data, error } = await supabase.rpc(
        "create_network_offer_activation_v1",
        {
          p_workspace_id: workspaceId,
          p_title: title,
          p_description: description || "",
          p_cta_label: ctaLabel,
          p_destination_url: destinationUrl,
          p_network_moment_keys: networkMomentKeys,
        },
      );

      if (error) {
        if (error.code === "42501") {
          return jsonError(
            requestId,
            403,
            "not_authorized",
            "You are not authorized to target those Network Moments.",
          );
        }

        if (error.code === "22023" || error.code === "23505") {
          return jsonError(
            requestId,
            400,
            "invalid_offer_network_moments",
            "The Network Moment targeting is invalid.",
          );
        }

        console.error("Network Moment offer creation failed", {
          requestId,
          code: error.code,
        });

        return jsonError(
          requestId,
          500,
          "offer_creation_failed",
          "Unable to create the offer.",
        );
      }

      const result = data?.[0];
      offerId = result?.offer_id ?? null;
    } else {
      let momentIds: string[] = [];

      if (rawMomentIds) {
        momentIds = rawMomentIds.map(asString);
      } else if (rawTargetKeys) {
        const targetKeys = rawTargetKeys.map(asString);

        if (
          targetKeys.length < 1 ||
          targetKeys.length > 20 ||
          targetKeys.some(
            (key) => !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key),
          ) ||
          new Set(targetKeys).size !== targetKeys.length
        ) {
          throw new HttpError(
            400,
            "invalid_offer_moments",
            "Select one or more valid target moments.",
          );
        }

        const { data: workspaceProducts, error: workspaceProductsError } =
          await supabase
            .from("products")
            .select("id")
            .eq("workspace_id", workspaceId);

        if (workspaceProductsError) {
          throw new HttpError(
            500,
            "moment_lookup_failed",
            "Unable to resolve target moments.",
          );
        }

        if (!workspaceProducts?.length) {
          throw new HttpError(
            403,
            "invalid_offer_moments",
            "One or more target moments are not available in this workspace.",
          );
        }

        const { data: moments, error: momentsError } = await supabase
          .from("moments")
          .select("id, moment_key, status")
          .in("moment_key", targetKeys)
          .eq("status", "active")
          .in(
            "product_id",
            workspaceProducts.map((product) => product.id),
          );

        if (momentsError) {
          throw new HttpError(
            500,
            "moment_lookup_failed",
            "Unable to resolve target moments.",
          );
        }

        const byKey = new Map(
          (moments ?? []).map((moment) => [moment.moment_key, moment.id]),
        );

        if (targetKeys.some((key) => !byKey.has(key))) {
          throw new HttpError(
            403,
            "invalid_offer_moments",
            "One or more target moments are not available in this workspace.",
          );
        }

        momentIds = targetKeys.map((key) => byKey.get(key) as string);
      }

      if (
        momentIds.length < 1 ||
        momentIds.length > 20 ||
        momentIds.some((id) => !isUuid(id)) ||
        new Set(momentIds).size !== momentIds.length
      ) {
        throw new HttpError(
          400,
          "invalid_offer_moments",
          "Select one or more valid target moments.",
        );
      }

      const { data, error } = await supabase.rpc(
        "create_offer_activation_v2",
        {
          p_workspace_id: workspaceId,
          p_title: title,
          p_description: description || "",
          p_cta_label: ctaLabel,
          p_destination_url: destinationUrl,
          p_moment_ids: momentIds,
        },
      );

      if (error) {
        if (error.code === "42501") {
          return jsonError(
            requestId,
            403,
            "not_authorized",
            "You are not authorized to target those moments.",
          );
        }

        if (error.code === "22023" || error.code === "23505") {
          return jsonError(
            requestId,
            400,
            "invalid_offer",
            "The offer configuration is invalid.",
          );
        }

        console.error("Offer creation failed", {
          requestId,
          code: error.code,
        });

        return jsonError(
          requestId,
          500,
          "offer_creation_failed",
          "Unable to create the offer.",
        );
      }

      const result = data?.[0];
      offerId = result?.offer_id ?? null;
    }

    if (!offerId) {
      return jsonError(
        requestId,
        500,
        "offer_creation_failed",
        "Unable to create the offer.",
      );
    }

    const { data: offer, error: offerError } = await supabase
      .from("offers")
      .select("*")
      .eq("id", offerId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (offerError || !offer) {
      return jsonError(
        requestId,
        500,
        "offer_creation_failed",
        "Unable to load the new offer.",
      );
    }

    return jsonSuccess({ offer }, requestId, 201);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(
        requestId,
        error.status,
        error.code,
        error.message,
      );
    }

    console.error("Offer route failed", { requestId, error });
    return jsonError(
      requestId,
      500,
      "offer_creation_failed",
      "Unable to create the offer.",
    );
  }
}
