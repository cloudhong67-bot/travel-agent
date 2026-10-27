/** 하루 기준 시간대. 사용자가 한국에 있으므로 "오늘"은 서울 날짜로 계산한다 (ACA 컨테이너는 UTC). */
export const LIMIT_TIME_ZONE = "Asia/Seoul";

/** now의 서울 기준 달력 날짜 "YYYY-MM-DD" */
export function seoulDateKey(now: Date = new Date()): string {
  // en-CA 로캘은 YYYY-MM-DD 형식을 돌려준다.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LIMIT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** "YYYY-MM-DD"를 DATE 컬럼에 저장할 UTC 자정 Date로 변환 */
export function toDbDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function isDailyLimitExceeded(usedToday: number, limit: number): boolean {
  return usedToday >= limit;
}
