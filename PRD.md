# PRD - 여행 도시 맞춤형 AI 에이전트 (Azure Container Apps 배포)

Oct 27, 2026 · @홍정규

## 1. 개요

구현용 단계별 프롬프트: Claude Code 프롬프트

도시 이름 하나를 입력하면 역사·배경, 관광정보, 지도, 관광청 정보, 주변 소도시까지 포함한 여행 일정과 동선을 생성하고 Azure DB에 저장하는 개인용 AI 에이전트를 만든다. 애플리케이션은 컨테이너로 패키징해 GitHub에서 관리하고 Azure Container Apps(ACA)에 자동 배포한다.

| 항목 | 내용 |
| --- | --- |
| 프로젝트명 | 여행 도시 맞춤형 AI 에이전트 개발 및 Azure 배포 (가칭: TripPilot) |
| 성격 | 개인 학습 겸 포트폴리오 프로젝트 (1인 개발, Claude Code 바이브 코딩 활용) |
| 범위(In) | 도시 입력 → 정보 수집 → 일정·동선 생성 → 저장/조회, 컨테이너화, CI/CD, ACA 배포 |
| 범위(Out) | 항공·숙소 예약/결제, 로그인·다중 사용자, SaaS 과금, 모바일 네이티브 앱 |

**확정 결정사항 (2026-10-27)**

| 항목 | 결정 |
| --- | --- |
| 사용자 범위 | 본인 전용, 로그인 없음 (공개 URL은 IP 허용 목록·접근 토큰으로 보호) |
| LLM | Google Gemini 3.8 Flash (`gemini-3.8-flash`) |
| 웹 그라운딩 | Gemini 내장 Google 검색 그라운딩 (Microsoft Foundry 미사용) |
| 지도 | 해외 Google Maps Platform, 국내 Naver 지도(NCP Maps) |
| 운영비 상한 | 월 5만 원 |
| ACA 최소 복제본 | 0 |
| 비밀 관리 | Key Vault 미사용, GitHub Secrets → ACA Secret |

**용어**

- 에이전트: LLM이 도구(검색, 지도, DB)를 스스로 골라 호출하며 답을 만드는 프로그램
- Itinerary: 일자별 방문지·시간·이동수단을 담은 여행 일정
- 거점 도시 / 근교 소도시: 숙박 기준 도시와 당일치기·1박 이동 가능한 주변 도시
- ACA: Azure Container Apps, 서버리스 컨테이너 실행 서비스

## 2. 문제 정의와 목표

여행 준비 시 역사 배경, 관광청 정보, 지도, 근교 동선을 각각 다른 사이트에서 찾아 직접 엮어야 한다. 이 에이전트는 그 조사·정리 작업을 한 번의 입력으로 끝내고, 결과를 다시 꺼내 쓸 수 있게 저장한다.

**목표**

1. 도시 입력 후 3분 이내에 "배경지식 + 관광정보 + 지도 + 일정·동선" 한 세트를 받는다.
2. 생성된 정보에는 관광청 등 출처 링크가 붙어 있어 검증할 수 있다.
3. 코드 푸시만으로 ACA까지 자동 배포되는 파이프라인을 갖춘다 (Azure 실무 레퍼런스로 활용).

**성공 지표 (MVP 기준)**

| 지표 | 목표치 |
| --- | --- |
| 일정 생성 완료 시간 (P90) | 180초 이하 |
| 관광 명소 항목 중 출처 링크 포함 비율 | 90% 이상 |
| 일정 내 이동 경로 계산 성공률 | 95% 이상 |
| main 푸시 → ACA 반영 시간 | 15분 이하 |
| 단위·통합 테스트 커버리지 | 70% 이상 |
| 월 운영비 (개인 사용) | 5만 원 이하 (상한 확정) |

## 3. 대상 사용자와 시나리오

1차 사용자는 본인(개인 여행자)이며, 이후 가족·지인 공유를 고려한다.

