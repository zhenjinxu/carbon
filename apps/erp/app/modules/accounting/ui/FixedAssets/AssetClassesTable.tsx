import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuPencil,
  LuPercent,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  depreciationMethodLabels,
  taxDepreciationMethodLabels
} from "../../accounting.models";
import type { FixedAssetClassListItem } from "../../types";

type AssetClassesTableProps = {
  data: FixedAssetClassListItem[];
  count: number;
  taxDepreciationEnabled: boolean;
  primaryAction?: ReactNode;
};

const AssetClassesTable = memo(
  ({
    data,
    count,
    taxDepreciationEnabled,
    primaryAction
  }: AssetClassesTableProps) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const [selectedClass, setSelectedClass] =
      useState<FixedAssetClassListItem | null>(null);
    const deleteModal = useDisclosure();

    const formatBookDepreciation = useCallback((row: FixedAssetClassListItem): string => {
      const method = row.depreciationMethod;
      const life = row.usefulLifeMonths;
      const residual = row.residualValuePercent;

      const methodLabel = t(
        depreciationMethodLabels[
          method as keyof typeof depreciationMethodLabels
        ] ?? method
      );
      const years = life ? Math.round((life / 12) * 10) / 10 : null;
      const lifeStr = years ? t`${years}yr` : "";
      const residualStr =
        residual && Number(residual) > 0 ? t`, ${residual}% residual` : "";

      return t`${methodLabel}, ${lifeStr}${residualStr}`;
    }, [t]);

    const formatTaxDepreciation = useCallback((row: FixedAssetClassListItem): string => {
      const method = (row as any).taxDepreciationMethod;
      if (!method) return t`Same as Book`;

      if (method === "MACRS") {
        const cls = (row as any).macrsPropertyClass;
        return cls ? t`MACRS ${cls}-Year` : t`MACRS`;
      }

      const methodLabel = t(
        taxDepreciationMethodLabels[
          method as keyof typeof taxDepreciationMethodLabels
        ] ?? method
      );
      const life = (row as any).taxUsefulLifeMonths;
      const years = life ? Math.round((life / 12) * 10) / 10 : null;
      const lifeStr = years ? t`, ${years}yr` : "";
      return `${methodLabel}${lifeStr}`;
    }, [t]);

    const columns = useMemo<ColumnDef<FixedAssetClassListItem>[]>(() => {
      const cols: ColumnDef<FixedAssetClassListItem>[] = [
        {
          accessorKey: "name",
          header: t`Name`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.assetClass(row.original.id)}>
              <Enumerable
                value={row.original.name}
                className="cursor-pointer"
              />
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          id: "bookDepreciation",
          header: t`Book Depreciation`,
          cell: ({ row }) => formatBookDepreciation(row.original),
          meta: {
            icon: <LuCalendar />
          }
        }
      ];

      if (taxDepreciationEnabled) {
        cols.push({
          id: "taxDepreciation",
          header: t`Tax Depreciation`,
          cell: ({ row }) => formatTaxDepreciation(row.original),
          meta: {
            icon: <LuPercent />
          }
        });
      }

      return cols;
    }, [taxDepreciationEnabled, t, formatBookDepreciation, formatTaxDepreciation]);

    const renderContextMenu = useCallback(
      (row: FixedAssetClassListItem) => (
        <>
          <MenuItem
            disabled={!permissions.can("update", "accounting")}
            onClick={() => navigate(path.to.assetClass(row.id))}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Asset Class</Trans>
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "accounting")}
            destructive
            onClick={() => {
              setSelectedClass(row);
              deleteModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Asset Class</Trans>
          </MenuItem>
        </>
      ),
      [deleteModal, navigate, permissions]
    );

    return (
      <>
        <Table<FixedAssetClassListItem>
          data={data}
          columns={columns}
          count={count}
          primaryAction={primaryAction}
          renderContextMenu={renderContextMenu}
          title={t`Asset Classes`}
        />
        {selectedClass && (
          <ConfirmDelete
            action={path.to.deleteAssetClass(selectedClass.id)}
            isOpen={deleteModal.isOpen}
            name={selectedClass.name}
            text={t`Are you sure you want to delete the asset class: ${selectedClass.name}? This cannot be undone.`}
            onCancel={() => {
              deleteModal.onClose();
              setSelectedClass(null);
            }}
            onSubmit={() => {
              deleteModal.onClose();
              setSelectedClass(null);
            }}
          />
        )}
      </>
    );
  }
);

AssetClassesTable.displayName = "AssetClassesTable";
export default AssetClassesTable;
