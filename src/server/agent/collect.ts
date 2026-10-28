/**
 * PRD 7장 3단계 "병렬 수집"의 개별 작업. 각 함수는 독립적으로 실패할 수 있고, 오케스트레이터가 allSettled로 묶는다.
 */
import type { BackgroundField } from "@/lib/schemas";
import { isQuotaExhausted } from "@/lib/http";
import { hostnameOf } from "@/lib/url";
import { haversineM } from "@/server/adapters/maps/naver";
import type { LlmProvider } from "@/server/adapters/llm/types";
import type { LatLng, MapsProvider, Place, TravelMode } from "@/server/adapters/maps/types";
import type { AgentDeps, AgentPoi, CityBackground, NearbyTown, PoiCategory, SearchProvider, TourismInfo } from "./types";
import { dedupePois, normalizeName, rankSources } from "./poiUtils";
import { HISTORY_SYSTEM, HistorySummarySchema, historyResponseSchema, historyUserPrompt } from "./prompts/history";
import {
  NEARBY_CANDIDATES_SYSTEM,
  NEARBY_SELECT_SYSTEM,
  NearbyCandidatesSchema,
  NearbySelectionSchema,
  nearbyCandidatesPrompt,
  nearbyCandidatesResponseSchema,
  nearbySelectPrompt,
  nearbySelectionResponseSchema,
} from "./prompts/nearby";
import { alternativeTourismQuery, needsAlternativeSources, parseTourismAnswer, tourismQuery } from "./prompts/tourism";
import { BudgetExceededError } from "./budget";
import { TRANSLATE_SYSTEM, TranslationSchema, translateUserPrompt, translationResponseSchema } from "./prompts/translate";

/** LLM의 JSON 텍스트 응답을 Zod로 검증 (코드펜스가 붙어 와도 처리) */
export function parseJsonOutput<T>(text: string, schema: { parse: (v: unknown) => T }): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  return schema.parse(JSON.parse(cleaned));
}

// ---------- 역사·배경 ----------

const BACKGROUND_FIELDS: BackgroundField[] = ["history", "culture", "bestTime", "etiquette"];
/** AI 요약 없이 원문을 그대로 보여줄 때의 길이 상한 */
const ORIGINAL_TEXT_MAX = 600;

const clip = (text: string) => (text.length > ORIGINAL_TEXT_MAX ? `${text.slice(0, ORIGINAL_TEXT_MAX)}…` : text);

/**
 * 역사·문화·기후·매너 요약. 원천과 대체 경로:
 *   1) 위키 원문(ko 우선, 없으면 en·현지어 제목·검색) → Gemini가 한국어로 요약. 원문에 없는 항목은 일반 지식으로 채워 aiFields에 표시
 *   2) 위키 조회가 실패하거나 비어 있으면 → Gemini 일반 지식만으로 요약 (모든 항목 AI 표시)
 *   3) Gemini가 실패하면(할당량 소진 등) → 위키 원문 소개를 그대로 담는다 (한국어 문서 우선, 외국어면 untranslatedLang 표시)
 * 원문도 Gemini도 없을 때만 실패한다 (상위에서 경고로 바뀐다). 비용 상한 초과는 그대로 던진다.
 */
