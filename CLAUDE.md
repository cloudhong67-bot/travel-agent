@AGENTS.md

# TripPilot — 여행 도시 맞춤형 AI 에이전트

요구사항 원본은 `PRD.md`. 구현은 PRD 10장 로드맵 단계별로 진행한다.

## 기술 스택

- Node.js 22, npm
- Next.js 16 (App Router, TypeScript strict, `src/` 디렉터리, standalone 빌드 예정)
- Tailwind CSS v4 + shadcn/ui (`components.json`)
- Zod v4 (입력 검증), Vitest (단위·통합 테스트), tsx (스크립트 실행)
- LLM: `@google/genai` (Gemini 3.8 Flash, 함수 호출)
- 웹 검색: Gemini 내장 Google 검색 그라운딩 (`googleSearch` 도구, 같은 `GEMINI_API_KEY`). Microsoft Foundry는 쓰지 않는다
- 지도: Google Maps Platform(해외) / Naver Cloud Platform Maps(국내) — REST 직접 호출
- DB: Prisma 7 + Azure SQL Database(서버리스) / 로컬은 docker-compose SQL Server 2022
  - Prisma 7: 연결 URL은 `prisma.config.ts`, 런타임은 `@prisma/adapter-mssql` 드라이버 어댑터. 클라이언트는 `src/generated/prisma`에 생성(커밋 안 함, postinstall)
- API 문서: `@asteasolutions/zod-to-openapi` (Zod v4 `.meta({ id })`) → `/api/v1/openapi.json`
- 테스트: Vitest(unit / integration 프로젝트), MSW 3(외부 API 목), Testcontainers(SQL Server), v8 커버리지

## 디렉터리 규칙

