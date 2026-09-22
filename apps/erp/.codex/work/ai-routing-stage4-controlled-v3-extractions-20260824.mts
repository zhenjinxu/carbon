import { Buffer } from "node:buffer";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function loadEnvFile(path: string, options: { override?: boolean; only?: Set<string> } = {}) {
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
    if (options.only && !options.only.has(key)) continue;
    if (!options.override && process.env[key] !== undefined) continue;

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

function findRoot(start: string) {
  let current = start;
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(current, "package.json"), "utf8"));
      if (pkg?.name === "carbon") return current;
    } catch {}
    const parent = dirname(current);
    if (parent === current) throw new Error("Unable to locate Carbon root");
    current = parent;
  }
}

type SavedResult = {
  readableId: string;
  role: "new-evaluation-candidate" | "existing-evaluation-refresh";
  status: string;
  itemId?: string | null;
  documentId?: string | null;
  extractionId?: string | null;
  result?: unknown;
  error?: string;
  promptVersion?: string | null;
  completedAt?: string;
};

const newEvaluationCandidates = [
  "192472540409",
  "192759010202",
  "192472540414",
  "192739030308"
] as const;

const existingEvaluationRefreshCandidates = [] as const;

const allPartIds = [
  ...newEvaluationCandidates,
  ...existingEvaluationRefreshCandidates
];
const newEvaluationSet = new Set<string>(newEvaluationCandidates);
const existingEvaluationSet = new Set<string>(existingEvaluationRefreshCandidates);
const fakeReadableIds = new Set(["asm-top-001", "ASM-TOP-001"]);
const targetPromptVersion = "ai-routing-drawing.prompt.v3";

function parseRequestedPartIds() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--parts");
  if (args.length === 0) return allPartIds;
  for (const arg of args) {
    if (!allPartIds.includes(arg as (typeof allPartIds)[number])) {
      throw new Error(`Unexpected part id for this controlled run: ${arg}`);
    }
  }
  return args;
}

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey ? message.replaceAll(apiKey, "[redacted]") : message;
}

const root = findRoot(dirname(fileURLToPath(import.meta.url)));
loadEnvFile(resolve(root, ".env"));
loadEnvFile(resolve(root, ".env.local"), { override: true });
loadEnvFile(resolve(root, "apps/erp/.env.local"), {
  override: true,
  only: new Set(["SUPABASE_DB_URL"])
});

process.env.AI_ROUTING_DRAWING_MODEL_PROVIDER = "openai";
process.env.AI_ROUTING_DRAWING_MODEL_NAME = "gpt-5.6-terra";

const requireFromRoot = createRequire(resolve(root, "package.json"));
const { createClient } = await import(
  pathToFileURL(requireFromRoot.resolve("@supabase/supabase-js")).href
);
const { PostgresDriver } = await import(
  pathToFileURL(requireFromRoot.resolve("kysely")).href
);
const { getPostgresConnectionPool, getPostgresClient } = await import(
  pathToFileURL(
    resolve(root, "packages/database/supabase/functions/lib/postgres/index.ts")
  ).href
);
const { enqueueAiRoutingDrawingExtraction } = await import(
  pathToFileURL(resolve(root, "apps/erp/app/modules/items/ai-routing.server.ts")).href
);
const {
  runAiRoutingDrawingExtraction,
  PermanentAiRoutingDrawingExtractionError
} = await import(
  pathToFileURL(
    resolve(root, "packages/jobs/src/inngest/functions/items/extract-part-drawing.runner.ts")
  ).href
);
const { renderAiRoutingPdfDrawingForModel } = await import(
  pathToFileURL(
    resolve(root, "packages/jobs/src/inngest/functions/items/part-drawing-renderer.ts")
  ).href
);
const { extractDrawingWithConfiguredModel } = await import(
  pathToFileURL(
    resolve(root, "packages/jobs/src/inngest/functions/items/extract-part-drawing-model.ts")
  ).href
);

const companyId = process.env.AI_ROUTING_COMPANY_ID ?? "d8s9bh4f8gm357312pbg";
const outputPath = resolve(
  root,
  process.env.AI_ROUTING_STAGE4_V3_EXTRACTION_OUTPUT_PATH ??
    "apps/erp/.codex/work/ai-routing-stage4-controlled-v3-extractions-20260824.json"
);
const partIds = parseRequestedPartIds();
const maxBytes = 30 * 1024 * 1024;

const carbon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const db = getPostgresClient(getPostgresConnectionPool(4), PostgresDriver);

function roleFor(readableId: string): SavedResult["role"] {
  if (newEvaluationSet.has(readableId)) return "new-evaluation-candidate";
  if (existingEvaluationSet.has(readableId)) return "existing-evaluation-refresh";
  throw new Error(`Unexpected part id role: ${readableId}`);
}

