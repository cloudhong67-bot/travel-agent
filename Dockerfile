# syntax=docker/dockerfile:1.7
# TripPilot 컨테이너 이미지 (PRD 9장) — node:22-alpine 멀티스테이지
#   deps → build(prisma generate → next build, standalone) → runner
# 시작 시 마이그레이션은 Prisma CLI 대신 scripts/migrate.mjs(앱과 같은 mssql 어댑터 사용)가 적용한다.
# 브라우저 공개 키(NEXT_PUBLIC_*)는 빌드 시점에 번들에 들어가므로 --build-arg로 넣는다. 서버 비밀값은 이미지에 넣지 않는다.

ARG NODE_IMAGE=node:22-alpine

# ---------- deps: 의존성 설치 ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# prisma generate(postinstall)가 openssl을 찾는다
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
# postinstall(prisma generate)이 스키마·설정을 읽는다
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci --no-audit --no-fund

# ---------- build: prisma generate → next build ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY
ARG NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID
ARG NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID
ENV NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=${NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY} \
    NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID=${NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID} \
    NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=${NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID} \
    NEXT_TELEMETRY_DISABLED=1

RUN npx prisma generate && npm run build

# ---------- runner ----------
# Prisma 7 + 드라이버 어댑터는 네이티브 엔진이 없어 런타임에 openssl이 필요 없다
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# 실행에 필요한 것만: standalone 서버, 정적 파일, public, 마이그레이션(SQL + 실행기)
# 실행기는 standalone node_modules의 @prisma/adapter-mssql·mssql을 그대로 쓴다
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node prisma/migrations ./migrate/migrations
COPY --chown=node:node scripts/migrate.mjs ./migrate/migrate.mjs
COPY --chown=node:node docker/start.sh ./start.sh

USER node
EXPOSE 3000

# 컨테이너 자체 상태 확인은 DB를 건드리지 않는 shallow 모드 (ACA 프로브는 Bicep에서 별도 설정)
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:3000/api/healthz?shallow=1" >/dev/null || exit 1

CMD ["sh", "./start.sh"]
