import { Buffer } from "node:buffer";
import { openai } from "@ai-sdk/openai";
import { aiRoutingDrawingExtractionSchema } from "@carbon/lib/ai-routing-drawing";
import { generateObject as aiGenerateObject } from "ai";
import {
  AI_ROUTING_DRAWING_PROMPT_VERSION,
  type ExtractDrawingArgs,
  type ExtractDrawingResult,
  PermanentAiRoutingDrawingExtractionError
} from "./extract-part-drawing.runner";

const AI_ROUTING_DRAWING_SCHEMA_NAME = "ai_routing_drawing_extraction";
const AI_ROUTING_DRAWING_SCHEMA_DESCRIPTION =
  "Traceable structured facts extracted only from visible Part PDF drawing pages";

type AiRoutingDrawingModelProvider = "openai";

type AiRoutingDrawingModelConfig = {
  provider: AiRoutingDrawingModelProvider;
  modelName: string;
};

type AiRoutingDrawingModelEnv = Partial<
  Record<
    | "AI_ROUTING_DRAWING_MODEL_PROVIDER"
    | "AI_ROUTING_DRAWING_MODEL_NAME"
    | string,
    string | undefined
  >
>;

type AiRoutingDrawingGenerateObjectRequest = {
  model: unknown;
  schema: typeof aiRoutingDrawingExtractionSchema;
  schemaName: string;
  schemaDescription: string;
  system: string;
  messages: Array<{
    role: "user";
    content: Array<
      | { type: "text"; text: string }
      | { type: "image"; image: Buffer; mediaType: "image/png" }
    >;
  }>;
  temperature: number;
};

type AiRoutingDrawingGenerateObject = (
  request: AiRoutingDrawingGenerateObjectRequest
) => Promise<{ object: unknown }>;

type ExtractDrawingWithConfiguredModelDependencies = {
  env?: AiRoutingDrawingModelEnv;
  createOpenAiModel?: (modelName: string) => unknown;
  generateObject?: AiRoutingDrawingGenerateObject;
};

export function resolveAiRoutingDrawingModelConfig(
  env: AiRoutingDrawingModelEnv = process.env
): AiRoutingDrawingModelConfig {
  const provider = env.AI_ROUTING_DRAWING_MODEL_PROVIDER?.trim().toLowerCase();
  const modelName = env.AI_ROUTING_DRAWING_MODEL_NAME?.trim();

  if (!provider || !modelName) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "MODEL_NOT_CONFIGURED",
      "AI routing drawing extraction model is not configured",
      "Configuration"
    );
  }

  if (provider !== "openai") {
    throw new PermanentAiRoutingDrawingExtractionError(
      "MODEL_PROVIDER_NOT_SUPPORTED",
      `AI routing drawing extraction provider '${provider}' is not supported`,
      "Configuration"
    );
  }

  return { provider, modelName };
}

function buildAiRoutingDrawingSystemPrompt() {
  return `You extract structured manufacturing facts from Part PDF drawing page images for Carbon AI routing.

Return only the JSON object matching the supplied schema. Use exact field names and enum values from the schema.

Rules:
- Use only visible PDF drawing evidence from the supplied page images and render metadata.
- Do not use existing make-methods, confirmed route records, training answers, process sequences, work centers, or resource assignments.
- Do not propose manufacturing operations. Extract drawing facts only.
- If a value is missing, unreadable, or uncertain, use null, an empty array, explicitUnknowns, and warnings as appropriate.
- Every dimension, feature, and note must include page-level evidence with confidence.
- boundingBox coordinates are optional, but when present they must be normalized page fractions, not pixels: x/pageWidth, y/pageHeight, width/pageWidth, and height/pageHeight. Each value must be between 0 and 1, and the box must stay within the page bounds.
- Keep evidence text short and limited to the visible callout/title-block text needed for traceability.
- Set document.contentHash, document.pageCount, and document.renderedPageCount from the render metadata supplied in the user message.`;
}

function buildAiRoutingDrawingUserText(args: ExtractDrawingArgs) {
  const pageLines = args.renderSummary.pages
    .map(
      (page) =>
        `page ${page.pageNumber}: ${page.width}x${page.height}px, textItems=${page.textItemCount}, textChars=${page.textCharCount}`
    )
    .join("\n");

  return `Use only visible PDF drawing evidence.

Document metadata:
- schemaVersion: ${AI_ROUTING_DRAWING_PROMPT_VERSION}
- contentHash: ${args.renderSummary.contentHash}
- pageCount: ${args.renderSummary.pageCount}
- renderedPageCount: ${args.renderSummary.renderedPageCount}
- rendererVersion: ${args.renderSummary.rendererVersion}

Rendered pages:
${pageLines}

When including boundingBox evidence, normalize coordinates against that page's listed pixel width and height. Never return pixel coordinates.

Return a complete ai-routing-drawing.v1 object. Do not infer missing material, dimensions, tolerances, features, finish, heat treatment, or part class from prior Carbon data.`;
}

export async function extractDrawingWithConfiguredModel(
  args: ExtractDrawingArgs,
  dependencies: ExtractDrawingWithConfiguredModelDependencies = {}
): Promise<ExtractDrawingResult> {
  if (args.pages.length === 0) {
    throw new PermanentAiRoutingDrawingExtractionError(
      "NO_RENDERED_PAGES",
      "Part PDF produced no rendered pages for drawing extraction",
      "Input"
    );
  }

  const config = resolveAiRoutingDrawingModelConfig(
    dependencies.env ?? process.env
  );
  const createOpenAiModel = dependencies.createOpenAiModel ?? openai;
  const generateObject =
    dependencies.generateObject ??
    (aiGenerateObject as unknown as AiRoutingDrawingGenerateObject);

  const { object } = await generateObject({
    model: createOpenAiModel(config.modelName),
    schema: aiRoutingDrawingExtractionSchema,
    schemaName: AI_ROUTING_DRAWING_SCHEMA_NAME,
    schemaDescription: AI_ROUTING_DRAWING_SCHEMA_DESCRIPTION,
    system: buildAiRoutingDrawingSystemPrompt(),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: buildAiRoutingDrawingUserText(args) },
          ...args.pages.map((page) => ({
            type: "image" as const,
            image: Buffer.from(page.imageBytes),
            mediaType: page.mediaType
          }))
        ]
      }
    ],
    temperature: 0.1
  });

  return {
    extraction: object,
    modelProvider: config.provider,
    modelName: config.modelName,
    promptVersion: AI_ROUTING_DRAWING_PROMPT_VERSION
  };
}
