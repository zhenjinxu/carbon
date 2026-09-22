import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderAiRoutingPdfDrawingForModel } from "../../../../packages/jobs/src/inngest/functions/items/part-drawing-renderer.ts";

const input = resolve(process.cwd(), ".codex/work/192793050201-192793050201.pdf.pdf");
const output = resolve(process.cwd(), ".codex/work/192793050201-page-1.png");
const result = await renderAiRoutingPdfDrawingForModel(await readFile(input), {
  maxPages: 1,
  scale: 3,
  maxPixelsPerPage: 20_000_000
});
await import("node:fs/promises").then(({ writeFile }) =>
  writeFile(output, result.pages[0].imageBytes)
);
console.log(JSON.stringify({
  output,
  page: result.pages[0].pageNumber,
  width: result.pages[0].width,
  height: result.pages[0].height,
  textItemCount: result.summary.pages[0].textItemCount,
  textCharCount: result.summary.pages[0].textCharCount
}, null, 2));