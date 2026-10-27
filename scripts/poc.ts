/**
 * 1단계 PoC: 3개 도시로 모든 외부 어댑터를 실제 호출해 품질을 확인한다.
 *   실행: npm run poc            (전체)
 *         npm run poc -- 교토     (특정 도시만)
 * 결과: poc-output/<도시>.json + 콘솔 표(호출별 성공 여부·소요시간·응답 크기)
 */
import { config as loadDotenv } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPartialEnv, type PartialEnv } from "@/lib/env";
import { WikipediaKnowledge } from "@/server/adapters/knowledge/wikipedia";
import { GeminiProvider } from "@/server/adapters/llm/gemini";
import { functionResponsesMessage, type LlmMessage, type LlmUsage } from "@/server/adapters/llm/types";
import { GoogleMapsProvider } from "@/server/adapters/maps/google";
import { NaverMapsProvider } from "@/server/adapters/maps/naver";
import type { LatLng, MapsProvider, Place } from "@/server/adapters/maps/types";
import { GeminiGoogleSearch } from "@/server/adapters/search/geminiGoogleSearch";

loadDotenv({ path: [".env.local", ".env"], quiet: true });

interface CitySpec {
  name: string;
  englishName: string;
  /** 지오코딩 실패 시에도 후속 호출을 검증하기 위한 대략 중심 좌표 */
  fallbackCenter: LatLng;
  fallbackCountry: string;
}

const CITIES: CitySpec[] = [
  { name: "포르투", englishName: "Porto", fallbackCenter: { lat: 41.1496, lng: -8.611 }, fallbackCountry: "PT" },
  { name: "교토", englishName: "Kyoto", fallbackCenter: { lat: 35.0116, lng: 135.7681 }, fallbackCountry: "JP" },
  { name: "경주", englishName: "Gyeongju", fallbackCenter: { lat: 35.8562, lng: 129.2247 }, fallbackCountry: "KR" },
];

type Status = "OK" | "FAIL" | "SKIP";
interface CallRecord {
  status: Status;
  ms: number;
  bytes: number;
  note?: string;
  error?: string;
  data?: unknown;
}
interface Row extends Omit<CallRecord, "data"> {
  city: string;
  call: string;
}

const rows: Row[] = [];

async function record<T>(
  city: string,
  call: string,
  out: Record<string, CallRecord>,
  fn: (() => Promise<T>) | string,
  note?: (data: T) => string,
): Promise<T | undefined> {
  if (typeof fn === "string") {
    const rec: CallRecord = { status: "SKIP", ms: 0, bytes: 0, note: fn };
    out[call] = rec;
    rows.push({ city, call, ...rec });
    return undefined;
  }
  const started = performance.now();
  try {
    const data = await fn();
    const ms = Math.round(performance.now() - started);
    const bytes = Buffer.byteLength(JSON.stringify(data) ?? "");
    const rec: CallRecord = { status: "OK", ms, bytes, note: note?.(data), data };
    out[call] = rec;
    rows.push({ city, call, status: "OK", ms, bytes, note: rec.note });
    return data;
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    const message = error instanceof Error ? error.message : String(error);
    out[call] = { status: "FAIL", ms, bytes: 0, error: message };
    rows.push({ city, call, status: "FAIL", ms, bytes: 0, error: message });
    return undefined;
  }
}

function missing(env: PartialEnv, keys: (keyof PartialEnv)[]): string | undefined {
  const absent = keys.filter((k) => env[k] === undefined);
  return absent.length ? `env 미설정: ${absent.join(", ")}` : undefined;
}

function buildAdapters(env: PartialEnv) {
  const google = env.GOOGLE_MAPS_SERVER_KEY
    ? new GoogleMapsProvider({ serverKey: env.GOOGLE_MAPS_SERVER_KEY })
    : missing(env, ["GOOGLE_MAPS_SERVER_KEY"])!;
  const naver =
    env.NAVER_MAPS_CLIENT_ID && env.NAVER_MAPS_CLIENT_SECRET && env.NAVER_SEARCH_CLIENT_ID && env.NAVER_SEARCH_CLIENT_SECRET
      ? new NaverMapsProvider({
          mapsClientId: env.NAVER_MAPS_CLIENT_ID,
          mapsClientSecret: env.NAVER_MAPS_CLIENT_SECRET,
          searchClientId: env.NAVER_SEARCH_CLIENT_ID,
          searchClientSecret: env.NAVER_SEARCH_CLIENT_SECRET,
        })
      : missing(env, [
          "NAVER_MAPS_CLIENT_ID",
          "NAVER_MAPS_CLIENT_SECRET",
          "NAVER_SEARCH_CLIENT_ID",
          "NAVER_SEARCH_CLIENT_SECRET",
        ])!;
  const model = env.GEMINI_MODEL ?? "gemini-3.8-flash";
  const gemini = env.GEMINI_API_KEY
    ? new GeminiProvider({ apiKey: env.GEMINI_API_KEY, model })
    : missing(env, ["GEMINI_API_KEY"])!;
  const search = env.GEMINI_API_KEY
    ? new GeminiGoogleSearch({ apiKey: env.GEMINI_API_KEY, model })
    : missing(env, ["GEMINI_API_KEY"])!;
  return { google, naver, gemini, search, wiki: new WikipediaKnowledge() };
}

