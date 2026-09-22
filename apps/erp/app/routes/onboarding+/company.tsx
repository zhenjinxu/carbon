import { assertIsPost, CarbonEdition, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { setCompanyId } from "@carbon/auth/company.server";
import { flash, updateCompanySession } from "@carbon/auth/session.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { redis } from "@carbon/kv";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { updateSubscriptionQuantityForCompany } from "@carbon/stripe/stripe.server";
import { Edition } from "@carbon/utils";
import { getLocalTimeZone } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";
import {
  AddressAutocomplete,
  Currency,
  Hidden,
  Input,
  Submit
} from "~/components/Form";
import { useOnboarding } from "~/hooks";
import { getLocationsList, upsertLocation } from "~/modules/resources";
import {
  getCompanies,
  getCompany,
  insertCompany,
  onboardingCompanyValidator,
  seedCompany,
  updateCompany
} from "~/modules/settings";
import { acceptPendingEmployeeInviteForLogin } from "~/modules/users/pending-invite-login.server";
import {
  acceptInvite,
  getPermissionCacheKey
} from "~/modules/users/users.server";
import { path } from "~/utils/path";
import { getOnboardingLocationFields } from "./company.helpers";

export async function loader({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const company = await getCompany(client, companyId ?? 1);

  if (company.error || !company.data) {
    return {
      company: null
    };
  }

  return { company: company.data };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {});

  // there are no entries in the userToCompany table which
  // dictates RLS for the company table

  const validation = await validator(onboardingCompanyValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const serviceRole = getCarbonServiceRole();

  const { next, ...d } = validation.data;
  const acceptedEmployeeInvite = await acceptPendingEmployeeInviteForLogin(
    serviceRole,
    userId,
    acceptInvite
  );

  if (acceptedEmployeeInvite.error) {
    return redirect(
      path.to.root,
      await flash(
        request,
        error(
          acceptedEmployeeInvite.error,
          "Failed to accept pending employee invite"
        )
      )
    );
  }

  if (acceptedEmployeeInvite.data) {
    if (CarbonEdition === Edition.Cloud) {
      await updateSubscriptionQuantityForCompany(
        acceptedEmployeeInvite.data.companyId
      );
    }

    const { data: companyRecord } = await serviceRole
      .from("company")
      .select("companyGroupId")
      .eq("id", acceptedEmployeeInvite.data.companyId)
      .single();

    const sessionCookie = await updateCompanySession(
      request,
      acceptedEmployeeInvite.data.companyId,
      companyRecord?.companyGroupId ?? ""
    );
    const companyIdCookie = setCompanyId(acceptedEmployeeInvite.data.companyId);

    throw redirect(next || path.to.authenticatedRoot, {
      headers: [
        ["Set-Cookie", sessionCookie],
        ["Set-Cookie", companyIdCookie]
      ]
    });
  }

  const locationFields = getOnboardingLocationFields(d);
  const timezone = getLocalTimeZone();

  const companies = await getCompanies(client, userId);
  const company = companies?.data?.[0];

  const locations = company?.id
    ? await getLocationsList(client, company.id)
    : null;
  const location = locations?.data?.[0];

  let companyId = company?.id;
  let locationId = location?.id ?? undefined;

  if (companyId) {
    const companyUpdate = await updateCompany(serviceRole, companyId, {
      ...d,
      updatedBy: userId
    });

    if (companyUpdate.error) {
      console.error(companyUpdate.error);
      throw new Error("Fatal: failed to update company");
    }
  } else {
    const companyInsert = await insertCompany(serviceRole, d);
    if (companyInsert.error) {
      console.error(companyInsert.error);
      throw new Error("Fatal: failed to insert company");
    }

    companyId = companyInsert.data?.id;

    if (!companyId) {
      throw new Error("Fatal: failed to get company ID");
    }

    const seed = await seedCompany(serviceRole, companyId, userId);
    if (seed.error) {
      console.error(seed.error);
      throw new Error("Fatal: failed to seed company");
    }

    if (CarbonEdition === Edition.Cloud) {
      trigger("onboard", {
        type: "lead",
        companyId,
        userId
      });
    }
  }

  if (!companyId) {
    throw new Error("Fatal: failed to get company ID");
  }

  const [terms, companySettings] = await Promise.all([
    serviceRole.from("terms").upsert({ id: companyId }, { onConflict: "id" }),
    serviceRole
      .from("companySettings")
      .upsert({ id: companyId }, { onConflict: "id" })
  ]);

  if (terms.error) {
    console.error(terms.error);
    throw new Error("Fatal: failed to ensure company terms");
  }

  if (companySettings.error) {
    console.error(companySettings.error);
    throw new Error("Fatal: failed to ensure company settings");
  }

  if (locationId) {
    const locationUpdate = await upsertLocation(serviceRole, {
      id: locationId,
      name: location?.name ?? "Headquarters",
      ...locationFields,
      timezone,
      updatedBy: userId
    });

    if (locationUpdate.error) {
      console.error(locationUpdate.error);
      throw new Error("Fatal: failed to update location");
    }
  } else {
    const existingLocations = await getLocationsList(serviceRole, companyId);
    if (existingLocations.error) {
      console.error(existingLocations.error);
      throw new Error("Fatal: failed to get locations");
    }

    const existingLocation = existingLocations.data?.[0];

    if (existingLocation?.id) {
      locationId = existingLocation.id;
      const locationUpdate = await upsertLocation(serviceRole, {
        id: locationId,
        name: existingLocation.name ?? "Headquarters",
        ...locationFields,
        timezone,
        updatedBy: userId
      });

      if (locationUpdate.error) {
        console.error(locationUpdate.error);
        throw new Error("Fatal: failed to update location");
      }
    } else {
      const locationInsert = await upsertLocation(serviceRole, {
        ...locationFields,
        name: "Headquarters",
        companyId,
        timezone,
        createdBy: userId
      });

      if (locationInsert.error) {
        console.error(locationInsert.error);
        throw new Error("Fatal: failed to insert location");
      }

      locationId = locationInsert.data?.id;
    }
  }

  if (!locationId) {
    throw new Error("Fatal: failed to get location ID");
  }

  const job = await serviceRole.from("employeeJob").upsert(
    {
      id: userId,
      companyId,
      locationId
    },
    { onConflict: "id,companyId" }
  );

  if (job.error) {
    console.error(job.error);
    throw new Error("Fatal: failed to ensure job");
  }

  await redis.del(getPermissionCacheKey(userId));

  const { data: companyRecord } = await serviceRole
    .from("company")
    .select("companyGroupId")
    .eq("id", companyId)
    .single();

  const sessionCookie = await updateCompanySession(
    request,
    companyId,
    companyRecord?.companyGroupId ?? ""
  );
  const companyIdCookie = setCompanyId(companyId);

  throw redirect(next, {
    headers: [
      ["Set-Cookie", sessionCookie],
      ["Set-Cookie", companyIdCookie]
    ]
  });
}

export default function OnboardingCompany() {
  const { t } = useLingui();
  const { company } = useLoaderData<typeof loader>();
  const { next, previous } = useOnboarding();

  const initialValues = {
    name: company?.name ?? "",
    addressLine1: company?.addressLine1 ?? "",
    city: company?.city ?? "",
    stateProvince: company?.stateProvince ?? "",
    postalCode: company?.postalCode ?? "",
    countryCode: company?.countryCode ?? "US",
    baseCurrencyCode: company?.baseCurrencyCode ?? "USD"
  };

  return (
    <Card className="max-w-lg">
      <ValidatedForm
        validator={onboardingCompanyValidator}
        defaultValues={initialValues}
        method="post"
      >
        <CardHeader>
          <CardTitle>
            <Trans>Now let's set up your company</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="next" value={next} />
          <VStack spacing={4}>
            <Input autoFocus name="name" label={t`Company Name`} />
            <AddressAutocomplete />
            <Input name="website" label={t`Website`} />
            <Currency name="baseCurrencyCode" label={t`Base Currency`} />
          </VStack>
        </CardContent>

        <CardFooter>
          <HStack>
            <Button
              variant="solid"
              isDisabled={!previous}
              size="md"
              asChild
              tabIndex={-1}
            >
              <Link to={previous} prefetch="intent">
                <Trans>Previous</Trans>
              </Link>
            </Button>
            <Submit>
              <Trans>Next</Trans>
            </Submit>
          </HStack>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
}
