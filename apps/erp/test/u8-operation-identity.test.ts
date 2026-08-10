import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
let getU8OperationKey: undefined | ((input: {
  sourceMoDId: string;
  operationSequence: string;
  sourceOperationId?: string | null;
}) => string);

try {
  ({ getU8OperationKey } = require(
    "../../../scripts/lib/u8-work-order-identity.cjs"
  ));
} catch (error) {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    error.code !== "MODULE_NOT_FOUND"
  ) {
    throw error;
  }
}

describe("U8 work-order identity", () => {
  it("distinguishes different U8 operations with the same sequence", () => {
    expect(getU8OperationKey).toBeTypeOf("function");
    if (!getU8OperationKey) return;

    const first = getU8OperationKey({
      sourceMoDId: "1000087087",
      operationSequence: "0020",
      sourceOperationId: "1000000152"
    });
    const second = getU8OperationKey({
      sourceMoDId: "1000087087",
      operationSequence: "0020",
      sourceOperationId: "1000000155"
    });

    expect(first).toBe("1000087087:0020:1000000152");
    expect(second).toBe("1000087087:0020:1000000155");
    expect(first).not.toBe(second);
  });
});
