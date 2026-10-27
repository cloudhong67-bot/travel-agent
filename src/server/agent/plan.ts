/**
 * PRD 7장 5단계 "동선 최적화 (코드)": 이동시간 행렬 → 최근접 이웃 + 2-opt(optimizer.ts) → 시간표 → 경로선(GeoJSON).
 */
import { haversineM } from "@/server/adapters/maps/naver";
import type { LatLng, MapsProvider, TravelMode } from "@/server/adapters/maps/types";
import type { DayAssignment } from "./assign";
import { optimizeTour } from "./optimizer";
import { dayDate, WEEKDAY_KO } from "./poiUtils";
import type { DayPlan, NearbyTown, PlannedStop } from "./types";

export const DAY_START = "09:00";
const DAY_TRIP_STAY_MINS = 360;
/** 행렬에 값이 없을 때 직선거리 기반 추정 속도(km/h)와 우회 계수 */
const ESTIMATE_KMH: Record<TravelMode, number> = { walking: 4.5, bicycling: 14, transit: 18, driving: 30 };
const DETOUR = 1.3;

export type MatrixBasis = DayPlan["travelBasis"];

export interface MinutesMatrix {
  minutes: (number | null)[][];
  basis: MatrixBasis;
}

const toLatLng = (p: { lat: number; lon: number }): LatLng => ({ lat: p.lat, lng: p.lon });

/** 국내(KR)는 Naver Directions가 자동차만 지원하므로 항상 driving. 그 외는 사용자 선택을 따른다 */
export function tripMode(transport: string, countryCode: string): TravelMode {
  if (countryCode === "KR") return "driving";
  if (transport === "driving") return "driving";
  if (transport === "walking") return "walking";
  return "transit";
}

function estimateMinutes(a: LatLng, b: LatLng, mode: TravelMode): number {
  return Math.round(((haversineM(a, b) / 1000) * DETOUR * 60) / ESTIMATE_KMH[mode]);
}

/**
 * 지점 간 이동시간(분) 행렬.
 *  - Naver: 쌍별 호출이라 비용이 크므로 상삼각만 호출하고 대칭으로 채운다 (자동차 기준 근사)
 *  - Google: 요청 모드 행렬에서 빈 칸(예: 일본은 Routes API 대중교통 미제공)은 자동차 행렬로 채운다
 *  - 그래도 빈 칸은 직선거리로 추정
 */
export async function travelMinutes(maps: MapsProvider, points: LatLng[], mode: TravelMode): Promise<MinutesMatrix> {
  const n = points.length;
  const minutes: (number | null)[][] = points.map((_, i) => points.map((_, j) => (i === j ? 0 : null)));
  let basis: MatrixBasis = mode;

  if (maps.name === "naver") {
    basis = "driving";
    for (let i = 0; i < n - 1; i++) {
      const row = await maps.travelTimeMatrix([points[i]], points.slice(i + 1), "driving");
      if (!row.supported) break;
      row.cells[0].forEach((cell, k) => {
        const j = i + 1 + k;
        if (cell) minutes[i][j] = minutes[j][i] = Math.round(cell.durationSec / 60);
      });
    }
  } else {
    const fill = (m: Awaited<ReturnType<MapsProvider["travelTimeMatrix"]>>, onlyEmpty: boolean) => {
      if (!m.supported) return;
      m.cells.forEach((row, i) =>
        row.forEach((cell, j) => {
          if (cell && (!onlyEmpty || minutes[i][j] === null)) minutes[i][j] = Math.round(cell.durationSec / 60);
        }),
      );
    };
    fill(await maps.travelTimeMatrix(points, points, mode), false);
    const missing = minutes.flat().filter((v) => v === null).length;
    if (missing > 0 && mode !== "driving") {
      const total = n * n - n;
      basis = missing === total ? "driving" : "mixed";
      fill(await maps.travelTimeMatrix(points, points, "driving"), true);
    }
  }

  let estimated = false;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      if (minutes[i][j] === null) {
        minutes[i][j] = estimateMinutes(points[i], points[j], mode);
        estimated = true;
      }
  return { minutes, basis: estimated ? "estimated" : basis };
}