**페르소나**: 50대 직장인, 연 1\~2회 해외 자유여행, 역사·문화 배경을 알고 가는 여행을 선호, 렌터카·대중교통 혼용.

**핵심 시나리오**

1. "포르투"를 입력하고 일수(5일), 여행 스타일(역사·미식), 이동수단(대중교통)을 고른다.
2. 에이전트가 도시 역사·배경, 주요 명소, 포르투갈 관광청 링크를 수집해 요약한다.
3. 지도에 명소와 숙소 거점이 표시되고, 일자별 일정과 동선이 생성된다.
4. 근교 소도시(예: 브라가, 기마랑이스)가 당일치기 일정으로 추천된다.
5. 결과를 저장하고, 나중에 목록에서 다시 열어 일정을 수정·재생성한다.

**사용자 스토리**

- 여행자로서, 도시 이름만 넣고도 배경지식을 한 페이지로 읽고 싶다.
- 여행자로서, 하루 동선이 지도 위에 순서대로 보이길 원한다.
- 여행자로서, 정보가 어디서 왔는지 출처를 확인하고 싶다.
- 여행자로서, 지난번 만든 일정을 다시 불러와 일부만 바꾸고 싶다.

## 4. 기능 요구사항 (FR)

| ID | 기능 | 설명 | 우선순위 |
| --- | --- | --- | --- |
| FR-01 | 여행 조건 입력 | 도시명(필수), 일수, 출발일, 여행 스타일, 이동수단, 예산 수준 입력. 동명 도시는 국가 선택으로 확정 | Must |
| FR-02 | 도시 식별·지오코딩 | 도시명을 좌표·국가코드로 변환 (해외 Google, 국내 Naver Geocoding) | Must |
| FR-03 | 역사·배경지식 | 도시 역사, 문화, 기후·최적 시기, 기본 매너를 요약 (출처 표기) | Must |
| FR-04 | 관광청 조사 | 해당 국가·도시 공식 관광청 사이트를 찾아 명소·축제·교통패스 정보 추출 | Must |
| FR-05 | 관광 명소(POI) 수집 | 명소, 박물관, 맛집 후보 수집 및 운영시간·위치 정규화 | Must |
| FR-06 | 근교 소도시 추천 | 거점 기준 이동 2시간 이내 소도시 2\~5곳 추천, 당일치기/1박 구분 | Must |
| FR-07 | 일정(Itinerary) 생성 | 일자별 방문지·시간대·체류시간 배치, 운영시간·휴무일 반영 | Must |
| FR-08 | 동선 최적화 | 일자 내 방문 순서를 이동시간 기준으로 최적화, 경로·소요시간 표시 | Must |
| FR-09 | 지도 시각화 | 명소 마커, 일자별 경로선, 근교 도시 표시 (해외 Google Maps JS, 국내 Naver Web Dynamic Map) | Must |
| FR-10 | 결과 저장·조회 | 생성 결과를 DB에 저장, 목록·상세 조회, 삭제 | Must |
| FR-11 | 일정 재생성·수정 | 특정 일자만 재생성, 명소 추가/제외 후 재계산 | Should |
| FR-12 | 진행 상황 스트리밍 | "관광청 조사 중" 등 단계별 진행을 화면에 실시간 표시 | Should |
| FR-13 | 캐시 | 동일 도시 기초정보는 일정 기간 캐시해 비용·시간 절감 | Should |
| FR-14 | 내보내기 | PDF/Markdown 내보내기, 공유 링크 | Could |
| FR-15 | 로그인 | MVP 제외. 본인 전용으로 로그인 없이 운영하고 접근 보호(NFR 보안)로 대체 | Won't (MVP) |

**수용 기준 예시 (FR-07, FR-08)**

- 하루 일정의 이동시간 합계가 체류시간 합계의 40%를 넘지 않는다.
- 휴무일인 명소는 해당 요일에 배치되지 않는다.
- 모든 방문지는 좌표를 가지며 지도에 표시된다.

