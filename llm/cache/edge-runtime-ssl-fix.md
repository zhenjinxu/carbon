# Edge Runtime: Complete Fix for Corporate Proxy Module Resolution

## Problem

Edge functions (Supabase edge-runtime in Docker) hung indefinitely on every request behind a corporate proxy (dev-sidecar MITM). The previous SSL fix (2026-06-29) was insufficient — the runtime still hung during npm package resolution.

## Symptoms

- `curl` to edge functions through Kong (port 54322) hangs forever
- Edge-runtime container shows no error logs (just sits there)
- Kong returns 502/504 timeouts
- Individual function execution never starts

## Root Cause Chain

1. **`dev-sidecar.exe` intercepts HTTPS from Docker containers**: The MITM proxy presents its own CA cert, which the edge-runtime trusts (via `DENO_TLS_CA_STORE=system` + `update-ca-certificates`). TLS handshakes succeed but data transfer is unreliable — `hyper::Error(IncompleteMessage)` / `connection reset`.

2. **Deno FileFetcher always tries remote before cache**: For `https://deno.land/...` URLs, the runtime tries `fetch_remote_no_follow` → timeout → `fetch_cached_no_follow`. Slow but works.

3. **npm resolver connects to registry.npmjs.org**: After module resolution, the npm resolver opens a TLS connection to the npm registry for package validation/download. This connection hangs because the dev-sidecar proxy drops it mid-transfer.

4. **Missing npm packages in cache**: Even when most packages are cached, if ANY transitive dependency is missing (e.g. `encoding@0.1.13`, `@types/node@22.5.4`, `@supabase/cli-*`), the resolver tries to download it → hang.

5. **Container filesystem is ephemeral**: The Deno npm cache at `/root/.cache/deno/npm` is in the container's writable layer, which is destroyed on container recreation.

## Solution (3-layer defense)

### Layer 1: Pre-download all npm packages
Script: `packages/dev/docker/download-npm-cache.sh` (idempotent, re-run after dependency changes)

Downloads 38 packages from `registry.npmjs.org` on the HOST (where internet works) into `packages/dev/docker/npm-cache-preload/`:
- All `@supabase/*` packages + platform CLI binaries
- `kysely`, `kysely-supabase`, `zod`, `@internationalized/date`
- All transitive deps: `encoding`, `@types/node`, `undici-types`, etc.

### Layer 2: Entrypoint copies preload → npm cache
`packages/dev/docker/edge-entrypoint.sh`:
```sh
# Copies dev-sidecar CA cert into OS trust store
# Then copies npm-cache-preload/* → /root/.cache/deno/npm/registry.npmjs.org/
# Handles scoped (@scope+name-version) and unscoped (name-version) packages
```

### Layer 3: Docker volume persists the cache
Named volume `edge-npm-cache` mounted at `/root/.cache/deno/npm`.
Survives container recreation. Populated on first start from preload dir + any packages the runtime can download.

### Supporting fixes
- `packages/dev/docker/edge-main/index.ts`: Removed `import { STATUS_CODE } from "https://deno.land/std@0.224.0/http/status.ts"` (replaced with inline `404`/`500`). Prevents the main dispatcher from depending on remote modules.
- `.gitattributes`: Enforces `LF` line endings for `*.sh` and `packages/dev/docker/**` files. Prevents CRLF breakage on Windows.

## Files Modified

| File | Change |
|------|--------|
| `packages/dev/docker/edge-main/index.ts` | Removed remote deno.land import |
| `packages/dev/docker/edge-entrypoint.sh` | Added npm preload copy logic |
| `docker-compose.local.yml` | Added `edge-npm-cache` volume + `npm-cache-preload` bind mount |
| `.gitattributes` | LF enforcement for shell scripts |
| `packages/dev/docker/npm-cache-preload/` | 38 pre-downloaded npm packages |
| `packages/dev/docker/download-npm-cache.sh` | Script to (re)populate the preload dir |

## How to Refresh After Dependency Changes

```sh
# 1. Edit deno.json or add new npm imports in functions
# 2. Update download-npm-cache.sh with new packages
# 3. Re-run the script:
bash packages/dev/docker/download-npm-cache.sh
# 4. Restart edge-runtime (it picks up new preload on next start):
docker compose -f docker-compose.local.yml --env-file .env.local restart edge-runtime
```

## Verification

From a clean `docker compose up -d --force-recreate edge-runtime`:
- `get-method`: 16-30ms (first call may take ~18s for TS compilation)
- `post-receipt`: 27ms
- Both return ZodError / auth errors (expected business logic responses)

## Key Learnings

1. **dev-sidecar MITM affects Docker containers**: Even with `DENO_TLS_CA_STORE=system`, the Rust HTTP library in edge-runtime completes TLS handshake but drops data transfer. External DNS (`8.8.8.8`) does NOT bypass this — dev-sidecar intercepts at the TLS layer, not just DNS.

2. **Deno's FileFetcher fallback pattern**: Remote attempt → timeout → cache fallback. For `deno.land` URLs, this is slow but works. For npm registry, the timeout is infinite → total hang.

3. **npm cache is all-or-nothing**: If even one transitive dep is missing from cache, the resolver hangs. Must pre-populate ALL packages.

4. **Scoped package naming in preload**: Use `@scope+name-version` (e.g., `@supabase+supabase-js-2.33.1`). The `+` separates scope+name from version. The entrypoint parses this to construct the cache path.

5. **Docker named volumes persist across recreations**: Using `edge-npm-cache` volume at `/root/.cache/deno/npm` means the cache survives `docker compose up --force-recreate`.
