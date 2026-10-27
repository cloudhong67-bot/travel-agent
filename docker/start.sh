#!/bin/sh
# 컨테이너 시작: prisma migrate deploy → node server.js
# Azure SQL 서버리스가 자동 일시중지 상태면 첫 연결에서 깨어나는 데 1분 가까이 걸릴 수 있어 재시도한다.
set -e

if [ -n "$DATABASE_URL" ] && [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
  attempt=1
  max_attempts="${MIGRATE_MAX_ATTEMPTS:-6}"
  until (cd ./migrate && node node_modules/prisma/build/index.js migrate deploy); do
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "[start] prisma migrate deploy 실패 (${attempt}회) — 종료합니다" >&2
      exit 1
    fi
    echo "[start] migrate deploy 재시도 대기 (${attempt}/${max_attempts}) — DB가 깨어나는 중일 수 있습니다" >&2
    attempt=$((attempt + 1))
    sleep 15
  done
else
  echo "[start] DATABASE_URL이 없거나 SKIP_MIGRATIONS=1 — 마이그레이션을 건너뜁니다"
fi

exec node server.js
