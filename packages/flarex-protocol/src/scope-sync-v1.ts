import { Result, Schema } from "effect";

import {
  AppDocumentIdV1Schema,
  AppRowIdHexV1Schema,
} from "./app-document-id";
import {
  CatalogEdgeDefinitionIdSchema,
  CatalogTableIdSchema,
} from "./catalog";
import {
  CommitSeqSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
} from "./storage-authority";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strict-schema-options";

export const SCOPE_SYNC_CURSOR_FORMAT_V1 = "flarex.scope-sync-cursor";
export const SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1 =
  "flarex.scope-sync-dependency-key";
export const SCOPE_SYNC_WAKE_FORMAT_V1 = "flarex.scope-sync-wake";
export const SCOPE_SYNC_PROTOCOL_VERSION_V1 = 1;

export const ScopeSyncCursorV1Schema = Schema.Struct({
  format: Schema.Literal(SCOPE_SYNC_CURSOR_FORMAT_V1),
  version: Schema.Literal(SCOPE_SYNC_PROTOCOL_VERSION_V1),
  scopeUuid: ScopeUuidV1Schema,
  epochUuid: ScopeEpochUuidV1Schema,
  appliedThroughCommitSeq: CommitSeqSchema,
}).annotate(StrictStructOptions);
export type ScopeSyncCursorV1 = typeof ScopeSyncCursorV1Schema.Type;

export const ScopeSyncWakeV1Schema = Schema.Struct({
  format: Schema.Literal(SCOPE_SYNC_WAKE_FORMAT_V1),
  version: Schema.Literal(SCOPE_SYNC_PROTOCOL_VERSION_V1),
  scopeUuid: ScopeUuidV1Schema,
  epochUuid: ScopeEpochUuidV1Schema,
  observedCommitSeq: CommitSeqSchema,
}).annotate(StrictStructOptions);
export type ScopeSyncWakeV1 = typeof ScopeSyncWakeV1Schema.Type;

const ScopeSyncAppRowPointDependencyKeyV1Schema = Schema.Struct({
  format: Schema.Literal(SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1),
  version: Schema.Literal(SCOPE_SYNC_PROTOCOL_VERSION_V1),
  kind: Schema.Literal("appRowPoint"),
  documentId: AppDocumentIdV1Schema,
}).annotate(StrictStructOptions);

const ScopeSyncAppTableDependencyKeyV1Schema = Schema.Struct({
  format: Schema.Literal(SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1),
  version: Schema.Literal(SCOPE_SYNC_PROTOCOL_VERSION_V1),
  kind: Schema.Literal("appTable"),
  tableId: CatalogTableIdSchema,
}).annotate(StrictStructOptions);

const ScopeSyncApplicationRelationIncomingDependencyKeyV1Schema =
  Schema.Struct({
    format: Schema.Literal(SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1),
    version: Schema.Literal(SCOPE_SYNC_PROTOCOL_VERSION_V1),
    kind: Schema.Literal("appRelationIncoming"),
    edgeDefinitionId: CatalogEdgeDefinitionIdSchema,
    targetRowId: AppRowIdHexV1Schema,
  }).annotate(StrictStructOptions);

export const ScopeSyncDependencyKeyV1Schema = Schema.Union([
  ScopeSyncAppRowPointDependencyKeyV1Schema,
  ScopeSyncAppTableDependencyKeyV1Schema,
  ScopeSyncApplicationRelationIncomingDependencyKeyV1Schema,
]);
export type ScopeSyncDependencyKeyV1 =
  typeof ScopeSyncDependencyKeyV1Schema.Type;

const decodeCursorResult = Schema.decodeUnknownResult(
  ScopeSyncCursorV1Schema,
  StrictParseOptions,
);
const decodeWakeResult = Schema.decodeUnknownResult(
  ScopeSyncWakeV1Schema,
  StrictParseOptions,
);
const decodeDependencyKeyResult = Schema.decodeUnknownResult(
  ScopeSyncDependencyKeyV1Schema,
  StrictParseOptions,
);

export function decodeScopeSyncCursorV1Result(
  input: unknown,
): Result.Result<ScopeSyncCursorV1, Schema.SchemaError> {
  return decodeCursorResult(input).pipe(Result.map(captureScopeSyncCursorV1));
}

export function decodeScopeSyncWakeV1Result(
  input: unknown,
): Result.Result<ScopeSyncWakeV1, Schema.SchemaError> {
  return decodeWakeResult(input).pipe(Result.map(captureScopeSyncWakeV1));
}

export function decodeScopeSyncDependencyKeyV1Result(
  input: unknown,
): Result.Result<ScopeSyncDependencyKeyV1, Schema.SchemaError> {
  return decodeDependencyKeyResult(input).pipe(
    Result.map(captureScopeSyncDependencyKeyV1),
  );
}

export function captureScopeSyncCursorV1(
  input: ScopeSyncCursorV1,
): ScopeSyncCursorV1 {
  return Object.freeze({
    format: SCOPE_SYNC_CURSOR_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid: input.scopeUuid,
    epochUuid: input.epochUuid,
    appliedThroughCommitSeq: input.appliedThroughCommitSeq,
  });
}

export function captureScopeSyncWakeV1(
  input: ScopeSyncWakeV1,
): ScopeSyncWakeV1 {
  return Object.freeze({
    format: SCOPE_SYNC_WAKE_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid: input.scopeUuid,
    epochUuid: input.epochUuid,
    observedCommitSeq: input.observedCommitSeq,
  });
}

export function captureScopeSyncDependencyKeyV1(
  input: ScopeSyncDependencyKeyV1,
): ScopeSyncDependencyKeyV1 {
  switch (input.kind) {
    case "appRowPoint":
      return Object.freeze({
        format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        kind: input.kind,
        documentId: input.documentId,
      });
    case "appTable":
      return Object.freeze({
        format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        kind: input.kind,
        tableId: input.tableId,
      });
    case "appRelationIncoming":
      return Object.freeze({
        format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        kind: input.kind,
        edgeDefinitionId: input.edgeDefinitionId,
        targetRowId: input.targetRowId,
      });
  }
}
