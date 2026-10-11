import { NextResponse } from "next/server";

export const MAX_JSON_BODY_BYTES = 64 * 1024;

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function createRequestId(): string {
  return crypto.randomUUID();
}

export function jsonSuccess<T extends Record<string, unknown>>(
  data: T,
  requestId: string,
  status = 200,
): NextResponse {
  return NextResponse.json(
    { ...data, request_id: requestId },
    { status },
  );
}

export function jsonError(
  requestId: string,
  status: number,
  code: string,
  message: string,
): NextResponse {
  return NextResponse.json(
    {
      error: { code, message },
      request_id: requestId,
    },
    { status },
  );
}

export async function readJsonBody(
  request: Request,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number.isFinite(Number(contentLength))) {
    if (Number(contentLength) > maxBytes) {
      await request.body?.cancel().catch(() => undefined);
      throw new HttpError(
        413,
        "request_body_too_large",
        "Request body is too large.",
      );
    }
  }

  const stream = request.body;
  if (!stream) {
    throw new HttpError(
      400,
      "invalid_json",
      "Request body must be valid JSON.",
    );
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;

      const value = result.value;
      if (totalBytes + value.byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new HttpError(
          413,
          "request_body_too_large",
          "Request body is too large.",
        );
      }

      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body = new TextDecoder().decode(bytes);

  if (!body.trim()) {
    throw new HttpError(
      400,
      "invalid_json",
      "Request body must be valid JSON.",
    );
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(
      400,
      "invalid_json",
      "Request body must be valid JSON.",
    );
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
