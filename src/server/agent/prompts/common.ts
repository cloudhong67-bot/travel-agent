// prompts/common.ts — version: v1 (2026-10-27)
// 모든 프롬프트가 공유하는 사실성 규칙. 바꾸면 각 프롬프트의 VERSION도 올린다.

import { z } from "zod";

/** 출처가 있든 없든 지키는 규칙: 바뀌기 쉬운 세부 수치와 장소를 지어내지 않는다 */
export const NO_FABRICATION_RULES = [
  "운영시간·입장료·가격·전화번호처럼 출처 데이터에 없는 값은 절대 추측하지 말고 null(또는 '정보 없음')로 둔다.",
  "장소·지명을 새로 만들어 내지 않는다.",
].join("\n");

export const FACT_RULES = ["사실 정보는 반드시 제공된 출처 데이터에만 근거한다.", NO_FABRICATION_RULES].join("\n");

/** Zod 스키마 → Gemini responseJsonSchema / parametersJsonSchema용 JSON Schema ($schema 키 제거) */
export function toGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

/** ko 표기 국가명 (예: PT → 포르투갈) */
export function countryNameKo(countryCode: string): string {
  try {
    return new Intl.DisplayNames(["ko"], { type: "region" }).of(countryCode.toUpperCase()) ?? countryCode;
  } catch {
    return countryCode;
  }
}