| 경로 | 용도 |
| --- | --- |
| `src/app` | App Router 페이지·레이아웃·Route Handler(`/api/v1/...`). 비즈니스 로직을 직접 두지 않는다 |
| `src/server/adapters` | 외부 서비스 어댑터. 인터페이스(`types.ts`) + 공급자별 구현. 다른 서버 코드는 인터페이스에만 의존 |
| `src/server/adapters/llm` | `LlmProvider` / `gemini.ts` |
| `src/server/adapters/search` | `WebSearchProvider` / `geminiGoogleSearch.ts` (출처는 `groundingMetadata`에서 추출) |
| `src/server/adapters/maps` | `MapsProvider` / `google.ts`, `naver.ts`, `index.ts`(`getMapsProvider(countryCode)`: KR→naver, 그 외→google) |
| `src/server/adapters/knowledge` | Wikipedia/Wikivoyage 요약 |
| `src/server/agent` | 에이전트: `orchestrator.ts`(PRD 7장 7단계 파이프라인 순서만), `job.ts`(`AgentJob`: 진행 기록·단계 span·사용량·완료/부분/실패 처리), `collect.ts`(병렬 수집), `assign.ts`(LLM 일자 배분 + 실패 시 `fallbackAssignment`), `plan.ts`+`optimizer.ts`(동선, 순수 함수), `stay.ts`(추천 체류 일수, 순수 함수), `validator.ts`, `budget.ts`(비용 가드), `runtime.ts`(운영 의존성·작업 시작), `memoryStore.ts`(테스트·평가용 저장소) |
| `src/server/agent/prompts` | 프롬프트 문자열. 파일 첫 줄에 `version` 주석, 수정 시 버전을 올린다 |
| `src/instrumentation.ts` | 서버 기동 시 10분 넘게 멈춘 running/queued 작업을 failed로 정리 |
| `src/server/db` | Prisma 클라이언트 싱글턴(`client.ts`)과 Repository(`tripRepo`, `cityRepo`, `usageRepo`) |
| `src/server/api` | 라우트 공용 응답 헬퍼 (`apiError`, `parseInput`/`ApiProblem`, `withErrorHandling`) |
| `src/lib` | 공용 유틸 (`env.ts`, `http.ts`, `concurrency.ts`, `schemas.ts`, `openapi.ts`, `auth.ts`, `url.ts`(호스트명·안전한 링크), `hours.ts`(요일·운영시간·휴무 요일의 단일 원천), `utils.ts`) |
| `src/proxy.ts` | 접근 토큰 보호 (Next.js 16의 middleware 대체 파일) |
| `src/test` | MSW 핸들러, 유닛 setup, 통합 테스트 globalSetup(Testcontainers) |
| `prisma/` | `schema.prisma`, `migrations/` |
| `src/app/(main)` | 화면: `/`(새 여행), `/trips`(목록), `/trips/[id]`(진행·결과). `src/app/unlock`은 헤더 없는 잠금 해제 화면 |
| `src/components` | `ui/`(shadcn 생성물), `app/`(헤더·테마·Providers), `trip/`(폼·진행·결과 탭·목록), `map/`(`TripMap` → KR이면 `NaverMap`, 그 외 `GoogleMap`, 같은 props) |
| `src/lib/api-client.ts` | 브라우저 API 클라이언트. 응답은 `schemas.ts`로 검증, 30초 타임아웃 |
| `src/app/(main)/error.tsx`, `src/app/global-error.tsx` | 화면 렌더링 오류의 대체 UI (Next 16: props는 `error: unknown`, `retry`) |
| `Dockerfile`, `docker/start.sh` | 멀티스테이지 이미지(standalone). 시작 시 `scripts/migrate.mjs`(마이그레이션) → `node server.js` |
| `scripts/migrate.mjs` | 경량 마이그레이션 실행기 (`prisma migrate deploy` 대체, Prisma CLI 없이 앱의 mssql 어댑터 사용). `_prisma_migrations`·체크섬을 Prisma와 같게 기록. 통합 테스트·E2E DB 준비도 이것을 쓴다 |
| `infra/` | Bicep(구독 범위 `main.bicep` + `modules/app.bicep`), 매개변수는 `main.bicepparam`이 환경변수에서만 읽음 |
| `.github/workflows/` | `ci.yml`(PR), `deploy.yml`(main → ACA), `infra.yml`(what-if → 승인 → 배포) |
| `docs/RUNBOOK.md` | 최초 설정·롤백·비용·비밀값 교체 절차 |
| `src/server/telemetry.ts` | OpenTelemetry span 헬퍼. 연결 문자열이 있으면 instrumentation.ts가 Azure Monitor로 내보냄 |
| `e2e/` | Playwright 스모크·스크린샷 (로컬 SQL Server의 `trippilot_e2e` + 외부 API는 서버 내 MSW, `E2E_MOCK_EXTERNALS=1`) |
| `scripts` | 일회성·운영 스크립트 (`poc.ts`) |

- `src/server/**`는 서버 전용이다. 클라이언트 컴포넌트에서 import 금지.
- 라우트(`src/app/api/**/route.ts`)는 Prisma를 직접 호출하지 않고 `@/server/db`의 Repository만 쓴다.
- 테스트 파일은 대상 옆에 둔다: 단위 `*.test.ts`, DB가 필요한 통합 `*.int.test.ts`.

## 확정 결정사항 (PRD 1장, 2026-10-27)

| 항목 | 결정 |
| --- | --- |
| 사용자 범위 | 본인 전용, 로그인 없음 (공개 URL은 IP 허용 목록·접근 토큰으로 보호) |
| LLM | Google Gemini 3.8 Flash (`gemini-3.8-flash`) |
| 웹 그라운딩 | Gemini 내장 Google 검색 그라운딩 (Microsoft Foundry 미사용) |
| 지도 | 해외 Google Maps Platform, 국내 Naver 지도(NCP Maps) |
| 운영비 상한 | 월 5만 원 |
| ACA 최소 복제본 | 0 |
| 비밀 관리 | Key Vault 미사용, GitHub Secrets → ACA Secret |

## 코딩 규칙

