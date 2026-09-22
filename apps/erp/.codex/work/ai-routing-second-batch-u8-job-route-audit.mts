import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function loadEnvFile(path: string, override = false) {
  let content = "";
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return;
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!override && process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const root = resolve(process.cwd(), "../..");
loadEnvFile(resolve(root, ".env"));
loadEnvFile(resolve(root, ".env.local"), true);

const requireFromJobs = createRequire(resolve(root, "packages/jobs/package.json"));
const { createClient } = await import(
  pathToFileURL(requireFromJobs.resolve("@supabase/supabase-js")).href
);

const carbon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const companyId = "d8s9bh4f8gm357312pbg";
const partIds = [
  "1927930501",
  "1927930502",
  "1927930503",
  "1927930601",
  "1927930602",
  "1927930603",
  "192793050101",
  "192793050200",
  "192793050201",
  "192793060101",
  "192793060200",
  "192793060201"
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function routeSignature(
  operations: Array<Record<string, unknown>>,
  processById: Map<string, string>
) {
  return operations
    .slice()
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
    .map((operation) => {
      const processName = processById.get(String(operation.processId ?? ""));
      return [
        operation.order ?? "?",
        nonEmptyString(operation.description) ??
          processName ??
          nonEmptyString(operation.processId) ??
          "Unnamed"
      ].join(":");
    })
    .join(" -> ");
}

const { data: itemRows, error: itemError } = await carbon
  .from("item")
  .select("id, readableId, name")
  .eq("companyId", companyId)
  .in("readableId", partIds);
if (itemError) throw itemError;

const itemsById = new Map((itemRows ?? []).map((item) => [item.id, item]));
const itemsByReadable = new Map(
  (itemRows ?? []).map((item) => [item.readableId, item])
);
const itemIds = (itemRows ?? []).map((item) => item.id);

const { data: jobRows, error: jobError } = itemIds.length
  ? await carbon
      .from("job")
      .select("id,jobId,itemId,source,status,createdAt,updatedAt,customFields")
      .eq("companyId", companyId)
      .in("itemId", itemIds)
      .order("createdAt", { ascending: false })
  : { data: [], error: null };
if (jobError) throw jobError;

const jobIds = (jobRows ?? []).map((job) => job.id);
const { data: jobMakeMethodRows, error: jobMakeMethodError } = jobIds.length
  ? await carbon
      .from("jobMakeMethod")
      .select("id,jobId,itemId,version,customFields")
      .eq("companyId", companyId)
      .in("jobId", jobIds)
  : { data: [], error: null };
if (jobMakeMethodError) throw jobMakeMethodError;

const { data: jobOperationRows, error: jobOperationError } = jobIds.length
  ? await carbon
      .from("jobOperation")
      .select("id,jobId,jobMakeMethodId,order,processId,description,operationOrder,status,customFields")
      .eq("companyId", companyId)
      .in("jobId", jobIds)
      .order("order", { ascending: true })
  : { data: [], error: null };
if (jobOperationError) throw jobOperationError;

const processIds = Array.from(
  new Set(
    (jobOperationRows ?? [])
      .map((operation) => operation.processId)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  )
);
const { data: processRows, error: processError } = processIds.length
  ? await carbon
      .from("process")
      .select("id,name")
      .eq("companyId", companyId)
      .in("id", processIds)
  : { data: [], error: null };
if (processError) throw processError;

const processById = new Map(
  (processRows ?? []).map((process) => [process.id, process.name])
);
const jobsByItem = new Map<string, Array<Record<string, unknown>>>();
for (const job of jobRows ?? []) {
  const rows = jobsByItem.get(job.itemId) ?? [];
  rows.push(job as Record<string, unknown>);
  jobsByItem.set(job.itemId, rows);
}
const methodsByJob = new Map<string, Array<Record<string, unknown>>>();
for (const method of jobMakeMethodRows ?? []) {
  const rows = methodsByJob.get(method.jobId) ?? [];
  rows.push(method as Record<string, unknown>);
  methodsByJob.set(method.jobId, rows);
}
const operationsByJob = new Map<string, Array<Record<string, unknown>>>();
for (const operation of jobOperationRows ?? []) {
  const rows = operationsByJob.get(operation.jobId) ?? [];
  rows.push(operation as Record<string, unknown>);
  operationsByJob.set(operation.jobId, rows);
}

const perPart = partIds.map((readableId) => {
  const item = itemsByReadable.get(readableId) ?? null;
  const jobs = item ? jobsByItem.get(item.id) ?? [] : [];
  const routeCandidates = jobs
    .map((job) => {
      const operations = operationsByJob.get(String(job.id)) ?? [];
      const methodCount = (methodsByJob.get(String(job.id)) ?? []).length;
      const customFields = asRecord(job.customFields);
      const wodiMES = asRecord(customFields.wodiMES);
      return {
        jobId: job.id,
        readableJobId: job.jobId,
        source: job.source,
        status: job.status,
        methodCount,
        operationCount: operations.length,
        routeSignature: routeSignature(operations, processById),
        sourceMoDId: wodiMES.sourceMoDId ?? null,
        sourceMoCode: wodiMES.sourceMoCode ?? null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
      };
    })
    .filter((candidate) => candidate.operationCount > 0);
  const distinctSignatures = Array.from(
    new Set(routeCandidates.map((candidate) => candidate.routeSignature))
  );

  return {
    readableId,
    itemFound: Boolean(item),
    itemId: item?.id ?? null,
    itemName: item?.name ?? null,
    jobCount: jobs.length,
    routeCandidateCount: routeCandidates.length,
    distinctRouteSignatureCount: distinctSignatures.length,
    latestRouteCandidate: routeCandidates[0] ?? null,
    distinctRouteSignatures: distinctSignatures,
    routeCandidates: routeCandidates.slice(0, 5),
    blocker: !item
      ? "item_missing"
      : routeCandidates.length === 0
        ? "u8_job_operations_missing"
        : distinctSignatures.length > 1
          ? "multiple_u8_route_signatures_need_selection"
          : null
  };
});

console.log(
  JSON.stringify(
    {
      companyId,
      partCount: partIds.length,
      totalJobs: jobRows?.length ?? 0,
      totalJobOperations: jobOperationRows?.length ?? 0,
      readyForU8RouteSampleSource: perPart.every((part) => part.blocker === null),
      blockers: perPart.filter((part) => part.blocker !== null),
      perPart
    },
    null,
    2
  )
);

if (perPart.some((part) => part.blocker !== null)) {
  process.exitCode = 2;
}