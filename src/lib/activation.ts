export const CAPABILITIES = ["make_money", "reach_customers"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export type ActivationStep =
  | "url"
  | "product_understanding"
  | "intent"
  | "capability_setup"
  | "verification"
  | "ready";

export interface ActivationDerivationInput {
  hasProduct: boolean;
  productConfirmed: boolean;
  capabilities: Capability[];
  makeMoneyIntegration: { exists: boolean; verified: boolean };
  reachCustomersOffer: boolean;
}

export function deriveActivationStep(input: ActivationDerivationInput): ActivationStep {
  if (!input.hasProduct) return "url";
  if (!input.productConfirmed) return "product_understanding";
  if (input.capabilities.length === 0) return "intent";

  const makeMoneyPending =
    input.capabilities.includes("make_money") &&
    !input.makeMoneyIntegration.exists;

  const makeMoneyNeedsVerification =
    input.capabilities.includes("make_money") &&
    input.makeMoneyIntegration.exists &&
    !input.makeMoneyIntegration.verified;

  const reachCustomersPending =
    input.capabilities.includes("reach_customers") &&
    !input.reachCustomersOffer;

  if (makeMoneyPending || reachCustomersPending) return "capability_setup";
  if (makeMoneyNeedsVerification) return "verification";

  return "ready";
}