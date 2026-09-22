import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { aiRoutingTargetEvidenceFromDrawing } from "../../app/modules/items/ai-routing.ts";

type JsonRecord = Record<string, unknown>;

const targetReadableIds = ["1927930206", "192769010102", "1927930202"];
const humanSourceReview = {
  laserUnsuitable: ["1927930206", "192769010102"],
  laserSuitablePositiveContrast: ["1927930202"]
};

function loadEnvFile(path: string, options: { override?: boolean; only?: Set<string> } = {}) {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (options.only && !options.only.has(key)) continue;
    if (!options.override && process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function findRoot(start: string) {
  let current = start;
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(current, "package.json"), "utf8"));
      if (pkg?.name === "carbon") return current;
    } catch {}
    const parent = dirname(current);
    if (parent === current) throw new Error("Unable to locate Carbon root");
    current = parent;
  }
}

function readJsonIfExists<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function compactMaterialRow(row: JsonRecord | null) {
  if (!row) return null;
  return {
    itemId: row.itemId ?? row.id ?? null,
    readableId: row.readableId ?? null,
    readableIdWithRevision: row.readableIdWithRevision ?? null,
    name: row.name ?? null,
    itemType: row.itemType ?? row.type ?? null,
    materialSubstanceId: row.materialSubstanceId ?? null,
    materialSubstance: row.materialSubstance ?? null,
    materialFormId: row.materialFormId ?? null,
    materialForm: row.materialForm ?? null,
    materialTypeId: row.materialTypeId ?? null,
    materialType: row.materialType ?? null,
    dimensionId: row.dimensionId ?? null,
    dimension: row.dimension ?? null,
    gradeId: row.gradeId ?? null,
    grade: row.grade ?? null,
    finishId: row.finishId ?? null,
    finish: row.finish ?? null,
    tags: row.tags ?? null
  };
}

function extractionTextSummary(extraction: JsonRecord) {
  const titleBlock = objectValue(extraction.titleBlock);
  const part = objectValue(extraction.part);
  const notes = Array.isArray(extraction.notes) ? extraction.notes.map(objectValue) : [];
  return {
    titleBlock: {
      partNumber: titleBlock.partNumber ?? null,
      material: titleBlock.material ?? null,
      finish: titleBlock.finish ?? null,
      heatTreatment: titleBlock.heatTreatment ?? null
    },
    part: {
      class: part.class ?? null,
      stockForm: part.stockForm ?? null
    },
    laserRelatedNotes: notes
      .map((note) => String(note.text ?? ""))
      .filter((text) => /激光|laser|切割|cut/i.test(text))
  };
}

function hasExplicitLaserSuitabilitySignal(rows: Array<JsonRecord | null>) {
  const text = rows
    .filter(Boolean)
    .map((row) => JSON.stringify(row))
    .join(" ");
  return {
    hasPositiveSignal: /适合.{0,16}(激光|laser)|(激光|laser).{0,16}(适合|可用)|laser.{0,24}suitable|suitable.{0,24}laser/i.test(text),
    hasNegativeSignal: /(?:不适合|不宜|不能|不可|禁止).{0,16}(?:激光|laser)|(?:激光|laser).{0,16}(?:不适合|不宜|不能|不可|禁止)|not suitable.{0,24}laser|laser.{0,24}not suitable/i.test(text)
  };
}

const root = findRoot(dirname(fileURLToPath(import.meta.url)));
loadEnvFile(resolve(root, ".env"));
loadEnvFile(resolve(root, ".env.local"), { override: true });
loadEnvFile(resolve(root, "apps/erp/.env.local"), { override: true, only: new Set(["SUPABASE_DB_URL"]) });
if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is not configured");

const requireFromDatabase = createRequire(resolve(root, "packages/database/package.json"));
const pgModule = await import(pathToFileURL(requireFromDatabase.resolve("pg")).href);
const Pool = pgModule.Pool ?? pgModule.default.Pool;
const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });

