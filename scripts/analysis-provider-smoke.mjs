const apiKey = process.env.ANALYSIS_API_KEY?.trim();
const baseUrl = process.env.ANALYSIS_BASE_URL?.trim();
const model = process.env.ANALYSIS_MODEL?.trim();

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

async function readBoundedBodyPreview(response, maxBytes) {
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
    .replace(/Bearer\\s+[A-Za-z0-9._~+\\/-]+/gi, "Bearer [REDACTED]");
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
          role: "user",
          content: 'Return exactly {"ok":true}.',
        },
      ],
      temperature: 0,
      max_tokens: 32,
    }),
    signal: controller.signal,
  });

  const elapsedMs = Date.now() - startedAt;
  const contentType = response.headers.get("content-type") ?? "(missing)";

  let responsePreview = null;
  let responsePreviewTruncated = false;

  if (!response.ok) {
    const preview = await readBoundedBodyPreview(
      response,
      MAX_BODY_PREVIEW_BYTES,
    );
    responsePreview = redactSecrets(preview.text);
    responsePreviewTruncated = preview.truncated;

    console.error("Analysis provider preflight failed:", {
      status: response.status,
      statusText: response.statusText,
      contentType,
      responseUrl: response.url,
      redirected: response.redirected,
      elapsedMs,
      bodyPreview: responsePreview,
      bodyPreviewTruncated: responsePreviewTruncated,
    });
    process.exit(1);
  }

  let payload;
  try {
    const responseText = await response.text();
    payload = JSON.parse(responseText);
  } catch {
    const preview = await readBoundedBodyPreview(
      response,
      MAX_BODY_PREVIEW_BYTES,
    );
    responsePreview = redactSecrets(preview.text);
    responsePreviewTruncated = preview.truncated;

    console.error("Analysis provider preflight returned a non-JSON response:", {
      status: response.status,
      statusText: response.statusText,
      contentType,
      responseUrl: response.url,
      redirected: response.redirected,
      elapsedMs,
      bodyPreview: responsePreview,
      bodyPreviewTruncated: responsePreviewTruncated,
    });
    process.exit(1);
  }

  const content =
    payload?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    console.error("Analysis provider preflight returned no assistant content:", {
      status: response.status,
      statusText: response.statusText,
      contentType,
      responseUrl: response.url,
      redirected: response.redirected,
      elapsedMs,
    });
    process.exit(1);
  }

  console.log(
    `Analysis provider preflight: OK (${elapsedMs}ms, model=${model})`,
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
