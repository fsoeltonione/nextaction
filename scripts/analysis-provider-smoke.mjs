import { parseAnalysisProviderResponse } from "../src/lib/runtime/analysis-provider-response.ts";
import { parseAnalysisOutput } from "../src/lib/runtime/analysis-output.ts";
import { validateGroundedSaaSAnalysis } from "../src/lib/runtime/analysis-grounding.ts";
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

const controller = new AbortController();
const timeoutMs = 25_000;
const timeout = setTimeout(() => controller.abort(), timeoutMs);
const startedAt = Date.now();

try {
  const response = await fetch(endpoint, {
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
            "The object must contain product_type, name, description, name_evidence, and moments.",
            "product_type must be exactly saas for this contract fixture.",
            "moments must be an array of 2 or more objects.",
            "Each Moment must have a label string, evidence string, and may have a key and description.",
            "evidence and name_evidence must be copied exactly from the supplied fixture text.",
            "Return no Markdown or prose.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            "Product name: Synthetic SaaS",
            "Product description: A small fictional SaaS used for a contract test.",
            "The product lets teams create invoices and send invoices to customers.",
            "Generate two commercially relevant Moments and ground each one in exact evidence from this fixture text.",
          ].join("\n"),
        },
      ],
      temperature: 0,
      max_tokens: 512,
      stream: false,
    }),
    signal: controller.signal,
  });

  const elapsedMs = Date.now() - startedAt;
  const body = await readBoundedText(
    response,
    MAX_RESPONSE_BODY_BYTES,
  );

  if (!response.ok) {
    console.error(
      "Analysis provider preflight failed:",
      diagnosticPayload({
        response,
        elapsedMs,
        responseText: body.text,
        responseTruncated: body.truncated,
      }),
    );
    process.exit(1);
  }

  let payload;
  try {
    payload = parseAnalysisProviderResponse(body.text);
  } catch {
    console.error(
      "Analysis provider preflight returned a non-JSON response:",
      diagnosticPayload({
        response,
        elapsedMs,
        responseText: body.text,
        responseTruncated: body.truncated,
      }),
    );
    process.exit(1);
  }

  const content =
    payload?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    console.error(
      "Analysis provider preflight returned no assistant content:",
      diagnosticPayload({
        response,
        elapsedMs,
        responseText: body.text,
        responseTruncated: body.truncated,
      }),
    );
    process.exit(1);
  }

  let parsedContent;
  try {
    parsedContent = parseAnalysisProviderContent(content);
  } catch (error) {
    console.error(
      "Analysis provider preflight assistant content was not JSON:",
      {
        ...diagnosticPayload({
          response,
          elapsedMs,
          responseText: body.text,
          responseTruncated: body.truncated,
        }),
        validation_reason:
          error instanceof Error ? error.message : "unknown",
      },
    );
    process.exit(1);
  }

  try {
    validateGroundedSaaSAnalysis(
      parsedContent,
      [
        "Product name: Synthetic SaaS",
        "Product description: A small fictional SaaS used for a contract test.",
        "The product lets teams create invoices and send invoices to customers.",
      ].join("\n"),
    );

    const analysis = parseAnalysisOutput(parsedContent, {
      name: "Synthetic SaaS",
      description: "Synthetic product used for provider contract validation.",
    });

    if (analysis.moments.length < 1 || analysis.moments.length > 10) {
      throw new Error("unexpected Moment count");
    }
  } catch (error) {
    console.error(
      "Analysis provider preflight assistant content failed the analysis output contract:",
      {
        ...diagnosticPayload({
          response,
          elapsedMs,
          responseText: body.text,
          responseTruncated: body.truncated,
        }),
        validation_reason:
          error instanceof Error ? error.message : "unknown",
      },
    );
    process.exit(1);
  }

  console.log(
    `Analysis provider preflight + analysis output contract: OK (${elapsedMs}ms, model=${model})`,
  );
} catch (error) {
  const elapsedMs = Date.now() - startedAt;
  if (error instanceof DOMException && error.name === "AbortError") {
    console.error(
      `Analysis provider preflight timed out after ${elapsedMs}ms.`,
    );
  } else {
    console.error(
      `Analysis provider preflight request failed after ${elapsedMs}ms.`,
    );
  }
  process.exit(1);
} finally {
  clearTimeout(timeout);
}
