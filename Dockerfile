# Typst Local: collaborative Typst editor with the incremental native engine.

# ---- native compile engine ----
FROM rust:1.92-bookworm AS engine
WORKDIR /src/engine
COPY engine/Cargo.toml engine/Cargo.lock* ./
COPY engine/src ./src
RUN cargo build --release

# ---- browser client ----
FROM node:22-bookworm-slim AS client
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY build.mjs ./
COPY client ./client
RUN node build.mjs

# ---- runtime ----
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates fontconfig \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=client /src/public ./public
COPY --from=engine /src/engine/target/release/typst-engine ./bin/typst-engine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    XDG_CACHE_HOME=/data/cache
VOLUME /data
EXPOSE 3000
CMD ["node", "server/index.js"]
