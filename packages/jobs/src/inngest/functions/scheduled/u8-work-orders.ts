import {
  getPostgresClient,
  getPostgresConnectionPool
} from "@carbon/database/client";
import { PostgresDriver, sql } from "kysely";
import { inngest } from "../../client";

type DueImport = {
  companyId: string;
  userId: string;
};

export const u8WorkOrderImportSchedulerFunction = inngest.createFunction(
  { id: "u8-work-order-import-scheduler", retries: 1 },
  { cron: "* * * * *" },
  async ({ step }) => {
    const pool = getPostgresConnectionPool(2);
    const database = getPostgresClient(pool, PostgresDriver);

    try {
      const due = await step.run("find-due-u8-imports", async () => {
        const result = await sql
          .raw<DueImport>(
            'SELECT "companyId", COALESCE("updatedBy", "createdBy") AS "userId" ' +
              'FROM "u8WorkOrderImportConfig" WHERE "enabled" = TRUE ' +
              'AND ("nextRunAt" IS NULL OR "nextRunAt" <= NOW()) ' +
              'ORDER BY "nextRunAt" NULLS FIRST LIMIT 100'
          )
          .execute(database);
        return result.rows;
      });

      for (const item of due) {
        await step.sendEvent("trigger-u8-import-" + item.companyId, {
          name: "carbon/u8-work-order-import",
          data: {
            companyId: item.companyId,
            userId: item.userId,
            triggerType: "Scheduled" as const
          }
        });
      }

      return { scheduled: due.length };
    } finally {
      await pool.end();
    }
  }
);