export async function collectHistory(
  llm: LlmProvider,
  wiki: AgentDeps["wiki"],
  cityName: string,
  englishName?: string,
  countryCode?: string,
): Promise<CityBackground> {
  const knowledge = await wiki.getCityKnowledge(cityName, englishName, countryCode).catch((e) => {
    console.warn(`[agent] 위키 원문 조회 실패 — 일반 지식으로 요약합니다 (${cityName})`, e);
    return { wikipedia: null, wikivoyage: null };
  });
  const docs = [knowledge.wikipedia, knowledge.wikivoyage].filter((d) => d !== null);
  const sources = docs.map((d) => ({ title: `${d.site === "wikipedia" ? "위키백과" : "위키여행"}: ${d.title}`, url: d.url }));

  try {
    const res = await llm.generate({
      systemInstruction: HISTORY_SYSTEM,
      messages: [{ role: "user", parts: [{ kind: "text", text: historyUserPrompt(cityName, docs) }] }],
      thinkingLevel: "low",
      responseJsonSchema: historyResponseSchema,
      temperature: 0.2,
    });
    const { aiFields: reported, ...fields } = parseJsonOutput(res.text, HistorySummarySchema);
    const filled = BACKGROUND_FIELDS.filter((f) => fields[f]);
    // 원문이 없으면 채운 항목은 모두 AI 지식이다. 모델이 aiFields를 빠뜨려도 출처 기반처럼 보이지 않게 코드가 정한다
    const aiFields = docs.length === 0 ? filled : filled.filter((f) => reported.includes(f));
    return { ...fields, sources, aiFields, isAiSummary: aiFields.length > 0, isOriginalText: false, untranslatedLang: null };
  } catch (error) {
    if (error instanceof BudgetExceededError || docs.length === 0) throw error;
    console.warn(`[agent] 배경지식 요약 실패 — 위키 원문으로 대신합니다 (${cityName})`, error);
    // 역사는 위키백과, 소개 글은 위키여행 원문. 번역할 수 없으므로 한국어 문서가 있으면 한국어 문서만 쓴다
    const koDocs = docs.filter((d) => d.lang === "ko");
    const usable = koDocs.length ? koDocs : docs;
    const pick = (site: "wikipedia" | "wikivoyage") => usable.find((d) => d.site === site);
    const history = pick("wikipedia") ?? usable[0];
    const intro = pick("wikivoyage");
    const foreign = [history, intro].find((d) => d && d.lang !== "ko");
    return {
      history: clip(history.extract),
      culture: intro && intro !== history ? clip(intro.extract) : null,
      bestTime: null,
      etiquette: null,
      sources,
      aiFields: [],
      isAiSummary: false,
      isOriginalText: true,
      untranslatedLang: foreign?.lang ?? null,
    };
  }
}

/** 원문을 한국어로 옮긴다. 실패하면 null (호출 측이 원문을 그대로 쓰고 표시). 비용 상한 초과는 던진다 */
async function translateToKorean(llm: LlmProvider, text: string): Promise<string | null> {
  try {
    const res = await llm.generate({
      systemInstruction: TRANSLATE_SYSTEM,
      messages: [{ role: "user", parts: [{ kind: "text", text: translateUserPrompt(text) }] }],
      thinkingLevel: "low",
      responseJsonSchema: translationResponseSchema,
      temperature: 0.1,
    });
    return parseJsonOutput(res.text, TranslationSchema).text.trim() || null;
  } catch (error) {
    if (error instanceof BudgetExceededError) throw error;
    console.warn("[agent] 번역 실패 — 원문을 그대로 씁니다", error);
    return null;
  }
}

// ---------- 관광청 ----------

type SearchAnswer = Awaited<ReturnType<SearchProvider["search"]>>;

/** 검색 1회 결과 → 해석 + 출처 (모델이 답한 사이트는 같은 도메인 출처가 없을 때만 추가: 경로만 다른 중복 카드 방지) */
function readAnswer(res: SearchAnswer, siteTitle: string) {
  const parsed = parseTourismAnswer(res.summary);
  const sources = [...res.sources];
  const siteHost = parsed.officialSite ? hostnameOf(parsed.officialSite) : null;
  if (parsed.officialSite && siteHost && !sources.some((s) => hostnameOf(s.url) === siteHost)) {
    sources.push({ title: siteTitle, url: parsed.officialSite });
  }
  return { parsed, sources, res };
}

const uniqueBy = <T>(items: T[], key: (t: T) => string) => {
  const seen = new Set<string>();
  return items.filter((t) => (seen.has(key(t)) ? false : (seen.add(key(t)), true)));
};

