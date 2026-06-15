import { NextResponse } from "next/server";
import { API_ERROR_CODES, ApiError, type ApiErrorCode } from "@/lib/api/errors";
import { AuthError } from "@/lib/auth/jwt";

export interface ApiErrorEnvelope {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
  };
}

export type ApiSuccessResponse<T> = T;
export type ApiErrorResponse = ApiErrorEnvelope;

export function apiSuccess<T>(data: T, init: ResponseInit = {}): NextResponse<T> {
  return NextResponse.json(data, { status: 200, ...init });
}

export function apiCreated<T>(data: T): NextResponse<T> {
  return NextResponse.json(data, { status: 201 });
}

export function apiNoContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number
): NextResponse<ApiErrorEnvelope> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function apiErrorFromUnknown(error: unknown): NextResponse<ApiErrorEnvelope> {
  if (error instanceof ApiError) {
    return apiError(error.code, error.message, error.status);
  }
  if (error instanceof AuthError || error instanceof Error && error.message === "Authentication required") {
    return apiError(API_ERROR_CODES.UNAUTHORIZED, "Authentication required", 401);
  }
  console.error("BFF handler error", error);
  return apiError(
    API_ERROR_CODES.INTERNAL_ERROR,
    "Internal server error",
    500
  );
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (text.length === 0) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
