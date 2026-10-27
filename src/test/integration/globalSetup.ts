/**
 * 통합 테스트용 SQL Server 2022 컨테이너 (Testcontainers).
 * 컨테이너 1개를 띄워 테스트 DB를 만들고 `prisma migrate deploy`로 실제 마이그레이션을 적용한다.
 * Docker를 쓸 수 없으면 dbUrl을 빈 값으로 넘겨 통합 테스트를 건너뛴다 (CI에서는 REQUIRE_DOCKER=1로 실패 처리).
 */
import { execSync } from "node:child_process";
import { MSSQLServerContainer, type StartedMSSQLServerContainer } from "@testcontainers/mssqlserver";
import type { TestProject } from "vitest/node";
import { createPrismaClient } from "@/server/db/client";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
  }
}

const IMAGE = "mcr.microsoft.com/mssql/server:2022-latest";
const TEST_DB = "trippilot_test";

const prismaUrl = (c: StartedMSSQLServerContainer, database: string) =>
  `sqlserver://${c.getHost()}:${c.getPort()};database=${database};user=${c.getUsername()};password=${c.getPassword()};encrypt=true;trustServerCertificate=true`;

export default async function setup(project: TestProject) {
  let container: StartedMSSQLServerContainer;
  try {
    container = await new MSSQLServerContainer(IMAGE).acceptLicense().start();
  } catch (error) {
    if (process.env.REQUIRE_DOCKER === "1") throw error;
    console.warn(`\n[integration] Docker를 사용할 수 없어 통합 테스트를 건너뜁니다: ${(error as Error).message}\n`);
    project.provide("dbUrl", "");
    return;
  }

  const master = createPrismaClient(prismaUrl(container, "master"));
  await master.$executeRawUnsafe(`CREATE DATABASE [${TEST_DB}]`);
  await master.$disconnect();

  const url = prismaUrl(container, TEST_DB);
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });

  project.provide("dbUrl", url);
  return async () => {
    await container.stop();
  };
}
