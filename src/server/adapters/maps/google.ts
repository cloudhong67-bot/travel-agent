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

export interface GoogleMapsConfig {
  serverKey: string;
  retry?: RetryOptions;
}

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const ROUTE_MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const COMPUTE_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

const TRAVEL_MODES: Record<TravelMode, string> = {
  driving: "DRIVE",
  walking: "WALK",
  transit: "TRANSIT",
  bicycling: "BICYCLE",
};

/** Routes API 행렬 요소 상한: TRANSIT 100, 그 외 625 */
const MATRIX_ELEMENT_LIMIT: Record<TravelMode, number> = {
  driving: 625,
  walking: 625,
  bicycling: 625,
  transit: 100,
};

// ---- 응답 스키마 (필요한 필드만 검증) ----

const geocodeResponseSchema = z.object({
  status: z.string(),
  error_message: z.string().optional(),
  results: z.array(
    z.object({
      formatted_address: z.string(),
      place_id: z.string().optional(),
      address_components: z.array(
        z.object({ long_name: z.string(), short_name: z.string(), types: z.array(z.string()) }),
      ),
      geometry: z.object({ location: z.object({ lat: z.number(), lng: z.number() }) }),
    }),
  ),
});

const placesResponseSchema = z.object({
  places: z
    .array(
      z.object({
        id: z.string(),
        displayName: z.object({ text: z.string() }).optional(),
        formattedAddress: z.string().optional(),
        location: z.object({ latitude: z.number(), longitude: z.number() }),
        types: z.array(z.string()).optional(),
        rating: z.number().optional(),
        googleMapsUri: z.string().optional(),
        regularOpeningHours: z
          .object({ weekdayDescriptions: z.array(z.string()).optional() })
          .optional(),
      }),
    )
    .optional(),
});

const durationSchema = z.string().regex(/^\d+(\.\d+)?s$/);
const toSeconds = (d: string) => Math.round(Number.parseFloat(d));

const matrixResponseSchema = z.array(
  z.object({
    originIndex: z.number().int().optional(),
    destinationIndex: z.number().int().optional(),
    condition: z.string().optional(),
    distanceMeters: z.number().optional(),
    duration: durationSchema.optional(),
  }),
);

const routesResponseSchema = z.object({
  routes: z
    .array(
      z.object({
        distanceMeters: z.number().optional(),
        duration: durationSchema.optional(),
        polyline: z.object({
          geoJsonLinestring: z.object({
            type: z.literal("LineString"),
            coordinates: z.array(z.tuple([z.number(), z.number()])),
          }),
        }),
      }),
    )
    .optional(),
});

const toWaypoint = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });

/** Google Maps Platform 어댑터 (해외): Geocoding API, Places API (New), Routes API */
export class GoogleMapsProvider implements MapsProvider {
  readonly name = "google" as const;

  constructor(private readonly config: GoogleMapsConfig) {}

