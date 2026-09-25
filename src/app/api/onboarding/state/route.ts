import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createRequestId, jsonError, jsonSuccess } from "@/lib/http";
import {
  CAPABILITIES,
  type Capability,
  deriveActivationStep,
} from "@/lib/activation";

export async function GET() {
  const requestId = createRequestId();

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (!user) {
      return jsonError(requestId, 401, "unauthorized", "Authentication is required.");
    }
    if (authError) {
      return jsonError(requestId, 401, "unauthorized", "Authentication is required.");
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      return jsonError(requestId, 500, "workspace_lookup_failed", "Unable to load activation state.");
    }

    if (!membership) {
      return jsonSuccess({
        state: {
          step: "url",
          workspace: null,
          product: null,
          capabilities: [],
          setup: {
            make_money: { exists: false, verified: false, integration_id: null },
            reach_customers: { configured: false, offer_id: null },
          },
        },
      }, requestId);
    }

    const workspaceId = membership.workspace_id;

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, name, description, canonical_url, domain, understanding_status, updated_at, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (productError) {
      return jsonError(requestId, 500, "product_lookup_failed", "Unable to load activation state.");
    }

    if (!product) {
      return jsonSuccess({
        state: {
          step: "url",
          workspace: { id: workspaceId },
          product: null,
          capabilities: [],
          setup: {
            make_money: { exists: false, verified: false, integration_id: null },
            reach_customers: { configured: false, offer_id: null },
          },
        },
      }, requestId);
    }

    const [{ data: moments, error: momentsError }, { data: capabilityRows, error: capabilityError }, { data: integration, error: integrationError }] = await Promise.all([
      supabase
        .from("moments")
        .select("id, moment_key, label, description, status, updated_at")
        .eq("product_id", product.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("workspace_capabilities")
        .select("capability, status")
        .eq("workspace_id", workspaceId)
        .eq("status", "active"),
      supabase
        .from("integrations")
        .select("id, status, last_seen_at")
        .eq("product_id", product.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (momentsError || capabilityError || integrationError) {
      return jsonError(requestId, 500, "activation_lookup_failed", "Unable to load activation state.");
    }

    const activeMoments = (moments ?? []).filter((moment) => moment.status === "active");
    const capabilities = (capabilityRows ?? [])
      .map((row) => row.capability)
      .filter((value): value is Capability => CAPABILITIES.includes(value as Capability));

    let offerId: string | null = null;
    if (activeMoments.length > 0) {
      const { data: links } = await supabase
        .from("offer_moments")
        .select("offer_id")
        .in("moment_id", activeMoments.map((moment) => moment.id));

      const offerIds = [...new Set((links ?? []).map((link) => link.offer_id))];
      if (offerIds.length > 0) {
        const { data: offer } = await supabase
          .from("offers")
          .select("id")
          .in("id", offerIds)
          .eq("workspace_id", workspaceId)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        offerId = offer?.id ?? null;
      }
    }

    const step = deriveActivationStep({
      hasProduct: true,
      productConfirmed: product.understanding_status === "confirmed",
      capabilities,
      makeMoneyIntegration: {
        exists: Boolean(integration),
        verified: Boolean(integration?.last_seen_at),
      },
      reachCustomersOffer: Boolean(offerId),
    });

    return jsonSuccess({
      state: {
        step,
        workspace: { id: workspaceId },
        product: { ...product, moments: activeMoments },
        capabilities,
        setup: {
          make_money: {
            exists: Boolean(integration),
            verified: Boolean(integration?.last_seen_at),
            integration_id: integration?.id ?? null,
          },
          reach_customers: {
            configured: Boolean(offerId),
            offer_id: offerId,
          },
        },
      },
    }, requestId);
  } catch (error) {
    console.error("Activation state lookup failed", { requestId, error });
    return jsonError(requestId, 500, "activation_state_failed", "Unable to load activation state.");
  }
}