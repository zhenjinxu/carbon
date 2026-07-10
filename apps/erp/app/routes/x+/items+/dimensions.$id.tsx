import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  getMaterialDimension,
  materialDimensionValidator,
  upsertMaterialDimension
} from "~/modules/items";
import MaterialDimensionForm from "~/modules/items/ui/MaterialDimensions/MaterialDimensionForm";

import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const materialDimension = await getMaterialDimension(client, id);

  if (materialDimension.data?.companyId === null) {
    throw redirect(
      path.to.materialDimensions,
      await flash(
        request,
        error(new Error("Access denied"), msg`Cannot edit global material dimension`)
      )
    );
  }

  return {
    materialDimension: materialDimension?.data ?? null
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
  const validation = await validator(materialDimensionValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateMaterialDimension = await upsertMaterialDimension(client, {
    id: id,
    ...validation.data
  });

  if (updateMaterialDimension.error) {
    return data(
      {},
      await flash(
        request,
        error(updateMaterialDimension.error, msg`Failed to update material dimension`)
      )
    );
  }

  throw redirect(
    `${path.to.materialDimensions}?${getParams(request)}`,
    await flash(request, success(msg`Updated material dimension`))
  );
}

export default function EditMaterialDimensionsRoute() {
  const { materialDimension } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: materialDimension?.id ?? undefined,
    name: materialDimension?.name ?? "",
    materialFormId: materialDimension?.materialFormId ?? ""
  };

  return (
    <MaterialDimensionForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
