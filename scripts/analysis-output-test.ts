import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAnalysisOutput,
  AnalysisOutputValidationError,
} from "../src/lib/runtime/analysis-output.ts";
import {
  AnalysisGroundingError,
  validateGroundedSaaSAnalysis,
} from "../src/lib/runtime/analysis-grounding.ts";

function assertValidationFailure(
  fn: () => unknown,
  reason: AnalysisOutputValidationError["reason"],
) {
  assert.throws(
    fn,
    (error) =>
      error instanceof AnalysisOutputValidationError &&
      error.reason === reason,
  );
}

const valid = {
  url: "https://carrd.com",
  name: "Carrd",
  description: "A site builder for creating one-page websites.",
  moments: [
    {
      key: "site_created",
      label: "Site Created",
      description: "A new site has been created.",
      evidence: "A new site has been created.",
    },
    {
      id: "publish-site",
      label: "Site Published",
      description: "A site is published to a live URL.",
      evidence: "A site is published to a live URL.",
    },
  ],
};

test("preserves provider evidence on normalized Moments", () => {
  const result = parseAnalysisOutput(valid);
  assert.equal(result.moments[0].evidence, "A new site has been created.");
  assert.equal(result.moments[1].evidence, "A site is published to a live URL.");
});

test("normalizes Moment ids into runtime-safe snake_case keys", () => {
  const result = parseAnalysisOutput(valid);
  assert.equal(result.moments[0].key, "site_created");
  assert.equal(result.moments[1].key, "publish_site");
});

test("uses scanner metadata only for missing top-level name/description", () => {
  const result = parseAnalysisOutput(
    {
      moments: [
        {
          label: "Account Created",
        },
      ],
    },
    {
      name: "Carrd",
      description: "Site builder",
    },
  );

  assert.equal(result.name, "Carrd");
  assert.equal(result.description, "Site builder");
});

test("rejects an analysis with no Moments", () => {
  assertValidationFailure(
    () =>
      parseAnalysisOutput({
        name: "Example",
        description: "A placeholder site.",
        moments: [],
      }),
    "moments_missing",
  );
});

test("rejects duplicate normalized Moment keys", () => {
  assert.throws(
    () =>
      parseAnalysisOutput({
        name: "Example",
        description: "A site.",
        moments: [
          { key: "site-created", label: "Site Created" },
          { key: "site_created", label: "Another label" },
        ],
      }),
    /duplicate/i,
  );
});

test("rejects oversized labels and descriptions", () => {
  assertValidationFailure(
    () =>
      parseAnalysisOutput({
        name: "Example",
        description: "A site.",
        moments: [
          {
            label: "x".repeat(121),
          },
        ],
      }),
    "moment_label_too_long",
  );

  assertValidationFailure(
    () =>
      parseAnalysisOutput({
        name: "Example",
        description: "A site.",
        moments: [
          {
            label: "Site Created",
            description: "x".repeat(401),
          },
        ],
      }),
    "moment_description_too_long",
  );
});


test("rejects Moments whose explicit key cannot become a semantic runtime key", () => {
  assertValidationFailure(
    () =>
      parseAnalysisOutput({
        name: "Example",
        description: "A site.",
        moments: [{ key: "!!!", label: "Invoice Created" }],
      }),
    "moment_key_empty",
  );
});

test("accepts a provider analysis wrapper", () => {
  const result = parseAnalysisOutput({
    analysis: {
      name: "Example",
      description: "A site.",
      moments: [{ key: "invoice-created", label: "Invoice Created" }],
    },
  });

  assert.equal(result.name, "Example");
  assert.equal(result.moments[0].key, "invoice_created");
});

test("accepts common field aliases without changing the canonical output", () => {
  const result = parseAnalysisOutput({
    product_name: "Example",
    overview: "A site.",
    key_moments: {
      invoice_created: "Invoice Created",
      site_published: { title: "Site Published", summary: "Site goes live." },
    },
  });

  assert.equal(result.name, "Example");
  assert.equal(result.description, "A site.");
  assert.deepEqual(
    result.moments.map((moment) => moment.key),
    ["invoice_created", "site_published"],
  );
});

test("accepts string Moments and derives human labels from keys", () => {
  const result = parseAnalysisOutput({
    name: "Example",
    description: "A site.",
    moments: [
      "Checkout Completed",
      { key: "invoice_created" },
    ],
  });

  assert.equal(result.moments[0].label, "Checkout Completed");
  assert.equal(result.moments[0].key, "checkout_completed");
  assert.equal(result.moments[1].label, "Invoice Created");
});

test("derives a compact description when the provider omits one", () => {
  const result = parseAnalysisOutput({
    name: "Example",
    moments: [
      { label: "Invoice Created" },
      { label: "Payment Received" },
    ],
  });

  assert.match(result.description, /Invoice Created/);
  assert.match(result.description, /Payment Received/);
});


const groundingSnapshot = [
  "Page title: Acme Invoice",
  "Meta description: Create and send professional invoices online.",
  "Create your invoice in minutes.",
  "Send invoices to customers and track payment status.",
  "Start your free trial today.",
].join("\n");

const groundedAnalysis = {
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

test("accepts grounded SaaS analysis", () => {
  assert.doesNotThrow(() =>
    validateGroundedSaaSAnalysis(groundedAnalysis, groundingSnapshot),
  );
});

test("rejects invented Moment evidence", () => {
  const invalid = structuredClone(groundedAnalysis);
  invalid.moments[1].evidence = "Connect your bank account automatically.";

  assert.throws(
    () => validateGroundedSaaSAnalysis(invalid, groundingSnapshot),
    (error) =>
      error instanceof AnalysisGroundingError &&
      error.code === "moment_evidence_not_grounded",
  );
});

test("rejects unsupported non-SaaS classification", () => {
  const notSaaS = {
    product_type: "not_saas",
    name: "SIM TNI",
    name_evidence: "Acme Invoice",
    description: "Restricted application.",
    moments: [],
  };

  assert.throws(
    () => validateGroundedSaaSAnalysis(notSaaS, groundingSnapshot),
    (error) =>
      error instanceof AnalysisGroundingError &&
      error.code === "unsupported_product_analysis",
  );
});
