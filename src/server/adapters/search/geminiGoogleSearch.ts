import { GoogleGenAI, ThinkingLevel, type GenerateContentResponse } from "@google/genai";
import { mapWithConcurrency } from "@/lib/concurrency";
import { LLM_TIMEOUT_MS, withTimeoutRetry, type RetryOptions } from "@/lib/http";
import type { LlmUsage } from "../llm/types";
import type { WebSearchOptions, WebSearchProvider, WebSearchResult, WebSource } from "./types";

export interface GeminiGoogleSearchConfig {
  apiKey: string;
  model: string;
  /** 그라운딩 출처 URI(구글 리다이렉트 URL)를 실제 원문 URL로 풀지 여부. 기본 true */
  resolveSourceUrls?: boolean;
  retry?: RetryOptions;
}

export interface GeminiSearchResult extends WebSearchResult {
  usage: LlmUsage;
}

const SYSTEM_INSTRUCTION = [
  "너는 여행 조사 보조 에이전트다. 답하기 전에 반드시 Google 검색을 사용한다.",
  "국가·도시 공식 관광청, 정부 기관, UNESCO 등 공식 출처를 우선한다.",
  "한국어로 8문장 이내로 간결하게 답하고, 고유명사는 원어를 병기한다.",
  "검색으로 확인되지 않은 사실은 쓰지 않는다.",
].join(" ");

/**
 * Gemini 내장 Google 검색 그라운딩(google_search 도구) 기반 웹 검색 어댑터.
 * 출처는 응답의 groundingMetadata.groundingChunks[].web 에서 추출한다.
 * 참고: https://ai.google.dev/gemini-api/docs/google-search
 */
export class GeminiGoogleSearch implements WebSearchProvider {
  private readonly client: GoogleGenAI;

  constructor(private readonly config: GeminiGoogleSearchConfig) {
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
  }

  async search(query: string, options: WebSearchOptions = {}): Promise<GeminiSearchResult> {
    const prompt = options.countryCode
      ? `${query}\n(대상 국가 코드: ${options.countryCode.toUpperCase()})`
      : query;

    const response = await withTimeoutRetry(
      (signal) =>
        this.client.models.generateContent({
          model: this.config.model,
          contents: prompt,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            tools: [{ googleSearch: {} }],
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            abortSignal: signal,
          },
        }),
      { timeoutMs: LLM_TIMEOUT_MS, ...this.config.retry },
    );

    const metadata = response.candidates?.[0]?.groundingMetadata;
    let sources = extractSources(response);
    if (this.config.resolveSourceUrls ?? true) sources = await resolveSources(sources);

    const usage = response.usageMetadata;
    return {
      summary: (response.text ?? "").trim(),
      sources,
      searchQueries: metadata?.webSearchQueries,
      searchEntryPointHtml: metadata?.searchEntryPoint?.renderedContent,
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
        thoughtTokens: usage?.thoughtsTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0,
      },
    };
  }
}

/** groundingChunks의 web 출처를 URI 기준으로 중복 제거해 추출 */
export function extractSources(response: Pick<GenerateContentResponse, "candidates">): WebSource[] {
  const seen = new Map<string, WebSource>();
  for (const chunk of response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) {
    const uri = chunk.web?.uri;
    if (!uri || seen.has(uri)) continue;
    seen.set(uri, { title: chunk.web?.title || uri, url: uri });
  }
  return [...seen.values()];
}

/**
 * Gemini API의 그라운딩 URI는 vertexaisearch.cloud.google.com 리다이렉트 링크로 오고 title에는 도메인만 담기는 경우가 많다.
 * 관광청 화이트리스트 판정·저장을 위해 Location 헤더로 원문 URL을 얻는다. 실패하면 원래 URI를 유지한다.
 * TODO(확인 필요): 리다이렉트 URI 형식·유효기간은 공식 문서에서 확인하지 못했다. PoC 결과로 검증.
 */
export async function resolveSources(sources: WebSource[]): Promise<WebSource[]> {
  const settled = await mapWithConcurrency(sources, 3, async (source) => {
    if (!new URL(source.url).hostname.endsWith("vertexaisearch.cloud.google.com")) return source;
    const location = await withTimeoutRetry(async (signal) => {
      const res = await fetch(source.url, { method: "GET", redirect: "manual", signal });
      await res.body?.cancel();
      return res.headers.get("location");
    });
    return location ? { ...source, url: location } : source;
  });
  return settled.map((r, i) => (r.status === "fulfilled" ? r.value : sources[i]));
}
