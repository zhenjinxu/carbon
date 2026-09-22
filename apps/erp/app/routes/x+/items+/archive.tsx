import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { deletionArchiveRestoreValidator } from "~/modules/items";
import {
  assertDeletionArchiveSession,
  DeletionArchiveAuthorizationError,
  type DeletionArchiveEntityType,
  deletionArchiveEntityTypes,
  getDeletionArchives,
  restoreDeletionArchives
} from "~/modules/items/deletion-archive.server";
import { DeletionArchiveTable } from "~/modules/items/ui/DeletionArchive";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Archive`,
  to: path.to.itemDeletionArchive
};

const archiveEntityTypeSet = new Set<string>(deletionArchiveEntityTypes);

function parseArchiveEntityType(value: string | null) {
  return value && archiveEntityTypeSet.has(value)
    ? (value as DeletionArchiveEntityType)
    : undefined;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  assertDeletionArchiveSession(request.headers);

  const formData = await request.formData();
  const validation = await validator(deletionArchiveRestoreValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  const { companyId, sessionUserId } = await requirePermissions(request, {
    update: "settings"
  });

  try {
    const result = await restoreDeletionArchives(getDatabaseClient(), {
      archiveIds: validation.data.archives,
      companyId,
      sessionUserId
    });
    return { data: result, error: null };
  } catch (cause) {
    if (cause instanceof DeletionArchiveAuthorizationError) {
      throw new Response(cause.message, { status: 403 });
    }
    return {
      data: null,
      error: {
        message:
          cause instanceof Error ? cause.message : "Archive restore failed"
      }
    };
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const { limit, offset } = getGenericQueryFilters(searchParams);
  const selectedType = parseArchiveEntityType(searchParams.get("type"));

  try {
    const result = await getDeletionArchives(getDatabaseClient(), {
      companyId,
      entityType: selectedType,
      limit,
      offset
    });

    return {
      archives: result.data,
      count: result.count,
      selectedType
    };
  } catch (cause) {
    throw redirect(
      path.to.items,
      await flash(request, error(cause, "Failed to load deletion archive"))
    );
  }
}

export default function ItemDeletionArchiveRoute() {
  const { archives, count, selectedType } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <DeletionArchiveTable
        data={archives}
        count={count}
        selectedType={selectedType}
      />
    </VStack>
  );
}
