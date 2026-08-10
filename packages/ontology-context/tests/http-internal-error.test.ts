import { expect, it } from "vitest";
import { ZodError } from "zod";
import { createOntologyContextServer } from "../src/http";
import type { OntologyService } from "../src/service";

it("redacts internal schema failures instead of blaming the query", async () => {
  const invalidResponse: OntologyService = {
    metadata() {
      throw new ZodError([]);
    },
    search() {
      throw new ZodError([]);
    },
    context() {
      throw new ZodError([]);
    },
  };
  const server = createOntologyContextServer(invalidResponse);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server_unavailable");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/ontology/metadata`);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      code: "snapshot_unavailable",
      message: "Ontology snapshot is unavailable",
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
