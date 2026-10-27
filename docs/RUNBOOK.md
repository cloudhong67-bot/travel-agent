# TripPilot 운영 런북

배포 경로: `main` 푸시 → GitHub Actions(`deploy.yml`, OIDC) → CI(lint·typecheck·테스트) → 이미지 빌드·ACR 푸시(태그: 커밋 SHA) → Container App 비밀값 갱신 → 새 리비전 → `/api/healthz` 스모크 → 실패 시 직전 리비전 복귀.
인프라는 `infra/main.bicep`(구독 범위)로 관리하고, `infra/` 변경은 `infra.yml`이 what-if → 수동 승인 → 배포한다. Key Vault는 쓰지 않는다.

> 아래 명령은 **bash(Azure Cloud Shell 또는 WSL)** 기준이다. `<...>`는 직접 채울 값이며, 비밀값은 셸 기록에 남지 않게 `read -s`로 입력한다.

---

## 0. 구성 요소

| 리소스 | 이름 (기본값) | 비고 |
| --- | --- | --- |
| Resource Group | `rg-trippilot-prod` | 리전 기본 `koreacentral` (매개변수 `AZURE_LOCATION`) |
| Log Analytics / Application Insights | `trippilot-logs-*` / `trippilot-ai-*` | 일일 수집 상한 0.15GB (월 무료 5GB 안) |
| Container Registry | `trippilot<고유값>` | Basic, 관리자 계정 꺼짐, 앱은 Managed Identity(AcrPull)로 풀 |
| Managed Identity | `trippilot-id-*` | 사용자 할당 |
| Container Apps 환경·앱 | `trippilot-env-*` / `trippilot-app` | Consumption, 최소 0·최대 3, 동시요청 10 기준 확장, IP 허용 목록 |
| Azure SQL | `trippilot-sql-*` / DB `trippilot` | 서버리스 GP 1 vCore, 자동 일시중지 60분, 무료 오퍼, "Azure 서비스 허용" 방화벽 |
| 예산 | `trippilot-monthly-budget` | 구독 월 50,000(청구 통화), 실제 비용 80%·100% 메일 |

---

## 1. 사전 준비 (최초 1회)

```bash
az login
az account set --subscription "<구독 ID 또는 이름>"
SUB_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)

# 리소스 공급자 등록 (이미 등록돼 있으면 빠르게 끝난다)
for ns in Microsoft.App Microsoft.ContainerRegistry Microsoft.Sql Microsoft.OperationalInsights \
          Microsoft.Insights Microsoft.ManagedIdentity Microsoft.Consumption; do
  az provider register --namespace "$ns" --wait
done
```

---

## 2. Entra 앱 등록 + GitHub OIDC 페더레이션 자격 증명

GitHub Actions가 비밀키 없이 Azure에 로그인하도록 앱 등록과 서비스 주체를 만든다.

```bash
GH_REPO="<github-owner>/<repo-name>"

APP_ID=$(az ad app create --display-name "trippilot-github-actions" --query appId -o tsv)
az ad sp create --id "$APP_ID" --output none
SP_OID=$(az ad sp show --id "$APP_ID" --query id -o tsv)

# (1) 리소스 생성·배포·예산: 구독 Contributor
az role assignment create --assignee-object-id "$SP_OID" --assignee-principal-type ServicePrincipal \
  --role Contributor --scope "/subscriptions/$SUB_ID"

# (2) Bicep의 AcrPull 역할 할당용: RBAC 관리자 권한을 "AcrPull 할당만" 하도록 조건으로 제한
ACR_PULL=7f951dda-4ed3-4680-a7ca-43fe172d538d
az role assignment create --assignee-object-id "$SP_OID" --assignee-principal-type ServicePrincipal \
  --role "Role Based Access Control Administrator" --scope "/subscriptions/$SUB_ID" \
  --condition-version 2.0 \
  --condition "((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$ACR_PULL})) AND ((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$ACR_PULL}))"

# (3) 페더레이션 자격 증명: GitHub Environment별로 하나씩 (deploy.yml·infra.yml이 쓰는 두 환경)
for envName in production production-infra; do
  az ad app federated-credential create --id "$APP_ID" --parameters "{
    \"name\": \"github-${envName}\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:${GH_REPO}:environment:${envName}\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }"
done

echo "AZURE_CLIENT_ID=$APP_ID  AZURE_TENANT_ID=$TENANT_ID  AZURE_SUBSCRIPTION_ID=$SUB_ID"
```

