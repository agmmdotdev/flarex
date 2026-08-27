import type { CommitFeedCommitV1 } from
  "@flarex/persistence-postgres/internal/commit-feed";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Result } from "effect";

import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1FromBytesResult,
} from "flarex-protocol/app-document-id";
import type { LogicalReadDependencyV1 } from
  "flarex-protocol/commit-protocol";
import {
  SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
  SCOPE_SYNC_PROTOCOL_VERSION_V1,
  captureScopeSyncDependencyKeyV1,
  captureScopeSyncCursorV1,
  type ScopeSyncCursorV1,
  type ScopeSyncDependencyKeyV1,
  type ScopeSyncWakeV1,
} from "flarex-protocol/internal/scope-sync-v1";
import {
  CommitSeqSchema,
  type ScopeEpochUuidV1,
} from "flarex-protocol/storage-authority";

import {
  ScopeSyncCommitGapError,
  ScopeSyncEpochMismatchError,
  ScopeSyncInvalidCommitChangeError,
  ScopeSyncScopeMismatchError,
  type ScopeSyncAdvanceCommitDecision,
  type ScopeSyncAdvanceCommitError,
  type ScopeSyncEpochAuthorityDecision,
  type ScopeSyncWakeDecision,
} from "./Model";

export function scopeSyncDependencyKeyFromLogicalReadV1(
  dependency: LogicalReadDependencyV1,
): ScopeSyncDependencyKeyV1 {
  switch (dependency.kind) {
    case "appRowPoint":
      return captureScopeSyncDependencyKeyV1({
        format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        kind: "appRowPoint",
        documentId: dependency.documentId,
      });
    case "appIndexRange":
      return captureScopeSyncDependencyKeyV1({
        format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        kind: "appTable",
        tableId: dependency.tableId,
      });
    case "appRelationIncoming":
      return captureScopeSyncDependencyKeyV1({
        format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        kind: "appRelationIncoming",
        edgeDefinitionId: dependency.edgeDefinitionId,
        targetRowId: dependency.targetRowId,
      });
  }
}

export function collectScopeSyncCommitInvalidationKeysV1Result(
  commit: CommitFeedCommitV1,
): Result.Result<
  ReadonlyArray<ScopeSyncDependencyKeyV1>,
  ScopeSyncInvalidCommitChangeError
> {
  return Result.gen(function* () {
    const keys: ScopeSyncDependencyKeyV1[] = [];
    for (const change of commit.appRowChanges) {
      const rowId = yield* appRowIdHexV1FromBytesResult(change.rowId).pipe(
        Result.mapError(cause => new ScopeSyncInvalidCommitChangeError({
          operation: "collectInvalidationKeys",
          changeKind: "appRow",
          changeOrdinal: change.ordinal,
          cause,
        })),
      );
      keys.push(
        captureScopeSyncDependencyKeyV1({
          format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
          version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
          kind: "appRowPoint",
          documentId: appDocumentIdV1FromRowIdentity({
            tableId: change.tableId,
            rowId,
          }),
        }),
        captureScopeSyncDependencyKeyV1({
          format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
          version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
          kind: "appTable",
          tableId: change.tableId,
        }),
      );
    }
    for (const change of commit.relationAdjacencyChanges) {
      if (change.direction === "incoming") {
        keys.push(captureScopeSyncDependencyKeyV1({
          format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
          version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
          kind: "appRelationIncoming",
          edgeDefinitionId: change.edgeDefinitionId,
          targetRowId: change.endpointRowId,
        }));
      }
    }
    const ordered = keys.toSorted(compareScopeSyncDependencyKeysV1);
    return Object.freeze(ordered.filter((key, index) =>
      index === 0 ||
      compareScopeSyncDependencyKeysV1(ordered[index - 1]!, key) !== 0
    ));
  });
}

function compareScopeSyncDependencyKeysV1(
  left: ScopeSyncDependencyKeyV1,
  right: ScopeSyncDependencyKeyV1,
): number {
  const kindDifference = dependencyKindRank(left) - dependencyKindRank(right);
  if (kindDifference !== 0) return kindDifference;
  if (left.kind === "appRowPoint" && right.kind === "appRowPoint") {
    return compareUtf16Strings(left.documentId, right.documentId);
  }
  if (left.kind === "appTable" && right.kind === "appTable") {
    return left.tableId - right.tableId;
  }
  if (
    left.kind === "appRelationIncoming" &&
    right.kind === "appRelationIncoming"
  ) {
    return left.edgeDefinitionId - right.edgeDefinitionId ||
      compareUtf16Strings(left.targetRowId, right.targetRowId);
  }
  return 0;
}