- **외부 입력은 모두 Zod로 검증한다.** 요청 바디·쿼리·환경변수·외부 API 응답·LLM 출력 모두 해당.
- **API 스키마의 단일 원천은 `src/lib/schemas.ts`.** 엔드포인트를 추가·변경하면 `src/lib/openapi.ts`에도 등록한다.
- API 응답의 날짜는 ISO 8601 문자열, 오류는 항상 `{ code, message }` (`src/server/api/respond.ts`). 내부 예외 메시지는 노출하지 않는다.
- "오늘"(하루 생성 한도·사용량 집계)은 Asia/Seoul 날짜 기준 (`src/server/limits.ts`).
- 스키마 변경 시 `npm run db:migrate -- --name <이름>`으로 마이그레이션을 만들고 함께 커밋한다. 운영 적용은 `scripts/migrate.mjs`가 하므로 마이그레이션은 Prisma가 생성한 단일 배치 SQL 그대로 둔다 (`GO` 구분자 금지).
- `DATABASE_URL`에 `connectTimeout`을 넣지 않는다 (`@prisma/adapter-mssql`이 밀리초로 해석).
- **비밀값 하드코딩 금지.** 환경변수는 `src/lib/env.ts`(`getEnv()`)로만 읽고, 새 변수는 `envSchema`와 `.env.example`에 함께 추가한다. 로그·오류 메시지에 키가 나가지 않게 한다(`redactUrl`).
- **커밋 전 `npm run lint`, `npm run typecheck`, `npm run test` 통과** (한 번에: `npm run check`).
- 모든 외부 호출은 `src/lib/http.ts`의 `fetchJson` / `withTimeoutRetry`를 거친다 (15초 타임아웃 + 1회 재시도). 재시도는 네트워크·시간 초과(`TimeoutError`)·408/429/5xx만 (`isRetryable`) — 4xx·응답 형식 오류는 반복해도 같으므로 재시도하지 않는다.
  예외: LLM 호출(Gemini 생성·Google 검색 그라운딩)은 `LLM_TIMEOUT_MS`(60초) + 1회 재시도.
- 라우트는 `withErrorHandling`으로 감싸고, 입력 검증은 `parseInput(schema, value)`(실패 시 400 `ApiProblem`)로 한다. 오류 응답은 proxy를 포함해 모두 `apiError`로 만든다.
- 장애 대응 원칙: 보조 단계는 실패해도 일정을 만든다 — 수집 실패는 경고, LLM 배분 실패는 `fallbackAssignment`(거리 기준), 이동시간 행렬 실패는 직선거리 추정, 진행 기록은 연속 3회 실패까지 무시. 단 `BudgetExceededError`는 대체하지 않고 부분 저장으로 보낸다.
- 거리·시간 계산은 LLM이 아니라 지도 API 행렬과 결정론적 코드가 맡는다.
- 에이전트 규칙:
  - LLM은 주어진 POI 키(P01…)만 쓸 수 있고, 코드(`enforceAssignment`)가 다시 검증해 목록 밖 항목을 버린다.
  - 운영시간·입장료처럼 출처 데이터에 없는 값은 null. 프롬프트에 `FACT_RULES`를 넣는다.
  - 예외: 배경지식(역사·문화·기후·매너)은 원문에 없으면 Gemini 일반 지식으로 채우되 `aiFields`에 표시하고 화면에 "AI 요약 정보"로 구분한다 (`NO_FABRICATION_RULES`는 그대로 적용). 원문이 없을 때는 코드가 채운 항목 전부를 AI로 표시한다.
  - 관광청: 공식 관광청 검색 → 공식 사이트가 없거나 추천 명소가 2곳 미만이면 대체 출처(위키여행·지자체·여행 플랫폼) 검색을 합친다 → 검색이 모두 실패하면 위키여행 요약. `TourismInfo.sourceType`으로 구분.
  - 추천 체류 일수는 LLM이 아니라 `recommendStay`(명소·박물관 수 ÷ 하루 4곳 + 근교 당일치기 1일)가 정한다. `autoDays`면 그 일수로 생성, 일정 조정(`/reschedule`)은 도시 정보를 재사용해 4~6단계만 다시 돌고 새 일정이 완성될 때만 일수·일자를 바꾼다.
  - 외부 호출은 `budget.ts`의 계측 래퍼를 거친다 (요청당 Gemini 15회·지도 200회, 초과 시 부분 결과 저장). 사용량은 UsageLog에 기록.
  - 오케스트레이터는 `AgentDeps`로 의존성을 주입받는다. 테스트는 MSW + `MemoryAgentStore`, 운영은 `runtime.ts`의 기본 의존성.
  - 국내(KR)는 자동차 기준 이동시간이며 결과 meta에 안내 문구를 남긴다.
