import {
  Badge,
  Button,
  Checkbox,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  HStack,
  MenuIcon,
  MenuItem,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  LuAlignJustify,
  LuBookMarked,
  LuCalendar,
  LuCheck,
  LuFileSpreadsheet,
  LuGitPullRequestArrow,
  LuGroup,
  LuLoaderCircle,
  LuPencil,
  LuRefreshCw,
  LuTag,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { RxCodesandboxLogo } from "react-icons/rx";
import { TbTargetArrow } from "react-icons/tb";
import { Link, useFetcher, useNavigate, useRevalidator } from "react-router";
import {
  EmployeeAvatar,
  Hyperlink,
  ItemThumbnail,
  MethodIcon,
  New,
  Table,
  TrackingTypeIcon
} from "~/components";
import { useItemPostingGroups } from "~/components/Form/ItemPostingGroup";
import { ReplenishmentSystemIcon } from "~/components/Icons";
import { ConfirmDelete } from "~/components/Modals";
import { useDateFormatter, usePermissions, useUser } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { methodType } from "~/modules/shared";
import type { action } from "~/routes/x+/items+/update";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import {
  itemReplenishmentSystems,
  itemTrackingTypes
} from "../../items.models";
import type { Part } from "../../types";
import PartsBulkDeleteModal from "./PartsBulkDeleteModal";
import { PartsImportModal } from "./PartsImportModal";

type PartsTableProps = {
  data: Part[];
  tags: { name: string }[];
  count: number;
};

const PartsTable = memo(({ data, tags, count }: PartsTableProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { developer } = useUser();
  const { formatDate, formatDateTime } = useDateFormatter();

  const translateReplenishment = useCallback(
    (v: string) =>
      v === "Buy" ? t`Buy` : v === "Make" ? t`Make` : t`Buy and Make`,
    [t]
  );
  const translateMethodType = useCallback(
    (v: string) =>
      v === "Purchase to Order"
        ? t`Purchase to Order`
        : v === "Pull from Inventory"
          ? t`Pull from Inventory`
          : t`Make to Order`,
    [t]
  );
  const translateTrackingType = useCallback(
    (v: string) =>
      v === "Inventory"
        ? t`Inventory`
        : v === "Non-Inventory"
          ? t`Non-Inventory`
          : v === "Serial"
            ? t`Serial`
            : t`Batch`,
    [t]
  );

  const deleteItemModal = useDisclosure();
  const bulkDeleteModal = useDisclosure();
  const importModal = useDisclosure();
  const [importMode, setImportMode] = useState<"parts" | "wholeBom">("parts");
  const revalidator = useRevalidator();
  const u8Fetcher = useFetcher<{
    data?: { enriched?: number; missingU8?: string[] } | null;
    error?: { message: string } | null;
  }>();
  const [selectedItem, setSelectedItem] = useState<Part | null>(null);
  const [selectedParts, setSelectedParts] = useState<Part[]>([]);
  const [selectedPartIds, setSelectedPartIds] = useState<string[]>([]);

  const [people] = usePeople();
  const itemPostingGroups = useItemPostingGroups();
  const customColumns = useCustomColumns<Part>("part");

  const columns = useMemo<ColumnDef<Part>[]>(() => {
    const defaultColumns: ColumnDef<Part>[] = [
      {
        accessorKey: "id",
        header: t`Part ID`,
        cell: ({ row }) => (
          <HStack className="py-1 min-w-[200px] truncate" spacing={2}>
            <ItemThumbnail
              size="md"
              thumbnailPath={row.original.thumbnailPath}
              type="Part"
            />
            <Hyperlink to={path.to.partDetails(row.original.id!)}>
              <VStack spacing={0}>
                {row.original.readableIdWithRevision}
                <div className="w-full truncate text-muted-foreground text-xs">
                  {row.original.name}
                </div>
              </VStack>
            </Hyperlink>
          </HStack>
        ),
        meta: {
          csvExport: [
            {
              header: t`Part ID`,
              accessorKey: "readableIdWithRevision",
              preserveAsText: true
            },
            { header: t`Name`, accessorKey: "name" }
          ],
          icon: <LuBookMarked />
        }
      },
      {
        accessorKey: "createdAt",
        header: t`Created At`,
        cell: (item) => formatDateTime(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        id: "createdBy",
        header: t`Created By`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.createdBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        id: "u8InfoStatus",
        header: "U8 information",
        cell: () => null,
        meta: {
          filter: {
            type: "static",
            options: [
              { value: "no-bom", label: "No BOM information" },
              { value: "no-routing", label: "No routing information" }
            ]
          },

          icon: <LuRefreshCw />
        }
      },

      {
        accessorKey: "description",
        header: t`Description`,
        cell: (item) => (
          <div className="max-w-[320px] truncate">
            {item.getValue<string>()}
          </div>
        ),
        meta: {
          icon: <LuAlignJustify />
        }
      },
      {
        accessorKey: "itemPostingGroupId",
        header: t`Item Group`,
        cell: (item) => {
          const itemPostingGroupId = item.getValue<string>();
          const itemPostingGroup = itemPostingGroups.find(
            (group) => group.value === itemPostingGroupId
          );
          const label = itemPostingGroup?.label;
          return label ? <Badge variant="secondary">{label}</Badge> : null;
        },
        meta: {
          filter: {
            type: "static",
            options: itemPostingGroups.map((group) => ({
              value: group.value,
              label: <Badge variant="secondary">{group.label}</Badge>
            }))
          },
          icon: <LuGroup />
        }
      },

      {
        accessorKey: "replenishmentSystem",
        header: t`Replenishment`,
        cell: (item) => (
          <Badge variant="secondary">
            <ReplenishmentSystemIcon
              type={item.getValue<string>()}
              className="mr-2"
            />
            <span>{translateReplenishment(item.getValue<string>())}</span>
          </Badge>
        ),
        meta: {
          filter: {
            type: "static",
            options: itemReplenishmentSystems.map((type) => ({
              value: type,
              label: (
                <Badge variant="secondary">
                  <ReplenishmentSystemIcon type={type} className="mr-2" />
                  <span>{translateReplenishment(type)}</span>
                </Badge>
              )
            }))
          },
          icon: <LuLoaderCircle />
        }
      },
      {
        accessorKey: "defaultMethodType",
        header: t`Default Method`,
        cell: (item) => (
          <Badge variant="secondary">
            <MethodIcon type={item.getValue<string>()} className="mr-2" />
            <span>{translateMethodType(item.getValue<string>())}</span>
          </Badge>
        ),
        meta: {
          filter: {
            type: "static",
            options: methodType.map((value) => ({
              value,
              label: (
                <Badge variant="secondary">
                  <MethodIcon type={value} className="mr-2" />
                  <span>{translateMethodType(value)}</span>
                </Badge>
              )
            }))
          },
          icon: <RxCodesandboxLogo />
        }
      },
      {
        accessorKey: "itemTrackingType",
        header: t`Tracking`,
        cell: (item) => (
          <Badge variant="secondary">
            <TrackingTypeIcon type={item.getValue<string>()} className="mr-2" />
            <span>{translateTrackingType(item.getValue<string>())}</span>
          </Badge>
        ),
        meta: {
          filter: {
            type: "static",
            options: itemTrackingTypes.map((type) => ({
              value: type,
              label: (
                <Badge variant="secondary">
                  <TrackingTypeIcon type={type} className="mr-2" />
                  <span>{translateTrackingType(type)}</span>
                </Badge>
              )
            }))
          },
          icon: <TbTargetArrow />
        }
      },

      {
        accessorKey: "tags",
        header: t`Tags`,
        cell: ({ row }) => (
          <HStack spacing={0} className="gap-1">
            {row.original.tags?.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </HStack>
        ),
        meta: {
          filter: {
            type: "static",
            options: tags?.map((tag) => ({
              value: tag.name,
              label: <Badge variant="secondary">{tag.name}</Badge>
            })),
            isArray: true
          },
          icon: <LuTag />
        }
      },
      {
        accessorKey: "active",
        header: t`Active`,
        cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
        meta: {
          filter: {
            type: "static",
            options: [
              { value: "true", label: t`Active` },
              { value: "false", label: t`Inactive` }
            ]
          },
          pluralHeader: t`Active Statuses`,
          icon: <LuCheck />
        }
      },
      {
        id: "updatedBy",
        header: t`Updated By`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.updatedBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "updatedAt",
        header: t`Updated At`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [
    tags,
    people,
    customColumns,
    itemPostingGroups,
    t,
    translateMethodType,
    translateReplenishment,
    translateTrackingType,
    formatDate,
    formatDateTime
  ]);

  const fetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<{
    data?: { deleted?: number } | null;
    error?: { message: string } | null;
  }>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  useEffect(() => {
    if (deleteFetcher.data?.error) {
      toast.error(deleteFetcher.data.error.message);
    } else if (deleteFetcher.data?.data?.deleted) {
      toast.success(t`Success`);
      bulkDeleteModal.onClose();
      setSelectedParts([]);
      setSelectedPartIds([]);
      revalidator.revalidate();
    }
  }, [bulkDeleteModal.onClose, deleteFetcher.data, revalidator, t]);

  useEffect(() => {
    if (u8Fetcher.data?.error) {
      toast.error(u8Fetcher.data.error.message);
    } else if (u8Fetcher.data?.data) {
      const missing = u8Fetcher.data.data.missingU8?.length ?? 0;
      toast.success(
        missing > 0
          ? "Enriched " +
              (u8Fetcher.data.data.enriched ?? 0) +
              " part(s); " +
              missing +
              " part(s) were not found in U8."
          : "Enriched " +
              (u8Fetcher.data.data.enriched ?? 0) +
              " part(s) from U8."
      );
      revalidator.revalidate();
    }
  }, [u8Fetcher.data, revalidator]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onBulkUpdate = useCallback(
    (
      selectedRows: typeof data,
      field:
        | "replenishmentSystem"
        | "defaultMethodType"
        | "itemTrackingType"
        | "itemPostingGroupId",
      value: string
    ) => {
      const formData = new FormData();
      selectedRows.forEach((row) => {
        if (row.id) formData.append("items", row.id);
      });
      formData.append("field", field);
      formData.append("value", value);
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateItems
      });
    },

    []
  );

  const canBulkDeleteParts =
    developer === true && permissions.can("delete", "parts");

  const openBulkDeleteModal = useCallback(
    (parts: Part[]) => {
      const itemIds = parts.flatMap((part) => (part.id ? [part.id] : []));
      if (itemIds.length === 0) return;

      setSelectedPartIds(itemIds);
      bulkDeleteModal.onOpen();
    },
    [bulkDeleteModal]
  );

  const renderActions = useCallback(
    (selectedRows: typeof data) => {
      return (
        <DropdownMenuContent align="end" className="min-w-[200px]">
          <DropdownMenuLabel>
            <Trans>Update</Trans>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Trans>Item Group</Trans>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {itemPostingGroups.map((group) => (
                    <DropdownMenuItem
                      key={group.value}
                      onClick={() =>
                        onBulkUpdate(
                          selectedRows,
                          "itemPostingGroupId",
                          group.value
                        )
                      }
                    >
                      <span>{group.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Trans>Replenishment</Trans>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {itemReplenishmentSystems.map((system) => (
                    <DropdownMenuItem
                      key={system}
                      onClick={() =>
                        onBulkUpdate(
                          selectedRows,
                          "replenishmentSystem",
                          system
                        )
                      }
                    >
                      <DropdownMenuIcon
                        icon={<ReplenishmentSystemIcon type={system} />}
                      />
                      <span>{translateReplenishment(system)}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Trans>Default Method Type</Trans>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {methodType.map((type) => (
                    <DropdownMenuItem
                      key={type}
                      onClick={() =>
                        onBulkUpdate(selectedRows, "defaultMethodType", type)
                      }
                    >
                      <DropdownMenuIcon icon={<MethodIcon type={type} />} />
                      <span>{translateMethodType(type)}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Trans>Tracking Type</Trans>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {itemTrackingTypes.map((type) => (
                    <DropdownMenuItem
                      key={type}
                      onClick={() =>
                        onBulkUpdate(selectedRows, "itemTrackingType", type)
                      }
                    >
                      <DropdownMenuIcon
                        icon={<TrackingTypeIcon type={type} />}
                      />
                      <span>{translateTrackingType(type)}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuItem
              disabled={
                !permissions.can("update", "parts") ||
                u8Fetcher.state !== "idle"
              }
              onClick={() => {
                const formData = new FormData();
                formData.append("operation", "u8Enrich");
                selectedRows.forEach((row) => {
                  if (row.id) formData.append("items", row.id);
                });
                u8Fetcher.submit(formData, {
                  method: "post",
                  action: path.to.parts
                });
              }}
            >
              <DropdownMenuIcon icon={<LuRefreshCw />} />
              <span>
                <Trans>U8 information completion</Trans>
              </span>
            </DropdownMenuItem>
            {canBulkDeleteParts && (
              <DropdownMenuItem
                destructive
                disabled={selectedRows.length > 100}
                onClick={() => openBulkDeleteModal(selectedRows)}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                <span>
                  <Trans>Delete</Trans>
                </span>
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      );
    },
    [
      onBulkUpdate,
      itemPostingGroups,
      translateMethodType,
      translateReplenishment,
      translateTrackingType,
      permissions,
      u8Fetcher,
      canBulkDeleteParts,
      openBulkDeleteModal
    ]
  );

  const renderContextMenu = useMemo(() => {
    return (row: Part) => {
      const revisions =
        (row.revisions as {
          id: string;
          revision: number;
        }[]) ?? [];
      return (
        <>
          <MenuItem onClick={() => navigate(path.to.part(row.id!))}>
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Part</Trans>
          </MenuItem>
          {revisions && revisions.length > 1 && (
            <MenuSub>
              <MenuSubTrigger>
                <MenuIcon icon={<LuGitPullRequestArrow />} />
                <Trans>Versions</Trans>
              </MenuSubTrigger>
              <MenuSubContent>
                {revisions.map((revision) => (
                  <MenuItem
                    key={revision.id}
                    onClick={() => navigate(path.to.part(revision.id))}
                  >
                    <MenuIcon icon={<LuTag />} />
                    {t`Revision ${revision.revision}`}
                  </MenuItem>
                ))}
              </MenuSubContent>
            </MenuSub>
          )}
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "parts")}
            onClick={() => {
              setSelectedItem(row);
              deleteItemModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Delete Part</Trans>
          </MenuItem>
        </>
      );
    };
  }, [deleteItemModal, navigate, permissions, t]);

  return (
    <>
      <Table<Part>
        count={count}
        columns={columns}
        data={data}
        defaultColumnPinning={{
          left: ["id"]
        }}
        defaultColumnVisibility={{
          description: false,
          active: false,
          updatedBy: false,
          updatedAt: false,
          u8InfoStatus: false
        }}
        importCSV={[
          {
            table: "part" as const,
            label: t`Parts`
          }
        ]}
        primaryAction={
          ((canBulkDeleteParts && selectedParts.length > 0) ||
            permissions.can("create", "parts")) && (
            <div className="flex items-center gap-2">
              {canBulkDeleteParts && selectedParts.length > 0 && (
                <Button
                  variant="destructive"
                  leftIcon={<LuTrash />}
                  disabled={selectedParts.length > 100}
                  onClick={() => openBulkDeleteModal(selectedParts)}
                >
                  <Trans>Delete</Trans> {selectedParts.length}
                </Button>
              )}
              {permissions.can("create", "parts") && (
                <>
                  <Button
                    variant="secondary"
                    leftIcon={<LuFileSpreadsheet />}
                    onClick={() => {
                      setImportMode("parts");
                      importModal.onOpen();
                    }}
                  >
                    <Trans>Import Excel</Trans>
                  </Button>
                  <Button
                    variant="secondary"
                    leftIcon={<LuGitPullRequestArrow />}
                    onClick={() => {
                      setImportMode("wholeBom");
                      importModal.onOpen();
                    }}
                  >
                    整机 BOM 导入
                  </Button>
                  <Button variant="secondary" leftIcon={<LuGroup />} asChild>
                    <Link to={path.to.itemPostingGroups}>
                      <Trans>Item Groups</Trans>
                    </Link>
                  </Button>
                  <New label={t`Part`} to={path.to.newPart} />
                </>
              )}
            </div>
          )
        }
        onSelectedRowsChange={setSelectedParts}
        renderActions={renderActions}
        renderContextMenu={renderContextMenu}
        title={t`Parts`}
        table="part"
        withSavedView
        getRowId={(row) => row.id!}
        withSelectableRows
      />
      {importModal.isOpen && (
        <PartsImportModal mode={importMode} onClose={importModal.onClose} />
      )}
      {bulkDeleteModal.isOpen && selectedPartIds.length > 0 && (
        <PartsBulkDeleteModal
          itemIds={selectedPartIds}
          fetcher={deleteFetcher}
          onClose={() => {
            bulkDeleteModal.onClose();
            setSelectedPartIds([]);
          }}
        />
      )}
      {selectedItem && selectedItem.id && (
        <ConfirmDelete
          action={path.to.deleteItem(selectedItem.id!)}
          isOpen={deleteItemModal.isOpen}
          name={selectedItem.readableIdWithRevision!}
          text={t`Are you sure you want to delete ${selectedItem.readableIdWithRevision}? This cannot be undone.`}
          onCancel={() => {
            deleteItemModal.onClose();
            setSelectedItem(null);
          }}
          onSubmit={() => {
            deleteItemModal.onClose();
            setSelectedItem(null);
          }}
        />
      )}
    </>
  );
});

PartsTable.displayName = "PartTable";

export default PartsTable;
