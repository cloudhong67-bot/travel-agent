# syntax=docker/dockerfile:1.7
# TripPilot 컨테이너 이미지 (PRD 9장) — node:22-alpine 멀티스테이지
#   deps → build(prisma generate → next build, standalone) → migrator(prisma CLI만) → runner
# 브라우저 공개 키(NEXT_PUBLIC_*)는 빌드 시점에 번들에 들어가므로 --build-arg로 넣는다. 서버 비밀값은 이미지에 넣지 않는다.

ARG NODE_IMAGE=node:22-alpine

# ---------- deps: 의존성 설치 ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# Prisma 스키마 엔진(migrate)이 openssl을 쓴다
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

# ---------- migrator: 런타임 마이그레이션용 Prisma CLI만 따로 설치 ----------
# standalone 출력에는 prisma CLI가 없으므로, 앱 node_modules와 섞지 않고 /migrate에 최소 설치한다
FROM ${NODE_IMAGE} AS migrator
WORKDIR /migrate
RUN apk add --no-cache openssl
ARG PRISMA_VERSION=7.10.1
ARG DOTENV_VERSION=18.0.9
# Studio·로컬 개발 서버용 의존성 중 migrate deploy에 필요 없는 것을 지운다 (약 55MB, 2026-10-27 실측 검증:
# 이 목록을 지운 상태에서 migrate deploy·status 정상. effect·@prisma/dev·@prisma/studio-core는 CLI 시작에 필요해 남긴다)
RUN npm init -y >/dev/null \
 && npm install --omit=dev --no-audit --no-fund "prisma@${PRISMA_VERSION}" "dotenv@${DOTENV_VERSION}" \
 && rm -rf node_modules/@prisma/query-plan-executor node_modules/@prisma/streams-local \
           node_modules/react-dom node_modules/@electric-sql node_modules/elkjs node_modules/@types \
 && npm cache clean --force

# ---------- runner ----------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1

# 실행에 필요한 것만: standalone 서버, 정적 파일, public, 마이그레이션(prisma 폴더 + CLI)
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=migrator --chown=node:node /migrate/node_modules ./migrate/node_modules
COPY --chown=node:node prisma ./migrate/prisma
COPY --chown=node:node prisma.config.ts ./migrate/prisma.config.ts
COPY --chown=node:node docker/start.sh ./start.sh

USER node
EXPOSE 3000

# 컨테이너 자체 상태 확인은 DB를 건드리지 않는 shallow 모드 (ACA 프로브는 Bicep에서 별도 설정)
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:3000/api/healthz?shallow=1" >/dev/null || exit 1

CMD ["sh", "./start.sh"]
