import { ValidatedForm } from "@carbon/form";
import { Badge, Button, HStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { Combobox, Hidden, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { defaultAccountValidator } from "../../accounting.models";
import type { AccountListItem } from "../../types";

type AccountType = "income" | "balance";

type BadgeType = "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";

type AccountDefaultField = {
  name: string;
  label: ReturnType<typeof msg>;
  description: ReturnType<typeof msg>;
  accountType: AccountType;
  badgeType: BadgeType;
};

type CategoryGroup = {
  id: string;
  title: ReturnType<typeof msg>;
  description: ReturnType<typeof msg>;
  fields: AccountDefaultField[];
};

const badgeColors: Record<
  BadgeType,
  "green" | "red" | "blue" | "yellow" | "orange"
> = {
  Asset: "green",
  Liability: "red",
  Equity: "blue",
  Revenue: "yellow",
  Expense: "orange"
};

const badgeTypeLabels: Record<BadgeType, ReturnType<typeof msg>> = {
  Asset: msg`Asset`,
  Liability: msg`Liability`,
  Equity: msg`Equity`,
  Revenue: msg`Revenue`,
  Expense: msg`Expense`
};

const categoryGroups: CategoryGroup[] = [
  // --- Assets ---
  {
    id: "cash-banking",
    title: msg`Cash & Banking`,
    description: msg`Configure default accounts for cash and bank transactions`,
    fields: [
      {
        name: "bankCashAccount",
        label: msg`Bank - Cash`,
        description: msg`Primary cash account for bank transactions`,
        accountType: "balance",
        badgeType: "Asset"
      },
      {
        name: "bankLocalCurrencyAccount",
        label: msg`Bank - Local Currency`,
        description: msg`Bank account denominated in the local currency`,
        accountType: "balance",
        badgeType: "Asset"
      },
      {
        name: "bankForeignCurrencyAccount",
        label: msg`Bank - Foreign Currency`,
        description: msg`Bank account denominated in a foreign currency`,
        accountType: "balance",
        badgeType: "Asset"
      }
    ]
  },
  {
    id: "receivables",
    title: msg`Accounts Receivable`,
    description: msg`Default accounts for customer transactions and receivables`,
    fields: [
      {
        name: "receivablesAccount",
        label: msg`Receivables`,
        description: msg`Accounts receivable for amounts owed by customers`,
        accountType: "balance",
        badgeType: "Asset"
      },
      {
        name: "prepaymentAccount",
        label: msg`Prepayments`,
        description:
          msg`Account for advance payments made before goods or services are received`,
        accountType: "balance",
        badgeType: "Asset"
      }
    ]
  },
  {
    id: "inventory",
    title: msg`Inventory`,
    description: msg`Configure default accounts for inventory management`,
    fields: [
      {
        name: "inventoryAccount",
        label: msg`Inventory`,
        description: msg`Primary account for on-hand inventory valuation`,
        accountType: "balance",
        badgeType: "Asset"
      },
      {
        name: "workInProgressAccount",
        label: msg`Work in Progress (WIP)`,
        description: msg`Account for production orders not yet completed`,
        accountType: "balance",
        badgeType: "Asset"
      },
      {
        name: "inventoryShippedNotInvoicedAccount",
        label: msg`Inventory Shipped Not Invoiced`,
        description:
          msg`Accrual for inventory shipped but not yet invoiced to customer`,
        accountType: "balance",
        badgeType: "Asset"
      }
    ]
  },
  {
    id: "fixed-assets",
    title: msg`Fixed Assets`,
    description: msg`Default accounts for long-term assets and depreciation`,
    fields: [
      {
        name: "assetAquisitionCostAccount",
        label: msg`Asset Acquisition Cost`,
        description: msg`Account for the purchase cost of fixed assets`,
        accountType: "balance",
        badgeType: "Asset"
      },
      {
        name: "assetAquisitionCostOnDisposalAccount",
        label: msg`Asset Cost on Disposal`,
        description: msg`Account for the cost of fixed assets when disposed`,
        accountType: "balance",
        badgeType: "Asset"
      },
      {
        name: "accumulatedDepreciationAccount",
        label: msg`Accumulated Depreciation`,
        description:
          msg`Contra-asset account for total depreciation of fixed assets`,
        accountType: "balance",
        badgeType: "Asset"
      },
      {
        name: "accumulatedDepreciationOnDisposalAccount",
        label: msg`Accumulated Depreciation on Disposal`,
        description: msg`Depreciation reversal when a fixed asset is disposed`,
        accountType: "balance",
        badgeType: "Asset"
      }
    ]
  },
  // --- Liabilities ---
  {
    id: "payables",
    title: msg`Accounts Payable`,
    description:
      msg`Configure default accounts for vendor and supplier transactions`,
    fields: [
      {
        name: "payablesAccount",
        label: msg`Payables`,
        description: msg`Accounts payable for amounts owed to suppliers`,
        accountType: "balance",
        badgeType: "Liability"
      },
      {
        name: "goodsReceivedNotInvoicedAccount",
        label: msg`GR/IR Clearing`,
        description:
          msg`Clearing account for goods received / invoice received matching`,
        accountType: "balance",
        badgeType: "Liability"
      }
    ]
  },
  {
    id: "taxes",
    title: msg`Taxes`,
    description: msg`Default accounts for tax-related transactions`,
    fields: [
      {
        name: "salesTaxPayableAccount",
        label: msg`Sales Tax Payable`,
        description: msg`Liability account for sales tax collected from customers`,
        accountType: "balance",
        badgeType: "Liability"
      },
      {
        name: "purchaseTaxPayableAccount",
        label: msg`Purchase Tax Payable`,
        description: msg`Liability account for tax paid on purchases`,
        accountType: "balance",
        badgeType: "Liability"
      },
      {
        name: "reverseChargeSalesTaxPayableAccount",
        label: msg`Reverse Charge Sales Tax`,
        description: msg`Tax liability for reverse-charge transactions`,
        accountType: "balance",
        badgeType: "Liability"
      },
      {
        name: "deferredTaxLiabilityAccountId",
        label: msg`Deferred Tax Liability`,
        description:
          msg`Liability account for deferred taxes from accelerated depreciation`,
        accountType: "balance",
        badgeType: "Liability"
      }
    ]
  },
  // --- Equity ---
  {
    id: "equity",
    title: msg`Equity`,
    description: msg`Configure default equity and retained earnings accounts`,
    fields: [
      {
        name: "retainedEarningsAccount",
        label: msg`Retained Earnings`,
        description: msg`Equity account for accumulated profits or losses`,
        accountType: "balance",
        badgeType: "Equity"
      },
      {
        name: "currencyTranslationAccount",
        label: msg`Currency Translation`,
        description:
          msg`Equity account for currency translation adjustments (CTA)`,
        accountType: "balance",
        badgeType: "Equity"
      }
    ]
  },
  // --- Revenue ---
  {
    id: "revenue",
    title: msg`Sales & Revenue`,
    description: msg`Default accounts for sales and income`,
    fields: [
      {
        name: "salesAccount",
        label: msg`Sales`,
        description: msg`Default account for posting sales revenue from invoices`,
        accountType: "income",
        badgeType: "Revenue"
      },
      {
        name: "salesDiscountAccount",
        label: msg`Sales Discounts`,
        description: msg`Contra-revenue account for discounts given on sales`,
        accountType: "income",
        badgeType: "Revenue"
      }
    ]
  },
  // --- Expenses ---
  {
    id: "cogs",
    title: msg`Purchasing & Cost of Goods`,
    description: msg`Configure default accounts for purchasing and COGS`,
    fields: [
      {
        name: "costOfGoodsSoldAccount",
        label: msg`Cost of Goods Sold`,
        description: msg`Expense account for the cost of items sold`,
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "indirectCostAccount",
        label: msg`Indirect Materials & Services`,
        description:
          msg`Expense account for non-inventory purchases (services, supplies)`,
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "laborAbsorptionAccount",
        label: msg`Labor & Machine Absorption`,
        description:
          msg`Credit account when labor/machine time is absorbed into WIP`,
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "purchaseVarianceAccount",
        label: msg`Purchase Price Variance`,
        description: msg`Variance between actual purchase price and standard cost`,
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "inventoryAdjustmentVarianceAccount",
        label: msg`Inventory Adjustment`,
        description: msg`Variance from physical inventory count adjustments`,
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "materialVarianceAccount",
        label: msg`Material Usage Variance`,
        description:
          msg`Variance between actual and standard BOM component consumption`,
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "laborAndMachineVarianceAccount",
        label: msg`Labor & Machine Variance`,
        description:
          msg`Variance between actual and standard routing hours and rates`,
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "overheadVarianceAccount",
        label: msg`Overhead Variance`,
        description:
          msg`Variance between applied and actual manufacturing overhead`,
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "lotSizeVarianceAccount",
        label: msg`Lot Size Variance`,
        description:
          msg`Fixed cost amortization variance when batch size differs from standard`,
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "subcontractingVarianceAccount",
        label: msg`Subcontracting Variance`,
        description: msg`Variance in outside processing costs`,
        accountType: "income",
        badgeType: "Expense"
      }
    ]
  },
  {
    id: "expenses",
    title: msg`Operating Expenses`,
    description: msg`Default accounts for business expenses`,
    fields: [
      {
        name: "maintenanceAccount",
        label: msg`Maintenance Expense`,
        description: msg`Expense account for equipment and facility maintenance`,
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "assetDepreciationExpenseAccount",
        label: msg`Depreciation Expense`,
        description: msg`Periodic depreciation expense for fixed assets`,
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "assetGainsAndLossesAccount",
        label: msg`Gains and Losses`,
        description: msg`Gains or losses recognized on disposal of fixed assets`,
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "serviceChargeAccount",
        label: msg`Service Charges`,
        description: msg`Bank and financial service charge expenses`,
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "interestAccount",
        label: msg`Interest`,
        description: msg`Interest income or expense from banking activities`,
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "supplierPaymentDiscountAccount",
        label: msg`Supplier Payment Discounts`,
        description: msg`Discounts earned for early payment to suppliers`,
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "customerPaymentDiscountAccount",
        label: msg`Customer Payment Discounts`,
        description: msg`Discounts given to customers for early payment`,
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "roundingAccount",
        label: msg`Rounding Account`,
        description: msg`Account for small rounding differences in transactions`,
        accountType: "income",
        badgeType: "Expense"
      },
      {
        name: "deferredTaxExpenseAccountId",
        label: msg`Deferred Tax Expense`,
        description:
          msg`Expense account for deferred tax adjustments on depreciation`,
        accountType: "income",
        badgeType: "Expense"
      }
    ]
  }
];

type AccountDefaultsFormProps = {
  balanceSheetAccounts: AccountListItem[];
  incomeStatementAccounts: AccountListItem[];
  initialValues: Record<string, string>;
};

const AccountDefaultsForm = ({
  balanceSheetAccounts,
  incomeStatementAccounts,
  initialValues
}: AccountDefaultsFormProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const { t } = useLingui();
  const onClose = () => navigate(-1);

  const isDisabled = !permissions.can("update", "accounting");

  const accountOptions: Record<
    AccountType,
    { value: string; label: string | JSX.Element }[]
  > = useMemo(
    () => ({
      income: incomeStatementAccounts.map((c) => ({
        value: c.id,
        label: (
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">
              {c.number}
            </span>
            <span className="text-xs text-foreground truncate">{c.name}</span>
          </div>
        )
      })),
      balance: balanceSheetAccounts.map((c) => ({
        value: c.id,
        label: (
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">
              {c.number}
            </span>
            <span className="text-xs text-foreground truncate">{c.name}</span>
          </div>
        )
      }))
    }),
    [incomeStatementAccounts, balanceSheetAccounts]
  );

  return (
    <ValidatedForm
      validator={defaultAccountValidator}
      method="post"
      action={path.to.accountingDefaults}
      defaultValues={initialValues}
      className="w-full"
    >
      <Hidden name="intent" value="all" />
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              <Trans>Default Accounts</Trans>
            </h1>
            <p className="text-sm text-muted-foreground">
              <Trans>
                Configure the default accounts used for various transaction
                types across your system
              </Trans>
            </p>
          </div>
          <HStack>
            <Submit isDisabled={isDisabled}>
              <Trans>Save</Trans>
            </Submit>
            <Button size="md" variant="solid" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
          </HStack>
        </div>
        <div className="flex flex-col gap-8 p-6">
          {categoryGroups.map((group) => (
            <div key={group.id} className="border border-border rounded-lg">
              <div className="py-6 px-4 border-b border-border">
                <h2 className="text-base font-semibold text-foreground">
                  {t(group.title)}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t(group.description)}
                </p>
              </div>
              <div className="flex flex-col gap-3 p-4">
                {group.fields.map((field) => (
                  <div
                    key={field.name}
                    className="group rounded-lg border border-border p-4 transition-all hover:border-muted-foreground/30"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-sm font-medium text-foreground">
                            {t(field.label)}
                          </h3>
                          <Badge variant={badgeColors[field.badgeType]}>
                            {t(badgeTypeLabels[field.badgeType])}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t(field.description)}
                        </p>
                      </div>
                      <div className="flex-shrink-0 w-64">
                        <Combobox
                          name={field.name}
                          options={accountOptions[field.accountType]}
                          size="sm"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </ValidatedForm>
  );
};

export default AccountDefaultsForm;
