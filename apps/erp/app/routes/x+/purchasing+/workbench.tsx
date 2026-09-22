import { msg } from "@lingui/core/macro";
import { purchasingWorkbenchConfig } from "~/modules/workbench/config";
import { WorkbenchPage } from "~/modules/workbench/WorkbenchPage";
import { createWorkbenchLoader } from "~/modules/workbench/workbench.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`我的工作台`,
  to: path.to.purchasingWorkbench
};

export const loader = createWorkbenchLoader(purchasingWorkbenchConfig);

export default function PurchasingWorkbenchRoute() {
  return <WorkbenchPage config={purchasingWorkbenchConfig} />;
}
