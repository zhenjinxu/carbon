import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const input = resolve(process.cwd(), ".codex/work/192793050201-192793050201.pdf.pdf");
const loadingTask = pdfjs.getDocument({
  data: new Uint8Array(await readFile(input)),
  disableWorker: true
} as never);
const pdf = await loadingTask.promise;
const pages = [];
for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
  const page = await pdf.getPage(pageNumber);
  const text = await page.getTextContent();
  pages.push({
    pageNumber,
    items: text.items
      .filter((item) => typeof item === "object" && item !== null && "str" in item)
      .map((item) => {
        const row = item as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown };
        return {
          text: typeof row.str === "string" ? row.str : "",
          transform: row.transform,
          width: row.width,
          height: row.height
        };
      })
  });
}
await loadingTask.destroy();
console.log(JSON.stringify({ input, pages }, null, 2));