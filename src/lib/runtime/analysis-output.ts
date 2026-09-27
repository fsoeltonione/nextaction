import { isRecord } from "@/lib/http";
import { HttpError } from "@/lib/http";

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

function normalizeMomentKey(rawKey: unknown, label: string): string {
  const candidate =
    typeof rawKey === "string" && rawKey.trim().length > 0
      ? rawKey
      : label;

  const key = candidate
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 80);

  if (!key) {
    throw new HttpError(
      502,
      "invalid_provider_output",
      "Analysis provider returned an invalid result.",
    );
  }

  return key;
}

export function parseAnalysisOutput(
  value: unknown,
  fallback?: { name?: string; description?: string },
): AnalysisResult {
  if (!isRecord(value)) {
    throw new HttpError(
      502,
      "invalid_provider_output",
      "Analysis provider returned an invalid result.",
    );
  }

  const fallbackName = fallback?.name?.trim() ?? "";
  const fallbackDescription = fallback?.description?.trim() ?? "";
  const name =
    typeof value.name === "string" && value.name.trim().length > 0
      ? value.name.trim()
      : fallbackName;
  const description =
    typeof value.description === "string" && value.description.trim().length > 0
      ? value.description.trim()
      : fallbackDescription;

  const rawMoments = Array.isArray(value.moments) ? value.moments : [];

  if (
    name.length === 0 ||
    name.length > 160 ||
    description.length === 0 ||
    description.length > 600 ||
    rawMoments.length < 1 ||
    rawMoments.length > 10
  ) {
    throw new HttpError(
      502,
      "invalid_provider_output",
      "Analysis provider returned an invalid result.",
    );
  }

  const moments: AnalysisMoment[] = [];

  for (const rawMoment of rawMoments) {
    if (!isRecord(rawMoment)) {
      throw new HttpError(
        502,
        "invalid_provider_output",
        "Analysis provider returned an invalid result.",
      );
    }

    const label =
      typeof rawMoment.label === "string" ? rawMoment.label.trim() : "";
    const momentDescription =
      typeof rawMoment.description === "string"
        ? rawMoment.description.trim()
        : undefined;

    if (
      label.length === 0 ||
      label.length > 120 ||
      (momentDescription !== undefined && momentDescription.length > 400)
    ) {
      throw new HttpError(
        502,
        "invalid_provider_output",
        "Analysis provider returned an invalid result.",
      );
    }

    const key = normalizeMomentKey(
      typeof rawMoment.key === "string"
        ? rawMoment.key
        : typeof rawMoment.id === "string"
          ? rawMoment.id
          : undefined,
      label,
    );

    moments.push({
      key,
      label,
      ...(momentDescription ? { description: momentDescription } : {}),
    });
  }

  const uniqueKeys = new Set(moments.map((moment) => moment.key));
  if (uniqueKeys.size !== moments.length) {
    throw new HttpError(
      502,
      "invalid_provider_output",
      "Analysis provider returned duplicate Moment keys.",
    );
  }

  return {
    url: typeof value.url === "string" ? value.url : "",
    name: name.slice(0, 160),
    description: description.slice(0, 600),
    moments,
  };
}
