export type AnalysisGroundingFailureReason =
  | "invalid_product_type"
  | "unsupported_product_analysis"
  | "source_too_sparse"
  | "name_evidence_missing"
  | "name_evidence_not_grounded"
  | "moments_missing"
  | "moment_count_invalid"
  | "moment_not_object"
  | "moment_evidence_missing"
  | "moment_evidence_not_grounded";

export class AnalysisGroundingError extends Error {
  readonly code: AnalysisGroundingFailureReason;
  readonly index?: number;

  constructor(
    code: AnalysisGroundingFailureReason,
    message: string,
    index?: number,
  ) {
    super(message);
    this.name = "AnalysisGroundingError";
    this.code = code;
    this.index = index;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PRODUCT_TYPES = new Set(["saas", "not_saas", "unknown"]);
const MIN_EVIDENCE_LENGTH = 12;
const MAX_EVIDENCE_LENGTH = 320;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function firstString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function evidenceIsGrounded(evidence: string, snapshot: string): boolean {
  if (
    evidence.length < MIN_EVIDENCE_LENGTH ||
    evidence.length > MAX_EVIDENCE_LENGTH
  ) {
    return false;
  }

  const needle = normalizeText(evidence);
  const haystack = normalizeText(snapshot);

  return needle.length > 0 && haystack.includes(needle);
}

function rootRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new AnalysisGroundingError(
      "invalid_product_type",
      "Analysis provider output was not an object.",
    );
  }

  return isRecord(value.analysis) ? value.analysis : value;
}

export function validateGroundedSaaSAnalysis(
  value: unknown,
  snapshot: string,
): void {
  const root = rootRecord(value);
  const productType = firstString(root, "product_type");

  if (!PRODUCT_TYPES.has(productType)) {
    throw new AnalysisGroundingError(
      "invalid_product_type",
      "Analysis provider did not return a supported product classification.",
    );
  }

  if (normalizeText(snapshot).length < 80) {
    throw new AnalysisGroundingError(
      "source_too_sparse",
      "The public product page did not provide enough readable content for reliable analysis.",
    );
  }

  if (productType !== "saas") {
    throw new AnalysisGroundingError(
      "unsupported_product_analysis",
      "This URL does not provide enough evidence of a public SaaS product for NextAction analysis.",
    );
  }

  const nameEvidence = firstString(root, "name_evidence");
  if (!nameEvidence) {
    throw new AnalysisGroundingError(
      "name_evidence_missing",
      "Analysis provider did not provide evidence for the product name.",
    );
  }

  if (!evidenceIsGrounded(nameEvidence, snapshot)) {
    throw new AnalysisGroundingError(
      "name_evidence_not_grounded",
      "Analysis provider product-name evidence was not found in the page snapshot.",
    );
  }

  const momentsValue = root.moments;
  if (!Array.isArray(momentsValue)) {
    throw new AnalysisGroundingError(
      "moments_missing",
      "Analysis provider did not return a Moments array.",
    );
  }

  if (momentsValue.length < 3 || momentsValue.length > 8) {
    throw new AnalysisGroundingError(
      "moment_count_invalid",
      "Analysis provider returned an unsupported number of Moments.",
    );
  }

  for (let index = 0; index < momentsValue.length; index += 1) {
    const moment = momentsValue[index];

    if (!isRecord(moment)) {
      throw new AnalysisGroundingError(
        "moment_not_object",
        "Analysis provider returned an invalid Moment.",
        index,
      );
    }

    const evidence = firstString(moment, "evidence");
    if (!evidence) {
      throw new AnalysisGroundingError(
        "moment_evidence_missing",
        "Every Moment must include evidence from the page snapshot.",
        index,
      );
    }

    if (!evidenceIsGrounded(evidence, snapshot)) {
      throw new AnalysisGroundingError(
        "moment_evidence_not_grounded",
        "A Moment evidence string was not found in the page snapshot.",
        index,
      );
    }
  }
}
