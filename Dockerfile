# syntax=docker/dockerfile:1.7
# One image, two processes: API (default CMD) and worker (`node dist/src/worker.js`).
# Debian slim (not Alpine): Chromium + Thai fonts for server-side PDFs (puppeteer-core, B2.5).

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app

# --- build: full install, Prisma client generation, compile --------------------------------------
FROM base AS build
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# --- prod-deps: runtime dependencies only (no scripts: the Prisma client is already compiled) ----
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --ignore-scripts

# --- runtime ------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini ca-certificates chromium fonts-thai-tlwg fonts-noto-core \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PDF_CHROMIUM_PATH=/usr/bin/chromium
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/prisma ./prisma
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/src/main.js"]
