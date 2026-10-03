import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const environment = "staging";
const url = process.env.STAGING_NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.STAGING_SUPABASE_SECRET_KEY;
const integrationToken = process.env.STAGING_INTEGRATION_TOKEN;

if (!url || !key || !integrationToken) {
  console.error("Missing H3.1 staging runtime smoke inputs.");
  process.exit(2);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const networkKey = "h3_1_smoke_network_moment";

const { data: integrationRows, error: integrationError } = await supabase.rpc(
  "resolve_runtime_integration",
  { p_credential_hash: crypto.createHash("sha256").update(integrationToken).digest("hex") },
);
if (integrationError) throw integrationError;

const integration = Array.isArray(integrationRows) ? integrationRows[0] : integrationRows;
assert.equal(integration?.result_status, "ok");
assert.ok(integration?.result_integration_id);
assert.ok(integration?.result_product_id);
assert.ok(integration?.result_workspace_id);

const publisherIntegrationId = integration.result_integration_id;
const publisherProductId = integration.result_product_id;
const publisherWorkspaceId = integration.result_workspace_id;

const { data: moments, error: momentError } = await supabase
  .from("moments")
  .select("id,moment_key")
  .eq("product_id", publisherProductId)
  .eq("status", "active")
  .order("moment_key")
  .limit(1);

if (momentError) throw momentError;
const publisherMoment = moments?.[0];
assert.ok(publisherMoment?.id);
assert.ok(publisherMoment?.moment_key);

const { data: networkRows, error: networkError } = await supabase
  .from("network_moments")
  .select("id,key,status")
  .eq("key", networkKey)
  .limit(1);
if (networkError) throw networkError;

let networkMoment = networkRows?.[0];
if (!networkMoment) {
  const { data, error } = await supabase
    .from("network_moments")
    .insert({
      key: networkKey,
      label: "H3.1 staging smoke Network Moment",
      description: "Dedicated H3.1 runtime verification fixture.",
      status: "active",
    })
    .select("id,key,status")
    .single();
  if (error) throw error;
  networkMoment = data;
}
assert.equal(networkMoment.status, "active");

const { error: mappingError } = await supabase
  .from("moments")
  .update({ network_moment_id: networkMoment.id })
  .eq("id", publisherMoment.id);
if (mappingError) throw mappingError;

const { data: advertiserRows, error: advertiserError } = await supabase
  .from("workspace_capabilities")
  .select("workspace_id")
  .eq("capability", "reach_customers")
  .eq("status", "active");
if (advertiserError) throw advertiserError;

let advertiserWorkspaceId = null;
for (const row of advertiserRows ?? []) {
  if (row.workspace_id === publisherWorkspaceId) continue;

  const { data: balanceRows, error: balanceError } = await supabase.rpc(
    "runtime_get_workspace_balance",
    { p_workspace_id: row.workspace_id },
  );

  if (balanceError) continue;

  const balance = Array.isArray(balanceRows) ? balanceRows[0] : balanceRows;
  if (Number(balance?.result_available_units ?? 0) > 0) {
    advertiserWorkspaceId = row.workspace_id;
    break;
  }
}
assert.ok(
  advertiserWorkspaceId,
  "A cross-workspace advertiser with capacity is required.",
);

const offerTitle = "H3.1 Staging Network Smoke Offer";
const { data: existingOffers, error: offerLookupError } = await supabase
  .from("offers")
  .select("id,workspace_id,status,title")
  .eq("workspace_id", advertiserWorkspaceId)
  .eq("title", offerTitle)
  .limit(1);
if (offerLookupError) throw offerLookupError;

let offer = existingOffers?.[0];
if (!offer) {
  const { data, error } = await supabase
    .from("offers")
    .insert({
      workspace_id: advertiserWorkspaceId,
      title: offerTitle,
      description: "Dedicated H3.1 Network Moment runtime verification offer.",
      cta_label: "Verify",
      cta_url: "https://example.com/h3-1-smoke",
      destination_url: "https://example.com/h3-1-smoke",
      target_moments: [],
      status: "active",
    })
    .select("id,workspace_id,status,title")
    .single();
  if (error) throw error;
  offer = data;
}
assert.equal(offer.status, "active");

const { error: linkError } = await supabase
  .from("offer_network_moments")
  .upsert(
    {
      offer_id: offer.id,
      network_moment_id: networkMoment.id,
    },
    { onConflict: "offer_id,network_moment_id", ignoreDuplicates: true },
  );
if (linkError) throw linkError;

const idempotencyKey = `h3-1-runtime-smoke-${crypto.randomUUID()}`;
const { data: acceptedRows, error: acceptError } = await supabase.rpc(
  "runtime_accept_event",
  {
    p_integration_id: publisherIntegrationId,
    p_idempotency_key: idempotencyKey,
    p_event_type: publisherMoment.moment_key,
    p_occurred_at: new Date().toISOString(),
    p_payload: {
      source: "h3-1-runtime-smoke",
      network_key: networkKey,
    },
    p_request_id: crypto.randomUUID(),
  },
);
if (acceptError) throw acceptError;

const accepted = Array.isArray(acceptedRows) ? acceptedRows[0] : acceptedRows;
assert.ok(accepted?.result_event_id);

const { data: processedRows, error: processError } = await supabase.rpc(
  "runtime_process_event",
  { p_event_id: accepted.result_event_id },
);
if (processError) throw processError;

const processed = Array.isArray(processedRows)
  ? processedRows[0]
  : processedRows;
assert.equal(processed?.result_processed, true);
assert.ok(processed?.result_moment_occurrence_id);

const deliveryToken = `na_del_${crypto.randomBytes(32).toString("base64url")}`;
const deliveryNonce = `na_nonce_${crypto.randomBytes(32).toString("base64url")}`;
const deliveryTokenHash = crypto
  .createHash("sha256")
  .update(deliveryToken)
  .digest("hex");
const expiresAt = new Date(Date.now() + 300_000).toISOString();

const { data: decisionRows, error: decisionError } = await supabase.rpc(
  "runtime_create_decision_delivery",
  {
    p_integration_id: publisherIntegrationId,
    p_moment_key: publisherMoment.moment_key,
    p_request_id: crypto.randomUUID(),
    p_delivery_nonce: deliveryNonce,
    p_delivery_token_hash: deliveryTokenHash,
    p_expires_at: expiresAt,
  },
);
if (decisionError) throw decisionError;

const decision = Array.isArray(decisionRows) ? decisionRows[0] : decisionRows;
assert.equal(decision?.result_outcome, "filled");
assert.equal(decision?.result_offer_id, offer.id);
assert.equal(decision?.result_reason_code, null);
assert.ok(decision?.result_delivery_id);

console.log(
  `H3.1 Network Moment runtime smoke: PASS (${environment}) — cross-workspace offer matched`,
);
