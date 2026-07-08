-- Fix: Recreate views that were dropped by 20260417000100_storage-unit-rename.sql
-- but not properly recreated by 20260417000300_storage-unit-recreate-dependents.sql
--
-- Root cause: The companion migration was recorded as applied but the view
-- CREATE statements silently failed (likely due to column/table dependency
-- issues during the original apply). This migration restores all 14 missing views.

-- purchaseOrderLines (latest: 20260529120000_purchase-order-line-supplier-part.sql)
CREATE OR REPLACE VIEW "purchaseOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT DISTINCT ON (pl.id)
    pl.*,
    sp."supplierPartId" as "supplierPartIdFromSupplier",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i.name as "itemName",
    i."readableIdWithRevision" as "itemReadableId",
    i.description as "itemDescription",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost",
    jo."description" as "jobOperationDescription",
    a."name" as "accountName",
    fa."fixedAssetId" as "assetReadableId",
    fa."name" as "assetName"
  FROM "purchaseOrderLine" pl
  INNER JOIN "purchaseOrder" so ON so.id = pl."purchaseOrderId"
  LEFT JOIN "modelUpload" mu ON pl."modelUploadId" = mu."id"
  LEFT JOIN "item" i ON i.id = pl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "jobOperation" jo ON jo."id" = pl."jobOperationId"
  LEFT JOIN "account" a ON a.id = pl."accountId"
  LEFT JOIN "fixedAsset" fa ON fa.id = pl."assetId"
  LEFT JOIN "supplierPart" sp ON sp."supplierId" = so."supplierId" AND sp."itemId" = i.id
);

-- salesInvoiceLines
CREATE OR REPLACE VIEW "salesInvoiceLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i.name as "itemName",
    i.description as "itemDescription",
    ic."unitCost" as "unitCost",
    (SELECT cp."customerPartId"
     FROM "customerPartToItem" cp
     WHERE cp."customerId" = si."customerId" AND cp."itemId" = i.id
     LIMIT 1) as "customerPartId"
  FROM "salesInvoiceLine" sl
  INNER JOIN "salesInvoice" si ON si.id = sl."invoiceId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
);

-- salesInvoiceLocations
CREATE OR REPLACE VIEW "salesInvoiceLocations" WITH(SECURITY_INVOKER=true) AS
  SELECT
    si.id,
    c.name AS "customerName",
    ca."addressLine1" AS "customerAddressLine1",
    ca."addressLine2" AS "customerAddressLine2",
    ca."city" AS "customerCity",
    ca."stateProvince" AS "customerStateProvince",
    ca."postalCode" AS "customerPostalCode",
    ca."countryCode" AS "customerCountryCode",
    cc."name" AS "customerCountryName",
    ic.name AS "invoiceCustomerName",
    ica."addressLine1" AS "invoiceAddressLine1",
    ica."addressLine2" AS "invoiceAddressLine2",
    ica."city" AS "invoiceCity",
    ica."stateProvince" AS "invoiceStateProvince",
    ica."postalCode" AS "invoicePostalCode",
    ica."countryCode" AS "invoiceCountryCode",
    icc."name" AS "invoiceCountryName",
    sc.name AS "shipmentCustomerName",
    sa."addressLine1" AS "shipmentAddressLine1",
    sa."addressLine2" AS "shipmentAddressLine2",
    sa."city" AS "shipmentCity",
    sa."stateProvince" AS "shipmentStateProvince",
    sa."postalCode" AS "shipmentPostalCode",
    sa."countryCode" AS "shipmentCountryCode",
    scc."name" AS "shipmentCountryName"
  FROM "salesInvoice" si
  INNER JOIN "customer" c
    ON c.id = si."customerId"
  LEFT OUTER JOIN "customerLocation" cl
    ON cl.id = si."locationId"
  LEFT OUTER JOIN "address" ca
    ON ca.id = cl."addressId"
  LEFT OUTER JOIN "country" cc
    ON cc.alpha2 = ca."countryCode"
  LEFT OUTER JOIN "customer" ic
    ON ic.id = si."invoiceCustomerId"
  LEFT OUTER JOIN "customerLocation" icl
    ON icl.id = si."invoiceCustomerLocationId"
  LEFT OUTER JOIN "address" ica
    ON ica.id = icl."addressId"
  LEFT OUTER JOIN "country" icc
    ON icc.alpha2 = ica."countryCode"
  LEFT OUTER JOIN "salesInvoiceShipment" sis
    ON sis.id = si.id
  LEFT OUTER JOIN "customerLocation" scl
    ON scl.id = sis."locationId"
  LEFT OUTER JOIN "address" sa
    ON sa.id = scl."addressId"
  LEFT OUTER JOIN "country" scc
    ON scc.alpha2 = sa."countryCode"
  LEFT OUTER JOIN "customer" sc
    ON sc.id = scl."customerId";

