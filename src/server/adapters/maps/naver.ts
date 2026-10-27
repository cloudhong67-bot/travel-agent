import { z } from "zod";
import { mapWithConcurrency } from "@/lib/concurrency";
import { fetchJson, type RetryOptions } from "@/lib/http";
import type {
  GeocodeResult,
  LatLng,
  MapsProvider,
  MatrixCell,
  Place,
  RouteGeometry,
  SearchPlacesOptions,
  TravelMode,
  TravelTimeMatrix,
} from "./types";

export interface NaverMapsConfig {
  /** NCP Maps Application의 Client ID / Secret (x-ncp-apigw-api-key-id / x-ncp-apigw-api-key) */
  mapsClientId: string;
  mapsClientSecret: string;
  /** Naver Developers 검색 API (지역 검색) 자격증명 */
  searchClientId: string;
  searchClientSecret: string;
  retry?: RetryOptions;
}

const GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";
const DIRECTIONS5_URL = "https://maps.apigw.ntruss.com/map-direction/v1/driving";
const DIRECTIONS15_URL = "https://maps.apigw.ntruss.com/map-direction-15/v1/driving";
const LOCAL_SEARCH_URL = "https://openapi.naver.com/v1/search/local.json";

/** Directions 15는 경유지 최대 15개 → 출발·도착 포함 17개 */
const MAX_ROUTE_POINTS = 17;
const MATRIX_CONCURRENCY = 3;

const DRIVING_ONLY_REASON =
  "Naver Directions는 자동차(driving) 경로만 제공합니다. 도보·대중교통·자전거 이동시간은 지원하지 않습니다.";

// ---- 응답 스키마 ----

const geocodeResponseSchema = z.object({
  status: z.string(),
  errorMessage: z.string().optional(),
  addresses: z.array(
    z.object({
      roadAddress: z.string().optional(),
      jibunAddress: z.string().optional(),
      x: z.string(),
      y: z.string(),
    }),
  ),
});

