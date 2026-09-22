import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import type { AiRoutingDraft } from "~/modules/items";
import {
  buildAiRoutingSampleFromMakeMethod,
  enqueueAiRoutingDrawingExtraction,
  generateAndPersistAiRoutingDraft,
  getAiRoutingSamples,
  getAiRoutingTargetEvidenceForItem,
  getAiRoutingTrainingDrawingSnapshots,
  materializeAcceptedAiRoutingDraft,
  persistAiRoutingSample,
  recordAiRoutingFeedback
} from "~/modules/items/ai-routing.server";
import { aiRoutingActionRuntimeFailure } from "~/modules/items/ai-routing-action-errors";
import {
  AiRoutingPartPdfAccessError,
  type AiRoutingPartPdfDocumentRow,
  validateAiRoutingPartPdfDocument
} from "~/modules/items/ai-routing-drawing.server";
import { parseAiRoutingConfirmedRouteSnapshot } from "~/modules/items/ai-routing-review";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const intentValidator = z.enum([
  "save-sample",
  "generate-draft",
  "record-feedback",
  "extract-drawing",
  "materialize-draft"
]);

const sampleStatusValidator = z.enum(["Candidate", "Approved"]);
const feedbackStatusValidator = z.enum(["Accepted", "Rejected"]);

export type AiRoutingActionData =
  | {
      success: true;
      intent: "save-sample";
      message: MessageDescriptor;
      sampleId: string | null;
      sampleStatus: "Candidate" | "Approved";
    }
  | {
      success: true;
      intent: "generate-draft";
      message: MessageDescriptor;
      draftId: string | null;
      draft: AiRoutingDraft;
      sampleCount: number;
    }
  | {
      success: true;
      intent: "record-feedback";
      message: MessageDescriptor;
      feedbackId: string | null;
      draftStatus: "Accepted" | "Rejected";
    }
  | {
      success: true;
      intent: "extract-drawing";
      message: MessageDescriptor;
      extractionId: string;
      status: "Pending";
    }
  | {
      success: true;
      intent: "materialize-draft";
      message: MessageDescriptor;
      action: "Created" | "Reused";
      makeMethodId: string;
      operationCount: number;
      version: number;
      redirectTo: string;
    }
  | {
      success: false;
      intent?: string;
      message: MessageDescriptor;
    };

function formText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function fail(message: MessageDescriptor, intent?: string, status = 400) {
  return data<AiRoutingActionData>(
    { success: false, intent, message },
    { status }
  );
}

