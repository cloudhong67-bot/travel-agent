#!/usr/bin/env bash
# infra.yml 전용: 실행 중인 Container App의 현재 이미지와 비밀값을 읽어 Bicep 매개변수(환경변수)로 넘긴다.
# Bicep 재배포는 Container App의 secret 목록과 이미지를 템플릿 값으로 덮어쓰므로,
# deploy.yml이 마지막으로 넣은 값을 그대로 이어받아 앱이 깨지지 않게 한다. 값은 로그에서 마스킹한다.
set -euo pipefail

: "${AZURE_RESOURCE_GROUP:?AZURE_RESOURCE_GROUP 필요}"
: "${ACA_NAME:?ACA_NAME 필요}"

if ! az containerapp show -n "$ACA_NAME" -g "$AZURE_RESOURCE_GROUP" --output none 2>/dev/null; then
  echo "::error::Container App(${ACA_NAME})이 없습니다. 최초 배포는 docs/RUNBOOK.md의 로컬 명령으로 하세요."
  exit 1
fi

IMAGE=$(az containerapp show -n "$ACA_NAME" -g "$AZURE_RESOURCE_GROUP" --query "properties.template.containers[0].image" -o tsv)
echo "CONTAINER_IMAGE=${IMAGE}" >> "$GITHUB_ENV"

# secret 이름 → bicepparam이 읽는 환경변수 이름 (database-url·appinsights는 Bicep이 직접 만든다)
declare -A MAP=(
  [gemini-api-key]=GEMINI_API_KEY
  [google-maps-server-key]=GOOGLE_MAPS_SERVER_KEY
  [naver-maps-client-secret]=NAVER_MAPS_CLIENT_SECRET
  [naver-search-client-id]=NAVER_SEARCH_CLIENT_ID
  [naver-search-client-secret]=NAVER_SEARCH_CLIENT_SECRET
  [app-access-token]=APP_ACCESS_TOKEN
)

SECRETS_JSON=$(az containerapp secret list -n "$ACA_NAME" -g "$AZURE_RESOURCE_GROUP" --show-values -o json)
for name in "${!MAP[@]}"; do
  value=$(jq -r --arg n "$name" '.[] | select(.name == $n) | .value // empty' <<<"$SECRETS_JSON")
  if [ -z "$value" ]; then
    echo "::error::Container App secret '${name}'이 비어 있습니다. deploy.yml을 먼저 성공시키세요."
    exit 1
  fi
  echo "::add-mask::${value}"
  echo "${MAP[$name]}=${value}" >> "$GITHUB_ENV"
done

echo "현재 이미지 ${IMAGE}와 비밀값 ${#MAP[@]}개를 이어받습니다."
