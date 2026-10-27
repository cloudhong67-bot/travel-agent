/**
 * 동선 최적화 (순수 함수). 0번 노드(숙소 거점)에서 출발해 모든 노드를 한 번씩 방문하고 0번으로 돌아오는 순회.
 * 최근접 이웃으로 초기 해를 만든 뒤 2-opt로 개선한다. 비대칭 행렬(일방통행·대중교통)도 지원하도록
 * 후보마다 순회 비용 전체를 다시 계산한다 (하루 방문지 ≤ 10개라 O(n³)로 충분).
 *
 * @param cost cost[i][j] = i→j 이동 비용(분). null·NaN·Infinity는 경로 없음으로 보고 큰 벌점을 준다.
 */
export interface TourResult {
  /** 0으로 시작하는 방문 순서 (복귀 0은 포함하지 않음) */
  order: number[];
  cost: number;
}

const UNREACHABLE = 1e6;

const edge = (cost: (number | null)[][], i: number, j: number) => {
  const v = cost[i]?.[j];
  return v === null || v === undefined || !Number.isFinite(v) ? UNREACHABLE : v;
};

export function tourCost(cost: (number | null)[][], order: number[]): number {
  let total = 0;
  for (let i = 0; i < order.length; i++) total += edge(cost, order[i], order[(i + 1) % order.length]);
  return total;
}

export function nearestNeighbor(cost: (number | null)[][], start = 0): number[] {
  const n = cost.length;
  const order = [start];
  const visited = new Set(order);
  while (order.length < n) {
    const last = order[order.length - 1];
    let best = -1;
    for (let j = 0; j < n; j++) {
      if (visited.has(j)) continue;
      if (best === -1 || edge(cost, last, j) < edge(cost, last, best)) best = j;
    }
    order.push(best);
    visited.add(best);
  }
  return order;
}

export function twoOpt(cost: (number | null)[][], initial: number[]): number[] {
  let order = [...initial];
  let best = tourCost(cost, order);
  let improved = true;
  while (improved) {
    improved = false;
    // 0번(출발지)은 고정하고 1..n-1 구간을 뒤집어 본다
    for (let i = 1; i < order.length - 1; i++) {
      for (let k = i + 1; k < order.length; k++) {
        const candidate = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
        const c = tourCost(cost, candidate);
        if (c < best - 1e-9) {
          order = candidate;
          best = c;
          improved = true;
        }
      }
    }
  }
  return order;
}

export function optimizeTour(cost: (number | null)[][]): TourResult {
  if (cost.length === 0) return { order: [], cost: 0 };
  if (cost.length <= 2) {
    const order = cost.map((_, i) => i);
    return { order, cost: tourCost(cost, order) };
  }
  const order = twoOpt(cost, nearestNeighbor(cost, 0));
  return { order, cost: tourCost(cost, order) };
}
