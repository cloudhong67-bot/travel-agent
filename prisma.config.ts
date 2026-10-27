import { config as loadDotenv } from "dotenv";
import { defineConfig } from "prisma/config";

loadDotenv({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // migrate diff --from-empty 처럼 DB가 필요 없는 명령도 있으므로 미설정을 허용한다.
    url: process.env.DATABASE_URL ?? "",
  },
});
