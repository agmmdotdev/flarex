import { Data } from "effect";

import type { AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { MAX_RELATION_MANY_ITEMS_V1 } from
  "flarex-protocol/internal/relation-declaration-v1";
import type {
  CommitSeq,
  ScopeEpochUuidV1,
  ScopeId,
} from "flarex-protocol/storage-authority";

import type {
  AppRelationEdgeAdjacencyDirection,
  AppRelationEdgeDefinitionPin,
  AppRelationEdgeStorageAction,
} from "./Model";
import type { StoredAppRelationEdge } from "./RowCodec";

export const APP_RELATION_EDGE_BUILD_STORAGE_PAGE_SIZE = 128;
export const APP_RELATION_EDGE_BUILD_MAXIMUM_SOURCE_OCCURRENCES =
  MAX_RELATION_MANY_ITEMS_V1;
export const APP_RELATION_EDGE_BUILD_MAXIMUM_VERSION_ENDPOINTS =
  APP_RELATION_EDGE_BUILD_STORAGE_PAGE_SIZE * 2;
export const APP_RELATION_EDGE_BUILD_MAXIMUM_PRESENCE_ENDPOINTS =
  APP_RELATION_EDGE_BUILD_STORAGE_PAGE_SIZE;

export interface CleanAppRelationEdgeDefinitionPageInput {
  readonly scopeId: ScopeId;
  readonly definition: AppRelationEdgeDefinitionPin;
}

export interface CleanAppRelationEdgeDefinitionPageResult {
  readonly deletedEdges: number;
  readonly deletedVersions: number;
  readonly exhausted: boolean;
}

export interface ReadAppRelationEdgeBuildSourceInput {
  readonly scopeId: ScopeId;
  readonly definition: AppRelationEdgeDefinitionPin;
  readonly sourceRowId: AppRowIdHexV1;
}

export interface AppRelationEdgeBuildFrontier {
  readonly sourceRowId: AppRowIdHexV1;
  readonly targetRowId: AppRowIdHexV1;
}

export interface ReadAppRelationEdgeBuildPageInput {
  readonly scopeId: ScopeId;
  readonly definition: AppRelationEdgeDefinitionPin;
  readonly after: AppRelationEdgeBuildFrontier | null;
}

export interface ReadAppRelationEdgeBuildPageResult {
  readonly edges: ReadonlyArray<StoredAppRelationEdge>;
  readonly nextFrontier: AppRelationEdgeBuildFrontier | null;
  readonly exhausted: boolean;
}

export interface AppRelationEdgeBuildEndpoint {
  readonly direction: AppRelationEdgeAdjacencyDirection;
  readonly endpointRowId: AppRowIdHexV1;
}

export interface AppRelationEdgeBuildVersionFrontier
  extends AppRelationEdgeBuildEndpoint {}

export interface StoredAppRelationEdgeBuildVersion
  extends AppRelationEdgeBuildVersionFrontier {
  readonly lastChangedCommitSeq: CommitSeq;
}

export interface ReadAppRelationEdgeBuildVersionPageInput {
  readonly scopeId: ScopeId;
  readonly definition: AppRelationEdgeDefinitionPin;
  readonly after: AppRelationEdgeBuildVersionFrontier | null;
}

export interface ReadAppRelationEdgeBuildVersionPageResult {
  readonly versions: ReadonlyArray<StoredAppRelationEdgeBuildVersion>;
  readonly nextFrontier: AppRelationEdgeBuildVersionFrontier | null;
  readonly exhausted: boolean;
}

export interface ReadAppRelationEdgeBuildEndpointVersionsInput {
  readonly scopeId: ScopeId;
  readonly definition: AppRelationEdgeDefinitionPin;
  readonly endpoints: ReadonlyArray<AppRelationEdgeBuildEndpoint>;
}

export type ReadAppRelationEdgeBuildEndpointVersionsResult =
  ReadonlyArray<StoredAppRelationEdgeBuildVersion>;

export interface ReadAppRelationEdgeBuildEndpointPresenceInput {
  readonly scopeId: ScopeId;
  readonly definition: AppRelationEdgeDefinitionPin;
  readonly endpoints: ReadonlyArray<AppRelationEdgeBuildEndpoint>;
}

export type ReadAppRelationEdgeBuildEndpointPresenceResult =
  ReadonlyArray<boolean>;

export interface VerifyAppRelationEdgeBuildRowInput {
  readonly stored: StoredAppRelationEdge;
  readonly expected: Extract<AppRelationEdgeStorageAction, { readonly kind: "put" }>;
  readonly frontierCommitSeq: CommitSeq;
  readonly writeEpochUuid: ScopeEpochUuidV1;
}

export interface VerifyAppRelationEdgeCurrentRowInput {
  readonly stored: StoredAppRelationEdge;
  readonly expected: Extract<AppRelationEdgeStorageAction, { readonly kind: "put" }>;
  readonly rootFrontierCommitSeq: CommitSeq;
  readonly currentFrontierCommitSeq: CommitSeq;
  readonly writeEpochUuid: ScopeEpochUuidV1;
}

export interface HasAppRelationEdgeBuildEndpointInput {
  readonly scopeId: ScopeId;
  readonly definition: AppRelationEdgeDefinitionPin;
  readonly direction: AppRelationEdgeAdjacencyDirection;
  readonly endpointRowId: AppRowIdHexV1;
}

export class AppRelationEdgeBuildInputError extends Data.TaggedError(
  "AppRelationEdgeBuildInputError",
)<{
  readonly operation:
    | "cleanDefinition"
    | "readSource"
    | "readEdges"
    | "readVersions"
    | "readEndpointVersions"
    | "readEndpointPresence"
    | "validateEdge"
    | "hasEndpoint";
  readonly reason:
    | "invalidScope"
    | "invalidDefinition"
    | "invalidFrontier"
    | "invalidEndpoint"
    | "tooManyEndpoints"
    | "duplicateEndpoint";
  readonly cause?: unknown;
}> {}

export class AppRelationEdgeBuildCorruptionError extends Data.TaggedError(
  "AppRelationEdgeBuildCorruptionError",
)<{
  readonly operation:
    | "cleanDefinition"
    | "readSource"
    | "readEdges"
    | "readVersions"
    | "readEndpointVersions"
    | "readEndpointPresence"
    | "validateEdge";
  readonly reason:
    | "bounded cleanup did not delete its exact selected keys"
    | "one source exceeds the admitted occurrence maximum"
    | "stored adjacency direction is invalid"
    | "stored adjacency endpoint identity is invalid"
    | "stored adjacency version is invalid"
    | "endpoint version query result is invalid"
    | "endpoint presence query result is invalid"
    | "stored edge does not equal its exact expected build evidence"
    | "stored edge row is invalid"
    | "expected relation occurrence is invalid";
  readonly cause?: unknown;
}> {}

export class AppRelationEdgeBuildEvidenceError extends Data.TaggedError(
  "AppRelationEdgeBuildEvidenceError",
)<{
  readonly operation: "validateEdge";
  readonly cause: unknown;
}> {}

export class AppRelationEdgeBuildPersistenceError extends Data.TaggedError(
  "AppRelationEdgeBuildPersistenceError",
)<{
  readonly operation:
    | "selectCleanupEdges"
    | "deleteCleanupEdges"
    | "selectCleanupVersions"
    | "deleteCleanupVersions"
    | "readSource"
    | "readEdges"
    | "readVersions"
    | "readEndpointVersions"
    | "readEndpointPresence"
    | "hasEndpoint";
  readonly cause: unknown;
}> {}

export type AppRelationEdgeBuildError =
  | AppRelationEdgeBuildInputError
  | AppRelationEdgeBuildCorruptionError
  | AppRelationEdgeBuildEvidenceError
  | AppRelationEdgeBuildPersistenceError;
