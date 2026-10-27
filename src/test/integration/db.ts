import type { Db } from "@/server/db/client";

/** FK 순서대로 모든 테이블을 비운다 */
export async function resetDb(db: Db): Promise<void> {
  await db.$transaction([
    db.tripDay.deleteMany(),
    db.nearbyTown.deleteMany(),
    db.trip.deleteMany(),
    db.poi.deleteMany(),
    db.city.deleteMany(),
    db.usageLog.deleteMany(),
  ]);
}
