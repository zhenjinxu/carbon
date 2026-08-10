# Carbon on a single VPS — Docker Swarm + Caddy

Self-host the full Carbon stack (ERP + MES + Supabase + Redis + Inngest) on **one
Linux VPS** as a single-node [Docker Swarm](https://docs.docker.com/engine/swarm/)
behind an automatic-HTTPS [Caddy](https://caddyserver.com/docs/) reverse proxy.
Secrets are real Docker Swarm secrets; only ports 80/443 are exposed.

## 📖 Full guide → [docs.carbon.ms/docs/platform/self-hosting/docker-caddy](https://docs.carbon.ms/docs/platform/self-hosting/docker-caddy)

This fork's Ubuntu migration, cutover, restore, and rollback runbook is in
[`docs/ubuntu-production-docker-migration.md`](../../../docs/ubuntu-production-docker-migration.md).

Prerequisites, step-by-step install, how secrets work, operations, and the
production checklist all live in the docs. Quick version:

```bash
chmod +x deploy.sh bin/*.sh postgres/*.sh scripts/*.sh
sudo ./scripts/harden.sh    # firewall, fail2ban, swap (optional, recommended)
./deploy.sh init            # swarm init + generate Docker secrets + .env
$EDITOR .env                # hosts, URLs, ACME email, SMTP
./deploy.sh up              # build + deploy + migrate
./deploy.sh status
```

`deploy.sh init` generates the database, Supabase, session, Inngest, and Realtime
secrets. Set SMTP, Resend, U8, and enabled OAuth client secrets with
`./deploy.sh secret`. Database credentials and the Supabase JWT trio are managed
groups and cannot be replaced one value at a time.
`deploy.sh init --force` is restricted to a fresh stack with no `pgdata` volume;
it is not a production secret-rotation shortcut.

`./deploy.sh down --volumes` is intentionally guarded because it permanently
deletes production data. It requires `DELETE_VOLUMES_CONFIRMED` to equal the
current stack name; routine rollback and secret rotation must never delete data
volumes.

## Files

| File | Purpose |
|---|---|
| `docker-compose.prod.yml` | The Swarm stack (all services, secrets, volumes, overlay network). |
| `deploy.sh` | Lifecycle: `init` / `build` / `deploy` / `up` / `migrate` / `secret` / `status` / `logs` / `down`. |
| `Caddyfile` | Reverse proxy: erp/mes/api + security headers; optional Studio behind basic-auth. |
| `bin/secrets-entrypoint.sh` | Injects Swarm secrets into env (`__SECRET__` placeholders) for each service. |
| `postgres/01-roles.sh` | Supabase role bootstrap. |
| `postgres/02-performance.sh` | Postgres tuning + `pg_stat_statements`. |
| `scripts/gen-supabase-keys.sh` | Generates the Supabase JWT key trio (openssl only). |
| `scripts/harden.sh` | Host hardening (UFW, fail2ban, swap, unattended-upgrades). |
| `scripts/backup.sh` | Quiesced Postgres, Storage, and Inngest backup. |
| `scripts/restore.sh` | Guarded Postgres, Storage, and Inngest restore. |
| `.env.example` | Non-secret configuration template. |