-- salesInvoices
CREATE OR REPLACE VIEW "salesInvoices" WITH(SECURITY_INVOKER=true) AS
  SELECT
    si.*,
    sil."thumbnailPath",
    sil."itemType",
    sil."invoiceTotal" + COALESCE(ss."shippingCost", 0) AS "invoiceTotal",
    sil."lines"
  FROM "salesInvoice" si
  LEFT JOIN (
    SELECT
      sil."invoiceId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(
        DISTINCT (1+COALESCE(sil."taxPercent", 0))*(COALESCE(sil."quantity", 0)*(COALESCE(sil."unitPrice", 0)) + COALESCE(sil."shippingCost", 0) + COALESCE(sil."addOnCost", 0)) + COALESCE(sil."nonTaxableAddOnCost", 0)
      ) AS "invoiceTotal",
      SUM(COALESCE(sil."shippingCost", 0)) AS "shippingCost",
      MIN(i."type") AS "itemType",
      ARRAY_AGG(
        json_build_object(
          'id', sil.id,
          'invoiceLineType', sil."invoiceLineType",
          'quantity', sil."quantity",
          'unitPrice', sil."unitPrice",
          'itemId', sil."itemId"
        )
      ) AS "lines"
    FROM "salesInvoiceLine" sil
    LEFT JOIN "item" i
      ON i."id" = sil."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY sil."invoiceId"
  ) sil ON sil."invoiceId" = si."id"
  JOIN "salesInvoiceShipment" ss ON ss."id" = si."id";

-- salesOrderLines
CREATE OR REPLACE VIEW "salesOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT
    sl.*,
    i."readableIdWithRevision" as "itemReadableId",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost",
    cp."customerPartId",
    cp."customerPartRevision",
    so."orderDate",
    so."customerId",
    so."salesOrderId" as "salesOrderReadableId"
  FROM "salesOrderLine" sl
  INNER JOIN "salesOrder" so ON so.id = sl."salesOrderId"
  LEFT JOIN "modelUpload" mu ON sl."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = sl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "customerPartToItem" cp ON cp."customerId" = so."customerId" AND cp."itemId" = i.id
);

