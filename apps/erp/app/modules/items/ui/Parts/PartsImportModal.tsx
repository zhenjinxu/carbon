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
  mode?: "parts" | "wholeBom";
  onClose: () => void;
};

type PartsImportResponse = {
  data?: {
    imported?: number;
    enriched?: number;
    existing?: number;
    bomLinks?: number;
    missingU8?: string[];
    drawings?: {
      uploaded: string[];
      missing: string[];
      expectedMissing?: Array<{
        code: string;
        name: string;
        rowNumber: number;
        drawingCategory: string | null;
        drawingPage: string | null;
      }>;
      unmatched?: string[];
      failed: { fileName: string; message: string }[];
    };
    annotatedWorkbook?: {
      fileName: string;
      base64: string;
    };
  } | null;
  error?: { message: string } | null;
};

function downloadBase64File(fileName: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (character) =>
    character.charCodeAt(0)
  );
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function PartsImportModal({
  mode = "parts",
  onClose
}: PartsImportModalProps) {
  const fetcher = useFetcher<PartsImportResponse>();
  const revalidator = useRevalidator();
  const submitted = useRef(false);
  const isWholeBom = mode === "wholeBom";

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

    if (isWholeBom) {
      if (result.annotatedWorkbook) {
        downloadBase64File(
          result.annotatedWorkbook.fileName,
          result.annotatedWorkbook.base64
        );
      }
      const uploaded = result.drawings?.uploaded.length ?? 0;
      const failed = result.drawings?.failed.length ?? 0;
      const expectedMissing = result.drawings?.expectedMissing?.length ?? 0;
      const unmatched =
        result.drawings?.unmatched?.length ??
        result.drawings?.missing.length ??
        0;
      toast.success(
        "Imported " +
          (result.imported ?? 0) +
          " new part(s), skipped " +
          (result.existing ?? 0) +
          " existing part(s), and wrote " +
          (result.bomLinks ?? 0) +
          " BOM link(s). Uploaded " +
          uploaded +
          " drawing(s)."
      );
      if (failed > 0 || expectedMissing > 0 || unmatched > 0) {
        toast.warning(
          "Drawing check: " +
            expectedMissing +
            " expected missing, " +
            unmatched +
            " not in this BOM, " +
            failed +
            " failed."
        );
      }
    } else {
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
    }

    revalidator.revalidate();
    onClose();
  }, [fetcher.data, fetcher.state, isWholeBom, onClose, revalidator]);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && fetcher.state === "idle") onClose();
      }}
    >
      <ModalContent onInteractOutside={(event) => event.preventDefault()}>
        <ModalHeader>
          <ModalTitle>
            {isWholeBom ? "整机 BOM 导入" : "Import parts from Excel"}
          </ModalTitle>
        </ModalHeader>
        <fetcher.Form
          method="post"
          action={path.to.parts}
          encType="multipart/form-data"
          onSubmit={() => {
            submitted.current = true;
            toast.info(isWholeBom ? "Importing BOM..." : "Importing parts...");
          }}
        >
          <ModalBody>
            <div className="flex flex-col gap-4">
              <input
                type="hidden"
                name="operation"
                value={isWholeBom ? "wholeBomImport" : "excelImport"}
              />
              <label className="flex flex-col gap-2 text-sm font-medium">
                {isWholeBom ? "BOM Excel file" : "Excel file"}
                <input
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  type="file"
                  name="file"
                  accept=".xlsx,.xls"
                  required
                />
              </label>
              {isWholeBom ? (
                <label className="flex flex-col gap-2 text-sm font-medium">
                  PDF drawings
                  <input
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    type="file"
                    name="drawings"
                    accept="application/pdf,.pdf"
                    multiple
                  />
                </label>
              ) : (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="u8Enrich" />
                  <span>U8 information completion</span>
                </label>
              )}
              <p className="text-sm text-muted-foreground">
                {isWholeBom
                  ? "The BOM workbook must contain 层级, 图号/ERP编码, 名称 and 部件内数量 columns. PDF names should match part codes."
                  : "The workbook must contain the 物料 and 说明 columns."}
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
