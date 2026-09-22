import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import {
  isAiRoutingDraftProcessReferenceError,
  isMissingAiRoutingSchemaError
} from "./ai-routing.server";

export type AiRoutingActionRuntimeFailure = {
  intent?: string;
  message: MessageDescriptor;
  status: number;
};

export function aiRoutingActionRuntimeFailure(
  error: unknown,
  intent?: string
): AiRoutingActionRuntimeFailure {
  if (isMissingAiRoutingSchemaError(error)) {
    return {
      intent,
      message: msg`The AI routing tables are not available. Apply AI routing migrations through 20260817170541_ai-routing-drawing-extraction.sql, then refresh database types.`,
      status: 503
    };
  }

  if (isAiRoutingDraftProcessReferenceError(error)) {
    return {
      intent,
      message: msg`Generated routing draft references an unavailable process. Refresh approved learning samples and try again.`,
      status: 409
    };
  }

  return {
    intent,
    message: msg`The AI routing operation failed. Check the server logs and database status.`,
    status: 500
  };
}