## 5. 비기능 요구사항 (NFR)

| 구분 | 요구사항 |
| --- | --- |
| 성능 | 일정 생성 P90 180초 이하, 저장된 일정 조회 2초 이하 |
| 가용성 | 개인용 99% 수준. ACA 최소 복제본 0 (유휴 시 비용 최소화, 첫 요청 콜드스타트 감수) |
| 확장성 | ACA HTTP 동시요청 기반 자동 확장, 최대 3 복제본 |
| 보안 | Key Vault 미사용. 비밀값은 GitHub Secrets에 두고 배포 시 ACA Secret으로 주입. 로그인이 없으므로 ACA IP 허용 목록 + 접근 토큰으로 공개 URL 보호. 코드·이미지에 키 포함 금지 |
| 정확성 | LLM 생성 사실은 출처 URL과 함께 저장, 출처 없는 항목은 "검증 필요" 표시 |
| 관측성 | Application Insights(OpenTelemetry)로 요청·에이전트 단계·외부 API 호출 추적, LLM 토큰 사용량 기록 |
| 비용 | 월 5만 원 상한: Azure 예산 알림(80%·100%), Gemini·Google Maps 일일 쿼터, 요청당 토큰·도구 호출 상한, 하루 생성 횟수 제한 |
| 품질 | Vitest 커버리지 70% 이상, PR마다 lint·타입체크·테스트 통과 필수 |
| 규정 | 외부 사이트 수집 시 robots.txt·이용약관 준수, 지도 API 라이선스(표시 의무) 준수 |

## 6. 기술요소 검토 결과와 아키텍처

원안의 기술요소는 대부분 적정하나, **DB는 Cosmos DB 대신 Azure SQL Database(서버리스)로 확정**하고, 원안에 빠진 **LLM·웹검색·지도 서비스, 관측성, 인증(OIDC/Managed Identity)** 을 추가한다. Prisma는 Azure SQL은 공식 지원하지만 Cosmos DB는 지원 목록에 없고, Cosmos DB for MongoDB 경유 시 미지원 명령 오류 사례가 보고되어 있다.

