import { parseAnalysisProviderResponse } from "../src/lib/runtime/analysis-provider-response.ts";
import { parseAnalysisOutput } from "../src/lib/runtime/analysis-output.ts";
import { parseAnalysisProviderContent } from "../src/lib/runtime/analysis-provider-content.ts";

const apiKey = process.env.ANALYSIS_API_KEY?.trim();
const baseUrl = process.env.ANALYSIS_BASE_URL?.trim();
const model = process.env.ANALYSIS_MODEL?.trim();

const MAX_RESPONSE_BODY_BYTES = 128 * 1024;
const MAX_BODY_PREVIEW_BYTES = 4 * 1024;

if (!apiKey || !baseUrl || !model) {
  console.error("Missing ANALYSIS_API_KEY, ANALYSIS_BASE_URL, or ANALYSIS_MODEL.");
  process.exit(2);
}

let endpoint;
try {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw new Error("unsupported protocol");
  }
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  endpoint = new URL("chat/completions", base);
} catch {
  console.error("ANALYSIS_BASE_URL is invalid.");
  process.exit(2);
}

async function readBoundedText(response, maxBytes) {
  if (!response.body) {
    const text = await response.text();
    const bytes = new TextEncoder().encode(text);
    return {
      text: new TextDecoder().decode(bytes.slice(0, maxBytes)),
      truncated: bytes.byteLength > maxBytes,
    };
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  let truncated = false;

  try {
    while (totalBytes < maxBytes) {
      const result = await reader.read();
      if (result.done) break;

      const value = result.value;
      const remaining = maxBytes - totalBytes;

      if (value.byteLength > remaining) {
        chunks.push(value.slice(0, remaining));
        totalBytes += remaining;
        truncated = true;
        await reader.cancel();
        break;
      }

      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    text: new TextDecoder().decode(merged),
    truncated,
  };
}

function redactSecrets(value) {
  return value
    .replaceAll(apiKey, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]");
}

function diagnosticPayload({ response, elapsedMs, responseText, responseTruncated }) {
  return {
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get("content-type") ?? "(missing)",
    responseUrl: (() => {
      try {
        const url = new URL(response.url);
        return url.origin + url.pathname;
      } catch {
        return "(invalid response URL)";
      }
    })(),
    redirected: response.redirected,
    elapsedMs,
    bodyPreview: redactSecrets(
      responseText.slice(0, MAX_BODY_PREVIEW_BYTES),
    ),
    bodyPreviewTruncated:
      responseTruncated || responseText.length > MAX_BODY_PREVIEW_BYTES,
  };
}

const timeoutMs = 25_000;
const MAX_ATTEMPTS = 3;
const TRANSIENT_STATUS_CODES = new Set([429, 502, 503, 504]);
const MAX_RETRY_DELAY_MS = 5_000;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}

function retryDelayMs(response, attempt) {
  const retryAfter = response.headers.get("retry-after");
  const retryAfterSeconds = Number(retryAfter);

  if (
    Number.isFinite(retryAfterSeconds) &&
    retryAfterSeconds >= 0 &&
    retryAfterSeconds <= 60
  ) {
    return Math.min(retryAfterSeconds * 1000, MAX_RETRY_DELAY_MS);
  }

  return Math.min(1000 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}

try {
  let response = null;
  let responseBody = null;
  let elapsedMs = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const attemptStartedAt = Date.now();

    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: [
                "Return exactly one JSON object for a SaaS product.",
                "The object must contain name, description, and moments.",
                "moments must be an array of 2 or more objects.",
                "Each Moment must have a label string and may have a key and description.",
                "Return no Markdown or prose.",
              ].join("\n"),
            },
            {
              role: "user",
              content: [
                "Product name: Synthetic SaaS",
                "Product description: A small fictional SaaS used for a contract test.",
                "Generate two commercially relevant Moments.",
              ].join("\n"),
            },
          ],
          temperature: 0,
          max_completion_tokens: 512,
          stream: false,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    elapsedMs = Date.now() - attemptStartedAt;

    if (response.ok) {
      responseBody = await readBoundedText(
        response,
        MAX_RESPONSE_BODY_BYTES,
      );
      break;
    }

    const body = await readBoundedText(
      response,
      MAX_RESPONSE_BODY_BYTES,
    );

    if (
      !TRANSIENT_STATUS_CODES.has(response.status) ||
      attempt === MAX_ATTEMPTS
    ) {
      console.error(
        "Configured analysis provider preflight failed:",
        diagnosticPayload({
          response,
          elapsedMs,
          responseText: body.text,
          responseTruncated: body.truncated,
        }),
      );
      process.exit(1);
    }

    console.warn(
      `Configured analysis provider preflight got transient HTTP ${response.status}; retrying (${attempt}/${MAX_ATTEMPTS - 1}).`,
    );
    await sleep(retryDelayMs(response, attempt));
  }

  if (!response || !response.ok || !responseBody) {
    throw new Error("Configured analysis provider preflight failed without a final response.");
  }

  let payload;
  try {
    payload = parseAnalysisProviderResponse(responseBody.text);
  } catch {
    console.error(
      "Configured analysis provider preflight returned a non-JSON response:",
      diagnosticPayload({
        response,
        elapsedMs,
        responseText: responseBody.text,
        responseTruncated: responseBody.truncated,
      }),
    );
    process.exit(1);
  }

  const content =
    payload?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    console.error(
      "Configured analysis provider preflight returned no assistant content:",
      diagnosticPayload({
        response,
        elapsedMs,
        responseText: responseBody.text,
        responseTruncated: responseBody.truncated,
      }),
    );
    process.exit(1);
  }

  let parsedContent;
  try {
    parsedContent = parseAnalysisProviderContent(content);
  } catch (error) {
    console.error(
      "Configured analysis provider preflight assistant content was not JSON:",
      {
        ...diagnosticPayload({
          response,
          elapsedMs,
          responseText: responseBody.text,
          responseTruncated: responseBody.truncated,
        }),
        validation_reason:
          error instanceof Error ? error.message : "unknown",
      },
    );
    process.exit(1);
  }

  try {
    const analysis = parseAnalysisOutput(parsedContent, {
      name: "Synthetic SaaS",
      description: "Synthetic product used for provider contract validation.",
    });

    if (analysis.moments.length < 1 || analysis.moments.length > 10) {
      throw new Error("unexpected Moment count");
    }
  } catch (error) {
    console.error(
      "Configured analysis provider preflight assistant content failed the analysis output contract:",
      {
        ...diagnosticPayload({
          response,
          elapsedMs,
          responseText: responseBody.text,
          responseTruncated: responseBody.truncated,
        }),
        validation_reason:
          error instanceof Error ? error.message : "unknown",
      },
    );
    process.exit(1);
  }

  console.log(
    `Configured analysis provider preflight + analysis output contract: OK (${elapsedMs}ms, model=${model})`,
  );
} catch (error) {
  if (error instanceof DOMException && error.name === "AbortError") {
    console.error(
      `Configured analysis provider preflight timed out after ${elapsedMs}ms.`,
    );
  } else {
    console.error(
      `Configured analysis provider preflight request failed after ${elapsedMs}ms.`,
    );
  }
  process.exit(1);
}