type Adapters = ReturnType<typeof buildAdapters>;
const usable = <T>(a: T | string): a is T => typeof a !== "string";
const skipReason = (a: unknown) => (typeof a === "string" ? a : "");

async function runCity(spec: CitySpec, adapters: Adapters) {
  const calls: Record<string, CallRecord> = {};
  const { google, naver, gemini, search, wiki } = adapters;
  const c = spec.name;

  // 1) 도시 식별: PRD 7장대로 Google Geocoding으로 국가코드 확정
  const geo = await record(
    c,
    "google.geocode",
    calls,
    usable(google) ? () => google.geocode(spec.name) : skipReason(google),
    (r) => (r[0] ? `${r[0].formattedAddress} [${r[0].countryCode}] (${r.length}건)` : "0건"),
  );
  const center = geo?.[0]?.location ?? spec.fallbackCenter;
  const countryCode = geo?.[0]?.countryCode ?? spec.fallbackCountry;
  const isKr = countryCode === "KR";

  if (isKr) {
    await record(
      c,
      "naver.geocode",
      calls,
      usable(naver) ? () => naver.geocode(spec.name) : skipReason(naver),
      (r) => (r[0] ? `${r[0].formattedAddress} (${r[0].location.lat.toFixed(4)},${r[0].location.lng.toFixed(4)})` : "0건"),
    );
  }

  // 2) 지도 공급자 분기 (getMapsProvider와 동일 규칙, PoC는 부분 env라 직접 선택)
  const maps: MapsProvider | string = isKr ? naver : google;
  const mapsName = isKr ? "naver" : "google";

  const places = await record(
    c,
    `${mapsName}.searchPlaces`,
    calls,
    usable(maps)
      ? () => maps.searchPlaces(`${spec.name} 관광 명소`, { near: center, radiusM: 20_000, limit: 8 })
      : skipReason(maps),
    (r) => `${r.length}건: ${r.slice(0, 4).map((p) => p.name).join(", ")}`,
  );

  const stops: LatLng[] =
    places && places.length >= 2 ? places.slice(0, 4).map((p) => p.location) : [center, offset(center, 0.01)];

  for (const mode of ["driving", "transit"] as const) {
    await record(
      c,
      `${mapsName}.travelTimeMatrix(${mode})`,
      calls,
      usable(maps) ? () => maps.travelTimeMatrix(stops, stops, mode) : skipReason(maps),
      (m) => {
        if (!m.supported) return `미지원: ${m.reason}`;
        const flat = m.cells.flat();
        const ok = flat.filter(Boolean).length;
        const maxMin = Math.max(...flat.map((x) => (x ? x.durationSec / 60 : 0)));
        return `${m.cells.length}x${m.cells[0]?.length ?? 0}, 성공 ${ok}/${flat.length}, 최대 ${maxMin.toFixed(0)}분`;
      },
    );
  }

  await record(
    c,
    `${mapsName}.routeGeometry(driving)`,
    calls,
    usable(maps) ? () => maps.routeGeometry(stops, "driving") : skipReason(maps),
    (r) =>
      r.supported
        ? `${(r.distanceM / 1000).toFixed(1)}km, ${(r.durationSec / 60).toFixed(0)}분, 좌표 ${r.geometry.coordinates.length}개`
        : `미지원: ${r.reason}`,
  );

  // 3) 역사·배경
  await record(
    c,
    "wikipedia.getCityKnowledge",
    calls,
    () => wiki.getCityKnowledge(spec.name, spec.englishName),
    (k) =>
      [
        `wp=${k.wikipedia ? `${k.wikipedia.lang}:${k.wikipedia.title}(${k.wikipedia.extract.length}자)` : "없음"}`,
        `wv=${k.wikivoyage ? `${k.wikivoyage.lang}:${k.wikivoyage.title}(${k.wikivoyage.extract.length}자)` : "없음"}`,
      ].join(" "),
  );

  // 4) 관광청 웹 검색 (Gemini Google 검색 그라운딩)
  await record(
    c,
    "gemini.googleSearch",
    calls,
    usable(search)
      ? () =>
          search.search(
            `${spec.name}(${spec.englishName})의 공식 관광청(국가·도시) 웹사이트 URL과, 그 사이트가 추천하는 주요 명소·축제·교통패스를 알려줘.`,
            { countryCode },
          )
      : skipReason(search),
    (r) =>
      `요약 ${r.summary.length}자, 검색어 ${r.searchQueries?.length ?? 0}개, 출처 ${r.sources.length}개: ${r.sources
        .slice(0, 3)
        .map((s) => hostOf(s.url))
        .join(", ")}, 토큰 ${r.usage.totalTokens}`,
  );

  // 5) Gemini 함수 호출 왕복 (low로 도구 선택 → 결과 전달 → medium으로 일자 배분 초안)
  await record(
    c,
    "gemini.functionCalling",
    calls,
    usable(gemini) ? () => geminiRoundTrip(gemini, spec, places ?? []) : skipReason(gemini),
    (r) =>
      `호출=${r.calledTools.join(",") || "없음"}, 토큰 in/out/think=${r.usage.inputTokens}/${r.usage.outputTokens}/${r.usage.thoughtTokens}, 답변 ${r.finalText.length}자`,
  );

  return calls;
}

