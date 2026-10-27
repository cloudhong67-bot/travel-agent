/**
 * MSW 기반 외부 API 목 사용 예시. 어댑터 코드는 그대로 두고 네트워크 계층에서 응답을 바꾼다.
 */
import { http, HttpResponse } from "msw/http";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { WikipediaKnowledge } from "./knowledge/wikipedia";
import { GeminiProvider } from "./llm/gemini";
import { GoogleMapsProvider } from "./maps/google";

describe("MSW로 목 처리한 외부 API", () => {
  it("Google Geocoding 기본 핸들러", async () => {
    const google = new GoogleMapsProvider({ serverKey: "test" });
    const [porto] = await google.geocode("포르투");
    expect(porto).toMatchObject({ countryCode: "PT", name: "포르토" });
  });

  it("server.use로 오류 응답을 주입할 수 있다 (4xx는 재시도 없이 실패)", async () => {
    server.use(
      http.get("https://maps.googleapis.com/maps/api/geocode/json", () =>
        HttpResponse.json({ status: "REQUEST_DENIED", error_message: "bad key", results: [] }),
      ),
    );
    const google = new GoogleMapsProvider({ serverKey: "test" });
    await expect(google.geocode("포르투")).rejects.toThrow(/REQUEST_DENIED/);
  });

  it("Wikipedia: ko 요약 성공, 위키여행은 404 → en 시도 후 null", async () => {
    const wiki = new WikipediaKnowledge();
    const result = await wiki.getCityKnowledge("포르투", "Porto");
    expect(result.wikipedia).toMatchObject({ lang: "ko", title: "포르투" });
    expect(result.wikivoyage).toBeNull();
  });

  it("Gemini generateContent 목 응답과 토큰 사용량", async () => {
    const gemini = new GeminiProvider({ apiKey: "test", model: "gemini-3.8-flash" });
    const res = await gemini.generate({ messages: [{ role: "user", parts: [{ kind: "text", text: "hi" }] }] });
    expect(res.text).toBe("ok");
    expect(res.usage).toMatchObject({ inputTokens: 3, outputTokens: 1, totalTokens: 4 });
  });
});
