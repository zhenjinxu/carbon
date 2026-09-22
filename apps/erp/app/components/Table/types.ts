import "@tanstack/react-table";
import type { ReactElement } from "react";
import type { ColumnFilterData } from "./components/Filter/types";

export type CsvExportColumn<TData extends unknown = Record<string, unknown>> = {
  header: string;
  accessorKey?: string;
  preserveAsText?: boolean;
  value?: (row: TData) => unknown;
};

declare module "@tanstack/react-table" {
  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  interface ColumnMeta<TData extends unknown, TValue> {
    filter?: ColumnFilterData;
    csvExport?: CsvExportColumn<TData>[];
    pluralHeader?: string;
    icon?: ReactElement;
    renderTotal?: boolean;
    formatter?: (
      val:
        | number
        | bigint
        | `${number}`
        | "Infinity"
        | "-Infinity"
        | "+Infinity"
    ) => string;
  }
}

export type ColumnSizeMap = Map<string, { width: number; startX: number }>;
