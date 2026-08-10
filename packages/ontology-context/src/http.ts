import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import {
  contextQuerySchema,
  type DatasetId,
  type ProjectSnapshotAuthority,
  projectSnapshotAuthoritySchema,
  searchQuerySchema
} from "./contracts";
import {
  type HttpErrorCode,
  httpErrorEnvelopeSchema,
  httpSuccessEnvelopeSchema
} from "./schemas";
import type { OntologyService } from "./service";

const MAX_RESPONSE_BYTES = 256 * 1024;

export interface OntologyContextServerOptions {
  maxRequestsPerMinute?: number;
  maxResponseBytes?: number;
}

function requestId(): string {
  return `req_${randomUUID()}`;
}

function isDataset(value: string | null): value is DatasetId {
  return value === "deepseek" || value === "qwen";
}

function parseInteger(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) throw new Error("invalid_query");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("invalid_query");
  return parsed;
}

function assertAllowedKeys(
  params: URLSearchParams,
  allowed: ReadonlySet<string>
): void {
  for (const key of params.keys()) {
    if (!allowed.has(key)) throw new Error("invalid_query");
    if (params.getAll(key).length > 1) throw new Error("invalid_query");
  }
}

function parseMetadataQuery(params: URLSearchParams): { dataset: DatasetId } {
  assertAllowedKeys(params, new Set(["dataset"]));
  const dataset = params.get("dataset");
  if (dataset !== null && !isDataset(dataset)) throw new Error("invalid_query");
  return { dataset: dataset ?? "deepseek" };
}

function parseSearchQuery(params: URLSearchParams) {
  assertAllowedKeys(
    params,
    new Set(["dataset", "q", "type", "limit", "cursor"])
  );
  const dataset = params.get("dataset");
  if (dataset !== null && !isDataset(dataset)) throw new Error("invalid_query");
  const type = params.get("type");
  const limit = parseInteger(params.get("limit"));
  const result = searchQuerySchema.safeParse({
    ...(dataset ? { dataset } : {}),
    q: params.get("q") ?? "",
    ...(type ? { type } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(params.get("cursor") ? { cursor: params.get("cursor") } : {})
  });
  if (!result.success) throw new Error("invalid_query");
  return result.data;
}

function parseContextQuery(params: URLSearchParams) {
  assertAllowedKeys(
    params,
    new Set(["dataset", "objectId", "direction", "depth", "limit"])
  );
  const dataset = params.get("dataset");
  if (dataset !== null && !isDataset(dataset)) throw new Error("invalid_query");
  const depth = parseInteger(params.get("depth"));
  const limit = parseInteger(params.get("limit"));
  const result = contextQuerySchema.safeParse({
    ...(dataset ? { dataset } : {}),
    objectId: params.get("objectId") ?? "",
    ...(params.get("direction") ? { direction: params.get("direction") } : {}),
    ...(depth !== undefined ? { depth } : {}),
    ...(limit !== undefined ? { limit } : {})
  });
  if (!result.success) throw new Error("invalid_query");
  return result.data;
}

function writeJson(
  response: ServerResponse<IncomingMessage>,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): void {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders
  });
  response.end(serialized);
}

function errorDetails(error: unknown): {
  status: number;
  code: HttpErrorCode;
  message: string;
} {
  const code = error instanceof Error ? error.message : "snapshot_unavailable";
  switch (code) {
    case "invalid_query":
      return { status: 400, code, message: "Query parameters are invalid" };
    case "object_not_found":
      return {
        status: 404,
        code,
        message: "Object was not found in the selected dataset"
      };
    case "invalid_dataset":
      return {
        status: 400,
        code: "invalid_query",
        message: "The selected dataset is invalid"
      };
    case "snapshot_unavailable":
      return { status: 503, code, message: "Ontology snapshot is unavailable" };
    default:
      return {
        status: 500,
        code: "snapshot_unavailable",
        message: "Ontology snapshot is unavailable"
      };
  }
}
function successEnvelope<
  T extends {
    authority: ProjectSnapshotAuthority;
    warnings?: readonly string[];
  }
>(id: string, result: T) {
  const { authority: rawAuthority, warnings, ...data } = result;
  const authority = projectSnapshotAuthoritySchema.parse(rawAuthority);
  return httpSuccessEnvelopeSchema.parse({
    schemaVersion: 1 as const,
    requestId: id,
    authority,
    data,
    warnings: warnings ?? []
  });
}

function isOntologyPath(pathname: string): boolean {
  return [
    "/api/ontology/metadata",
    "/api/ontology/search",
    "/api/ontology/context"
  ].includes(pathname);
}

export function createOntologyContextServer(
  service: OntologyService,
  options: OntologyContextServerOptions = {}
): Server {
  const maxRequestsPerMinute = options.maxRequestsPerMinute ?? 60;
  const maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  let windowStartedAt = Date.now();
  let requestCount = 0;

  return createServer((request, response) => {
    const startedAt = Date.now();
    const id = requestId();
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    let status = 500;

    const finish = (
      result: unknown,
      responseStatus: number,
      headers?: Record<string, string>
    ) => {
      status = responseStatus;
      const validatedResult =
        typeof result === "object" && result !== null && "error" in result
          ? httpErrorEnvelopeSchema.parse(result)
          : httpSuccessEnvelopeSchema.parse(result);
      const payload = JSON.stringify(validatedResult);
      if (Buffer.byteLength(payload, "utf8") > maxResponseBytes) {
        status = 413;
        writeJson(
          response,
          status,
          httpErrorEnvelopeSchema.parse({
            schemaVersion: 1,
            requestId: id,
            error: {
              code: "response_too_large",
              message: "Ontology response exceeds the configured size limit"
            }
          })
        );
        return;
      }
      writeJson(response, status, validatedResult, headers);
    };

    const log = () => {
      console.info(
        JSON.stringify({
          event: "ontology_context_request",
          requestId: id,
          path: url.pathname,
          status,
          durationMs: Date.now() - startedAt
        })
      );
    };

    if (!isOntologyPath(url.pathname)) {
      finish(
        {
          schemaVersion: 1,
          requestId: id,
          error: { code: "not_found", message: "Resource was not found" }
        },
        404
      );
      log();
      return;
    }
    if (request.method !== "GET") {
      finish(
        {
          schemaVersion: 1,
          requestId: id,
          error: {
            code: "method_not_allowed",
            message: "Only GET is supported"
          }
        },
        405,
        { Allow: "GET" }
      );
      log();
      return;
    }
    const now = Date.now();
    if (now - windowStartedAt >= 60_000) {
      windowStartedAt = now;
      requestCount = 0;
    }
    if (requestCount >= maxRequestsPerMinute) {
      finish(
        {
          schemaVersion: 1,
          requestId: id,
          error: {
            code: "rate_limited",
            message: "Request rate limit exceeded"
          }
        },
        429,
        { "Retry-After": "60" }
      );
      log();
      return;
    }
    requestCount += 1;

    try {
      const data =
        url.pathname === "/api/ontology/metadata"
          ? service.metadata(parseMetadataQuery(url.searchParams))
          : url.pathname === "/api/ontology/search"
            ? service.search(parseSearchQuery(url.searchParams))
            : service.context(parseContextQuery(url.searchParams));
      finish(successEnvelope(id, data), 200);
    } catch (error) {
      const details = errorDetails(error);
      finish(
        {
          schemaVersion: 1,
          requestId: id,
          error: { code: details.code, message: details.message }
        },
        details.status
      );
    }
    log();
  });
}