async function geminiRoundTrip(gemini: GeminiProvider, spec: CitySpec, places: Place[]) {
  const tools = [
    {
      name: "searchPOI",
      description: "도시의 관광 명소 후보를 좌표와 함께 조회한다.",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "도시 이름" },
          category: { type: "string", enum: ["sight", "museum", "food"] },
        },
        required: ["city"],
      },
    },
  ];
  const messages: LlmMessage[] = [
    { role: "user", parts: [{ kind: "text", text: `${spec.name} 1일 여행 동선을 짜기 위해 먼저 명소 후보를 조회해줘.` }] },
  ];

  const first = await gemini.generate({
    systemInstruction: "너는 여행 일정 에이전트다. 사실 정보는 반드시 도구로 조회한다.",
    messages,
    tools,
    thinkingLevel: "low",
  });
  const usage: LlmUsage = { ...first.usage };
  if (first.functionCalls.length === 0) {
    return { calledTools: [] as string[], finalText: first.text, usage };
  }

  messages.push(first.modelMessage);
  messages.push(
    functionResponsesMessage(
      first.functionCalls.map((call) => ({
        call,
        response: {
          places: places.slice(0, 6).map((p) => ({ name: p.name, lat: p.location.lat, lng: p.location.lng })),
        },
      })),
    ),
  );

  const second = await gemini.generate({ messages, tools, thinkingLevel: "medium" });
  for (const k of Object.keys(usage) as (keyof LlmUsage)[]) usage[k] += second.usage[k];
  return {
    calledTools: first.functionCalls.map((f) => `${f.name}(${JSON.stringify(f.args)})`),
    finalText: second.text,
    usage,
  };
}

const offset = (p: LatLng, d: number): LatLng => ({ lat: p.lat + d, lng: p.lng + d });
const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

function printTable() {
  const header = ["도시", "호출", "결과", "ms", "bytes", "메모"];
  const body = rows.map((r) => [
    r.city,
    r.call,
    r.status,
    String(r.ms),
    String(r.bytes),
    (r.note ?? r.error ?? "").replace(/\s+/g, " ").slice(0, 110),
  ]);
  const width = (s: string) => [...s].reduce((w, ch) => w + (/[ᄀ-ￜ]/.test(ch) ? 2 : 1), 0);
  const cols = header.map((h, i) => Math.max(width(h), ...body.map((b) => width(b[i]))));
  const line = (cells: string[]) =>
    "| " + cells.map((cell, i) => cell + " ".repeat(cols[i] - width(cell))).join(" | ") + " |";
  console.log(line(header));
  console.log("|" + cols.map((w) => "-".repeat(w + 2)).join("|") + "|");
  for (const b of body) console.log(line(b));

  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  console.log(`\n합계: OK ${count("OK")} / FAIL ${count("FAIL")} / SKIP ${count("SKIP")}`);
}

async function main() {
  const env = getPartialEnv();
  const adapters = buildAdapters(env);
  const only = process.argv.slice(2);
  const targets = only.length ? CITIES.filter((c) => only.includes(c.name)) : CITIES;

  const outDir = path.resolve("poc-output");
  await mkdir(outDir, { recursive: true });

  for (const spec of targets) {
    console.log(`▶ ${spec.name} ...`);
    const calls = await runCity(spec, adapters);
    await writeFile(
      path.join(outDir, `${spec.name}.json`),
      JSON.stringify({ city: spec.name, generatedAt: new Date().toISOString(), calls }, null, 2),
      "utf8",
    );
  }
  console.log();
  printTable();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
