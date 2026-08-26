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
  RelationIdentityV1,
  RelationSourcePathV1,
} from "flarex-protocol/internal/relation-declaration-v1";

import type {
  ApplicationRelationRowTransition,
  LocatedApplicationRelationDefinition,
  LocatedApplicationRelationDefinitionSet,
  PrepareApplicationRelationCommitError,
  PreparedApplicationRelationCommit,
} from "../applicationRelationCommit";
import type {
  ApplicationActiveSelection,
  ValidateApplicationRelationActiveSelectionInTransactionError,
  ValidateApplicationRelationActiveSelectionError,
} from "../applicationActivation";
import type { AppRowTransaction } from "../appRows";
import type { ApplicationRelationReadinessFoldRepository } from
  "../applicationRelationReadinessFold";
import type { ScopeClockRecord } from "../scopeClock";

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
  readonly selection: ApplicationActiveSelection;
  readonly relationId: CatalogRelationId;
}

/** Logical source-owned selector; it contains no catalog or physical identity. */
export interface ApplicationRelationSourceReference {
  readonly source: Readonly<{
    readonly table: RelationIdentityV1;
    readonly path: RelationSourcePathV1;
  }>;
}

export interface PrepareApplicationRelationReadCapabilityBySourceInput {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly selection: ApplicationActiveSelection;
  readonly relation: ApplicationRelationSourceReference;
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

export interface ApplicationRelationActiveSelectionCas {
  readonly activationSequence: bigint;
  readonly activeHeadSha256: Uint8Array;
}

export interface ValidatedApplicationRelationReadCapability {
  readonly activeSelection: ApplicationRelationActiveSelectionCas;
}

export class ApplicationRelationReadUnavailableError extends Data.TaggedError(
  "ApplicationRelationReadUnavailableError",
)<{
  readonly reason:
    | "invalidComposition"
    | "activeSelectionUnavailable"
    | "definitionSetUnavailable"
    | "definitionNotFound"
    | "definitionNotEligible"
    | "capabilityMismatch";
}> {}

export type PrepareApplicationRelationReadCapabilityError =
  | ApplicationRelationReadUnavailableError
  | ValidateApplicationRelationActiveSelectionError;

export type ValidateApplicationRelationReadCapabilityError =
  | ApplicationRelationReadUnavailableError
  | ValidateApplicationRelationActiveSelectionInTransactionError;

export interface ApplicationRelationReadPort {
  readonly readiness: ApplicationRelationReadinessFoldRepository;
  readonly prepare: (
    input: PrepareApplicationRelationReadCapabilityInput,
  ) => Effect.Effect<
    ApplicationRelationReadCapability,
    PrepareApplicationRelationReadCapabilityError
  >;
  readonly prepareBySource: (
    input: PrepareApplicationRelationReadCapabilityBySourceInput,
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
  readonly validateInTransaction: (
    capability: ApplicationRelationReadCapability,
    input: ResolveApplicationRelationReadCapabilityInput,
    tx: AppRowTransaction,
    currentClock: ScopeClockRecord,
  ) => Effect.Effect<
    ValidatedApplicationRelationReadCapability,
    ValidateApplicationRelationReadCapabilityError
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
