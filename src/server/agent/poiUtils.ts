import { haversineM } from "@/server/adapters/maps/naver";
import type { AgentPoi } from "./types";

/** 같은 장소로 볼 거리 (PRD: 좌표 100m 이내 + 이름 유사) */
export const DUPLICATE_RADIUS_M = 100;
/**
 * 이름이 달라도 같은 장소로 보는 거리. 관광청 추천은 원어("Palácio da Bolsa"), 지도 검색은 한국어("볼사 궁전")라
 * 이름 비교만으로는 중복을 못 잡는다. 30m 이내면 사실상 같은 건물로 본다.
 */
const SAME_SPOT_RADIUS_M = 30;
const HANGUL = /[가-힣]/;
/** 이름이 완전히 같으면 좌표가 조금 달라도(공급자별 대표 좌표 차이) 같은 장소로 본다 */
const SAME_NAME_RADIUS_M = 1_000;

export function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\(.*?\)|（.*?）/g, "")
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function similarNames(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 2 && long.includes(short);
}

/**
 * 이름·좌표로 POI 중복 제거. 먼저 나온 항목을 남기고, 빠진 정보(운영시간·출처·평점)는 중복 항목에서 채운다.
 * 중복 기준: 같은 공급자 장소 ID, 30m 이내, (100m 이내 && 이름 유사), (정규화 이름 동일 && 1km 이내)
 */
export function dedupePois(pois: AgentPoi[]): AgentPoi[] {
  const kept: (AgentPoi & { norm: string })[] = [];
  for (const poi of pois) {
    if (!Number.isFinite(poi.lat) || !Number.isFinite(poi.lon)) continue; // 좌표 없는 장소는 받지 않는다
    const norm = normalizeName(poi.name);
    const dup = kept.find((k) => {
      if (k.externalId && k.externalId === poi.externalId) return true;
      const d = haversineM({ lat: k.lat, lng: k.lon }, { lat: poi.lat, lng: poi.lon });
      return (
        d <= SAME_SPOT_RADIUS_M ||
        (d <= DUPLICATE_RADIUS_M && similarNames(k.norm, norm)) ||
        (k.norm === norm && d <= SAME_NAME_RADIUS_M)
      );
    });
    if (dup) {
      // 관광청 추천은 원어 이름("Palácio da Bolsa")으로 오는 경우가 많다. 같은 장소의 한국어 이름이 있으면 그쪽을 표시한다
      if (!HANGUL.test(dup.name) && HANGUL.test(poi.name)) {
        dup.name = poi.name;
        dup.norm = norm;
      }
      dup.hours ??= poi.hours;
      dup.sourceUrl ??= poi.sourceUrl;
      dup.rating ??= poi.rating;
      continue;
    }
    kept.push({ ...poi, norm });
  }
  return kept.map(({ norm: _norm, ...p }) => p);
}

/** P01, P02 … 형식의 짧은 키를 다시 매긴다 (LLM 토큰 절약, id 환각 검출용) */
export function assignKeys(pois: AgentPoi[]): AgentPoi[] {
  return pois.map((p, i) => ({ ...p, key: `P${String(i + 1).padStart(2, "0")}` }));
}

// ---------- 공식 출처 ----------

const OFFICIAL_HOST_PATTERNS = [
  /\.gov(\.[a-z]{2})?$/,
  /\.gouv\.fr$/,
  /\.go\.(jp|kr)$/,
  /\.gov\.(pt|tr|uk)$/,
  /\.or\.kr$/,
  /(^|\.)(visit|tourism|turismo|tourisme|kanko|kankou|travel)[a-z-]*\./,
  /\.travel$/,
  /(^|\.)(japan\.travel|visitportugal\.com|parisjetaime\.com|goturkiye\.com|visitkorea\.or\.kr|unesco\.org)$/,
];

export function isOfficialSource(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return OFFICIAL_HOST_PATTERNS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

/** 정부·관광청 도메인 출처를 앞으로 (안정 정렬) */
export function rankSources<T extends { url: string }>(sources: T[]): (T & { official: boolean })[] {
  return sources
    .map((s, i) => ({ ...s, official: isOfficialSource(s.url), i }))
    .sort((a, b) => Number(b.official) - Number(a.official) || a.i - b.i)
    .map(({ i: _i, ...s }) => s as T & { official: boolean });
}

// ---------- 운영시간 ----------

const WEEKDAYS: Record<string, number> = {
  일요일: 0, 월요일: 1, 화요일: 2, 수요일: 3, 목요일: 4, 금요일: 5, 토요일: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};
export const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 공급자의 요일별 운영시간 문자열(예: "월요일: 휴무일", "Monday: Closed")에서 휴무 요일(0=일)을 뽑는다.
 * 운영시간 정보가 없으면 null — 알 수 없음이지 "매일 영업"이 아니다.
 */
export function closedWeekdays(hours: string[] | null): Set<number> | null {
  if (!hours || hours.length === 0) return null;
  const closed = new Set<number>();
  for (const line of hours) {
    const [label, ...rest] = line.split(/[:：]/);
    const day = WEEKDAYS[label.trim().toLowerCase()];
    if (day === undefined) continue;
    if (/휴무|closed|定休|休館/i.test(rest.join(":"))) closed.add(day);
  }
  return closed;
}

/** 출발일(YYYY-MM-DD) + dayIndex의 날짜와 요일 */
export function dayDate(startDate: string | null, dayIndex: number): { date: string; weekday: number } | null {
  if (!startDate) return null;
  const d = new Date(`${startDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dayIndex);
  return { date: d.toISOString().slice(0, 10), weekday: d.getUTCDay() };
}
