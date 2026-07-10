import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  getMaterialFinish,
  materialFinishValidator,
  upsertMaterialFinish
} from "~/modules/items";
import MaterialFinishForm from "~/modules/items/ui/MaterialFinishes/MaterialFinishForm";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const materialFinish = await getMaterialFinish(client, id);

  if (materialFinish.data?.companyId === null) {
    throw redirect(
      path.to.materialFinishes,
      await flash(
        request,
        error(new Error("Access denied"), msg`Cannot edit global material finish`)
      )
    );
  }

  return {
    materialFinish: materialFinish?.data ?? null
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(materialFinishValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateMaterialFinish = await upsertMaterialFinish(client, {
    id: id,
    ...validation.data
  });

  if (updateMaterialFinish.error) {
    return data(
      {},
      await flash(
        request,
        error(updateMaterialFinish.error, msg`Failed to update material finish`)
      )
    );
  }

  throw redirect(
    `${path.to.materialFinishes}?${getParams(request)}`,
    await flash(request, success(msg`Updated material finish`))
  );
}

export default function EditMaterialFinishsRoute() {
  const { materialFinish } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: materialFinish?.id ?? undefined,
    name: materialFinish?.name ?? "",
    materialSubstanceId: materialFinish?.materialSubstanceId ?? ""
  };

  return (
    <MaterialFinishForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
