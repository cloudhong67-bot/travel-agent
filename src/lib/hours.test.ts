import { describe, expect, it } from "vitest";
import { hoursOn, parseWeeklyHours, summarizeHours } from "./hours";

const ko = (mon: string, rest = "오전 9:00~오후 6:00") => [
  `월요일: ${mon}`,
  `화요일: ${rest}`,
  `수요일: ${rest}`,
  `목요일: ${rest}`,
  `금요일: ${rest}`,
  `토요일: ${rest}`,
  `일요일: ${rest}`,
];

describe("summarizeHours", () => {
  it("같은 시간이 이어지는 요일을 묶는다", () => {
    expect(summarizeHours(ko("휴무일"))).toEqual(["월 휴무", "화–일 09:00–18:00"]);
  });

  it("매일 같으면 한 줄", () => {
    expect(summarizeHours(ko("오전 10:00~오후 10:00", "오전 10:00~오후 10:00"))).toEqual(["매일 10:00–22:00"]);
  });

  it("중간에 다른 요일이 끼면 따로 묶는다", () => {
    const lines = ko("오전 9:00~오후 6:00");
    lines[2] = "수요일: 오전 9:00~오후 9:00";
    expect(summarizeHours(lines)).toEqual(["월–화 09:00–18:00", "수 09:00–21:00", "목–일 09:00–18:00"]);
  });

  it("영어 표기·여러 구간·자정·24시간", () => {
    expect(
      summarizeHours([
        "Monday: Closed",
        "Tuesday: 12:00 PM – 3:00 PM, 6:00 PM – 12:00 AM",
        "Wednesday: Open 24 hours",
      ]),
    ).toEqual(["월 휴무", "화 12:00–15:00, 18:00–00:00", "수 24시간"]);
  });

  it("해석할 수 없거나 정보가 없으면 null (원문 표시용)", () => {
    expect(summarizeHours(["월요일: 예약제 운영"])).toBeNull();
    expect(summarizeHours(null)).toBeNull();
    expect(summarizeHours([])).toBeNull();
  });
});

describe("hoursOn", () => {
  it("특정 요일의 표기", () => {
    expect(hoursOn(ko("휴무일"), 1)).toBe("휴무");
    expect(hoursOn(ko("휴무일"), 3)).toBe("09:00–18:00");
    expect(hoursOn(null, 1)).toBeNull();
    expect(parseWeeklyHours(["월요일: 오전 12:00~오후 12:00"])?.get(1)).toBe("00:00–12:00");
  });
});
