import assert from "node:assert/strict";
import test from "node:test";
import {
  AnalysisGroundingError,
  validateGroundedSaaSAnalysis,
} from "../src/lib/runtime/analysis-grounding.ts";

const snapshot = [
  "Page title: Acme Invoice",
  "Meta description: Create and send professional invoices online.",
  "Create your invoice in minutes.",
  "Send invoices to customers and track payment status.",
  "Start your free trial today.",
].join("\n");

const grounded = {
  product_type: "saas",
  name: "Acme Invoice",
  name_evidence: "Page title: Acme Invoice",
  description: "Create and send professional invoices online.",
  moments: [
    {
      key: "invoice_created",
      label: "Invoice Created",
      evidence: "Create your invoice in minutes.",
    },
    {
      key: "invoice_sent",
      label: "Invoice Sent",
      evidence: "Send invoices to customers and track payment status.",
    },
    {
      key: "trial_started",
      label: "Trial Started",
      evidence: "Start your free trial today.",
    },
  ],
};

test("accepts grounded SaaS analysis with exact source evidence", () => {
  assert.doesNotThrow(() =>
    validateGroundedSaaSAnalysis(grounded, snapshot),
  );
});

test("rejects Moments whose evidence is invented", () => {
  const invalid = structuredClone(grounded);
  invalid.moments[1].evidence = "Connect your bank account automatically.";

  assert.throws(
    () => validateGroundedSaaSAnalysis(invalid, snapshot),
    (error) =>
      error instanceof AnalysisGroundingError &&
      error.code === "moment_evidence_not_grounded",
  );
});

test("rejects SaaS analysis without enough page evidence", () => {
  assert.throws(
    () =>
      validateGroundedSaaSAnalysis(
        grounded,
        "Page title: Unknown\nHello.",
      ),
    (error) =>
      error instanceof AnalysisGroundingError &&
      error.code === "source_too_sparse",
  );
});

test("rejects unsupported non-SaaS classification from the activation analyzer", () => {
  const notSaaS = {
    product_type: "not_saas",
    name: "SIM TNI",
    name_evidence: "SIM TNI",
    description: "A restricted application.",
    moments: [],
  };

  assert.throws(
    () => validateGroundedSaaSAnalysis(notSaaS, snapshot),
    (error) =>
      error instanceof AnalysisGroundingError &&
      error.code === "unsupported_product_analysis",
  );
});
