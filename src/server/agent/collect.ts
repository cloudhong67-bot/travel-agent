/**
 * PRD 7장 3단계 "병렬 수집"의 개별 작업. 각 함수는 독립적으로 실패할 수 있고, 오케스트레이터가 allSettled로 묶는다.
 */
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
import { parseTourismAnswer, tourismQuery } from "./prompts/tourism";

/** LLM의 JSON 텍스트 응답을 Zod로 검증 (코드펜스가 붙어 와도 처리) */
export function parseJsonOutput<T>(text: string, schema: { parse: (v: unknown) => T }): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  return schema.parse(JSON.parse(cleaned));
}

// ---------- 역사·배경 ----------

export async function collectHistory(
  llm: LlmProvider,
  wiki: AgentDeps["wiki"],
  cityName: string,
  englishName?: string,
): Promise<CityBackground> {
  const knowledge = await wiki.getCityKnowledge(cityName, englishName);
  const docs = [knowledge.wikipedia, knowledge.wikivoyage].filter((d) => d !== null);
  const sources = docs.map((d) => ({ title: `${d.site === "wikipedia" ? "위키백과" : "위키여행"}: ${d.title}`, url: d.url }));
  if (docs.length === 0) return { history: null, culture: null, bestTime: null, etiquette: null, sources: [] };

  const res = await llm.generate({
    systemInstruction: HISTORY_SYSTEM,
    messages: [{ role: "user", parts: [{ kind: "text", text: historyUserPrompt(cityName, docs) }] }],
    thinkingLevel: "low",
    responseJsonSchema: historyResponseSchema,
    temperature: 0.2,
  });
  return { ...parseJsonOutput(res.text, HistorySummarySchema), sources };
}

// ---------- 관광청 ----------

export async function collectTourism(
  search: SearchProvider,
  countryName: string,
  cityName: string,
  countryCode: string,
): Promise<TourismInfo> {
  const res = await search.search(tourismQuery(countryName, cityName), { countryCode });
  const parsed = parseTourismAnswer(res.summary);
  const sources = [...res.sources];
  // 모델이 답한 공식 사이트는 검색 출처에 같은 도메인이 없을 때만 추가한다 (경로만 다른 중복 카드 방지)
  const officialHost = parsed.officialSite ? hostnameOf(parsed.officialSite) : null;
  if (parsed.officialSite && officialHost && !sources.some((s) => hostnameOf(s.url) === officialHost)) {
    sources.push({ title: "공식 관광청", url: parsed.officialSite });
  }
  return {
    summary: parsed.summary,
    recommended: parsed.recommended,
    festivals: parsed.festivals,
    transitPasses: parsed.transitPasses,
    sources: rankSources(sources),
    searchQueries: res.searchQueries ?? [],
    searchEntryPointHtml: res.searchEntryPointHtml ?? null,
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
