import { useCarbon } from "@carbon/auth";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  File,
  HStack,
  IconButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast
} from "@carbon/react";
import { convertKbToString } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { FileObject } from "@supabase/storage-js";
import type { ChangeEvent } from "react";
import { useCallback, useState } from "react";
import { LuAxis3D, LuEllipsisVertical, LuUpload } from "react-icons/lu";
import { Link, useRevalidator } from "react-router";
import { DocumentPreview, FileDropzone, Hyperlink } from "~/components";
import DocumentIcon from "~/components/DocumentIcon";
import { useDateFormatter, usePermissions, useUser } from "~/hooks";
import type { MethodItemType, OptimisticFileObject } from "~/modules/shared";
import { getDocumentType } from "~/modules/shared";
import type { ModelUpload } from "~/types";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";
import { serverStorageRemove } from "~/utils/storage";
import type { ItemFile } from "../../types";

type ItemDocumentsProps = {
  files: ItemFile[];
  itemId: string;
  modelUpload?: ModelUpload;
  type: MethodItemType;
};

const ItemDocuments = ({
  files,
  itemId,
  modelUpload,
  type
}: ItemDocumentsProps) => {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const {
    canDelete,
    download,
    downloadModel,
    deleteFile,
    deleteModel,
    getPath,
    getModelPath,
    upload,
    pendingFiles
  } = useItemDocuments({
    itemId,
    type
  });

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      upload(acceptedFiles);
    },
    [upload]
  );

  const attachmentsByName = new Map<string, FileObject | OptimisticFileObject>(
    files.map((file) => [file.name, file])
  );
  for (let pendingItem of pendingFiles) {
    let item = attachmentsByName.get(pendingItem.name);
    let merged = item ? { ...item, ...pendingItem } : pendingItem;
    attachmentsByName.set(pendingItem.name, merged);
  }

  const allFiles = Array.from(attachmentsByName.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  ) as FileObject[];

  return (
    <Card className="flex-grow">
      <HStack className="justify-between items-start">
        <CardHeader>
          <CardTitle>
            <Trans>Files</Trans>
          </CardTitle>
        </CardHeader>
        <CardAction>
          <ItemDocumentForm upload={upload} />
        </CardAction>
      </HStack>
      <CardContent>
        <Table>
          <Thead>
            <Tr>
              <Th>
                <Trans>Name</Trans>
              </Th>
              <Th>
                <Trans>Size</Trans>
              </Th>
              <Th>
                <Trans>Created</Trans>
              </Th>
              <Th></Th>
            </Tr>
          </Thead>
          <Tbody>
            {modelUpload?.modelId && (
              <Tr>
                <Td>
                  <HStack>
                    <LuAxis3D className="text-emerald-500 w-6 h-6" />
                    <Hyperlink target="_blank" to={getModelPath(modelUpload)}>
                      {modelUpload.modelName}
                    </Hyperlink>
                  </HStack>
                </Td>
                <Td className="text-xs font-mono">
                  {modelUpload.modelSize
                    ? convertKbToString(
                        Math.floor((modelUpload.modelSize ?? 0) / 1024)
                      )
                    : "--"}
                </Td>
                <Td className="text-xs font-mono">--</Td>
                <Td>
                  <div className="flex justify-end w-full">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          aria-label={t`More`}
                          icon={<LuEllipsisVertical />}
                          variant="secondary"
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem asChild>
                          <Link to={getModelPath(modelUpload)}>
                            <Trans>View</Trans>
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => downloadModel(modelUpload)}
                        >
                          Download
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          destructive
                          disabled={!canDelete}
                          onClick={() => deleteModel()}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </Td>
              </Tr>
            )}
            {allFiles.map((file) => {
              const type = getDocumentType(file.name);
              return (
                <Tr key={file.id}>
                  <Td>
                    <HStack>
                      <DocumentIcon type={type} />
                      <span
                        className="font-medium"
                        onClick={() => {
                          if (["PDF", "Image"].includes(type)) {
                            window.open(
                              path.to.file.previewFile(
                                `${"private"}/${getPath(file)}`
                              ),
                              "_blank"
                            );
                          } else {
                            download(file);
                          }
                        }}
                      >
                        {["PDF", "Image"].includes(type) ? (
                          <DocumentPreview
                            bucket="private"
                            pathToFile={getPath(file)}
                            // @ts-ignore
                            type={type}
                          >
                            {file.name}
                          </DocumentPreview>
                        ) : (
                          file.name
                        )}
                      </span>
                    </HStack>
                  </Td>
                  <Td className="text-xs font-mono">
                    {convertKbToString(
                      Math.floor((file.metadata?.size ?? 0) / 1024)
                    )}
                  </Td>
                  <Td className="text-xs font-mono">
                    {file.created_at ? formatDate(file.created_at) : "--"}
                  </Td>
                  <Td>
                    <div className="flex justify-end w-full">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            aria-label={t`More`}
                            icon={<LuEllipsisVertical />}
                            variant="secondary"
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => download(file)}>
                            Download
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            destructive
                            disabled={!canDelete}
                            onClick={() => deleteFile(file)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </Td>
                </Tr>
              );
            })}
            {allFiles.length === 0 && !modelUpload && (
              <Tr>
                <Td
                  colSpan={24}
                  className="py-8 text-muted-foreground text-center"
                >
                  <Trans>No files</Trans>
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
        <FileDropzone onDrop={onDrop} />
      </CardContent>
    </Card>
  );
};

