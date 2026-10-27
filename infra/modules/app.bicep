// 리소스 그룹 범위: Log Analytics, Application Insights, ACR, Managed Identity, Container Apps 환경·앱, Azure SQL
param location string
param namePrefix string
param containerImage string
param allowedIpRanges array
param minReplicas int
param maxReplicas int
param geminiModel string
param dailyTripLimit int
param googleMapsBrowserKey string
param naverMapsClientId string
param googleMapsMapId string

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

param sqlAdminLogin string
@secure()
param sqlAdminPassword string
param useSqlFreeOffer bool
param logDailyQuotaGb string

var suffix = uniqueString(resourceGroup().id)
// 최초 배포 시 ACR이 비어 있어 공개 퀵스타트 이미지(포트 80, healthz 없음)를 쓴다
var isPlaceholderImage = startsWith(containerImage, 'mcr.microsoft.com/k8se/quickstart')
var targetPort = isPlaceholderImage ? 80 : 3000
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

// ---------- 관측성 ----------

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs-${suffix}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: json(logDailyQuotaGb) }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${namePrefix}-ai-${suffix}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
    IngestionMode: 'LogAnalytics'
  }
}

// ---------- 레지스트리·ID ----------

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: toLower('${namePrefix}${suffix}')
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-id-${suffix}'
  location: location
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identity.id, acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------- Azure SQL (서버리스, 자동 일시중지) ----------

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: '${namePrefix}-sql-${suffix}'
  location: location
  properties: {
    administratorLogin: sqlAdminLogin
    administratorLoginPassword: sqlAdminPassword
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

// "Azure 서비스 및 리소스가 이 서버에 액세스하도록 허용" (0.0.0.0 규칙). ACA는 고정 IP가 없어 이 방식으로 접근한다
resource allowAzure 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sqlServer
  name: 'AllowAllWindowsAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource sqlDb 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: namePrefix
  location: location
  sku: {
    name: 'GP_S_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 1
  }
  properties: {
    autoPauseDelay: 60
    minCapacity: json('0.5')
    maxSizeBytes: 34359738368 // 32GB (무료 오퍼 한도)
    zoneRedundant: false
    requestedBackupStorageRedundancy: 'Local'
    useFreeLimit: useSqlFreeOffer
    freeLimitExhaustionBehavior: useSqlFreeOffer ? 'AutoPause' : null
  }
}

// connectTimeout은 넣지 않는다: @prisma/adapter-mssql은 이 값을 mssql connectionTimeout(밀리초)에 그대로 넘겨
// "60"이 60ms가 된다. 기본 15초 + 시작 스크립트의 재시도로 DB 자동 일시중지 해제를 기다린다
var databaseUrl = 'sqlserver://${sqlServer.properties.fullyQualifiedDomainName}:1433;database=${sqlDb.name};user=${sqlAdminLogin};password=${sqlAdminPassword};encrypt=true;trustServerCertificate=false'

// ---------- Container Apps ----------

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-env-${suffix}'
  location: location
  properties: {
    // workloadProfiles를 지정하지 않으면 Consumption 전용 환경
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
    zoneRedundant: false
  }
}

// 비밀값 이름 ↔ 환경변수 (secretref:). deploy.yml의 az containerapp secret set과 이름을 맞춘다.
// 이름 매핑은 정적 배열(배포 시작 시 계산 가능), 값은 아래 secrets에 명시한다
var secretEnv = [
  { name: 'gemini-api-key', env: 'GEMINI_API_KEY' }
  { name: 'google-maps-server-key', env: 'GOOGLE_MAPS_SERVER_KEY' }
  { name: 'naver-maps-client-id', env: 'NAVER_MAPS_CLIENT_ID' }
  { name: 'naver-maps-client-secret', env: 'NAVER_MAPS_CLIENT_SECRET' }
  { name: 'naver-search-client-id', env: 'NAVER_SEARCH_CLIENT_ID' }
  { name: 'naver-search-client-secret', env: 'NAVER_SEARCH_CLIENT_SECRET' }
  { name: 'database-url', env: 'DATABASE_URL' }
  { name: 'app-access-token', env: 'APP_ACCESS_TOKEN' }
  { name: 'appinsights-connection-string', env: 'APPLICATIONINSIGHTS_CONNECTION_STRING' }
]

var plainEnv = [
  { name: 'GEMINI_MODEL', value: geminiModel }
  { name: 'DAILY_TRIP_LIMIT', value: string(dailyTripLimit) }
  { name: 'NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY', value: googleMapsBrowserKey }
  { name: 'NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID', value: naverMapsClientId }
  { name: 'NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', value: googleMapsMapId }
]

var probes = [
  {
    // 컨테이너 시작 시 마이그레이션(DB 자동 일시중지 해제 포함)이 끝날 때까지 기다린다: 최대 30 + 15×10 = 180초
    type: 'Startup'
    httpGet: { path: '/api/healthz?shallow=1', port: 3000 }
    initialDelaySeconds: 30
    periodSeconds: 15
    timeoutSeconds: 5
    failureThreshold: 10
  }
  {
    // 프로세스 생존만 확인 (DB를 깨우지 않음)
    type: 'Liveness'
    httpGet: { path: '/api/healthz?shallow=1', port: 3000 }
    periodSeconds: 30
    timeoutSeconds: 5
    failureThreshold: 3
  }
  {
    // DB 연결까지 확인되면 트래픽을 받는다
    type: 'Readiness'
    httpGet: { path: '/api/healthz', port: 3000 }
    periodSeconds: 15
    timeoutSeconds: 10
    failureThreshold: 6
  }
]

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-app'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  dependsOn: [acrPull]
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
        ipSecurityRestrictions: [
          for (cidr, i) in allowedIpRanges: {
            name: 'allow-${i}'
            description: '허용 IP'
            ipAddressRange: cidr
            action: 'Allow'
          }
        ]
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: identity.id
        }
      ]
      // 주의: Bicep 재배포는 secret 목록 전체를 이 값으로 바꾼다. infra.yml도 deploy.yml과 같은 GitHub Secrets를 넘긴다
      secrets: [
        { name: 'gemini-api-key', value: geminiApiKey }
        { name: 'google-maps-server-key', value: googleMapsServerKey }
        // Naver Maps Client ID는 브라우저에도 노출되는 공개 값이라 @secure 매개변수가 아니다 (서버 코드는 secretref로 읽음)
        #disable-next-line use-secure-value-for-secure-inputs
        { name: 'naver-maps-client-id', value: naverMapsClientId }
        { name: 'naver-maps-client-secret', value: naverMapsClientSecret }
        { name: 'naver-search-client-id', value: naverSearchClientId }
        { name: 'naver-search-client-secret', value: naverSearchClientSecret }
        { name: 'database-url', value: databaseUrl }
        { name: 'app-access-token', value: appAccessToken }
        { name: 'appinsights-connection-string', value: appInsights.properties.ConnectionString }
      ]
    }
    template: {
      containers: [
        {
          name: 'trippilot'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: concat(plainEnv, map(secretEnv, s => { name: s.env, secretRef: s.name }))
          probes: isPlaceholderImage ? [] : probes
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-concurrency'
            http: { metadata: { concurrentRequests: '10' } }
          }
        ]
      }
    }
  }
}

output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output containerAppName string = app.name
output containerAppFqdn string = app.properties.configuration.ingress.fqdn
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output sqlDatabaseName string = sqlDb.name
