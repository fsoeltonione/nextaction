import { isRecord } from "../http.ts";

export type AnalysisContentParseFailureReason =
  | "empty_content"
  | "malformed_json"
  | "invalid_root";

export class AnalysisContentParseError extends Error {
  readonly reason: AnalysisContentParseFailureReason;

  constructor(reason: AnalysisContentParseFailureReason, message: string) {
    super(message);
    this.name = "AnalysisContentParseError";
    this.reason = reason;
  }
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim().replace(/^\uFEFF/, "");

  if (trimmed.startsWith("```")) {
    const firstLineEnd = trimmed.indexOf("\n");
    if (firstLineEnd === -1) {
      return trimmed;
    }

    const language = trimmed.slice(3, firstLineEnd).trim().toLowerCase();
    if (language === "json" || language === "") {
      const withoutOpeningFence = trimmed.slice(firstLineEnd + 1);
      if (withoutOpeningFence.endsWith("```")) {
        return withoutOpeningFence
          .slice(0, -3)
          .trim();
      }
    }
  }

  return trimmed;
}

export function parseAnalysisProviderContent(content: string): unknown {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new AnalysisContentParseError(
      "empty_content",
      "Analysis provider assistant content was empty.",
    );
  }

  const normalized = stripCodeFence(content);

  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    throw new AnalysisContentParseError(
      "malformed_json",
      "Analysis provider assistant content was not valid JSON.",
    );
  }
}

export function isObjectAnalysisContent(value: unknown): boolean {
  return isRecord(value);
}
