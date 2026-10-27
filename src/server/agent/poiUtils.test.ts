import { describe, expect, it } from "vitest";
import { assignKeys, closedWeekdays, dayDate, dedupePois, isOfficialSource, normalizeName, rankSources } from "./poiUtils";
import type { AgentPoi } from "./types";

const poi = (name: string, lat: number, lon: number, patch: Partial<AgentPoi> = {}): AgentPoi => ({
  key: "",
  name,
  category: "sight",
  lat,
  lon,
  hours: null,
  sourceUrl: null,
  origin: "google",
  ...patch,
});

describe("dedupePois", () => {
  it("100m 이내 + 이름 유사 → 중복, 빠진 정보는 채운다", () => {
    const out = dedupePois([
      poi("볼사 궁전", 41.1413, -8.6155),
      poi("볼사궁전 (Palácio)", 41.1418, -8.6155, { sourceUrl: "https://a", hours: ["월요일: 휴무일"], rating: 4.6 }), // 약 56m
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "볼사 궁전", sourceUrl: "https://a", hours: ["월요일: 휴무일"], rating: 4.6 });
  });

  it("100m 이내라도 이름이 다르면 별개 장소 (30m 초과)", () => {
    const out = dedupePois([poi("포르투 대성당", 41.1428, -8.611), poi("바탈랴 광장", 41.1433, -8.611)]); // 약 56m
    expect(out).toHaveLength(2);
  });

  it("이름이 달라도 30m 이내거나 같은 장소 ID면 중복 (원어·한국어 표기 차이)", () => {
    expect(dedupePois([poi("클레리구스 탑", 41.1457, -8.6146), poi("Torre dos Clérigos", 41.14575, -8.6146)])).toHaveLength(1);
    expect(
      dedupePois([
        poi("볼사 궁전", 41.1413, -8.6155, { externalId: "google:x" }),
        poi("Palácio da Bolsa", 41.1423, -8.6155, { externalId: "google:x" }),
      ]),
    ).toHaveLength(1);
  });

  it("같은 장소면 원어 이름보다 한국어 이름을 표시한다", () => {
    const out = dedupePois([
      poi("Palácio da Bolsa", 41.1413, -8.6155, { externalId: "google:x", origin: "tourism" }),
      poi("볼사 궁전", 41.1413, -8.6155, { externalId: "google:x" }),
    ]);
    expect(out).toEqual([expect.objectContaining({ name: "볼사 궁전", origin: "tourism" })]);
    // 먼저 온 쪽이 이미 한국어면 유지
    expect(dedupePois([poi("볼사 궁전", 41.14, -8.61), poi("Palácio da Bolsa", 41.14, -8.61)])[0].name).toBe("볼사 궁전");
  });

  it("이름이 같아도 1km 넘게 떨어지면 별개 (체인 식당 등)", () => {
    expect(dedupePois([poi("스타벅스", 41.14, -8.61), poi("스타벅스", 41.16, -8.61)])).toHaveLength(2);
  });

  it("좌표 없는 장소는 버린다", () => {
    expect(dedupePois([poi("유령", Number.NaN, 0)])).toEqual([]);
  });

  it("키는 P01부터", () => {
    expect(assignKeys([poi("a", 0, 0), poi("b", 1, 1)]).map((p) => p.key)).toEqual(["P01", "P02"]);
  });

  it("normalizeName", () => {
    expect(normalizeName(" Palácio  da Bolsa (Porto)! ")).toBe("paláciodabolsa");
  });
});

describe("공식 출처", () => {
  it.each([
    ["https://www.visitporto.travel/pt-PT", true],
    ["https://www.visitportugal.com/en", true],
    ["https://en.parisjetaime.com/", true],
    ["https://www.japan.travel/ko/", true],
    ["https://kyoto.travel/en", true],
    ["https://korean.visitkorea.or.kr/", true],
    ["https://www.mofa.go.jp/", true],
    ["https://www.goturkiye.com/", true],
    ["https://someblog.example/porto", false],
    ["https://www.tripadvisor.com/x", false],
  ])("%s → %s", (url, expected) => {
    expect(isOfficialSource(url)).toBe(expected);
  });

  it("rankSources: 공식 출처를 앞으로, 나머지 순서는 유지", () => {
    const out = rankSources([{ url: "https://b.example" }, { url: "https://visitporto.travel" }, { url: "https://a.example" }]);
    expect(out.map((s) => s.url)).toEqual(["https://visitporto.travel", "https://b.example", "https://a.example"]);
  });
});

describe("운영시간·날짜", () => {
  it("휴무 요일 파싱 (한국어·영어), 정보 없음은 null", () => {
    expect(closedWeekdays(["월요일: 휴무일", "화요일: 오전 9:00~오후 6:00"])).toEqual(new Set([1]));
    expect(closedWeekdays(["Sunday: Closed", "Monday: 9:00 AM – 5:00 PM"])).toEqual(new Set([0]));
    expect(closedWeekdays(null)).toBeNull();
    expect(closedWeekdays(["월요일: 24시간 영업"])).toEqual(new Set());
  });

  it("dayDate: 출발일 + dayIndex", () => {
    expect(dayDate("2027-05-03", 0)).toEqual({ date: "2027-05-03", weekday: 1 });
    expect(dayDate("2027-05-03", 6)).toEqual({ date: "2027-05-09", weekday: 0 });
    expect(dayDate(null, 0)).toBeNull();
  });
});
