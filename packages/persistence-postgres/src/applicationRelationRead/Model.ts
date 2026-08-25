import { Data, type Effect, type Result } from "effect";

import type { CatalogRelationId } from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";
import type {
  ScopeEpoch,
  ScopeId,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from
  "flarex-protocol/transaction-grant";

import type {
  ApplicationRelationRowTransition,
  LocatedApplicationRelationDefinition,
  LocatedApplicationRelationDefinitionSet,
  PrepareApplicationRelationCommitError,
  PreparedApplicationRelationCommit,
} from "../applicationRelationCommit";
import type {
  ApplicationRelationReadinessFoldRepository,
  ApplicationRelationReadinessFoldResult,
} from "../applicationRelationReadinessFold";

const applicationRelationReadCapabilityBrand: unique symbol = Symbol(
  "FlarexDB/ApplicationRelationReadCapability",
);

/** Opaque process-local proof of one exact R02 + E01-B relation definition. */
export interface ApplicationRelationReadCapability {
  readonly [applicationRelationReadCapabilityBrand]: true;
}

/** Package-internal construction; the owning repository retains real authority. */
export function makeApplicationRelationReadCapability():
  ApplicationRelationReadCapability {
  return Object.freeze({
    [applicationRelationReadCapabilityBrand]: true as const,
  });
}

export interface PrepareApplicationRelationReadCapabilityInput {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly readiness: Extract<
    ApplicationRelationReadinessFoldResult,
    { readonly status: "ready" }
  >;
  readonly relationId: CatalogRelationId;
}

export interface ResolveApplicationRelationReadCapabilityInput {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
}

export interface ResolvedApplicationRelationReadCapability {
  readonly definition: LocatedApplicationRelationDefinition;
  readonly definitions: LocatedApplicationRelationDefinitionSet;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly epoch: ScopeEpoch;
}

export class ApplicationRelationReadUnavailableError extends Data.TaggedError(
  "ApplicationRelationReadUnavailableError",
)<{
  readonly reason:
    | "invalidComposition"
    | "readinessUnavailable"
    | "definitionSetUnavailable"
    | "definitionNotFound"
    | "definitionNotEligible"
    | "capabilityMismatch";
}> {}

export type PrepareApplicationRelationReadCapabilityError =
  ApplicationRelationReadUnavailableError;

export interface ApplicationRelationReadPort {
  readonly readiness: ApplicationRelationReadinessFoldRepository;
  readonly prepare: (
    input: PrepareApplicationRelationReadCapabilityInput,
  ) => Effect.Effect<
    ApplicationRelationReadCapability,
    PrepareApplicationRelationReadCapabilityError
  >;
  readonly resolve: (
    capability: ApplicationRelationReadCapability,
    input: ResolveApplicationRelationReadCapabilityInput,
  ) => Result.Result<
    ResolvedApplicationRelationReadCapability,
    ApplicationRelationReadUnavailableError
  >;
  readonly lowerOverlay: (
    capability: ApplicationRelationReadCapability,
    input: ResolveApplicationRelationReadCapabilityInput,
    transitions: ReadonlyArray<ApplicationRelationRowTransition>,
  ) => Result.Result<
    PreparedApplicationRelationCommit,
    | ApplicationRelationReadUnavailableError
    | PrepareApplicationRelationCommitError
  >;
}
