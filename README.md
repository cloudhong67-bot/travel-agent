# TripPilot

도시 이름 하나로 역사·관광정보·지도·일정/동선을 만들어 저장하는 개인용 AI 여행 에이전트.
요구사항은 [PRD.md](PRD.md), 개발 규칙은 [CLAUDE.md](CLAUDE.md).

## 준비물

- Node.js 22, npm
- Docker Desktop (로컬 SQL Server, 통합 테스트용 Testcontainers)

## 처음 설정

```bash
npm install                     # postinstall에서 prisma generate 실행
cp .env.example .env.local      # Windows PowerShell: Copy-Item .env.example .env.local
```

`.env.local`에 최소한 다음을 채운다.

| 변수 | 예시 |
| --- | --- |
| `MSSQL_SA_PASSWORD` | `Local_Dev_Pw_2026!` (8자 이상, 대·소문자·숫자·기호 중 3종) |
| `DATABASE_URL` | `sqlserver://localhost:1433;database=trippilot;user=sa;password=Local_Dev_Pw_2026!;encrypt=true;trustServerCertificate=true` |
| `APP_ACCESS_TOKEN` | 16자 이상 무작위 값 (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`) |

## 로컬 DB (SQL Server 2022 컨테이너)

```bash
npm run db:up        # docker compose --env-file .env.local up -d --wait (헬스체크 통과까지 대기)
npm run db:migrate   # prisma migrate dev: trippilot DB 생성 + 마이그레이션 적용
npm run dev          # http://localhost:3000 → /unlock 에서 APP_ACCESS_TOKEN 입력
npm run db:down      # 컨테이너 중지 (데이터는 mssql-data 볼륨에 유지)
```

데이터까지 지우려면 `docker compose --env-file .env.local down -v`.

## API

- OpenAPI 3.1 문서: `GET /api/v1/openapi.json` (원천: `src/lib/schemas.ts`)
- 인증: `Authorization: Bearer <APP_ACCESS_TOKEN>` 또는 `/unlock`에서 설정되는 httpOnly 쿠키
- 상태 확인(인증 없음): `GET /api/healthz` (DB 포함), `GET /api/healthz?shallow=1` (DB 미확인)

```bash
curl -X POST http://localhost:3000/api/v1/trips \
  -H "Authorization: Bearer $APP_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"city":"포르투","countryCode":"PT","days":5,"style":"역사,미식","transport":"transit"}'
curl -N http://localhost:3000/api/v1/trips/<tripId>/events -H "Authorization: Bearer $APP_ACCESS_TOKEN"
```

## 테스트

```bash
npm run lint
npm run typecheck
npm run test           # unit + integration
npm run test:unit      # MSW로 외부 API 목 처리, DB 없음
npm run test:int       # Testcontainers로 SQL Server를 띄워 Repository·라우트 검증 (Docker 필요)
npm run test:coverage  # v8 커버리지 → coverage/index.html
```

Docker가 없으면 통합 테스트는 경고와 함께 건너뛴다. CI에서는 `REQUIRE_DOCKER=1`로 실행해 건너뛰지 않고 실패하게 한다.

## 컨테이너

```bash
docker build -t trippilot:local \
  --build-arg NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=<브라우저 키> \
  --build-arg NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID=<Naver Client ID> .
# 로컬 compose DB에 연결 (컨테이너 안에서 localhost 대신 host.docker.internal)
docker run --rm -p 3200:3000 --env-file .env.local \
  -e "DATABASE_URL=sqlserver://host.docker.internal:1433;database=trippilot;user=sa;password=<pw>;encrypt=true;trustServerCertificate=true" \
  trippilot:local
curl http://localhost:3200/api/healthz
```

컨테이너는 시작할 때 `prisma migrate deploy`를 실행한 뒤 `node server.js`(Next standalone)를 띄운다. 배포·운영 절차는 [docs/RUNBOOK.md](docs/RUNBOOK.md).

## E2E (Playwright)

```bash
npx playwright install chromium   # 최초 1회
npm run db:up                     # 로컬 SQL Server
npm run test:e2e                  # 토큰 입력 → 여행 생성 → 결과 탭 스모크
npm run e2e:screens               # 화면별 스크린샷 → docs/screenshots/
```

E2E는 같은 SQL Server의 별도 DB(`trippilot_e2e`)를 매번 마이그레이션·초기화해서 쓰고, 서버를 `E2E_MOCK_EXTERNALS=1`로 띄워 Gemini·Google 지도·Naver·Wikipedia 호출을 MSW 목으로 대체한다. 브라우저 지도 SDK는 실제 공개 키로 불러온다.

## 번들 비밀값 검사

```bash
npm run build && npm run check:bundle
```

## 에이전트 평가

```bash
npm run eval                 # 파리·교토·포르투·경주·이스탄불 (실제 API, 비용 발생)
npm run eval -- 교토 경주     # 일부 도시만
```

DB 없이 메모리 저장소로 실행하고, 출처 포함 비율·검증 통과율·소요시간·추정 비용을 표로 출력한다. 상세 결과는 `eval-output/`.

## 외부 API PoC

```bash
npm run poc            # poc-output/<도시>.json
npm run poc -- 경주
```