> PR(`ci.yml`)은 Azure에 접근하지 않으므로 pull_request용 자격 증명은 만들지 않는다.

---

## 3. 최초 인프라 배포 (로컬에서 1회)

`infra/main.bicepparam`은 값을 **환경변수에서만** 읽는다. 첫 배포는 ACR이 비어 있어 퀵스타트 이미지(포트 80)로 앱을 만든다.

```bash
export AZURE_LOCATION=koreacentral
export AZURE_RESOURCE_GROUP=rg-trippilot-prod
export ALLOWED_IP_RANGES="<내 공인 IP>/32"            # 여러 개면 쉼표로: "<IP1>/32,<IP2>/32"
export BUDGET_CONTACT_EMAILS="<알림 받을 이메일>"
export BUDGET_START_DATE="<YYYY-MM-01>"               # 이번 달 1일 또는 이후 달 1일
export NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY="<브라우저용 Google Maps 키>"
export NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID="<Naver Maps Client ID>"
export NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=""               # Map ID를 만들었으면 입력

# 비밀값 (입력이 화면·기록에 남지 않음)
read -rs -p "GEMINI_API_KEY: " GEMINI_API_KEY; echo; export GEMINI_API_KEY
read -rs -p "GOOGLE_MAPS_SERVER_KEY: " GOOGLE_MAPS_SERVER_KEY; echo; export GOOGLE_MAPS_SERVER_KEY
read -rs -p "NAVER_MAPS_CLIENT_SECRET: " NAVER_MAPS_CLIENT_SECRET; echo; export NAVER_MAPS_CLIENT_SECRET
read -rs -p "NAVER_SEARCH_CLIENT_ID: " NAVER_SEARCH_CLIENT_ID; echo; export NAVER_SEARCH_CLIENT_ID
read -rs -p "NAVER_SEARCH_CLIENT_SECRET: " NAVER_SEARCH_CLIENT_SECRET; echo; export NAVER_SEARCH_CLIENT_SECRET
read -rs -p "APP_ACCESS_TOKEN (16자 이상): " APP_ACCESS_TOKEN; echo; export APP_ACCESS_TOKEN
read -rs -p "SQL_ADMIN_PASSWORD (12자 이상, ; = 문자 금지): " SQL_ADMIN_PASSWORD; echo; export SQL_ADMIN_PASSWORD

# 미리 보기 → 배포
az deployment sub what-if  --name trippilot-init --location "$AZURE_LOCATION" \
  --template-file infra/main.bicep --parameters infra/main.bicepparam
az deployment sub create   --name trippilot-init --location "$AZURE_LOCATION" \
  --template-file infra/main.bicep --parameters infra/main.bicepparam \
  --query properties.outputs -o json
```

출력(`acrName`, `containerAppName`, `containerAppFqdn`, `sqlServerFqdn`, `sqlDatabaseName`)을 4단계에서 쓴다.

- `APP_ACCESS_TOKEN` 생성 예: `openssl rand -base64 32 | tr -d '/+=' | cut -c1-40`
- SQL 비밀번호에 `;`·`=`가 있으면 연결 문자열이 깨진다.
- 무료 SQL 오퍼를 이미 다른 DB에서 쓰고 있으면 `export USE_SQL_FREE_OFFER=false` (구독당 무료 DB 최대 10개).

---

## 4. GitHub 설정

### 4-1. Environments (Settings → Environments)

| 환경 | 보호 규칙 | 용도 |
| --- | --- | --- |
| `production` | Deployment branches: `main`만 | `deploy.yml`, `infra.yml`의 what-if |
| `production-infra` | **Required reviewers: 본인**, Deployment branches: `main`만 | `infra.yml`의 배포(수동 승인) |

브랜치 보호(Settings → Branches): `main` 직접 푸시 금지, PR + `CI` 체크 통과 필수.

### 4-2. Secrets (Environment secrets)

