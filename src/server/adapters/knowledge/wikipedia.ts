import { z } from "zod";
import { fetchJson, HttpError, type RetryOptions } from "@/lib/http";

export type WikiSite = "wikipedia" | "wikivoyage";
export type WikiLang = "ko" | "en";

export interface WikiSummary {
  site: WikiSite;
  lang: WikiLang;
  title: string;
  description?: string;
  extract: string;
  url: string;
  thumbnailUrl?: string;
}

export interface CityKnowledge {
  wikipedia: WikiSummary | null;
  wikivoyage: WikiSummary | null;
}

export interface WikiConfig {
  /** Wikimedia 정책상 연락처가 포함된 User-Agent 필수 */
  userAgent?: string;
  retry?: RetryOptions;
}

const LANGS: WikiLang[] = ["ko", "en"];
const DEFAULT_UA = "TripPilot/0.1 (personal study project; https://github.com/)";

const summarySchema = z.object({
  type: z.string(),
  title: z.string(),
  description: z.string().optional(),
  extract: z.string(),
  content_urls: z.object({ desktop: z.object({ page: z.string() }) }),
  thumbnail: z.object({ source: z.string() }).optional(),
});

const langLinksSchema = z.object({
  query: z
    .object({
      pages: z.array(
        z.object({
          title: z.string(),
          missing: z.boolean().optional(),
          langlinks: z.array(z.object({ lang: z.string(), title: z.string() })).optional(),
        }),
      ),
    })
    .optional(),
});

/**
 * Wikipedia/Wikivoyage REST 요약 API 어댑터.
 * 각 사이트마다 ko → en 순서로 시도하고, en 제목은 ko 문서의 언어 간 링크로 찾는다.
 */
export class WikipediaKnowledge {
  private readonly headers: Record<string, string>;
  private readonly titleCache = new Map<string, string>();

  constructor(private readonly config: WikiConfig = {}) {
    this.headers = {
      "User-Agent": config.userAgent ?? DEFAULT_UA,
      "Api-User-Agent": config.userAgent ?? DEFAULT_UA,
      Accept: "application/json",
    };
  }

  /** @param englishName ko 문서가 없거나 언어 링크가 없을 때 사용할 영문 제목 힌트 */
  /** 한 사이트가 실패해도 다른 사이트 결과는 살린다. 둘 다 실패하면 첫 오류를 던진다 */
  async getCityKnowledge(name: string, englishName?: string): Promise<CityKnowledge> {
    const [wikipedia, wikivoyage] = await Promise.allSettled([
      this.getSummary("wikipedia", name, englishName),
      this.getSummary("wikivoyage", name, englishName),
    ]);
    if (wikipedia.status === "rejected" && wikivoyage.status === "rejected") throw wikipedia.reason;
    const value = (r: PromiseSettledResult<WikiSummary | null>, site: WikiSite) => {
      if (r.status === "fulfilled") return r.value;
      console.warn(`[wiki] ${site} 조회 실패 — 다른 출처만 사용`, r.reason);
      return null;
    };
    return { wikipedia: value(wikipedia, "wikipedia"), wikivoyage: value(wikivoyage, "wikivoyage") };
  }

  async getSummary(site: WikiSite, name: string, englishName?: string): Promise<WikiSummary | null> {
    for (const lang of LANGS) {
      const titles =
        lang === "ko" ? [name] : unique([await this.englishTitle(name), englishName, name]);
      for (const title of titles) {
        if (!title) continue;
        const summary = await this.fetchSummary(site, lang, title);
        if (summary) return summary;
      }
    }
    return null;
  }

  private async fetchSummary(site: WikiSite, lang: WikiLang, title: string): Promise<WikiSummary | null> {
    const url = `https://${lang}.${site}.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}?redirect=true`;
    try {
      const data = summarySchema.parse(await fetchJson(url, { headers: this.headers }, this.config.retry));
      // 동음이의 문서·빈 요약은 쓸모가 없으므로 다음 후보로 넘긴다.
      if (data.type === "disambiguation" || !data.extract.trim()) return null;
      return {
        site,
        lang,
        title: data.title,
        description: data.description,
        extract: data.extract,
        url: data.content_urls.desktop.page,
        thumbnailUrl: data.thumbnail?.source,
      };
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * ko 위키백과 문서의 en 언어 링크 제목 (없으면 undefined).
   * ko 위키여행은 문서가 적어 언어 링크도 위키백과 기준으로 찾는다 (en 위키여행 제목은 대개 위키백과와 같다).
   */
  private async englishTitle(koTitle: string): Promise<string | undefined> {
    const cached = this.titleCache.get(koTitle);
    if (cached) return cached;
    const url = new URL("https://ko.wikipedia.org/w/api.php");
    url.search = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      prop: "langlinks",
      lllang: "en",
      redirects: "1",
      titles: koTitle,
    }).toString();
    try {
      const data = langLinksSchema.parse(
        await fetchJson(url.toString(), { headers: this.headers }, this.config.retry),
      );
      const title = data.query?.pages[0]?.langlinks?.[0]?.title;
      if (title) this.titleCache.set(koTitle, title);
      return title;
    } catch {
      return undefined; // 언어 링크 조회 실패는 치명적이지 않음
    }
  }
}

function unique(values: (string | undefined)[]): (string | undefined)[] {
  return [...new Set(values.filter(Boolean))];
}
