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
RUN pnpm --filter @wacalls/database generate && pnpm --filter @wacalls/shared --filter @wacalls/auth --filter @wacalls/queue --filter @wacalls/database --filter @wacalls/api build
WORKDIR /app/apps/api
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]

FROM deps AS worker
RUN pnpm --filter @wacalls/database generate && pnpm --filter @wacalls/shared --filter @wacalls/queue --filter @wacalls/database --filter @wacalls/worker build
WORKDIR /app/services/worker
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]

FROM deps AS whatsapp
USER root
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN pnpm --filter @wacalls/database generate && pnpm --filter @wacalls/shared --filter @wacalls/calling-engine --filter @wacalls/database --filter @wacalls/whatsapp build
WORKDIR /app/services/whatsapp
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]

FROM deps AS web
RUN pnpm --filter @wacalls/web build
WORKDIR /app/apps/web
ENV NODE_ENV=production
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]
