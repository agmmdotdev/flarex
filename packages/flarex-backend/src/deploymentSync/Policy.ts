import type { CommitFeedCommitV1 } from
  "@flarex/persistence-postgres/internal/commit-feed";
import { Result } from "effect";

import {
  captureScopeSyncCursorV1,
  type ScopeSyncCursorV1,
  type ScopeSyncWakeV1,
} from "flarex-protocol/internal/scope-sync-v1";
import {
  CommitSeqSchema,
  type ScopeEpochUuidV1,
} from "flarex-protocol/storage-authority";

import {
  ScopeSyncCommitGapError,
  ScopeSyncEpochMismatchError,
  ScopeSyncScopeMismatchError,
  type ScopeSyncAdvanceCommitDecision,
  type ScopeSyncAdvanceCommitError,
  type ScopeSyncEpochAuthorityDecision,
  type ScopeSyncWakeDecision,
} from "./Model";

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
