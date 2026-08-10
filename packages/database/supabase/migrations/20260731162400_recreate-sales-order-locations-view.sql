-- Restored databases can retain migration history while missing derived views.
-- Recreate the current sales-order customer and payment address projection.
CREATE OR REPLACE VIEW "public"."salesOrderLocations"
WITH (security_invoker = true) AS
SELECT
  so.id,
  c.name AS "customerName",
  ca."addressLine1" AS "customerAddressLine1",
  ca."addressLine2" AS "customerAddressLine2",
  ca.city AS "customerCity",
  ca."stateProvince" AS "customerStateProvince",
  ca."postalCode" AS "customerPostalCode",
  ca."countryCode" AS "customerCountryCode",
  cc.name AS "customerCountryName",
  ctx."taxId" AS "customerTaxId",
  ctx."vatNumber" AS "customerVatNumber",
  ctx.eori AS "customerEori",
  pc.name AS "paymentCustomerName",
  pa."addressLine1" AS "paymentAddressLine1",
  pa."addressLine2" AS "paymentAddressLine2",
  pa.city AS "paymentCity",
  pa."stateProvince" AS "paymentStateProvince",
  pa."postalCode" AS "paymentPostalCode",
  pa."countryCode" AS "paymentCountryCode",
  pn.name AS "paymentCountryName"
FROM "public"."salesOrder" AS so
INNER JOIN "public"."customer" AS c
  ON c.id = so."customerId"
LEFT OUTER JOIN "public"."customerTax" AS ctx
  ON ctx."customerId" = c.id
LEFT OUTER JOIN "public"."customerLocation" AS cl
  ON cl.id = so."customerLocationId"
LEFT OUTER JOIN "public"."address" AS ca
  ON ca.id = cl."addressId"
LEFT OUTER JOIN "public"."country" AS cc
  ON cc.alpha2 = ca."countryCode"
LEFT OUTER JOIN "public"."salesOrderPayment" AS sop
  ON sop.id = so.id
LEFT OUTER JOIN "public"."customer" AS pc
  ON pc.id = sop."invoiceCustomerId"
LEFT OUTER JOIN "public"."customerLocation" AS pl
  ON pl.id = sop."invoiceCustomerLocationId"
LEFT OUTER JOIN "public"."address" AS pa
  ON pa.id = pl."addressId"
LEFT OUTER JOIN "public"."country" AS pn
  ON pn.alpha2 = pa."countryCode";

GRANT SELECT ON TABLE "public"."salesOrderLocations" TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
