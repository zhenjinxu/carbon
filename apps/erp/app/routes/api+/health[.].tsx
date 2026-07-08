import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  return data({
    status: "ok",
    timestamp: new Date().toISOString(),
    edition: process.env.CARBON_EDITION || "unknown"
  });
}
