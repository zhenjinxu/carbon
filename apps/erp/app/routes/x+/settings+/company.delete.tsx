import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  // Get company details
  const { data: company, error: companyError } = await client
    .from("company")
    .select("id, name")
    .eq("id", companyId)
    .single();

  if (companyError || !company) {
    throw redirect(
      path.to.company,
      await flash(request, error(companyError, "Failed to load company"))
    );
  }

  // Check if company has any related data
  const relatedData = await checkCompanyRelatedData(client, companyId);

  return {
    company,
    hasRelatedData: relatedData.hasRelatedData,
    relatedTables: relatedData.relatedTables
  };
}

async function checkCompanyRelatedData(
  client: ReturnType<typeof getCarbonServiceRole>,
  companyId: string
) {
  // Check tables with actual business data (not seed data with CASCADE delete)
  // Excluded: location, warehouse (have ON DELETE CASCADE - auto-cleaned)
  const tablesToCheck = [
    { table: "item", label: "Items" },
    { table: "supplier", label: "Suppliers" },
    { table: "customer", label: "Customers" },
    { table: "salesOrder", label: "Sales Orders" },
    { table: "purchaseOrder", label: "Purchase Orders" },
    { table: "journalLine", label: "Journal Entries" },
    { table: "job", label: "Jobs" },
    { table: "fixedAsset", label: "Fixed Assets" },
    { table: "inboundInspection", label: "Inbound Inspections" },
    { table: "nonConformance", label: "Non-Conformances" }
  ];

  const checks = await Promise.all(
    tablesToCheck.map(async ({ table, label }) => {
      const { count } = await client
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("companyId", companyId);

      return { table, label, count: count || 0 };
    })
  );

  const relatedTables = checks.filter((c) => c.count > 0);
  const hasRelatedData = relatedTables.length > 0;

  return { hasRelatedData, relatedTables };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "settings"
  });

  // Check if company has any related data
  const relatedData = await checkCompanyRelatedData(client, companyId);

  if (relatedData.hasRelatedData) {
    const tableNames = relatedData.relatedTables.map((t) => t.label).join(", ");
    throw redirect(
      path.to.company,
      await flash(
        request,
        error(
          { relatedTables: tableNames },
          `Cannot delete company. It has related data in: ${tableNames}. Only companies with no business data can be deleted.`
        )
      )
    );
  }

  // Delete employeeJob records first (no CASCADE on this FK)
  await client.from("employeeJob").delete().eq("companyId", companyId);

  // Delete the company (cascade will handle location, warehouse, etc.)
  const { error: deleteError } = await client
    .from("company")
    .delete()
    .eq("id", companyId);

  if (deleteError) {
    throw redirect(
      path.to.company,
      await flash(request, error(deleteError, "Failed to delete company"))
    );
  }

  throw redirect(
    path.to.selectCompany,
    await flash(request, success("Company deleted successfully"))
  );
}

export default function DeleteCompanyRoute() {
  const { company, hasRelatedData, relatedTables } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!company) return null;

  const relatedTableNames = relatedTables.map((t) => t.label).join(", ");

  return (
    <ConfirmDelete
      action={path.to.deleteCurrentCompany}
      name={company.name}
      text={
        hasRelatedData
          ? `Cannot delete "${company.name}". This company has related business data in: ${relatedTableNames}. Only companies with no business data can be deleted.`
          : `Are you sure you want to delete "${company.name}"? This will permanently delete all seed data (locations, warehouses, etc.) and cannot be undone.`
      }
      onCancel={() => navigate(path.to.company)}
    />
  );
}
