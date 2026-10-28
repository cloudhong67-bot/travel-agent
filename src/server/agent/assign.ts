/**
 * PRD 7장 4단계 "일자 배분 (LLM)". Gemini(thinking medium)가 submitItinerary 함수 호출로 배분을 제출하고,
 * 코드가 Zod 스키마와 "주어진 POI 키만 사용" 규칙으로 다시 검증한다.
 */
import type { LlmProvider } from "@/server/adapters/llm/types";
import { parseJsonOutput } from "./collect";
import { closedWeekdays, WEEKDAY_KO } from "@/lib/hours";
import { dayDate } from "./poiUtils";
import {
  ASSIGNMENT_SYSTEM,
  ASSIGNMENT_TOOL_NAME,
  AssignmentSchema,
  assignmentResponseSchema,
  assignmentTool,
  assignmentUserPrompt,
  type Assignment,
} from "./prompts/assignment";
import type { AgentPoi, NearbyTown, PoiCategory, TripInput } from "./types";

export interface DayAssignment {
  dayIndex: number;
  title: string;
  dayTripTown: string | null;
  stops: { poi: AgentPoi; stayMins: number }[];
}

export interface AssignResult {
  days: Map<number, DayAssignment>;
  warnings: string[];
}

const closedLabel = (hours: string[] | null) => {
  const closed = closedWeekdays(hours);
  if (closed === null) return null;
  return closed.size ? [...closed].map((d) => WEEKDAY_KO[d]).join(",") : "없음";
};

async function requestAssignment(llm: LlmProvider, prompt: string): Promise<Assignment> {
  const res = await llm.generate({
    systemInstruction: ASSIGNMENT_SYSTEM,
    messages: [{ role: "user", parts: [{ kind: "text", text: prompt }] }],
    tools: [assignmentTool],
    thinkingLevel: "medium",
    temperature: 0.4,
  });
  const call = res.functionCalls.find((c) => c.name === ASSIGNMENT_TOOL_NAME);
  if (call) return AssignmentSchema.parse(call.args);

  // 모델이 함수를 부르지 않고 글로 답한 경우: 구조화 출력(JSON 스키마 강제)으로 한 번 더 요청
  const retry = await llm.generate({
    systemInstruction: ASSIGNMENT_SYSTEM.replace(/결과는 반드시[^\n]*$/m, "결과는 JSON으로만 답한다."),
    messages: [{ role: "user", parts: [{ kind: "text", text: prompt }] }],
    thinkingLevel: "medium",
    responseJsonSchema: assignmentResponseSchema,
    temperature: 0.4,
  });
  return parseJsonOutput(retry.text, AssignmentSchema);
}

/**
 * @param dayIndexes 배분할 일자 (최초 생성은 전체, 재시도·재생성은 일부)
 * @param pois 이 일자들에 쓸 수 있는 POI (다른 일자에 이미 쓴 POI는 호출 측에서 제외)
 */
export async function assignDays(args: {
  llm: LlmProvider;
  trip: TripInput;
  cityName: string;
  dayIndexes: number[];
  pois: AgentPoi[];
  nearbyTowns: NearbyTown[];
  feedback?: string;
  /** 일정 조정 때 사용자가 적은 요청 */
  userRequest?: string;
}): Promise<AssignResult> {
  const { trip, dayIndexes, pois, nearbyTowns } = args;
  const prompt = assignmentUserPrompt({
    city: args.cityName,
    style: trip.style,
    transport: trip.transport,
    budget: trip.budget,
    days: dayIndexes.map((i) => {
      const d = dayDate(trip.startDate, i);
      return { dayIndex: i, date: d?.date ?? null, weekday: d ? WEEKDAY_KO[d.weekday] : null };
    }),
    pois: pois.map((p) => ({
      key: p.key,
      name: p.name,
      category: p.category,
      lat: p.lat,
      lon: p.lon,
      closed: closedLabel(p.hours),
      rating: p.rating,
    })),
    nearbyTowns: nearbyTowns.filter((t) => t.kind === "dayTrip").map((t) => ({ name: t.name, travelMins: t.travelMins })),
    feedback: args.feedback,
    userRequest: args.userRequest,
  });

  const assignment = await requestAssignment(args.llm, prompt);
  return enforceAssignment(assignment, { dayIndexes, pois, nearbyTowns, allowDayTrip: trip.days >= 3 });
}

// ---------- LLM 없이 배분 (대체 경로) ----------

export const FALLBACK_STOPS_PER_DAY = 4;
const FALLBACK_STAY_MINS: Record<PoiCategory, number> = { sight: 60, museum: 90, food: 60 };

/**
 * LLM 배분이 실패했을 때(장애·할당량 초과)의 대체 배분 — 순수 함수, 같은 입력이면 같은 결과.
 * 관광청 추천 → 평점 순으로 하루 최대 4곳을 고르고, 중심점 기준 방위각으로 정렬해 이웃한 장소끼리 같은 날에 묶는다.
 * 순서·휴무 요일은 이후 단계(동선 최적화·검증)가 처리한다.
 */
