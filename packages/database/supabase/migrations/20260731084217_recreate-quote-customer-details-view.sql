-- Restore the quote customer snapshot view for databases whose migration
-- history is current but whose restored schema is missing this derived object.

CREATE OR REPLACE VIEW "public"."quoteCustomerDetails"
WITH (SECURITY_INVOKER = true) AS
SELECT
  q.id AS "quoteId",
  c.name AS "customerName",
  contact."fullName" AS "contactName",
  contact."email" AS "contactEmail",
  ca."addressLine1" AS "customerAddressLine1",
  ca."addressLine2" AS "customerAddressLine2",
  ca."city" AS "customerCity",
  ca."stateProvince" AS "customerStateProvince",
  ca."postalCode" AS "customerPostalCode",
  ca."countryCode" AS "customerCountryCode",
  country."name" AS "customerCountryName",
  ctx."taxId" AS "customerTaxId",
  ctx."vatNumber" AS "customerVatNumber",
  ctx."eori" AS "customerEori"
FROM "public"."quote" q
INNER JOIN "public"."customer" c ON c."id" = q."customerId"
LEFT JOIN "public"."customerTax" ctx ON ctx."customerId" = c.id
LEFT JOIN "public"."customerContact" cc
  ON cc."id" = q."customerContactId"
LEFT JOIN "public"."contact" contact ON contact.id = cc."contactId"
LEFT JOIN "public"."customerLocation" cl
  ON cl."id" = q."customerLocationId"
LEFT JOIN "public"."address" ca ON ca."id" = cl."addressId"
LEFT JOIN "public"."country" country
  ON country.alpha2 = ca."countryCode";

GRANT SELECT ON TABLE "public"."quoteCustomerDetails" TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
