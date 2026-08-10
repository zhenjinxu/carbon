import { z } from "zod";
import { authoritySchema } from "./contracts";

const requestIdSchema = z.string().regex(/^req_[0-9a-f-]{36}$/);
export const warningCodeSchema = z.enum(["truncated"]);
export const httpErrorCodeSchema = z.enum([
  "invalid_query",
  "unauthenticated",
  "forbidden",
  "object_not_found",
  "not_found",
  "method_not_allowed",
  "response_too_large",
  "rate_limited",
  "snapshot_unavailable"
]);

export const httpSuccessEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: requestIdSchema,
    authority: authoritySchema,
    data: z.record(z.unknown()),
    warnings: z.array(warningCodeSchema)
  })
  .strict();

export const httpErrorEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: requestIdSchema,
    error: z
      .object({
        code: httpErrorCodeSchema,
        message: z.string().min(1).max(4096)
      })
      .strict()
  })
  .strict();

export type HttpErrorCode = z.infer<typeof httpErrorCodeSchema>;