export default ItemDocuments;

type ItemDocumentFormProps = {
  upload: (files: File[]) => Promise<void>;
};

const ItemDocumentForm = ({ upload }: ItemDocumentFormProps) => {
  const permissions = usePermissions();

  const uploadFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      upload(Array.from(e.target.files));
    }
  };

  return (
    <File
      isDisabled={!permissions.can("update", "parts")}
      leftIcon={<LuUpload />}
      onChange={uploadFiles}
      multiple
    >
      New
    </File>
  );
};

type Props = {
  itemId: string;
  type: MethodItemType;
};

export const useItemDocuments = ({ itemId, type }: Props) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const revalidator = useRevalidator();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [pendingFiles, setPendingFiles] = useState<OptimisticFileObject[]>([]);

  const canDelete = permissions.can("delete", "parts");
  const getPath = useCallback(
    (file: { name: string }) => {
      return `${company.id}/parts/${itemId}/${stripSpecialCharacters(
        file.name
      )}`;
    },
    [company.id, itemId]
  );

  const deleteFile = useCallback(
    async (file: FileObject) => {
      const storagePath = getPath(file);
      const fileDelete = await serverStorageRemove([storagePath], "private");

      if (!fileDelete || fileDelete.error) {
        toast.error(fileDelete?.error?.message || t`Error deleting file`);
        return;
      }

      toast.success(t`File deleted successfully`);
      revalidator.revalidate();
    },
    [getPath, revalidator, t]
  );

  const deleteModel = useCallback(async () => {
    if (!carbon) return;

    const { error } = await carbon
      .from("item")
      .update({ modelUploadId: null })
      .eq("id", itemId);
    if (error) {
      toast.error(t`Error removing model from item`);
      return;
    }
    toast.success(t`Model removed from item`);
    revalidator.revalidate();
  }, [carbon, itemId, revalidator, t]);

  const downloadModel = useCallback(
    async (model: ModelUpload) => {
      if (!model.modelPath || !model.modelName) {
        toast.error(t`Model data is missing`);
        return;
      }

      if (!model.modelPath || !model.modelName) {
        toast.error(t`Model data is missing`);
        return;
      }

      const url = path.to.file.previewFile(`private/${model.modelPath}`);
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        document.body.appendChild(a);
        a.href = blobUrl;
        a.download = model.modelName;
        a.click();
        window.URL.revokeObjectURL(blobUrl);
        document.body.removeChild(a);
      } catch (error) {
        toast.error(t`Error downloading file`);
        console.error(error);
      }
    },

    [t]
  );

  const download = useCallback(
    async (file: FileObject) => {
      const url = path.to.file.previewFile(`private/${getPath(file)}`);
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        document.body.appendChild(a);
        a.href = blobUrl;
        a.download = file.name;
        a.click();
        window.URL.revokeObjectURL(blobUrl);
        document.body.removeChild(a);
      } catch (error) {
        toast.error(t`Error downloading file`);
        console.error(error);
      }
    },

    [getPath, t]
  );

  const getModelPath = useCallback((model: ModelUpload) => {
    if (!model?.modelId) {
      return "";
    }
    return path.to.file.cadModel(model.modelId);
  }, []);

  const upload = useCallback(
    async (files: File[]) => {
      // Add optimistic items immediately so they don't flash/disappear
      setPendingFiles((prev) => [
        ...prev,
        ...files.map((file) => {
          const sanitizedFileName = stripSpecialCharacters(file.name);
          const filePath = `parts/${itemId}/${sanitizedFileName}`;
          return {
            id: filePath,
            name: file.name,
            bucket_id: "private",
            bucket: "private",
            metadata: {
              size: file.size,
              mimetype: getDocumentType(file.name)
            }
          } as OptimisticFileObject;
        })
      ]);

      const failedFileNames = new Set<string>();
      for (const file of files) {
        toast.info(t`Uploading ${file.name}`);
        const formData = new FormData();
        formData.append("file", file);
        formData.append("name", file.name);
        formData.append("size", Math.round(file.size / 1024).toString());
        formData.append("sourceDocument", type);
        formData.append("sourceDocumentId", itemId);

        try {
          const response = await fetch(path.to.api.documentUpload, {
            method: "POST",
            body: formData
          });
          const result = await response.json();
          if (result.error) {
            failedFileNames.add(file.name);
            console.error(`[ItemDocuments] Upload failed for ${file.name}:`, result.error);
            toast.error(`Failed to upload ${file.name}: ${result.error}`);
          } else {
            toast.success(t`Uploaded: ${file.name}`);
          }
        } catch (error) {
          failedFileNames.add(file.name);
          console.error(`[ItemDocuments] Upload error for ${file.name}:`, error);
          toast.error(`Failed to upload ${file.name}`);
        }
      }
      // Wait for revalidation to complete — new files arrive in the same
      // render cycle as the pendingFiles cleanup below, so no flash occurs.
      await revalidator.revalidate();
      setPendingFiles((prev) => prev.filter((f) => failedFileNames.has(f.name)));
    },
    [revalidator, type, itemId, t]
  );

  return {
    canDelete,
    deleteFile,
    deleteModel,
    download,
    downloadModel,
    getPath,
    getModelPath,
    upload,
    pendingFiles
  };
};