-- salesOrders
CREATE OR REPLACE VIEW "salesOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s.*,
    sl."thumbnailPath",
    sl."itemType",
    sl."orderTotal" + COALESCE(ss."shippingCost", 0) AS "orderTotal",
    sl."jobs",
    sl."lines",
    st."name" AS "shippingTermName",
    sp."paymentTermId",
    ss."shippingMethodId",
    ss."receiptRequestedDate",
    ss."receiptPromisedDate",
    ss."dropShipment",
    ss."shippingCost",
    (
      SELECT COALESCE(
        jsonb_object_agg(
          eim."integration",
          CASE
            WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
            ELSE to_jsonb(eim."externalId")
          END
        ) FILTER (WHERE eim."externalId" IS NOT NULL OR eim."metadata" IS NOT NULL),
        '{}'::jsonb
      )
      FROM "externalIntegrationMapping" eim
      WHERE eim."entityType" = 'salesOrder' AND eim."entityId" = s.id
    ) AS "externalId"
  FROM "salesOrder" s
  LEFT JOIN (
    SELECT
      sol."salesOrderId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(
        DISTINCT (1+COALESCE(sol."taxPercent", 0))*(COALESCE(sol."saleQuantity", 0)*(COALESCE(sol."unitPrice", 0)) + COALESCE(sol."shippingCost", 0) + COALESCE(sol."addOnCost", 0)) + COALESCE(sol."nonTaxableAddOnCost", 0)
      ) AS "orderTotal",
      MIN(i."type") AS "itemType",
      ARRAY_AGG(
        CASE
          WHEN j.id IS NOT NULL THEN json_build_object(
            'id', j.id,
            'jobId', j."jobId",
            'status', j."status",
            'dueDate', j."dueDate",
            'productionQuantity', j."productionQuantity",
            'quantityComplete', j."quantityComplete",
            'quantityShipped', j."quantityShipped",
            'quantity', j."quantity",
            'scrapQuantity', j."scrapQuantity",
            'salesOrderLineId', sol.id,
            'assignee', j."assignee"
          )
          ELSE NULL
        END
      ) FILTER (WHERE j.id IS NOT NULL) AS "jobs",
      ARRAY_AGG(
        json_build_object(
          'id', sol.id,
          'methodType', sol."methodType",
          'saleQuantity', sol."saleQuantity"
        )
      ) AS "lines"
    FROM "salesOrderLine" sol
    LEFT JOIN "item" i
      ON i."id" = sol."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    LEFT JOIN "job" j ON j."salesOrderId" = sol."salesOrderId" AND j."salesOrderLineId" = sol."id"
    GROUP BY sol."salesOrderId"
  ) sl ON sl."salesOrderId" = s."id"
  LEFT JOIN "salesOrderShipment" ss ON ss."id" = s."id"
  LEFT JOIN "shippingTerm" st ON st."id" = ss."shippingTermId"
  LEFT JOIN "salesOrderPayment" sp ON sp."id" = s."id";

-- purchaseOrders (latest: 20260525120000_po-pdf-buyer-and-optional-state.sql)
CREATE OR REPLACE VIEW "purchaseOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.*,
    pl."thumbnailPath",
    pl."itemType",
    pl."orderTotal" + pd."supplierShippingCost" * p."exchangeRate" AS "orderTotal",
    pd."shippingMethodId",
    pd."shippingTermId",
    pd."receiptRequestedDate",
    pd."receiptPromisedDate",
    pd."deliveryDate",
    pd."dropShipment",
    pp."paymentTermId",
    pd."locationId",
    pd."supplierShippingCost",
    pd."incoterm",
    pd."incotermLocation",
    u."fullName"   AS "createdByFullName",
    u."email"      AS "createdByEmail",
    u."phone"      AS "createdByPhone",
    ua."fullName"  AS "assigneeFullName",
    ua."email"     AS "assigneeEmail",
    ua."phone"     AS "assigneePhone",
    uam."fullName" AS "accountManagerFullName",
    uam."email"    AS "accountManagerEmail",
    uam."phone"    AS "accountManagerPhone"
  FROM "purchaseOrder" p
  LEFT JOIN (
    SELECT
      pol."purchaseOrderId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(COALESCE(pol."purchaseQuantity", 0)*(COALESCE(pol."unitPrice", 0)) + COALESCE(pol."shippingCost", 0) + COALESCE(pol."taxAmount", 0)) AS "orderTotal",
      MIN(i."type") AS "itemType"
    FROM "purchaseOrderLine" pol
    LEFT JOIN "item" i
      ON i."id" = pol."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY pol."purchaseOrderId"
  ) pl ON pl."purchaseOrderId" = p."id"
  LEFT JOIN "purchaseOrderDelivery" pd ON pd."id" = p."id"
  LEFT JOIN "shippingTerm" st ON st."id" = pd."shippingTermId"
  LEFT JOIN "purchaseOrderPayment" pp ON pp."id" = p."id"
  LEFT JOIN "user" u   ON u."id"   = p."createdBy"
  LEFT JOIN "user" ua  ON ua."id"  = p."assignee"
  LEFT JOIN "supplier" s ON s."id" = p."supplierId"
  LEFT JOIN "user" uam ON uam."id" = s."accountManagerId";

