import { config as loadDotenv } from "dotenv";

loadDotenv({ path: [".env.local", ".env"], quiet: true });

export function withDatabase(url: string, database: string): string {
  return /database=[^;]+/i.test(url) ? url.replace(/database=[^;]+/i, `database=${database}`) : `${url};database=${database}`;
}

const base = process.env.DATABASE_URL;
if (!base) throw new Error("E2E: .env.local에 DATABASE_URL(로컬 docker compose SQL Server)이 필요합니다.");

/** 개발 DB와 같은 서버의 E2E 전용 데이터베이스 */
export const E2E_DATABASE_URL = withDatabase(base, "trippilot_e2e");