function loadSavedResults() {
  if (!existsSync(outputPath)) {
    return {
      companyId,
      targetPromptVersion,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      writesPerformed: true,
      databaseMutationsPerformed: true,
      results: [] as SavedResult[]
    };
  }
  return JSON.parse(readFileSync(outputPath, "utf8")) as {
    companyId: string;
    targetPromptVersion: string;
    startedAt: string;
    updatedAt: string;
    writesPerformed: boolean;
    databaseMutationsPerformed: boolean;
    results: SavedResult[];
  };
}

function saveResult(result: SavedResult) {
  const saved = loadSavedResults();
  const otherResults = saved.results.filter(
    (row) => !(row.readableId === result.readableId && row.role === result.role)
  );
  const results = [...otherResults, result].sort((a, b) =>
    allPartIds.indexOf(a.readableId as (typeof allPartIds)[number]) -
    allPartIds.indexOf(b.readableId as (typeof allPartIds)[number])
  );
  const counts = results.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
  writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        ...saved,
        updatedAt: new Date().toISOString(),
        requestedInThisRun: partIds,
        counts,
        results
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function getCurrentTargetExtraction(args: { itemId: string; documentId: string }) {
  const { data, error } = await carbon
    .from("aiDrawingExtraction")
    .select("id,status,promptVersion,completedAt,contentHash,extractorSchemaVersion,extraction")
    .eq("companyId", companyId)
    .eq("itemId", args.itemId)
    .eq("documentId", args.documentId)
    .eq("status", "Succeeded")
    .eq("promptVersion", targetPromptVersion)
    .order("completedAt", { ascending: false, nullsFirst: false })
    .order("updatedAt", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

async function loadPartPdf(payload: Record<string, string>) {
  const documentResult = await carbon
    .from("document")
    .select("id, companyId, sourceDocument, sourceDocumentId, active, path, extension, type, size")
    .eq("id", payload.documentId)
    .eq("companyId", payload.companyId)
    .maybeSingle();

  if (documentResult.error || !documentResult.data) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "DOCUMENT_NOT_FOUND",
      documentResult.error?.message ?? "Part PDF document was not found"
    );
  }

  const itemResult = await carbon
    .from("item")
    .select("id, companyId, type")
    .eq("id", payload.itemId)
    .eq("companyId", payload.companyId)
    .maybeSingle();

  if (itemResult.error || !itemResult.data || itemResult.data.type !== "Part") {
    throw new PermanentAiRoutingDrawingExtractionError(
      "ITEM_NOT_FOUND",
      itemResult.error?.message ?? "Part item was not found"
    );
  }

  const document = documentResult.data;
  if (!document.active) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "INACTIVE_DOCUMENT",
      "Part PDF document is not active"
    );
  }
  if (document.sourceDocument !== "Part" || document.sourceDocumentId !== payload.itemId) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "ITEM_MISMATCH",
      "Part PDF document is not attached to the requested item"
    );
  }
  if (document.type !== "PDF" || document.extension?.toLowerCase() !== "pdf") {
    throw new PermanentAiRoutingDrawingExtractionError(
      "NON_PDF_DOCUMENT",
      "Document metadata does not describe a PDF"
    );
  }
  const metadataSize = Number(document.size);
  if (Number.isFinite(metadataSize) && metadataSize > maxBytes) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "OVERSIZED_DOCUMENT",
      "Part PDF document exceeds the maximum AI routing extraction size"
    );
  }
  const expectedPrefix = `${payload.companyId}/parts/${payload.itemId}/`;
  const pathSegments = String(document.path).split("/");
  if (
    !document.path?.startsWith(expectedPrefix) ||
    pathSegments.some((segment: string) => segment === "." || segment === "..") ||
    !document.path.toLowerCase().endsWith(".pdf")
  ) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "INVALID_STORAGE_PATH",
      "Part PDF document path is outside the expected private storage prefix"
    );
  }

  const { data, error } = await carbon.storage.from("private").download(document.path);
  if (error || !data) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "STORAGE_DOWNLOAD_FAILED",
      error?.message ?? "Failed to download Part PDF from private storage",
      "Storage"
    );
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "OVERSIZED_DOCUMENT",
      "Downloaded Part PDF exceeds the maximum AI routing extraction size"
    );
  }
  const header = new TextDecoder("ascii").decode(bytes.slice(0, 5));
  if (header !== "%PDF-") {
    throw new PermanentAiRoutingDrawingExtractionError(
      "INVALID_PDF_BYTES",
      "Downloaded file is not a PDF document"
    );
  }
  return { bytes };
}

async function markProcessing(payload: Record<string, string>) {
  const { error } = await carbon
    .from("aiDrawingExtraction")
    .update({
      status: "Processing",
      startedAt: new Date().toISOString(),
      completedAt: null,
      errorCategory: null,
      errorCode: null,
      errorMessage: null,
      updatedBy: payload.userId
    })
    .eq("id", payload.extractionId)
    .eq("companyId", payload.companyId);
  if (error) throw error;
}

