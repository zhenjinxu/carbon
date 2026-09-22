import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import {
  getParts,
  partsBulkDeleteValidator,
  partsImportValidator
} from "~/modules/items";
import {
  archiveAndDeactivatePartsForTestCleanup,
  archiveAndDeletePartsForTestCleanup,
  assertPartsBulkDeleteSession,
  bulkDeleteParts,
  PartsBulkDeleteAuthorizationError
} from "~/modules/items/parts-bulk-delete.server";
import {
  annotateWholeBomWorkbook,
  matchWholeBomDrawingFileNames,
  parsePartsWorkbook,
  parseWholeBomWorkbook
} from "~/modules/items/parts-import";
import {
  enrichPartsFromU8,
  importPartsFromRows,
  importWholeBomFromPlan,
  uploadWholeBomDrawingFiles
} from "~/modules/items/parts-import.server";
import { PartsTable } from "~/modules/items/ui/Parts";
import { getTagsList } from "~/modules/shared";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { useRealtime } from "../../../hooks";

export const handle: Handle = {
  breadcrumb: msg`Parts`,
  to: path.to.parts
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const formData = await request.formData();
  if (formData.get("operation") === "delete") {
    const validation = await validator(partsBulkDeleteValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    assertPartsBulkDeleteSession(request.headers);
    const { companyId, sessionUserId } = await requirePermissions(request, {
      delete: "parts"
    });
    try {
      const result = await executePartsBulkDelete({
        companyId,
        sessionUserId,
        validation: validation.data
      });
      return { data: result, error: null };
    } catch (cause) {
      if (cause instanceof PartsBulkDeleteAuthorizationError) {
        throw new Response(cause.message, { status: 403 });
      }
      return {
        error: {
          message: friendlyBulkDeletePartsError(cause)
        },
        data: null
      };
    }
  }
  const validation = await validator(partsImportValidator).validate(formData);
  if (validation.error) return validationError(validation.error);

  const { operation, u8Enrich, items } = validation.data;
  const permission =
    operation === "excelImport" || operation === "wholeBomImport"
      ? { create: "parts" as const }
      : { update: "parts" as const };
  const { companyId, userId } = await requirePermissions(request, permission);

  try {
    if (operation === "excelImport" || operation === "wholeBomImport") {
      const file = formData.get("file");
      if (
        !file ||
        typeof file === "string" ||
        typeof file.arrayBuffer !== "function"
      ) {
        return {
          error: { message: "Please select an Excel file" },
          data: null
        };
      }
      const fileName = String((file as File).name ?? "").toLowerCase();
      if (!fileName.endsWith(".xlsx") && !fileName.endsWith(".xls")) {
        return {
          error: { message: "Only .xlsx and .xls files are supported" },
          data: null
        };
      }
      if (file.size > 10 * 1024 * 1024) {
        return {
          error: { message: "Excel files must be 10 MB or smaller" },
          data: null
        };
      }

      const excelBytes = new Uint8Array(await file.arrayBuffer());
      if (operation === "excelImport") {
        const rows = parsePartsWorkbook(excelBytes);
        const result = await importPartsFromRows({
          rows,
          companyId,
          userId,
          enrichFromU8: u8Enrich === true
        });
        return { data: result, error: null };
      }

      const plan = parseWholeBomWorkbook(excelBytes);
      const importResult = await importWholeBomFromPlan({
        plan,
        companyId,
        userId
      });
      const drawingFiles = formData
        .getAll("drawings")
        .filter(
          (entry): entry is File =>
            typeof entry !== "string" &&
            entry instanceof Blob &&
            typeof entry.arrayBuffer === "function" &&
            entry.size > 0
        );
      const drawingMatch = matchWholeBomDrawingFileNames(
        plan,
        drawingFiles.map((drawing) => drawing.name)
      );
      const drawings = await uploadWholeBomDrawingFiles({
        files: drawingFiles,
        itemIdByCode: importResult.itemIdByCode,
        companyId,
        userId
      });
      const annotatedWorkbook = importResult.failures.length
        ? {
            fileName: `${plan.rootCode}_BOM_导入结果.xlsx`,
            base64: Buffer.from(
              annotateWholeBomWorkbook(excelBytes, importResult.failures)
            ).toString("base64")
          }
        : undefined;
      return {
        data: {
          ...importResult,
          drawings: {
            ...drawings,
            expectedMissing: drawingMatch.missingExpected,
            unmatched: drawingMatch.unmatched
          },
          annotatedWorkbook
        },
        error: null
      };
    }

    const itemIds = items ?? [];
    if (itemIds.length === 0) {
      return {
        error: { message: "Select at least one part to enrich" },
        data: null
      };
    }
    const result = await enrichPartsFromU8({ itemIds, companyId, userId });
    return { data: result, error: null };
  } catch (cause) {
    console.error(cause);
    return {
      error: {
        message: cause instanceof Error ? cause.message : "Part import failed"
      },
      data: null
    };
  }
}
async function executePartsBulkDelete({
  companyId,
  sessionUserId,
  validation
}: {
  companyId: string;
  sessionUserId: string;
  validation: ReturnType<typeof partsBulkDeleteValidator.parse>;
}) {
  if (!("archive" in validation)) {
    return bulkDeleteParts(getDatabaseClient(), {
      itemIds: validation.items,
      companyId,
      sessionUserId
    });
  }

  if (
    "cleanupAction" in validation &&
    validation.cleanupAction === "deactivate"
  ) {
    return archiveAndDeactivatePartsForTestCleanup(getDatabaseClient(), {
      itemIds: validation.items,
      companyId,
      sessionUserId,
      reason: validation.reason
    });
  }

  return archiveAndDeletePartsForTestCleanup(getDatabaseClient(), {
    itemIds: validation.items,
    companyId,
    sessionUserId,
    reason: validation.reason,
    deleteTestJobs:
      "cleanupAction" in validation &&
      validation.cleanupAction === "deleteTestJobs"
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const supplierId = searchParams.get("supplierId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [parts, tags] = await Promise.all([
    getParts(client, companyId, {
      search,
      supplierId,
      limit,
      offset,
      sorts,
      filters
    }),
    getTagsList(client, companyId, "part")
  ]);

  if (parts.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(request, error(parts.error, "Failed to fetch parts"))
    );
  }

  return {
    count: parts.count ?? 0,
    parts: parts.data ?? [],
    tags: tags.data ?? []
  };
}

export default function PartsSearchRoute() {
  const { count, parts, tags } = useLoaderData<typeof loader>();

  useRealtime("part");

  return (
    <VStack spacing={0} className="h-full">
      <PartsTable data={parts} count={count} tags={tags} />
      <Outlet />
    </VStack>
  );
}
function friendlyBulkDeletePartsError(cause: unknown) {
  if (isPostgresForeignKeyError(cause)) {
    return "One or more selected parts are still referenced by other records and cannot be deleted. Remove those references or deactivate the parts instead.";
  }

  return cause instanceof Error ? cause.message : "Part deletion failed";
}

function isPostgresForeignKeyError(
  cause: unknown
): cause is { code?: string; message?: string } {
  if (typeof cause !== "object" || cause === null) return false;

  const errorLike = cause as { code?: unknown; message?: unknown };
  return (
    errorLike.code === "23503" ||
    (typeof errorLike.message === "string" &&
      errorLike.message.includes("violates foreign key constraint"))
  );
}
