# syntax=docker/dockerfile:1

# Build from the repository root: docker build -f crates/gateway/Dockerfile -t minekubernetes/gateway .

FROM lukemathwalker/cargo-chef:0.1.78-rust-1.99-slim-trixie@sha256:c7b109b68df2196f7a8e5f370c4dfd5e4b5b98151f56c2a728887610dc8d1632 AS chef
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

FROM gcr.io/distroless/cc-debian13:nonroot@sha256:cb87acc574abe719b6e5c547384defa2f7b1f24af9605d3f618cf852495d8be2 AS runtime
LABEL org.opencontainers.image.source="https://github.com/BGLuis/mineK8s" \
      org.opencontainers.image.title="minekubernetes-gateway"
COPY --link --from=build /app/target/release/gateway /usr/local/bin/gateway
# 25565: Minecraft (tailnet); 9090: /metrics and /healthz.
EXPOSE 25565 9090
# main.rs shuts down only on Ctrl+C. As PID 1 the default SIGTERM is ignored, so the
# runtime would wait out the grace period and SIGKILL open player connections.
STOPSIGNAL SIGINT
ENTRYPOINT ["/usr/local/bin/gateway"]
