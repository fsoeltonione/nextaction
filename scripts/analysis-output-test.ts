import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAnalysisOutput,
  AnalysisOutputValidationError,
} from "../src/lib/runtime/analysis-output.ts";
import {
  AnalysisGroundingError,
  getAnalysisProductType,
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

test("classifies provider output as SaaS only when explicitly declared", () => {
  assert.equal(
    getAnalysisProductType({
      product_type: "saas",
      name: "Carrd",
      moments: [],
    }),
    "saas",
  );
});

test("rejects a non-SaaS page before Moment parsing", () => {
  assert.throws(
    () =>
      validateGroundedSaaSAnalysis(
        {
          product_type: "not_saas",
          name: "Kompas.com",
          description: "News portal",
          moments: [],
        },
        "Kompas.com news portal",
      ),
    (error) =>
      error instanceof AnalysisGroundingError &&
      error.code === "unsupported_product_analysis",
  );
});

test("rejects SaaS Moments that cannot be found in the scanned page", () => {
  assert.throws(
    () =>
      validateGroundedSaaSAnalysis(
        {
          product_type: "saas",
          name: "Synthetic SaaS",
          name_evidence: "Synthetic SaaS",
          description: "Invoice management.",
          moments: [
            {
              key: "invoice_created",
              label: "Invoice Created",
              evidence: "Teams can create invoices.",
            },
            {
              key: "invoice_sent",
              label: "Invoice Sent",
              evidence: "This text is not on the page.",
            },
            {
              key: "invoice_paid",
              label: "Invoice Paid",
              evidence: "Customers can pay invoices.",
            },
          ],
        },
        "Synthetic SaaS. Teams can create invoices. Customers can pay invoices.",
      ),
    (error) =>
      error instanceof AnalysisGroundingError &&
      error.code === "unsupported_product_analysis",
  );
});

test("accepts SaaS Moments when name and Moment evidence are present verbatim", () => {
  assert.doesNotThrow(() =>
    validateGroundedSaaSAnalysis(
      {
        product_type: "saas",
        name: "Synthetic SaaS",
        name_evidence: "Synthetic SaaS",
        description: "Invoice management.",
        moments: [
          {
            key: "invoice_created",
            label: "Invoice Created",
            evidence: "Teams can create invoices.",
          },
          {
            key: "invoice_sent",
            label: "Invoice Sent",
            evidence: "Teams can send invoices to customers.",
          },
          {
            key: "invoice_paid",
            label: "Invoice Paid",
            evidence: "Customers can pay invoices.",
          },
        ],
      },
      [
        "Synthetic SaaS.",
        "Teams can create invoices.",
        "Teams can send invoices to customers.",
        "Customers can pay invoices.",
      ].join(" "),
    ),
  );
});

const valid = {
  url: "https://carrd.com",
  name: "Carrd",
  description: "A site builder for creating one-page websites.",
  moments: [
    {
      key: "site_created",
      label: "Site Created",
      description: "A new site has been created.",
    },
    {
      id: "publish-site",
      label: "Site Published",
      description: "A site is published to a live URL.",
    },
  ],
};

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

