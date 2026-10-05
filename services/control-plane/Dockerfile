# syntax=docker/dockerfile:1

# Build from the repository root: docker build -f services/control-plane/Dockerfile -t minekubernetes/control-plane .
# The image mirrors the repo layout under /app so main.ts finds the SPA, proto/ and the
# Tailscale policy at their default paths, without WEB_DIST_DIR.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe AS base

FROM base AS deps
WORKDIR /app/services/control-plane
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=bind,source=services/control-plane/package.json,target=package.json \
    --mount=type=bind,source=services/control-plane/package-lock.json,target=package-lock.json \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM base AS build
WORKDIR /app/services/control-plane
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=bind,source=services/control-plane/package.json,target=package.json \
    --mount=type=bind,source=services/control-plane/package-lock.json,target=package-lock.json \
    npm ci --ignore-scripts --no-audit --no-fund
COPY services/control-plane ./
RUN npm run build

FROM base AS web
WORKDIR /app/services/web
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=bind,source=services/web/package.json,target=package.json \
    --mount=type=bind,source=services/web/package-lock.json,target=package-lock.json \
    npm ci --ignore-scripts --no-audit --no-fund
COPY services/web ./
RUN npm run build

# Distroless has no shell to mkdir; these are the paths the control plane writes to by default
# (SERVERS_DATA_ROOT, BACKUPS_PATH, SHARED_CACHE_PATH), owned by nonroot so empty volumes inherit it.
FROM base AS writable-dirs
RUN mkdir -p /out/app/storage/servers /out/backups /out/cache

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e AS runtime
LABEL org.opencontainers.image.source="https://github.com/BGLuis/mineK8s" \
      org.opencontainers.image.title="minekubernetes-control-plane"
WORKDIR /app
ENV NODE_ENV=production
COPY --link --from=deps /app/services/control-plane/node_modules services/control-plane/node_modules
COPY --link --from=build /app/services/control-plane/dist services/control-plane/dist
COPY --link services/control-plane/package.json services/control-plane/
COPY --link --from=web /app/services/web/dist/web/browser services/web/dist/web/browser
COPY --link proto proto
COPY --link k8s/tailscale/policy.hujson k8s/tailscale/
COPY --link --from=writable-dirs --chown=65532:65532 /out/ /
# 3000: API + SPA; 50051: gRPC for the gateway.
EXPOSE 3000 50051
# The distroless entrypoint is already node.
CMD ["services/control-plane/dist/main.js"]
