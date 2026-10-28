import { describe, expect, it, vi } from "vitest";
import type { MapsProvider } from "@/server/adapters/maps/types";
import { BudgetExceededError } from "./budget";
import { travelMinutes } from "./plan";

const points = [{ lat: 41.14, lng: -8.61 }, { lat: 41.15, lng: -8.62 }, { lat: 41.16, lng: -8.6 }];
const failingMaps = (error: unknown): MapsProvider => ({
  name: "google",
  geocode: vi.fn(),
  searchPlaces: vi.fn(),
  routeGeometry: vi.fn(),
  travelTimeMatrix: vi.fn().mockRejectedValue(error),
});

describe("travelMinutes (이동시간 행렬)", () => {
  it("행렬 API가 실패하면 일정을 실패시키지 않고 직선거리 추정으로 채운다", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { minutes, basis } = await travelMinutes(failingMaps(new TypeError("fetch failed")), points, "transit");
    expect(basis).toBe("estimated");
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(minutes[i][j]).toEqual(i === j ? 0 : expect.any(Number));
    expect(minutes[0][1]).toBeGreaterThan(0);
  });

  it("비용 상한 초과는 대체하지 않고 그대로 던진다 (부분 저장 흐름)", async () => {
    await expect(travelMinutes(failingMaps(new BudgetExceededError("maps", 200)), points, "driving")).rejects.toBeInstanceOf(BudgetExceededError);
  });
});
