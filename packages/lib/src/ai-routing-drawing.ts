import { z } from "zod";

export const AI_ROUTING_DRAWING_SCHEMA_VERSION = "ai-routing-drawing.v1";

export const aiRoutingDrawingPartClasses = [
  "sheet-metal",
  "machined",
  "turned",
  "weldment",
  "casting",
  "extrusion",
  "assembly",
  "purchased",
  "unknown"
] as const;

export const aiRoutingDrawingStockForms = [
  "sheet",
  "plate",
  "bar",
  "tube",
  "extrusion",
  "casting",
  "block",
  "coil",
  "unknown"
] as const;

export const aiRoutingDrawingUnits = [
  "mm",
  "cm",
  "m",
  "in",
  "ft",
  "um",
  "degree",
  "rad"
] as const;

export const aiRoutingDrawingDimensionKinds = [
  "linear",
  "diameter",
  "radius",
  "angle",
  "thread",
  "callout",
  "unknown"
] as const;

export const aiRoutingDrawingNoteCategories = [
  "manufacturing",
  "quality",
  "finish",
  "material",
  "tolerance",
  "general"
] as const;

export const aiRoutingDrawingUnknownFields = [
  "partNumber",
  "revision",
  "material",
  "finish",
  "heatTreatment",
  "partClass",
  "stockForm",
  "dimensions",
  "holes",
  "threads",
  "slots",
  "pockets",
  "bends",
  "welds",
  "surfaces",
  "notes"
] as const;

const nullableTextSchema = z.string().trim().min(1).nullable();
const optionalNullableTextSchema = z
  .string()
  .trim()
  .min(1)
  .nullable()
  .optional();
const optionalNullableNumberSchema = z.number().finite().nullable().optional();

const boundingBoxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1)
  })
  .strict()
  .refine((box) => box.x + box.width <= 1 && box.y + box.height <= 1, {
    message: "Bounding box must stay within the normalized page bounds"
  });

const drawingEvidenceSchema = z
  .object({
    id: z.string().trim().min(1),
    pageNumber: z.number().int().positive(),
    text: z.string().trim().min(1),
    boundingBox: boundingBoxSchema.optional(),
    confidence: z.number().min(0).max(1)
  })
  .strict();

const evidenceArraySchema = z.array(drawingEvidenceSchema).min(1);

const drawingDocumentSchema = z
  .object({
    pageCount: z.number().int().positive(),
    renderedPageCount: z.number().int().positive().optional(),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional()
  })
  .strict();

const titleBlockSchema = z
  .object({
    partNumber: nullableTextSchema,
    revision: nullableTextSchema,
    material: nullableTextSchema,
    finish: nullableTextSchema,
    heatTreatment: nullableTextSchema
  })
  .strict();

const drawingPartSchema = z
  .object({
    class: z.enum(aiRoutingDrawingPartClasses),
    stockForm: z.enum(aiRoutingDrawingStockForms)
  })
  .strict();

const toleranceSchema = z
  .object({
    plus: z.number().finite().nullable(),
    minus: z.number().finite().nullable()
  })
  .strict();

const dimensionSchema = z
  .object({
    id: z.string().trim().min(1),
    kind: z.enum(aiRoutingDrawingDimensionKinds),
    label: optionalNullableTextSchema,
    nominal: z.number().finite().nullable(),
    unit: z.enum(aiRoutingDrawingUnits).nullable(),
    tolerance: toleranceSchema.nullable().optional(),
    evidence: evidenceArraySchema
  })
  .strict();

const featureBaseSchema = z.object({
  id: z.string().trim().min(1),
  label: optionalNullableTextSchema,
  quantity: z.number().int().positive().nullable().optional(),
  evidence: evidenceArraySchema
});

const holeFeatureSchema = featureBaseSchema
  .extend({
    diameter: optionalNullableNumberSchema,
    unit: z.enum(aiRoutingDrawingUnits).nullable().optional(),
    thread: optionalNullableTextSchema
  })
  .strict();

const threadFeatureSchema = featureBaseSchema
  .extend({
    specification: optionalNullableTextSchema,
    depth: optionalNullableNumberSchema,
    unit: z.enum(aiRoutingDrawingUnits).nullable().optional()
  })
  .strict();

const slotFeatureSchema = featureBaseSchema
  .extend({
    length: optionalNullableNumberSchema,
    width: optionalNullableNumberSchema,
    unit: z.enum(aiRoutingDrawingUnits).nullable().optional()
  })
  .strict();