/**
 * 관광청 정보. 정보원 우선순위:
 *   1) 공식 관광청 (검색 그라운딩)
 *   2) 1)에 공식 사이트가 없거나 추천 명소가 부족하면 대체 출처(위키여행·지자체·여행 플랫폼) 검색을 더해 병합
 *   3) 검색이 모두 실패하면 위키여행 요약(외국어면 한국어로 번역)으로 최소 정보를 만든다
 * Gemini 할당량이 소진됐으면 남은 AI 호출(대체 검색·번역)은 건너뛴다. 비용 상한 초과는 그대로 던진다 (부분 저장 흐름).
 */
export async function collectTourism(
  search: SearchProvider,
  llm: LlmProvider,
  wiki: AgentDeps["wiki"],
  countryName: string,
  cityName: string,
  countryCode: string,
): Promise<TourismInfo> {
  let quotaOut = false;
  const attempt = async (query: string, siteTitle: string) => {
    if (quotaOut) return null;
    try {
      return readAnswer(await search.search(query, { countryCode }), siteTitle);
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;
      quotaOut = isQuotaExhausted(error);
      console.warn(`[agent] 관광 정보 검색 실패 (${cityName})`, error);
      return null;
    }
  };

  const official = await attempt(tourismQuery(countryName, cityName), "공식 관광청");
  const alternative =
    !official || needsAlternativeSources(official.parsed) ? await attempt(alternativeTourismQuery(countryName, cityName), "대표 여행 정보") : null;
  const answers = [official, alternative].filter((a) => a !== null);
  if (answers.length === 0 || answers.every((a) => !a.parsed.summary)) {
    return wikivoyageTourism(wiki, quotaOut ? null : llm, cityName, countryCode);
  }

  const isOfficial = Boolean(official?.parsed.officialSite);
  // 요약은 공식 관광청 답이 있으면 그것을, 아니면 대체 출처 답을 쓴다. 목록 항목은 합친다
  const lead = isOfficial ? official! : (alternative ?? official!);
  const all = <K extends "recommended" | "festivals" | "transitPasses">(k: K) => uniqueBy(answers.flatMap((a) => a.parsed[k]), normalizeName);
  return {
    sourceType: isOfficial ? "official" : "alternative",
    summary: lead.parsed.summary,
    recommended: all("recommended").slice(0, 8),
    festivals: all("festivals"),
    transitPasses: all("transitPasses"),
    sources: rankSources(uniqueBy(answers.flatMap((a) => a.sources), (s) => s.url)),
    searchQueries: [...new Set(answers.flatMap((a) => a.res.searchQueries ?? []))],
    // 검색 결과를 보여주므로 검색마다 받은 검색 추천을 모두 함께 표시한다 (Gemini API 약관)
    searchEntryPointHtml: answers.map((a) => a.res.searchEntryPointHtml).filter(Boolean).join("\n") || null,
    untranslatedLang: null,
  };
}

/**
 * 검색이 모두 실패했을 때의 최소 정보: 위키여행 도시 문서 요약 (없으면 실패).
 * 한국어 문서가 없어 영어 원문이면 한국어로 번역한다 (llm이 null이거나 번역 실패면 원문 + untranslatedLang)
 */
async function wikivoyageTourism(wiki: AgentDeps["wiki"], llm: LlmProvider | null, cityName: string, countryCode: string): Promise<TourismInfo> {
  const doc = await wiki.getSummary("wikivoyage", cityName, undefined, countryCode);
  if (!doc) throw new Error(`관광 정보를 찾지 못했습니다 (검색·위키여행 모두 없음): ${cityName}`);
  const original = clip(doc.extract);
  const translated = doc.lang !== "ko" && llm ? await translateToKorean(llm, original) : null;
  return {
    sourceType: "alternative",
    summary: translated ?? original,
    recommended: [],
    festivals: [],
    transitPasses: [],
    sources: rankSources([{ title: `위키여행: ${doc.title}`, url: doc.url }]),
    searchQueries: [],
    searchEntryPointHtml: null,
    untranslatedLang: doc.lang !== "ko" && !translated ? doc.lang : null,
  };
}

// ---------- POI ----------

/** 거점에서 이 거리 밖의 검색 결과는 버린다 (동명 장소·광역 검색 결과 방지) */
const POI_RADIUS_M = 30_000;
const MAX_POIS = 30;

