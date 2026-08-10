import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  flash: vi.fn(async () => ({ headers: new Headers() })),
  getConfig: vi.fn(async () => ({
    enabled: false,
    configVersion: 10
  })),
  requirePermissions: vi.fn(async () => ({
    companyId: "company-1",
    userId: "user-1"
  })),
  saveConfig: vi.fn(async () => undefined),
  trigger: vi.fn(async () => ({ ids: ["event-1"] }))
}));

vi.mock("@carbon/auth", () => ({
  assertIsPost: vi.fn(),
  error: vi.fn((value) => value),
  success: vi.fn((value) => value)
}));
vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: mocks.requirePermissions
}));
vi.mock("@carbon/auth/session.server", () => ({ flash: mocks.flash }));
vi.mock("@carbon/jobs", () => ({ trigger: mocks.trigger }));
vi.mock("@carbon/react", () => ({}));
vi.mock("@lingui/core/macro", () => ({
  msg: (parts: TemplateStringsArray) => parts.join("")
}));
vi.mock("@lingui/react/macro", () => ({ Trans: () => null }));
vi.mock("~/modules/production", () => ({
  nullableFormText: (value: FormDataEntryValue | null) =>
    typeof value === "string" && value ? value : null,
  parseDelimitedValues: (value: FormDataEntryValue | null) =>
    typeof value === "string"
      ? value
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
  u8ImportConfigValidator: {
    safeParse: (value: unknown) => ({ success: true, data: value })
  }
}));
vi.mock("~/modules/production/u8.server", () => ({
  getU8ImportConfig: mocks.getConfig,
  getU8ImportErrors: vi.fn(async () => []),
  getU8ImportHistory: vi.fn(async () => []),
  saveU8ImportConfig: mocks.saveConfig
}));
vi.mock("~/utils/path", () => ({
  path: { to: { u8WorkOrderImport: "/x/production/u8-import" } }
}));

import { action } from "./u8-import";

describe("U8 import action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves the submitted filters before queueing a manual run", async () => {
    const formData = new FormData();
    formData.set("customerNames", "丹江口市聚农甄选品牌运营有限公司");
    formData.set("moCodes", "");
    formData.set("soCodes", "");
    formData.set("startDate", "");
    formData.set("endDate", "");
    formData.set("intervalMinutes", "1");
    formData.set("intent", "run");

    const request = new Request(
      "http://localhost:3000/x/production/u8-import",
      { method: "POST", body: formData }
    );

    await expect(
      action({ request, params: {}, context: {} })
    ).rejects.toBeInstanceOf(Response);

    expect(mocks.saveConfig).toHaveBeenCalledWith({
      companyId: "company-1",
      userId: "user-1",
      enabled: false,
      input: {
        customerNames: ["丹江口市聚农甄选品牌运营有限公司"],
        moCodes: [],
        soCodes: [],
        startDate: null,
        endDate: null,
        intervalMinutes: 1
      }
    });
    expect(mocks.trigger).toHaveBeenCalledWith("u8-work-order-import", {
      companyId: "company-1",
      userId: "user-1",
      triggerType: "Manual"
    });
    expect(mocks.saveConfig.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.trigger.mock.invocationCallOrder[0]
    );
  });
});
