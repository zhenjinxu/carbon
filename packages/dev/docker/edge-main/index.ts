// Edge runtime dispatcher. Routes /functions/v1/<name>/* to <name>/index.ts.
// Required by supabase/edge-runtime when started with --main-service.
//
// NOTE: No remote imports (e.g. https://deno.land/...) are allowed here.
// The Deno module resolver hangs behind corporate SSL proxies even with
// DENO_TLS_CA_STORE=system. We inline the two HTTP status codes we need.

import { parseDisabledFunctions, verifyJwt } from "./jwt.ts";

const jwtSecret = Deno.env.get("JWT_SECRET") ?? "";
const verifyJwtEnabled = Deno.env.get("VERIFY_JWT") !== "false";
const jwtDisabledFunctions = parseDisabledFunctions(
  Deno.env.get("JWT_DISABLED_FUNCTIONS")
);

function jsonError(error: string, status: number) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const fnName = segments[0];
  if (!fnName) {
    return new Response("Not found", { status: 404 });
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(fnName)) {
    return new Response("Not found", { status: 404 });
  }

  if (verifyJwtEnabled && !jwtDisabledFunctions.has(fnName)) {
    if (!jwtSecret) {
      return jsonError("JWT verification is not configured", 500);
    }
    const authorization = req.headers.get("authorization") ?? "";
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
    if (!bearer || !(await verifyJwt(bearer[1], jwtSecret))) {
      return jsonError("Unauthorized", 401);
    }
  }

  const servicePath = `/home/deno/functions/${fnName}`;

  try {
    // @ts-ignore EdgeRuntime is provided by the supabase/edge-runtime image.
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb: 512,
      workerTimeoutMs: 5 * 60 * 1000,
      noModuleCache: false,
      envVars: Object.entries(Deno.env.toObject()),
    });
    return await worker.fetch(req);
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
        function: fnName,
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
});
