import { z } from "zod";
import { jobStatus } from "./production.models";

const dateValue = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();

export const u8ImportConfigValidator = z
  .object({
    customerNames: z.array(z.string().min(1).max(255)).max(100),
    moCodes: z.array(z.string().min(1).max(100)).max(200),
    soCodes: z.array(z.string().min(1).max(100)).max(200),
    startDate: dateValue,
    endDate: dateValue,
    intervalMinutes: z.number().int().min(1).max(1440)
  })
  .refine(
    (value) =>
      !value.startDate || !value.endDate || value.startDate <= value.endDate,
    {
      message: "End date must be on or after start date",
      path: ["endDate"]
    }
  );

export type U8ImportConfigInput = z.infer<typeof u8ImportConfigValidator>;

export const u8DashboardFilterValidator = z.object({
  search: z.string().trim().max(255).optional(),
  customer: z.string().trim().max(255).optional(),
  status: z.enum(jobStatus).optional(),
  startDate: dateValue,
  endDate: dateValue,
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(100).default(25),
  selectedJobId: z.string().trim().max(100).optional()
});

export type U8DashboardFilters = z.infer<typeof u8DashboardFilterValidator>;

export function parseDelimitedValues(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return [];
  return [
    ...new Set(
      value
        .split(/[\n,，;；]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ];
}

export function nullableFormText(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}