const directionsResponseSchema = z.object({
  code: z.number(),
  message: z.string().optional(),
  route: z
    .object({
      traoptimal: z
        .array(
          z.object({
            summary: z.object({ distance: z.number(), duration: z.number() }),
            path: z.array(z.tuple([z.number(), z.number()])).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

const localSearchResponseSchema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      link: z.string().optional(),
      category: z.string().optional(),
      address: z.string().optional(),
      roadAddress: z.string().optional(),
      mapx: z.string(),
      mapy: z.string(),
    }),
  ),
});

const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
const toLngLat = (p: LatLng) => `${p.lng},${p.lat}`;

/** Naver 지도 어댑터 (국내): NCP Geocoding, Directions 5/15, Naver 검색 API(지역) */
export class NaverMapsProvider implements MapsProvider {
  readonly name = "naver" as const;

  constructor(private readonly config: NaverMapsConfig) {}

  private get ncpHeaders() {
    return {
      "x-ncp-apigw-api-key-id": this.config.mapsClientId,
      "x-ncp-apigw-api-key": this.config.mapsClientSecret,
      Accept: "application/json",
    };
  }

  async geocode(query: string, { language = "ko" } = {}): Promise<GeocodeResult[]> {
    // NCP Geocoding은 주소 검색이라 "경주"처럼 행정구역 접미사가 없으면 0건일 수 있어 "~시"로 한 번 더 시도한다.
    const candidates = /[시군구도]$/.test(query) ? [query] : [query, `${query}시`];
    for (const q of candidates) {
      const url = new URL(GEOCODE_URL);
      url.searchParams.set("query", q);
      url.searchParams.set("language", language === "ko" ? "kor" : "eng");
      const data = geocodeResponseSchema.parse(
        await fetchJson(url.toString(), { headers: this.ncpHeaders }, this.config.retry),
      );
      if (data.status !== "OK") {
        throw new Error(`Naver Geocoding ${data.status}: ${data.errorMessage ?? ""}`);
      }
      if (data.addresses.length > 0) {
        return data.addresses.map((a) => ({
          name: query,
          formattedAddress: a.roadAddress || a.jibunAddress || q,
          location: { lat: Number(a.y), lng: Number(a.x) },
          countryCode: "KR",
          provider: this.name,
        }));
      }
    }
    return [];
  }

  /**
   * Naver 검색 API(지역)는 좌표 편향 파라미터가 없고 최대 5건만 반환한다.
   * near/radiusM은 결과 후처리 거리 필터로만 사용하므로, query에 도시명을 포함해 호출해야 한다.
   */
  async searchPlaces(
    query: string,
    { near, radiusM = 30_000, limit = 5 }: SearchPlacesOptions = {},
  ): Promise<Place[]> {
    const url = new URL(LOCAL_SEARCH_URL);
    url.searchParams.set("query", query);
    url.searchParams.set("display", String(Math.min(limit, 5)));
    url.searchParams.set("sort", "random"); // random = 정확도순

    const data = localSearchResponseSchema.parse(
      await fetchJson(
        url.toString(),
        {
          headers: {
            "X-Naver-Client-Id": this.config.searchClientId,
            "X-Naver-Client-Secret": this.config.searchClientSecret,
          },
        },
        this.config.retry,
      ),
    );

    const places = data.items.map((item): Place => {
      // TODO(확인 필요): mapx/mapy는 2023-08 이후 WGS84 × 10^7 정수 문자열로 제공된다고 알고 있으나
      //   developers.naver.com 문서를 이번에 직접 열람하지 못했다. PoC 결과 좌표로 검증할 것.
      const location = { lat: Number(item.mapy) / 1e7, lng: Number(item.mapx) / 1e7 };
      return {
        id: `naver:${item.mapx},${item.mapy}`,
        name: stripTags(item.title),
        address: item.roadAddress || item.address,
        location,
        categories: item.category ? item.category.split(">").map((c) => c.trim()) : [],
        url: item.link || undefined,
        provider: this.name,
      };
    });

    return near ? places.filter((p) => haversineM(near, p.location) <= radiusM) : places;
  }

  /** 출발·도착 1쌍 단위로 Directions 5를 호출해 행렬을 만든다 (동시성 3). driving 외 모드는 미지원. */
  async travelTimeMatrix(
    origins: LatLng[],
    destinations: LatLng[],
    mode: TravelMode,
  ): Promise<TravelTimeMatrix> {
    if (mode !== "driving") return { supported: false, provider: this.name, reason: DRIVING_ONLY_REASON };

    const pairs = origins.flatMap((o, oi) => destinations.map((d, di) => ({ o, d, oi, di })));
    const cells: (MatrixCell | null)[][] = origins.map(() => destinations.map(() => null));

    const settled = await mapWithConcurrency(pairs, MATRIX_CONCURRENCY, async ({ o, d }) => {
      if (o.lat === d.lat && o.lng === d.lng) return { durationSec: 0, distanceM: 0 };
      const route = await this.drive(DIRECTIONS5_URL, [o, d], false);
      return route ? { durationSec: route.durationSec, distanceM: route.distanceM } : null;
    });

    settled.forEach((r, i) => {
      const { oi, di } = pairs[i];
      // 개별 쌍 실패는 null로 남기고(호출 측에서 성공률 집계), 전체를 실패시키지 않는다.
      cells[oi][di] = r.status === "fulfilled" ? r.value : null;
    });
    return { supported: true, provider: this.name, mode, cells };
  }

  async routeGeometry(points: LatLng[], mode: TravelMode): Promise<RouteGeometry> {
    if (mode !== "driving") return { supported: false, provider: this.name, reason: DRIVING_ONLY_REASON };
    if (points.length < 2) throw new Error("routeGeometry requires at least 2 points");
    if (points.length > MAX_ROUTE_POINTS) {
      return {
        supported: false,
        provider: this.name,
        reason: `Naver Directions 15는 경유지 15개(총 ${MAX_ROUTE_POINTS}개 지점)까지만 지원합니다.`,
      };
    }

    const route = await this.drive(DIRECTIONS15_URL, points, true);
    if (!route) throw new Error("Naver Directions: 경로를 찾지 못했습니다");
    return {
      supported: true,
      provider: this.name,
      mode,
      durationSec: route.durationSec,
      distanceM: route.distanceM,
      geometry: { type: "LineString", coordinates: route.path },
    };
  }

  private async drive(baseUrl: string, points: LatLng[], withPath: boolean) {
    const url = new URL(baseUrl);
    url.searchParams.set("start", toLngLat(points[0]));
    url.searchParams.set("goal", toLngLat(points[points.length - 1]));
    const waypoints = points.slice(1, -1);
    if (waypoints.length) url.searchParams.set("waypoints", waypoints.map(toLngLat).join("|"));
    url.searchParams.set("option", "traoptimal");

    const data = directionsResponseSchema.parse(
      await fetchJson(url.toString(), { headers: this.ncpHeaders }, this.config.retry),
    );
    // code 0: 성공, 1: 출발지=도착지, 그 외: 경로 탐색 실패
    if (data.code === 1) return { durationSec: 0, distanceM: 0, path: [] as [number, number][] };
    if (data.code !== 0) {
      throw new Error(`Naver Directions code ${data.code}: ${data.message ?? ""}`);
    }
    const best = data.route?.traoptimal?.[0];
    if (!best) return null;
    return {
      durationSec: Math.round(best.summary.duration / 1000), // ms → s
      distanceM: best.summary.distance,
      path: withPath ? (best.path ?? []) : [],
    };
  }
}

export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
