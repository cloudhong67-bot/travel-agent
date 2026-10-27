// infra/main.bicep 매개변수. 비밀값·개인정보는 이 파일에 쓰지 않고 환경변수에서 읽는다
// (로컬: 셸에서 export, GitHub Actions: infra.yml이 Environment Secrets/Variables를 env로 넘김)
using './main.bicep'

param location = readEnvironmentVariable('AZURE_LOCATION', 'koreacentral')
param resourceGroupName = readEnvironmentVariable('AZURE_RESOURCE_GROUP', 'rg-trippilot-prod')
param containerImage = readEnvironmentVariable('CONTAINER_IMAGE', 'mcr.microsoft.com/k8se/quickstart:latest')

// 쉼표로 구분한 CIDR 목록. 예: <내 공인 IP>/32,<회사 IP 대역>/28
param allowedIpRanges = split(readEnvironmentVariable('ALLOWED_IP_RANGES'), ',')

param googleMapsBrowserKey = readEnvironmentVariable('NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY')
param naverMapsClientId = readEnvironmentVariable('NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID')
param googleMapsMapId = readEnvironmentVariable('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', '')

param geminiApiKey = readEnvironmentVariable('GEMINI_API_KEY')
param googleMapsServerKey = readEnvironmentVariable('GOOGLE_MAPS_SERVER_KEY')
param naverMapsClientSecret = readEnvironmentVariable('NAVER_MAPS_CLIENT_SECRET')
param naverSearchClientId = readEnvironmentVariable('NAVER_SEARCH_CLIENT_ID')
param naverSearchClientSecret = readEnvironmentVariable('NAVER_SEARCH_CLIENT_SECRET')
param appAccessToken = readEnvironmentVariable('APP_ACCESS_TOKEN')

param sqlAdminLogin = readEnvironmentVariable('SQL_ADMIN_LOGIN', 'trippilotadmin')
param sqlAdminPassword = readEnvironmentVariable('SQL_ADMIN_PASSWORD')
param useSqlFreeOffer = bool(readEnvironmentVariable('USE_SQL_FREE_OFFER', 'true'))

param budgetAmount = int(readEnvironmentVariable('BUDGET_AMOUNT', '50000'))
param budgetContactEmails = split(readEnvironmentVariable('BUDGET_CONTACT_EMAILS'), ',')
// 예: 2026-11-01 (이번 달 1일 이후의 어느 달 1일)
param budgetStartDate = readEnvironmentVariable('BUDGET_START_DATE')
