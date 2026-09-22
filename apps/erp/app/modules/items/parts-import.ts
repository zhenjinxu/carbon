import * as XLSX from "xlsx";

export type PartImportRow = {
  code: string;
  description: string;
};

const PART_CODE_HEADER = "物料";
const PART_DESCRIPTION_HEADER = "说明";

function asText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function parsePartsWorkbook(
  input: ArrayBuffer | Uint8Array
): PartImportRow[] {
  const workbook = XLSX.read(input, { type: "array", cellDates: false });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
  if (!firstSheet) throw new Error("Excel workbook has no sheets");

  const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
    header: 1,
    raw: true,
    defval: ""
  });
  const [headerRow, ...dataRows] = rows;
  const headers = (headerRow ?? []).map(asText);
  const codeIndex = headers.indexOf(PART_CODE_HEADER);
  const descriptionIndex = headers.indexOf(PART_DESCRIPTION_HEADER);
  if (codeIndex < 0 || descriptionIndex < 0) {
    throw new Error(
      `Excel must contain the ${PART_CODE_HEADER} and ${PART_DESCRIPTION_HEADER} columns`
    );
  }

  const seen = new Map<string, string>();
  for (const row of dataRows) {
    const code = asText(row[codeIndex]);
    const description = asText(row[descriptionIndex]);
    if (!code && !description) continue;
    if (!code)
      throw new Error("Every non-empty row must contain a part number");
    if (!description)
      throw new Error(`Part ${code} is missing its description`);
    const previous = seen.get(code);
    if (previous !== undefined) {
      if (previous !== description) {
        throw new Error(
          `Duplicate part number ${code} has conflicting descriptions`
        );
      }
      continue;
    }
    seen.set(code, description);
  }

  const result = [...seen.entries()].map(([code, description]) => ({
    code,
    description
  }));
  if (result.length === 0) throw new Error("Excel contains no part rows");
  return result;
}
