import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { trigger } from "@carbon/jobs";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Input,
  Label,
  Table,
  Tbody,
  Td,
  Textarea,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { LuCirclePlay, LuSave, LuSquare, LuTimerReset } from "react-icons/lu";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction
} from "react-router";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import {
  nullableFormText,
  parseDelimitedValues,
  u8ImportConfigValidator
} from "~/modules/production";
import {
  getU8ImportConfig,
  getU8ImportErrors,
  getU8ImportHistory,
  saveU8ImportConfig
} from "~/modules/production/u8.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const config = { runtime: "nodejs" };

export const meta: MetaFunction = () => [
  { title: "Carbon | U8 Work Order Import" }
];

export const handle: Handle = {
  breadcrumb: msg`Work Order Import`,
  to: path.to.u8WorkOrderImport
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee",
    bypassRls: true
  });

  const [importConfig, history, errors] = await Promise.all([
    getU8ImportConfig(companyId),
    getU8ImportHistory(companyId),
    getU8ImportErrors(companyId)
  ]);

  return { importConfig, history, errors };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "production",
    role: "employee",
    bypassRls: true
  });
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  const current = await getU8ImportConfig(companyId);
  const validation = u8ImportConfigValidator.safeParse({
    customerNames: parseDelimitedValues(formData.get("customerNames")),
    moCodes: parseDelimitedValues(formData.get("moCodes")),
    soCodes: parseDelimitedValues(formData.get("soCodes")),
    startDate: nullableFormText(formData.get("startDate")),
    endDate: nullableFormText(formData.get("endDate")),
    intervalMinutes: Number(formData.get("intervalMinutes") ?? 5)
  });

  if (!validation.success) {
    throw redirect(
      path.to.u8WorkOrderImport,
      await flash(
        request,
        error(validation.error.flatten(), "Invalid U8 import filters")
      )
    );
  }

  const enabled =
    intent === "start" ? true : intent === "stop" ? false : current.enabled;

  await saveU8ImportConfig({
    companyId,
    userId,
    enabled,
    input: validation.data
  });

  if (intent === "run") {
    await trigger("u8-work-order-import", {
      companyId,
      userId,
      triggerType: "Manual"
    });
    throw redirect(
      path.to.u8WorkOrderImport,
      await flash(request, success("U8 work-order import queued"))
    );
  }

  const message =
    intent === "start"
      ? "U8 scheduled import started"
      : intent === "stop"
        ? "U8 scheduled import stopped"
        : "U8 import filters saved";

  throw redirect(
    path.to.u8WorkOrderImport,
    await flash(request, success(message))
  );
}

function formatDateTime(value: string | Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}

function runBadge(status: string) {
  if (status === "Completed") return "green";
  if (status === "Running") return "blue";
  if (status === "Failed") return "red";
  return "gray";
}

