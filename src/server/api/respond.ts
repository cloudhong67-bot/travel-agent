import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import type { ApiError } from "@/lib/schemas";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
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

/**
 * 라우트 안에서 던지면 withErrorHandling이 { code, message } 응답으로 바꾸는 예상된 오류.
 * 검증 실패·없음처럼 사용자에게 그대로 보여줘도 되는 경우에만 쓴다.
 */
export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiProblem";
  }
}

export function zodMessage(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}

export const badRequest = (error: z.ZodError) => apiError(400, "VALIDATION_ERROR", zodMessage(error));
export const notFound = (what: string) => apiError(404, "NOT_FOUND", `${what}을(를) 찾을 수 없습니다.`);

/** 외부 입력(경로 매개변수·쿼리·바디)을 검증한다. 실패하면 400 ApiProblem을 던진다 */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiProblem(400, "VALIDATION_ERROR", zodMessage(result.error));
  return result.data;
}

/**
 * 라우트 핸들러 공통 오류 처리.
 *  - ApiProblem → 해당 상태·코드
 *  - 그 밖의 예외 → 500 { code, message } + 서버 로그 (내부 메시지는 노출하지 않음)
 */
export function withErrorHandling<A extends unknown[]>(handler: (...args: A) => Promise<Response> | Response) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      // Next.js 내부 신호(빌드 시 프리렌더 중단·동적 사용 감지 등)는 오류가 아니므로 삼키지 않고 Next로 돌려준다
      unstable_rethrow(error);
      if (error instanceof ApiProblem) return apiError(error.status, error.code, error.message);
      console.error("[api] unhandled error", error);
      return apiError(500, "INTERNAL_ERROR", "서버 오류가 발생했습니다.");
    }
  };
}

/** JSON 바디 파싱 (JSON이 아니면 null → 스키마 검증에서 400) */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
