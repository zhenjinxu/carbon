import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  Input,
  VStack
} from "@carbon/react";
import { Form, Link, useLoaderData } from "react-router";
import { Empty } from "~/components";
import {
  type WorkbenchActivity,
  type WorkbenchActivityActionFilter,
  type WorkbenchActivityTypeFilter,
  type WorkbenchDatePreset,
  workbenchDatePresets
} from "~/modules/items/workbench";
import type { WorkbenchRouteConfig } from "./config";
import { workbenchModuleLabels } from "./config";
import type { WorkbenchLoaderData } from "./workbench.server";

const presetLabels: Record<WorkbenchDatePreset, string> = {
  today: "今天",
  "1d": "最近 1 天",
  "2d": "最近 2 天",
  "3d": "最近 3 天",
  "1w": "最近 1 周",
  "2w": "最近 2 周",
  custom: "自定义范围"
};

const actionLabels: Record<WorkbenchActivity["action"], string> = {
  created: "新增",
  updated: "更新",
  deleted: "删除"
};

const activityTypeLabels: Record<WorkbenchActivityTypeFilter, string> = {
  all: "全部类型",
  import: "导入",
  edit: "编辑",
  configure: "配置"
};

const filterActionLabels: Record<WorkbenchActivityActionFilter, string> = {
  all: "全部动作",
  create: "新增",
  update: "更新",
  delete: "删除"
};

const sourceLabels: Record<WorkbenchActivity["source"], string> = {
  web: "网页",
  api: "API",
  import: "导入",
  system: "系统"
};

function buildNextPageSearch({
  preset,
  dateRange,
  activityType,
  action,
  limit,
  cursor
}: {
  preset: WorkbenchDatePreset;
  dateRange: { startDate: string; endDate: string };
  activityType: WorkbenchActivityTypeFilter;
  action: WorkbenchActivityActionFilter;
  limit: number;
  cursor: string;
}) {
  const searchParams = new URLSearchParams();
  searchParams.set("preset", preset);
  if (preset === "custom") {
    searchParams.set("startDate", dateRange.startDate.slice(0, 10));
    searchParams.set("endDate", dateRange.endDate.slice(0, 10));
  }
  if (activityType !== "all") searchParams.set("activityType", activityType);
  if (action !== "all") searchParams.set("action", action);
  searchParams.set("limit", String(limit));
  searchParams.set("cursor", cursor);
  return `?${searchParams.toString()}`;
}

