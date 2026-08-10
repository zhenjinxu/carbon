-- Restore standard customer records for customers inserted before or outside
-- the synchronous customer interceptor. Existing customer configuration is preserved.

INSERT INTO "customerPayment" ("customerId", "invoiceCustomerId", "companyId")
SELECT customer.id, customer.id, customer."companyId"
FROM customer
WHERE NOT EXISTS (
  SELECT 1
  FROM "customerPayment" existing
  WHERE existing."customerId" = customer.id
);

INSERT INTO "customerShipping" ("customerId", "shippingCustomerId", "companyId")
SELECT customer.id, customer.id, customer."companyId"
FROM customer
WHERE NOT EXISTS (
  SELECT 1
  FROM "customerShipping" existing
  WHERE existing."customerId" = customer.id
);

INSERT INTO "customerTax" ("customerId", "companyId")
SELECT customer.id, customer."companyId"
FROM customer
WHERE NOT EXISTS (
  SELECT 1
  FROM "customerTax" existing
  WHERE existing."customerId" = customer.id
);