| 이름 | production | production-infra | 값 |
| --- | :-: | :-: | --- |
| `AZURE_CLIENT_ID` | ✅ | ✅ | 2단계 `APP_ID` |
| `AZURE_TENANT_ID` | ✅ | ✅ | 2단계 `TENANT_ID` |
| `AZURE_SUBSCRIPTION_ID` | ✅ | ✅ | 2단계 `SUB_ID` |
| `SQL_ADMIN_PASSWORD` | ✅ | ✅ | 3단계와 같은 값 |
| `GEMINI_API_KEY` | ✅ | | Google AI Studio |
| `GOOGLE_MAPS_SERVER_KEY` | ✅ | | 서버용 키 (API 제한: Geocoding·Places·Routes) |
| `NAVER_MAPS_CLIENT_ID` | ✅ | | NCP Maps Client ID |
| `NAVER_MAPS_CLIENT_SECRET` | ✅ | | NCP Maps Client Secret |
| `NAVER_SEARCH_CLIENT_ID` | ✅ | | developers.naver.com 검색 API |
| `NAVER_SEARCH_CLIENT_SECRET` | ✅ | | developers.naver.com 검색 API |
| `DATABASE_URL` | ✅ | | `sqlserver://<sqlServerFqdn>:1433;database=trippilot;user=trippilotadmin;password=<SQL_ADMIN_PASSWORD>;encrypt=true;trustServerCertificate=false` (`connectTimeout`은 넣지 않는다 — 어댑터가 밀리초로 해석) |
| `APP_ACCESS_TOKEN` | ✅ | | 3단계와 같은 값 |

> `infra.yml`은 앱 비밀값을 GitHub에서 받지 않고 **실행 중인 Container App에서 이어받는다**(`infra/scripts/export-current-app-state.sh`). Bicep 재배포가 secret 목록을 덮어써도 마지막 배포 값이 유지된다.

### 4-3. Variables (Environment variables, 두 환경 모두)

| 이름 | 값 |
| --- | --- |
| `AZURE_RESOURCE_GROUP` | `rg-trippilot-prod` |
| `AZURE_LOCATION` | `koreacentral` |
| `ACA_NAME` | 출력 `containerAppName` (`trippilot-app`) |
| `ACR_NAME` | 출력 `acrName` |
| `ALLOWED_IP_RANGES` | 3단계와 같은 값 |
| `BUDGET_CONTACT_EMAILS` / `BUDGET_START_DATE` | 3단계와 같은 값 |
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | 브라우저용 키 (HTTP 리퍼러를 `https://<containerAppFqdn>/*`로 제한) |
| `NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID` | NCP Web 서비스 URL에 `https://<containerAppFqdn>` 등록 |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | (선택) Cloud 콘솔 Map ID |
| `GEMINI_MODEL` / `DAILY_TRIP_LIMIT` | (선택) 기본 `gemini-3.8-flash` / `10` |

---

## 5. 첫 앱 배포

1. `main`에 푸시하거나 Actions → **Deploy** → Run workflow.
   - 최초 리비전은 퀵스타트 이미지(포트 80)이므로 `deploy.yml`이 Ingress 포트를 3000으로 맞춘 뒤 실제 이미지를 올린다.
2. 성공하면 Actions → **Infra** → Run workflow를 **한 번** 실행하고 승인한다.
   - 실제 이미지 기준으로 Startup·Liveness·Readiness 프로브가 설정된다 (퀵스타트 이미지일 때는 프로브를 생략했다).
3. 허용한 IP의 브라우저에서 `https://<containerAppFqdn>/unlock` → `APP_ACCESS_TOKEN` 입력.

확인 명령:

```bash
FQDN=$(az containerapp show -n trippilot-app -g rg-trippilot-prod --query properties.configuration.ingress.fqdn -o tsv)
curl -s "https://$FQDN/api/healthz"            # 허용 IP에서: {"status":"ok","db":"ok",...}
az containerapp revision list -n trippilot-app -g rg-trippilot-prod -o table
az containerapp logs show -n trippilot-app -g rg-trippilot-prod --follow --tail 50
```

---

## 6. 롤백

`deploy.yml`은 스모크 실패 시 직전 리비전을 자동 복사한다. 수동 롤백:

```bash
RG=rg-trippilot-prod; APP=trippilot-app
az containerapp revision list -n "$APP" -g "$RG" \
  --query "[].{name:name, active:properties.active, created:properties.createdTime, image:properties.template.containers[0].image}" -o table

# (A) 특정 리비전의 템플릿(이미지·환경변수) 그대로 새 리비전 생성 — 단일 리비전 모드의 권장 방법
az containerapp revision copy -n "$APP" -g "$RG" --from-revision "<되돌릴 리비전 이름>" --revision-suffix "rollback-$(date +%m%d%H%M)"

# (B) 이전 이미지 태그(커밋 SHA)로 다시 배포
az containerapp update -n "$APP" -g "$RG" --image "<acr>.azurecr.io/trippilot:<이전 커밋 SHA>"
```

- DB 마이그레이션은 앞으로만 적용된다. 스키마를 되돌려야 하면 되돌리는 마이그레이션을 새로 만들어 배포한다.
- 인프라 롤백은 이전 커밋의 `infra/`로 되돌리는 PR → Infra 워크플로 승인.

