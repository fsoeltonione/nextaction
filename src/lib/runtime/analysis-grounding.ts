function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type AnalysisProductType = "saas" | "not_saas" | "unknown";

export class AnalysisGroundingError extends Error {
  readonly code:
    | "missing_product_type"
    | "invalid_product_type"
    | "unsupported_product_analysis";

  constructor(
    code: AnalysisGroundingError["code"],
    message: string,
  ) {
    super(message);
    this.name = "AnalysisGroundingError";
    this.code = code;
  }
}

function normalizeForEvidence(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function firstString(
  record: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function rootObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new AnalysisGroundingError(
      "invalid_product_type",
      "Analysis provider returned an invalid grounding object.",
    );
  }

  return isRecord(value.analysis) ? value.analysis : value;
}

export function getAnalysisProductType(value: unknown): AnalysisProductType {
  const root = rootObject(value);
  const raw = firstString(root, ["product_type", "productType", "type"]).toLowerCase();

  if (!raw) {
    throw new AnalysisGroundingError(
      "missing_product_type",
      "Analysis provider did not classify the supplied page.",
    );
  }

  if (raw !== "saas" && raw !== "not_saas" && raw !== "unknown") {
    throw new AnalysisGroundingError(
      "invalid_product_type",
      "Analysis provider returned an invalid product classification.",
    );
  }

  return raw;
}

export function validateGroundedSaaSAnalysis(
  value: unknown,
  evidenceCorpus: string,
): void {
  const root = rootObject(value);
  const productType = getAnalysisProductType(root);

  if (productType !== "saas") {
    throw new AnalysisGroundingError(
      "unsupported_product_analysis",
      productType === "not_saas"
        ? "This URL does not appear to be a public SaaS product."
        : "NextAction could not confidently understand this product from its public page.",
    );
  }

  const rawMoments = root.moments;
  if (!Array.isArray(rawMoments) || rawMoments.length < 3 || rawMoments.length > 8) {
    throw new AnalysisGroundingError(
      "unsupported_product_analysis",
      "NextAction could not identify enough evidence-backed product Moments from this page.",
    );
  }

  const corpus = normalizeForEvidence(evidenceCorpus);
  if (!corpus) {
    throw new AnalysisGroundingError(
      "unsupported_product_analysis",
      "NextAction could not find enough public product information to analyze this page.",
    );
  }

  const nameEvidence = firstString(root, ["name_evidence", "nameEvidence"]);
  if (!nameEvidence || !corpus.includes(normalizeForEvidence(nameEvidence))) {
    throw new AnalysisGroundingError(
      "unsupported_product_analysis",
      "The detected product name was not supported by the scanned page.",
    );
  }

  const seen = new Set<string>();

  for (const moment of rawMoments) {
    if (!isRecord(moment)) {
      throw new AnalysisGroundingError(
        "unsupported_product_analysis",
        "A proposed Moment was not grounded in the scanned page.",
      );
    }

    const evidence = firstString(moment, ["evidence", "source_evidence", "evidence_text"]);
    if (!evidence || evidence.length < 12 || evidence.length > 320) {
      throw new AnalysisGroundingError(
        "unsupported_product_analysis",
        "A proposed Moment did not contain usable page evidence.",
      );
    }

    if (!corpus.includes(normalizeForEvidence(evidence))) {
      throw new AnalysisGroundingError(
        "unsupported_product_analysis",
        "A proposed Moment was not supported by the scanned page.",
      );
    }

    const label = firstString(moment, ["label", "name", "title", "moment"]);
    const key = firstString(moment, ["key", "id", "moment_key", "slug"]) || label;
    const normalizedKey = normalizeForEvidence(key);

    if (!normalizedKey || seen.has(normalizedKey)) {
      throw new AnalysisGroundingError(
        "unsupported_product_analysis",
        "The analysis contained duplicate or unusable Moments.",
      );
    }

    seen.add(normalizedKey);
  }
}
