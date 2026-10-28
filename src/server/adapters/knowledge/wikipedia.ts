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

// Wikimedia User-Agent 정책: 앱 이름·버전과 연락 가능한 URL을 넣어야 봇 트래픽으로 차단되지 않는다
const DEFAULT_UA = "TripPilot/0.2 (https://github.com/cloudhong67-bot/travel-agent; personal travel itinerary app)";

const summarySchema = z.object({
  type: z.string(),
  title: z.string(),
  description: z.string().optional(),
  extract: z.string(),
  content_urls: z.object({ desktop: z.object({ page: z.string() }) }),
  thumbnail: z.object({ source: z.string() }).optional(),
});

/** 국가 → 현지 언어 (위키 언어 코드). 한국어·영어 제목이 맞지 않을 때 현지어 제목(예: Sevilla)으로 찾는다 */
const LOCAL_LANG: Record<string, string> = {
  ES: "es", MX: "es", AR: "es", CL: "es", CO: "es", PE: "es",
  PT: "pt", BR: "pt", FR: "fr", BE: "fr", IT: "it", DE: "de", AT: "de", CH: "de",
  NL: "nl", JP: "ja", CN: "zh", TW: "zh", HK: "zh", TR: "tr", GR: "el", CZ: "cs",
  PL: "pl", HU: "hu", HR: "hr", RU: "ru", VN: "vi", TH: "th", ID: "id", MA: "fr",
};

/** 검색 결과에서 확인할 상위 문서 수 (동음이의 문서를 건너뛰기 위함) */
const SEARCH_CANDIDATES = 3;

/** 검색어에 붙일 국가명 (동명 도시 구분: "코르도바" → "코르도바 스페인") */
function countryName(countryCode: string, lang: WikiLang): string {
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(countryCode.toUpperCase()) ?? "";
  } catch {
    return "";
  }
}