export function fallbackAssignment(args: { dayIndexes: number[]; pois: AgentPoi[] }): AssignResult {
  const { dayIndexes, pois } = args;
  const count = Math.min(pois.length, dayIndexes.length * FALLBACK_STOPS_PER_DAY);
  const chosen = [...pois]
    .sort((a, b) => Number(b.origin === "tourism") - Number(a.origin === "tourism") || (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, count);

  const lat = chosen.reduce((s, p) => s + p.lat, 0) / (chosen.length || 1);
  const lon = chosen.reduce((s, p) => s + p.lon, 0) / (chosen.length || 1);
  const angle = (p: AgentPoi) => Math.atan2(p.lat - lat, p.lon - lon);
  const sorted = chosen.sort((a, b) => angle(a) - angle(b));
  // 방위각은 원형(-π와 π가 이웃)이라, -π부터 자르면 서쪽 묶음이 첫날·마지막 날로 갈라진다.
  // 가장 큰 각도 간격 다음부터 시작해 이웃한 장소가 같은 구간에 들어가게 한다
  let start = 0;
  let maxGap = -1;
  sorted.forEach((p, i) => {
    const gap = (angle(p) - angle(sorted[(i - 1 + sorted.length) % sorted.length]) + 2 * Math.PI) % (2 * Math.PI);
    if (gap > maxGap) [maxGap, start] = [gap, i];
  });
  const ordered = [...sorted.slice(start), ...sorted.slice(0, start)];

  const perDay = Math.ceil(ordered.length / dayIndexes.length);
  const days = new Map<number, DayAssignment>();
  dayIndexes.forEach((dayIndex, i) => {
    const stops = ordered.slice(i * perDay, (i + 1) * perDay).map((poi) => ({ poi, stayMins: FALLBACK_STAY_MINS[poi.category] }));
    days.set(dayIndex, { dayIndex, title: stops.length ? "가까운 명소 묶음" : "자유 일정", dayTripTown: null, stops });
  });
  return { days, warnings: [] };
}

/**
 * LLM 출력 검증 (순수 함수): 요청한 일자만, 주어진 POI 키만, POI 중복 없이, 근교 도시는 목록에 있는 것만.
 * 규칙 위반 항목은 버리고 경고로 남긴다 — 좌표 없는 장소가 일정에 들어갈 수 없다.
 */
export function enforceAssignment(
  assignment: Assignment,
  opts: { dayIndexes: number[]; pois: AgentPoi[]; nearbyTowns: NearbyTown[]; allowDayTrip: boolean },
): AssignResult {
  const warnings: string[] = [];
  const allowedDays = new Set(opts.dayIndexes);
  const byKey = new Map(opts.pois.map((p) => [p.key, p]));
  const towns = new Map(opts.nearbyTowns.filter((t) => t.kind === "dayTrip").map((t) => [t.name, t]));
  const used = new Set<string>();
  const usedTowns = new Set<string>();
  const days = new Map<number, DayAssignment>();

  for (const day of assignment.days) {
    if (!allowedDays.has(day.dayIndex) || days.has(day.dayIndex)) {
      // 경고는 화면에 그대로 나가므로 1부터 세는 일차로 쓴다 (dayIndex는 0부터)
      warnings.push(`요청하지 않은 일자(${day.dayIndex + 1}일차) 배분을 무시했습니다.`);
      continue;
    }
    let dayTripTown: string | null = null;
    if (day.dayTripTown) {
      if (opts.allowDayTrip && towns.has(day.dayTripTown) && !usedTowns.has(day.dayTripTown)) {
        dayTripTown = day.dayTripTown;
        usedTowns.add(dayTripTown);
      } else {
        warnings.push(`근교 도시 '${day.dayTripTown}' 배정을 무시했습니다 (목록에 없거나 중복).`);
      }
    }
    const stops: DayAssignment["stops"] = [];
    if (!dayTripTown) {
      for (const s of day.stops) {
        const poi = byKey.get(s.poiKey);
        if (!poi) {
          warnings.push(`목록에 없는 POI 키(${s.poiKey})를 제외했습니다.`);
          continue;
        }
        if (used.has(poi.key)) {
          warnings.push(`중복 배정된 POI(${poi.key} ${poi.name})를 제외했습니다.`);
          continue;
        }
        used.add(poi.key);
        stops.push({ poi, stayMins: s.stayMins });
      }
    }
    days.set(day.dayIndex, { dayIndex: day.dayIndex, title: day.title, dayTripTown, stops });
  }

  for (const i of opts.dayIndexes) {
    if (!days.has(i)) {
      warnings.push(`${i + 1}일차 배분이 누락되어 자유 일정으로 두었습니다.`);
      days.set(i, { dayIndex: i, title: "자유 일정", dayTripTown: null, stops: [] });
    }
  }
  return { days, warnings };
}
