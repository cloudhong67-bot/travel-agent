import type { z } from "zod";

/** NVARCHAR(MAX)에 저장한 JSON 컬럼을 파싱한다. 깨진 값은 원문 문자열 그대로 돌려준다. */
export function parseJsonColumn(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * JSON 컬럼을 API 스키마로 검증해 파싱한다. 구조가 맞지 않으면(예: 예전 버전 데이터) 로그를 남기고 null.
 */
export function parseJsonColumnAs<S extends z.ZodType>(schema: S, value: string | null, label: string): z.infer<S> | null {
  if (value === null) return null;
  const result = schema.safeParse(parseJsonColumn(value));
  if (result.success) return result.data;
  console.warn(`[db] ${label} JSON이 스키마와 맞지 않아 무시합니다`, result.error.issues.slice(0, 3));
  return null;
}