const CATEGORY_QUERIES: { category: PoiCategory; suffix: string }[] = [
  { category: "sight", suffix: "관광 명소" },
  { category: "museum", suffix: "박물관 미술관" },
  { category: "food", suffix: "현지 맛집" },
];

function toAgentPoi(place: Place, category: PoiCategory, origin: AgentPoi["origin"]): AgentPoi {
  // Naver 지역검색은 link가 비어 있는 경우가 많아 네이버 지도 검색 링크를 출처로 쓴다.
  const sourceUrl =
    place.url ||
    (place.provider === "naver"
      ? `https://map.naver.com/p/search/${encodeURIComponent(`${place.name} ${place.address ?? ""}`.trim())}`
      : null);
  return {
    key: "",
    externalId: `${place.provider}:${place.id}`,
    name: place.name,
    category,
    lat: place.location.lat,
    lon: place.location.lng,
    hours: place.openingHours?.length ? place.openingHours : null,
    sourceUrl,
    rating: place.rating,
    origin,
  };
}

const within = (center: LatLng, p: AgentPoi) => haversineM(center, { lat: p.lat, lng: p.lon }) <= POI_RADIUS_M;

/** 지도 공급자 장소 검색 (카테고리별) */
export async function searchCityPois(maps: MapsProvider, center: LatLng, cityName: string): Promise<AgentPoi[]> {
  const limit = maps.name === "naver" ? 5 : 10;
  const settled = await Promise.allSettled(
    CATEGORY_QUERIES.map(async ({ category, suffix }) => {
      const places = await maps.searchPlaces(`${cityName} ${suffix}`, { near: center, radiusM: 20_000, limit, language: "ko" });
      return places.map((p) => toAgentPoi(p, category, maps.name));
    }),
  );
  const pois = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (pois.length === 0) {
    const firstError = settled.find((r) => r.status === "rejected");
    if (firstError) throw firstError.reason;
  }
  return pois.filter((p) => within(center, p));
}

/** 관광청 추천 명소 이름을 지도에서 찾아 좌표를 붙인다 (좌표를 못 찾은 이름은 버림) */
export async function lookupRecommended(
  maps: MapsProvider,
  center: LatLng,
  cityName: string,
  names: string[],
): Promise<AgentPoi[]> {
  const settled = await Promise.allSettled(
    names.slice(0, 6).map(async (name) => {
      const [place] = await maps.searchPlaces(`${name} ${cityName}`, { near: center, radiusM: 20_000, limit: 1, language: "ko" });
      return place ? toAgentPoi(place, "sight", "tourism") : null;
    }),
  );
  return settled
    .flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []))
    .filter((p) => within(center, p));
}

/** 관광청 추천을 앞에 두고 중복 제거 후, 카테고리 균형을 맞춰 최대 30곳 */
export function mergePois(recommended: AgentPoi[], searched: AgentPoi[]): AgentPoi[] {
  const merged = dedupePois([...recommended, ...searched]);
  if (merged.length <= MAX_POIS) return merged;
  const fromTourism = merged.filter((p) => p.origin === "tourism");
  const rest = merged
    .filter((p) => p.origin !== "tourism")
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  return [...fromTourism, ...rest].slice(0, MAX_POIS);
}

// ---------- 근교 소도시 ----------

const NEARBY_MAX_KM = 150;
const NEARBY_MIN_KM = 8;
const NEARBY_MAX_MINS = 120;
const DAY_TRIP_MAX_MINS = 90;

export interface NearbyResult {
  towns: NearbyTown[];
  basis: TravelMode;
  warnings: string[];
}

