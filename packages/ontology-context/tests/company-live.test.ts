import { describe, expect, it } from "vitest";
import {
  authoritySchema,
  companyLiveAuthoritySchema
} from "../src/contracts";
import {
  assertCompanyLiveAuthorityScope,
  authenticatedOntologyScopeSchema,
  parseAuthenticatedOntologyScope
} from "../src/company-live";

describe("company-live design boundary", () => {
  it("keeps company-live authority distinct from project snapshots", () => {
    const authority = authoritySchema.parse({
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
    });

    expect(authority.kind).toBe("company_live");
    expect(
      authoritySchema.safeParse({
        kind: "project_snapshot",
        companyId: "company-1",
        snapshotId: "sha256:test",
        artifactHash: "sha256:test",
        sourceManifestHash: "sha256:test",
        dataset: "deepseek",
        model: "deepseek-v4-pro",
        generatedAt: "2026-08-10T03:00:00Z",
        freshness: "static"
      }).success
    ).toBe(false);
  });

  it("requires stale company-live responses to declare staleAt", () => {
    const invalid = companyLiveAuthoritySchema.safeParse({
      kind: "company_live",
      companyId: "company-1",
      dataset: "deepseek",
      model: "carbon-live",
      sourceRevision: "revision-1",
      generatedAt: "2026-08-10T03:00:00Z",
      freshness: {
        status: "stale",
        observedAt: "2026-08-09T03:00:00Z"
      }
    });

    expect(invalid.success).toBe(false);
  });

  it("accepts only server-derived authenticated scope fields", () => {
    expect(
      parseAuthenticatedOntologyScope({
        userId: "user-1",
        companyId: "company-1",
        authMethod: "oauth"
      })
    ).toEqual({
      userId: "user-1",
      companyId: "company-1",
      authMethod: "oauth"
    });
    expect(
      authenticatedOntologyScopeSchema.safeParse({
        userId: "user-1",
        companyId: "company-1",
        authMethod: "api_key",
        callerCompanyId: "company-2"
      }).success
    ).toBe(false);
  });

  it("rejects company-live authority for a different authenticated company", () => {
    const scope = parseAuthenticatedOntologyScope({
      userId: "user-1",
      companyId: "company-1",
      authMethod: "session"
    });

    expect(() =>
      assertCompanyLiveAuthorityScope(scope, {
        kind: "company_live",
        companyId: "company-2",
        dataset: "deepseek",
        model: "carbon-live",
        sourceRevision: "revision-1",
        generatedAt: "2026-08-10T03:00:00Z",
        freshness: {
          status: "fresh",
          observedAt: "2026-08-10T03:00:00Z"
        }
      })
    ).toThrow("forbidden");
  });
});