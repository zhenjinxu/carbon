import { createHash } from "node:crypto";

function stableId(prefix: string, ...parts: string[]) {
  const digest = createHash("sha1")
    .update(parts.join("\u0000"))
    .digest("hex")
    .slice(0, 24);
  return `${prefix}_${digest}`;
}

export function u8MethodOperationId(
  companyId: string,
  operation: { routeId: string; opSeq: string; operationId: string }
) {
  return stableId(
    "u8operation",
    companyId,
    operation.routeId,
    operation.opSeq,
    operation.operationId
  );
}
