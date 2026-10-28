/**
 * 에이전트 전체 흐름 테스트용 MSW 시나리오: 포르투(PT, Google) / 경주(KR, Naver).
 * Gemini 요청은 본문의 도구·스키마로 종류를 구분해 그럴듯한 응답을 만든다.
 */
import { http, HttpResponse } from "msw/http";
import { haversineM } from "@/server/adapters/maps/naver";

export interface ScenarioOptions {
  /** 첫 일자 배분에 목록에 없는 키(P99)를 섞는다 */
  hallucinateKey?: boolean;
  /** Gemini 응답 지연(ms). E2E에서 진행 화면을 관찰·캡처하기 위함 */
  geminiDelayMs?: number;
  /** 위키백과 문서가 없는 도시 (배경지식을 AI 일반 지식으로만 채우는 경우) */
  noWiki?: boolean;
  /**
   * 관광청 검색 결과: official(기본) 공식 사이트·추천 명소 충분 / thin 공식 사이트 없음 → 대체 출처 검색 /
   * fail 검색 실패 → 위키여행 요약으로 대체
   */
  tourism?: "official" | "thin" | "fail";
  /** Gemini 무료 등급 하루 할당량 소진: 모든 Gemini 요청이 429 RESOURCE_EXHAUSTED (세비야 실패 재현) */
  geminiQuotaExhausted?: boolean;
  /** 위키여행 문서가 영어(en)에만 있다 (관광 정보 대체 시 한국어 번역 확인용) */
  wikivoyageEnglishOnly?: boolean;
}

const QUOTA_EXHAUSTED = {
  error: {
    code: 429,
    message:
      "You exceeded your current quota, please check your plan and billing details.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20",
    status: "RESOURCE_EXHAUSTED",
    details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }],
  },
};

export interface ScenarioCounters {
  gemini: { history: number; search: number; candidates: number; selection: number; assignment: number; assignmentJson: number; translate: number; total: number };
  /** 마지막 일자 배분 요청의 프롬프트 (사용자 요청 반영 확인용) */
  lastAssignmentPrompt: string;
  wikivoyage: number;
  places: number;
  geocode: number;
  matrix: number;
  routes: number;
  naverDirections5: number;
  naverDirections15: number;
  naverLocal: number;
  wiki: number;
}

const newCounters = (): ScenarioCounters => ({
  gemini: { history: 0, search: 0, candidates: 0, selection: 0, assignment: 0, assignmentJson: 0, translate: 0, total: 0 },
  places: 0,
  geocode: 0,
  matrix: 0,
  routes: 0,
  naverDirections5: 0,
  naverDirections15: 0,
  naverLocal: 0,
  wiki: 0,
  lastAssignmentPrompt: "",
  wikivoyage: 0,
});

// ---- 데이터 ----

export const PORTO = { lat: 41.1496, lng: -8.611 };
export const GYEONGJU = { lat: 35.8562, lng: 129.2247 };

const portoPlaces = {
  sight: [
    { id: "g-bolsa", name: "볼사 궁전", lat: 41.1413, lng: -8.6155, rating: 4.6 },
    { id: "g-clerigos", name: "클레리구스 탑", lat: 41.1457, lng: -8.6146, rating: 4.7 },
    { id: "g-se", name: "포르투 대성당", lat: 41.1428, lng: -8.611, rating: 4.6 },
    { id: "g-ribeira", name: "히베이라 광장", lat: 41.1405, lng: -8.6133, rating: 4.7 },
    { id: "g-luis", name: "동 루이스 1세 다리", lat: 41.1399, lng: -8.6094, rating: 4.8 },
    { id: "g-lello", name: "렐루 서점", lat: 41.1469, lng: -8.6148, rating: 4.4 },
  ],
  museum: [
    // 월요일 휴무 → 2027-05-03(월)인 day 0에 배치되면 검증 실패
    { id: "g-serralves", name: "세하우베스 미술관", lat: 41.1597, lng: -8.6596, rating: 4.6, closedMonday: true },
    { id: "g-soares", name: "소아르스 도스 헤이스 국립미술관", lat: 41.1477, lng: -8.6213, rating: 4.5, closedMonday: true },
  ],
  food: [
    { id: "g-majestic", name: "마제스틱 카페", lat: 41.1468, lng: -8.6066, rating: 4.3 },
    { id: "g-bolhao", name: "볼량 시장", lat: 41.1497, lng: -8.6077, rating: 4.5 },
  ],
};

