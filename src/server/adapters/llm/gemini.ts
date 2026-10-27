import {
  GoogleGenAI,
  ThinkingLevel as GenAiThinkingLevel,
  type Content,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";
import { LLM_TIMEOUT_MS, withTimeoutRetry, type RetryOptions } from "@/lib/http";
import type {
  LlmFunctionCall,
  LlmMessage,
  LlmPart,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  ThinkingLevel,
} from "./types";

export interface GeminiConfig {
  apiKey: string;
  model: string;
  retry?: RetryOptions;
}

const THINKING_LEVELS: Record<ThinkingLevel, GenAiThinkingLevel> = {
  low: GenAiThinkingLevel.LOW,
  medium: GenAiThinkingLevel.MEDIUM,
};

/**
 * Gemini 어댑터 (@google/genai, generateContent API).
 * 함수 호출은 SDK 자동 실행을 끄고 호출 정보만 돌려준다 — 실행 루프는 src/server/agent가 담당.
 */
export class GeminiProvider implements LlmProvider {
  private readonly client: GoogleGenAI;

  constructor(private readonly config: GeminiConfig) {
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    const genConfig: GenerateContentConfig = {
      systemInstruction: request.systemInstruction,
      temperature: request.temperature,
      thinkingConfig: { thinkingLevel: THINKING_LEVELS[request.thinkingLevel ?? "low"] },
    };
    if (request.tools?.length) {
      genConfig.tools = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parametersJsonSchema: t.parameters,
          })),
        },
      ];
      genConfig.automaticFunctionCalling = { disable: true };
    }
    if (request.responseJsonSchema) {
      genConfig.responseMimeType = "application/json";
      genConfig.responseJsonSchema = request.responseJsonSchema;
    }

    const contents = request.messages.map(toGenAiContent);
    const response = await withTimeoutRetry(
      (signal) =>
        this.client.models.generateContent({
          model: this.config.model,
          contents,
          config: { ...genConfig, abortSignal: signal },
        }),
      { timeoutMs: LLM_TIMEOUT_MS, ...this.config.retry },
    );
    return fromGenAiResponse(response, this.config.model);
  }
}

function toGenAiContent(message: LlmMessage): Content {
  return { role: message.role, parts: message.parts.map(toGenAiPart) };
}

function toGenAiPart(part: LlmPart): Part {
  switch (part.kind) {
    case "text":
      return { text: part.text, thoughtSignature: part.thoughtSignature };
    case "functionCall":
      return {
        functionCall: { id: part.id, name: part.name, args: part.args },
        thoughtSignature: part.thoughtSignature,
      };
    case "functionResponse":
      return { functionResponse: { id: part.id, name: part.name, response: part.response } };
  }
}

function fromGenAiResponse(response: GenerateContentResponse, model: string): LlmResponse {
  const candidate = response.candidates?.[0];
  const parts: LlmPart[] = [];
  const functionCalls: LlmFunctionCall[] = [];
  let text = "";

  for (const part of candidate?.content?.parts ?? []) {
    if (part.thought) continue; // 사고 요약은 이력·출력에서 제외
    if (part.functionCall?.name) {
      const call: LlmFunctionCall = {
        id: part.functionCall.id,
        name: part.functionCall.name,
        args: (part.functionCall.args ?? {}) as Record<string, unknown>,
      };
      functionCalls.push(call);
      parts.push({ kind: "functionCall", ...call, thoughtSignature: part.thoughtSignature });
    } else if (typeof part.text === "string") {
      text += part.text;
      parts.push({ kind: "text", text: part.text, thoughtSignature: part.thoughtSignature });
    }
  }

  const usage = response.usageMetadata;
  const inputTokens = usage?.promptTokenCount ?? 0;
  const outputTokens = usage?.candidatesTokenCount ?? 0;
  const thoughtTokens = usage?.thoughtsTokenCount ?? 0;

  return {
    text,
    functionCalls,
    modelMessage: { role: "model", parts },
    usage: {
      inputTokens,
      outputTokens,
      thoughtTokens,
      totalTokens: usage?.totalTokenCount ?? inputTokens + outputTokens + thoughtTokens,
    },
    finishReason: candidate?.finishReason,
    model: response.modelVersion ?? model,
  };
}
