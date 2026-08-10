import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Badge,
  BarProgress,
  Button,
  Card,
  CardContent,
  HStack,
  Input,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ComponentProps } from "react";
import {
  LuActivity,
  LuCircleCheck,
  LuClockAlert,
  LuFactory,
  LuListFilter,
  LuPackageCheck
} from "react-icons/lu";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, Link, useLoaderData, useSearchParams } from "react-router";
import { u8DashboardFilterValidator } from "~/modules/production";
import { getU8ProductionDashboard } from "~/modules/production/u8.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const config = { runtime: "nodejs" };

export const meta: MetaFunction = () => [
  { title: "Carbon | U8 Work Order Overview" }
];

export const handle: Handle = {
  breadcrumb: msg`Work Order Overview`,
  to: path.to.u8WorkOrders
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee",
    bypassRls: true
  });
  const url = new URL(request.url);
  const parsed = u8DashboardFilterValidator.parse({
    search: url.searchParams.get("search") || undefined,
    customer: url.searchParams.get("customer") || undefined,
    status: url.searchParams.get("status") || undefined,
    startDate: url.searchParams.get("startDate") || null,
    endDate: url.searchParams.get("endDate") || null,
    page: Number(url.searchParams.get("page") || 1),
    pageSize: Number(url.searchParams.get("pageSize") || 25),
    selectedJobId: url.searchParams.get("jobId") || undefined
  });

  const dashboard = await getU8ProductionDashboard(companyId, parsed);
  return { ...dashboard, filters: parsed };
}

type BadgeVariant = ComponentProps<typeof Badge>["variant"];

function statusVariant(status: string): BadgeVariant {
  if (["Completed", "Closed", "Done"].includes(status)) return "green";
  if (["In Progress", "Released"].includes(status)) return "blue";
  if (["Paused", "Waiting"].includes(status)) return "yellow";
  if (["Cancelled", "Canceled"].includes(status)) return "gray";
  return "secondary";
}