async function markSucceeded(payload: Record<string, string>, update: Record<string, unknown>) {
  const { error } = await carbon
    .from("aiDrawingExtraction")
    .update({
      status: "Succeeded",
      contentHash: update.contentHash,
      rendererVersion: update.rendererVersion,
      extractorSchemaVersion: update.extractorSchemaVersion,
      promptVersion: update.promptVersion,
      modelProvider: update.modelProvider,
      modelName: update.modelName,
      pageCount: update.pageCount,
      extraction: update.extraction,
      warnings: update.warnings,
      completedAt: new Date().toISOString(),
      updatedBy: payload.userId
    })
    .eq("id", payload.extractionId)
    .eq("companyId", payload.companyId);
  if (error) throw error;
}

async function markFailed(payload: Record<string, string>, update: Record<string, unknown>) {
  const { error } = await carbon
    .from("aiDrawingExtraction")
    .update({
      status: "Failed",
      errorCategory: update.errorCategory,
      errorCode: update.errorCode,
      errorMessage: update.errorMessage,
      completedAt: new Date().toISOString(),
      updatedBy: payload.userId
    })
    .eq("id", payload.extractionId)
    .eq("companyId", payload.companyId);
  if (error && !update.retryable) throw error;
}

for (const readableId of partIds) {
  const role = roleFor(readableId);
  if (fakeReadableIds.has(readableId)) {
    saveResult({ readableId, role, status: "SkippedFakeItem" });
    continue;
  }

  try {
    const { data: item, error: itemError } = await carbon
      .from("item")
      .select("id, readableId, readableIdWithRevision, createdBy")
      .eq("companyId", companyId)
      .or(`readableId.eq.${readableId},readableIdWithRevision.eq.${readableId}`)
      .order("updatedAt", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (itemError || !item) throw itemError ?? new Error(`Part ${readableId} not found`);

    const { data: document, error: documentError } = await carbon
      .from("document")
      .select("id, name, path, type, extension, active")
      .eq("companyId", companyId)
      .eq("sourceDocument", "Part")
      .eq("sourceDocumentId", item.id)
      .eq("active", true)
      .eq("type", "PDF")
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (documentError || !document) {
      throw documentError ?? new Error(`Active PDF for ${readableId} not found`);
    }

    const existingTarget = await getCurrentTargetExtraction({
      itemId: item.id,
      documentId: document.id
    });
    if (existingTarget) {
      const result = {
        readableId,
        role,
        status: "AlreadyTargetPromptSucceeded",
        itemId: item.id,
        documentId: document.id,
        extractionId: existingTarget.id,
        promptVersion: existingTarget.promptVersion,
        completedAt: new Date().toISOString()
      } satisfies SavedResult;
      saveResult(result);
      console.log(JSON.stringify(result));
      continue;
    }

    const userId = item.createdBy;
    if (!userId) throw new Error(`Part ${readableId} has no createdBy user`);

    let capturedPayload: Record<string, string> | null = null;
    const enqueueResult = await enqueueAiRoutingDrawingExtraction(
      db,
      { companyId, userId, itemId: item.id, documentId: document.id },
      async (payload: Record<string, string>) => {
        capturedPayload = payload;
      }
    );
    const extractionId = enqueueResult.extractionId;
    if (!capturedPayload || capturedPayload.extractionId !== extractionId) {
      throw new Error("Controlled enqueue did not return its committed event payload");
    }

    const result = await runAiRoutingDrawingExtraction(capturedPayload, {
      markProcessing,
      loadPartPdf,
      renderPdf: renderAiRoutingPdfDrawingForModel,
      extractDrawing: extractDrawingWithConfiguredModel,
      markSucceeded,
      markFailed
    });
    const saved = {
      readableId,
      role,
      status: result.status,
      itemId: item.id,
      documentId: document.id,
      extractionId,
      result,
      promptVersion: result.status === "Succeeded" ? targetPromptVersion : null,
      completedAt: new Date().toISOString()
    } satisfies SavedResult;
    saveResult(saved);
    console.log(JSON.stringify(saved));
  } catch (error) {
    const saved = {
      readableId,
      role,
      status: "Failed",
      error: safeMessage(error),
      completedAt: new Date().toISOString()
    } satisfies SavedResult;
    saveResult(saved);
    console.log(JSON.stringify(saved));
    process.exitCode = 2;
  }
}

await carbon.auth.signOut();

const saved = loadSavedResults();
console.log(
  JSON.stringify(
    {
      companyId,
      requestedInThisRun: partIds,
      counts: saved.results.reduce<Record<string, number>>((acc, row) => {
        acc[row.status] = (acc[row.status] ?? 0) + 1;
        return acc;
      }, {}),
      outputPath
    },
    null,
    2
  )
);



