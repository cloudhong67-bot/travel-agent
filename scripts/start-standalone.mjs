// 로컬에서 운영과 같은 방식(Next standalone server.js)으로 서버를 띄운다. E2E(playwright.config.ts)가 사용한다.
// Dockerfile처럼 public·.next/static을 standalone 폴더에 복사한 뒤 server.js를 실행한다.
import { cpSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const standalone = path.resolve(".next/standalone");
if (!existsSync(path.join(standalone, "server.js"))) {
  console.error(".next/standalone/server.js가 없습니다. 먼저 npm run build를 실행하세요.");
  process.exit(1);
}
cpSync("public", path.join(standalone, "public"), { recursive: true });
cpSync(".next/static", path.join(standalone, ".next/static"), { recursive: true });

const child = spawn(process.execPath, ["server.js"], {
  cwd: standalone,
  stdio: "inherit",
  env: { ...process.env, HOSTNAME: process.env.HOSTNAME ?? "127.0.0.1" },
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
