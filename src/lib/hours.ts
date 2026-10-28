/**
 * 요일·운영시간 처리의 단일 원천 (서버·클라이언트 공용 순수 함수).
 * 지도 공급자의 요일별 운영시간 문자열(예: "월요일: 오전 9:00~오후 6:00", "Monday: 9:00 AM – 5:00 PM")을
 * 해석·요약하고, 검증(휴무 요일)에도 같은 해석을 쓴다. 해석할 수 없으면 null을 돌려 원문을 그대로 보여주게 한다.
 */

const DAY_INDEX: Record<string, number> = {
  일요일: 0, 월요일: 1, 화요일: 2, 수요일: 3, 목요일: 4, 금요일: 5, 토요일: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};
/** 요일 한 글자 (0=일) */
export const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;
const DAY_KO: readonly string[] = WEEKDAY_KO;
const CLOSED = /휴무|closed|定休|休館/i;

/** "월요일: 휴무" → [1, "휴무"]. 요일을 알 수 없으면 null */
function splitDayLine(line: string): [day: number, text: string] | null {
  const idx = line.search(/[:：]/);
  if (idx < 0) return null;
  const day = DAY_INDEX[line.slice(0, idx).trim().toLowerCase()];
  return day === undefined ? null : [day, line.slice(idx + 1)];
}
/** 표시 순서: 월 → 일 */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const pad = (n: number) => String(n).padStart(2, "0");

/** "오전 9:00", "오후 12:30", "9:00 AM", "21:00" → "09:00" 형식 */
function toClock(raw: string): string | null {
  const m = raw.trim().match(/^(오전|오후)?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = Number(m[2]);
  const pm = m[1] === "오후" || m[4]?.toUpperCase() === "PM";
  const am = m[1] === "오전" || m[4]?.toUpperCase() === "AM";
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  return `${pad(h)}:${m[3]}`;
}

/** 한 요일의 시간 부분 → 정규화된 표기 ("09:00–18:00", "휴무", "24시간") */
function normalizeDayText(text: string): string | null {
  const t = text.trim();
  if (CLOSED.test(t)) return "휴무";
  if (/24\s*시간|open 24 hours/i.test(t)) return "24시간";
  const ranges = t.split(/\s*,\s*/).map((range) => {
    const [from, to] = range.split(/\s*[~–\-]\s*/);
    // "9:00 ~ 오후 6:00"처럼 앞쪽 오전·오후가 생략된 경우는 공급자 표기상 오전이다
    const a = from ? toClock(from) : null;
    const b = to ? toClock(to) : null;
    return a && b ? `${a}–${b}` : null;
  });
  return ranges.every(Boolean) ? ranges.join(", ") : null;
}

/** 요일별 정규화 표기 (0=일). 하나라도 해석 실패하면 null */
export function parseWeeklyHours(lines: string[] | null): Map<number, string> | null {
  if (!lines?.length) return null;
  const week = new Map<number, string>();
  for (const line of lines) {
    const parsed = splitDayLine(line);
    const text = parsed && normalizeDayText(parsed[1]);
    if (!parsed || text === null) return null;
    week.set(parsed[0], text);
  }
  return week.size ? week : null;
}

/**
 * 휴무 요일(0=일). 시간 형식을 해석하지 못하는 줄이 섞여 있어도 "휴무"라고 적힌 요일은 잡아낸다 (검증용).
 * 운영시간 정보가 없으면 null — 알 수 없음이지 "매일 영업"이 아니다.
 */
export function closedWeekdays(lines: string[] | null): Set<number> | null {
  if (!lines?.length) return null;
  const closed = new Set<number>();
  for (const line of lines) {
    const parsed = splitDayLine(line);
    if (parsed && CLOSED.test(parsed[1])) closed.add(parsed[0]);
  }
  return closed;
}

/**
 * 같은 시간이 이어지는 요일을 묶어 요약한다.
 * 예) ["월 휴무", "화–일 09:00–18:00"], ["매일 10:00–22:00"]
 */
export function summarizeHours(lines: string[] | null): string[] | null {
  const week = parseWeeklyHours(lines);
  if (!week) return null;
  const days = WEEK_ORDER.filter((d) => week.has(d));
  if (days.length === 7 && new Set(week.values()).size === 1) return [`매일 ${week.get(1)}`];

  const groups: { from: number; to: number; text: string }[] = [];
  for (const d of days) {
    const text = week.get(d)!;
    const last = groups.at(-1);
    if (last && last.text === text && WEEK_ORDER.indexOf(d) === WEEK_ORDER.indexOf(last.to) + 1) last.to = d;
    else groups.push({ from: d, to: d, text });
  }
  return groups.map((g) => `${g.from === g.to ? DAY_KO[g.from] : `${DAY_KO[g.from]}–${DAY_KO[g.to]}`} ${g.text}`);
}

/** 특정 요일(0=일)의 운영시간 표기. 정보가 없으면 null */
export function hoursOn(lines: string[] | null, weekday: number): string | null {
  return parseWeeklyHours(lines)?.get(weekday) ?? null;
}

export const weekdayFromKo = (label: string | null) => (label ? DAY_KO.indexOf(label) : -1);