const weekdayHours = (closedMonday?: boolean) => [
  closedMonday ? "월요일: 휴무일" : "월요일: 오전 9:00~오후 6:00",
  "화요일: 오전 9:00~오후 6:00",
  "수요일: 오전 9:00~오후 6:00",
  "목요일: 오전 9:00~오후 6:00",
  "금요일: 오전 9:00~오후 6:00",
  "토요일: 오전 9:00~오후 6:00",
  "일요일: 오전 9:00~오후 6:00",
];

const toGooglePlace = (p: { id: string; name: string; lat: number; lng: number; rating: number; closedMonday?: boolean }) => ({
  id: p.id,
  displayName: { text: p.name },
  formattedAddress: `${p.name}, 포르투`,
  location: { latitude: p.lat, longitude: p.lng },
  types: ["tourist_attraction"],
  rating: p.rating,
  googleMapsUri: `https://maps.google.com/?cid=${p.id}`,
  regularOpeningHours: { weekdayDescriptions: weekdayHours(p.closedMonday) },
});

const geocodes: Record<string, { name: string; cc: string; lat: number; lng: number }> = {
  포르투: { name: "포르토", cc: "PT", ...PORTO },
  경주: { name: "경주시", cc: "KR", ...GYEONGJU },
  braga: { name: "브라가", cc: "PT", lat: 41.5454, lng: -8.4265 },
  guimarães: { name: "기마랑이스", cc: "PT", lat: 41.4425, lng: -8.2918 },
  aveiro: { name: "아베이루", cc: "PT", lat: 40.6405, lng: -8.6538 },
  lisboa: { name: "리스본", cc: "PT", lat: 38.7223, lng: -9.1393 }, // 150km 밖 → 제외
};

const gyeongjuPlaces = [
  { title: "<b>불국사</b>", mapx: "1293320000", mapy: "357900000", category: "관광,명소>사찰" },
  { title: "첨성대", mapx: "1292190000", mapy: "358350000", category: "관광,명소>유적지" },
  { title: "대릉원", mapx: "1292110000", mapy: "358380000", category: "관광,명소>유적지" },
  { title: "동궁과 월지", mapx: "1292270000", mapy: "358340000", category: "관광,명소>유적지" },
  { title: "황리단길", mapx: "1292100000", mapy: "358370000", category: "관광,명소>거리" },
];

// ---- Gemini 응답 ----

const geminiText = (text: string, extra: Record<string, unknown> = {}) =>
  HttpResponse.json({
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", ...extra }],
    usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300, thoughtsTokenCount: 200, totalTokenCount: 1700 },
    modelVersion: "gemini-3.8-flash",
  });

/** 프롬프트에서 요청 일자·POI 키·휴무를 읽어 배분을 만든다. 피드백이 있으면 휴무 요일을 피한다 */
function buildAssignment(prompt: string, opts: ScenarioOptions, isFirst: boolean) {
  const days = [...prompt.matchAll(/^- day (\d+)(?:: \S+ \((.)요일\))?/gm)].map((m) => ({ dayIndex: Number(m[1]), weekday: m[2] ?? null }));
  const pois = [...prompt.matchAll(/^(P\d+) \| (.+?) \| (\w+) \| .+? \| 휴무: (.+?)(?: \||$)/gm)].map((m) => ({
    key: m[1],
    closed: m[4] === "정보 없음" || m[4] === "없음" ? [] : m[4].split(","),
  }));
  const careful = prompt.includes("이전 배분의 문제점");
  // 첫 배분은 일부러 뒤에서부터 채워 월요일(day 0)에 월요일 휴무 미술관이 들어가게 한다 → 검증 실패 → 재시도
  const pool = careful ? [...pois] : [...pois].reverse();
  const result = days.map((d) => {
    const stops: { poiKey: string; stayMins: number }[] = [];
    for (let i = 0; i < pool.length && stops.length < 3; ) {
      const p = pool[i];
      if (careful && d.weekday && p.closed.includes(d.weekday)) {
        i++;
        continue;
      }
      stops.push({ poiKey: p.key, stayMins: 60 });
      pool.splice(i, 1);
    }
    return { dayIndex: d.dayIndex, title: `day ${d.dayIndex + 1} 테마`, dayTripTown: null, stops };
  });
  if (opts.hallucinateKey && isFirst && result[0]) result[0].stops.push({ poiKey: "P99", stayMins: 60 });
  return { days: result };
}

