import { http, HttpResponse } from "msw/http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/msw/server";
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

describe("제목 다변화 (한글 도시명이 문서 제목과 다를 때)", () => {
  const summaryJson = (title: string, lang: string) => ({
    type: "standard",
    title,
    extract: `${title} 개요`,
    content_urls: { desktop: { page: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}` } },
  });
  const notFound = () => new HttpResponse(null, { status: 404 });

  it("ko 제목이 없으면 \"도시명 국가명\"으로 ko 위키를 검색해 쓸 수 있는 첫 문서를 쓴다", async () => {
    const queries: string[] = [];
    server.use(
      http.get("https://ko.wikipedia.org/api/rest_v1/page/summary/:title", ({ params }) => {
        const title = decodeURIComponent(String(params.title));
        return title === "세비야_(스페인)" ? HttpResponse.json(summaryJson("세비야 (스페인)", "ko")) : notFound();
      }),
      http.get("https://ko.wikipedia.org/w/api.php", ({ request }) => {
        const params = new URL(request.url).searchParams;
        if (params.get("list") !== "search") return HttpResponse.json({ query: { pages: [] } });
        queries.push(params.get("srsearch") ?? "");
        // 1위는 동음이의 문서(요약 404 처리) → 2위를 쓴다
        return HttpResponse.json({ query: { search: [{ title: "세비야 (동음이의)" }, { title: "세비야 (스페인)" }] } });
      }),
    );
    const doc = await new WikipediaKnowledge().getSummary("wikipedia", "세비야", undefined, "ES");
    expect(queries[0]).toBe("세비야 스페인");
    expect(doc).toMatchObject({ lang: "ko", title: "세비야 (스페인)" });
  });

  it("ko 문서가 없으면 언어 간 링크의 영문·현지어 제목(Seville → Sevilla) 순으로 en 문서를 찾는다", async () => {
    const tried: string[] = [];
    server.use(
      http.get("https://ko.wikivoyage.org/api/rest_v1/page/summary/:title", notFound),
      http.get("https://ko.wikivoyage.org/w/api.php", () => HttpResponse.json({ query: { search: [] } })),
      http.get("https://ko.wikipedia.org/w/api.php", () =>
        HttpResponse.json({ query: { pages: [{ title: "세비야", langlinks: [{ lang: "en", title: "Seville" }, { lang: "es", title: "Sevilla" }, { lang: "fr", title: "Séville" }] }] } }),
      ),
      http.get("https://en.wikivoyage.org/api/rest_v1/page/summary/:title", ({ params }) => {
        const title = decodeURIComponent(String(params.title));
        tried.push(title);
        return title === "Sevilla" ? HttpResponse.json({ ...summaryJson("Seville", "en"), content_urls: { desktop: { page: "https://en.wikivoyage.org/wiki/Seville" } } }) : notFound();
      }),
    );
    const doc = await new WikipediaKnowledge().getSummary("wikivoyage", "세비야", undefined, "ES");
    expect(tried).toEqual(["Seville", "Sevilla"]); // 현지어(es) 제목을 고른다 — fr 제목은 쓰지 않는다
    expect(doc).toMatchObject({ site: "wikivoyage", lang: "en", title: "Seville" });
  });
});
