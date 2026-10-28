import { afterEach, describe, expect, it, vi } from "vitest";
import { WikipediaKnowledge, type WikiSummary } from "./wikipedia";

const summary = (site: WikiSummary["site"]): WikiSummary => ({ site, lang: "ko", title: "포르투", description: undefined, extract: "항구 도시", url: `https://ko.${site}.org/wiki/x` });

afterEach(() => vi.restoreAllMocks());

describe("WikipediaKnowledge.getCityKnowledge", () => {
  it("한 사이트가 실패해도 다른 사이트 결과는 살린다", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const wiki = new WikipediaKnowledge();
    vi.spyOn(wiki, "getSummary").mockImplementation(async (site) => {
      if (site === "wikivoyage") throw new TypeError("fetch failed");
      return summary(site);
    });
    expect(await wiki.getCityKnowledge("포르투")).toEqual({ wikipedia: summary("wikipedia"), wikivoyage: null });
  });

  it("두 사이트 모두 실패하면 오류를 던진다 (상위에서 경고로 처리)", async () => {
    const wiki = new WikipediaKnowledge();
    vi.spyOn(wiki, "getSummary").mockRejectedValue(new TypeError("fetch failed"));
    await expect(wiki.getCityKnowledge("포르투")).rejects.toThrow("fetch failed");
  });
});
