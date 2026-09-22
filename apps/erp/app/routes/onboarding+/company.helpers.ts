type OnboardingCompanyData = {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateProvince?: string;
  postalCode: string;
  countryCode: string;
  baseCurrencyCode: string;
  phone?: string;
  fax?: string;
  email?: string;
  website?: string;
  vatNumber?: string;
  eori?: string;
};

export function getOnboardingLocationFields(data: OnboardingCompanyData) {
  const {
    addressLine1,
    addressLine2,
    city,
    stateProvince,
    postalCode,
    countryCode
  } = data;

  return {
    addressLine1,
    addressLine2,
    city,
    stateProvince,
    postalCode,
    countryCode
  };
}
