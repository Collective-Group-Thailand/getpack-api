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
# tsc outgrew Node's default heap (U-B1, 2026-10-04).
RUN NODE_OPTIONS=--max-old-space-size=6144 pnpm build

# --- prod-deps: runtime dependencies only (no scripts: the Prisma client is already compiled) ----
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --ignore-scripts

# --- model: the content-search embedding model (D-427, ADR-0013), fetched once at build time -------------
FROM ${NODE_IMAGE} AS model
ARG E5_REPO=Xenova/multilingual-e5-small
# Pin to a commit of the model repository; `scripts/fetch-embedding-model.sh` checks the ONNX file's SHA-256 when given.
ARG E5_REVISION=main
ARG E5_ONNX_SHA256=
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY scripts/fetch-embedding-model.sh /tmp/fetch-embedding-model.sh
RUN sh /tmp/fetch-embedding-model.sh "$E5_REPO" "$E5_REVISION" /models/multilingual-e5-small "$E5_ONNX_SHA256"

# --- runtime ------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
# Chromium + Thai fonts for server-side PDFs; poppler + Tesseract (Thai, English) read documents for content search.
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini ca-certificates chromium fonts-thai-tlwg fonts-noto-core \
     poppler-utils tesseract-ocr tesseract-ocr-tha \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PDF_CHROMIUM_PATH=/usr/bin/chromium FILE_SEARCH_MODEL_DIR=/app/models/multilingual-e5-small
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/prisma ./prisma
# ADR-0010: the pinned @getpack/dieline bundle the drawing service loads at run time.
COPY --from=build --chown=node:node /app/vendor ./vendor
COPY --from=model --chown=node:node /models ./models
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/src/main.js"]
