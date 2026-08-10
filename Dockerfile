# syntax=docker/dockerfile:1
# Shared build for React Router SSR apps. Build: docker build --build-arg APP=erp -t carbon/erp .
ARG APP
ARG SUPABASE_CLI_VERSION=2.89.0
ARG SUPABASE_CLI_SOURCE=supabase-cli-download

FROM alpine:3 AS supabase-cli-download
ARG SUPABASE_CLI_VERSION
ARG TARGETARCH
RUN apk add --no-cache ca-certificates curl
RUN --mount=type=secret,id=dev_sidecar_ca,required=false \
    set -eu; \
    if [ -s /run/secrets/dev_sidecar_ca ]; then \
      cp /run/secrets/dev_sidecar_ca /usr/local/share/ca-certificates/dev-sidecar.crt; \
      update-ca-certificates; \
    fi; \
    case "$TARGETARCH" in \
      amd64|arm64) cli_arch="$TARGETARCH" ;; \
      *) echo "Unsupported Supabase CLI architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    asset="supabase_linux_${cli_arch}.tar.gz"; \
    base_url="https://github.com/supabase/cli/releases/download/v${SUPABASE_CLI_VERSION}"; \
    curl -fL --retry 5 --retry-all-errors --retry-delay 5 --connect-timeout 20 --max-time 600 \
      -o /tmp/checksums.txt "${base_url}/supabase_${SUPABASE_CLI_VERSION}_checksums.txt"; \
    curl -fL --retry 5 --retry-all-errors --retry-delay 5 --connect-timeout 20 --max-time 600 \
      -o "/tmp/${asset}" "${base_url}/${asset}"; \
    grep "  ${asset}$" /tmp/checksums.txt >/tmp/checksum.txt; \
    cd /tmp; \
    sha256sum -c checksum.txt; \
    tar -xzf "$asset" -C /usr/local/bin supabase; \
    test "$(/usr/local/bin/supabase --version)" = "$SUPABASE_CLI_VERSION"

FROM ${SUPABASE_CLI_SOURCE} AS supabase-cli

FROM node:22 AS deps
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json lingui.config.js ./
COPY apps ./apps
COPY packages ./packages
COPY patches ./patches
COPY scripts/import-u8-work-orders.cjs ./scripts/
COPY scripts/import-u8-bom-parts.cjs ./scripts/
COPY scripts/lib/u8-bom-carbon.cjs ./scripts/lib/
COPY scripts/lib/u8-bom-source.cjs ./scripts/lib/
COPY scripts/lib/u8-bom-tree.cjs ./scripts/lib/
COPY scripts/lib/u8-work-order-identity.cjs ./scripts/lib/
RUN --mount=type=cache,id=carbon-pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=secret,id=dev_sidecar_ca,required=false \
    set -eu; \
    if [ -s /run/secrets/dev_sidecar_ca ]; then \
      export NODE_EXTRA_CA_CERTS=/run/secrets/dev_sidecar_ca; \
    fi; \
    pnpm install --frozen-lockfile --ignore-scripts && \
    pnpm rebuild @biomejs/biome @swc/core @tailwindcss/oxide core-js esbuild protobufjs

FROM deps AS build
ARG APP
ARG NODE_OPTIONS="--max-old-space-size=8024"
ENV NODE_OPTIONS=${NODE_OPTIONS}
RUN pnpm run build:${APP}

FROM node:22-slim AS runner
ARG APP
ARG SUPABASE_CLI_VERSION
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=deps /repo/package.json /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml /repo/.npmrc ./
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/packages ./packages
COPY --from=deps /repo/scripts ./scripts
COPY --from=build /repo/apps/${APP} ./apps/${APP}
COPY --from=supabase-cli /usr/local/bin/supabase /usr/local/bin/supabase
RUN test "$(supabase --version)" = "$SUPABASE_CLI_VERSION"
EXPOSE 3000
WORKDIR /repo/apps/${APP}
CMD ["node","./node_modules/@react-router/serve/bin.js","./build/server/index.js"]
