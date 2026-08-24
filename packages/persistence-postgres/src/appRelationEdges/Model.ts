import { Data } from "effect";

import type { AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type {
  CatalogEdgeDefinitionId,
  CatalogRelationId,
} from "flarex-protocol/catalog";
import type { PhysicalEdgeDefinitionV1 } from
  "flarex-protocol/internal/application-schema-binding";
import type { RelationOccurrenceV1 } from
  "flarex-protocol/internal/relation-occurrence-v1";
import type { CatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";
import type { CommitSeq, ScopeId } from
  "flarex-protocol/storage-authority";

export type AppRelationEdgeOperation =
  | "applyChanges"
  | "readAdjacencyVersion"
  | "hasIncoming"
  | "readIncomingPage"
  | "readBuildSource"
  | "readBuildPage";

/**
 * Package-private physical pin. It records immutable R02 meaning but is not a
 * located-scope publication or write authority; C09 owns that later boundary.
 */
export interface AppRelationEdgeDefinitionPin {
  readonly relationId: CatalogRelationId;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly physical: PhysicalEdgeDefinitionV1;
}

export type AppRelationEdgePosition = number | null;

interface AppRelationEdgeActionBase {
  readonly definition: AppRelationEdgeDefinitionPin;
  readonly occurrence: RelationOccurrenceV1;
}

export type AppRelationEdgeStorageAction =
  | Readonly<AppRelationEdgeActionBase & {
      readonly kind: "put";
      readonly position: AppRelationEdgePosition;
    }>
  | Readonly<AppRelationEdgeActionBase & {
      readonly kind: "remove";
    }>
  | Readonly<AppRelationEdgeActionBase & {
      readonly kind: "reorder";
      readonly position: AppRelationEdgePosition;
    }>;

export interface ApplyAppRelationEdgeChangesInput {
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly commitSeq: CommitSeq;
  readonly actions: ReadonlyArray<AppRelationEdgeStorageAction>;
}

export interface ApplyAppRelationEdgeChangesResult {
  readonly putCount: number;
  readonly removeCount: number;
  readonly reorderCount: number;
  readonly advancedEndpointCount: number;
}

export type AppRelationEdgeAdjacencyDirection = "incoming" | "outgoing";

export interface ReadAppRelationEdgeAdjacencyVersionInput {
  readonly scopeId: ScopeId;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly direction: AppRelationEdgeAdjacencyDirection;
  readonly endpointRowId: AppRowIdHexV1;
}

export interface AppRelationEdgeIncomingFrontier {
  readonly sourceRowId: AppRowIdHexV1;
  readonly duplicateOrdinal: 0;
}

export interface ReadIncomingAppRelationEdgePageInput {
  readonly scopeId: ScopeId;
  readonly definition: AppRelationEdgeDefinitionPin;
  readonly targetRowId: AppRowIdHexV1;
  readonly maximumIdentities: number;
  readonly after?: AppRelationEdgeIncomingFrontier;
  /** Test-only receipt of the exact compiled physical page statement. */
  readonly observeQuery?: (query: AppRelationEdgeQueryObservation) => void;
}

/** Private writer-side anti-existence input used by C09 `restrict`. */
export interface HasIncomingAppRelationEdgeInput {
  readonly scopeId: ScopeId;
  readonly definition: AppRelationEdgeDefinitionPin;
  readonly targetRowId: AppRowIdHexV1;
  /** Test-only receipt of the exact compiled existence statement. */
  readonly observeQuery?: (query: AppRelationEdgeQueryObservation) => void;
}

export interface AppRelationEdgeQueryObservation {
  readonly name: "hasIncoming" | "readIncomingPage";
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
}

export interface AppRelationEdgeIncomingPageItem {
  readonly sourceRowId: AppRowIdHexV1;
  readonly duplicateOrdinal: 0;
  readonly position: AppRelationEdgePosition;
  readonly commitSeq: CommitSeq;
}

export interface ReadIncomingAppRelationEdgePageResult {
  readonly items: ReadonlyArray<AppRelationEdgeIncomingPageItem>;
  readonly versionBefore: CommitSeq;
  readonly versionAfter: CommitSeq;
  readonly nextFrontier: AppRelationEdgeIncomingFrontier | null;
  readonly exhausted: boolean;
}

export type AppRelationEdgeInputReason =
  | "invalidScope"
  | "invalidSchemaVersion"
  | "invalidCommitSequence"
  | "commitSequenceAheadOfScopeClock"
  | "invalidDefinition"
  | "invalidOccurrence"
  | "occurrenceDefinitionMismatch"
  | "invalidPosition"
  | "duplicateBatchIdentity"
  | "transactionOccurrenceLimitExceeded"
  | "invalidPageSize"
  | "invalidFrontier";

export class AppRelationEdgeInputError extends Data.TaggedError(
  "AppRelationEdgeInputError",
)<{
  readonly operation: AppRelationEdgeOperation;
  readonly reason: AppRelationEdgeInputReason;
  readonly cause?: unknown;
}> {}

export type AppRelationEdgeConflictReason =
  | "duplicateOccurrence"
  | "missingOccurrence"
  | "staleOccurrence"
  | "staleAdjacencyVersion";

export class AppRelationEdgeConflictError extends Data.TaggedError(
  "AppRelationEdgeConflictError",
)<{
  readonly operation: "applyChanges";
  readonly reason: AppRelationEdgeConflictReason;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
}> {}

export class AppRelationEdgeOccurrenceCollisionError extends Data.TaggedError(
  "AppRelationEdgeOccurrenceCollisionError",
)<{
  readonly operation: "applyChanges";
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
}> {}

export class AppRelationEdgeEvidenceError extends Data.TaggedError(
  "AppRelationEdgeEvidenceError",
)<{
  readonly operation: "applyChanges";
  readonly cause: unknown;
}> {}

export class AppRelationEdgeCorruptionError extends Data.TaggedError(
  "AppRelationEdgeCorruptionError",
)<{
  readonly operation: AppRelationEdgeOperation;
  readonly reason: string;
  readonly cause?: unknown;
}> {}

export type AppRelationEdgeMutationStatementName =
  | "lockScopeClock"
  | "createMutationSavepoint"
  | "rollbackMutationSavepoint"
  | "releaseMutationSavepoint"
  | "readCurrentBatch"
  | "readAffectedVersions"
  | "insertCurrent"
  | "updateCurrent"
  | "deleteCurrent"
  | "advanceAdjacencyVersions";

export interface AppRelationEdgeMutationOptions {
  /** Test-only receipt of each attempted SQL statement owned by the aggregate. */
  readonly observeStatement?: (
    statement: AppRelationEdgeMutationStatementName,
  ) => void;
}

export type AppRelationEdgePersistenceOperation =
  | AppRelationEdgeMutationStatementName
  | "readAdjacencyVersion"
  | "hasIncoming"
  | "readIncomingPage";

export class AppRelationEdgePersistenceError extends Data.TaggedError(
  "AppRelationEdgePersistenceError",
)<{
  readonly operation: AppRelationEdgePersistenceOperation;
  readonly cause: unknown;
}> {}

export type AppRelationEdgeMutationError =
  | AppRelationEdgeInputError
  | AppRelationEdgeConflictError
  | AppRelationEdgeOccurrenceCollisionError
  | AppRelationEdgeEvidenceError
  | AppRelationEdgeCorruptionError
  | AppRelationEdgePersistenceError;

export type AppRelationEdgeReadError =
  | AppRelationEdgeInputError
  | AppRelationEdgeCorruptionError
  | AppRelationEdgePersistenceError;
