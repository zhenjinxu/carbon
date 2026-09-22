import { json2csv } from "json-2-csv";
import type { CsvExportColumn } from "../types";

export const UTF8_BOM = "\uFEFF";

type Row = Record<string, unknown>;
type IdNameMaps = Record<string, Map<string, string>>;

function formatAsExcelText(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return value;
  }

  const escaped = String(value).replace(/"/g, '""');
  return `="${escaped}"`;
}

export function getVisibleCsvColumnIds<
  T extends object = Record<string, unknown>
>(
  columnOrder: string[],
  columnVisibility: Record<string, boolean>,
  columnExports: Record<string, CsvExportColumn<T>[]>
) {
  const order = columnOrder.length ? columnOrder : Object.keys(columnExports);
  return order.filter(
    (id) => id in columnExports && columnVisibility[id] !== false
  );
}

export function buildCsvExportRows<T extends object>(
  data: T[],
  exportColumnIds: string[],
  columnExports: Record<string, CsvExportColumn<T>[]>,
  idNameMaps: IdNameMaps = {}
) {
  return data.map((row) => {
    const out: Record<string, unknown> = {};
    for (const key of exportColumnIds) {
      for (const exportColumn of columnExports[key] ?? []) {
        const accessorKey = exportColumn.accessorKey ?? key;
        const raw = exportColumn.value
          ? exportColumn.value(row)
          : (row as Row)[accessorKey];
        const map = idNameMaps[accessorKey] ?? idNameMaps[key];
        const value = map && raw != null ? (map.get(String(raw)) ?? raw) : raw;
        out[exportColumn.header] = exportColumn.preserveAsText
          ? formatAsExcelText(value)
          : value;
      }
    }
    return out;
  });
}

export function buildCsvDownloadContent(rows: Record<string, unknown>[]) {
  return `${UTF8_BOM}${json2csv(rows, { emptyFieldValue: "" })}`;
}
