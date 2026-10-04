# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
# build toolchain for better-sqlite3 (native addon) and esbuild postinstall
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN (corepack enable && corepack prepare pnpm@10.26.0 --activate) || npm install -g pnpm@10.26.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/
RUN pnpm install --frozen-lockfile --filter '@bound/server...'

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN (corepack enable && corepack prepare pnpm@10.26.0 --activate) || npm install -g pnpm@10.26.0
COPY --from=deps /app /app
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/server apps/server
RUN mkdir -p /data && chown -R node:node /app /data
USER node
ENV DATABASE_PATH=/data/bound.db \
    PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@bound/server", "start"]
