import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("동시 실행 수를 제한하고 입력 순서대로 결과를 돌려준다", async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency([30, 10, 20, 5, 15], 3, async (ms, i) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, ms));
      active--;
      if (i === 3) throw new Error("boom");
      return i;
    });
    expect(peak).toBe(3);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "fulfilled", "rejected", "fulfilled"]);
    expect(results[4]).toEqual({ status: "fulfilled", value: 4 });
  });
});
