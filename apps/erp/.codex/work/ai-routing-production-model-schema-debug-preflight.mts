import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function loadEnv(path: string) {
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = rawLine.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key || process.env[key] !== undefined) continue;
    const value = rawValue.trim().replace(/^("|')|("|')$/g, "");
    process.env[key] = value;
  }
}

const root = resolve(process.cwd(), "../..");
loadEnv(resolve(root, ".env"));
const requireFromRoot = createRequire(resolve(root, "package.json"));
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

const originalFetch = globalThis.fetch;
let outbound: Record<string, unknown> | null = null;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  if (new URL(request.url).pathname.endsWith("/responses")) {
    const body = JSON.parse(await request.clone().text()) as Record<string, unknown>;
    const text = body.text as Record<string, unknown> | undefined;
    const format = text?.format as Record<string, unknown> | undefined;
    outbound = {
      host: new URL(request.url).host,
      model: typeof body.model === "string" ? body.model : null,
      hasTopLevelInstructions: typeof body.instructions === "string",
      hasTextFormat: Boolean(format),
      textFormatType: typeof format?.type === "string" ? format.type : null,
      textFormatName: typeof format?.name === "string" ? format.name : null,
      schemaPresent: Boolean(format?.schema),
      schemaCharLength: format?.schema ? JSON.stringify(format.schema).length : 0,
      inputItemCount: Array.isArray(body.input) ? body.input.length : 0
    };
  }
  return originalFetch(request);
};

try {
  const rendered = await renderAiRoutingPdfDrawingForModel(
    new Uint8Array(
      readFileSync(resolve(process.cwd(), ".codex/work/192793050201-192793050201.pdf.pdf"))
    ),
    { maxPages: 1, scale: 3, maxPixelsPerPage: 20_000_000 }
  );
  const result = await extractDrawingWithConfiguredModel({
    payload: {
      companyId: "preflight-company",
      userId: "preflight-user",
      itemId: "preflight-item",
      documentId: "preflight-document",
      extractionId: "preflight-extraction"
    },
    renderSummary: rendered.summary,
    pages: rendered.pages
  });
  console.log(
    JSON.stringify({ outbound, passed: Boolean(result.extraction), modelName: result.modelName })
  );
} catch (error) {
  console.log(
    JSON.stringify({
      outbound,
      passed: false,
      error: error instanceof Error ? error.message : String(error)
    })
  );
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
}