import {
  Button,
  Combobox,
  HStack,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Switch,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuClipboardList, LuPackagePlus, LuSettings2 } from "react-icons/lu";
import { Form, Link } from "react-router";
import { SearchFilter } from "~/components";
import { useLocations } from "~/components/Form/Location";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { PickingDisplaySettings } from "./PickingItemCard";

type PickingListsHeaderProps = {
  locationId: string;
  displaySettings?: PickingDisplaySettings;
  onDisplaySettingChange?: (
    key: keyof PickingDisplaySettings,
    value: boolean
  ) => void;
  selectedJobOperationIds?: string[];
};

export function PickingListsHeader({
  locationId,
  displaySettings,
  onDisplaySettingChange,
  selectedJobOperationIds = []
}: PickingListsHeaderProps) {
  const { t } = useLingui();

  const cardSettings = [
    { key: "showStatus" as keyof PickingDisplaySettings, label: t`Status` },
    { key: "showDueDate" as keyof PickingDisplaySettings, label: t`Due Date` },
    { key: "showDuration" as keyof PickingDisplaySettings, label: t`Duration` },
    { key: "showProgress" as keyof PickingDisplaySettings, label: t`Progress` },
    { key: "showCustomer" as keyof PickingDisplaySettings, label: t`Customer` },
    { key: "showSalesOrder" as keyof PickingDisplaySettings, label: t`Sales Order` },
    { key: "showDescription" as keyof PickingDisplaySettings, label: t`Description` },
    { key: "showQuantity" as keyof PickingDisplaySettings, label: t`Quantity` },
    { key: "showThumbnail" as keyof PickingDisplaySettings, label: t`Thumbnail` }
  ];
  const permissions = usePermissions();
  const locations = useLocations();

  return (
    <HStack className="px-4 py-2 justify-between bg-card border-b border-border w-full">
      <HStack>
        <Button variant="secondary" leftIcon={<LuClipboardList />} asChild>
          <Link to={path.to.pickingListsTable}>
            <Trans>View Lists</Trans>
          </Link>
        </Button>
        <SearchFilter param="search" size="sm" placeholder={t`Search`} />
      </HStack>

      <HStack>
        {selectedJobOperationIds.length > 0 && (
          <Form method="post" action={path.to.newPickingList}>
            <input type="hidden" name="locationId" value={locationId} />
            {selectedJobOperationIds.map((id) => (
              <input
                key={id}
                type="hidden"
                name="jobOperationIds[]"
                value={id}
              />
            ))}
            <Button
              type="submit"
              leftIcon={<LuPackagePlus />}
              isDisabled={!permissions.can("create", "inventory")}
            >
              <Trans>Generate Picking List</Trans>{" "}
              {selectedJobOperationIds.length}
            </Button>
          </Form>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <IconButton
              aria-label={t`Settings`}
              icon={<LuSettings2 />}
              variant="secondary"
              className="border-dashed border-border"
            />
          </PopoverTrigger>
          <PopoverContent className="w-64" align="end">
            <VStack spacing={3}>
              <span className="text-xs font-medium text-muted-foreground">
                <Trans>Location</Trans>
              </span>
              <div className="w-full">
                <Combobox
                  asButton
                  size="sm"
                  value={locationId}
                  options={locations}
                  onChange={(selected) => {
                    // hard refresh because initialValues update has no effect otherwise
                    window.location.href = `${path.to.pickingSchedule}?location=${selected}`;
                  }}
                />
              </div>

              {displaySettings && onDisplaySettingChange && (
                <>
                  <Separator />
                  <span className="text-xs font-medium text-muted-foreground">
                    <Trans>Cards</Trans>
                  </span>
                  <VStack>
                    {cardSettings.map(({ key, label }) => (
                      <Switch
                        key={key}
                        variant="small"
                        label={label}
                        checked={displaySettings[key]}
                        onCheckedChange={(checked) =>
                          onDisplaySettingChange(key, checked)
                        }
                      />
                    ))}
                  </VStack>
                </>
              )}
            </VStack>
          </PopoverContent>
        </Popover>
      </HStack>
    </HStack>
  );
}
