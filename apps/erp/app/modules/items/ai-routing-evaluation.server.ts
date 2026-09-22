import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { type Generated, sql } from "kysely";
import type { AiRoutingEvaluationRunRecord } from "./ai-routing-evaluation";

type AiRoutingEvaluationRunTable = {
  aiRoutingEvaluationRun: {
    id: Generated<string>;
    companyId: string;
    status: "Pending" | "Running" | "Succeeded" | "Failed";
    trainingSampleIds: string[];
    evaluationSampleIds: string[];
    generatorVersion: string;
    promptVersion: string | null;
    extractorSchemaVersion: string;
    modelProvider: string | null;
    modelName: string | null;
    caseResults: unknown;
    metrics: unknown;
    createdBy: string;
    completedAt: string;
  };
};

export type AiRoutingEvaluationRunDatabase = Kysely<
  KyselyDatabase & AiRoutingEvaluationRunTable
>;

export type AiRoutingEvaluationRunAuthorization = {
  partsView: boolean;
  partsUpdate: boolean;
};

export function assertAiRoutingEvaluationRunAuthorization(
  authorization: AiRoutingEvaluationRunAuthorization
) {
  if (!authorization.partsView || !authorization.partsUpdate) {
    throw new Error(
      "AI routing evaluation run requires Parts view and update permission"
    );
  }
}

export async function persistAiRoutingEvaluationRun(
  db: AiRoutingEvaluationRunDatabase,
  record: AiRoutingEvaluationRunRecord,
  authorization: AiRoutingEvaluationRunAuthorization
) {
  assertAiRoutingEvaluationRunAuthorization(authorization);

  const inserted = await db
    .insertInto("aiRoutingEvaluationRun")
    .values({
      companyId: record.companyId,
      status: record.status,
      trainingSampleIds: record.trainingSampleIds,
      evaluationSampleIds: record.evaluationSampleIds,
      generatorVersion: record.generatorVersion,
      promptVersion: record.promptVersion,
      extractorSchemaVersion: record.extractorSchemaVersion,
      modelProvider: record.modelProvider,
      modelName: record.modelName,
      caseResults: sql`${JSON.stringify(record.caseResults)}::jsonb`,
      metrics: sql`${JSON.stringify(record.metrics)}::jsonb`,
      createdBy: record.createdBy,
      completedAt: record.completedAt
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}
