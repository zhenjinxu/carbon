import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const deploymentRoot = path.join(
  repositoryRoot,
  "contrib",
  "deploying",
  "simple-docker-caddy"
);

function readRepositoryFile(...segments: string[]) {
  return readFileSync(path.join(repositoryRoot, ...segments), "utf8");
}

function readDeploymentFile(...segments: string[]) {
  return readFileSync(path.join(deploymentRoot, ...segments), "utf8");
}

describe("Ubuntu production Docker deployment", () => {
  it("uses the official deployment location as the only production entry point", () => {
    expect(
      existsSync(path.join(deploymentRoot, "docker-compose.prod.yml"))
    ).toBe(true);
    expect(existsSync(path.join(deploymentRoot, "deploy.sh"))).toBe(true);
    expect(
      existsSync(path.join(repositoryRoot, "docker-compose.prod.yml"))
    ).toBe(false);
    expect(
      existsSync(path.join(repositoryRoot, "docker-compose.stage1.yml"))
    ).toBe(false);
  });

  it("uses Swarm, Caddy, production Inngest, and real application health paths", () => {
    const stack = readDeploymentFile("docker-compose.prod.yml");
    const deploy = readDeploymentFile("deploy.sh");
    const caddy = readDeploymentFile("Caddyfile");

    expect(deploy).toContain("docker stack deploy");
    expect(stack).toContain("driver: overlay");
    expect(stack).toContain("- start");
    expect(stack).not.toContain("- dev");
    expect(stack).toContain("http://erp:3000/api/inngest");
    expect(stack).toContain("INNGEST_SERVE_HOST: http://erp:3000");
    expect(stack).toContain("SUPABASE_INTERNAL_URL: http://kong:8000");
    expect(stack.match(/SUPABASE_INTERNAL_URL: http:\/\/kong:8000/g)).toHaveLength(2);
    expect(stack).not.toContain("http://mes:3000/api/inngest");
    expect(stack).toContain("http://127.0.0.1:3000/health");
    expect(stack).not.toContain("http://localhost:3000/api/health");
    expect(caddy).toContain("reverse_proxy erp:3000");
    expect(caddy).toContain("reverse_proxy mes:3000");
    expect(caddy).not.toContain("try_files");
  });

  it("packages the current U8 importer and its runtime configuration", () => {
    const dockerfile = readRepositoryFile("Dockerfile");
    const packageJson = JSON.parse(
      readRepositoryFile("package.json")
    ) as {
      dependencies?: Record<string, string>;
    };
    const importer = readRepositoryFile("scripts", "import-u8-work-orders.cjs");
    const stack = readDeploymentFile("docker-compose.prod.yml");
    const environment = readDeploymentFile(".env.example");
    const deploy = readDeploymentFile("deploy.sh");

    expect(dockerfile).toContain("ARG APP");
    expect(dockerfile).toContain("RUN pnpm run build:${APP}");
    expect(dockerfile).toContain(
      "COPY scripts/import-u8-work-orders.cjs ./scripts/"
    );
    expect(dockerfile).toContain(
      "COPY scripts/lib/u8-work-order-identity.cjs ./scripts/lib/"
    );
    expect(dockerfile).toContain(
      "COPY --from=deps /repo/scripts ./scripts"
    );
    expect(packageJson.dependencies?.mssql).toBe("11.0.1");
    expect(importer).toContain('require("mssql")');
    expect(importer).not.toContain(
      'path.join(SOURCE_ROOT, "node_modules", "mssql")'
    );
    expect(environment).toContain("U8_SERVER=");
    expect(environment).toContain("U8_DATABASE=");
    expect(environment).toContain("U8_USER=");
    expect(environment).not.toContain("\uFFFD");
    expect(stack).toContain("U8_PASSWORD: __U8_PASSWORD__");
    expect(stack).toContain("u8_password:");
    expect(deploy).toContain("u8_password");
  });

  it("keeps all runtime credentials in guarded Swarm secrets", () => {
    const stack = readDeploymentFile("docker-compose.prod.yml");
    const environment = readDeploymentFile(".env.example");
    const deploy = readDeploymentFile("deploy.sh");

    expect(stack).toContain(
      "GOTRUE_EXTERNAL_GOOGLE_SECRET: __GOOGLE_OAUTH_CLIENT_SECRET__"
    );
    expect(stack).toContain(
      "GOTRUE_EXTERNAL_AZURE_SECRET: __AZURE_OAUTH_CLIENT_SECRET__"
    );
    expect(stack).toContain(
      "SECRET_KEY_BASE: __REALTIME_SECRET_KEY_BASE__"
    );
    expect(stack).toContain("DB_ENC_KEY: __REALTIME_DB_ENC_KEY__");
    expect(stack).toContain("VERIFY_JWT: ${EDGE_VERIFY_JWT:-true}");
    expect(stack).toContain(
      "JWT_DISABLED_FUNCTIONS: ${EDGE_JWT_DISABLED_FUNCTIONS:-image-resizer,logo-resizer}"
    );
    expect(environment).not.toContain(
      "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET="
    );
    expect(environment).not.toContain(
      "SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_SECRET="
    );
    expect(deploy).toContain("realtime_secret_key_base");
    expect(deploy).toContain("realtime_db_enc_key");
    expect(deploy).toContain("google_oauth_client_secret");
    expect(deploy).toContain("azure_oauth_client_secret");
    expect(deploy).toContain("database credential secrets are a managed pair");
    expect(deploy).toContain(
      "init --force is only allowed before pgdata exists"
    );
    expect(deploy).toContain(
      "Realtime encryption secrets require a dedicated rotation plan"
    );
    expect(deploy).toContain("DELETE_VOLUMES_CONFIRMED");
  });

  it("provides a guarded backup, restore, cutover, and rollback workflow", () => {
    const backup = readDeploymentFile("scripts", "backup.sh");
    const restore = readDeploymentFile("scripts", "restore.sh");
    const runbook = readRepositoryFile(
      "docs",
      "ubuntu-production-docker-migration.md"
    );

    expect(backup).toContain("pg_dump");
    expect(backup).not.toContain("--no-owner");
    expect(backup).not.toContain("--no-privileges");
    expect(backup).toContain("storage.tar.gz");
    expect(backup).toContain("BACKUP_CONFIRMED_QUIESCED=YES");
    expect(restore).toContain("RESTORE_CONFIRMED=YES");
    expect(restore).toContain("--single-transaction");
    expect(restore).not.toContain("--no-owner");
    expect(restore).not.toContain("--no-privileges");
    expect(restore).toContain("storage.tar.gz");
    expect(runbook).toContain("## Ubuntu");
    expect(runbook).toContain("## Data migration rehearsal");
    expect(runbook).toContain("## Production cutover");
    expect(runbook).toContain("## Rollback");
  });

  it("makes deployment helper scripts executable before invoking them", () => {
    const readme = readDeploymentFile("README.md");
    expect(readme.indexOf("chmod +x")).toBeGreaterThanOrEqual(0);
    expect(readme.indexOf("chmod +x")).toBeLessThan(
      readme.indexOf("sudo ./scripts/harden.sh")
    );
  });
});
