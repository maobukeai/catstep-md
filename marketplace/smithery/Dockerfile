# Smithery Dockerfile — fallback runtime for users whose platforms aren't
# covered by the prebuilt binaries in smithery.yaml's `binary.downloads`.
#
# Smithery defaults to `runtime: binary` (faster, no Docker required) but
# will pull this image if a user opts into Docker mode or runs on an
# unsupported arch. The image is also useful for CI / containerised
# deployments where mounting a Markdown vault is more ergonomic than
# pinning a binary.
#
# Build: docker build -t catstep-mcp -f marketplace/smithery/Dockerfile .
# Run:   docker run -i --rm -v ~/notes:/vault catstep-mcp --workspace /vault

# Stage 1 — build catstep-mcp from source.
FROM rust:1.83-slim AS builder
WORKDIR /src

# Copy the workspace's Cargo metadata + the mcp-server crate. We don't need
# the full app/ tree (Tauri + node_modules would explode the image).
COPY Cargo.toml Cargo.lock ./
COPY mcp-server/ ./mcp-server/

# Hint cargo to build only the mcp-server crate so the image stays small.
RUN cargo build --release --bin catstep-mcp -p catstep-mcp \
    && strip target/release/catstep-mcp

# Stage 2 — minimal runtime.
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /src/target/release/catstep-mcp /usr/local/bin/catstep-mcp

# Smithery passes the `--workspace` (and friends) at runtime via the
# arguments rendered from smithery.yaml. Default to read-only.
ENTRYPOINT ["/usr/local/bin/catstep-mcp"]

# Smithery convention: stdio servers don't EXPOSE anything. The MCP
# JSON-RPC is over stdin/stdout — no HTTP, no port.
LABEL org.opencontainers.image.title="catstep-mcp"
LABEL org.opencontainers.image.description="MCP server for Catstep MD Markdown vaults"
LABEL org.opencontainers.image.url="https://github.com/maobukeai/catstep-md"
LABEL org.opencontainers.image.source="https://github.com/maobukeai/catstep-md"
LABEL org.opencontainers.image.licenses="MIT"
