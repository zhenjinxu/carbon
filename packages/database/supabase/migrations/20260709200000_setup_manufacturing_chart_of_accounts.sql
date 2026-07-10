-- Setup Default Accounts using existing chart of accounts
-- This migration creates the accountDefault record using existing account numbers

DO $$
DECLARE
  v_company_id TEXT := 'd8s9bh4f8gm357312pbg';
  v_group_id TEXT := 'cg_YLrRao9qnQSUqUF1j3wdSL';

  -- Balance Sheet Accounts
  v_bank_cash TEXT;
  v_bank_local TEXT;
  v_bank_foreign TEXT;
  v_receivables TEXT;
  v_prepayment TEXT;
  v_inventory TEXT;
  v_wip TEXT;
  v_asset_cost TEXT;
  v_accum_depr TEXT;
  v_payables TEXT;
  v_grir TEXT;
  v_sales_tax TEXT;
  v_purchase_tax TEXT;
  v_reverse_charge_tax TEXT;
  v_retained_earnings TEXT;
  v_currency_translation TEXT;

  -- Income Statement Accounts
  v_sales TEXT;
  v_sales_discount TEXT;
  v_cogs TEXT;
  v_indirect_cost TEXT;
  v_labor_absorption TEXT;
  v_purchase_variance TEXT;
  v_maintenance TEXT;
  v_depreciation_expense TEXT;
  v_asset_gains_losses TEXT;
  v_service_charge TEXT;
  v_interest TEXT;
  v_rounding TEXT;
  v_deferred_tax_expense TEXT;
  v_deferred_tax_liability TEXT;
