import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast
} from "@carbon/react";
import { useEffect, useRef } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { path } from "~/utils/path";

type PartsImportModalProps = {
  onClose: () => void;
};

type PartsImportResponse = {
  data?: {
    imported?: number;
    enriched?: number;
    missingU8?: string[];
  } | null;
  error?: { message: string } | null;
};

export function PartsImportModal({ onClose }: PartsImportModalProps) {
  const fetcher = useFetcher<PartsImportResponse>();
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
    const result = fetcher.data.data;
    if (!result) return;
    const missing = result.missingU8?.length ?? 0;
    toast.success(
      missing > 0
        ? "Imported " +
            (result.imported ?? 0) +
            " part(s); " +
            missing +
            " part(s) were not found in U8."
        : "Imported " + (result.imported ?? 0) + " part(s)."
    );
    revalidator.revalidate();
    onClose();
  }, [fetcher.data, fetcher.state, onClose, revalidator]);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && fetcher.state === "idle") onClose();
      }}
    >
      <ModalContent onInteractOutside={(event) => event.preventDefault()}>
        <ModalHeader>
          <ModalTitle>Import parts from Excel</ModalTitle>
        </ModalHeader>
        <fetcher.Form
          method="post"
          action={path.to.parts}
          encType="multipart/form-data"
          onSubmit={() => {
            submitted.current = true;
            toast.info("Importing parts...");
          }}
        >
          <ModalBody>
            <div className="flex flex-col gap-4">
              <input type="hidden" name="operation" value="excelImport" />
              <label className="flex flex-col gap-2 text-sm font-medium">
                Excel file
                <input
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  type="file"
                  name="file"
                  accept=".xlsx,.xls"
                  required
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="u8Enrich" />
                <span>U8 information completion</span>
              </label>
              <p className="text-sm text-muted-foreground">
                The workbook must contain the 物料 and 说明 columns.
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              isDisabled={fetcher.state !== "idle"}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
            >
              Import
            </Button>
          </ModalFooter>
        </fetcher.Form>
      </ModalContent>
    </Modal>
  );
}
