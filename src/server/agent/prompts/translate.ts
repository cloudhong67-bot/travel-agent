// prompts/translate.ts — version: v1 (2026-10-28)
// 위키 원문(영어 등)을 한국어로 옮긴다 (Gemini, thinking low, 구조화 출력). 관광 정보 대체 출처(위키여행 요약)에 쓴다.

import { z } from "zod";
import { NO_FABRICATION_RULES, toGeminiSchema } from "./common";

export const TRANSLATE_PROMPT_VERSION = "translate@v1";

export const TranslationSchema = z.object({ text: z.string().describe("자연스러운 한국어 번역") });
export const translationResponseSchema = toGeminiSchema(TranslationSchema);

export const TRANSLATE_SYSTEM = `너는 여행 안내서 번역가다. 주어진 원문을 자연스러운 한국어로 옮긴다.
- 원문에 없는 내용을 덧붙이거나 빼지 않는다.
- 지명·고유명사는 한국어 표기 뒤 괄호에 원어를 한 번 적는다 (예: 세비야(Sevilla)).
${NO_FABRICATION_RULES}`;

export const translateUserPrompt = (text: string) => `[원문]\n${text}\n\n위 원문을 한국어로 옮겨 text에 담아라.`;