BEGIN
  -- Get Balance Sheet Account IDs
  SELECT id INTO v_bank_cash FROM "account" WHERE number = '1010' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_bank_local FROM "account" WHERE number = '1020' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_bank_foreign FROM "account" WHERE number = '1030' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_receivables FROM "account" WHERE number = '1110' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_prepayment FROM "account" WHERE number = '2110' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_inventory FROM "account" WHERE number = '1210' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_wip FROM "account" WHERE number = '1230' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_asset_cost FROM "account" WHERE number = '1310' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_accum_depr FROM "account" WHERE number = '1330' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_payables FROM "account" WHERE number = '2010' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_grir FROM "account" WHERE number = '2125' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_sales_tax FROM "account" WHERE number = '2210' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_purchase_tax FROM "account" WHERE number = '2220' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_reverse_charge_tax FROM "account" WHERE number = '2230' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_retained_earnings FROM "account" WHERE number = '3100' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_currency_translation FROM "account" WHERE number = '3200' AND "companyGroupId" = v_group_id;

  -- Get Income Statement Account IDs
  SELECT id INTO v_sales FROM "account" WHERE number = '4010' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_sales_discount FROM "account" WHERE number = '4020' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_cogs FROM "account" WHERE number = '5010' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_indirect_cost FROM "account" WHERE number = '5050' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_labor_absorption FROM "account" WHERE number = '5060' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_purchase_variance FROM "account" WHERE number = '5210' AND "companyGroupId" = v_group_id;

  -- Use existing accounts or fallback
  SELECT id INTO v_depreciation_expense FROM "account" WHERE number = '5050' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_maintenance FROM "account" WHERE number = '5050' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_asset_gains_losses FROM "account" WHERE number = '4120' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_service_charge FROM "account" WHERE number = '5050' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_interest FROM "account" WHERE number = '4120' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_rounding FROM "account" WHERE number = '4120' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_deferred_tax_expense FROM "account" WHERE number = '5050' AND "companyGroupId" = v_group_id;
  SELECT id INTO v_deferred_tax_liability FROM "account" WHERE number = '2420' AND "companyGroupId" = v_group_id;

  -- Insert or update default accounts
  INSERT INTO "accountDefault" (
    "companyId",
    "bankCashAccount",
    "bankLocalCurrencyAccount",
    "bankForeignCurrencyAccount",
    "receivablesAccount",
    "prepaymentAccount",
    "inventoryAccount",
    "workInProgressAccount",
    "inventoryShippedNotInvoicedAccount",
    "assetAquisitionCostAccount",
    "assetAquisitionCostOnDisposalAccount",
    "accumulatedDepreciationAccount",
    "accumulatedDepreciationOnDisposalAccount",
    "payablesAccount",
    "goodsReceivedNotInvoicedAccount",
    "salesTaxPayableAccount",
    "purchaseTaxPayableAccount",
    "reverseChargeSalesTaxPayableAccount",
    "retainedEarningsAccount",
    "currencyTranslationAccount",
    "salesAccount",
    "salesDiscountAccount",
    "costOfGoodsSoldAccount",
    "indirectCostAccount",
    "laborAbsorptionAccount",
    "purchaseVarianceAccount",
    "inventoryAdjustmentVarianceAccount",
    "materialVarianceAccount",
    "laborAndMachineVarianceAccount",
    "overheadVarianceAccount",
    "lotSizeVarianceAccount",
    "subcontractingVarianceAccount",
    "maintenanceAccount",
    "assetDepreciationExpenseAccount",
    "assetGainsAndLossesAccount",
    "serviceChargeAccount",
    "interestAccount",
    "supplierPaymentDiscountAccount",
    "customerPaymentDiscountAccount",
    "roundingAccount",
    "deferredTaxExpenseAccountId",
    "deferredTaxLiabilityAccountId",
    "updatedBy"
  ) VALUES (
    v_company_id,
    v_bank_cash,
    v_bank_local,
    v_bank_foreign,
    v_receivables,
    v_prepayment,
    v_inventory,
    v_wip,
    v_grir,
    v_asset_cost,
    v_asset_cost,
    v_accum_depr,
    v_accum_depr,
    v_payables,
    v_grir,
    v_sales_tax,
    v_purchase_tax,
    v_reverse_charge_tax,
    v_retained_earnings,
    v_currency_translation,
    v_sales,
    v_sales_discount,
    v_cogs,
    v_indirect_cost,
    v_labor_absorption,
    v_purchase_variance,
    v_purchase_variance,
    v_purchase_variance,
    v_purchase_variance,
    v_purchase_variance,
    v_purchase_variance,
    v_purchase_variance,
    v_maintenance,
    v_depreciation_expense,
    v_asset_gains_losses,
    v_service_charge,
    v_interest,
    v_service_charge,
    v_sales_discount,
    v_rounding,
    v_deferred_tax_expense,
    v_deferred_tax_liability,
    NULL
  )
  ON CONFLICT ("companyId") DO UPDATE SET
    "bankCashAccount" = EXCLUDED."bankCashAccount",
    "bankLocalCurrencyAccount" = EXCLUDED."bankLocalCurrencyAccount",
    "bankForeignCurrencyAccount" = EXCLUDED."bankForeignCurrencyAccount",
    "receivablesAccount" = EXCLUDED."receivablesAccount",
    "prepaymentAccount" = EXCLUDED."prepaymentAccount",
    "inventoryAccount" = EXCLUDED."inventoryAccount",
    "workInProgressAccount" = EXCLUDED."workInProgressAccount",
    "inventoryShippedNotInvoicedAccount" = EXCLUDED."inventoryShippedNotInvoicedAccount",
    "assetAquisitionCostAccount" = EXCLUDED."assetAquisitionCostAccount",
    "assetAquisitionCostOnDisposalAccount" = EXCLUDED."assetAquisitionCostOnDisposalAccount",
    "accumulatedDepreciationAccount" = EXCLUDED."accumulatedDepreciationAccount",
    "accumulatedDepreciationOnDisposalAccount" = EXCLUDED."accumulatedDepreciationOnDisposalAccount",
    "payablesAccount" = EXCLUDED."payablesAccount",
    "goodsReceivedNotInvoicedAccount" = EXCLUDED."goodsReceivedNotInvoicedAccount",
    "salesTaxPayableAccount" = EXCLUDED."salesTaxPayableAccount",
    "purchaseTaxPayableAccount" = EXCLUDED."purchaseTaxPayableAccount",
    "reverseChargeSalesTaxPayableAccount" = EXCLUDED."reverseChargeSalesTaxPayableAccount",
    "retainedEarningsAccount" = EXCLUDED."retainedEarningsAccount",
    "currencyTranslationAccount" = EXCLUDED."currencyTranslationAccount",
    "salesAccount" = EXCLUDED."salesAccount",
    "salesDiscountAccount" = EXCLUDED."salesDiscountAccount",
    "costOfGoodsSoldAccount" = EXCLUDED."costOfGoodsSoldAccount",
    "indirectCostAccount" = EXCLUDED."indirectCostAccount",
    "laborAbsorptionAccount" = EXCLUDED."laborAbsorptionAccount",
    "purchaseVarianceAccount" = EXCLUDED."purchaseVarianceAccount",
    "inventoryAdjustmentVarianceAccount" = EXCLUDED."inventoryAdjustmentVarianceAccount",
    "materialVarianceAccount" = EXCLUDED."materialVarianceAccount",
    "laborAndMachineVarianceAccount" = EXCLUDED."laborAndMachineVarianceAccount",
    "overheadVarianceAccount" = EXCLUDED."overheadVarianceAccount",
    "lotSizeVarianceAccount" = EXCLUDED."lotSizeVarianceAccount",
    "subcontractingVarianceAccount" = EXCLUDED."subcontractingVarianceAccount",
    "maintenanceAccount" = EXCLUDED."maintenanceAccount",
    "assetDepreciationExpenseAccount" = EXCLUDED."assetDepreciationExpenseAccount",
    "assetGainsAndLossesAccount" = EXCLUDED."assetGainsAndLossesAccount",
    "serviceChargeAccount" = EXCLUDED."serviceChargeAccount",
    "interestAccount" = EXCLUDED."interestAccount",
    "supplierPaymentDiscountAccount" = EXCLUDED."supplierPaymentDiscountAccount",
    "customerPaymentDiscountAccount" = EXCLUDED."customerPaymentDiscountAccount",
    "roundingAccount" = EXCLUDED."roundingAccount",
    "deferredTaxExpenseAccountId" = EXCLUDED."deferredTaxExpenseAccountId",
    "deferredTaxLiabilityAccountId" = EXCLUDED."deferredTaxLiabilityAccountId",
    "updatedBy" = EXCLUDED."updatedBy";
END $$;
