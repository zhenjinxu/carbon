import {
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  RadioGroup,
  RadioGroupItem,
  Textarea
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { FetcherWithComponents } from "react-router";
import { path } from "~/utils/path";

type PartsBulkDeleteModalProps = {
  itemIds: string[];
  fetcher: FetcherWithComponents<unknown>;
  onClose: () => void;
};

type CleanupAction = "delete" | "deactivate" | "deleteTestJobs";

const cleanupActionOptions: {
  value: CleanupAction;
  title: string;
  description: string;
}[] = [
  {
    value: "delete",
    title: "仅归档并删除零件",
    description: "如果零件已经被工单引用，系统会阻断删除。"
  },
  {
    value: "deleteTestJobs",
    title: "同时删除未执行测试工单",
    description: "只会删除 Draft/Planned 且未完工、未发运、未入库的工单。"
  },
  {
    value: "deactivate",
    title: "停用零件",
    description: "保留工单、BOM 和库存引用，只把选中零件设为 inactive。"
  }
];

const PartsBulkDeleteModal = ({
  itemIds,
  fetcher,
  onClose
}: PartsBulkDeleteModalProps) => {
  const { t } = useLingui();
  const [archive, setArchive] = useState(false);
  const [cleanupAction, setCleanupAction] = useState<CleanupAction>("delete");
  const [reason, setReason] = useState("");
  const isSubmitting = fetcher.state !== "idle";
  const partsLabel = t`Parts`;
  const name = `${itemIds.length} ${partsLabel}`;
  const isMissingArchiveReason = archive && reason.trim().length === 0;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !isSubmitting) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{t`Delete ${name}`}</ModalTitle>
        </ModalHeader>
        <fetcher.Form method="post" action={path.to.parts}>
          <ModalBody>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t`Are you sure you want to delete ${name.toString()}? This cannot be undone.`}
              </p>
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  isChecked={archive}
                  disabled={isSubmitting}
                  onCheckedChange={(checked) => {
                    const nextArchive = checked === true;
                    setArchive(nextArchive);
                    if (!nextArchive) setCleanupAction("delete");
                  }}
                />
                <span>
                  <Trans>Archive</Trans>
                </span>
              </label>
              {archive && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">遇到工单引用时</p>
                    <RadioGroup
                      value={cleanupAction}
                      onValueChange={(value) =>
                        setCleanupAction(value as CleanupAction)
                      }
                      className="space-y-2"
                    >
                      {cleanupActionOptions.map((option) => (
                        <label
                          key={option.value}
                          className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm"
                        >
                          <RadioGroupItem
                            value={option.value}
                            disabled={isSubmitting}
                            className="mt-0.5"
                          />
                          <span className="space-y-1">
                            <span className="block font-medium">
                              {option.title}
                            </span>
                            <span className="block text-muted-foreground">
                              {option.description}
                            </span>
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                  </div>
                  <label className="block space-y-2 text-sm font-medium">
                    <span>
                      <Trans>Reason</Trans>
                    </span>
                    <Textarea
                      aria-label={t`Reason`}
                      name="reason"
                      required
                      rows={3}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      disabled={isSubmitting}
                    />
                  </label>
                </div>
              )}
              <input type="hidden" name="operation" value="delete" />
              {archive && <input type="hidden" name="archive" value="on" />}
              {archive && cleanupAction !== "delete" && (
                <input
                  type="hidden"
                  name="cleanupAction"
                  value={cleanupAction}
                />
              )}
              {itemIds.map((itemId) => (
                <input key={itemId} type="hidden" name="items" value={itemId} />
              ))}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              isDisabled={isSubmitting}
              onClick={onClose}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Button
              type="submit"
              variant="destructive"
              isLoading={isSubmitting}
              isDisabled={isSubmitting || isMissingArchiveReason}
            >
              <Trans>Delete</Trans>
            </Button>
          </ModalFooter>
        </fetcher.Form>
      </ModalContent>
    </Modal>
  );
};

export default PartsBulkDeleteModal;
