// TripPilot 인프라 (PRD 9장) — 구독 범위 배포
//   az deployment sub create -l koreacentral -f infra/main.bicep -p infra/main.bicepparam
// 리소스 그룹과 그 안의 리소스(modules/app.bicep), 구독 월 예산을 만든다. Key Vault는 쓰지 않는다.
targetScope = 'subscription'

@description('배포 리전 (기본 Korea Central)')
param location string = 'koreacentral'

@description('리소스 이름 접두사')
@minLength(3)
@maxLength(12)
param namePrefix string = 'trippilot'

@description('리소스 그룹 이름')
param resourceGroupName string = 'rg-trippilot-prod'

// ---------- 컨테이너 앱 ----------

@description('배포할 이미지. 최초 배포는 ACR이 비어 있으므로 기본 퀵스타트 이미지(포트 80)로 만든 뒤 deploy.yml이 교체한다')
param containerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Ingress 허용 IP 목록 (CIDR). 비어 있으면 공개 URL이 열리므로 최소 1개 필수')
@minLength(1)
param allowedIpRanges array

@minValue(0)
param minReplicas int = 0

@minValue(1)
param maxReplicas int = 3

param geminiModel string = 'gemini-3.8-flash'
param dailyTripLimit int = 10

@description('브라우저 공개 키 (빌드 인자로도 주입되며, 서버 env 검증을 위해 런타임에도 둔다)')
param googleMapsBrowserKey string
param naverMapsClientId string
@description('Google Maps Map ID (Advanced Marker용). 없으면 DEMO_MAP_ID')
param googleMapsMapId string = ''

// ---------- 앱 비밀값 (Container App secret으로만 저장, 값은 GitHub Environment Secrets에서 주입) ----------

@secure()
param geminiApiKey string
@secure()
param googleMapsServerKey string
@secure()
param naverMapsClientSecret string
@secure()
param naverSearchClientId string
@secure()
param naverSearchClientSecret string
@secure()
param appAccessToken string

// ---------- Azure SQL ----------

param sqlAdminLogin string = 'trippilotadmin'
@secure()
@minLength(12)
param sqlAdminPassword string

@description('Azure SQL Database 무료 오퍼(월 vCore 10만 초·32GB) 적용. 구독당 무료 DB 개수 제한이 있어 이미 쓰고 있으면 false')
param useSqlFreeOffer bool = true

// ---------- 비용 ----------

@description('월 예산 금액 (청구 통화 기준, 원화 청구 계정이면 원)')
param budgetAmount int = 50000

@description('예산 알림 받을 이메일')
@minLength(1)
param budgetContactEmails array

@description('예산 시작일 (YYYY-MM-01, 이번 달 1일 이후)')
param budgetStartDate string

@description('Log Analytics 일일 수집 상한(GB). 0.15GB × 30일 ≈ 4.5GB로 월 무료 5GB 안')
param logDailyQuotaGb string = '0.15'

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: { app: 'trippilot' }
}

module app 'modules/app.bicep' = {
  name: 'trippilot-app'
  scope: rg
  params: {
    location: location
    namePrefix: namePrefix
    containerImage: containerImage
    allowedIpRanges: allowedIpRanges
    minReplicas: minReplicas
    maxReplicas: maxReplicas
    geminiModel: geminiModel
    dailyTripLimit: dailyTripLimit
    googleMapsBrowserKey: googleMapsBrowserKey
    naverMapsClientId: naverMapsClientId
    googleMapsMapId: googleMapsMapId
    geminiApiKey: geminiApiKey
    googleMapsServerKey: googleMapsServerKey
    naverMapsClientSecret: naverMapsClientSecret
    naverSearchClientId: naverSearchClientId
    naverSearchClientSecret: naverSearchClientSecret
    appAccessToken: appAccessToken
    sqlAdminLogin: sqlAdminLogin
    sqlAdminPassword: sqlAdminPassword
    useSqlFreeOffer: useSqlFreeOffer
    logDailyQuotaGb: logDailyQuotaGb
  }
}

// 구독 월 예산: 실제 비용 80%·100% 도달 시 이메일
resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: '${namePrefix}-monthly-budget'
  properties: {
    category: 'Cost'
    amount: budgetAmount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    notifications: {
      actual80: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: budgetContactEmails
      }
      actual100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: budgetContactEmails
      }
    }
  }
}

output resourceGroupName string = rg.name
output acrName string = app.outputs.acrName
output acrLoginServer string = app.outputs.acrLoginServer
output containerAppName string = app.outputs.containerAppName
output containerAppFqdn string = app.outputs.containerAppFqdn
output sqlServerFqdn string = app.outputs.sqlServerFqdn
output sqlDatabaseName string = app.outputs.sqlDatabaseName
