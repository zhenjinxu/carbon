import { requirePermissions } from "@carbon/auth/auth.server";
import { getGlobalAuditLog, isAuditLogEnabled } from "@carbon/database/audit";
import type { LoaderFunctionArgs } from "react-router";
import {
  buildWorkbenchActivityCursorFilter,
  decodeWorkbenchCursor,
  encodeWorkbenchCursor,
  getWorkbenchDateRange,
  mapAuditEntryToWorkbenchActivity,
  mapNotificationToWorkbenchNotification,
  mapProjectionRowToWorkbenchActivity,
  parseWorkbenchActionFilter,
  parseWorkbenchActivityTypeFilter,
  parseWorkbenchDatePreset,
  parseWorkbenchLimit,
  type WorkbenchActivity,
  type WorkbenchActivityActionFilter,
  type WorkbenchActivityProjectionRow,
  type WorkbenchActivityTypeFilter,
  type WorkbenchCursor,
  type WorkbenchDatePreset,
  type WorkbenchModule,
  type WorkbenchNotification
} from "~/modules/items/workbench";
import type { WorkbenchRouteConfig } from "./config";

type WorkbenchProjectionError = { code?: string; message?: string };
type WorkbenchProjectionResponse = {
  data: WorkbenchActivityProjectionRow[] | null;
  count: number | null;
  error: WorkbenchProjectionError | null;
};
type WorkbenchProjectionQuery = {
  select(
    columns: string,
    options?: { count?: "exact" }
  ): WorkbenchProjectionQuery;
  eq(column: string, value: string): WorkbenchProjectionQuery;
  gte(column: string, value: string): WorkbenchProjectionQuery;
  lte(column: string, value: string): WorkbenchProjectionQuery;
  or(filter: string): WorkbenchProjectionQuery;
  order(
    column: string,
    options: { ascending: boolean }
  ): WorkbenchProjectionQuery;
  limit(count: number): Promise<WorkbenchProjectionResponse>;
};
type WorkbenchProjectionClient = {
  from(table: "workbenchActivity"): WorkbenchProjectionQuery;
};

type LoadedWorkbenchActivities = {
  activities: WorkbenchActivity[];
  activityCount: number;
  nextCursor: string | null;
  projectionAvailable: boolean;
};

export type WorkbenchLoaderData = {
  activities: WorkbenchActivity[];
  activityCount: number;
  activityType: WorkbenchActivityTypeFilter;
  action: WorkbenchActivityActionFilter;
  auditEnabled: boolean;
  dateRange: { startDate: string; endDate: string };
  limit: number;
  nextCursor: string | null;
  notifications: WorkbenchNotification[];
  projectionAvailable: boolean;
  preset: WorkbenchDatePreset;
};

function isMissingWorkbenchActivityProjection(
  error: WorkbenchProjectionError | null | undefined
) {
  const message = error?.message ?? "";
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /workbenchActivity.*(does not exist|schema cache|not find)/i.test(
      message
    ) ||
    /relation\s+"workbenchActivity"\s+does not exist/i.test(message)
  );
}

const fallbackActionByProjectionAction: Record<
  Exclude<WorkbenchActivityActionFilter, "all">,
  WorkbenchActivity["action"]
> = {
  create: "created",
  update: "updated",
  delete: "deleted"
};

function activityMatchesFilters(
  activity: WorkbenchActivity,
  filters: {
    module: WorkbenchModule;
    activityType: WorkbenchActivityTypeFilter;
    action: WorkbenchActivityActionFilter;
  }
) {
  if (activity.module !== filters.module) return false;
  if (
    filters.activityType !== "all" &&
    activity.activityType !== filters.activityType
  ) {
    return false;
  }
  if (
    filters.action !== "all" &&
    activity.action !== fallbackActionByProjectionAction[filters.action]
  ) {
    return false;
  }
  return true;
}

function normalizeNotificationPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  return {
    description:
      typeof record.description === "string" ? record.description : undefined,
    documentId:
      typeof record.documentId === "string" ? record.documentId : undefined,
    documentType:
      typeof record.documentType === "string" ? record.documentType : undefined
  };
}