---

## 7. 비용 확인

```bash
RG=rg-trippilot-prod
# 이번 달 리소스 그룹 비용 (청구 통화)
az consumption usage list --start-date "$(date +%Y-%m-01)" --end-date "$(date +%Y-%m-%d)" \
  --query "[?contains(instanceId, '$RG')].{resource:instanceName, cost:pretaxCost, currency:currency}" -o table

# 예산 상태
az consumption budget show --budget-name trippilot-monthly-budget --query "{amount:amount, current:currentSpend}" -o json

# SQL 무료 오퍼 남은 vCore 초 (포털: SQL DB → 개요 → Free monthly vCore amount)
# Log Analytics 일일 수집 상한 확인
az monitor log-analytics workspace list -g "$RG" --query "[].{name:name, dailyCapGb:workspaceCapping.dailyQuotaGb}" -o table
```

- 포털: **비용 관리 → 비용 분석**(리소스 그룹 필터)에서 일별 추이를 본다.
- **Azure 예산은 Azure 비용만 센다.** Gemini(Google AI Studio)·Google Maps는 Google Cloud 결제 콘솔의 예산·할당량 알림을 따로 설정한다.
- 앱 내부 사용량: DB `UsageLog` 테이블(공급자별 호출·토큰). 하루 생성 한도는 `DAILY_TRIP_LIMIT`.

---

## 8. 비밀값 교체

| 대상 | 절차 |
| --- | --- |
| Gemini·Google·Naver 키, `APP_ACCESS_TOKEN` | ① 발급처에서 새 키 생성 → ② GitHub `production` 환경 Secret 수정 → ③ Actions → Deploy → Run workflow (secret 갱신 + 새 리비전) → ④ 정상 확인 후 옛 키 폐기. 토큰을 바꾸면 브라우저에서 `/unlock` 다시 입력 |
| SQL 관리자 비밀번호 | ① `az sql server update -g rg-trippilot-prod -n <sqlServer> --admin-password "<새 비밀번호>"` → ② GitHub `SQL_ADMIN_PASSWORD`(두 환경)·`DATABASE_URL` 수정 → ③ Deploy 실행 → ④ Infra 실행(승인) |
| 브라우저 키 (`NEXT_PUBLIC_*`) | 공개 값이지만 빌드에 들어가므로 Variables 수정 후 Deploy 실행 (이미지 재빌드) |
| OIDC | 비밀키가 없어 교체 대상 아님. 저장소 이름이 바뀌면 페더레이션 자격 증명의 `subject`를 수정 |

비밀값은 **GitHub Secrets → (배포 시) Container App secret**에만 존재한다. 코드·이미지·Bicep 파일에는 없다 (`npm run build && npm run check:bundle`로 클라이언트 번들 검사).

---

## 9. 문제 해결

| 증상 | 원인·조치 |
| --- | --- |
| 첫 요청이 1~2분 걸림 | 최소 복제본 0 + SQL 자동 일시중지. 컨테이너 시작 시 마이그레이션 실행기(`migrate/migrate.mjs`)가 DB를 깨우며 최대 6회(15초 간격) 재시도. 배포 스모크는 최대 240초 기다린다 |
| 리비전이 Ready가 안 됨 | `az containerapp logs show ... --type system` / `--type console`. 마이그레이션 실패면 `[migrate] ...`·`[start] 마이그레이션 실패` 로그 |
| `실패한 마이그레이션 기록이 있어 중단합니다` | 이전 시작에서 마이그레이션 SQL이 실패해 `_prisma_migrations`에 미완료 기록이 남음. 원인을 고친 뒤 로컬에서 운영 `DATABASE_URL`로 `npx prisma migrate resolve --rolled-back <이름>` 실행 후 재배포 |
| DB가 이번 달 계속 꺼져 있음 | 무료 오퍼 한도 소진 → `AutoPause`. 포털에서 "추가 요금으로 계속 사용"(BillOverUsage)으로 바꾸거나 다음 달까지 대기 (되돌릴 수 없음에 유의) |
| 403 (Forbidden) | IP 허용 목록 밖. `ALLOWED_IP_RANGES` 변수 수정 → Infra 실행, 또는 임시로 `az containerapp ingress access-restriction set` |
| Application Insights에 데이터 없음 | Container App secret `appinsights-connection-string` 확인. 연결 문자열이 없으면 앱은 원격 측정 없이 동작한다 |
