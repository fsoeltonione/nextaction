import { isRecord } from "../http.ts";

export type AnalysisMoment = {
  key: string;
  label: string;
  description?: string;
};

export type AnalysisResult = {
  url: string;
  name: string;
  description: string;
  moments: AnalysisMoment[];
};

export type AnalysisOutputFailureReason =
  | "root_not_object"
  | "moments_missing"
  | "moments_not_array"
  | "too_many_moments"
  | "moment_not_object"
  | "moment_label_missing"
  | "moment_label_too_long"
  | "moment_description_too_long"
  | "moment_key_empty"
  | "duplicate_moment_key"
  | "name_missing"
  | "name_too_long"
  | "description_missing"
  | "description_too_long";

export class AnalysisOutputValidationError extends Error {
  readonly reason: AnalysisOutputFailureReason;
  readonly index?: number;

  constructor(
    reason: AnalysisOutputFailureReason,
    message: string,
    index?: number,
  ) {
    super(message);
    this.name = "AnalysisOutputValidationError";
    this.reason = reason;
    this.index = index;
  }
}

const NAME_KEYS = ["name", "product_name", "title"];
const DESCRIPTION_KEYS = ["description", "summary", "overview"];
const MOMENTS_KEYS = ["moments", "key_moments", "commercial_moments"];
const MOMENT_KEY_KEYS = ["key", "id", "moment_key", "slug"];
const MOMENT_LABEL_KEYS = ["label", "name", "title", "moment"];
const MOMENT_DESCRIPTION_KEYS = ["description", "summary", "details"];

function firstString(
  record: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function prettyLabelFromKey(key: string): string {
  const words = key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "";

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function normalizeMomentKey(rawKey: string, label: string, index: number): string {
  const candidate = (rawKey || label).trim();

  let key = candidate
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 80);

  if (!key) {
    key = "moment_" + String(index + 1);
  }

  return key;
}

function normalizeRawMoments(
  root: Record<string, unknown>,
): unknown[] {
  let value: unknown = undefined;

  for (const key of MOMENTS_KEYS) {
    if (key in root) {
      value = root[key];
      break;
    }
  }

  if (value === undefined) {
    throw new AnalysisOutputValidationError(
      "moments_missing",
      "Analysis provider output did not include Moments.",
    );
  }

  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new AnalysisOutputValidationError(
        "moments_not_array",
        "Analysis provider Moments were not a valid array.",
      );
    }
  }

  if (Array.isArray(value)) return value;

  if (isRecord(value)) {
    return Object.entries(value).map(([key, item]) => {
      if (isRecord(item)) {
        return {
          ...item,
          key:
            typeof item.key === "string" && item.key.trim()
              ? item.key
              : key,
        };
      }

      return {
        key,
        label: typeof item === "string" ? item : key,
      };
    });
  }

  throw new AnalysisOutputValidationError(
    "moments_not_array",
    "Analysis provider Moments were not an array.",
  );
}

function normalizeRoot(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new AnalysisOutputValidationError(
      "root_not_object",
      "Analysis provider output was not an object.",
    );
  }

  if (isRecord(value.analysis)) return value.analysis;

  return value;
}

function derivedDescription(moments: AnalysisMoment[]): string {
  const labels = moments.slice(0, 3).map((moment) => moment.label);
  if (labels.length === 0) return "";

  return `A SaaS product with key moments including ${labels.join(", ")}.`;
}

export function parseAnalysisOutput(
  value: unknown,
  fallback?: { name?: string; description?: string },
): AnalysisResult {
  const root = normalizeRoot(value);
  const rawMoments = normalizeRawMoments(root);

  if (rawMoments.length < 1) {
    throw new AnalysisOutputValidationError(
      "moments_missing",
      "Analysis provider output contained no Moments.",
    );
  }

  if (rawMoments.length > 10) {
    throw new AnalysisOutputValidationError(
      "too_many_moments",
      "Analysis provider output contained too many Moments.",
    );
  }

  const moments: AnalysisMoment[] = [];

  for (let index = 0; index < rawMoments.length; index += 1) {
    const rawMoment = rawMoments[index];

    const record =
      typeof rawMoment === "string"
        ? { label: rawMoment }
        : isRecord(rawMoment)
          ? rawMoment
          : null;

    if (!record) {
      throw new AnalysisOutputValidationError(
        "moment_not_object",
        "A Moment was not an object.",
        index,
      );
    }

    const rawKey = firstString(record, MOMENT_KEY_KEYS);
    const rawLabel = firstString(record, MOMENT_LABEL_KEYS);
    const label = rawLabel || prettyLabelFromKey(rawKey);

    if (!label) {
      throw new AnalysisOutputValidationError(
        "moment_label_missing",
        "A Moment did not contain a usable label or key.",
        index,
      );
    }

    const normalizedLabel = label.slice(0, 120);
    if (label.length > 120) {
      throw new AnalysisOutputValidationError(
        "moment_label_too_long",
        "A Moment label was too long.",
        index,
      );
    }

    const rawDescription = firstString(record, MOMENT_DESCRIPTION_KEYS);
    const description =
      rawDescription.length > 0
        ? rawDescription.slice(0, 400)
        : undefined;

    if (rawDescription.length > 400) {
      throw new AnalysisOutputValidationError(
        "moment_description_too_long",
        "A Moment description was too long.",
        index,
      );
    }

    const key = normalizeMomentKey(rawKey, normalizedLabel, index);
    if (!key) {
      throw new AnalysisOutputValidationError(
        "moment_key_empty",
        "A Moment could not be normalized into a runtime key.",
        index,
      );
    }

    moments.push({
      key,
      label: normalizedLabel,
      ...(description ? { description } : {}),
    });
  }

  const uniqueKeys = new Set(moments.map((moment) => moment.key));
  if (uniqueKeys.size !== moments.length) {
    throw new AnalysisOutputValidationError(
      "duplicate_moment_key",
      "Analysis provider output contained duplicate Moment keys.",
    );
  }

  const providerName = firstString(root, NAME_KEYS);
  const fallbackName = fallback?.name?.trim() ?? "";
  const name = (providerName || fallbackName).slice(0, 160);

  if (!name) {
    throw new AnalysisOutputValidationError(
      "name_missing",
      "Analysis provider output did not contain a usable product name.",
    );
  }

  if ((providerName || fallbackName).length > 160) {
    throw new AnalysisOutputValidationError(
      "name_too_long",
      "Analysis provider product name was too long.",
    );
  }

  const providerDescription = firstString(root, DESCRIPTION_KEYS);
  const fallbackDescription = fallback?.description?.trim() ?? "";
  const generatedDescription =
    providerDescription || fallbackDescription || derivedDescription(moments);
  const description = generatedDescription.slice(0, 600);

  if (!description) {
    throw new AnalysisOutputValidationError(
      "description_missing",
      "Analysis provider output did not contain a usable product description.",
    );
  }

  if (generatedDescription.length > 600) {
    throw new AnalysisOutputValidationError(
      "description_too_long",
      "Analysis provider product description was too long.",
    );
  }

  return {
    url: typeof root.url === "string" ? root.url : "",
    name,
    description,
    moments,
  };
}