- Naver Directions는 자동차 경로만 지원: driving 외 모드는 `{ supported: false }`를 반환하고 호출하지 않는다.
- Google 검색 그라운딩 결과를 화면에 보여줄 때는 `searchEntryPointHtml`(검색 추천)도 함께 표시한다 (Gemini API 약관).
- UI 규칙: 한국어, 다크 모드(next-themes), 로딩은 Skeleton·오류는 Toast(sonner), 375px에서 세로 배치. 지도 SDK의 로고·저작권 표기를 가리지 않는다.
- 보안: `proxy.ts`가 토큰 검사와 CSRF 차단(`isCrossOriginWrite`: 다른 출처의 POST·DELETE 등은 403)을 맡는다. matcher의 `/api/:path*`는 지우지 않는다 (확장자 제외 패턴만 있으면 `/api/...x.png`가 검사 없이 통과). 외부 데이터 URL을 링크로 쓸 때는 `safeExternalUrl`(http/https만). 보안 헤더는 `next.config.ts`의 `securityHeaders`.
- 리다이렉트 `Location`은 상대 경로로 보낸다. standalone 서버의 `request.url`은 바인딩 주소(`0.0.0.0:3000`)라 절대 URL을 만들면 프록시·포트 매핑 뒤에서 깨진다.
- 배포 규칙: 워크플로·Bicep·코드에 비밀값을 쓰지 않는다 (예시는 `<placeholder>`). 비밀값은 GitHub Environment Secrets → Container App secret(`secretref:`)으로만 흐른다. 새 비밀값을 추가하면 `deploy.yml`·`infra/modules/app.bicep`·`export-current-app-state.sh`·RUNBOOK을 함께 고친다.
- Bicep을 고치면 `bicep build infra/main.bicep`과 `bicep lint`로 확인한다. 워크플로는 actionlint로 확인한다.
- 클라이언트 코드에서 서버 전용 env를 참조하지 않는다. 빌드 후 `npm run check:bundle`로 번들에 비밀값이 없는지 확인한다.
- 폼은 react-hook-form + shadcn `Field` + 서버와 같은 Zod 스키마(`CreateTripRequestSchema`)를 재사용한다.
- Next.js 16은 학습 데이터와 다를 수 있다. 라우팅·캐시 등 프레임워크 API는 `node_modules/next/dist/docs/`를 먼저 확인한다.

## 명령어

```bash
npm run dev            # 개발 서버
npm run db:up          # 로컬 SQL Server 컨테이너 (docker compose)
npm run db:migrate     # prisma migrate dev
npm run local:up       # 운영 이미지 + SQL Server를 docker compose로 (http://localhost:3300, 실제 API)
npm run local:up:mock  # 같은 구성 + 외부 API 목 (포르투·경주, DB trippilot_mock)
npm run local:down     # 로컬 구성 중지
npm run check          # lint + typecheck + test
npm run test:unit      # 단위 (MSW, DB 없음)
npm run test:int       # 통합 (Testcontainers, Docker 필요)
npm run test:coverage  # v8 커버리지
npm run test:e2e       # Playwright 스모크 (사전: npm run db:up)
npm run e2e:screens    # 화면별 스크린샷 → docs/screenshots/
npm run check:bundle   # 빌드 결과에 서버 비밀값이 없는지 검사 (npm run build 후)
npm run poc            # 외부 API PoC (poc-output/<도시>.json)
npm run eval           # 에이전트 평가 5개 도시, 실제 API·비용 발생 (eval-output/)
```
