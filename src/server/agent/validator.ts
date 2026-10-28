import { closedWeekdays, WEEKDAY_KO } from "@/lib/hours";
import type { DayPlan, ValidationIssue } from "./types";

/** PRD 4장 수용 기준: 하루 이동시간 합계 ≤ 체류시간 합계의 40% */
export const MAX_TRAVEL_RATIO = 0.4;

/**
 * 하루 일정 검증 (순수 함수).
 *  - closedDay: 휴무 요일에 배치된 장소 (출발일이 없으면 요일을 알 수 없어 검사하지 않음)
 *  - travelRatio: 이동시간 / 체류시간 > 40% (근교 당일치기 일자는 왕복 이동이 본질이므로 제외)
 *  - missingCoords: 좌표 없는 방문지
 *  - missingSource: 출처 URL 없는 방문지
 */
export function validateDay(day: Pick<DayPlan, "stops" | "totals" | "dayTripTown"> & { weekday: number | null }): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const stop of day.stops) {
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) {
      issues.push({ rule: "missingCoords", poiKey: stop.key, message: `${stop.name}: 좌표 없음` });
    }
    if (!stop.sourceUrl) {
      issues.push({ rule: "missingSource", poiKey: stop.key, message: `${stop.name}: 출처 링크 없음` });
    }
    if (day.weekday !== null) {
      const closed = closedWeekdays(stop.openingHours);
      if (closed?.has(day.weekday)) {
        issues.push({
          rule: "closedDay",
          poiKey: stop.key,
          message: `${stop.name}: ${WEEKDAY_KO[day.weekday]}요일 휴무`,
        });
      }
    }
  }

  if (!day.dayTripTown && day.totals.stayMins > 0 && day.totals.travelRatio > MAX_TRAVEL_RATIO) {
    issues.push({
      rule: "travelRatio",
      message: `이동 ${day.totals.travelMins}분 / 체류 ${day.totals.stayMins}분 = ${Math.round(day.totals.travelRatio * 100)}% (상한 40%)`,
    });
  }
  return issues;
}

/** 재시도 프롬프트에 넣을 피드백 문장 */
export function issuesToFeedback(issues: ValidationIssue[]): string {
  return issues
    .map((i) => {
      switch (i.rule) {
        case "closedDay":
          return `- ${i.poiKey}: 이 날은 휴무이므로 다른 장소로 바꾸세요.`;
        case "travelRatio":
          return `- 이동시간 비율 초과(${i.message}). 서로 가까운 장소끼리 묶고 방문지 수를 줄이세요.`;
        case "missingCoords":
        case "missingSource":
          return `- ${i.poiKey}: ${i.message}. 다른 장소로 바꾸세요.`;
      }
    })
    .join("\n");
}
