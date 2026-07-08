import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

interface ImportLineData {
  itemName?: string;
  specification?: string;
  unit?: string;
  expectedQuantity?: number;
  receivedQuantity?: number;
  unitPrice?: number;
  notes?: string;
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const receiptId = formData.get("receiptId") as string;
  const linesJson = formData.get("lines") as string;

  if (!receiptId || !linesJson) {
    return redirect(
      path.to.receiptDetails(receiptId ?? ""),
      await flash(request, error(null, "Missing receipt ID or line data"))
    );
  }

  let lines: ImportLineData[];
  try {
    lines = JSON.parse(linesJson);
  } catch {
    return redirect(
      path.to.receiptDetails(receiptId),
      await flash(request, error(null, "Invalid line data format"))
    );
  }

  if (!Array.isArray(lines) || lines.length === 0) {
    return redirect(
      path.to.receiptDetails(receiptId),
      await flash(request, error(null, "No line items to import"))
    );
  }

  // Get the receipt to find locationId
  const { data: receipt, error: receiptError } = await client
    .from("receipt")
    .select("id, locationId")
    .eq("id", receiptId)
    .eq("companyId", companyId)
    .single();

  if (receiptError || !receipt) {
    console.error("[import-receipt-lines] Receipt not found:", receiptError);
    return redirect(
      path.to.receiptDetails(receiptId),
      await flash(request, error(null, "Receipt not found"))
    );
  }

  // Collect all specifications to look up items
  const specifications = lines
    .map((l) => l.specification)
    .filter((s): s is string => !!s);

  // Look up items by readableId
  const itemsMap = new Map<
    string,
    {
      id: string;
      unitOfMeasure: string;
      requiresSerialTracking: boolean;
      requiresBatchTracking: boolean;
    }
  >();

  if (specifications.length > 0) {
    const { data: items, error: itemsError } = await client
      .from("item")
      .select("id, readableId, unitOfMeasureCode, itemTrackingType")
      .in("readableId", specifications)
      .eq("companyId", companyId);

    if (itemsError) {
      console.error("[import-receipt-lines] Item lookup error:", itemsError);
    }

    if (items) {
      for (const item of items) {
        itemsMap.set(item.readableId, {
          id: item.id,
          unitOfMeasure: item.unitOfMeasureCode ?? "EA",
          requiresSerialTracking: item.itemTrackingType === "Serial",
          requiresBatchTracking: item.itemTrackingType === "Batch"
        });
      }
    }
  }

  // Also look up items by name
  const itemNames = lines
    .map((l) => l.itemName)
    .filter((n): n is string => !!n);

  if (itemNames.length > 0) {
    const { data: itemsByName } = await client
      .from("item")
      .select("id, name, readableId, unitOfMeasureCode, itemTrackingType")
      .in("name", itemNames)
      .eq("companyId", companyId);

    if (itemsByName) {
      for (const item of itemsByName) {
        if (!itemsMap.has(item.readableId)) {
          itemsMap.set(item.name, {
            id: item.id,
            unitOfMeasure: item.unitOfMeasureCode ?? "EA",
            requiresSerialTracking: item.itemTrackingType === "Serial",
            requiresBatchTracking: item.itemTrackingType === "Batch"
          });
        }
      }
    }
  }

  console.log(
    `[import-receipt-lines] Found ${itemsMap.size} items for ${lines.length} lines`
  );

  // Build receipt line records
  const receiptLinesToInsert = lines
    .map((line) => {
      const item =
        (line.specification ? itemsMap.get(line.specification) : null) ??
        (line.itemName ? itemsMap.get(line.itemName) : null);

      if (!item) {
        console.warn(
          `[import-receipt-lines] No item found for spec="${line.specification}" name="${line.itemName}"`
        );
        return null;
      }

      const expectedQty = line.expectedQuantity ?? 0;
      const receivedQty = line.receivedQuantity ?? 0;

      return {
        receiptId: receipt.id,
        companyId,
        itemId: item.id,
        lineId: null,
        orderQuantity: expectedQty,
        outstandingQuantity: expectedQty - receivedQty,
        receivedQuantity: receivedQty,
        conversionFactor: 1,
        requiresSerialTracking: item.requiresSerialTracking,
        requiresBatchTracking: item.requiresBatchTracking,
        unitPrice: line.unitPrice ?? 0,
        unitOfMeasure: line.unit ?? item.unitOfMeasure,
        locationId: receipt.locationId ?? null,
        storageUnitId: null,
        createdBy: userId
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  if (receiptLinesToInsert.length === 0) {
    return redirect(
      path.to.receiptDetails(receiptId),
      await flash(
        request,
        error(
          null,
          "No matching items found. Make sure specifications match item readable IDs."
        )
      )
    );
  }

  console.log(
    `[import-receipt-lines] Inserting ${receiptLinesToInsert.length} lines`
  );

  // Insert receipt lines
  const { error: insertError } = await client
    .from("receiptLine")
    .insert(receiptLinesToInsert);

  if (insertError) {
    console.error(
      "[import-receipt-lines] Insert error:",
      insertError.message,
      insertError
    );
    return redirect(
      path.to.receiptDetails(receiptId),
      await flash(request, error(insertError.message, "Failed to import lines"))
    );
  }

  return redirect(
    path.to.receiptDetails(receiptId),
    await flash(
      request,
      success(`Successfully imported ${receiptLinesToInsert.length} lines`)
    )
  );
}
