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
    responseUrl: response.url,
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
    payload = JSON.parse(body.text);
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