async function loadProjectedActivities({
  client,
  companyId,
  userId,
  module,
  startDate,
  endDate,
  activityType,
  action,
  cursor,
  limit
}: {
  client: unknown;
  companyId: string;
  userId: string;
  module: WorkbenchModule;
  startDate: string;
  endDate: string;
  activityType: WorkbenchActivityTypeFilter;
  action: WorkbenchActivityActionFilter;
  cursor: WorkbenchCursor | null;
  limit: number;
}): Promise<LoadedWorkbenchActivities | null> {
  let query = (client as WorkbenchProjectionClient)
    .from("workbenchActivity")
    .select(
      "id, module, activityType, action, entityType, entityId, entityLabel, source, result, occurredAt, metadata",
      { count: "exact" }
    )
    .eq("companyId", companyId)
    .eq("actorId", userId)
    .eq("module", module)
    .gte("occurredAt", startDate)
    .lte("occurredAt", endDate);

  if (activityType !== "all") query = query.eq("activityType", activityType);
  if (action !== "all") query = query.eq("action", action);

  const cursorFilter = buildWorkbenchActivityCursorFilter(cursor);
  if (cursorFilter) query = query.or(cursorFilter);

  const projectionResult = await query
    .order("occurredAt", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (projectionResult.error) {
    if (
      process.env.NODE_ENV !== "production" &&
      isMissingWorkbenchActivityProjection(projectionResult.error)
    ) {
      return null;
    }
    throw new Error(
      "Failed to load workbench activity projection: " +
        (projectionResult.error.message ?? "unknown error")
    );
  }

  const rows = projectionResult.data ?? [];
  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows.at(-1);
  const nextCursor =
    rows.length > limit && lastRow
      ? encodeWorkbenchCursor({
          occurredAt: lastRow.occurredAt,
          id: lastRow.id
        })
      : null;

  return {
    activities: pageRows.map(mapProjectionRowToWorkbenchActivity),
    activityCount: projectionResult.count ?? pageRows.length,
    nextCursor,
    projectionAvailable: true
  };
}

async function loadAuditFallbackActivities({
  client,
  companyId,
  userId,
  module,
  startDate,
  endDate,
  activityType,
  action,
  limit
}: {
  client: Parameters<typeof getGlobalAuditLog>[0];
  companyId: string;
  userId: string;
  module: WorkbenchModule;
  startDate: string;
  endDate: string;
  activityType: WorkbenchActivityTypeFilter;
  action: WorkbenchActivityActionFilter;
  limit: number;
}): Promise<LoadedWorkbenchActivities> {
  const auditResult = await getGlobalAuditLog(client, companyId, {
    actorId: userId,
    startDate,
    endDate,
    limit: Math.max(limit, 100),
    offset: 0
  });
  const activities = auditResult.data
    .map(mapAuditEntryToWorkbenchActivity)
    .filter((activity) =>
      activityMatchesFilters(activity, { module, activityType, action })
    )
    .sort(
      (left, right) =>
        new Date(right.occurredAt).getTime() -
        new Date(left.occurredAt).getTime()
    );

  return {
    activities: activities.slice(0, limit),
    activityCount: activities.length,
    nextCursor: null,
    projectionAvailable: false
  };
}

export function createWorkbenchLoader(config: WorkbenchRouteConfig) {
  return async function loader({ request }: LoaderFunctionArgs) {
    const { client, companyId, userId } = await requirePermissions(
      request,
      config.permission
    );

    const url = new URL(request.url);
    const searchParams = url.searchParams;
    const preset = parseWorkbenchDatePreset(searchParams.get("preset"));
    const limit = parseWorkbenchLimit(searchParams.get("limit"));
    const cursor = decodeWorkbenchCursor(searchParams.get("cursor"));
    const activityType = parseWorkbenchActivityTypeFilter(
      searchParams.get("activityType")
    );
    const action = parseWorkbenchActionFilter(searchParams.get("action"));
    const dateRange = getWorkbenchDateRange({
      preset,
      startDate: searchParams.get("startDate") ?? undefined,
      endDate: searchParams.get("endDate") ?? undefined
    });

    const auditEnabled = await isAuditLogEnabled(client, companyId);
    const [activityResult, notificationResult] = await Promise.all([
      auditEnabled
        ? loadProjectedActivities({
            client,
            companyId,
            userId,
            module: config.module,
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            activityType,
            action,
            cursor,
            limit
          }).then(
            (result) =>
              result ??
              loadAuditFallbackActivities({
                client,
                companyId,
                userId,
                module: config.module,
                startDate: dateRange.startDate,
                endDate: dateRange.endDate,
                activityType,
                action,
                limit
              })
          )
        : Promise.resolve({
            activities: [],
            activityCount: 0,
            nextCursor: null,
            projectionAvailable: false
          }),
      client
        .from("notification")
        .select(
          "id, userId, companyId, title, description, documentId, documentType, readAt, seenAt, createdAt, payload"
        )
        .eq("userId", userId)
        .eq("companyId", companyId)
        .is("digestedInto", null)
        .order("createdAt", { ascending: false })
        .limit(100)
    ]);

    if (notificationResult.error) {
      throw new Error(
        "Failed to load workbench notifications: " +
          notificationResult.error.message
      );
    }

    const notifications = (notificationResult.data ?? []).map((row) =>
      mapNotificationToWorkbenchNotification({
        ...row,
        payload: normalizeNotificationPayload(row.payload)
      })
    );

    return {
      activities: activityResult.activities,
      activityCount: activityResult.activityCount,
      activityType,
      action,
      auditEnabled,
      dateRange,
      limit,
      nextCursor: activityResult.nextCursor,
      notifications,
      projectionAvailable: activityResult.projectionAvailable,
      preset
    } satisfies WorkbenchLoaderData;
  };
}