-- purchaseInvoices
CREATE OR REPLACE VIEW "purchaseInvoices" WITH(SECURITY_INVOKER=true) AS
  SELECT
    pi."id",
    pi."invoiceId",
    pi."supplierId",
    pi."invoiceSupplierId",
    pi."supplierInteractionId",
    pi."supplierReference",
    pi."invoiceSupplierContactId",
    pi."invoiceSupplierLocationId",
    pi."locationId",
    pi."postingDate",
    pi."dateIssued",
    pi."dateDue",
    pi."datePaid",
    pi."paymentTermId",
    pi."currencyCode",
    pi."exchangeRate",
    pi."exchangeRateUpdatedAt",
    pi."subtotal",
    pi."totalDiscount",
    pi."totalAmount",
    pi."totalTax",
    pi."balance",
    pi."assignee",
    pi."createdBy",
    pi."createdAt",
    pi."updatedBy",
    pi."updatedAt",
    pi."internalNotes",
    pi."customFields",
    pi."companyId",
    pl."thumbnailPath",
    pl."itemType",
    pl."orderTotal" + COALESCE(pid."supplierShippingCost", 0) * CASE WHEN pi."exchangeRate" = 0 THEN 1 ELSE pi."exchangeRate" END AS "orderTotal",
    CASE
      WHEN pi."dateDue" < CURRENT_DATE AND pi."datePaid" IS NULL THEN 'Overdue'
      ELSE pi."status"
    END AS status,
    pt."name" AS "paymentTermName"
  FROM "purchaseInvoice" pi
  LEFT JOIN (
    SELECT
      pol."invoiceId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(COALESCE(pol."quantity", 0)*(COALESCE(pol."unitPrice", 0)) + COALESCE(pol."shippingCost", 0) + COALESCE(pol."taxAmount", 0)) AS "orderTotal",
      MIN(i."type") AS "itemType"
    FROM "purchaseInvoiceLine" pol
    LEFT JOIN "item" i
      ON i."id" = pol."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY pol."invoiceId"
  ) pl ON pl."invoiceId" = pi."id"
  LEFT JOIN "paymentTerm" pt ON pt."id" = pi."paymentTermId"
  LEFT JOIN "purchaseInvoiceDelivery" pid ON pid."id" = pi."id";

-- openSalesOrderLines
CREATE OR REPLACE VIEW "openSalesOrderLines" AS (
  SELECT
    sol."id",
    sol."salesOrderId",
    sol."itemId",
    sol."promisedDate",
    sol."methodType",
    sol."unitOfMeasureCode",
    sol."quantityToSend",
    sol."salesOrderLineType",
    sol."companyId",
    COALESCE(sol."locationId", so."locationId") AS "locationId",
    i."replenishmentSystem",
    i."itemTrackingType",
    ir."leadTime" AS "leadTime"
  FROM "salesOrderLine" sol
  INNER JOIN "salesOrder" so ON sol."salesOrderId" = so."id"
  INNER JOIN "item" i ON sol."itemId" = i."id"
  INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
  WHERE
    sol."salesOrderLineType" != 'Service'
    AND sol."methodType" != 'Make to Order'
    AND so."status" IN ('To Ship', 'To Ship and Invoice')
);

-- openJobMaterialLines
CREATE OR REPLACE VIEW "openJobMaterialLines" AS (
  SELECT
    jm."id",
    jm."jobId",
    jmm."parentMaterialId",
    jm."jobMakeMethodId",
    j."jobId" as "jobReadableId",
    jm."itemId",
    jm."quantityToIssue",
    jm."unitOfMeasureCode",
    jm."companyId",
    i1."replenishmentSystem",
    i1."itemTrackingType",
    ir."leadTime" AS "leadTime",
    j."locationId",
    j."dueDate"
  FROM "jobMaterial" jm
  INNER JOIN "job" j ON jm."jobId" = j."id"
  INNER JOIN "jobMakeMethod" jmm ON jm."jobMakeMethodId" = jmm."id"
  INNER JOIN "item" i1 ON jm."itemId" = i1."id"
  INNER JOIN "item" i2 ON j."itemId" = i2."id"
  INNER JOIN "itemReplenishment" ir ON i2."id" = ir."itemId"
  WHERE j."status" IN (
      'Planned',
      'Ready',
      'In Progress',
      'Paused'
    )
  AND jm."methodType" != 'Make to Order'
);

