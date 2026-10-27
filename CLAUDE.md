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
| `src/server/agent` | 에이전트: `orchestrator.ts`(PRD 7장 7단계), `collect.ts`(병렬 수집), `assign.ts`(LLM 일자 배분), `plan.ts`+`optimizer.ts`(동선, 순수 함수), `validator.ts`, `budget.ts`(비용 가드), `runtime.ts`(운영 의존성·작업 시작), `memoryStore.ts`(테스트·평가용 저장소) |
| `src/server/agent/prompts` | 프롬프트 문자열. 파일 첫 줄에 `version` 주석, 수정 시 버전을 올린다 |
| `src/instrumentation.ts` | 서버 기동 시 10분 넘게 멈춘 running/queued 작업을 failed로 정리 |
| `src/server/db` | Prisma 클라이언트 싱글턴(`client.ts`)과 Repository(`tripRepo`, `cityRepo`, `usageRepo`) |
| `src/server/api` | 라우트 공용 응답 헬퍼 (`apiError`, `withErrorHandling`) |
| `src/lib` | 공용 유틸 (`env.ts`, `http.ts`, `concurrency.ts`, `schemas.ts`, `openapi.ts`, `auth.ts`, `utils.ts`) |
| `src/proxy.ts` | 접근 토큰 보호 (Next.js 16의 middleware 대체 파일) |
| `src/test` | MSW 핸들러, 유닛 setup, 통합 테스트 globalSetup(Testcontainers) |
| `prisma/` | `schema.prisma`, `migrations/` |
| `src/app/(main)` | 화면: `/`(새 여행), `/trips`(목록), `/trips/[id]`(진행·결과). `src/app/unlock`은 헤더 없는 잠금 해제 화면 |
| `src/components` | `ui/`(shadcn 생성물), `app/`(헤더·테마·Providers), `trip/`(폼·진행·결과 탭·목록), `map/`(`TripMap` → KR이면 `NaverMap`, 그 외 `GoogleMap`, 같은 props) |
| `src/lib/api-client.ts` | 브라우저 API 클라이언트. 응답은 `schemas.ts`로 검증 |
| `Dockerfile`, `docker/start.sh` | 멀티스테이지 이미지(standalone). 시작 시 `prisma migrate deploy` → `node server.js` |
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
- 스키마 변경 시 `npm run db:migrate -- --name <이름>`으로 마이그레이션을 만들고 함께 커밋한다.
- **비밀값 하드코딩 금지.** 환경변수는 `src/lib/env.ts`(`getEnv()`)로만 읽고, 새 변수는 `envSchema`와 `.env.example`에 함께 추가한다. 로그·오류 메시지에 키가 나가지 않게 한다(`redactUrl`).
- **커밋 전 `npm run lint`, `npm run typecheck`, `npm run test` 통과** (한 번에: `npm run check`).
- 모든 외부 호출은 `src/lib/http.ts`의 `fetchJson` / `withTimeoutRetry`를 거친다 (15초 타임아웃 + 1회 재시도).
  예외: LLM 호출(Gemini 생성·Google 검색 그라운딩)은 `LLM_TIMEOUT_MS`(60초) + 1회 재시도.
- 거리·시간 계산은 LLM이 아니라 지도 API 행렬과 결정론적 코드가 맡는다.
- 에이전트 규칙:
  - LLM은 주어진 POI 키(P01…)만 쓸 수 있고, 코드(`enforceAssignment`)가 다시 검증해 목록 밖 항목을 버린다.
  - 운영시간·입장료처럼 출처 데이터에 없는 값은 null. 프롬프트에 `FACT_RULES`를 넣는다.
  - 외부 호출은 `budget.ts`의 계측 래퍼를 거친다 (요청당 Gemini 15회·지도 200회, 초과 시 부분 결과 저장). 사용량은 UsageLog에 기록.
  - 오케스트레이터는 `AgentDeps`로 의존성을 주입받는다. 테스트는 MSW + `MemoryAgentStore`, 운영은 `runtime.ts`의 기본 의존성.
  - 국내(KR)는 자동차 기준 이동시간이며 결과 meta에 안내 문구를 남긴다.
- Naver Directions는 자동차 경로만 지원: driving 외 모드는 `{ supported: false }`를 반환하고 호출하지 않는다.
- Google 검색 그라운딩 결과를 화면에 보여줄 때는 `searchEntryPointHtml`(검색 추천)도 함께 표시한다 (Gemini API 약관).
- UI 규칙: 한국어, 다크 모드(next-themes), 로딩은 Skeleton·오류는 Toast(sonner), 375px에서 세로 배치. 지도 SDK의 로고·저작권 표기를 가리지 않는다.
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