const smokePath = resolve(root, "apps/erp/.codex/work/ai-routing-stage4-30-holdout-evaluation-20260823.json");
const smoke = readJsonIfExists<{ companyId: string }>(smokePath);
if (!smoke?.companyId) throw new Error(`Missing companyId in smoke artifact: ${smokePath}`);

const outputPath = resolve(root, "apps/erp/.codex/work/ai-routing-material-suitability-source-audit-20260824.json");
const client = await pool.connect();
try {
  const companyId = smoke.companyId;
  const items = (
    await client.query(
      `
        SELECT "id", "readableId", "readableIdWithRevision", "name", "description", "type"::text AS "itemType", "notes", "createdAt", "updatedAt"
        FROM "item"
        WHERE "companyId" = $1
          AND "readableId" = ANY($2::text[])
        ORDER BY "readableId"
      `,
      [companyId, targetReadableIds]
    )
  ).rows as JsonRecord[];
  const itemIds = items.map((row) => String(row.id));

  const directMaterials = (
    await client.query(
      `
        SELECT
          i."id" AS "itemId",
          i."readableId",
          i."readableIdWithRevision",
          i."name",
          i."type"::text AS "itemType",
          m."materialSubstanceId",
          ms."name" AS "materialSubstance",
          m."materialFormId",
          mf."name" AS "materialForm",
          m."materialTypeId",
          mt."name" AS "materialType",
          m."dimensionId",
          md."name" AS "dimension",
          m."gradeId",
          mg."name" AS "grade",
          m."finishId",
          mfi."name" AS "finish",
          m."tags"
        FROM "item" i
        LEFT JOIN "material" m ON m."id" = i."id" AND m."companyId" = i."companyId"
        LEFT JOIN "materialSubstance" ms ON ms."id" = m."materialSubstanceId"
        LEFT JOIN "materialForm" mf ON mf."id" = m."materialFormId"
        LEFT JOIN "materialType" mt ON mt."id" = m."materialTypeId"
        LEFT JOIN "materialDimension" md ON md."id" = m."dimensionId"
        LEFT JOIN "materialGrade" mg ON mg."id" = m."gradeId"
        LEFT JOIN "materialFinish" mfi ON mfi."id" = m."finishId"
        WHERE i."companyId" = $1
          AND i."id" = ANY($2::text[])
        ORDER BY i."readableId"
      `,
      [companyId, itemIds]
    )
  ).rows as JsonRecord[];
  const directMaterialByItem = new Map(directMaterials.map((row) => [String(row.itemId), row]));

  const methodMaterialRows = (
    await client.query(
      `
        SELECT
          parent."id" AS "parentItemId",
          parent."readableId" AS "parentReadableId",
          method."id" AS "makeMethodId",
          method."status"::text AS "makeMethodStatus",
          mm."id" AS "methodMaterialId",
          mm."itemId" AS "materialItemId",
          material_item."readableId" AS "materialReadableId",
          material_item."readableIdWithRevision" AS "materialReadableIdWithRevision",
          material_item."name" AS "materialName",
          material_item."type"::text AS "materialItemType",
          to_jsonb(mm) AS "methodMaterialRow",
          m."materialSubstanceId",
          ms."name" AS "materialSubstance",
          m."materialFormId",
          mf."name" AS "materialForm",
          m."materialTypeId",
          mt."name" AS "materialType",
          m."dimensionId",
          md."name" AS "dimension",
          m."gradeId",
          mg."name" AS "grade",
          m."finishId",
          mfi."name" AS "finish",
          m."tags"
        FROM "item" parent
        JOIN "makeMethod" method ON method."itemId" = parent."id" AND method."companyId" = parent."companyId"
        JOIN "methodMaterial" mm ON mm."makeMethodId" = method."id" AND mm."companyId" = method."companyId"
        LEFT JOIN "item" material_item ON material_item."id" = mm."itemId" AND material_item."companyId" = mm."companyId"
        LEFT JOIN "material" m ON m."id" = mm."itemId" AND m."companyId" = mm."companyId"
        LEFT JOIN "materialSubstance" ms ON ms."id" = m."materialSubstanceId"
        LEFT JOIN "materialForm" mf ON mf."id" = m."materialFormId"
        LEFT JOIN "materialType" mt ON mt."id" = m."materialTypeId"
        LEFT JOIN "materialDimension" md ON md."id" = m."dimensionId"
        LEFT JOIN "materialGrade" mg ON mg."id" = m."gradeId"
        LEFT JOIN "materialFinish" mfi ON mfi."id" = m."finishId"
        WHERE parent."companyId" = $1
          AND parent."id" = ANY($2::text[])
        ORDER BY parent."readableId", method."status", mm."order"
      `,
      [companyId, itemIds]
    )
  ).rows as JsonRecord[];
  const methodMaterialsByItem = new Map<string, JsonRecord[]>();
  for (const row of methodMaterialRows) {
    const parentItemId = String(row.parentItemId);
    const rows = methodMaterialsByItem.get(parentItemId) ?? [];
    rows.push(row);
    methodMaterialsByItem.set(parentItemId, rows);
  }

  const extractionRows = (
    await client.query(
      `
        SELECT DISTINCT ON ("itemId")
          "id", "itemId", "documentId", "status"::text AS "status", "promptVersion", "contentHash", "extraction", "completedAt", "updatedAt", "createdAt"
        FROM "aiDrawingExtraction"
        WHERE "companyId" = $1
          AND "itemId" = ANY($2::text[])
          AND "status" = 'Succeeded'::"aiDrawingExtractionStatus"
          AND jsonb_typeof("extraction") = 'object'
        ORDER BY "itemId", "completedAt" DESC NULLS LAST, "updatedAt" DESC NULLS LAST, "createdAt" DESC
      `,
      [companyId, itemIds]
    )
  ).rows as JsonRecord[];
  const extractionByItem = new Map(extractionRows.map((row) => [String(row.itemId), row]));

  const targets = items.map((item) => {
    const itemId = String(item.id);
    const directMaterial = directMaterialByItem.get(itemId) ?? null;
    const rawMaterials = methodMaterialsByItem.get(itemId) ?? [];
    const latestExtraction = extractionByItem.get(itemId) ?? null;
    const extractionObject = latestExtraction ? objectValue(latestExtraction.extraction) : null;
    const currentTarget = extractionObject
      ? aiRoutingTargetEvidenceFromDrawing({
          id: String(latestExtraction?.id),
          itemId,
          item: {
            readableId: stringValue(item.readableIdWithRevision) ?? stringValue(item.readableId),
            name: stringValue(item.name),
            description: stringValue(item.description)
          },
          drawingExtraction: extractionObject as never
        })
      : null;
    const directMaterialText = compactMaterialRow(directMaterial);
    const rawMaterialTexts = rawMaterials.map(compactMaterialRow);
    const explicitSuitabilitySignals = hasExplicitLaserSuitabilitySignal([
      directMaterialText,
      ...rawMaterialTexts,
      extractionObject
    ]);
    const hasRawMaterialProperties = rawMaterials.some((row) => row.materialSubstanceId || row.materialFormId || row.materialTypeId || row.dimensionId || row.gradeId || row.finishId);
    const hasDirectMaterialProperties = Boolean(
      directMaterial?.materialSubstanceId ||
        directMaterial?.materialFormId ||
        directMaterial?.materialTypeId ||
        directMaterial?.dimensionId ||
        directMaterial?.gradeId ||
        directMaterial?.finishId
    );

    return {
      readableId: item.readableId,
      expectedHumanClassification: humanSourceReview.laserUnsuitable.includes(String(item.readableId))
        ? "laser_unsuitable"
        : humanSourceReview.laserSuitablePositiveContrast.includes(String(item.readableId))
          ? "laser_suitable_positive_contrast"
          : "not_classified",
      item: {
        id: itemId,
        readableIdWithRevision: item.readableIdWithRevision,
        name: item.name,
        description: item.description,
        itemType: item.itemType,
        updatedAt: item.updatedAt
      },
      directMaterial: directMaterialText,
      methodRawMaterials: rawMaterials.map((row) => ({
        makeMethodId: row.makeMethodId,
        makeMethodStatus: row.makeMethodStatus,
        methodMaterialId: row.methodMaterialId,
        methodMaterialRow: row.methodMaterialRow,
        material: compactMaterialRow({
          itemId: row.materialItemId,
          readableId: row.materialReadableId,
          readableIdWithRevision: row.materialReadableIdWithRevision,
          name: row.materialName,
          itemType: row.materialItemType,
          materialSubstanceId: row.materialSubstanceId,
          materialSubstance: row.materialSubstance,
          materialFormId: row.materialFormId,
          materialForm: row.materialForm,
          materialTypeId: row.materialTypeId,
          materialType: row.materialType,
          dimensionId: row.dimensionId,
          dimension: row.dimension,
          gradeId: row.gradeId,
          grade: row.grade,
          finishId: row.finishId,
          finish: row.finish,
          tags: row.tags
        })
      })),
      latestExtraction: latestExtraction
        ? {
            id: latestExtraction.id,
            documentId: latestExtraction.documentId,
            promptVersion: latestExtraction.promptVersion,
            contentHash: latestExtraction.contentHash,
            completedAt: latestExtraction.completedAt,
            summary: extractionTextSummary(extractionObject ?? {})
          }
        : null,
      currentTargetEvidence: currentTarget
        ? {
            materialTags: currentTarget.materialTags,
            featureTags: currentTarget.featureTags,
            processHints: currentTarget.processHints ?? [],
            warningCount: currentTarget.drawingWarnings?.length ?? 0
          }
        : null,
      evidenceSourceAssessment: {
        hasDirectMaterialProperties,
        hasMethodRawMaterialProperties: hasRawMaterialProperties,
        hasExplicitLaserPositiveSignal: explicitSuitabilitySignals.hasPositiveSignal,
        hasExplicitLaserNegativeSignal: explicitSuitabilitySignals.hasNegativeSignal,
        currentServerTargetEvidenceUsesStructuredMaterialFields: false,
        currentServerTargetEvidenceUsesMethodRawMaterials: false
      }
    };
  });

  const summary = {
    companyId,
    targetReadableIds,
    targetCount: targets.length,
    targetsWithMethodRawMaterialProperties: targets.filter((target) => target.evidenceSourceAssessment.hasMethodRawMaterialProperties).map((target) => target.readableId),
    targetsWithDirectMaterialProperties: targets.filter((target) => target.evidenceSourceAssessment.hasDirectMaterialProperties).map((target) => target.readableId),
    targetsWithExplicitLaserPositiveSignal: targets.filter((target) => target.evidenceSourceAssessment.hasExplicitLaserPositiveSignal).map((target) => target.readableId),
    targetsWithExplicitLaserNegativeSignal: targets.filter((target) => target.evidenceSourceAssessment.hasExplicitLaserNegativeSignal).map((target) => target.readableId),
    codeGap: "getAiRoutingTargetEvidenceForItem currently selects item fields and latest aiDrawingExtraction only; it does not join direct material rows or method raw materials into AiRoutingKnowledgeItem.",
    dataGap: "Existing material tables expose substance/form/type/dimension/grade/finish, but this diagnostic only treats explicit laser suitability/unsuitability text as direct suitability evidence. Material form/grade alone is not yet a verified laser suitability rule.",
    materializationGate: "closed",
    routeGenerationChangeRecommended: false
  };

  writeFileSync(outputPath, `${JSON.stringify({ summary, targets }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
} finally {
  client.release();
  await pool.end();
}