import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { createOntologyContextServer } from "../src/http";
import type { OntologyService } from "../src/service";

async function requestMetadata(service: OntologyService) {
  const server = createOntologyContextServer(service);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("server_unavailable");

  try {
    const response = await fetch(
      "http://127.0.0.1:" + address.port + "/api/ontology/metadata"
    );
    return {
      status: response.status,
      body: (await response.json()) as {
        error: { code: string; message: string };
      }
    };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

describe("ontology context internal error boundary", () => {
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
      }
    };

    const result = await requestMetadata(invalidResponse);

    expect(result.status).toBe(500);
    expect(result.body.error).toEqual({
      code: "snapshot_unavailable",
      message: "Ontology snapshot is unavailable"
    });
  });

  it("does not serve company-live authority through the loopback snapshot adapter", async () => {
    const companyLiveResponse: OntologyService = {
      metadata() {
        return {
          authority: {
            kind: "company_live",
            companyId: "company-1",
            dataset: "deepseek",
            model: "carbon-live",
            sourceRevision: "revision-1",
            generatedAt: "2026-08-10T03:00:00Z",
            freshness: {
              status: "fresh",
              observedAt: "2026-08-10T03:00:00Z"
            }
          }
        } as never;
      },
      search() {
        throw new Error("not_used");
      },
      context() {
        throw new Error("not_used");
      }
    };

    const result = await requestMetadata(companyLiveResponse);

    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe("snapshot_unavailable");
  });
});