const addMinutes = (hhmm: string, mins: number) => {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/** 하루 일정을 만든다 (검증 결과는 validator가 채움) */
export async function planDay(args: {
  maps: MapsProvider;
  assignment: DayAssignment;
  base: { name: string; lat: number; lon: number };
  mode: TravelMode;
  startDate: string | null;
  nearbyTowns: NearbyTown[];
  warnings: string[];
}): Promise<DayPlan> {
  const { maps, assignment, base, mode } = args;
  const date = dayDate(args.startDate, assignment.dayIndex);

  // 근교 당일치기: 거점 ↔ 근교 도시 왕복
  const town = assignment.dayTripTown ? args.nearbyTowns.find((t) => t.name === assignment.dayTripTown) : undefined;
  const items: { key: string; poiId: string | null; name: string; category: PlannedStop["category"]; lat: number; lon: number; stayMins: number; sourceUrl: string | null; hours: string[] | null }[] =
    town
      ? [
          {
            key: `T:${town.name}`,
            poiId: null,
            name: town.name,
            category: "town",
            lat: town.lat,
            lon: town.lon,
            stayMins: DAY_TRIP_STAY_MINS,
            sourceUrl: `https://www.google.com/maps/search/?api=1&query=${town.lat},${town.lon}`,
            hours: null,
          },
        ]
      : assignment.stops.map(({ poi, stayMins }) => ({
          key: poi.key,
          poiId: poi.id ?? null,
          name: poi.name,
          category: poi.category,
          lat: poi.lat,
          lon: poi.lon,
          stayMins,
          sourceUrl: poi.sourceUrl,
          hours: poi.hours,
        }));

  const points = [toLatLng(base), ...items.map(toLatLng)];
  let order = [0];
  let minutes: (number | null)[][] = [[0]];
  let basis: MatrixBasis = mode;

  if (items.length > 0) {
    const matrix = await travelMinutes(maps, points, mode);
    minutes = matrix.minutes;
    basis = matrix.basis;
    order = optimizeTour(minutes).order;
  }

  // 시간표
  let clock = DAY_START;
  let travelMins = 0;
  let stayMins = 0;
  const stops: PlannedStop[] = [];
  for (let k = 1; k < order.length; k++) {
    const idx = order[k];
    const item = items[idx - 1];
    const travel = minutes[order[k - 1]][idx] ?? 0;
    const arrive = addMinutes(clock, travel);
    const depart = addMinutes(arrive, item.stayMins);
    stops.push({
      order: k,
      key: item.key,
      poiId: item.poiId,
      name: item.name,
      category: item.category,
      lat: item.lat,
      lon: item.lon,
      arrive,
      depart,
      stayMins: item.stayMins,
      travelMinsFromPrev: travel,
      sourceUrl: item.sourceUrl,
      openingHours: item.hours,
    });
    travelMins += travel;
    stayMins += item.stayMins;
    clock = depart;
  }
  const returnTravelMins = order.length > 1 ? (minutes[order[order.length - 1]][0] ?? 0) : 0;
  travelMins += returnTravelMins;

  // 경로선: 거점 → 방문지(최적 순서) → 거점
  let routeGeo: DayPlan["routeGeo"] = null;
  if (stops.length > 0) {
    // 행렬이 자동차로 대체됐다면(예: 대중교통 데이터 없음) 경로선도 자동차로 그린다
    const routeMode: TravelMode = basis === "driving" ? "driving" : mode;
    try {
      const route = await maps.routeGeometry([toLatLng(base), ...stops.map(toLatLng), toLatLng(base)], routeMode);
      if (route.supported) routeGeo = route.geometry;
      else args.warnings.push(`day ${assignment.dayIndex} 경로선: ${route.reason}`);
    } catch (error) {
      args.warnings.push(`day ${assignment.dayIndex} 경로선을 만들지 못했습니다: ${(error as Error).message.slice(0, 120)}`);
    }
  }

  return {
    dayIndex: assignment.dayIndex,
    title: assignment.title,
    date: date?.date ?? null,
    weekday: date ? WEEKDAY_KO[date.weekday] : null,
    mode,
    travelBasis: basis,
    base,
    stops,
    returnTravelMins,
    totals: { travelMins, stayMins, travelRatio: stayMins > 0 ? Number((travelMins / stayMins).toFixed(3)) : 0 },
    dayTripTown: town?.name ?? null,
    routeGeo,
    validation: { passed: true, issues: [] },
    needsReview: false,
    attempts: 1,
  };
}