function Kpi({
  label,
  value,
  icon
}: {
  label: React.ReactNode;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="flex items-center justify-between p-4">
        <div className="min-w-0">
          <div className="truncate text-muted-foreground text-sm">{label}</div>
          <div className="mt-1 font-semibold text-2xl tabular-nums">
            {value.toLocaleString()}
          </div>
        </div>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}

function Ranking({
  title,
  data
}: {
  title: React.ReactNode;
  data: Array<{ name: string; count: number }>;
}) {
  const max = Math.max(...data.map((item) => item.count), 1);
  return (
    <section className="min-w-0 space-y-3">
      <h2 className="font-medium text-base">{title}</h2>
      <div className="space-y-3">
        {data.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <Trans>No data</Trans>
          </div>
        ) : (
          data.map((item) => (
            <div
              key={item.name}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1"
            >
              <span className="truncate text-sm">{item.name}</span>
              <span className="text-muted-foreground text-sm tabular-nums">
                {item.count.toLocaleString()}
              </span>
              <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width:
                      String(
                        Math.max(4, Math.round((item.count / max) * 100))
                      ) + "%"
                  }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default function U8WorkOrderOverviewRoute() {
  const { summary, customers, operations, workOrders, total, detail, filters } =
    useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const pageCount = Math.max(1, Math.ceil(total / filters.pageSize));

  const hrefWith = (updates: Record<string, string | number | null>) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, String(value));
    }
    return "?" + params.toString();
  };

  return (
    <div className="h-full min-w-0 w-full overflow-y-auto">
      <div className="mx-auto flex min-w-0 w-full max-w-[1600px] flex-col gap-6 p-4 md:p-6">
        <header className="border-b pb-5">
          <h1 className="font-semibold text-2xl">
            <Trans>Production Dashboard</Trans>
          </h1>
        </header>

        <Form
          method="get"
          className="grid items-end gap-3 border-b pb-5 md:grid-cols-2 xl:grid-cols-6"
        >
          <div className="space-y-2 xl:col-span-2">
            <label htmlFor="search" className="font-medium text-sm">
              <Trans>Order, item or sales order</Trans>
            </label>
            <Input
              id="search"
              name="search"
              defaultValue={filters.search ?? ""}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="customer" className="font-medium text-sm">
              <Trans>Customer</Trans>
            </label>
            <Input
              id="customer"
              name="customer"
              defaultValue={filters.customer ?? ""}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="status" className="font-medium text-sm">
              <Trans>Status</Trans>
            </label>
            <select
              id="status"
              name="status"
              defaultValue={filters.status ?? ""}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">
                <Trans>All statuses</Trans>
              </option>
              <option value="Planned">Planned</option>
              <option value="Ready">Ready</option>
              <option value="In Progress">In Progress</option>
              <option value="Paused">Paused</option>
              <option value="Completed">Completed</option>
              <option value="Closed">Closed</option>
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="dashboardStartDate" className="font-medium text-sm">
              <Trans>Start from</Trans>
            </label>
            <Input
              id="dashboardStartDate"
              type="date"
              name="startDate"
              defaultValue={filters.startDate ?? ""}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="dashboardEndDate" className="font-medium text-sm">
              <Trans>Start to</Trans>
            </label>
            <Input
              id="dashboardEndDate"
              type="date"
              name="endDate"
              defaultValue={filters.endDate ?? ""}
            />
          </div>
          <input type="hidden" name="pageSize" value={filters.pageSize} />
          <HStack className="md:col-span-2 xl:col-span-6 xl:justify-end">
            <Button
              type="submit"
              variant="secondary"
              leftIcon={<LuListFilter />}
            >
              <Trans>Filter</Trans>
            </Button>
            <Button variant="ghost" asChild>
              <Link to={path.to.u8WorkOrders}>
                <Trans>Reset</Trans>
              </Link>
            </Button>
          </HStack>
        </Form>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi
            label={<Trans>Total work orders</Trans>}
            value={summary.total}
            icon={<LuFactory />}
          />
          <Kpi
            label={<Trans>Released</Trans>}
            value={summary.released}
            icon={<LuPackageCheck />}
          />
          <Kpi
            label={<Trans>In progress</Trans>}
            value={summary.inProgress}
            icon={<LuActivity />}
          />
          <Kpi
            label={<Trans>Completed</Trans>}
            value={summary.completed}
            icon={<LuCircleCheck />}
          />
          <Kpi
            label={<Trans>Overdue</Trans>}
            value={summary.overdue}
            icon={<LuClockAlert />}
          />
        </section>

        <section className="grid gap-8 border-b pb-6 lg:grid-cols-2">
          <Ranking title={<Trans>Customer ranking</Trans>} data={customers} />
          <Ranking
            title={<Trans>Open operation ranking</Trans>}
            data={operations}
          />
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium text-lg">
              <Trans>Work Orders</Trans>
            </h2>
            <span className="text-muted-foreground text-sm">
              {total.toLocaleString()}
            </span>
          </div>
          <div className="max-w-full overflow-x-auto rounded-md border">
            <Table>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Work order</Trans>
                  </Th>
                  <Th>
                    <Trans>Customer</Trans>
                  </Th>
                  <Th>
                    <Trans>Item</Trans>
                  </Th>
                  <Th>
                    <Trans>Sales order</Trans>
                  </Th>
                  <Th>
                    <Trans>Status</Trans>
                  </Th>
                  <Th>
                    <Trans>Progress</Trans>
                  </Th>
                  <Th>
                    <Trans>Start</Trans>
                  </Th>
                  <Th>
                    <Trans>Due</Trans>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {workOrders.length === 0 ? (
                  <Tr>
                    <Td
                      colSpan={8}
                      className="py-12 text-center text-muted-foreground"
                    >
                      <Trans>No work orders</Trans>
                    </Td>
                  </Tr>
                ) : (
                  workOrders.map((order) => {
                    const planned = Number(order.plannedQuantity || 0);
                    const complete = Number(order.quantityComplete || 0);
                    const progress =
                      planned > 0
                        ? Math.min(100, Math.round((complete / planned) * 100))
                        : 0;
                    return (
                      <Tr key={order.id}>
                        <Td>
                          <Link
                            className="font-medium text-primary hover:underline"
                            to={hrefWith({ jobId: order.jobId })}
                          >
                            {order.moCode}
                          </Link>
                        </Td>
                        <Td>{order.customerName ?? "—"}</Td>
                        <Td>
                          <div className="max-w-64">
                            <div className="truncate">
                              {order.itemCode ?? "—"}
                            </div>
                            <div className="truncate text-muted-foreground text-xs">
                              {order.itemName}
                            </div>
                          </div>
                        </Td>
                        <Td>{order.salesOrderCode ?? "—"}</Td>
                        <Td>
                          <Badge variant={statusVariant(order.status)}>
                            {order.status}
                          </Badge>
                        </Td>
                        <Td className="min-w-36">
                          <BarProgress
                            progress={progress}
                            value={String(complete) + "/" + String(planned)}
                          />
                        </Td>
                        <Td>{order.plannedStartDate ?? "—"}</Td>
                        <Td>{order.dueDate ?? "—"}</Td>
                      </Tr>
                    );
                  })
                )}
              </Tbody>
            </Table>
          </div>
          <div className="flex items-center justify-between">
            <Button
              variant="secondary"
              disabled={filters.page <= 1}
              asChild={filters.page > 1}
            >
              {filters.page > 1 ? (
                <Link to={hrefWith({ page: filters.page - 1, jobId: null })}>
                  <Trans>Previous</Trans>
                </Link>
              ) : (
                <Trans>Previous</Trans>
              )}
            </Button>
            <span className="text-muted-foreground text-sm tabular-nums">
              {filters.page} / {pageCount}
            </span>
            <Button
              variant="secondary"
              disabled={filters.page >= pageCount}
              asChild={filters.page < pageCount}
            >
              {filters.page < pageCount ? (
                <Link to={hrefWith({ page: filters.page + 1, jobId: null })}>
                  <Trans>Next</Trans>
                </Link>
              ) : (
                <Trans>Next</Trans>
              )}
            </Button>
          </div>
        </section>

        {detail && (
          <section className="space-y-4 border-t pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-medium text-lg">
                  {detail.workOrder.moCode}
                </h2>
                <div className="text-muted-foreground text-sm">
                  {detail.workOrder.customerName ?? "—"} ·{" "}
                  {detail.workOrder.itemCode ?? "—"}
                </div>
              </div>
              <Button variant="ghost" asChild>
                <Link to={hrefWith({ jobId: null })}>
                  <Trans>Close</Trans>
                </Link>
              </Button>
            </div>
            <div className="grid gap-3">
              {detail.operations.map((operation, index) => {
                const isCurrent = operation.id === detail.currentOperationId;
                const isNext = detail.nextOperationIds.includes(operation.id);
                return (
                  <div
                    key={operation.id}
                    className="grid min-h-20 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md border p-3"
                  >
                    <div className="flex size-8 items-center justify-center rounded-md bg-muted font-medium text-sm">
                      {index + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">
                          {operation.description ?? "—"}
                        </span>
                        {isCurrent && (
                          <Badge variant="blue">
                            <Trans>Current</Trans>
                          </Badge>
                        )}
                        {isNext && (
                          <Badge variant="purple">
                            <Trans>Next</Trans>
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 text-muted-foreground text-xs">
                        {operation.workCenterName ?? "—"} ·{" "}
                        {String(operation.quantityComplete ?? 0)}/
                        {String(operation.operationQuantity ?? 0)}
                      </div>
                    </div>
                    <Badge variant={statusVariant(operation.status)}>
                      {operation.status}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
