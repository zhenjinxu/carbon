-- Fix: purchaseOrderLocations view was missing from the database.
-- The view definition is copied from 20260430000001_tax-status.sql (lines 358-425).
-- This view is referenced by purchasing.service.ts, purchase order routes, and PDF/email generation.

CREATE OR REPLACE VIEW "purchaseOrderLocations" WITH(SECURITY_INVOKER=true) AS
  SELECT
    po.id,
    s.name AS "supplierName",
    sa."addressLine1" AS "supplierAddressLine1",
    sa."addressLine2" AS "supplierAddressLine2",
    sa."city" AS "supplierCity",
    sa."stateProvince" AS "supplierStateProvince",
    sa."postalCode" AS "supplierPostalCode",
    sa."countryCode" AS "supplierCountryCode",
    sc."name" AS "supplierCountryName",
    stx."taxId" AS "supplierTaxId",
    stx."vatNumber" AS "supplierVatNumber",
    stx."eori" AS "supplierEori",
    scon."fullName" AS "supplierContactName",
    scon."email" AS "supplierContactEmail",
    comp."countryCode" AS "companyCountryCode",
    compc."name" AS "companyCountryName",
    dl.name AS "deliveryName",
    dl."addressLine1" AS "deliveryAddressLine1",
    dl."addressLine2" AS "deliveryAddressLine2",
    dl."city" AS "deliveryCity",
    dl."stateProvince" AS "deliveryStateProvince",
    dl."postalCode" AS "deliveryPostalCode",
    dl."countryCode" AS "deliveryCountryCode",
    dc."name" AS "deliveryCountryName",
    pod."dropShipment",
    c.name AS "customerName",
    ca."addressLine1" AS "customerAddressLine1",
    ca."addressLine2" AS "customerAddressLine2",
    ca."city" AS "customerCity",
    ca."stateProvince" AS "customerStateProvince",
    ca."postalCode" AS "customerPostalCode",
    ca."countryCode" AS "customerCountryCode",
    cc."name" AS "customerCountryName"
  FROM "purchaseOrder" po
  LEFT OUTER JOIN "supplier" s
    ON s.id = po."supplierId"
  LEFT OUTER JOIN "supplierTax" stx
    ON stx."supplierId" = s.id
  LEFT OUTER JOIN "supplierLocation" sl
    ON sl.id = po."supplierLocationId"
  LEFT OUTER JOIN "address" sa
    ON sa.id = sl."addressId"
  LEFT OUTER JOIN "country" sc
    ON sc.alpha2 = sa."countryCode"
  LEFT OUTER JOIN "supplierContact" sct
    ON sct.id = po."supplierContactId"
  LEFT OUTER JOIN "contact" scon
    ON scon.id = sct."contactId"
  LEFT OUTER JOIN "company" comp
    ON comp.id = po."companyId"
  LEFT OUTER JOIN "country" compc
    ON compc.alpha2 = comp."countryCode"
  INNER JOIN "purchaseOrderDelivery" pod
    ON pod.id = po.id
  LEFT OUTER JOIN "location" dl
    ON dl.id = pod."locationId"
  LEFT OUTER JOIN "country" dc
    ON dc.alpha2 = dl."countryCode"
  LEFT OUTER JOIN "customer" c
    ON c.id = pod."customerId"
  LEFT OUTER JOIN "customerLocation" cl
    ON cl.id = pod."customerLocationId"
  LEFT OUTER JOIN "address" ca
    ON ca.id = cl."addressId"
  LEFT OUTER JOIN "country" cc
    ON cc.alpha2 = ca."countryCode";
