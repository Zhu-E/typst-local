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
ARG PANDOC_VERSION=3.12.1
ARG PDF2DOCX_VERSION=0.5.13
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates fontconfig git curl python3 python3-venv \
 && ARCH="$(dpkg --print-architecture)" \
 && curl -fsSL "https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-linux-${ARCH}.tar.gz" \
    | tar -xz -C /usr/local --strip-components=1 "pandoc-${PANDOC_VERSION}/bin/pandoc" \
 && apt-get purge -y curl && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/pdf2docx \
 && /opt/pdf2docx/bin/pip install --no-cache-dir "pdf2docx==${PDF2DOCX_VERSION}"
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY scripts ./scripts
COPY --from=client /src/public ./public
COPY --from=engine /src/engine/target/release/typst-engine ./bin/typst-engine

ENV NODE_ENV=production \
    PDF2DOCX_PYTHON=/opt/pdf2docx/bin/python \
    PORT=3000 \
    DATA_DIR=/data \
    XDG_CACHE_HOME=/data/cache
VOLUME /data
EXPOSE 3000
CMD ["node", "server/index.js"]
