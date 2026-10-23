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
COPY patches ./patches
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
# tsc outgrew Node's default heap (U-B1, 2026-10-04).
RUN NODE_OPTIONS=--max-old-space-size=6144 pnpm build

# --- prod-deps: runtime dependencies only (no scripts: the Prisma client is already compiled) ----
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
# pnpm.patchedDependencies must resolve even with --ignore-scripts, or install exits 254 (ENOENT)
COPY patches ./patches
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --ignore-scripts

# --- prisma-cli: `prisma migrate deploy` for the one-shot migrate container -----------------------
# The CLI is a devDependency, so it is installed apart from /app/node_modules at the exact version
# package.json pins. Its config sits beside it so `prisma/config` resolves.
FROM ${NODE_IMAGE} AS prisma-cli
WORKDIR /opt/prisma-cli
# openssl lets Prisma pick the libssl3 schema-engine build (slim images have no openssl binary)
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json /tmp/app-package.json
RUN version=$(node -p "require('/tmp/app-package.json').devDependencies.prisma") \
  && echo '{"private":true}' > package.json \
  && npm install --no-audit --no-fund --omit=dev "prisma@${version}" \
  && npm cache clean --force && rm /tmp/app-package.json
COPY prisma.deploy.config.ts ./prisma.config.ts

# --- runtime ------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini ca-certificates openssl chromium fonts-thai-tlwg fonts-noto-core \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PDF_CHROMIUM_PATH=/usr/bin/chromium
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/prisma ./prisma
# ADR-0010: the pinned @getpack/dieline bundle the drawing service loads at run time.
COPY --from=build --chown=node:node /app/vendor ./vendor
COPY --from=prisma-cli /opt/prisma-cli /opt/prisma-cli
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/src/main.js"]
