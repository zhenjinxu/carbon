import { DefaultDisabledSubmit, ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import {
  LuCheckCheck,
  LuCreditCard,
  LuFileSpreadsheet,
  LuShoppingCart,
  LuTicketX,
  LuTrash,
  LuTruck
} from "react-icons/lu";
import { Link, useParams, useFetcher } from "react-router";
import type { z } from "zod";
import { DocumentHeader, PrintButton } from "~/components";
import { useAuditLog } from "~/components/AuditLog";
import {
  Combobox,
  CustomFormFields,
  Hidden,
  Input,
  Location,
  Select,
  ShippingMethod,
  TextArea
} from "~/components/Form";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type {
  ExcelImportResult,
  ItemTracking,
  Receipt,
  ReceiptLine,
  ReceiptSourceDocument,
  receiptStatusType
} from "~/modules/inventory";
import {
  ImportExcelModal,
  ReceiptPostModal,
  ReceiptStatus,
  ReceiptVoidModal,
  receiptSourceDocumentType,
  receiptValidator
} from "~/modules/inventory";
import { path } from "~/utils/path";
import useReceiptForm from "./useReceiptForm";

type ReceiptFormProps = {
  initialValues: z.infer<typeof receiptValidator>;
  status: (typeof receiptStatusType)[number];
  receiptLines: ReceiptLine[];
};

const formId = "receipt-form";

const ReceiptForm = ({
  initialValues,
  status,
  receiptLines
}: ReceiptFormProps) => {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const routeData = useRouteData<{
    receipt: Receipt;
    receiptLineTracking: ItemTracking[];
    fixedAssetLines: { id: string; received: boolean }[];
  }>(path.to.receipt(receiptId));

  const { company } = useUser();
  const permissions = usePermissions();
  const { t } = useLingui();
  const {
    locationId,
    sourceDocuments,
    supplierId,
    setLocationId,
    setSourceDocument
  } = useReceiptForm({ status, initialValues });

  const postModal = useDisclosure();
  const voidModal = useDisclosure();
  const deleteDisclosure = useDisclosure();
  const importModal = useDisclosure();
  const [importedData, setImportedData] = useState<ExcelImportResult | null>(
    null
  );
  const importFetcher = useFetcher();

  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "receipt",
    entityId: receiptId,
    companyId: company.id,
    variant: "dropdown"
  });

  // Merge imported data with initial values
  const currentValues = useCallback(() => {
    if (!importedData) return initialValues;
    const h = importedData.header;
    return {
      ...initialValues,
      receiptId: h.receiptId ?? initialValues.receiptId,
      externalDocumentId:
        initialValues.sourceDocumentReadableId ??
        initialValues.externalDocumentId,
      contractNumber: h.contractNumber ?? initialValues.contractNumber,
      receivingDepartment:
        h.receivingDepartment ?? initialValues.receivingDepartment,
      receiverContactName:
        h.receiverContactName ?? initialValues.receiverContactName,
      receiverContactPhone:
        h.receiverContactPhone ?? initialValues.receiverContactPhone,
      senderContactName:
        h.senderContactName ?? initialValues.senderContactName,
      senderContactPhone:
        h.senderContactPhone ?? initialValues.senderContactPhone,
      qualityInspectionResult:
        h.qualityInspectionResult ?? initialValues.qualityInspectionResult,
      qualityInspectionNotes:
        h.qualityInspectionNotes ?? initialValues.qualityInspectionNotes,
      packagingCondition:
        h.packagingCondition ?? initialValues.packagingCondition,
      packagingNotes: h.packagingNotes ?? initialValues.packagingNotes,
      acceptanceConclusion:
        h.acceptanceConclusion ?? initialValues.acceptanceConclusion,
      acceptanceNotes: h.acceptanceNotes ?? initialValues.acceptanceNotes,
      receiverSignature:
        h.receiverSignature ?? initialValues.receiverSignature,
      senderSignature: h.senderSignature ?? initialValues.senderSignature,
      warehouseKeeperSignature:
        h.warehouseKeeperSignature ?? initialValues.warehouseKeeperSignature,
      signatureDate: h.signatureDate ?? initialValues.signatureDate
    };
  }, [importedData, initialValues])();

  const isPosted = status === "Posted";
  const isVoided = status === "Voided";
  const isInvoiced = routeData?.receipt?.invoiced === true;
  const isEditing = initialValues.id !== undefined;

  const hasReceivableFaLines = (routeData?.fixedAssetLines ?? []).some(
    (line) => line.received
  );
  const canPost =
    (receiptLines.length > 0 &&
      receiptLines.some((line) => (line.receivedQuantity ?? 0) !== 0)) ||
    hasReceivableFaLines;

  const receiptLineTracking = routeData?.receiptLineTracking ?? [];

  const canInvoice =
    isPosted &&
    !isInvoiced &&
    routeData?.receipt?.sourceDocument === "Purchase Order" &&
    routeData?.receipt?.sourceDocumentId &&
    permissions.can("create", "invoicing");

  return (
    <>
      <Card>
        <ValidatedForm
          id={formId}
          validator={receiptValidator}
          method="post"
          action={path.to.receiptDetails(initialValues.id)}
          defaultValues={currentValues}
          key={importedData ? "imported" : "initial"}
          style={{ width: "100%" }}
        >
          <DocumentHeader
            title={routeData?.receipt?.receiptId ?? ""}
            status={<ReceiptStatus status={status} />}
            menuItems={
              <>
                {auditLogTrigger}
                {isPosted && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={
                        isVoided ||
                        isInvoiced ||
                        !permissions.can("update", "inventory")
                      }
                      destructive
                      onClick={voidModal.onOpen}
                    >
                      <DropdownMenuIcon icon={<LuTicketX />} />
                      <Trans>Void</Trans>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={
                    !permissions.can("delete", "inventory") ||
                    !permissions.is("employee")
                  }
                  destructive
                  onClick={deleteDisclosure.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete</Trans>
                </DropdownMenuItem>
              </>
            }
            actions={
              <>
                {!isPosted && (
                  <Button
                    variant="secondary"
                    onClick={importModal.onOpen}
                    leftIcon={<LuFileSpreadsheet />}
                  >
                    <Trans>Import Excel</Trans>
                  </Button>
                )}
                {receiptLineTracking.length > 0 && (
                  <PrintButton
                    sourceDocument="Receipt"
                    sourceDocumentId={receiptId}
                    locationId={locationId ?? ""}
                    context="receiving"
                    fileRoutes={{
                      pdf: path.to.file.receiptLabelsPdf,
                      zpl: path.to.file.receiptLabelsZpl
                    }}
                  />
                )}
                <SourceDocumentLink
                  sourceDocument={
                    routeData?.receipt?.sourceDocument ?? undefined
                  }
                  sourceDocumentId={
                    routeData?.receipt?.sourceDocumentId ?? undefined
                  }
                  sourceDocumentReadableId={
                    routeData?.receipt?.sourceDocumentReadableId ?? undefined
                  }
                />
                <Button
                  variant={canInvoice ? "primary" : "secondary"}
                  isDisabled={!canInvoice}
                  leftIcon={<LuCreditCard />}
                  asChild
                >
                  <Link
                    to={`${path.to.newPurchaseInvoice}?sourceDocument=Purchase Order&sourceDocumentId=${routeData?.receipt?.sourceDocumentId}`}
                  >
                    <Trans>Invoice</Trans>
                  </Link>
                </Button>
                <Button
                  variant={canPost && !isPosted ? "primary" : "secondary"}
                  onClick={postModal.onOpen}
                  isDisabled={
                    !canPost || isPosted || !permissions.is("employee")
                  }
                  leftIcon={<LuCheckCheck />}
                >
                  <Trans>Post</Trans>
                </Button>
              </>
            }
          />

          <CardContent>
            <Hidden name="id" />
            <Hidden name="supplierId" value={supplierId ?? ""} />
            <VStack spacing={4} className="min-h-full">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 w-full">
                <Input name="receiptId" label={t`Receipt ID`} isReadOnly />
                <Location
                  name="locationId"
                  label={t`Location`}
                  value={locationId ?? ""}
                  onChange={(newValue) => {
                    if (newValue) setLocationId(newValue.value as string);
                  }}
                  isReadOnly={isPosted}
                />
                <Select
                  name="sourceDocument"
                  label={t`Source Document`}
                  options={receiptSourceDocumentType.map((v) => ({
                    label: v,
                    value: v
                  }))}
                  onChange={(newValue) => {
                    if (newValue) {
                      setSourceDocument(
                        newValue.value as ReceiptSourceDocument
                      );
                    }
                  }}
                  isReadOnly={isPosted}
                />
                <Combobox
                  name="sourceDocumentId"
                  label={t`Source Document ID`}
                  options={sourceDocuments.map((d) => ({
                    label: d.name,
                    value: d.id
                  }))}
                  isReadOnly={isPosted}
                />
                <Input
                  name="externalDocumentId"
                  label={t`External Reference`}
                  isDisabled={isPosted}
                />
                <Input
                  name="contractNumber"
                  label={t`Contract Number`}
                  isDisabled={isPosted}
                />
                <CustomFormFields table="receipt" />
              </div>
            </VStack>
          </CardContent>

          {/* Receiver Information */}
          <CardHeader>
            <CardTitle>
              <Trans>Receiver Information</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 w-full">
              <Input
                name="receivingDepartment"
                label={t`Receiving Department`}
                isDisabled={isPosted}
              />
              <Input
                name="receiverContactName"
                label={t`Contact Person`}
                isDisabled={isPosted}
              />
              <Input
                name="receiverContactPhone"
                label={t`Contact Phone`}
                isDisabled={isPosted}
              />
            </div>
          </CardContent>

          {/* Sender Information */}
          <CardHeader>
            <CardTitle>
              <Trans>Sender Information</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 w-full">
              <Input
                name="senderContactName"
                label={t`Sender Contact`}
                isDisabled={isPosted}
              />
              <Input
                name="senderContactPhone"
                label={t`Sender Phone`}
                isDisabled={isPosted}
              />
              <ShippingMethod
                name="shippingMethodId"
                label={t`Shipping Method`}
                disabled={isPosted}
              />
            </div>
          </CardContent>

          {/* Inspection Results */}
          <CardHeader>
            <CardTitle>
              <Trans>Inspection Results</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 w-full">
              <Select
                name="qualityInspectionResult"
                label={t`Quality Inspection`}
                options={[
                  { label: t`All Qualified`, value: "All Qualified" },
                  { label: t`Partially Qualified`, value: "Partially Qualified" },
                  { label: t`All Unqualified`, value: "All Unqualified" }
                ]}
                isDisabled={isPosted}
              />
              <Select
                name="packagingCondition"
                label={t`Packaging Condition`}
                options={[
                  { label: t`Intact`, value: "Intact" },
                  { label: t`Damaged`, value: "Damaged" }
                ]}
                isDisabled={isPosted}
              />
              <TextArea
                name="qualityInspectionNotes"
                label={t`Quality Inspection Notes`}
                isDisabled={isPosted}
              />
              <TextArea
                name="packagingNotes"
                label={t`Packaging Notes`}
                isDisabled={isPosted}
              />
              <Select
                name="acceptanceConclusion"
                label={t`Acceptance Conclusion`}
                options={[
                  { label: t`Accept`, value: "Accept" },
                  { label: t`Reject`, value: "Reject" },
                  { label: t`Partial Acceptance`, value: "Partial Acceptance" }
                ]}
                isDisabled={isPosted}
              />
              <TextArea
                name="acceptanceNotes"
                label={t`Acceptance Notes`}
                isDisabled={isPosted}
              />
            </div>
          </CardContent>

          {/* Signature Confirmation */}
          <CardHeader>
            <CardTitle>
              <Trans>Signature Confirmation</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 w-full">
              <Input
                name="receiverSignature"
                label={t`Receiver Signature`}
                isDisabled={isPosted}
              />
              <Input
                name="senderSignature"
                label={t`Sender Signature`}
                isDisabled={isPosted}
              />
              <Input
                name="warehouseKeeperSignature"
                label={t`Warehouse Keeper Signature`}
                isDisabled={isPosted}
              />
              <Input
                name="signatureDate"
                label={t`Signature Date`}
                type="date"
                isDisabled={isPosted}
              />
            </div>
          </CardContent>

          <CardFooter>
            <DefaultDisabledSubmit
              formId={formId}
              isDisabled={
                isEditing
                  ? !permissions.can("update", "inventory")
                  : !permissions.can("create", "inventory")
              }
            >
              <Trans>Save</Trans>
            </DefaultDisabledSubmit>
          </CardFooter>
        </ValidatedForm>
      </Card>

      {postModal.isOpen && <ReceiptPostModal onClose={postModal.onClose} />}
      {voidModal.isOpen && <ReceiptVoidModal onClose={voidModal.onClose} />}
      {importModal.isOpen && (
        <ImportExcelModal
          isOpen={importModal.isOpen}
          onClose={importModal.onClose}
          onImport={(data) => {
            setImportedData(data);
            importModal.onClose();

            // Submit line items to server for creation
            if (data.lines.length > 0) {
              const formData = new FormData();
              formData.append("receiptId", initialValues.id);
              formData.append("lines", JSON.stringify(data.lines));
              importFetcher.submit(formData, {
                method: "post",
                action: path.to.importReceiptLines
              });
            }
          }}
        />
      )}
      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteReceipt(receiptId)}
          isOpen={deleteDisclosure.isOpen}
          name={routeData?.receipt?.receiptId ?? "receipt"}
          text={t`Are you sure you want to delete ${routeData?.receipt?.receiptId}? This cannot be undone.`}
          onCancel={() => {
            deleteDisclosure.onClose();
          }}
          onSubmit={() => {
            deleteDisclosure.onClose();
          }}
        />
      )}
      {auditLogDrawer}
    </>
  );
};

