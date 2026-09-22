import { msg } from "@lingui/core/macro";
import { productionWorkbenchConfig } from "~/modules/workbench/config";
import { WorkbenchPage } from "~/modules/workbench/WorkbenchPage";
import { createWorkbenchLoader } from "~/modules/workbench/workbench.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`我的工作台`,
  to: path.to.productionWorkbench
};

export const loader = createWorkbenchLoader(productionWorkbenchConfig);

export default function ProductionWorkbenchRoute() {
  return <WorkbenchPage config={productionWorkbenchConfig} />;
}
