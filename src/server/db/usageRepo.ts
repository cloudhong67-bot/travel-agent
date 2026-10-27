import type { UsageProvider } from "@/lib/schemas";
import { seoulDateKey, toDbDate } from "@/server/limits";
import { getPrisma, type Db, type DbTx } from "./client";

export interface UsageEntry {
  provider: UsageProvider;
  tripId?: string;
  calls?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** 기본: 현재 시각의 서울 날짜 */
  at?: Date;
}

export interface UsageTotals {
  provider: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export function createUsageRepo(db: () => Db | DbTx) {
  return {
    async record(entry: UsageEntry, tx?: DbTx): Promise<void> {
      await (tx ?? db()).usageLog.create({
        data: {
          date: toDbDate(seoulDateKey(entry.at)),
          provider: entry.provider,
          tripId: entry.tripId ?? null,
          calls: entry.calls ?? 1,
          inputTokens: entry.inputTokens ?? 0,
          outputTokens: entry.outputTokens ?? 0,
        },
      });
    },

    /** 해당 서울 날짜에 생성된 여행 수 (provider = "trip" 기록 합계, 삭제된 여행도 포함) */
    async countTripCreations(dateKey: string, tx?: DbTx): Promise<number> {
      const result = await (tx ?? db()).usageLog.aggregate({
        where: { date: toDbDate(dateKey), provider: "trip" },
        _sum: { calls: true },
      });
      return result._sum.calls ?? 0;
    },

    /** 날짜별 공급자 사용량 합계 (비용 모니터링용) */
    async dailyTotals(dateKey: string): Promise<UsageTotals[]> {
      const rows = await db().usageLog.groupBy({
        by: ["provider"],
        where: { date: toDbDate(dateKey) },
        _sum: { calls: true, inputTokens: true, outputTokens: true },
        orderBy: { provider: "asc" },
      });
      return rows.map((r) => ({
        provider: r.provider,
        calls: r._sum.calls ?? 0,
        inputTokens: r._sum.inputTokens ?? 0,
        outputTokens: r._sum.outputTokens ?? 0,
      }));
    },
  };
}

export type UsageRepo = ReturnType<typeof createUsageRepo>;
export const usageRepo = createUsageRepo(getPrisma);
