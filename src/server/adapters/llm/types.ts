/** 공급자 독립적인 LLM 어댑터 인터페이스 (현재 구현: Gemini) */

export type ThinkingLevel = "low" | "medium";

export type LlmPart =
  | { kind: "text"; text: string; thoughtSignature?: string }
  | {
      kind: "functionCall";
      id?: string;
      name: string;
      args: Record<string, unknown>;
      /** Gemini 3 계열은 함수 호출 파트의 사고 서명을 다음 턴에 그대로 돌려줘야 한다. */
      thoughtSignature?: string;
    }
  | { kind: "functionResponse"; id?: string; name: string; response: Record<string, unknown> };

export interface LlmMessage {
  role: "user" | "model";
  parts: LlmPart[];
}

export interface LlmFunctionDeclaration {
  name: string;
  description: string;
  /** JSON Schema (Zod → z.toJSONSchema()로 생성 권장) */
  parameters: Record<string, unknown>;
}

export interface LlmRequest {
  systemInstruction?: string;
  messages: LlmMessage[];
  tools?: LlmFunctionDeclaration[];
  thinkingLevel?: ThinkingLevel;
  /** 지정 시 JSON 출력 강제 (함수 호출과 동시에 쓰지 않는다) */
  responseJsonSchema?: Record<string, unknown>;
  temperature?: number;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
}

export interface LlmFunctionCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LlmResponse {
  text: string;
  functionCalls: LlmFunctionCall[];
  /** 대화 이력에 그대로 이어 붙일 모델 턴 (사고 서명 포함) */
  modelMessage: LlmMessage;
  usage: LlmUsage;
  finishReason?: string;
  model: string;
}

export interface LlmProvider {
  generate(request: LlmRequest): Promise<LlmResponse>;
}

/** 함수 실행 결과들을 다음 요청에 넣을 user 턴으로 만든다. */
export function functionResponsesMessage(
  results: { call: LlmFunctionCall; response: Record<string, unknown> }[],
): LlmMessage {
  return {
    role: "user",
    parts: results.map(({ call, response }) => ({
      kind: "functionResponse",
      id: call.id,
      name: call.name,
      response,
    })),
  };
}
