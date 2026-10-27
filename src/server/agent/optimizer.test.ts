import { describe, expect, it } from "vitest";
import { nearestNeighbor, optimizeTour, tourCost } from "./optimizer";

/** 모든 순열을 시도한 최적 비용 (0번 고정) */
function bruteForce(cost: number[][]): number {
  const rest = cost.map((_, i) => i).slice(1);
  let best = Infinity;
  const permute = (arr: number[], prefix: number[]) => {
    if (arr.length === 0) best = Math.min(best, tourCost(cost, [0, ...prefix]));
    arr.forEach((v, i) => permute([...arr.slice(0, i), ...arr.slice(i + 1)], [...prefix, v]));
  };
  permute(rest, []);
  return best;
}

/** 결정적 의사난수 (테스트 재현성) */
function rng(seed: number) {
  return () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
}

describe("optimizeTour", () => {
  it("거점(0)에서 출발하는 유효한 순열을 돌려준다", () => {
    const cost = [
      [0, 2, 9, 10],
      [1, 0, 6, 4],
      [15, 7, 0, 8],
      [6, 3, 12, 0],
    ];
    const { order } = optimizeTour(cost);
    expect(order[0]).toBe(0);
    expect([...order].sort()).toEqual([0, 1, 2, 3]);
  });

  it("작은 비대칭 행렬에서 최적해를 찾는다 (고전 4도시 예제, 최적 21)", () => {
    const cost = [
      [0, 2, 9, 10],
      [1, 0, 6, 4],
      [15, 7, 0, 8],
      [6, 3, 12, 0],
    ];
    expect(optimizeTour(cost).cost).toBe(21);
  });

  it("최근접 이웃이 놓치는 교차 경로를 2-opt가 푼다", () => {
    // 정사각형 꼭짓점: 0(0,0) 1(0,1) 2(1,0) 3(1,1) — NN은 0→1→3→2 또는 교차 경로를 만들 수 있다
    const pts = [
      [0, 0],
      [1, 1],
      [0, 1],
      [1, 0],
    ];
    const cost = pts.map((a) => pts.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])));
    expect(optimizeTour(cost).cost).toBeCloseTo(4, 6);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])("무작위 유클리드 6~8개 지점(seed %i): 브루트포스 최적과 같다", (seed) => {
    const r = rng(seed);
    const n = 6 + (seed % 3);
    const pts = Array.from({ length: n }, () => [r() * 10, r() * 10]);
    const cost = pts.map((a) => pts.map((b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]) * 10)));
    const result = optimizeTour(cost);
    expect(result.cost).toBe(bruteForce(cost));
    expect(result.cost).toBeLessThanOrEqual(tourCost(cost, nearestNeighbor(cost)));
  });

  it("경로 없음(null)은 피한다", () => {
    const cost = [
      [0, 5, null, 5],
      [5, 0, 5, null],
      [null, 5, 0, 5],
      [5, null, 5, 0],
    ];
    expect(optimizeTour(cost).cost).toBe(20);
  });

  it("방문지 0~1개", () => {
    expect(optimizeTour([])).toEqual({ order: [], cost: 0 });
    expect(optimizeTour([[0, 3], [4, 0]])).toEqual({ order: [0, 1], cost: 7 });
  });
});