const searchSchema = z.object({
  query: z.object({ search: z.array(z.object({ title: z.string() })).optional() }).optional(),
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

/** ko 문서 제목 기준 다른 언어 제목 (언어 간 링크) */
interface TitleVariants {
  en?: string;
  local?: string;
}

/**
 * Wikipedia/Wikivoyage REST 요약 API 어댑터.
 * 각 사이트마다 ko → en 순서로 시도한다. 한글 도시명(예: 세비야)이 문서 제목과 맞지 않는 경우를 줄이려고
 * 제목 후보를 다변화한다:
 *   ko: 입력 이름 → ko 위키 검색 1위
 *   en: ko 문서의 언어 간 링크(en) → 영문 힌트 → 현지어 제목(언어 간 링크, 예: Sevilla) → en 위키 검색 1위
 * 요약 API는 redirect=true라 현지어·별칭 제목도 대표 문서로 이어진다.
 */
export class WikipediaKnowledge {
  private readonly headers: Record<string, string>;
  private readonly variantCache = new Map<string, TitleVariants>();

  constructor(private readonly config: WikiConfig = {}) {
    this.headers = {
      "User-Agent": config.userAgent ?? DEFAULT_UA,
      "Api-User-Agent": config.userAgent ?? DEFAULT_UA,
      Accept: "application/json",
    };
  }

  /**
   * 한 사이트가 실패해도 다른 사이트 결과는 살린다. 둘 다 실패하면 첫 오류를 던진다
   * @param englishName ko 문서가 없거나 언어 링크가 없을 때 사용할 영문 제목 힌트
   * @param countryCode 현지어 제목 후보를 고를 국가 (ISO 3166-1 alpha-2)
   */
  async getCityKnowledge(name: string, englishName?: string, countryCode?: string): Promise<CityKnowledge> {
    const [wikipedia, wikivoyage] = await Promise.allSettled([
      this.getSummary("wikipedia", name, englishName, countryCode),
      this.getSummary("wikivoyage", name, englishName, countryCode),
    ]);
    if (wikipedia.status === "rejected" && wikivoyage.status === "rejected") throw wikipedia.reason;
    const value = (r: PromiseSettledResult<WikiSummary | null>, site: WikiSite) => {
      if (r.status === "fulfilled") return r.value;
      console.warn(`[wiki] ${site} 조회 실패 — 다른 출처만 사용`, r.reason);
      return null;
    };
    return { wikipedia: value(wikipedia, "wikipedia"), wikivoyage: value(wikivoyage, "wikivoyage") };
  }

  async getSummary(site: WikiSite, name: string, englishName?: string, countryCode?: string): Promise<WikiSummary | null> {
    // ko: 입력 이름 그대로 → 없으면(또는 동음이의 문서면) "도시명 국가명"으로 검색
    const country = (lang: WikiLang) => (countryCode ? countryName(countryCode, lang) : "");
    const ko = (await this.fetchSummary(site, "ko", name)) ?? (await this.searchAndFetch(site, "ko", `${name} ${country("ko")}`.trim()));
    if (ko) return ko;

    // en: 언어 간 링크(en·현지어) → 영문 힌트 → 검색
    const variants = await this.titleVariants(name, countryCode);
    for (const title of unique([variants.en, englishName, variants.local])) {
      const summary = await this.fetchSummary(site, "en", title!);
      if (summary) return summary;
    }
    return this.searchAndFetch(site, "en", `${variants.en ?? englishName ?? variants.local ?? name} ${country("en")}`.trim());
  }

  /**
   * 정확한 제목이 없을 때: 사이트 검색 상위 문서 중 처음으로 쓸 수 있는 요약 (동음이의 문서는 건너뜀).
   * 검색 자체가 실패하면 "없음"으로 보고 다음 단계(AI 요약)로 넘긴다
   */
  private async searchAndFetch(site: WikiSite, lang: WikiLang, query: string): Promise<WikiSummary | null> {
    const url = new URL(`https://${lang}.${site}.org/w/api.php`);
    url.search = new URLSearchParams({ action: "query", format: "json", formatversion: "2", list: "search", srsearch: query, srlimit: String(SEARCH_CANDIDATES) }).toString();
    try {
      const data = searchSchema.parse(await fetchJson(url.toString(), { headers: this.headers }, this.config.retry));
      for (const { title } of data.query?.search ?? []) {
        const summary = await this.fetchSummary(site, lang, title);
        if (summary) return summary;
      }
      return null;
    } catch (error) {
      console.warn(`[wiki] ${lang}.${site} 검색 실패 (${query})`, error);
      return null;
    }
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
   * ko 위키백과 문서의 언어 간 링크로 en·현지어 제목을 한 번에 찾는다 (없으면 빈 객체).
   * ko 위키여행은 문서가 적어 언어 링크도 위키백과 기준으로 찾는다 (en 위키여행 제목은 대개 위키백과와 같다).
   */
  private async titleVariants(koTitle: string, countryCode?: string): Promise<TitleVariants> {
    const local = countryCode ? LOCAL_LANG[countryCode.toUpperCase()] : undefined;
    const key = `${koTitle}|${local ?? ""}`;
    const cached = this.variantCache.get(key);
    if (cached) return cached;
    const url = new URL("https://ko.wikipedia.org/w/api.php");
    url.search = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      prop: "langlinks",
      lllimit: "max",
      redirects: "1",
      titles: koTitle,
    }).toString();
    try {
      const data = langLinksSchema.parse(await fetchJson(url.toString(), { headers: this.headers }, this.config.retry));
      const links = data.query?.pages[0]?.langlinks ?? [];
      const variants = {
        en: links.find((l) => l.lang === "en")?.title,
        local: local ? links.find((l) => l.lang === local)?.title : undefined,
      };
      this.variantCache.set(key, variants);
      return variants;
    } catch {
      return {}; // 언어 링크 조회 실패는 치명적이지 않음
    }
  }
}

function unique(values: (string | undefined)[]): (string | undefined)[] {
  return [...new Set(values.filter(Boolean))];
}