function dependencyKindRank(key: ScopeSyncDependencyKeyV1): number {
  switch (key.kind) {
    case "appRowPoint":
      return 0;
    case "appTable":
      return 1;
    case "appRelationIncoming":
      return 2;
  }
}

export function classifyScopeSyncWakeV1(
  cursor: ScopeSyncCursorV1,
  wake: ScopeSyncWakeV1,
): Result.Result<ScopeSyncWakeDecision, ScopeSyncScopeMismatchError> {
  if (wake.scopeUuid !== cursor.scopeUuid) {
    return Result.fail(new ScopeSyncScopeMismatchError({
      operation: "classifyWake",
      expectedScopeUuid: cursor.scopeUuid,
      observedScopeUuid: wake.scopeUuid,
    }));
  }
  if (wake.epochUuid !== cursor.epochUuid) {
    return Result.succeed(Object.freeze({
      kind: "epochCheckRequired",
      expectedEpochUuid: cursor.epochUuid,
      observedEpochUuid: wake.epochUuid,
    }));
  }
  if (wake.observedCommitSeq <= cursor.appliedThroughCommitSeq) {
    return Result.succeed(Object.freeze({
      kind: "duplicate",
      appliedThroughCommitSeq: cursor.appliedThroughCommitSeq,
      observedCommitSeq: wake.observedCommitSeq,
    }));
  }
  const expectedCommitSeq = CommitSeqSchema.make(
    cursor.appliedThroughCommitSeq + 1n,
  );
  if (wake.observedCommitSeq === expectedCommitSeq) {
    return Result.succeed(Object.freeze({
      kind: "exactNext",
      expectedCommitSeq,
    }));
  }
  return Result.succeed(Object.freeze({
    kind: "gap",
    nextRequiredCommitSeq: expectedCommitSeq,
    observedCommitSeq: wake.observedCommitSeq,
  }));
}

export function resolveScopeSyncEpochAuthorityV1(
  cursorEpochUuid: ScopeEpochUuidV1,
  observedWakeEpochUuid: ScopeEpochUuidV1,
  authoritativeEpochUuid: ScopeEpochUuidV1,
): ScopeSyncEpochAuthorityDecision {
  if (authoritativeEpochUuid === cursorEpochUuid) {
    return Object.freeze({
      kind: "oldEpochDuplicate",
      cursorEpochUuid,
      observedWakeEpochUuid,
    });
  }
  return Object.freeze({
    kind: "resetRequired",
    cursorEpochUuid,
    authoritativeEpochUuid,
  });
}

export function advanceScopeSyncCursorV1(
  cursor: ScopeSyncCursorV1,
  commit: CommitFeedCommitV1,
): Result.Result<ScopeSyncAdvanceCommitDecision, ScopeSyncAdvanceCommitError> {
  if (commit.scopeUuid !== cursor.scopeUuid) {
    return Result.fail(new ScopeSyncScopeMismatchError({
      operation: "advanceCommit",
      expectedScopeUuid: cursor.scopeUuid,
      observedScopeUuid: commit.scopeUuid,
    }));
  }
  if (commit.epochUuid !== cursor.epochUuid) {
    return Result.fail(new ScopeSyncEpochMismatchError({
      operation: "advanceCommit",
      expectedEpochUuid: cursor.epochUuid,
      observedEpochUuid: commit.epochUuid,
    }));
  }
  if (commit.commitSeq <= cursor.appliedThroughCommitSeq) {
    return Result.succeed(Object.freeze({
      kind: "duplicate",
      cursor,
      observedCommitSeq: commit.commitSeq,
    }));
  }
  const expectedCommitSeq = CommitSeqSchema.make(
    cursor.appliedThroughCommitSeq + 1n,
  );
  if (commit.commitSeq > expectedCommitSeq) {
    return Result.fail(new ScopeSyncCommitGapError({
      operation: "advanceCommit",
      nextRequiredCommitSeq: expectedCommitSeq,
      observedCommitSeq: commit.commitSeq,
    }));
  }
  return Result.succeed(Object.freeze({
    kind: "exactNext",
    nextCursor: captureScopeSyncCursorV1({
      format: cursor.format,
      version: cursor.version,
      scopeUuid: cursor.scopeUuid,
      epochUuid: cursor.epochUuid,
      appliedThroughCommitSeq: commit.commitSeq,
    }),
  }));
}