| 영역 | 원안 | 검토 의견 | 확정안 |
| --- | --- | --- | --- |
| 프론트/백엔드 | Next.js + Tailwind + shadcn/ui | 적정. App Router의 Route Handler로 API까지 한 컨테이너에 통합 가능 | Next.js(App Router, standalone 빌드) + Tailwind + shadcn/ui |
| LLM | (누락) | 에이전트의 두뇌 정의 필요 | **Gemini 3.8 Flash** (`@google/genai` SDK, 함수 호출). 사고 수준은 기본 low, 일자 배분 단계만 medium |
| 에이전트 프레임워크 | (누락) | TypeScript 단일 스택이 1인 개발에 유리 | Gemini 함수 호출 루프를 직접 구현(얇은 오케스트레이터, 외부 프레임워크 없음) |
| 관광청·웹 조사 | 외부 관광청 데이터 연동 | 관광청 공개 API가 거의 없어 웹 검색 그라운딩 필요. 별도 검색 서비스 없이 Gemini에 내장된 Google 검색 그라운딩이 가장 단순 | **Gemini Google 검색 그라운딩**(`google_search` 도구). 응답의 groundingMetadata에서 출처 URL 추출. 한국 도시는 한국관광공사 TourAPI 병행 |
| 역사·배경 | (명시 없음) | 출처 확보가 쉬운 백과 데이터가 정확도에 유리 | Wikipedia/Wikivoyage API를 1차 소스로, LLM은 요약만 |
| 지도·동선 | 지도 API | 국내는 Google 경로 품질에 한계 | **해외 Google Maps Platform**(Geocoding, Places, Routes, Maps JS) / **국내 Naver 지도**(NCP Maps: Geocoding, Directions 5·15, Web Dynamic Map). 국가코드로 어댑터 분기 |
| DB/ORM | Prisma + Cosmos DB 또는 Azure SQL | Cosmos DB는 Prisma 공식 미지원 | **Prisma + Azure SQL Database(서버리스, 자동 일시중지)** |
| API/테스트 | OpenAPI + Vitest | 적정. Zod 스키마에서 OpenAPI 문서 자동 생성 권장. E2E 1\~2개 추가 | Zod + zod-to-openapi, Vitest(단위·통합), Playwright(E2E 스모크) |
| 컨테이너 | 멀티스테이지 Dockerfile | 적정. Next.js standalone 출력으로 이미지 경량화 | node:22-alpine 기반 3단계 빌드, non-root 실행, 시작 시 prisma migrate deploy |
| CI/CD | GitHub Actions → ACR | 적정. Azure 인증은 비밀키 대신 OIDC 페더레이션 권장 | GitHub Actions + OIDC(azure/login) → ACR 빌드·푸시 → ACA 업데이트 |
| 배포 | ACA 롤링 업데이트 | ACA는 리비전 단위로 무중단 교체 | 단일 리비전 모드, **최소 복제본 0**, 최대 3 |
| 비밀 관리 | Key Vault 또는 ACA Secret 검토 | 개인 프로젝트 규모는 ACA Secret만으로 충분 | **Key Vault 미사용.** GitHub Secrets → 배포 시 ACA Secret 등록 → `secretref:` 환경변수 |
| 관측성 | (누락) | 에이전트 단계별 실패 지점 추적 필요 | Application Insights + Log Analytics, OpenTelemetry |
| IaC | (누락) | 재현 가능한 인프라 구성 | Bicep으로 RG·ACR·ACA·SQL·App Insights·예산 정의 |
| 비용 | (누락) | 상한 월 5만 원 | 예산 알림, 외부 API 일일 쿼터, 도시 정보 캐시, 하루 생성 횟수 제한 |

&#91;embedded content: 목표 아키텍처 · 컨테이너 1개 + Azure 서비스 7개\]

앱은 컨테이너 하나로 단순하게 유지하고, 에이전트는 오른쪽 서비스들을 도구로 호출한다. 배포는 GitHub Actions가 ACR에 이미지를 올리면 ACA가 Managed Identity로 가져와 새 리비전을 띄운다.

