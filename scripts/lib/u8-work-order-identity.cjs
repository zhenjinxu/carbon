function getU8OperationKey({
  sourceMoDId,
  operationSequence,
  sourceOperationId
}) {
  const parts = [sourceMoDId, operationSequence].map((value) =>
    String(value).trim()
  );
  const normalizedOperationId =
    sourceOperationId === null || sourceOperationId === undefined
      ? ""
      : String(sourceOperationId).trim();
  if (normalizedOperationId) parts.push(normalizedOperationId);
  return parts.join(":");
}

module.exports = { getU8OperationKey };
