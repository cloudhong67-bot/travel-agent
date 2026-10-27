/**
 * 에이전트 평가 (PRD 8장 LLM 평가): 고정 도시 5곳을 실제 API로 실행해 품질·시간·비용을 표로 출력한다.
 *   실행: npm run eval              (5개 도시)
 *         npm run eval -- 교토 경주  (일부만)
 * DB 없이 메모리 저장소로 돈다. 결과: eval-output/<도시>.json, eval-output/summary.json
 * 주의: 실제 Gemini·Google Maps·Naver 호출 비용이 발생한다 (도시당 추정치는 표의 비용 열).
 */
import { config as loadDotenv } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPartialEnv } from "@/lib/env";
import { WikipediaKnowledge } from "@/server/adapters/knowledge/wikipedia";
import { GeminiProvider } from "@/server/adapters/llm/gemini";
import { GoogleMapsProvider } from "@/server/adapters/maps/google";
import { NaverMapsProvider } from "@/server/adapters/maps/naver";
import { GeminiGoogleSearch } from "@/server/adapters/search/geminiGoogleSearch";
import { MemoryAgentStore } from "@/server/agent/memoryStore";
import { runTripJob } from "@/server/agent/orchestrator";
import { estimateCost, USD_TO_KRW } from "@/server/agent/pricing";
import type { AgentDeps } from "@/server/agent/types";

loadDotenv({ path: [".env.local", ".env"], quiet: true });

const CITIES = [
  { city: "파리", countryCode: "FR" },
  { city: "교토", countryCode: "JP" },
  { city: "포르투", countryCode: "PT" },
  { city: "경주", countryCode: "KR" },
  { city: "이스탄불", countryCode: "TR" },
];
const TRIP = { days: 3, startDate: "2027-05-03", style: "역사,미식", transport: "transit" as const };

function buildDeps(store: MemoryAgentStore): AgentDeps {
  const env = getPartialEnv();
  const need = (k: keyof typeof env) => {
    const v = env[k];
    if (v === undefined || v === "") throw new Error(`.env.local에 ${k}가 필요합니다`);
    return String(v);
  };
  const model = env.GEMINI_MODEL ?? "gemini-3.8-flash";
  const google = new GoogleMapsProvider({ serverKey: need("GOOGLE_MAPS_SERVER_KEY") });
  const naver = new NaverMapsProvider({
    mapsClientId: need("NAVER_MAPS_CLIENT_ID"),
    mapsClientSecret: need("NAVER_MAPS_CLIENT_SECRET"),
    searchClientId: need("NAVER_SEARCH_CLIENT_ID"),
    searchClientSecret: need("NAVER_SEARCH_CLIENT_SECRET"),
  });
  return {
    store,
    llm: new GeminiProvider({ apiKey: need("GEMINI_API_KEY"), model }),
    search: new GeminiGoogleSearch({ apiKey: need("GEMINI_API_KEY"), model }),
    geocoder: google,
    mapsFor: (cc) => (cc === "KR" ? naver : google),
    wiki: new WikipediaKnowledge(),
  };
}

interface Row {
  city: string;
  status: string;
  seconds: number;
  sourceRatio: string;
  validation: string;
  pois: number;
  nearby: number;
  gemini: number;
  maps: number;
  tokens: string;
  costUsd: string;
  costKrw: string;
  note: string;
}

const pct = (n: number, d: number) => (d === 0 ? "-" : `${Math.round((n / d) * 100)}% (${n}/${d})`);

async function main() {
  const only = process.argv.slice(2);
  const targets = only.length ? CITIES.filter((c) => only.includes(c.city)) : CITIES;
  const outDir = path.resolve("eval-output");
  await mkdir(outDir, { recursive: true });

  const rows: Row[] = [];
  const costs: number[] = [];
  for (const target of targets) {
    const store = new MemoryAgentStore();
    const deps = buildDeps(store);
    const id = store.createTrip({ city: target.city, countryCode: target.countryCode, ...TRIP });
    console.log(`▶ ${target.city} ...`);
    const started = Date.now();
    let lastStep = "";
    const timer = setInterval(() => {
      const t = store.trips.get(id);
      const line = `${t?.step} ${t?.progress}% ${t?.stepMessage ?? ""}`;
      if (line !== lastStep) console.log(`   ${line}`);
      lastStep = line;
    }, 1000);
    await runTripJob(id, deps);
    clearInterval(timer);
    const seconds = Math.round((Date.now() - started) / 1000);

    const trip = store.trips.get(id)!;
    const meta = trip.meta;
    const days = await store.getDays(id);
    const city = trip.cityId ? await store.getCity(trip.cityId) : null;
    const stops = days.flatMap((d) => d.stops);
    const withSource = stops.filter((s) => s.sourceUrl).length;
    const passed = days.filter((d) => d.validation.passed).length;
    const cost = meta?.usage ? estimateCost(meta.usage) : null;
    if (cost) costs.push(cost.totalUsd);

    rows.push({
      city: target.city,
      status: trip.status + (meta?.partial ? "(부분)" : ""),
      seconds,
      sourceRatio: pct(withSource, stops.length),
      validation: pct(passed, days.length),
      pois: city?.pois.length ?? 0,
      nearby: (await store.getNearby(id)).length,
      gemini: meta?.usage?.geminiCalls ?? 0,
      maps: meta?.usage?.mapsCalls ?? 0,
      tokens: meta?.usage ? `${meta.usage.tokens.input}/${meta.usage.tokens.output + meta.usage.tokens.thought}` : "-",
      costUsd: cost ? `$${cost.totalUsd.toFixed(3)}` : "-",
      costKrw: cost ? `₩${cost.totalKrw}` : "-",
      note: (trip.errorMessage ?? meta?.warnings[0] ?? "").replace(/\s+/g, " ").slice(0, 70),
    });

    await writeFile(
      path.join(outDir, `${target.city}.json`),
      JSON.stringify(
        {
          trip,
          city,
          days,
          nearby: await store.getNearby(id),
          cost,
          progress: store.progressLog.map((p) => `${p.progress}% ${p.step}: ${p.message}`),
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  printTable(rows);
  const avg = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
  console.log(`\n도시 1건 평균 추정 비용: $${avg.toFixed(3)} (≈ ₩${Math.round(avg * USD_TO_KRW)}, 환율 ${USD_TO_KRW} 가정, Gemini 프로모션 단가·Naver 0원·검색 무료 한도 내)`);
  await writeFile(path.join(outDir, "summary.json"), JSON.stringify({ rows, avgCostUsd: avg }, null, 2), "utf8");
}

function printTable(rows: Row[]) {
  const header = ["도시", "상태", "초", "출처포함", "검증통과(일)", "POI", "근교", "Gemini", "지도", "토큰 in/out", "USD", "KRW", "메모"];
  const body = rows.map((r) => [r.city, r.status, String(r.seconds), r.sourceRatio, r.validation, String(r.pois), String(r.nearby), String(r.gemini), String(r.maps), r.tokens, r.costUsd, r.costKrw, r.note]);
  const width = (s: string) => [...s].reduce((w, ch) => w + (/[ᄀ-ￜ]/.test(ch) ? 2 : 1), 0);
  const cols = header.map((h, i) => Math.max(width(h), ...body.map((b) => width(b[i]))));
  const line = (cells: string[]) => "| " + cells.map((c, i) => c + " ".repeat(cols[i] - width(c))).join(" | ") + " |";
  console.log("\n" + line(header));
  console.log("|" + cols.map((w) => "-".repeat(w + 2)).join("|") + "|");
  for (const b of body) console.log(line(b));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
