import { PrismaMssql } from "@prisma/adapter-mssql";
import { PrismaClient } from "@/generated/prisma/client";
import { pickEnv } from "@/lib/env";

export type Db = PrismaClient;
/** 트랜잭션 콜백에 넘어오는 클라이언트 (Repository 함수가 둘 다 받도록) */
export type DbTx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * @param url Prisma SQL Server 연결 문자열
 *   예: sqlserver://localhost:1433;database=trippilot;user=sa;password=...;encrypt=true;trustServerCertificate=true
 */
export function createPrismaClient(url: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaMssql(url) });
}

// 개발 서버의 HMR로 모듈이 다시 평가돼도 연결 풀이 늘어나지 않게 globalThis에 보관한다.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** 앱 전역 Prisma 클라이언트 싱글턴 (첫 호출 시 생성) */
export function getPrisma(): PrismaClient {
  globalForPrisma.prisma ??= createPrismaClient(pickEnv(["DATABASE_URL"]).DATABASE_URL);
  return globalForPrisma.prisma;
}

/** DB 연결 확인 (SELECT 1) */
export async function pingDb(db: PrismaClient = getPrisma()): Promise<void> {
  await db.$queryRaw`SELECT 1 AS ok`;
}
