const apiKey = process.env.ANALYSIS_API_KEY?.trim();
const baseUrl = process.env.ANALYSIS_BASE_URL?.trim();
const model = process.env.ANALYSIS_MODEL?.trim();

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

  if (!response.ok) {
    console.error(
      `Analysis provider preflight failed: HTTP ${response.status} after ${elapsedMs}ms.`,
    );
    process.exit(1);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    console.error(
      `Analysis provider preflight returned a non-JSON response after ${elapsedMs}ms.`,
    );
    process.exit(1);
  }

  const content =
    payload?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    console.error(
      `Analysis provider preflight returned no assistant content after ${elapsedMs}ms.`,
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
