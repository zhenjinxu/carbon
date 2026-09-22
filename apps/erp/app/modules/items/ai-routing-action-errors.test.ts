import { describe, expect, it, vi } from "vitest";

vi.mock("@lingui/core/macro", () => ({
  msg: (parts: TemplateStringsArray) => {
    const message = parts.join("");
    return { id: message, message };
  }
}));

import { AiRoutingDraftProcessReferenceError } from "./ai-routing.server";
import { aiRoutingActionRuntimeFailure } from "./ai-routing-action-errors";

describe("AI routing action error mapping", () => {
  it("returns an actionable conflict for generated draft process-reference failures", () => {
    const response = aiRoutingActionRuntimeFailure(
      new AiRoutingDraftProcessReferenceError(
        "AI routing draft contains process IDs outside this company: proc-other"
      ),
      "generate-draft"
    );

    expect(response.status).toBe(409);
    expect(response.intent).toBe("generate-draft");
    expect(response.message.message).toContain(
      "Refresh approved learning samples"
    );

    const similarGeneric = aiRoutingActionRuntimeFailure(
      new Error(
        "AI routing draft contains process IDs outside this company: proc-other"
      ),
      "generate-draft"
    );
    expect(similarGeneric.status).toBe(500);
  });
});
