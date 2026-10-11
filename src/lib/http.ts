import { NextResponse } from "next/server";

export { HttpError, MAX_JSON_BODY_BYTES, readJsonBody } from "./request-body.ts";

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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
