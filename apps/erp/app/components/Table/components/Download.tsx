import {
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useMemo } from "react";
import { LuDownload } from "react-icons/lu";
import { useCustomers, useItems, usePeople, useSuppliers } from "~/stores";
import type { CsvExportColumn } from "../types";
import {
  buildCsvDownloadContent,
  buildCsvExportRows,
  getVisibleCsvColumnIds
} from "./csvExport";

type DownloadProps<T extends object> = {
  data: T[];
  columnExports: Record<string, CsvExportColumn<T>[]>;
  columnOrder: string[];
  columnVisibility: Record<string, boolean>;
};

const Download = <T extends object>({
  data,
  columnExports,
  columnOrder,
  columnVisibility
}: DownloadProps<T>) => {
  const { t } = useLingui();

  const [items] = useItems();
  const [suppliers] = useSuppliers();
  const [people] = usePeople();
  const [customers] = useCustomers();

  // Maps an id column's accessor key -> a lookup of record id -> name, so the
  // CSV can show the human-readable name instead of the raw id.
  const idNameMaps = useMemo<Record<string, Map<string, string>>>(
    () => ({
      itemId: new Map(items.map((i) => [i.id, i.name])),
      supplierId: new Map(suppliers.map((s) => [s.id, s.name])),
      employeeId: new Map(people.map((p) => [p.id, p.name])),
      customerId: new Map(customers.map((c) => [c.id, c.name]))
    }),
    [items, suppliers, people, customers]
  );

  // The visible columns, in the current view's order. The column id doubles as
  // the data accessor key; columns absent from columnExports (selection,
  // expand, actions) are dropped.
  const exportColumns = useMemo(
    () => getVisibleCsvColumnIds(columnOrder, columnVisibility, columnExports),
    [columnOrder, columnVisibility, columnExports]
  );

  const onClick = useCallback(() => {
    if (!data?.length) {
      return;
    }
    const rows = buildCsvExportRows(
      data,
      exportColumns,
      columnExports,
      idNameMaps
    );
    const csvData = buildCsvDownloadContent(rows);
    // Create a CSV file and allow the user to download it
    let blob = new Blob([csvData], { type: "text/csv;charset=utf-8" });
    let url = window.URL.createObjectURL(blob);
    let a = document.createElement("a");
    a.href = url;
    a.download = "data.csv";
    document.body.appendChild(a);
    a.click();
  }, [data, exportColumns, columnExports, idNameMaps]);

  if (!data?.length) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <IconButton
          aria-label={t`Download CSV`}
          title={t`Download CSV`}
          variant={"ghost"}
          icon={<LuDownload />}
          className={"!border-dashed border-border"}
          onClick={onClick}
        />
      </TooltipTrigger>
      <TooltipContent>
        <p>
          <Trans>Download CSV</Trans>
        </p>
      </TooltipContent>
    </Tooltip>
  );
};

export default Download;
