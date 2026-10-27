/**
 * E2E 전용 DB 준비: 로컬 SQL Server(docker compose)에 E2E_DATABASE_URL의 DB를 만들고(없으면) 마이그레이션 후 모든 테이블을 비운다.
 * playwright.config.ts가 웹서버를 띄우기 전에 실행한다. 개발 DB의 데이터·도시 캐시가 테스트에 섞이지 않게 한다.
 */
import { execSync } from "node:child_process";
import { createPrismaClient } from "@/server/db/client";

async function main() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL이 필요합니다");
  const name = url.match(/database=([^;]+)/i)?.[1];
  if (!name || !/^[\w-]+$/.test(name)) throw new Error("E2E_DATABASE_URL의 database 이름이 올바르지 않습니다");

  const master = createPrismaClient(url.replace(/database=[^;]+/i, "database=master"));
  await master.$executeRawUnsafe(`IF DB_ID('${name}') IS NULL CREATE DATABASE [${name}]`);
  await master.$disconnect();

  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });

  const db = createPrismaClient(url);
  await db.$transaction([
    db.tripDay.deleteMany(),
    db.nearbyTown.deleteMany(),
    db.trip.deleteMany(),
    db.poi.deleteMany(),
    db.city.deleteMany(),
    db.usageLog.deleteMany(),
  ]);
  await db.$disconnect();
  console.log(`[e2e] ${name} 준비 완료`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
