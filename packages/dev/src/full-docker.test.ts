import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

type ComposeService = {
  image?: string;
  build?: { args?: Record<string, string> };
  command?: string[];
  environment?: Record<string, string>;
  ports?: string[];
  healthcheck?: { test?: string[] };
};

type ComposeConfig = {
  services: Record<string, ComposeService>;
};

function read(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

function renderCompose(path: string) {
  const output = execFileSync(
    "docker",
    [
      "compose",
      "--env-file",
      ".env.example",
      "-f",
      path,
      "config",
      "--format",
      "json"
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CARBON_WORKTREE: "test",
        PORT_DB: "54000",
        PORT_API: "54001",
        PORT_STUDIO: "54002",
        PORT_INBUCKET: "54003",
        PORT_INNGEST: "54004",
        PORT_ERP: "54005",
        PORT_MES: "54006",
        PORT_REDIS: "54007",
        SUPABASE_JWT_SECRET: "test-secret",
        SUPABASE_ANON_KEY: "test-anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
        ERP_URL: "http://localhost:54005",
        MES_URL: "http://localhost:54006",
        DOMAIN: "localhost",
        SUPABASE_URL: "http://localhost:54001",
        PORTLESS_TLD: "dev"
      }
    }
  );
  return JSON.parse(output) as ComposeConfig;
}

function requireService(compose: ComposeConfig, name: string) {
  const service = compose.services[name];
  if (!service) {
    throw new Error(`Compose service "${name}" is missing`);
  }
  return service;
}

describe("Windows full-Docker development contract", () => {
  it("runs the complete Carbon service set in Compose", () => {
    const compose = renderCompose("docker-compose.local.yml");
    expect(Object.keys(compose.services)).toEqual(
      expect.arrayContaining(["postgres", "redis", "erp", "mes"])
    );
    expect(requireService(compose, "postgres").image).toBe(
      "public.ecr.aws/supabase/postgres:17.6.1.105"
    );
    expect(requireService(compose, "erp").build?.args?.APP).toBe("erp");
    expect(requireService(compose, "mes").build?.args?.APP).toBe("mes");
    expect(read("docker-compose.full.yml")).toContain(
      '"${PORT_REDIS:-6379}:6379"'
    );
    expect(
      requireService(compose, "erp").build?.args?.SUPABASE_CLI_SOURCE
    ).toBe("carbon/supabase-cli:2.89.0");
  });

  it("installs the required CLI without an unbounded package postinstall", () => {
    const dockerfile = read("Dockerfile");
    const deploy = read("contrib/deploying/simple-docker-caddy/deploy.sh");
    expect(dockerfile).toContain("FROM alpine:3 AS supabase-cli");
    expect(dockerfile).toContain("mount=type=cache");
    expect(dockerfile).toContain(
      "pnpm install --frozen-lockfile --ignore-scripts"
    );
    expect(dockerfile).toContain("pnpm rebuild");
    expect(dockerfile).toContain("sha256sum -c");
    expect(dockerfile).toContain(
      "type=secret,id=dev_sidecar_ca,required=false"
    );
    expect(dockerfile).toContain("update-ca-certificates");
    expect(dockerfile).toContain("NODE_EXTRA_CA_CERTS");
    expect(dockerfile).toContain(
      "ARG SUPABASE_CLI_SOURCE=supabase-cli-download"
    );
    expect(dockerfile).toContain(
      ["FROM $", "{SUPABASE_CLI_SOURCE} AS supabase-cli"].join("")
    );
    expect(dockerfile).not.toContain("id=supabase_cli_binary");
    expect(dockerfile).toContain("supabase --version");
    expect(dockerfile).toContain("COPY --from=supabase-cli");
    expect(deploy).toContain("sh -c 'supabase migration up");
    expect(deploy).not.toContain("pnpm exec supabase migration up");
  });

  it("uses Docker DNS for data-plane and Inngest traffic", () => {
    const compose = renderCompose("docker-compose.local.yml");
    const inngestRoute = read("apps/erp/app/routes/api+/inngest.ts");
    expect(
      requireService(compose, "gotrue").environment?.GOTRUE_DB_DATABASE_URL
    ).toContain("@postgres:5432/postgres");
    expect(
      requireService(compose, "erp").environment?.SUPABASE_DB_URL
    ).toContain("@postgres:5432/postgres");
    expect(requireService(compose, "erp").environment?.REDIS_URL).toContain(
      "redis://redis:6379/"
    );
    expect(
      requireService(compose, "erp").environment?.SUPABASE_INTERNAL_URL
    ).toBe("http://kong:8000");
    expect(requireService(compose, "inngest").command?.join(" ")).toContain(
      "http://erp:3000/api/inngest"
    );
    expect(inngestRoute).toContain(
      "process.env.INNGEST_SERVE_HOST ?? process.env.ERP_URL"
    );
    expect(JSON.stringify(compose.services)).not.toContain(
      "host.docker.internal"
    );
  });

  it("separates browser and server Supabase URLs", () => {
    const client = read("packages/auth/src/lib/supabase/client.ts");
    expect(client).toContain("SUPABASE_INTERNAL_URL");
    expect(client).toContain('typeof window === "undefined"');
  });

  it("uses healthchecks supported by each image", () => {
    const compose = renderCompose("docker-compose.local.yml");
    expect(requireService(compose, "postgrest").healthcheck).toBeUndefined();
    expect(
      requireService(compose, "realtime").healthcheck?.test?.join(" ")
    ).toContain("curl -fsS http://127.0.0.1:4000/");
    expect(
      requireService(compose, "storage").healthcheck?.test?.join(" ")
    ).toContain("http://127.0.0.1:5000/status");
  });

  it("does not start native Redis or host React Router apps", () => {
    const up = read("packages/dev/src/commands/up.ts");
    const composeService = read("packages/dev/src/services/compose.ts");
    expect(up).not.toMatch(/\bbootSharedRedis\b/);
    expect(up).not.toMatch(/\bspawnApps\b/);
    expect(composeService).not.toContain('execa("redis-server"');
  });

  it("keeps Windows lifecycle scripts Docker-only and volume-preserving", () => {
    const start = read("scripts/start-local.bat");
    const stop = read("scripts/stop-local.bat");
    const composePrefix =
      "docker compose --env-file .env.local -f docker-compose.local.yml -p carbon";

    expect(start).toContain(`${composePrefix} config --quiet`);
    expect(start).toContain(`${composePrefix} up -d --build --wait`);
    expect(stop).toContain(`${composePrefix} stop`);
    expect(`${start}\n${stop}`).not.toMatch(
      /postgresql-x64-18|redis-server|react-router dev|taskkill|net (start|stop)|localhost:54321|down -v/i
    );
  });

  it("fails fast for hybrid-only CLI modes", () => {
    const up = read("packages/dev/src/commands/up.ts");
    const main = read("packages/dev/src/main.ts");
    expect(up).toContain("--no-apps is not supported in full-Docker mode");
    expect(up).toContain("--borrow is not supported in full-Docker mode");
    expect(main).toContain("Unsupported in full-Docker mode");
  });

  it("keeps local and Ubuntu PostgreSQL versions and roles aligned", () => {
    const production = read(
      "contrib/deploying/simple-docker-caddy/docker-compose.prod.yml"
    );
    expect(production).toContain(
      "image: public.ecr.aws/supabase/postgres:17.6.1.105"
    );
    expect(read("packages/dev/docker/init.sql")).toContain(
      "supabase_functions_admin"
    );
    expect(
      read("contrib/deploying/simple-docker-caddy/postgres/01-roles.sh")
    ).toContain("supabase_functions_admin");
  });
});
