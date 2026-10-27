import type { z } from "zod";
import type { ApiError } from "@/lib/schemas";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "DAILY_LIMIT_EXCEEDED"
  | "NOT_IMPLEMENTED"
  | "CONFLICT"
  | "DB_UNAVAILABLE"
  | "SERVER_MISCONFIGURED"
  | "INTERNAL_ERROR";

/** 모든 오류 응답은 { code, message } 형식 */
export function apiError(status: number, code: ErrorCode, message: string, headers?: HeadersInit): Response {
  return Response.json({ code, message } satisfies ApiError, { status, headers });
}

export function zodMessage(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}

export const badRequest = (error: z.ZodError) => apiError(400, "VALIDATION_ERROR", zodMessage(error));
export const notFound = (what: string) => apiError(404, "NOT_FOUND", `${what}을(를) 찾을 수 없습니다.`);

/** 예상하지 못한 예외를 { code, message } 500으로 바꾸고 서버 로그에 남긴다 (내부 메시지는 노출하지 않음). */
export function withErrorHandling<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error("[api] unhandled error", error);
      return apiError(500, "INTERNAL_ERROR", "서버 오류가 발생했습니다.");
    }
  };
}

/** JSON 바디 파싱 (JSON이 아니면 null) */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