function parseOriginalSuggestion(value: string) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function runtimeFailure(error: unknown, intent?: string) {
  const failure = aiRoutingActionRuntimeFailure(error, intent);
  return fail(failure.message, failure.intent, failure.status);
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });
  const db = getDatabaseClient();
  const formData = await request.formData();
  const intent = intentValidator.safeParse(formText(formData, "intent"));

  if (!intent.success) return fail(msg`Unsupported AI routing action`);

  const itemId = formText(formData, "itemId");
  const makeMethodId = formText(formData, "makeMethodId");

  if (!itemId) return fail(msg`Missing part id`, intent.data);

  try {
    if (intent.data === "extract-drawing") {
      const documentId = formText(formData, "documentId");
      if (!documentId)
        return fail(msg`Missing Part PDF document id`, intent.data);

      const documentResult = await client
        .from("document")
        .select(
          "id, companyId, sourceDocument, sourceDocumentId, active, path, extension, type, size"
        )
        .eq("id", documentId)
        .eq("companyId", companyId)
        .maybeSingle();

      if (documentResult.error) {
        return fail(
          msg`Failed to load the selected Part PDF document.`,
          intent.data
        );
      }

      try {
        validateAiRoutingPartPdfDocument(
          documentResult.data as AiRoutingPartPdfDocumentRow | null,
          { companyId, itemId, documentId }
        );
      } catch (error) {
        if (error instanceof AiRoutingPartPdfAccessError) {
          return fail(
            msg`The selected document is not an active PDF drawing for this Part.`,
            intent.data
          );
        }
        throw error;
      }

      const result = await enqueueAiRoutingDrawingExtraction(db, {
        companyId,
        userId,
        itemId,
        documentId
      });

      return data<AiRoutingActionData>({
        success: true,
        intent: intent.data,
        message: msg`AI drawing extraction has been queued. Refresh this panel to see the processing status.`,
        extractionId: result.extractionId,
        status: result.status
      });
    }
    if (intent.data === "record-feedback") {
      const draftId = formText(formData, "draftId");
      const draftStatus = feedbackStatusValidator.safeParse(
        formText(formData, "draftStatus")
      );

      if (!draftId) return fail(msg`Missing AI routing draft id`, intent.data);
      if (!draftStatus.success) {
        return fail(msg`Unsupported AI routing feedback status`, intent.data);
      }

      const feedbackId = await recordAiRoutingFeedback(db, {
        companyId,
        userId,
        draftId,
        itemId,
        draftStatus: draftStatus.data,
        changeSummary: formText(formData, "changeSummary") || null,
        reason: formText(formData, "reason") || null,
        outcomeStatus: "Technologist reviewed",
        originalSuggestion: parseOriginalSuggestion(
          formText(formData, "originalSuggestion")
        ),
        confirmedRouteSnapshot: parseAiRoutingConfirmedRouteSnapshot(
          formText(formData, "confirmedRouteSnapshot")
        )
      });

      return data<AiRoutingActionData>({
        success: true,
        intent: intent.data,
        message:
          draftStatus.data === "Accepted"
            ? msg`Technologist acceptance feedback recorded. The formal routing still requires manual publication.`
            : msg`Technologist rejection feedback recorded.`,
        feedbackId,
        draftStatus: draftStatus.data
      });
    }

    if (intent.data === "materialize-draft") {
      const draftId = formText(formData, "draftId");
      if (!draftId) return fail(msg`Missing AI routing draft id`, intent.data);

      const result = await materializeAcceptedAiRoutingDraft(db, {
        companyId,
        userId,
        itemId,
        draftId
      });

      return data<AiRoutingActionData>({
        success: true,
        intent: intent.data,
        message:
          result.action === "Created"
            ? msg`Created an AI-reviewed Draft method version. Review and activate it separately.`
            : msg`This AI draft already has a linked Draft method version.`,
        action: result.action,
        makeMethodId: result.makeMethodId,
        operationCount: result.operationCount,
        version: result.version,
        redirectTo: path.to.partMake(itemId, result.makeMethodId)
      });
    }
    if (intent.data === "generate-draft") {
      const target = await getAiRoutingTargetEvidenceForItem(db, {
        companyId,
        itemId
      });

      if (!target) {
        return fail(
          msg`Run AI drawing extraction successfully before generating a PDF-based routing draft.`,
          intent.data,
          409
        );
      }

      const samples = await getAiRoutingSamples(db, { companyId, limit: 100 });
      if (samples.length === 0) {
        return fail(
          msg`The AI routing sample library is empty. Save a confirmed routing as a learning sample first.`,
          intent.data
        );
      }

      const { id, draft } = await generateAndPersistAiRoutingDraft(db, {
        companyId,
        userId,
        targetItemId: itemId,
        targetMakeMethodId: makeMethodId || null,
        target,
        samples,
        rationale: {
          source: "Carbon AI routing assistant",
          evidenceSource: "latest-succeeded-pdf-extraction",
          sampleLimit: 100,
          generatedAt: new Date().toISOString()
        }
      });

      return data<AiRoutingActionData>({
        success: true,
        intent: intent.data,
        message:
          draft.suggestedOperations.length > 0
            ? msg`Generated ${draft.suggestedOperations.length} AI routing draft operations.`
            : msg`No sufficiently similar sample could generate operations. The retrieval evidence was kept for analysis.`,
        draftId: id,
        draft,
        sampleCount: samples.length
      });
    }

    if (!makeMethodId) return fail(msg`Missing make method id`, intent.data);

    const sample = await buildAiRoutingSampleFromMakeMethod(client, {
      companyId,
      itemId,
      makeMethodId,
      status: sampleStatusValidator
        .catch("Candidate")
        .parse(formText(formData, "sampleStatus"))
    });

    if (sample.error || !sample.data) {
      return fail(msg`Failed to build routing sample`, intent.data);
    }

    if (sample.data.operations.length === 0) {
      return fail(
        msg`This routing has no operations and cannot be saved as a learning sample.`,
        intent.data
      );
    }

    let drawingSnapshot: unknown[];
    try {
      drawingSnapshot = await getAiRoutingTrainingDrawingSnapshots(db, {
        companyId,
        itemId
      });
    } catch {
      return fail(
        msg`Run AI drawing extraction successfully before saving this routing as a learning sample.`,
        intent.data,
        409
      );
    }

    const sampleId = await persistAiRoutingSample(db, {
      sample: sample.data,
      companyId,
      userId,
      source: "technologist-confirmed-method",
      itemSnapshot: sample.itemSnapshot,
      drawingSnapshot,
      operationSnapshot: sample.operationSnapshot
    });

    return data<AiRoutingActionData>({
      success: true,
      intent: intent.data,
      message:
        sample.data.status === "Approved"
          ? msg`Saved as an approved AI routing learning sample.`
          : msg`Saved as a candidate AI routing learning sample.`,
      sampleId,
      sampleStatus: sample.data.status ?? "Candidate"
    });
  } catch (cause) {
    return runtimeFailure(cause, intent.data);
  }
}
