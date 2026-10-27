/**
 * 빌드 결과에서 브라우저로 내려갈 수 있는 파일에 서버 전용 비밀값이 들어갔는지 검사한다.
 *   실행: npm run build && npm run check:bundle
 * 검사 대상:
 *  - .next/static/**           (클라이언트 JS·CSS 청크)
 *  - .next/server/app/**\/*.html, *.rsc, *.body  (프리렌더된 HTML·RSC 페이로드 — 그대로 브라우저로 전송됨)
 * 판정:
 *  - 서버 전용 변수의 "값"이 하나라도 나오면 실패 (exit 1)
 *  - 서버 전용 변수의 "이름"이 클라이언트 청크에 나오면 경고 (클라이언트 코드가 process.env를 참조한 흔적)
 *  - NEXT_PUBLIC_ 값이 클라이언트 청크에 있는지도 확인 (검사가 실제로 동작하는지에 대한 대조군)
 */
import { config as loadDotenv } from "dotenv";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

loadDotenv({ path: [".env.local", ".env"], quiet: true });

const SERVER_ONLY = [
  "GEMINI_API_KEY",
  "GOOGLE_MAPS_SERVER_KEY",
  "NAVER_MAPS_CLIENT_SECRET",
  "NAVER_SEARCH_CLIENT_ID",
  "NAVER_SEARCH_CLIENT_SECRET",
  "DATABASE_URL",
  "MSSQL_SA_PASSWORD",
  "APP_ACCESS_TOKEN",
] as const;
const PUBLIC = ["NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY", "NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID"] as const;

async function walk(dir: string, filter: (f: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p, filter)));
    else if (filter(p)) out.push(p);
  }
  return out;
}

async function main() {
  const staticFiles = await walk(".next/static", () => true);
  const prerendered = await walk(".next/server/app", (f) => /\.(html|rsc|body|meta)$/.test(f));
  if (staticFiles.length === 0) throw new Error(".next/static이 없습니다. 먼저 npm run build를 실행하세요.");

  const contents = new Map<string, string>();
  for (const f of [...staticFiles, ...prerendered]) contents.set(f, await readFile(f, "utf8"));

  // 비밀값 (DATABASE_URL은 안의 비밀번호도 따로 검사). 공개 Client ID와 같은 값은 비밀이 아니므로 제외
  const publicValues = new Set(PUBLIC.map((k) => process.env[k]).filter(Boolean));
  const secrets: { name: string; value: string }[] = [];
  for (const name of SERVER_ONLY) {
    const value = process.env[name];
    if (!value || value.length < 6 || publicValues.has(value)) continue;
    secrets.push({ name, value });
    const pw = name === "DATABASE_URL" ? value.match(/password=([^;]+)/i)?.[1] : undefined;
    if (pw) secrets.push({ name: "DATABASE_URL(password)", value: pw });
  }

  let leaked = 0;
  for (const { name, value } of secrets) {
    const hits = [...contents].filter(([, c]) => c.includes(value)).map(([f]) => f);
    console.log(`${hits.length ? "✗ LEAK" : "✓ 없음"}  ${name} 값 (${value.length}자)${hits.length ? ` → ${hits.join(", ")}` : ""}`);
    leaked += hits.length;
  }

  const clientChunks = [...contents].filter(([f]) => f.startsWith(path.normalize(".next/static")));
  for (const name of SERVER_ONLY) {
    const hits = clientChunks.filter(([, c]) => c.includes(name)).map(([f]) => f);
    if (hits.length) console.log(`⚠ 경고  변수 이름 ${name}이 클라이언트 청크에 있음 → ${hits.slice(0, 3).join(", ")}`);
  }
  for (const name of PUBLIC) {
    const value = process.env[name];
    const found = value ? clientChunks.some(([, c]) => c.includes(value)) : false;
    console.log(`${found ? "✓ 포함" : "· 미포함"}  ${name} 값 (공개 키 — 대조군)`);
  }

  console.log(`\n검사 파일: 클라이언트 청크 ${staticFiles.length}개, 프리렌더 페이로드 ${prerendered.length}개, 비밀값 ${secrets.length}종`);
  if (leaked) {
    console.error(`서버 전용 비밀값 ${leaked}건이 브라우저로 전송될 수 있는 파일에 포함되었습니다.`);
    process.exitCode = 1;
  } else {
    console.log("서버 전용 비밀값이 브라우저 번들·프리렌더 결과에 없습니다.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