  private postJson(url: string, body: unknown, fieldMask: string): Promise<unknown> {
    return fetchJson(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.config.serverKey,
          "X-Goog-FieldMask": fieldMask,
        },
        body: JSON.stringify(body),
      },
      this.config.retry,
    );
  }

  async geocode(query: string, { language = "ko" } = {}): Promise<GeocodeResult[]> {
    const url = new URL(GEOCODE_URL);
    url.searchParams.set("address", query);
    url.searchParams.set("language", language);
    url.searchParams.set("key", this.config.serverKey);

    const data = geocodeResponseSchema.parse(await fetchJson(url.toString(), {}, this.config.retry));
    if (data.status === "ZERO_RESULTS") return [];
    if (data.status !== "OK") {
      throw new Error(`Google Geocoding ${data.status}: ${data.error_message ?? ""}`);
    }
    return data.results.map((r) => {
      const country = r.address_components.find((c) => c.types.includes("country"));
      const locality =
        r.address_components.find((c) => c.types.includes("locality")) ??
        r.address_components.find((c) => c.types.includes("administrative_area_level_1"));
      return {
        name: locality?.long_name ?? query,
        formattedAddress: r.formatted_address,
        location: r.geometry.location,
        countryCode: country?.short_name,
        placeId: r.place_id,
        provider: this.name,
      };
    });
  }

  async searchPlaces(
    query: string,
    { near, radiusM = 10_000, limit = 10, language = "ko" }: SearchPlacesOptions = {},
  ): Promise<Place[]> {
    const body: Record<string, unknown> = {
      textQuery: query,
      languageCode: language,
      pageSize: Math.min(limit, 20),
    };
    if (near) {
      body.locationBias = {
        circle: { center: { latitude: near.lat, longitude: near.lng }, radius: Math.min(radiusM, 50_000) },
      };
    }
    const fieldMask = [
      "places.id",
      "places.displayName",
      "places.formattedAddress",
      "places.location",
      "places.types",
      "places.rating",
      "places.googleMapsUri",
      "places.regularOpeningHours.weekdayDescriptions",
    ].join(",");

    const data = placesResponseSchema.parse(await this.postJson(PLACES_TEXT_SEARCH_URL, body, fieldMask));
    return (data.places ?? []).map((p) => ({
      id: p.id,
      name: p.displayName?.text ?? p.id,
      address: p.formattedAddress,
      location: { lat: p.location.latitude, lng: p.location.longitude },
      categories: p.types ?? [],
      rating: p.rating,
      openingHours: p.regularOpeningHours?.weekdayDescriptions,
      url: p.googleMapsUri,
      provider: this.name,
    }));
  }

  async travelTimeMatrix(
    origins: LatLng[],
    destinations: LatLng[],
    mode: TravelMode,
  ): Promise<TravelTimeMatrix> {
    const cells: (MatrixCell | null)[][] = origins.map(() => destinations.map(() => null));
    if (origins.length === 0 || destinations.length === 0) {
      return { supported: true, provider: this.name, mode, cells };
    }

    // 요소 상한을 넘으면 출발지 기준으로 나눠 호출
    const rowsPerChunk = Math.max(1, Math.floor(MATRIX_ELEMENT_LIMIT[mode] / destinations.length));
    const chunks: number[] = [];
    for (let start = 0; start < origins.length; start += rowsPerChunk) chunks.push(start);

    const settled = await mapWithConcurrency(chunks, 3, async (start) => {
      const chunk = origins.slice(start, start + rowsPerChunk);
      const body: Record<string, unknown> = {
        origins: chunk.map((o) => ({ waypoint: toWaypoint(o) })),
        destinations: destinations.map((d) => ({ waypoint: toWaypoint(d) })),
        travelMode: TRAVEL_MODES[mode],
      };
      if (mode === "driving") body.routingPreference = "TRAFFIC_UNAWARE";
      const raw = await this.postJson(
        ROUTE_MATRIX_URL,
        body,
        "originIndex,destinationIndex,condition,distanceMeters,duration",
      );
      return { start, elements: matrixResponseSchema.parse(raw) };
    });

    for (const result of settled) {
      if (result.status === "rejected") throw result.reason;
      const { start, elements } = result.value;
      for (const el of elements) {
        if (el.condition !== "ROUTE_EXISTS" || el.duration === undefined) continue;
        // proto3 JSON은 0 값을 생략하므로 인덱스 기본값 0
        const o = start + (el.originIndex ?? 0);
        const d = el.destinationIndex ?? 0;
        cells[o][d] = { durationSec: toSeconds(el.duration), distanceM: el.distanceMeters ?? 0 };
      }
    }
    // TRANSIT은 동일 지점 쌍에 경로를 주지 않으므로 0으로 채운다.
    origins.forEach((o, oi) =>
      destinations.forEach((d, di) => {
        if (o.lat === d.lat && o.lng === d.lng) cells[oi][di] = { durationSec: 0, distanceM: 0 };
      }),
    );
    return { supported: true, provider: this.name, mode, cells };
  }

  async routeGeometry(points: LatLng[], mode: TravelMode): Promise<RouteGeometry> {
    if (points.length < 2) throw new Error("routeGeometry requires at least 2 points");

    // TRANSIT은 경유지(intermediates)를 지원하지 않으므로 구간별로 계산해 이어 붙인다.
    if (mode === "transit" && points.length > 2) {
      const segments = points.slice(1).map((p, i) => [points[i], p]);
      const settled = await mapWithConcurrency(segments, 3, (seg) => this.computeRoute(seg, mode));
      const coordinates: [number, number][] = [];
      let durationSec = 0;
      let distanceM = 0;
      for (const r of settled) {
        if (r.status === "rejected") throw r.reason;
        durationSec += r.value.durationSec;
        distanceM += r.value.distanceM;
        coordinates.push(...r.value.coordinates);
      }
      return {
        supported: true,
        provider: this.name,
        mode,
        durationSec,
        distanceM,
        geometry: { type: "LineString", coordinates },
      };
    }

    const r = await this.computeRoute(points, mode);
    return {
      supported: true,
      provider: this.name,
      mode,
      durationSec: r.durationSec,
      distanceM: r.distanceM,
      geometry: { type: "LineString", coordinates: r.coordinates },
    };
  }

  private async computeRoute(points: LatLng[], mode: TravelMode) {
    const body: Record<string, unknown> = {
      origin: toWaypoint(points[0]),
      destination: toWaypoint(points[points.length - 1]),
      intermediates: points.slice(1, -1).map(toWaypoint),
      travelMode: TRAVEL_MODES[mode],
      polylineEncoding: "GEO_JSON_LINESTRING",
    };
    if (mode === "driving") body.routingPreference = "TRAFFIC_UNAWARE";

    const data = routesResponseSchema.parse(
      await this.postJson(
        COMPUTE_ROUTES_URL,
        body,
        "routes.duration,routes.distanceMeters,routes.polyline.geoJsonLinestring",
      ),
    );
    const route = data.routes?.[0];
    if (!route) throw new Error(`Google Routes: no route found (${mode})`);
    return {
      durationSec: route.duration ? toSeconds(route.duration) : 0,
      distanceM: route.distanceMeters ?? 0,
      coordinates: route.polyline.geoJsonLinestring.coordinates,
    };
  }
}
