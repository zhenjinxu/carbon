import { test } from "vitest";

test("run the controlled 192793050201 v2 extraction once", async () => {
  await import("./ai-routing-192793050201-controlled-v2.mts");
}, 900_000);
