# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the VGuardrail Audit Cloud server.
#
#   builder — compile the `server` binary in release mode.
#   runtime — distroless image with the binary + CA roots only.
#
# The server is **not** a member of the `backend/lambdas/` workspace
# (it lives in `backend/server/`). It has its own `Cargo.toml` with
# path-deps to the `app` / `aws` / `audit-core` crates, which Cargo
# resolves automatically. (cargo-chef cannot skeleton path-deps that live
# outside the crate's workspace, so dependency caching uses BuildKit cache
# mounts instead: the cargo registry and target dir persist across builds,
# and only changed crates recompile.)
#
# Base image is pinned to match the host/CI toolchain (1.96). The transitive
# AWS SDK crates in Cargo.lock require rustc >= 1.91.1.

# ── 1. Builder (compile binary; deps cached via cache mounts) ────────────────
FROM rust:1.96-bookworm AS builder
# HTTPS sources + bounded retries/timeouts: plain-HTTP fetches from
# deb.debian.org stall for hours on some networks, hanging the whole build.
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n' \
       > /etc/apt/apt.conf.d/99-vg-network \
    && apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates pkg-config libssl-dev protobuf-compiler cmake \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build

COPY backend/server                ./backend/server
COPY backend/lambdas               ./backend/lambdas
COPY policy-engine                 ./policy-engine

# The target dir lives in a cache mount, so the binary must be copied out
# within the same RUN (the mount is not part of the image layer).
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/backend/server/target \
    cd backend/server \
    && cargo build --release --bin server \
    && cp target/release/server /build/server \
    && strip /build/server

# ── 2. Runtime (distroless) ─────────────────────────────────────────────────
FROM gcr.io/distroless/cc-debian12 AS runtime
WORKDIR /app

# Non-root user is provided by the base image (uid 65532).
COPY --from=builder /build/server /app/server

ENV BIND_ADDR=0.0.0.0:8080 \
    RUST_LOG=info \
    RUST_BACKTRACE=1

EXPOSE 8080

# The distroless base does not provide a shell; we exec the binary directly.
ENTRYPOINT ["/app/server"]