function promptText(body: { contents?: { parts?: { text?: string }[] }[] }) {
  return (body.contents ?? []).flatMap((c) => c.parts ?? []).map((p) => p.text ?? "").join("\n");
}

export function agentHandlers(opts: ScenarioOptions = {}) {
  const counters = newCounters();

  const handlers = [
    http.post("https://generativelanguage.googleapis.com/:version/models/:modelAction", async ({ request }) => {
      if (opts.geminiDelayMs) await new Promise((r) => setTimeout(r, opts.geminiDelayMs));
      const body = (await request.json()) as Record<string, unknown>;
      const raw = JSON.stringify(body);
      const prompt = promptText(body as never);
      counters.gemini.total++;
      if (opts.geminiQuotaExhausted) return HttpResponse.json(QUOTA_EXHAUSTED, { status: 429 });

      if (raw.includes('"googleSearch"')) {
        counters.gemini.search++;
        if (opts.tourism === "fail") return HttpResponse.json({ error: { code: 503, message: "UNAVAILABLE" } }, { status: 503 });
        const isAlternative = prompt.includes("공식 관광청 정보가 없거나 부족하다");
        if (opts.tourism === "thin") {
          return geminiText(
            isAlternative
              ? ["요약: 위키여행 기준 포르투는 강변 구시가지와 와인 저장고로 알려진 도시다.", "공식사이트: 정보 없음", "추천명소: Ribeira; Livraria Lello; Torre dos Clérigos", "축제: 정보 없음", "교통패스: 정보 없음"].join("\n")
              : ["요약: 짧은 소개.", "공식사이트: 정보 없음", "추천명소: Torre dos Clérigos", "축제: 정보 없음", "교통패스: 정보 없음"].join("\n"),
            {
              groundingMetadata: {
                webSearchQueries: [isAlternative ? "포르투 위키여행" : "포르투 관광청"],
                groundingChunks: [{ web: { uri: isAlternative ? "https://en.wikivoyage.org/wiki/Porto" : "https://someblog.example/porto", title: isAlternative ? "wikivoyage.org" : "someblog.example" } }],
                searchEntryPoint: { renderedContent: isAlternative ? "<div>alt</div>" : "<div>first</div>" },
              },
            },
          );
        }
        return geminiText(
          [
            "요약: 포르투는 도루강 하구의 항구 도시로 역사 지구가 유네스코 세계유산이다.",
            "공식사이트: https://www.visitporto.travel",
            "추천명소: Palácio da Bolsa; Torre dos Clérigos",
            "축제: 상 주앙 축제(6월)",
            "교통패스: Porto Card — 가격 정보 없음",
          ].join("\n"),
          {
            groundingMetadata: {
              webSearchQueries: ["포르투갈 공식 관광청 포르투"],
              groundingChunks: [
                { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/visitporto", title: "visitporto.travel" } },
                { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/blog", title: "someblog.example" } },
              ],
              searchEntryPoint: { renderedContent: "<div>search</div>" },
            },
          },
        );
      }
      if (raw.includes('"functionDeclarations"')) {
        counters.gemini.assignment++;
        counters.lastAssignmentPrompt = prompt;
        const args = buildAssignment(prompt, opts, counters.gemini.assignment === 1);
        return HttpResponse.json({
          candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "submitItinerary", args } }] }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 2500, candidatesTokenCount: 400, thoughtsTokenCount: 900, totalTokenCount: 3800 },
        });
      }
      if (raw.includes('"history"')) {
        counters.gemini.history++;
        // 원문에 없는 기후·매너는 일반 지식으로 채우고 aiFields로 표시한다 (history@v2)
        return geminiText(
          JSON.stringify({
            history: "포르투는 로마 시대부터 이어진 항구 도시다.",
            culture: "포트와인으로 유명하다.",
            bestTime: "여름은 건조하고 겨울은 비가 잦아 봄·초가을이 걷기 좋다.",
            etiquette: "성당 안에서는 조용히 하고 어깨를 가리는 옷을 입는다.",
            aiFields: ["bestTime", "etiquette"],
          }),
        );
      }
      if (raw.includes('"towns"')) {
        counters.gemini.candidates++;
        return geminiText(JSON.stringify({ towns: [{ name: "브라가", localName: "Braga" }, { name: "기마랑이스", localName: "Guimarães" }, { name: "아베이루", localName: "Aveiro" }, { name: "리스본", localName: "Lisboa" }] }));
      }
      if (raw.includes('"selected"')) {
        counters.gemini.selection++;
        const names = [...prompt.matchAll(/^- (.+?): 편도/gm)].map((m) => m[1]);
        return geminiText(JSON.stringify({ selected: [...names.map((n) => ({ name: n, reason: `${n}은 역사 도시다.` })), { name: "가짜도시", reason: "x" }] }));
      }
      if (prompt.includes("한국어로 옮겨 text에 담아라")) {
        counters.gemini.translate++;
        return geminiText(JSON.stringify({ text: "포르투(Porto)는 포르투갈 북부의 항구 도시로, 리베이라 지구와 와인 저장고가 볼거리다." }));
      }
      if (raw.includes('"days"')) {
        counters.gemini.assignmentJson++;
        return geminiText(JSON.stringify(buildAssignment(prompt, opts, false)));
      }
      return HttpResponse.json({ error: { code: 400, message: `unexpected gemini request: ${raw.slice(0, 200)}` } }, { status: 400 });
    }),

    http.get("https://vertexaisearch.cloud.google.com/grounding-api-redirect/:id", ({ params }) =>
      new HttpResponse(null, {
        status: 302,
        headers: { location: params.id === "visitporto" ? "https://www.visitporto.travel/pt-PT" : "https://someblog.example/porto" },
      }),
    ),

    // Google Geocoding
    http.get("https://maps.googleapis.com/maps/api/geocode/json", ({ request }) => {
      counters.geocode++;
      const address = new URL(request.url).searchParams.get("address") ?? "";
      const key = address.split(",")[0].trim().toLowerCase();
      const hit = geocodes[key] ?? geocodes[address.split(",")[0].trim()];
      if (!hit) return HttpResponse.json({ status: "ZERO_RESULTS", results: [] });
      return HttpResponse.json({
        status: "OK",
        results: [
          {
            formatted_address: hit.name,
            place_id: `pid-${key}`,
            address_components: [
              { long_name: hit.name, short_name: hit.name, types: ["locality"] },
              { long_name: hit.cc, short_name: hit.cc, types: ["country"] },
            ],
            geometry: { location: { lat: hit.lat, lng: hit.lng } },
          },
        ],
      });
    }),

    // Google Places Text Search
    http.post("https://places.googleapis.com/v1/places:searchText", async ({ request }) => {
      counters.places++;
      const { textQuery } = (await request.json()) as { textQuery: string };
      if (textQuery.includes("관광 명소")) return HttpResponse.json({ places: portoPlaces.sight.map(toGooglePlace) });
      if (textQuery.includes("박물관")) return HttpResponse.json({ places: portoPlaces.museum.map(toGooglePlace) });
      if (textQuery.includes("맛집")) return HttpResponse.json({ places: portoPlaces.food.map(toGooglePlace) });
      if (textQuery.includes("Bolsa")) {
        // 관광청 추천 명소(원어 이름): 검색 결과의 "볼사 궁전"과 같은 place id → 중복 제거 대상
        return HttpResponse.json({ places: [toGooglePlace({ ...portoPlaces.sight[0], name: "Palácio da Bolsa" })] });
      }
      if (textQuery.includes("Clérigos")) {
        // place id는 다르지만 같은 좌표(10m 이내) → 중복 제거 대상
        return HttpResponse.json({ places: [toGooglePlace({ ...portoPlaces.sight[1], id: "g-clerigos-alt", name: "Torre dos Clérigos", lat: 41.14575 })] });
      }
      return HttpResponse.json({ places: [] });
    }),

    // Google Routes: 직선거리 기반 이동시간
    http.post("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", async ({ request }) => {
      counters.matrix++;
      type W = { waypoint: { location: { latLng: { latitude: number; longitude: number } } } };
      const body = (await request.json()) as { origins: W[]; destinations: W[]; travelMode: string };
      const kmh = body.travelMode === "TRANSIT" ? 35 : body.travelMode === "WALK" ? 4.5 : 50;
      const pt = (w: W) => ({ lat: w.waypoint.location.latLng.latitude, lng: w.waypoint.location.latLng.longitude });
      const out = body.origins.flatMap((o, oi) =>
        body.destinations.map((d, di) => {
          const m = haversineM(pt(o), pt(d));
          return { originIndex: oi, destinationIndex: di, condition: "ROUTE_EXISTS", distanceMeters: Math.round(m), duration: `${Math.round((m / 1000 / kmh) * 3600) + 120}s` };
        }),
      );
      return HttpResponse.json(out);
    }),
    http.post("https://routes.googleapis.com/directions/v2:computeRoutes", async ({ request }) => {
      counters.routes++;
      type P = { location: { latLng: { latitude: number; longitude: number } } };
      const b = (await request.json()) as { origin: P; destination: P; intermediates?: P[] };
      const coords = [b.origin, ...(b.intermediates ?? []), b.destination].map((p) => [p.location.latLng.longitude, p.location.latLng.latitude]);
      return HttpResponse.json({ routes: [{ distanceMeters: 5000, duration: "1800s", polyline: { geoJsonLinestring: { type: "LineString", coordinates: coords } } }] });
    }),

    // Naver
    http.get("https://openapi.naver.com/v1/search/local.json", ({ request }) => {
      counters.naverLocal++;
      const q = new URL(request.url).searchParams.get("query") ?? "";
      const items = q.includes("관광 명소") ? gyeongjuPlaces : q.includes("맛집") ? [{ title: "교리김밥", mapx: "1292150000", mapy: "358320000", category: "음식점>김밥" }] : [];
      return HttpResponse.json({ items: items.map((i) => ({ ...i, link: "", address: "경북 경주시", roadAddress: "" })) });
    }),
    http.get("https://maps.apigw.ntruss.com/map-direction/v1/driving", ({ request }) => {
      counters.naverDirections5++;
      const sp = new URL(request.url).searchParams;
      const [slng, slat] = sp.get("start")!.split(",").map(Number);
      const [glng, glat] = sp.get("goal")!.split(",").map(Number);
      const m = haversineM({ lat: slat, lng: slng }, { lat: glat, lng: glng });
      return HttpResponse.json({ code: 0, route: { traoptimal: [{ summary: { distance: Math.round(m), duration: Math.round((m / 1000 / 40) * 3_600_000) + 60_000 } }] } });
    }),
    http.get("https://maps.apigw.ntruss.com/map-direction-15/v1/driving", ({ request }) => {
      counters.naverDirections15++;
      const sp = new URL(request.url).searchParams;
      const pts = [sp.get("start")!, ...(sp.get("waypoints")?.split("|") ?? []), sp.get("goal")!].map((s) => s.split(",").map(Number) as [number, number]);
      return HttpResponse.json({ code: 0, route: { traoptimal: [{ summary: { distance: 9000, duration: 1_800_000 }, path: pts }] } });
    }),

    // Wikipedia (기본 핸들러를 덮어써 호출 수를 센다)
    http.get("https://:lang.wikivoyage.org/api/rest_v1/page/summary/:title", ({ params }) => {
      counters.wikivoyage++;
      const serves = opts.tourism === "fail" || opts.geminiQuotaExhausted;
      if (opts.noWiki || !serves || (opts.wikivoyageEnglishOnly && params.lang !== "en")) return new HttpResponse(null, { status: 404 });
      const english = params.lang === "en";
      return HttpResponse.json({
        type: "standard",
        title: decodeURIComponent(String(params.title)),
        extract: english ? "Porto is a port city in northern Portugal, known for the Ribeira district and port wine cellars." : "포르투는 포르투갈 북부의 항구 도시로, 리베이라 지구와 와인 저장고가 볼거리다.",
        content_urls: { desktop: { page: `https://${params.lang}.wikivoyage.org/wiki/${params.title}` } },
      });
    }),

    http.get("https://:lang.wikipedia.org/api/rest_v1/page/summary/:title", ({ params }) => {
      counters.wiki++;
      if (opts.noWiki) return new HttpResponse(null, { status: 404 });
      return HttpResponse.json({
        type: "standard",
        title: decodeURIComponent(String(params.title)),
        extract: "도시 개요 원문.",
        content_urls: { desktop: { page: `https://${params.lang}.wikipedia.org/wiki/${params.title}` } },
      });
    }),
  ];

  return { handlers, counters };
}
