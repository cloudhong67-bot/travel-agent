/**
 * 외부 API 목(mock) 기본 핸들러. 테스트에서 server.use(...)로 개별 응답을 덮어쓴다.
 * 실제 외부 호출이 새지 않도록 unit 프로젝트는 onUnhandledFrame: "error"로 돈다 (MSW 3).
 */
import { http, HttpResponse } from "msw/http";

export const fixtures = {
  portoGeocode: {
    status: "OK",
    results: [
      {
        formatted_address: "포르투갈 포르토",
        place_id: "ChIJwVPhxKtlJA0RvBSxQFbZSKY",
        address_components: [
          { long_name: "포르토", short_name: "포르토", types: ["locality", "political"] },
          { long_name: "포르투갈", short_name: "PT", types: ["country", "political"] },
        ],
        geometry: { location: { lat: 41.1579438, lng: -8.629105299999999 } },
      },
    ],
  },
  portoWikiSummary: {
    type: "standard",
    title: "포르투",
    description: "포르투갈의 도시",
    extract: "포르투는 포르투갈 북부의 항구 도시이다.",
    content_urls: { desktop: { page: "https://ko.wikipedia.org/wiki/%ED%8F%AC%EB%A5%B4%ED%88%AC" } },
  },
};

export const handlers = [
  // Google Geocoding
  http.get("https://maps.googleapis.com/maps/api/geocode/json", () => HttpResponse.json(fixtures.portoGeocode)),
  // Google Places (New) / Routes
  http.post("https://places.googleapis.com/v1/places:searchText", () => HttpResponse.json({ places: [] })),
  http.post("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", () => HttpResponse.json([])),
  http.post("https://routes.googleapis.com/directions/v2:computeRoutes", () => HttpResponse.json({ routes: [] })),
  // Naver Maps / 검색
  http.get("https://maps.apigw.ntruss.com/map-geocode/v2/geocode", () =>
    HttpResponse.json({ status: "OK", addresses: [] }),
  ),
  http.get("https://maps.apigw.ntruss.com/map-direction/v1/driving", () => HttpResponse.json({ code: 1 })),
  http.get("https://maps.apigw.ntruss.com/map-direction-15/v1/driving", () => HttpResponse.json({ code: 1 })),
  http.get("https://openapi.naver.com/v1/search/local.json", () => HttpResponse.json({ items: [] })),
  // Wikipedia / Wikivoyage
  http.get("https://:lang.wikipedia.org/api/rest_v1/page/summary/:title", () =>
    HttpResponse.json(fixtures.portoWikiSummary),
  ),
  http.get("https://:lang.wikivoyage.org/api/rest_v1/page/summary/:title", () => new HttpResponse(null, { status: 404 })),
  http.get("https://ko.wikipedia.org/w/api.php", () =>
    HttpResponse.json({ query: { pages: [{ title: "포르투", langlinks: [{ lang: "en", title: "Porto" }] }] } }),
  ),
  // Gemini (generateContent)
  http.post("https://generativelanguage.googleapis.com/:version/models/:modelAction", () =>
    HttpResponse.json({
      candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 },
    }),
  ),
];
