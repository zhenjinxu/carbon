import { describe, expect, it } from "vitest";

import { getOnboardingLocationFields } from "./company.helpers";

describe("getOnboardingLocationFields", () => {
  it("keeps only location columns from onboarding company data", () => {
    const result = getOnboardingLocationFields({
      name: "上海埃倍迪智能科技有限公司",
      addressLine1: "上海市金山工业区亭卫公路5899号",
      addressLine2: undefined,
      city: "上海",
      stateProvince: "CA",
      postalCode: "201506",
      countryCode: "US",
      baseCurrencyCode: "USD",
      website: "https://example.com",
      phone: "123",
      fax: undefined,
      email: "ops@example.com",
      vatNumber: "vat",
      eori: "eori"
    });

    expect(result).toEqual({
      addressLine1: "上海市金山工业区亭卫公路5899号",
      addressLine2: undefined,
      city: "上海",
      stateProvince: "CA",
      postalCode: "201506",
      countryCode: "US"
    });
    expect(result).not.toHaveProperty("name");
    expect(result).not.toHaveProperty("baseCurrencyCode");
    expect(result).not.toHaveProperty("website");
    expect(result).not.toHaveProperty("phone");
    expect(result).not.toHaveProperty("email");
    expect(result).not.toHaveProperty("vatNumber");
    expect(result).not.toHaveProperty("eori");
  });
});