-- openProductionOrders
CREATE OR REPLACE VIEW "openProductionOrders"
WITH (security_invoker = true)
AS (
  SELECT
    j."id",
    j."itemId",
    j."jobId",
    j."productionQuantity" - j."quantityReceivedToInventory" AS "quantityToReceive",
    j."unitOfMeasureCode",
    j."companyId",
    i."replenishmentSystem",
    i."itemTrackingType",
    ir."leadTime" AS "leadTime",
    j."locationId",
    j."dueDate",
    j."deadlineType"
  FROM "job" j
  INNER JOIN "item" i ON j."itemId" = i."id"
  INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
  WHERE j."status" IN (
      'Planned',
      'Ready',
      'In Progress',
      'Paused'
    )
  AND j."salesOrderId" IS NULL
);

-- openPurchaseOrderLines (latest: 20260529074512_open-po-lines-required-date.sql)
CREATE OR REPLACE VIEW "openPurchaseOrderLines" WITH (security_invoker=true) AS (
  SELECT
    pol."id",
    pol."purchaseOrderId",
    po."purchaseOrderId" as "purchaseOrderReadableId",
    po."supplierId",
    pol."itemId",
    pol."quantityToReceive" * pol."conversionFactor" AS "quantityToReceive",
    i."unitOfMeasureCode",
    pol."purchaseOrderLineType",
    pol."requiredDate" AS "dueDate",
    pol."companyId",
    pol."locationId",
    po."orderDate",
    po."status",
    COALESCE(pol."promisedDate", pod."receiptPromisedDate") AS "promisedDate",
    i."replenishmentSystem",
    i."itemTrackingType",
    ir."leadTime" AS "leadTime"
  FROM "purchaseOrderLine" pol
  INNER JOIN "purchaseOrder" po ON pol."purchaseOrderId" = po."id"
  INNER JOIN "purchaseOrderDelivery" pod ON pod."id" = po."id"
  INNER JOIN "item" i ON pol."itemId" = i."id"
  INNER JOIN "itemReplenishment" ir ON i."id" = ir."itemId"
  WHERE
    pol."purchaseOrderLineType" != 'Service'
    AND po."status" IN ('To Receive', 'To Receive and Invoice', 'Planned')
);

-- gauges
CREATE OR REPLACE VIEW "gauges" WITH(SECURITY_INVOKER=true) AS
SELECT
  g.*,
  CASE
    WHEN g."gaugeStatus" = 'Inactive' THEN 'Out-of-Calibration'
    WHEN g."nextCalibrationDate" IS NOT NULL AND g."nextCalibrationDate" < CURRENT_DATE THEN 'Out-of-Calibration'
    ELSE g."gaugeCalibrationStatus"
  END as "gaugeCalibrationStatusWithDueDate"
FROM "gauge" g;

-- gaugeCalibrationRecords
CREATE OR REPLACE VIEW "gaugeCalibrationRecords" WITH(SECURITY_INVOKER=true) AS
SELECT
  gcr.*,
  g."gaugeId" as "gaugeReadableId",
  g."gaugeTypeId",
  g."description"
FROM "gaugeCalibrationRecord" gcr
JOIN "gauge" g ON gcr."gaugeId" = g."id";

-- kanbans (also recreated here for safety)
CREATE OR REPLACE VIEW "kanbans" WITH(SECURITY_INVOKER=true) AS
SELECT
  k.*,
  i.name,
  i."readableIdWithRevision",
  j."jobId" as "jobReadableId",
  l.name as "locationName",
  s.name as "storageUnitName",
  su.name as "supplierName",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END AS "thumbnailPath"
FROM "kanban" k
JOIN "item" i ON k."itemId" = i."id"
LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
JOIN "location" l ON k."locationId" = l."id"
LEFT JOIN "storageUnit" s ON k."storageUnitId" = s."id"
LEFT JOIN "supplier" su ON k."supplierId" = su."id"
LEFT JOIN "job" j ON k."jobId" = j."id";
