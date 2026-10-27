import { http, HttpResponse } from "msw/http";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { GoogleMapsProvider } from "./google";

const google = new GoogleMapsProvider({ serverKey: "test-key" });
const a = { lat: 41.14, lng: -8.61 };
const b = { lat: 41.15, lng: -8.62 };

describe("GoogleMapsProvider (MSW)", () => {
  it("searchPlaces: 필드 마스크·위치 편향을 보내고 응답을 정규화한다", async () => {
    let sent: { headers: Headers; body: Record<string, unknown> } | undefined;
    server.use(
      http.post("https://places.googleapis.com/v1/places:searchText", async ({ request }) => {
        sent = { headers: request.headers, body: (await request.json()) as Record<string, unknown> };
        return HttpResponse.json({
          places: [
            {
              id: "p1",
              displayName: { text: "볼사 궁전" },
              location: { latitude: 41.141, longitude: -8.615 },
              types: ["tourist_attraction"],
              rating: 4.6,
              regularOpeningHours: { weekdayDescriptions: ["월요일: 09:00~18:30"] },
            },
          ],
        });
      }),
    );

    const places = await google.searchPlaces("포르투 명소", { near: a, radiusM: 80_000, limit: 50 });
    expect(sent?.headers.get("x-goog-api-key")).toBe("test-key");
    expect(sent?.headers.get("x-goog-fieldmask")).toContain("places.regularOpeningHours.weekdayDescriptions");
    expect(sent?.body).toMatchObject({ pageSize: 20, locationBias: { circle: { radius: 50_000 } } });
    expect(places).toEqual([
      expect.objectContaining({ id: "p1", name: "볼사 궁전", location: { lat: 41.141, lng: -8.615 }, openingHours: ["월요일: 09:00~18:30"] }),
    ]);
  });

  it("travelTimeMatrix: proto3 기본값(인덱스 0) 생략·경로 없음·동일 지점 처리", async () => {
    server.use(
      http.post("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", () =>
        HttpResponse.json([
          { destinationIndex: 1, condition: "ROUTE_EXISTS", distanceMeters: 1500, duration: "420s" },
          { originIndex: 1, condition: "ROUTE_EXISTS", distanceMeters: 1600, duration: "480.5s" },
          { originIndex: 1, destinationIndex: 1, condition: "ROUTE_NOT_FOUND" },
        ]),
      ),
    );
    const m = await google.travelTimeMatrix([a, b], [a, b], "transit");
    expect(m).toEqual({
      supported: true,
      provider: "google",
      mode: "transit",
      cells: [
        [{ durationSec: 0, distanceM: 0 }, { durationSec: 420, distanceM: 1500 }],
        [{ durationSec: 481, distanceM: 1600 }, { durationSec: 0, distanceM: 0 }],
      ],
    });
  });

  it("travelTimeMatrix: TRANSIT 요소 상한(100)을 넘으면 출발지를 나눠 호출한다", async () => {
    let calls = 0;
    server.use(
      http.post("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", () => {
        calls++;
        return HttpResponse.json([]);
      }),
    );
    const points = Array.from({ length: 11 }, (_, i) => ({ lat: 41 + i / 100, lng: -8.6 }));
    await google.travelTimeMatrix(points, points, "transit"); // 121 요소 → 9행 + 2행
    expect(calls).toBe(2);
  });

  it("routeGeometry: 경유지 포함 GeoJSON, 경로 없으면 오류", async () => {
    server.use(
      http.post("https://routes.googleapis.com/directions/v2:computeRoutes", () =>
        HttpResponse.json({
          routes: [
            {
              distanceMeters: 2300,
              duration: "900s",
              polyline: { geoJsonLinestring: { type: "LineString", coordinates: [[-8.61, 41.14], [-8.62, 41.15]] } },
            },
          ],
        }),
      ),
    );
    const r = await google.routeGeometry([a, b, a], "walking");
    expect(r).toMatchObject({ supported: true, durationSec: 900, distanceM: 2300, geometry: { type: "LineString" } });

    server.use(http.post("https://routes.googleapis.com/directions/v2:computeRoutes", () => HttpResponse.json({})));
    await expect(google.routeGeometry([a, b], "driving")).rejects.toThrow(/no route/);
    await expect(google.routeGeometry([a], "driving")).rejects.toThrow(/at least 2/);
  });

  it("geocode: ZERO_RESULTS는 빈 배열", async () => {
    server.use(
      http.get("https://maps.googleapis.com/maps/api/geocode/json", () => HttpResponse.json({ status: "ZERO_RESULTS", results: [] })),
    );
    expect(await google.geocode("없는도시")).toEqual([]);
  });
});
