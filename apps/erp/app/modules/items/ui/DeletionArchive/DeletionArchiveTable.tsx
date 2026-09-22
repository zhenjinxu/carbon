import {
  Button,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  HStack,
  toast,
  VStack
} from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuArchive, LuRotateCcw } from "react-icons/lu";
import { Link, useFetcher, useRevalidator } from "react-router";
import { Table } from "~/components";
import { path } from "~/utils/path";
import type {
  DeletionArchiveEntityType,
  DeletionArchiveListItem
} from "../../deletion-archive.server";

type DeletionArchiveTableProps = {
  data: DeletionArchiveListItem[];
  count: number;
  selectedType?: DeletionArchiveEntityType;
};

type ArchiveRestoreResponse = {
  data?: { restored: number } | null;
  error?: { message: string } | null;
};

const typeFilters: { label: string; value?: DeletionArchiveEntityType }[] = [
  { label: "全部" },
  { label: "零件", value: "Part" },
  { label: "材料", value: "Material" },
  { label: "工具", value: "Tool" },
  { label: "消耗品", value: "Consumable" }
];

function archiveUrl(type?: DeletionArchiveEntityType) {
  return type
    ? `${path.to.itemDeletionArchive}?type=${type}`
    : path.to.itemDeletionArchive;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const DeletionArchiveTable = memo(
  ({ data, count, selectedType }: DeletionArchiveTableProps) => {
    const [selectedArchives, setSelectedArchives] = useState<
      DeletionArchiveListItem[]
    >([]);
    const fetcher = useFetcher<ArchiveRestoreResponse>();
    const revalidator = useRevalidator();
    const submitted = useRef(false);

    useEffect(() => {
      if (fetcher.state !== "idle" || !submitted.current || !fetcher.data) {
        return;
      }
      submitted.current = false;
      if (fetcher.data.error) {
        toast.error(fetcher.data.error.message);
        return;
      }
      const restored = fetcher.data.data?.restored ?? 0;
      toast.success(`已恢复 ${restored} 条归档记录`);
      setSelectedArchives([]);
      revalidator.revalidate();
    }, [fetcher.data, fetcher.state, revalidator]);

    const restoreRows = useCallback(
      (rows: DeletionArchiveListItem[]) => {
        if (rows.length === 0 || fetcher.state !== "idle") return;
        const formData = new FormData();
        formData.append("operation", "restore");
        rows.forEach((row) => {
          formData.append("archives", row.id);
        });
        submitted.current = true;
        toast.info(`正在恢复 ${rows.length} 条归档记录...`);
        fetcher.submit(formData, {
          method: "post",
          action: path.to.itemDeletionArchive
        });
      },
      [fetcher]
    );

    const columns = useMemo<ColumnDef<DeletionArchiveListItem>[]>(() => {
      return [
        {
          accessorKey: "readableId",
          header: "物品ID",
          cell: ({ row }) => (
            <div className="min-w-[180px]">
              <div className="font-medium text-foreground">
                {row.original.readableId}
              </div>
              <div className="text-sm text-muted-foreground">
                {row.original.name}
              </div>
            </div>
          )
        },
        {
          accessorKey: "entityTypeLabel",
          header: "类型",
          cell: (item) => item.getValue()
        },
        {
          accessorKey: "actionLabel",
          header: "归档方式",
          cell: (item) => item.getValue()
        },
        {
          accessorKey: "relatedSummary",
          header: "关联快照",
          cell: (item) => item.getValue()
        },
        {
          accessorKey: "reason",
          header: "原因",
          cell: (item) => item.getValue()
        },
        {
          accessorKey: "createdBy",
          header: "归档人",
          cell: (item) => item.getValue()
        },
        {
          accessorKey: "createdAt",
          header: "归档时间",
          cell: ({ row }) => formatDate(row.original.createdAt)
        }
      ];
    }, []);

    const renderActions = useCallback(
      (selectedRows: DeletionArchiveListItem[]) => (
        <DropdownMenuContent align="end" className="min-w-[180px]">
          <DropdownMenuItem onClick={() => restoreRows(selectedRows)}>
            <DropdownMenuIcon icon={<LuRotateCcw />} />
            <span>恢复</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      ),
      [restoreRows]
    );

    return (
      <VStack spacing={0} className="h-full">
        <HStack className="px-4 md:px-6 pt-4 pb-2 justify-between">
          <HStack className="gap-2 flex-wrap">
            {typeFilters.map((filter) => {
              const active =
                filter.value === selectedType ||
                (!filter.value && !selectedType);
              return (
                <Button
                  key={filter.value ?? "all"}
                  asChild
                  size="sm"
                  variant={active ? "primary" : "secondary"}
                >
                  <Link to={archiveUrl(filter.value)}>{filter.label}</Link>
                </Button>
              );
            })}
          </HStack>
          {selectedArchives.length > 0 && (
            <Button
              size="sm"
              leftIcon={<LuRotateCcw />}
              isDisabled={fetcher.state !== "idle"}
              isLoading={fetcher.state !== "idle"}
              onClick={() => restoreRows(selectedArchives)}
            >
              恢复 {selectedArchives.length}
            </Button>
          )}
        </HStack>
        <Table<DeletionArchiveListItem>
          columns={columns}
          count={count}
          data={data}
          defaultColumnPinning={{ left: ["readableId"] }}
          getRowId={(row) => row.id}
          onSelectedRowsChange={setSelectedArchives}
          primaryAction={
            <Button variant="secondary" leftIcon={<LuArchive />} asChild>
              <Link to={path.to.itemDeletionArchive}>归档中心</Link>
            </Button>
          }
          renderActions={renderActions}
          title="归档记录"
          withSavedView={false}
          withSearch={false}
          withSelectableRows
        />
      </VStack>
    );
  }
);

DeletionArchiveTable.displayName = "DeletionArchiveTable";

export default DeletionArchiveTable;