export default function U8WorkOrderImportRoute() {
  const { importConfig, history, errors } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="h-full min-w-0 w-full overflow-y-auto">
      <div className="mx-auto flex min-w-0 w-full max-w-7xl flex-col gap-6 p-4 md:p-6">
        <header className="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="font-semibold text-2xl">
              <Trans>U8 Work Order Import</Trans>
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <Badge variant={importConfig.enabled ? "green" : "gray"}>
                {importConfig.enabled ? (
                  <Trans>Running</Trans>
                ) : (
                  <Trans>Stopped</Trans>
                )}
              </Badge>
              <span className="text-muted-foreground">
                <Trans>Last run</Trans>:{" "}
                {formatDateTime(importConfig.lastRunAt)}
              </span>
              <span className="text-muted-foreground">
                <Trans>Next run</Trans>:{" "}
                {formatDateTime(importConfig.nextRunAt)}
              </span>
            </div>
          </div>
        </header>

        <Form method="post" className="space-y-6">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-lg">
                <Trans>Import Filters</Trans>
              </h2>
              <Badge variant="secondary">
                {importConfig.customerNames.length === 0 &&
                importConfig.moCodes.length === 0 &&
                importConfig.soCodes.length === 0 &&
                !importConfig.startDate &&
                !importConfig.endDate ? (
                  <Trans>All work orders</Trans>
                ) : (
                  <Trans>Filtered</Trans>
                )}
              </Badge>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="customerNames">
                  <Trans>Customer names</Trans>
                </Label>
                <Textarea
                  id="customerNames"
                  name="customerNames"
                  rows={3}
                  defaultValue={importConfig.customerNames.join("\n")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="moCodes">
                  <Trans>Production order numbers</Trans>
                </Label>
                <Textarea
                  id="moCodes"
                  name="moCodes"
                  rows={3}
                  defaultValue={importConfig.moCodes.join("\n")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="soCodes">
                  <Trans>Sales order numbers</Trans>
                </Label>
                <Textarea
                  id="soCodes"
                  name="soCodes"
                  rows={3}
                  defaultValue={importConfig.soCodes.join("\n")}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="startDate">
                    <Trans>Planned start from</Trans>
                  </Label>
                  <Input
                    id="startDate"
                    type="date"
                    name="startDate"
                    defaultValue={importConfig.startDate ?? ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endDate">
                    <Trans>Planned start to</Trans>
                  </Label>
                  <Input
                    id="endDate"
                    type="date"
                    name="endDate"
                    defaultValue={importConfig.endDate ?? ""}
                  />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="intervalMinutes">
                    <Trans>Interval (minutes)</Trans>
                  </Label>
                  <Input
                    id="intervalMinutes"
                    type="number"
                    min={1}
                    max={1440}
                    name="intervalMinutes"
                    className="mt-2"
                    defaultValue={importConfig.intervalMinutes}
                  />
                </div>
              </div>
            </div>

            <HStack className="flex-wrap justify-end border-t pt-4">
              <Button
                type="submit"
                name="intent"
                value="save"
                variant="secondary"
                leftIcon={<LuSave />}
                disabled={busy}
              >
                <Trans>Save</Trans>
              </Button>
              <Button
                type="submit"
                name="intent"
                value="run"
                variant="secondary"
                leftIcon={<LuTimerReset />}
                disabled={busy}
              >
                <Trans>Run now</Trans>
              </Button>
              {importConfig.enabled ? (
                <Button
                  type="submit"
                  name="intent"
                  value="stop"
                  variant="destructive"
                  leftIcon={<LuSquare />}
                  disabled={busy}
                >
                  <Trans>Stop</Trans>
                </Button>
              ) : (
                <Button
                  type="submit"
                  name="intent"
                  value="start"
                  leftIcon={<LuCirclePlay />}
                  disabled={busy}
                >
                  <Trans>Start</Trans>
                </Button>
              )}
            </HStack>
          </section>
        </Form>

        <section className="space-y-3 border-t pt-5">
          <h2 className="font-medium text-lg">
            <Trans>Import History</Trans>
          </h2>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Status</Trans>
                  </Th>
                  <Th>
                    <Trans>Trigger</Trans>
                  </Th>
                  <Th>
                    <Trans>Started</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Read</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Added</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Updated</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Failed</Trans>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {history.length === 0 ? (
                  <Tr>
                    <Td
                      colSpan={7}
                      className="py-10 text-center text-muted-foreground"
                    >
                      <Trans>No import history</Trans>
                    </Td>
                  </Tr>
                ) : (
                  history.map((run) => (
                    <Tr key={run.id}>
                      <Td>
                        <Badge variant={runBadge(run.status)}>
                          {run.status}
                        </Badge>
                      </Td>
                      <Td>{run.triggerType}</Td>
                      <Td>{formatDateTime(run.startedAt)}</Td>
                      <Td className="text-right">{run.scannedCount}</Td>
                      <Td className="text-right">{run.insertedCount}</Td>
                      <Td className="text-right">{run.updatedCount}</Td>
                      <Td className="text-right">{run.errorCount}</Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </Table>
          </div>
        </section>

        {errors.length > 0 && (
          <section className="space-y-3 border-t pt-5">
            <h2 className="font-medium text-lg">
              <Trans>Recent Errors</Trans>
            </h2>
            <div className="grid gap-3">
              {errors.map((item) => (
                <Card key={item.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Badge variant="red">{item.errorCode}</Badge>
                      {item.sourceId}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm">
                    <VStack spacing={1}>
                      <span>{item.message}</span>
                      <span className="text-muted-foreground">
                        {formatDateTime(item.createdAt)}
                      </span>
                    </VStack>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
