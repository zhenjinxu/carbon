# Edge Runtime SSL Certificate Fix

## Problem

Edge Runtime (Deno-based, running in Docker) was failing with SSL errors when loading npm packages:
```
worker boot error: failed to bootstrap runtime: failed to create the graph: 
Failed loading https://registry.npmjs.org/@types%2fnode for package "@types/node": 
error sending request for url: invalid peer certificate: UnknownIssuer
```

This caused ALL edge functions to fail, which in turn caused:
- "Failed to create receipt" errors
- ERP app crashes on routes that invoke Supabase Edge Functions

## Root Cause Chain

Multiple issues combined:

### 1. `HOME` not set in `.env.local`
- Docker Compose uses `${HOME}` for volume mount path of the dev-sidecar CA cert
- `.env.local` didn't define `HOME` (PowerShell doesn't export `HOME` by default)
- Result: Volume mount source resolved to `/.dev-sidecar/dev-sidecar.ca.crt` (empty HOME) → file not found → CA cert never mounted into container

### 2. dev-sidecar MITM proxy intercepting npmjs.org
- The dev-sidecar tool on the Windows host intercepts HTTPS traffic via DNS poisoning
- It presents its own CA-signed certificate for `registry.npmjs.org`
- Deno's rustls (not OpenSSL) doesn't trust the dev-sidecar CA by default

### 3. `--cert` flag only applies to main service, not user workers
- The `--cert /etc/ssl/certs/dev-sidecar-ca.crt` flag was passed to `edge-runtime start`
- But user workers (created via `EdgeRuntime.userWorkers.create()`) don't inherit this flag
- The npm package resolver in user workers still failed SSL validation

### 4. `DENO_TLS_CA_STORE=mozilla` insufficient
- `mozilla` store only includes Mozilla's built-in root CAs
- The dev-sidecar CA is a custom CA not in Mozilla's store
- Need `system` store + cert injected into OS trust store

### 5. Kong timeout too short for first bootstrap
- Default Kong timeout: 60 seconds
- First edge function bootstrap needs to download npm packages (slow through MITM proxy)
- Kong gave up before the worker could finish bootstrapping

## Solution

### File: `.env.local`
Added `HOME` variable for Docker Compose volume mount resolution:
```
HOME=C:/Users/zhenjin_xu
```

### File: `docker-compose.local.yml` (edge-runtime service)
1. Added `DENO_CERT` env var (applies to all Deno processes including workers):
   ```yaml
   DENO_TLS_CA_STORE: system
   DENO_CERT: /etc/ssl/certs/dev-sidecar-ca.crt
   ```
2. Added external DNS to bypass dev-sidecar DNS interception:
   ```yaml
   dns:
     - 8.8.8.8
     - 8.8.4.4
   ```
3. Added custom entrypoint volume mount:
   ```yaml
   - ./packages/dev/docker/edge-entrypoint.sh:/home/deno/entrypoint.sh:ro
   entrypoint: ["/bin/sh", "/home/deno/entrypoint.sh"]
   ```

### File: `packages/dev/docker/edge-entrypoint.sh` (new)
Copies the dev-sidecar CA cert into the Debian system trust store before starting edge-runtime:
```bash
#!/bin/sh
if [ -f /etc/ssl/certs/dev-sidecar-ca.crt ]; then
  cp /etc/ssl/certs/dev-sidecar-ca.crt /usr/local/share/ca-certificates/dev-sidecar-ca.crt
  update-ca-certificates --fresh >/dev/null 2>&1
fi
exec edge-runtime "$@"
```

### File: `packages/dev/docker/kong.yml` (functions-v1 service)
Increased timeouts from default 60s to 300s (in milliseconds):
```yaml
connect_timeout: 300000
write_timeout: 300000
read_timeout: 300000
```

## Why external DNS was the key fix
Even with the CA cert properly mounted, Deno's npm resolver in user workers was slow/unreliable through the MITM proxy. By using Google DNS (8.8.8.8), `registry.npmjs.org` resolves to the real Cloudflare/AWS servers with valid public certificates, completely bypassing the MITM interception.

## Key Learnings

1. **Docker Compose variable resolution**: `${HOME}` in docker-compose.yml resolves from `.env`/`.env.local`, NOT from the shell environment. Must be explicitly set.

2. **Deno TLS configuration**:
   - `DENO_TLS_CA_STORE=system` → Use OS certificate store (Debian: `/etc/ssl/certs/`)
   - `DENO_TLS_CA_STORE=mozilla` → Use Mozilla's root certificates (built-in)
   - `--cert=<file>` → Add custom CA certificate (main process only, not user workers)
   - `DENO_CERT=<file>` → Env var version of `--cert` (may apply to workers)

3. **Deno ≠ Node.js**: Deno uses Rust's `rustls`, not OpenSSL. `SSL_CERT_FILE` and `NODE_EXTRA_CA_CERTS` don't work.

4. **Kong timeouts are in milliseconds** in the declarative config (`kong.yml`).

5. **PowerShell Quirks**: `$env:HOME` is not set by default; use `$env:USERPROFILE`.

## Related Files
- `docker-compose.local.yml` — edge-runtime service config
- `packages/dev/docker/edge-entrypoint.sh` — CA cert injection script
- `packages/dev/docker/kong.yml` — API gateway timeout config
- `.env.local` — HOME variable for Docker volume mounts

## References
- Fixed: 2026-06-29
- Context: Edge Runtime SSL certificate validation in containerized environment with dev-sidecar MITM proxy