function SourceDocumentLink({
  sourceDocument,
  sourceDocumentId,
  sourceDocumentReadableId
}: {
  sourceDocument?: string;
  sourceDocumentId?: string;
  sourceDocumentReadableId?: string;
}) {
  const permissions = usePermissions();

  if (!sourceDocument || !sourceDocumentId || !sourceDocumentReadableId)
    return null;
  switch (sourceDocument) {
    case "Purchase Order":
      if (!permissions.can("view", "purchasing")) return null;
      return (
        <Button variant="secondary" leftIcon={<LuShoppingCart />} asChild>
          <Link to={path.to.purchaseOrderDetails(sourceDocumentId!)}>
            <Trans>Purchase Order</Trans>
          </Link>
        </Button>
      );
    case "Purchase Invoice":
      if (!permissions.can("view", "invoicing")) return null;
      return (
        <Button variant="secondary" leftIcon={<LuCreditCard />} asChild>
          <Link to={path.to.purchaseInvoice(sourceDocumentId!)}>
            <Trans>Purchase Invoice</Trans>
          </Link>
        </Button>
      );
    case "Inbound Transfer":
      if (!permissions.can("view", "inventory")) return null;
      return (
        <Button variant="secondary" leftIcon={<LuTruck />} asChild>
          <Link to={path.to.warehouseTransferDetails(sourceDocumentId!)}>
            <Trans>Warehouse Transfer</Trans>
          </Link>
        </Button>
      );
    default:
      return null;
  }
}

export default ReceiptForm;
