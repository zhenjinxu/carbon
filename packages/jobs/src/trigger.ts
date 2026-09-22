import * as triggerModule from "@carbon/lib/trigger";

type CarbonTriggerModule = typeof import("@carbon/lib/trigger");
type RuntimeTriggerModule = Partial<CarbonTriggerModule> & {
  default?: Partial<CarbonTriggerModule>;
  "module.exports"?: Partial<CarbonTriggerModule>;
};

const runtimeTriggerModule = triggerModule as RuntimeTriggerModule;
const resolvedTriggerModule =
  runtimeTriggerModule.trigger && runtimeTriggerModule.batchTrigger
    ? runtimeTriggerModule
    : (runtimeTriggerModule.default ?? runtimeTriggerModule["module.exports"]);

if (
  typeof resolvedTriggerModule?.trigger !== "function" ||
  typeof resolvedTriggerModule.batchTrigger !== "function"
) {
  throw new Error("@carbon/lib/trigger did not expose trigger helpers");
}

export const trigger = resolvedTriggerModule.trigger;
export const batchTrigger = resolvedTriggerModule.batchTrigger;
