import type { GenerateContentResponse } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractSources, resolveSources } from "./geminiGoogleSearch";

afterEach(() => vi.unstubAllGlobals());

describe("extractSources", () => {
  it("groundingChunks의 web 출처를 중복 없이 모은다", () => {
    const response = {
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: "https://a.example/1", title: "visitporto.travel" } },
              { web: { uri: "https://a.example/1", title: "dup" } },
              { web: { uri: "https://b.example/2" } },
              { retrievedContext: {} },
            ],
          },
        },
      ],
    } as unknown as GenerateContentResponse;

    expect(extractSources(response)).toEqual([
      { title: "visitporto.travel", url: "https://a.example/1" },
      { title: "https://b.example/2", url: "https://b.example/2" },
    ]);
  });
});

describe("resolveSources", () => {
  it("구글 리다이렉트 URI만 Location 헤더로 풀고, 실패하면 원래 값을 유지한다", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/ok")) {
        return new Response(null, { status: 302, headers: { location: "https://www.visitporto.travel/" } });
      }
      throw new HttpLikeError();
    });
    vi.stubGlobal("fetch", fetchMock);

    const redirect = "https://vertexaisearch.cloud.google.com/grounding-api-redirect";
    const result = await resolveSources([
      { title: "visitporto.travel", url: `${redirect}/ok` },
      { title: "fail", url: `${redirect}/fail` },
      { title: "plain", url: "https://plain.example/" },
    ]);

    expect(result.map((s) => s.url)).toEqual([
      "https://www.visitporto.travel/",
      `${redirect}/fail`,
      "https://plain.example/",
    ]);
  });
});

class HttpLikeError extends Error {
  status = 400; // 재시도 대상이 아니게 해서 테스트를 빠르게 끝낸다
}
