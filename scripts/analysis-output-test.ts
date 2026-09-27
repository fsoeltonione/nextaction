import assert from "node:assert/strict";
import test from "node:test";
import { parseAnalysisOutput } from "../src/lib/runtime/analysis-output.ts";

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
  assert.throws(
    () =>
      parseAnalysisOutput({
        name: "Example",
        description: "A placeholder site.",
        moments: [],
      }),
    /invalid result/i,
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
  assert.throws(
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
    /invalid result/i,
  );

  assert.throws(
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
    /invalid result/i,
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

test("resolves duplicate normalized Moment keys deterministically", () => {
  const result = parseAnalysisOutput({
    name: "Example",
    description: "A site.",
    moments: [
      { key: "site-created", label: "Site Created" },
      { key: "site_created", label: "Another Site Event" },
    ],
  });

  assert.deepEqual(
    result.moments.map((moment) => moment.key),
    ["site_created", "site_created_2"],
  );
});
