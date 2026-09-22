import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderAiRoutingPdfDrawingForModel } from "../../../../packages/jobs/src/inngest/functions/items/part-drawing-renderer.ts";
import { extractDrawingWithConfiguredModel } from "../../../../packages/jobs/src/inngest/functions/items/extract-part-drawing-model.ts";

const input = resolve(process.cwd(), ".codex/work/192793050201-192793050201.pdf.pdf");
const bytes = new Uint8Array(await readFile(input));
const rendered = await renderAiRoutingPdfDrawingForModel(bytes, {
  maxPages: 1,
  scale: 3,
  maxPixelsPerPage: 20_000_000
});
const result = await extractDrawingWithConfiguredModel({
  payload: {
    companyId: "d8s9bh4f8gm357312pbg",
    userId: "read-only-probe",
    itemId: "wodiitem_0141582866eb9de5f7c76491",
    documentId: "doc_FRk2cXWg8XB26Avfms1hjp",
    extractionId: "read-only-probe-192793050201"
  },
  renderSummary: rendered.summary,
  pages: rendered.pages
});
const output = {
  promptVersion: result.promptVersion,
  modelProvider: result.modelProvider,
  modelName: result.modelName,
  renderer: rendered.summary,
  extraction: result.extraction
};
const outputPath = resolve(
  process.cwd(),
  ".codex/work/ai-routing-192793050201-text-layer-probe-20260819.json"
);
await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
console.log(
  JSON.stringify(
    {
      outputPath,
      promptVersion: result.promptVersion,
      modelName: result.modelName,
      visibleTextChars: rendered.summary.pages[0]?.visibleText?.length ?? 0,
      extraction: result.extraction
    },
    null,
    2
  )
);