import { toast } from "@carbon/react";
import type { MiddlewareFunction } from "react-router";
import type { Result } from "../types";

type ClientMiddlewareResult = Record<
  string,
  { type: "data" | "error"; result: unknown }
>;

function getMessage(result: Result | null): string {
  const msg = result?.message;
  if (typeof msg === "string") return msg;
  if (msg && typeof msg === "object" && "message" in msg && msg.message)
    return msg.message;
  if (msg && typeof msg === "object" && "id" in msg) return msg.id;
  return "";
}

export const flashClientMiddleware: MiddlewareFunction<
  ClientMiddlewareResult
> = async (_args, next) => {
  const data = await next();

  const rootData = data?.root;
  if (rootData?.type === "data" && rootData.result) {
    const result = (rootData.result as Record<string, unknown>)
      .result as Result | null;
    const message = getMessage(result);
    if (message) {
      if (result?.success === true) {
        toast.success(message);
      } else {
        toast.error(message);
      }
    }
  }

  return data;
};