export function WorkbenchPage({ config }: { config: WorkbenchRouteConfig }) {
  const {
    activities,
    activityCount,
    activityType,
    action,
    auditEnabled,
    dateRange,
    limit,
    nextCursor,
    notifications,
    projectionAvailable,
    preset
  } = useLoaderData() as WorkbenchLoaderData;
  const nextPageSearch = nextCursor
    ? buildNextPageSearch({
        preset,
        dateRange,
        activityType,
        action,
        limit,
        cursor: nextCursor
      })
    : null;

  return (
    <VStack spacing={0} className="h-full overflow-auto">
      <VStack className="mx-auto w-full max-w-7xl gap-6 p-6">
        <HStack className="items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              我的工作台
            </h1>
            <p className="text-sm text-muted-foreground">
              当前公司的个人活动与通知
            </p>
          </div>
          <Badge variant="secondary">{presetLabels[preset]}</Badge>
        </HStack>

        <Card>
          <CardHeader>
            <CardTitle>活动筛选</CardTitle>
            <CardDescription>
              按日期、类型和动作筛选最近的{config.activityNoun}。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="get" className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-sm">
                <span className="font-medium">期间</span>
                <select
                  name="preset"
                  defaultValue={preset}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {workbenchDatePresets.map((value) => (
                    <option key={value} value={value}>
                      {presetLabels[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-sm">
                <span className="font-medium">开始日期</span>
                <Input
                  name="startDate"
                  type="date"
                  defaultValue={dateRange.startDate.slice(0, 10)}
                />
              </label>
              <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-sm">
                <span className="font-medium">结束日期</span>
                <Input
                  name="endDate"
                  type="date"
                  defaultValue={dateRange.endDate.slice(0, 10)}
                />
              </label>
              <label className="flex min-w-[150px] flex-1 flex-col gap-1 text-sm">
                <span className="font-medium">类型</span>
                <select
                  name="activityType"
                  defaultValue={activityType}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {Object.entries(activityTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[150px] flex-1 flex-col gap-1 text-sm">
                <span className="font-medium">动作</span>
                <select
                  name="action"
                  defaultValue={action}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {Object.entries(filterActionLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <input type="hidden" name="limit" value={limit} />
              <Button type="submit">应用</Button>
            </Form>
            <p className="mt-3 text-xs text-muted-foreground">
              {dateRange.startDate.slice(0, 10)} -{" "}
              {dateRange.endDate.slice(0, 10)} UTC
            </p>
          </CardContent>
        </Card>

        {!auditEnabled && (
          <Alert>
            <AlertTitle>活动历史不可用</AlertTitle>
            <AlertDescription>
              {config.auditDisabledDescription}
            </AlertDescription>
          </Alert>
        )}

        {auditEnabled && !projectionAvailable && (
          <Alert>
            <AlertTitle>当前显示审计回退记录</AlertTitle>
            <AlertDescription>
              workbenchActivity
              投影迁移尚未应用到当前环境，页面暂时读取审计日志；迁移应用后将启用稳定
              cursor 分页。
            </AlertDescription>
          </Alert>
        )}

        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
          <Card className="min-w-0">
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>最近活动</CardTitle>
                <CardDescription>
                  {auditEnabled && projectionAvailable ? (
                    <>{activityCount} 条活动记录</>
                  ) : auditEnabled ? (
                    <>当前显示最近的审计回退记录。</>
                  ) : (
                    <>启用审计日志后可查看活动记录。</>
                  )}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {auditEnabled && activities.length > 0 ? (
                <div className="divide-y">
                  {activities.map((activity) => {
                    const target = config.getActivityPath(activity);
                    return (
                      <div
                        key={activity.id}
                        className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">
                              {actionLabels[activity.action]}
                            </Badge>
                            <Badge variant="secondary">
                              {activityTypeLabels[activity.activityType]}
                            </Badge>
                            <Badge variant="secondary">
                              {workbenchModuleLabels[activity.module]}
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              {sourceLabels[activity.source]}
                            </span>
                          </div>
                          <div className="mt-1 text-sm">
                            {target ? (
                              <Link
                                className="font-medium underline-offset-4 hover:underline"
                                to={target}
                              >
                                {activity.entityLabel}
                              </Link>
                            ) : (
                              <span className="font-medium">
                                {activity.entityLabel}
                              </span>
                            )}
                            <span className="ml-2 text-muted-foreground">
                              {activity.entityType} · {activity.entityId}
                            </span>
                          </div>
                        </div>
                        <time
                          className="shrink-0 text-xs text-muted-foreground"
                          dateTime={activity.occurredAt}
                        >
                          {formatUtcDateTime(activity.occurredAt)}
                        </time>
                      </div>
                    );
                  })}
                  {nextPageSearch && (
                    <div className="flex justify-end px-6 py-4">
                      <Button variant="secondary" asChild>
                        <Link to={nextPageSearch}>下一页</Link>
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <Empty className="min-h-[240px]">
                  <p className="text-xs text-muted-foreground">
                    {auditEnabled ? (
                      <>此期间没有活动。</>
                    ) : (
                      <>启用审计日志后，活动会显示在这里。</>
                    )}
                  </p>
                </Empty>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>我的通知</CardTitle>
              <CardDescription>你的未读和最近消息。</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {notifications.length > 0 ? (
                <div className="divide-y">
                  {notifications.map((notification) => {
                    const target = config.getNotificationPath(notification);
                    const notificationContent = (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium">
                            {notification.title === "Notification"
                              ? "Notification"
                              : notification.title}
                          </span>
                          {!notification.read && (
                            <Badge variant="default">新</Badge>
                          )}
                        </div>
                        {notification.description && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {notification.description}
                          </p>
                        )}
                        <time
                          className="mt-2 block text-xs text-muted-foreground"
                          dateTime={notification.createdAt}
                        >
                          {formatUtcDateTime(notification.createdAt)}
                        </time>
                      </>
                    );
                    return target ? (
                      <Link
                        key={notification.id}
                        to={target}
                        className="block px-6 py-4 hover:bg-muted/50"
                      >
                        {notificationContent}
                      </Link>
                    ) : (
                      <div key={notification.id} className="px-6 py-4">
                        {notificationContent}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Empty className="min-h-[240px]">
                  <p className="text-xs text-muted-foreground">没有通知。</p>
                </Empty>
              )}
            </CardContent>
          </Card>
        </div>
      </VStack>
    </VStack>
  );
}

function formatUtcDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toISOString().replace("T", " ").slice(0, 16);
}
