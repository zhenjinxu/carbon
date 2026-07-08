import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { LuCloudUpload, LuFileSpreadsheet, LuTable2 } from "react-icons/lu";
import type { ExcelImportResult } from "~/modules/inventory/excelImport.utils";
import { parseReceiptExcel } from "~/modules/inventory/excelImport.utils";

type ImportExcelModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onImport: (data: ExcelImportResult) => void;
};

export const ImportExcelModal = ({
  isOpen,
  onClose,
  onImport
}: ImportExcelModalProps) => {
  const { t } = useLingui();
  const [parsed, setParsed] = useState<ExcelImportResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setError(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;
        const result = parseReceiptExcel(buffer);
        setParsed(result);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to parse Excel file"
        );
        setParsed(null);
      }
    };
    reader.onerror = () => {
      setError("Failed to read file");
      setParsed(null);
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
        ".xlsx"
      ],
      "application/vnd.ms-excel": [".xls"]
    },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024 // 10MB
  });

  const handleConfirm = () => {
    if (!parsed) return;
    onImport(parsed);
    toast.success(t`Excel data imported successfully`);
    handleClose();
  };

  const handleClose = () => {
    setParsed(null);
    setFileName(null);
    setError(null);
    onClose();
  };

  return (
    <Modal open={isOpen} onOpenChange={handleClose}>
      <ModalContent className="max-w-2xl">
        <ModalHeader>
          <ModalTitle>
            <Trans>Import Receipt from Excel</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Upload an Excel file (.xlsx) matching the delivery note template
            </Trans>
          </ModalDescription>
        </ModalHeader>

        <ModalBody>
          {!parsed ? (
            <VStack spacing={4}>
              {/* File upload area */}
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-md p-8 text-center cursor-pointer transition-colors ${
                  isDragActive
                    ? "border-primary bg-primary/10"
                    : "border-muted-foreground/25 hover:border-primary hover:bg-primary/5"
                }`}
              >
                <input {...getInputProps()} />
                <LuCloudUpload className="mx-auto h-12 w-12 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">
                  <Trans>Drop Excel file here, or click to select</Trans>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  .xlsx / .xls (max 10MB)
                </p>
              </div>

              {fileName && (
                <HStack spacing={2} className="text-sm">
                  <LuFileSpreadsheet className="h-4 w-4 text-green-600" />
                  <span>{fileName}</span>
                </HStack>
              )}

              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
            </VStack>
          ) : (
            <VStack spacing={4}>
              {/* Preview: Header info */}
              <div>
                <h4 className="text-sm font-medium mb-2">
                  <Trans>Header Information</Trans>
                </h4>
                <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-3 text-xs">
                  {parsed.header.receiptId && (
                    <PreviewField
                      label={t`Document Number`}
                      value={parsed.header.receiptId}
                    />
                  )}
                  {parsed.header.postingDate && (
                    <PreviewField
                      label={t`Receipt Date`}
                      value={parsed.header.postingDate}
                    />
                  )}
                  {parsed.header.contractNumber && (
                    <PreviewField
                      label={t`Contract Number`}
                      value={parsed.header.contractNumber}
                    />
                  )}
                  {parsed.header.receivingDepartment && (
                    <PreviewField
                      label={t`Receiving Department`}
                      value={parsed.header.receivingDepartment}
                    />
                  )}
                  {parsed.header.receiverContactName && (
                    <PreviewField
                      label={t`Receiver Contact`}
                      value={parsed.header.receiverContactName}
                    />
                  )}
                  {parsed.header.senderContactName && (
                    <PreviewField
                      label={t`Sender Contact`}
                      value={parsed.header.senderContactName}
                    />
                  )}
                  {parsed.header.shippingMethodName && (
                    <PreviewField
                      label={t`Shipping Method`}
                      value={parsed.header.shippingMethodName}
                    />
                  )}
                  {parsed.header.acceptanceConclusion && (
                    <PreviewField
                      label={t`Acceptance Conclusion`}
                      value={parsed.header.acceptanceConclusion}
                    />
                  )}
                </div>
              </div>

              {/* Preview: Line items */}
              <div>
                <h4 className="text-sm font-medium mb-2">
                  <Trans>Line Items</Trans> ({parsed.lines.length})
                </h4>
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="px-2 py-1.5 text-left font-medium">#</th>
                        <th className="px-2 py-1.5 text-left font-medium">
                          <Trans>Item Name</Trans>
                        </th>
                        <th className="px-2 py-1.5 text-left font-medium">
                          <Trans>Specification</Trans>
                        </th>
                        <th className="px-2 py-1.5 text-left font-medium">
                          <Trans>Unit</Trans>
                        </th>
                        <th className="px-2 py-1.5 text-right font-medium">
                          <Trans>Expected Qty</Trans>
                        </th>
                        <th className="px-2 py-1.5 text-right font-medium">
                          <Trans>Unit Price</Trans>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.lines.map((line, idx) => (
                        <tr key={idx} className="border-b last:border-b-0">
                          <td className="px-2 py-1">{line.sequence}</td>
                          <td className="px-2 py-1">{line.itemName}</td>
                          <td className="px-2 py-1 text-muted-foreground">
                            {line.specification}
                          </td>
                          <td className="px-2 py-1">{line.unit}</td>
                          <td className="px-2 py-1 text-right">
                            {line.expectedQuantity}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {line.unitPrice?.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </VStack>
          )}
        </ModalBody>

        <ModalFooter>
          <Button variant="outline" onClick={handleClose}>
            <Trans>Cancel</Trans>
          </Button>
          {parsed && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setParsed(null);
                  setFileName(null);
                  setError(null);
                }}
              >
                <Trans>Re-select File</Trans>
              </Button>
              <Button variant="primary" onClick={handleConfirm}>
                <LuTable2 className="mr-2 h-4 w-4" />
                <Trans>Confirm Import</Trans>
              </Button>
            </>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

function PreviewField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