const pocketFeatureSchema = featureBaseSchema
  .extend({
    length: optionalNullableNumberSchema,
    width: optionalNullableNumberSchema,
    depth: optionalNullableNumberSchema,
    unit: z.enum(aiRoutingDrawingUnits).nullable().optional()
  })
  .strict();

const bendFeatureSchema = featureBaseSchema
  .extend({
    angle: optionalNullableNumberSchema,
    radius: optionalNullableNumberSchema,
    unit: z.enum(aiRoutingDrawingUnits).nullable().optional()
  })
  .strict();

const weldFeatureSchema = featureBaseSchema
  .extend({
    weldType: optionalNullableTextSchema,
    size: optionalNullableNumberSchema,
    length: optionalNullableNumberSchema,
    unit: z.enum(aiRoutingDrawingUnits).nullable().optional()
  })
  .strict();

const surfaceFeatureSchema = featureBaseSchema
  .extend({
    finish: optionalNullableTextSchema,
    roughness: optionalNullableTextSchema,
    unit: z.enum(aiRoutingDrawingUnits).nullable().optional()
  })
  .strict();

const drawingFeaturesSchema = z
  .object({
    holes: z.array(holeFeatureSchema),
    threads: z.array(threadFeatureSchema),
    slots: z.array(slotFeatureSchema),
    pockets: z.array(pocketFeatureSchema),
    bends: z.array(bendFeatureSchema),
    welds: z.array(weldFeatureSchema),
    surfaces: z.array(surfaceFeatureSchema)
  })
  .strict();

const drawingNoteSchema = z
  .object({
    id: z.string().trim().min(1),
    text: z.string().trim().min(1),
    category: z.enum(aiRoutingDrawingNoteCategories),
    evidence: evidenceArraySchema
  })
  .strict();

const baseDrawingExtractionSchema = z
  .object({
    schemaVersion: z.literal(AI_ROUTING_DRAWING_SCHEMA_VERSION),
    document: drawingDocumentSchema,
    titleBlock: titleBlockSchema,
    part: drawingPartSchema,
    dimensions: z.array(dimensionSchema),
    features: drawingFeaturesSchema,
    notes: z.array(drawingNoteSchema),
    explicitUnknowns: z.array(z.enum(aiRoutingDrawingUnknownFields)),
    warnings: z.array(z.string().trim().min(1))
  })
  .strict();

function evidenceEntries(
  extraction: z.infer<typeof baseDrawingExtractionSchema>
): Array<{ id: string; pageNumber: number }> {
  return [
    ...extraction.dimensions.flatMap((dimension) => dimension.evidence),
    ...extraction.features.holes.flatMap((feature) => feature.evidence),
    ...extraction.features.threads.flatMap((feature) => feature.evidence),
    ...extraction.features.slots.flatMap((feature) => feature.evidence),
    ...extraction.features.pockets.flatMap((feature) => feature.evidence),
    ...extraction.features.bends.flatMap((feature) => feature.evidence),
    ...extraction.features.welds.flatMap((feature) => feature.evidence),
    ...extraction.features.surfaces.flatMap((feature) => feature.evidence),
    ...extraction.notes.flatMap((note) => note.evidence)
  ];
}

export const aiRoutingDrawingExtractionSchema =
  baseDrawingExtractionSchema.superRefine((extraction, ctx) => {
    const seenEvidenceIds = new Set<string>();

    for (const evidence of evidenceEntries(extraction)) {
      if (seenEvidenceIds.has(evidence.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate evidence id: ${evidence.id}`
        });
      }
      seenEvidenceIds.add(evidence.id);

      if (evidence.pageNumber > extraction.document.pageCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Evidence page ${evidence.pageNumber} exceeds document page count ${extraction.document.pageCount}`
        });
      }
    }
  });

export type AiRoutingDrawingExtraction = z.infer<
  typeof aiRoutingDrawingExtractionSchema
>;

function uniqueTrimmed(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function uniqueValues<T extends string>(values: T[]) {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function normalizeAiRoutingDrawingExtraction(
  value: unknown
): AiRoutingDrawingExtraction {
  const extraction = aiRoutingDrawingExtractionSchema.parse(value);

  return {
    ...extraction,
    explicitUnknowns: uniqueValues(extraction.explicitUnknowns),
    warnings: uniqueTrimmed(extraction.warnings)
  };
}
