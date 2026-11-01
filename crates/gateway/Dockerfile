# syntax=docker/dockerfile:1

# Build from the repository root: docker build -f crates/gateway/Dockerfile -t minekubernetes/gateway .

FROM lukemathwalker/cargo-chef:0.1.78-rust-1.99-slim-trixie@sha256:f122e3c240d1c05668b07179cf6fa07647db2a79a110f4bb8a91d75f90d5b8e4 AS chef
WORKDIR /app

FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS build
COPY --from=planner /app/recipe.json recipe.json
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    cargo chef cook --release --locked -p gateway --recipe-path recipe.json
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    cargo build --release --locked -p gateway --bin gateway

FROM gcr.io/distroless/cc-debian13:nonroot@sha256:08476c244888bfb425bae1ae4dd7c17f093e972aab8426883d97f3c6f280f7c1 AS runtime
LABEL org.opencontainers.image.source="https://github.com/BGLuis/mineK8s" \
      org.opencontainers.image.title="minekubernetes-gateway"
COPY --link --from=build /app/target/release/gateway /usr/local/bin/gateway
# 25565: Minecraft (tailnet); 9090: /metrics and /healthz.
EXPOSE 25565 9090
# main.rs shuts down only on Ctrl+C. As PID 1 the default SIGTERM is ignored, so the
# runtime would wait out the grace period and SIGKILL open player connections.
STOPSIGNAL SIGINT
ENTRYPOINT ["/usr/local/bin/gateway"]