export async function collectNearbyTowns(args: {
  llm: LlmProvider;
  geocoder: MapsProvider;
  maps: MapsProvider;
  base: LatLng;
  cityName: string;
  countryName: string;
  style: string;
  mode: TravelMode;
}): Promise<NearbyResult> {
  const { llm, geocoder, maps, base, cityName, countryName, style } = args;
  const warnings: string[] = [];

  // (1) 후보 지명 (LLM) → (2) 지오코딩으로 실존·거리 확인 (코드)
  const cand = await llm.generate({
    systemInstruction: NEARBY_CANDIDATES_SYSTEM,
    messages: [{ role: "user", parts: [{ kind: "text", text: nearbyCandidatesPrompt(cityName, countryName, base.lat, base.lng) }] }],
    thinkingLevel: "low",
    responseJsonSchema: nearbyCandidatesResponseSchema,
    temperature: 0.2,
  });
  const { towns: names } = parseJsonOutput(cand.text, NearbyCandidatesSchema);

  const located = await Promise.allSettled(
    names.map(async (t) => {
      const [hit] = await geocoder.geocode(`${t.localName}, ${countryName}`, { language: "ko" });
      if (!hit) return null;
      const km = haversineM(base, hit.location) / 1000;
      return km >= NEARBY_MIN_KM && km <= NEARBY_MAX_KM ? { name: t.name, location: hit.location, km } : null;
    }),
  );
  const seen = new Set<string>();
  const candidates = located
    .flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []))
    .filter((c) => {
      const k = `${c.location.lat.toFixed(3)},${c.location.lng.toFixed(3)}`;
      return seen.has(k) ? false : (seen.add(k), true);
    });
  if (candidates.length === 0) return { towns: [], basis: args.mode, warnings: ["근교 도시 후보를 확인하지 못했습니다."] };

  // (3) 이동시간 행렬로 120분 이내만 (대중교통 데이터가 없으면 자동차로 대체)
  let basis = args.mode;
  let matrix = await maps.travelTimeMatrix([base], candidates.map((c) => c.location), basis);
  const empty = (m: typeof matrix) => !m.supported || m.cells[0].every((c) => c === null);
  if (empty(matrix) && basis !== "driving") {
    basis = "driving";
    warnings.push("근교 도시 대중교통 이동시간을 받을 수 없어 자동차 기준으로 계산했습니다.");
    matrix = await maps.travelTimeMatrix([base], candidates.map((c) => c.location), basis);
  }
  if (!matrix.supported) return { towns: [], basis, warnings: [...warnings, matrix.reason] };

  const reachable = candidates
    .map((c, i) => ({ ...c, travelMins: matrix.supported ? Math.round((matrix.cells[0][i]?.durationSec ?? Infinity) / 60) : Infinity }))
    .filter((c) => c.travelMins <= NEARBY_MAX_MINS);
  if (reachable.length === 0) return { towns: [], basis, warnings: [...warnings, "편도 120분 이내 근교 도시가 없습니다."] };

  // (4) 스타일 적합도로 2~5곳 선정 (LLM은 후보 안에서만)
  const sel = await llm.generate({
    systemInstruction: NEARBY_SELECT_SYSTEM,
    messages: [
      {
        role: "user",
        parts: [
          {
            kind: "text",
            text: nearbySelectPrompt(
              cityName,
              style,
              reachable.map((c) => ({ name: c.name, travelMins: c.travelMins, distanceKm: Math.round(c.km) })),
            ),
          },
        ],
      },
    ],
    thinkingLevel: "low",
    responseJsonSchema: nearbySelectionResponseSchema,
    temperature: 0.3,
  });
  const { selected } = parseJsonOutput(sel.text, NearbySelectionSchema);

  const byName = new Map(reachable.map((c) => [normalizeName(c.name), c]));
  const towns: NearbyTown[] = [];
  for (const s of selected) {
    const c = byName.get(normalizeName(s.name));
    if (!c) {
      warnings.push(`근교 도시 선정 결과에서 후보에 없는 이름(${s.name})을 제외했습니다.`);
      continue;
    }
    if (towns.some((t) => t.name === c.name)) continue;
    towns.push({
      name: c.name,
      lat: c.location.lat,
      lon: c.location.lng,
      travelMins: c.travelMins,
      kind: c.travelMins <= DAY_TRIP_MAX_MINS ? "dayTrip" : "overnight",
      reason: s.reason,
    });
  }
  return { towns: towns.slice(0, 5), basis, warnings };
}
