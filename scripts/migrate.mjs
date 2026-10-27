#!/usr/bin/env node
/**
 * 경량 마이그레이션 실행기 — 운영 컨테이너에서 `prisma migrate deploy`를 대신한다 (Prisma CLI를 이미지에서 빼 약 200MB 절감).
 *
 * prisma/migrations/<이름>/migration.sql을 이름순으로 읽어 아직 적용되지 않은 것만 실행하고,
 * Prisma와 같은 `_prisma_migrations` 테이블·체크섬(파일 SHA-256)으로 기록한다.
 * 그래서 로컬의 `prisma migrate dev`·`prisma migrate status`와 같은 DB에서 섞어 써도 된다.
 *  - 여러 복제본이 동시에 시작해도 sp_getapplock(세션 잠금)으로 한 곳에서만 적용한다
 *  - 실패 기록(finished_at·rolled_back_at 모두 없음)이 있으면 Prisma(P3009)처럼 더 진행하지 않는다
 *  - 연결 문자열은 앱과 같은 @prisma/adapter-mssql 파서로 해석한다
 *
 * 사용: DATABASE_URL=<sqlserver://...> node scripts/migrate.mjs [migrations 디렉터리]
 * 마이그레이션 작성은 계속 `npm run db:migrate`(prisma migrate dev)로 한다.
 */
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaMssql } from "@prisma/adapter-mssql";

const LOCK_RESOURCE = "trippilot_migrate";
const LOCK_TIMEOUT_MS = 10 * 60_000;
/** DDL은 15초(mssql 기본)를 넘길 수 있으므로 요청 시간 제한을 늘린다 */
const REQUEST_TIMEOUT_MS = 10 * 60_000;

/** @returns {Promise<{ name: string, sql: string, checksum: string }[]>} 이름순 */
export async function loadMigrations(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const names = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const migrations = [];
  for (const name of names) {
    const buf = await readFile(path.join(dir, name, "migration.sql")).catch(() => null);
    if (!buf) continue; // migration.sql 없는 폴더는 Prisma도 무시한다
    migrations.push({ name, sql: buf.toString("utf8"), checksum: createHash("sha256").update(buf).digest("hex") });
  }
  return migrations;
}

/**
 * @param {{ url: string, dir: string, log?: (message: string) => void }} options
 * @returns {Promise<string[]>} 이번에 적용한 마이그레이션 이름
 */
export async function migrate({ url, dir, log = console.log }) {
  const migrations = await loadMigrations(dir);

  // 세션 잠금은 같은 연결에서만 유지되므로 연결 1개짜리 풀로 다시 연다 (설정은 어댑터가 해석한 값 그대로)
  const probe = await new PrismaMssql(url).connect();
  const { config } = probe.underlyingDriver();
  const schema = probe.getConnectionInfo().schemaName ?? "dbo";
  await probe.dispose();
  const adapter = await new PrismaMssql({
    ...config,
    requestTimeout: REQUEST_TIMEOUT_MS,
    pool: { ...config.pool, min: 0, max: 1 },
  }).connect();
  const pool = adapter.underlyingDriver();
  const table = `[${schema}].[_prisma_migrations]`;

  try {
    const lock = await pool
      .request()
      .input("resource", LOCK_RESOURCE)
      .input("timeout", LOCK_TIMEOUT_MS)
      .query(
        "DECLARE @r INT; EXEC @r = sp_getapplock @Resource = @resource, @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = @timeout; SELECT @r AS r",
      );
    if (lock.recordset[0].r < 0) throw new Error(`마이그레이션 잠금을 얻지 못했습니다 (sp_getapplock=${lock.recordset[0].r})`);

    // Prisma schema-engine이 만드는 것과 같은 구조
    await pool.request().batch(`IF OBJECT_ID(N'${table}', N'U') IS NULL
CREATE TABLE ${table} (
  [id] VARCHAR(36) NOT NULL PRIMARY KEY,
  [checksum] VARCHAR(64) NOT NULL,
  [finished_at] DATETIMEOFFSET NULL,
  [migration_name] NVARCHAR(250) NOT NULL,
  [logs] NVARCHAR(MAX) NULL,
  [rolled_back_at] DATETIMEOFFSET NULL,
  [started_at] DATETIMEOFFSET NOT NULL DEFAULT CURRENT_TIMESTAMP,
  [applied_steps_count] INT NOT NULL DEFAULT 0
);`);

    const rows = (await pool.request().query(`SELECT migration_name, checksum, finished_at, rolled_back_at FROM ${table}`)).recordset;
    const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
    if (failed.length) {
      throw new Error(
        `실패한 마이그레이션 기록이 있어 중단합니다: ${failed.join(", ")}. 원인을 고친 뒤 \`prisma migrate resolve --rolled-back <이름>\`(또는 --applied)로 정리하세요.`,
      );
    }
    const applied = new Map(rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => [r.migration_name, r.checksum]));
    for (const m of migrations) {
      if (applied.has(m.name) && applied.get(m.name) !== m.checksum) {
        log(`[migrate] 경고: 이미 적용된 ${m.name}의 파일이 바뀌었습니다 (체크섬 불일치). 다시 실행하지 않습니다.`);
      }
    }

    const pending = migrations.filter((m) => !applied.has(m.name));
    if (pending.length === 0) {
      log(`[migrate] 적용할 마이그레이션 없음 (${migrations.length}개 모두 적용됨)`);
      return [];
    }

    for (const m of pending) {
      const id = randomUUID();
      await pool
        .request()
        .input("id", id)
        .input("checksum", m.checksum)
        .input("name", m.name)
        .query(`INSERT INTO ${table} (id, checksum, migration_name, started_at, applied_steps_count) VALUES (@id, @checksum, @name, SYSDATETIMEOFFSET(), 0)`);
      try {
        // Prisma가 만든 SQL Server 마이그레이션은 자체 BEGIN TRAN/ROLLBACK을 가진 단일 배치다
        await pool.request().batch(m.sql);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // 컴파일 오류(없는 테이블 등)는 CATCH를 거치지 않고 배치를 끝내 BEGIN TRAN이 열린 채 남는다.
        // 그대로 기록하면 기록까지 그 트랜잭션에 묶여 연결 종료 시 사라지므로 먼저 되돌린다
        await pool.request().batch("IF @@TRANCOUNT > 0 ROLLBACK TRAN");
        await pool.request().input("id", id).input("logs", message).query(`UPDATE ${table} SET logs = @logs WHERE id = @id`);
        throw new Error(`마이그레이션 ${m.name} 실패: ${message}`);
      }
      await pool
        .request()
        .input("id", id)
        .query(`UPDATE ${table} SET finished_at = SYSDATETIMEOFFSET(), applied_steps_count = 1 WHERE id = @id`);
      log(`[migrate] 적용: ${m.name}`);
    }
    log(`[migrate] ${pending.length}개 적용 완료`);
    return pending.map((m) => m.name);
  } finally {
    await adapter.dispose(); // 연결을 닫으면 세션 잠금도 풀린다
  }
}

// CLI로 실행된 경우
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[migrate] DATABASE_URL이 없습니다");
    process.exit(1);
  }
  const dir = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../prisma/migrations"));
  migrate({ url, dir }).then(
    () => process.exit(0),
    (error) => {
      // 연결 문자열(비밀번호)이 섞이지 않도록 메시지만 출력한다
      console.error(`[migrate] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
