import { describe, expect, it } from "vitest";
import { stayLabel } from "@/lib/labels";
import { recommendStay } from "./stay";
import type { AgentPoi, NearbyTown } from "./types";

const pois = (sights: number, museums = 0, food = 0) =>
  [
    ...Array.from({ length: sights }, () => ({ category: "sight" as const, origin: "google" as const })),
    ...Array.from({ length: museums }, () => ({ category: "museum" as const, origin: "google" as const })),
    ...Array.from({ length: food }, () => ({ category: "food" as const, origin: "google" as const })),
  ] satisfies Pick<AgentPoi, "category" | "origin">[];
const dayTrip: Pick<NearbyTown, "kind">[] = [{ kind: "dayTrip" }];

describe("recommendStay (추천 체류 일수)", () => {
  it("명소·박물관을 하루 4곳 기준으로 나누고, 식당은 세지 않는다", () => {
    expect(recommendStay(pois(8, 4, 10), [])).toMatchObject({ days: 3, nights: 2, reason: expect.stringContaining("12곳") });
  });

  it("당일치기 근교 도시가 있으면 하루를 더한다", () => {
    const stay = recommendStay(pois(8, 4), dayTrip);
    expect(stay).toMatchObject({ days: 4, nights: 3 });
    expect(stay.reason).toContain("근교 당일치기 1일");
    // 1박 추천 도시만 있으면 더하지 않는다
    expect(recommendStay(pois(8, 4), [{ kind: "overnight" }]).days).toBe(3);
  });

  it("작은 도시는 최소 2일, 큰 도시는 도시 안 5일 + 근교 1일로 제한한다", () => {
    expect(recommendStay(pois(1), []).days).toBe(2);
    expect(recommendStay(pois(0, 0, 5), []).days).toBe(2);
    expect(recommendStay(pois(30), []).days).toBe(5);
    expect(recommendStay(pois(30), dayTrip).days).toBe(6);
    expect(recommendStay(pois(30), []).reason).toContain("핵심만");
  });

  it("stayLabel: N박 M일", () => {
    expect(stayLabel(4)).toBe("3박 4일");
    expect(stayLabel(1)).toBe("당일");
  });
});
