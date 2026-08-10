import { z } from "zod";
import type {
  CompanyLiveAuthority,
  ContextQuery,
  DatasetId,
  SearchQuery
} from "./contracts";
import {
  companyLiveAuthoritySchema,
  contextResponseSchema,
  metadataResponseSchema,
  searchResponseSchema
} from "./contracts";

export const authenticatedOntologyScopeSchema = z
  .object({
    userId: z.string().trim().min(1).max(256),
    companyId: z.string().trim().min(1).max(256),
    authMethod: z.enum(["session", "oauth", "api_key"])
  })
  .strict();

export const companyLiveMetadataResponseSchema = metadataResponseSchema
  .extend({ authority: companyLiveAuthoritySchema })
  .strict();
export const companyLiveSearchResponseSchema = searchResponseSchema
  .extend({ authority: companyLiveAuthoritySchema })
  .strict();
export const companyLiveContextResponseSchema = contextResponseSchema
  .extend({ authority: companyLiveAuthoritySchema })
  .strict();

export type AuthenticatedOntologyScope = z.infer<
  typeof authenticatedOntologyScopeSchema
>;
export type CompanyLiveMetadataResponse = z.infer<
  typeof companyLiveMetadataResponseSchema
>;
export type CompanyLiveSearchResponse = z.infer<
  typeof companyLiveSearchResponseSchema
>;
export type CompanyLiveContextResponse = z.infer<
  typeof companyLiveContextResponseSchema
>;

export function parseAuthenticatedOntologyScope(
  value: unknown
): AuthenticatedOntologyScope {
  return authenticatedOntologyScopeSchema.parse(value);
}

export function assertCompanyLiveAuthorityScope(
  scope: AuthenticatedOntologyScope,
  authority: unknown
): CompanyLiveAuthority {
  const parsed = companyLiveAuthoritySchema.parse(authority);
  if (parsed.companyId !== scope.companyId) throw new Error("forbidden");
  return parsed;
}

export interface CompanyOntologySource {
  metadata(
    scope: AuthenticatedOntologyScope,
    dataset: DatasetId
  ): Promise<CompanyLiveMetadataResponse>;
  search(
    scope: AuthenticatedOntologyScope,
    input: SearchQuery
  ): Promise<CompanyLiveSearchResponse>;
  context(
    scope: AuthenticatedOntologyScope,
    input: ContextQuery
  ): Promise<CompanyLiveContextResponse>;
}