참고: AI 계층(LLM·웹 검색)은 Gemini API 키 하나로 처리하고, Azure는 실행·데이터·배포 인프라만 맡는다. Google 검색 그라운딩은 무료 한도를 넘으면 별도 과금되므로 요금 페이지에서 조건을 확인한다. Gemini 3.8 Flash는 2026년 말까지 프로모션 단가가 적용되므로 2027년 초 비용을 재산정한다. ([Prisma 지원 DB](https://www.prisma.io/docs/orm/v6/reference/supported-databases), [Prisma–Cosmos DB 이슈](https://github.com/prisma/prisma/discussions/24244), [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [Naver Maps 개요](https://guide.ncloud-docs.com/docs/maps-overview), [Google Maps Platform 요금](https://developers.google.cn/maps/billing-and-pricing/pricing?hl=en))

## 7. 에이전트 파이프라인 설계

파이프라인은 "수집은 병렬, 일정 생성은 순차"로 구성하고, 동선 순서는 LLM이 아니라 지도 API의 이동시간 행렬로 계산한다. LLM은 조사·요약·일자 배분을 맡고, 거리·시간 계산은 결정론적 코드가 맡아 환각을 줄인다.

1. **입력 정규화**: 도시명 → Google Geocoding → 좌표·국가코드 확정 (동명 도시면 사용자 선택). 국가코드 KR이면 이후 지도 호출은 Naver 어댑터로 분기
2. **캐시 확인**: 같은 도시의 기초정보(역사·관광청·POI)가 30일 이내 저장돼 있으면 재사용
3. **병렬 수집** (도구 호출)
   - 역사·배경: Wikipedia/Wikivoyage 요약 → LLM 정리
   - 관광청: Gemini Google 검색 그라운딩으로 국가·도시 공식 관광청 URL 식별 → 화이트리스트 도메인에서 명소·축제·교통패스 추출
   - POI: Google Places(국내는 Naver 검색 API 지역) + 관광청 추천 명소 병합, 중복 제거
   - 근교 소도시: 거점 반경 150km 내 도시 후보 → 이동시간 행렬(Google Routes, 국내 Naver Directions)로 2시간 이내만 필터 → LLM이 테마 적합도로 2\~5곳 선정
4. **일자 배분 (LLM)**: 여행일수·스타일·운영시간을 근거로 POI를 일자별로 클러스터링, 근교 도시는 별도 일자 배정
5. **동선 최적화 (코드)**: 일자별 POI의 이동시간 행렬 → 최근접 이웃 + 2-opt로 방문 순서 결정 → Google Routes(국내 Naver Directions 15)로 경로선 생성
6. **검증**: 휴무일 충돌, 하루 이동시간 비율 40% 초과, 좌표 누락, 출처 누락 검사 → 실패 항목만 4\~5단계 재시도(최대 2회)
7. **저장·응답**: 결과를 Azure SQL에 저장하고, 단계별 진행 상황은 SSE로 화면에 스트리밍

**에이전트 도구 목록**

| 도구 | 역할 | 외부 서비스 |
| --- | --- | --- |
| geocodeCity | 도시 좌표·국가 확정 | Google Geocoding (국내 Naver Geocoding) |
| getCityBackground | 역사·배경 원문 확보 | Wikipedia/Wikivoyage API |
| findTourismBoard | 관광청 사이트 식별·정보 추출 | Gemini Google 검색 그라운딩 |
| searchPOI | 명소·식당 검색 | Google Places API (국내 Naver 검색 API 지역) |
| findNearbyTowns | 근교 소도시 후보·이동시간 | Google Places + Routes 행렬 / Naver Directions |
| optimizeRoute | 일자별 방문 순서 계산 | 자체 코드 + 이동시간 행렬 |
| getRouteGeometry | 지도 경로선 | Google Routes API / Naver Directions 15 |
| saveTrip / loadTrip | 결과 저장·조회 | Azure SQL (Prisma) |

## 8. 데이터 모델과 API 설계

데이터는 "도시 기초정보(공유·캐시)"와 "사용자 여행계획(개인)"을 분리한다. 가변 구조인 LLM 결과(요약, 명소 상세)는 JSON 컬럼(NVARCHAR(MAX))에 담고, 조회·필터 대상만 정규 컬럼으로 둔다.

```prisma
datasource db {
  provider = "sqlserver"
  url      = env("DATABASE_URL")
}

model City {
  id           String   @id @default(uuid())
  name         String
  countryCode  String
  lat          Float
  lon          Float
  background   String?  @db.NVarChar(Max) // 역사·배경 요약(JSON)
  tourismBoard String?  @db.NVarChar(Max) // 관광청 URL·추출정보(JSON)
  refreshedAt  DateTime
  pois         Poi[]
  trips        Trip[]
  @@unique([name, countryCode])
}

model Poi {
  id        String  @id @default(uuid())
  cityId    String
  name      String
  category  String
  lat       Float
  lon       Float
  hours     String? @db.NVarChar(Max)
  sourceUrl String?
  city      City    @relation(fields: [cityId], references: [id])
}

model Trip {
  id         String    @id @default(uuid())
  ownerId    String
  cityId     String
  days       Int
  startDate  DateTime?
  style      String
  transport  String
  status     String    // queued, running, done, failed
  createdAt  DateTime  @default(now())
  city       City      @relation(fields: [cityId], references: [id])
  tripDays   TripDay[]
  nearby     NearbyTown[]
}

model TripDay {
  id       String @id @default(uuid())
  tripId   String
  dayIndex Int
  title    String
  stops    String @db.NVarChar(Max) // 순서·시간·체류·이동(JSON)
  routeGeo String? @db.NVarChar(Max) // 경로선 GeoJSON
  trip     Trip   @relation(fields: [tripId], references: [id], onDelete: Cascade)
}

model NearbyTown {
  id         String @id @default(uuid())
  tripId     String
  name       String
  travelMins Int
  reason     String
  trip       Trip   @relation(fields: [tripId], references: [id], onDelete: Cascade)
}
```

**API (OpenAPI 3.1, `/api/v1`)**

| Method | Path | 설명 |
| --- | --- | --- |
| POST | /trips | 여행 조건으로 일정 생성 작업 시작, tripId 반환 (202) |
| GET | /trips/{id}/events | 진행 상황 SSE 스트림 |
| GET | /trips | 저장된 여행 목록 |
| GET | /trips/{id} | 일정·동선·근교도시 상세 |
| POST | /trips/{id}/days/{dayIndex}/regenerate | 특정 일자 재생성 |
| DELETE | /trips/{id} | 여행 삭제 |
| GET | /cities/{id} | 도시 기초정보(역사·관광청·POI) |
| GET | /healthz | ACA 상태 프로브용 |

**테스트 전략 (Vitest)**

- 단위: 동선 최적화 알고리즘, 검증 규칙, Zod 스키마, 프롬프트 출력 파서
- 통합: 외부 API는 MSW로 목(mock) 처리, DB는 Testcontainers의 SQL Server 이미지로 실제 쿼리 검증
- LLM 평가: 고정 도시 5곳(파리, 교토, 포르투, 경주, 이스탄불)으로 회귀 테스트, 출처 비율·검증 규칙 통과율 측정

## 9. 컨테이너화, CI/CD, ACA 배포·보안

배포 경로는 `main` 푸시 → GitHub Actions(OIDC 인증) → ACR 이미지 푸시 → ACA 새 리비전 생성 → 상태 프로브 통과 후 트래픽 전환이다. 저장소와 워크플로 어디에도 Azure 비밀키를 두지 않는다.

**Dockerfile (멀티스테이지 요약)**

1. `deps`: node:22-alpine, `npm ci`
2. `build`: `prisma generate` → `next build` (output: standalone)
3. `runner`: standalone 산출물과 static만 복사, `USER node`, `EXPOSE 3000`, `HEALTHCHECK`는 `/api/healthz`

로컬 검증: `docker build` → `docker run`으로 Azure SQL 개발 DB 연결 확인 → 이미지 크기 300MB 이하 목표.

**GitHub 저장소·워크플로**

| 워크플로 | 트리거 | 단계 |
| --- | --- | --- |
| ci.yml | PR | lint, 타입체크, Vitest, Docker 빌드(푸시 없음) |
| deploy.yml | main 푸시 | azure/login(OIDC) → 이미지 빌드·ACR 푸시(태그: 커밋 SHA) → `az containerapp secret set` → ACA 이미지 업데이트 → 스모크 테스트 |
| infra.yml | infra/ 변경 | Bicep what-if → 승인 후 배포 |

브랜치 보호: main 직접 푸시 금지, PR + CI 통과 필수. 배포 승인은 GitHub Environment(production)로 관리.

**Azure 리소스 (Korea Central 기준)**

| 리소스 | 구성 |
| --- | --- |
| Resource Group | rg-trippilot-prod |
| Container Registry | Basic SKU, 관리자 계정 비활성화, ACA가 Managed Identity(AcrPull)로 풀 |
| Container Apps 환경 | Consumption 플랜, Log Analytics 연결 |
| Container App | 외부 Ingress(HTTPS) + IP 허용 목록, 0.5 vCPU/1GiB, **최소 0**·최대 3 복제본, liveness/readiness 프로브 |
| Azure SQL Database | 서버리스 GP, 자동 일시중지 (무료 오퍼 적용 가능 여부 확인) |
| Application Insights | 워크스페이스 기반 |
| 비용 관리 | 구독 예산 월 5만 원, 80%·100% 알림 |

Azure 외부 서비스: Gemini API(Google AI Studio 키, LLM과 검색 그라운딩 공용), Google Maps Platform(서버용·브라우저용 키 분리, API·리퍼러 제한), Naver Cloud Platform Maps(Client ID/Secret).

**무중단 배포**: ACA는 이미지 변경 시 새 리비전을 띄우고 readiness 통과 후 트래픽을 넘긴 뒤 이전 리비전을 내린다. 롤백은 이전 리비전을 재활성화한다. 카나리가 필요하면 다중 리비전 모드로 전환해 10% → 100% 순으로 트래픽을 옮긴다.

**비밀·설정 관리**

- Key Vault는 쓰지 않는다. `GEMINI_API_KEY`, `GOOGLE_MAPS_SERVER_KEY`, `NAVER_MAPS_CLIENT_ID/SECRET`, `DATABASE_URL`, `APP_ACCESS_TOKEN`은 GitHub Environment Secrets에 보관
- deploy.yml이 `az containerapp secret set`으로 ACA Secret을 갱신하고, 컨테이너에는 `secretref:`로 환경변수 주입
- 브라우저에 노출되는 지도 키(Google Maps JS, Naver Web Map)는 서버 키와 분리하고 도메인 제한
- 일정 생성은 비동기 작업이므로 상태를 DB에 두어, 복제본이 0에서 다시 기동돼도 이어서 조회 가능하게 한다

## 10. 마일스톤, 리스크, 오픈 이슈

주말·저녁 개발 기준 약 8주에 MVP를 배포한다. 가장 먼저 외부 API PoC(1주차)로 지도·웹검색 품질을 확인한 뒤 본 개발에 들어간다.

&#91;embedded content: MVP 로드맵 · 6단계, 게이트 2개\]

1주차 PoC 게이트에서 지도 공급자를 확정해야 3\~5주차 동선 최적화 작업이 흔들리지 않는다.

**리스크**

| 리스크 | 영향 | 대응 |
| --- | --- | --- |
| LLM이 존재하지 않는 명소·운영시간을 생성(환각) | 잘못된 일정 | 좌표·출처 없는 POI는 일정에서 제외, 운영시간은 출처 값만 사용 |
| 관광청 사이트 구조가 국가마다 달라 추출 실패 | 관광청 정보 누락 | 웹검색 그라운딩 요약으로 대체, 링크만이라도 제공 |
| Naver Directions는 자동차 경로 중심이라 국내 대중교통 경로가 없음 | 동선 부정확 | 국내는 자동차 기준 시간으로 근사 표기, 필요 시 대중교통 API(예: ODsay)를 어댑터로 추가 |
| 일정 생성이 길어 HTTP 타임아웃 | 요청 실패 | 202 + 비동기 작업 + SSE 진행 표시 |
| LLM·검색 호출 비용 급증 (로그인 없는 공개 URL 악용 포함) | 예산 초과 | IP 허용 목록·접근 토큰, 도시 정보 캐시, 요청당 도구 호출 상한, 하루 생성 횟수 제한, 월 5만 원 예산 알림 |
| 웹 수집의 저작권·약관 문제 | 법적 리스크 | 원문 저장 대신 요약·링크 저장, robots.txt 준수 |

**오픈 이슈**

- [x] 사용자 범위: 본인 전용, 로그인 없음
- [x] LLM: Gemini 3.8 Flash
- [x] 웹 그라운딩: Gemini 내장 Google 검색 (Foundry 미사용으로 변경)
- [x] 지도: 해외 Google, 국내 Naver
- [x] 운영비 상한: 월 5만 원
- [x] ACA 최소 복제본: 0
- [x] 비밀 관리: Key Vault 미사용
- [ ] 국내 대중교통 경로 처리 방식 (근사 표기 vs 별도 API)
- [ ] 2027년 Gemini 정가 전환 후 월 비용 재산정
