FROM node:20-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate \
  && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY services ./services

FROM base AS deps
RUN pnpm install --no-frozen-lockfile

FROM deps AS api
RUN pnpm --filter @wacalls/database generate && pnpm --filter @wacalls/shared --filter @wacalls/auth --filter @wacalls/queue --filter @wacalls/database --filter @wacalls/calling-engine --filter @wacalls/audio-engine --filter @wacalls/api build
WORKDIR /app/apps/api
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]

FROM deps AS worker
RUN pnpm --filter @wacalls/database generate && pnpm --filter @wacalls/shared --filter @wacalls/queue --filter @wacalls/database --filter @wacalls/calling-engine --filter @wacalls/audio-engine --filter @wacalls/worker build
WORKDIR /app/services/worker
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]

FROM deps AS whatsapp
USER root
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git python3 make g++ && rm -rf /var/lib/apt/lists/*
# Shared `deps` install has no compilers, so optional baileys-caller/wrtc is skipped.
# Reinstall here so outbound WhatsApp voice can load.
WORKDIR /app
RUN pnpm --filter @wacalls/calling-engine --filter @wacalls/whatsapp install --no-frozen-lockfile
RUN pnpm --filter @wacalls/database generate && pnpm --filter @wacalls/shared --filter @wacalls/calling-engine --filter @wacalls/audio-engine --filter @wacalls/database --filter @wacalls/whatsapp build
WORKDIR /app/services/whatsapp
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]

FROM deps AS web
ARG NEXT_PUBLIC_API_URL=
ARG NEXT_PUBLIC_WS_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
RUN pnpm --filter @wacalls/web build
WORKDIR /app/apps/web
ENV NODE_ENV=production
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]
