/**
 * 경량 마이그레이션 실행기(scripts/migrate.mjs) — 운영 컨테이너가 시작할 때 `prisma migrate deploy` 대신 쓴다.
 * 빈 DB를 새로 만들어 적용·재실행·동시 실행·실패 처리와 Prisma CLI 호환성(migrate status)을 확인한다.
 */
import { execSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { loadMigrations, migrate } from "../../../scripts/migrate.mjs";
import { createPrismaClient, type Db } from "./client";

const masterUrl = inject("masterUrl");
const MIGRATIONS = path.resolve("prisma/migrations");
const quiet = () => undefined;

describe.skipIf(!masterUrl)("마이그레이션 실행기 (SQL Server)", () => {
  let master: Db;
  let n = 0;

  /** 빈 DB를 만들고 연결 문자열을 돌려준다 */
  async function freshDb(): Promise<string> {
    const name = `trippilot_migrate_${Date.now()}_${n++}`;
    await master.$executeRawUnsafe(`CREATE DATABASE [${name}]`);
    return masterUrl.replace("database=master", `database=${name}`);
  }

  async function migrationRows(url: string) {
    const db = createPrismaClient(url);
    try {
      return await db.$queryRawUnsafe<{ migration_name: string; checksum: string; finished: boolean; logs: string | null }[]>(
        "SELECT migration_name, checksum, CAST(CASE WHEN finished_at IS NULL THEN 0 ELSE 1 END AS BIT) AS finished, logs FROM _prisma_migrations ORDER BY migration_name",
      );
    } finally {
      await db.$disconnect();
    }
  }

  beforeAll(() => {
    master = createPrismaClient(masterUrl);
  });
  afterAll(() => master?.$disconnect());

  it("빈 DB에 전부 적용하고, 다시 실행하면 아무것도 하지 않는다 (Prisma와 같은 기록)", async () => {
    const url = await freshDb();
    const files = await loadMigrations(MIGRATIONS);

    expect(await migrate({ url, dir: MIGRATIONS, log: quiet })).toEqual(files.map((f) => f.name));
    expect(await migrate({ url, dir: MIGRATIONS, log: quiet })).toEqual([]);

    const rows = await migrationRows(url);
    expect(rows.map((r) => [r.migration_name, r.checksum, r.finished])).toEqual(files.map((f) => [f.name, f.checksum, true]));

    // 앱 테이블이 실제로 생겼는지
    const db = createPrismaClient(url);
    await expect(db.trip.count()).resolves.toBe(0);
    await db.$disconnect();

    // Prisma CLI가 같은 DB를 "최신"으로 인식한다 (로컬 migrate dev/status와 섞어 써도 됨)
    const status = execSync("npx prisma migrate status", { env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
    expect(status).toMatch(/up to date/i);
  }, 60_000);

  it("여러 복제본이 동시에 실행해도 한 번씩만 적용한다 (sp_getapplock)", async () => {
    const url = await freshDb();
    const results = await Promise.all([1, 2, 3].map(() => migrate({ url, dir: MIGRATIONS, log: quiet })));

    const files = await loadMigrations(MIGRATIONS);
    expect(results.flat().sort()).toEqual(files.map((f) => f.name).sort());
    expect(await migrationRows(url)).toHaveLength(files.length);
  }, 60_000);

  it("실패한 마이그레이션은 기록을 남기고, 이후 실행을 막는다", async () => {
    const url = await freshDb();
    const dir = await mkdtemp(path.join(tmpdir(), "migrations-"));
    const add = async (name: string, sql: string) => {
      await mkdir(path.join(dir, name));
      await writeFile(path.join(dir, name, "migration.sql"), sql);
    };
    await add("001_ok", "CREATE TABLE [dbo].[A] ([id] INT NOT NULL);");
    await add("002_broken", "BEGIN TRY BEGIN TRAN; INSERT INTO [dbo].[Missing] VALUES (1); COMMIT TRAN; END TRY BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK TRAN; THROW END CATCH");
    await add("003_never", "CREATE TABLE [dbo].[C] ([id] INT NOT NULL);");

    await expect(migrate({ url, dir, log: quiet })).rejects.toThrow(/002_broken 실패/);
    const rows = await migrationRows(url);
    expect(rows.map((r) => [r.migration_name, r.finished])).toEqual([
      ["001_ok", true],
      ["002_broken", false],
    ]);
    expect(rows[1].logs).toMatch(/Missing/);

    await expect(migrate({ url, dir, log: quiet })).rejects.toThrow(/실패한 마이그레이션 기록이 있어 중단합니다: 002_broken/);
  }, 60_000);
});
