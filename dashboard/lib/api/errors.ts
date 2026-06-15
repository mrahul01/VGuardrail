export const API_ERROR_CODES = {
  BAD_REQUEST: "bad_request",
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  METHOD_NOT_ALLOWED: "method_not_allowed",
  VALIDATION_ERROR: "validation_error",
  INTERNAL_ERROR: "internal_error",
} as const;

export type ApiErrorCode =
  (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: ApiErrorCode;

  public constructor(
    status: number,
    code: ApiErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function badRequestError(message: string): ApiError {
  return new ApiError(400, API_ERROR_CODES.BAD_REQUEST, message);
}

export function forbiddenError(message = "Forbidden"): ApiError {
  return new ApiError(403, API_ERROR_CODES.FORBIDDEN, message);
}

export function notFoundError(message = "Not found"): ApiError {
  return new ApiError(404, API_ERROR_CODES.NOT_FOUND, message);
}
