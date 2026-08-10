import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { inngest } from "../../client";

const execFileAsync = promisify(execFile);

export const u8WorkOrderImportSchema = z.object({
  companyId: z.string().min(1),
  userId: z.string().min(1),
  triggerType: z.enum(["Manual", "Scheduled"]),
  dryRun: z.boolean().optional()
});

export function resolveU8ImportPaths({
  cwd = process.cwd(),
  carbonRoot,
  importScript
}: {
  cwd?: string;
  carbonRoot?: string;
  importScript?: string;
} = {}) {
  const workspaceDirectory = path.basename(path.dirname(cwd));
  const defaultRoot =
    workspaceDirectory === "apps" || workspaceDirectory === "packages"
      ? path.resolve(cwd, "..", "..")
      : path.resolve(cwd);
  const resolvedRoot = path.resolve(
    carbonRoot ?? process.env.CARBON_ROOT ?? defaultRoot
  );

  return {
    carbonRoot: resolvedRoot,
    scriptPath: path.resolve(
      importScript ??
        process.env.U8_WORK_ORDER_IMPORT_SCRIPT ??
        path.join(resolvedRoot, "scripts", "import-u8-work-orders.cjs")
    )
  };
}

export const u8WorkOrderImportFunction = inngest.createFunction(
  {
    id: "u8-work-order-import",
    retries: 2,
    concurrency: [{ key: "event.data.companyId", limit: 1 }]
  },
  { event: "carbon/u8-work-order-import" },
  async ({ event, step }) => {
    const payload = u8WorkOrderImportSchema.parse(event.data);

    return step.run("import-u8-work-orders", async () => {
      const { carbonRoot, scriptPath } = resolveU8ImportPaths();
      await access(scriptPath);

      const args = [
        scriptPath,
        "--company-id",
        payload.companyId,
        "--user-id",
        payload.userId,
        "--trigger",
        payload.triggerType
      ];
      if (payload.dryRun) args.push("--dry-run");

      const { stdout, stderr } = await execFileAsync(process.execPath, args, {
        cwd: carbonRoot,
        env: {
          ...process.env,
          CARBON_ROOT: carbonRoot
        },
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30 * 60 * 1000,
        windowsHide: true
      });

      if (stderr.trim()) {
        console.warn("U8 work-order importer warnings:", stderr.trim());
      }

      const output = stdout.trim();
      console.info("U8 work-order importer completed:", output);
      return { output };
    });
  }
);
