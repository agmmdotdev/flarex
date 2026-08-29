import type { CommitFeedCommitV1 } from
  "@flarex/persistence-postgres/internal/commit-feed";
import { Result } from "effect";

import type { LogicalReadDependencyV1 } from
  "flarex-protocol/commit-protocol";
import {
  SCOPE_SYNC_QUERY_GENERATION_FORMAT_V1,
  SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
  SCOPE_SYNC_PROTOCOL_VERSION_V1,
  captureScopeSyncQueryGenerationV1,
  captureScopeSyncDependencyKeyV1,
  captureScopeSyncCursorV1,
  normalizeScopeSyncDependencyKeySetV1Result,
  type ScopeSyncCursorV1,
  type ScopeSyncDependencyKeyV1,
  type ScopeSyncProvisionalQueryGenerationV1,
  type ScopeSyncWakeV1,
} from "flarex-protocol/internal/scope-sync-v1";
import {
  CommitSeqSchema,
  replacementScopeEpochV1FromUuid,
  replacementScopeIdV1FromUuid,
  type ScopeEpochUuidV1,
} from "flarex-protocol/storage-authority";

import {
  ScopeSyncCommitGapError,
  ScopeSyncEpochMismatchError,
  ScopeSyncInvalidCommitChangeError,
  ScopeSyncQueryGenerationEvidenceError,
  ScopeSyncQueryGenerationMismatchError,
  ScopeSyncScopeMismatchError,
  type ScopeSyncActivateQueryGenerationError,
  type ScopeSyncAdvanceCommitDecision,
  type ScopeSyncAdvanceCommitError,
  type ScopeSyncBeginQueryGenerationError,
  type ScopeSyncBeginQueryGenerationV1Input,
  type ScopeSyncEpochAuthorityDecision,
  type ScopeSyncQueryActivationDecision,
  type ScopeSyncQueryActivationEvidenceV1,
  type ScopeSyncWakeDecision,
} from "./Model";
import { collectScopeSyncCommitInvalidationProjectionV1Result } from
  "./QuerySyncModel";

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
  return collectScopeSyncCommitInvalidationProjectionV1Result(commit).pipe(
    Result.map(projected => Object.freeze(
      projected.dependencies.map(evidence => evidence.dependencyKey),
    )),
  );
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

export function beginScopeSyncQueryGenerationV1(
  input: ScopeSyncBeginQueryGenerationV1Input,
): Result.Result<
  ScopeSyncProvisionalQueryGenerationV1,
  ScopeSyncBeginQueryGenerationError
> {
  if (input.registeredAtCursor.scopeUuid !== input.identity.scopeUuid) {
    return queryGenerationEvidenceFailure(
      "beginQueryGeneration",
      "registrationScopeUuid",
      input.identity.scopeUuid,
      input.registeredAtCursor.scopeUuid,
    );
  }
  if (input.registeredAtCursor.epochUuid !== input.identity.epochUuid) {
    return queryGenerationEvidenceFailure(
      "beginQueryGeneration",
      "registrationEpochUuid",
      input.identity.epochUuid,
      input.registeredAtCursor.epochUuid,
    );
  }
  return Result.succeed(captureScopeSyncQueryGenerationV1({
    format: SCOPE_SYNC_QUERY_GENERATION_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    phase: "provisional",
    identity: input.identity,
    generation: input.generation,
    registeredAtCursor: input.registeredAtCursor,
  }));
}

export function activateScopeSyncQueryGenerationV1(
  provisional: ScopeSyncProvisionalQueryGenerationV1,
  evidence: ScopeSyncQueryActivationEvidenceV1,
): Result.Result<
  ScopeSyncQueryActivationDecision,
  ScopeSyncActivateQueryGenerationError
> {
  if (evidence.expectedGeneration !== provisional.generation) {
    return Result.fail(new ScopeSyncQueryGenerationMismatchError({
      expectedGeneration: provisional.generation,
      observedGeneration: evidence.expectedGeneration,
    }));
  }
  return Result.gen(function* () {
    const identity = provisional.identity;
    yield* requireQueryGenerationEvidence(
      provisional.registeredAtCursor.scopeUuid === identity.scopeUuid,
      "registrationScopeUuid",
      identity.scopeUuid,
      provisional.registeredAtCursor.scopeUuid,
    );
    yield* requireQueryGenerationEvidence(
      provisional.registeredAtCursor.epochUuid === identity.epochUuid,
      "registrationEpochUuid",
      identity.epochUuid,
      provisional.registeredAtCursor.epochUuid,
    );

    const expectedScopeId = replacementScopeIdV1FromUuid(identity.scopeUuid);
    const expectedEpoch = replacementScopeEpochV1FromUuid(identity.epochUuid);
    yield* requireQueryGenerationEvidence(
      evidence.snapshotToken.scopeId === expectedScopeId,
      "snapshotScopeId",
      expectedScopeId,
      evidence.snapshotToken.scopeId,
    );
    yield* requireQueryGenerationEvidence(
      evidence.snapshotToken.epoch === expectedEpoch,
      "snapshotEpoch",
      expectedEpoch,
      evidence.snapshotToken.epoch,
    );
    yield* requireQueryGenerationEvidence(
      evidence.snapshotToken.commitSeq >=
        provisional.registeredAtCursor.appliedThroughCommitSeq,
      "snapshotCommitSeq",
      `>=${provisional.registeredAtCursor.appliedThroughCommitSeq}`,
      evidence.snapshotToken.commitSeq.toString(),
    );
    yield* requireQueryGenerationEvidence(
      evidence.refreshedThroughCursor.scopeUuid === identity.scopeUuid,
      "refreshScopeUuid",
      identity.scopeUuid,
      evidence.refreshedThroughCursor.scopeUuid,
    );
    yield* requireQueryGenerationEvidence(
      evidence.refreshedThroughCursor.epochUuid === identity.epochUuid,
      "refreshEpochUuid",
      identity.epochUuid,
      evidence.refreshedThroughCursor.epochUuid,
    );
    yield* requireQueryGenerationEvidence(
      evidence.refreshedThroughCursor.appliedThroughCommitSeq >=
        evidence.snapshotToken.commitSeq,
      "refreshCommitSeq",
      `>=${evidence.snapshotToken.commitSeq}`,
      evidence.refreshedThroughCursor.appliedThroughCommitSeq.toString(),
    );
    yield* requireQueryGenerationEvidence(
      evidence.receiptActiveHead.activationSequence ===
        identity.activationSequence,
      "receiptActivationSequence",
      identity.activationSequence.toString(),
      evidence.receiptActiveHead.activationSequence.toString(),
    );
    yield* requireQueryGenerationEvidence(
      evidence.receiptActiveHead.activeHeadSha256Hex ===
        identity.activeHeadSha256Hex,
      "receiptActiveHeadSha256Hex",
      identity.activeHeadSha256Hex,
      evidence.receiptActiveHead.activeHeadSha256Hex,
    );
    yield* requireQueryGenerationEvidence(
      evidence.receiptStorageGeneration ===
        evidence.currentActiveHead.storageGeneration,
      "receiptStorageGeneration",
      evidence.currentActiveHead.storageGeneration,
      evidence.receiptStorageGeneration,
    );
    yield* requireQueryGenerationEvidence(
      evidence.receiptStorageGenerationFence ===
        evidence.currentActiveHead.storageGenerationFence,
      "receiptStorageGenerationFence",
      evidence.currentActiveHead.storageGenerationFence.toString(),
      evidence.receiptStorageGenerationFence.toString(),
    );
    yield* requireQueryGenerationEvidence(
      evidence.currentActiveHead.scopeUuid === identity.scopeUuid,
      "currentHeadScopeUuid",
      identity.scopeUuid,
      evidence.currentActiveHead.scopeUuid,
    );
    yield* requireQueryGenerationEvidence(
      evidence.currentActiveHead.epochUuid === identity.epochUuid,
      "currentHeadEpochUuid",
      identity.epochUuid,
      evidence.currentActiveHead.epochUuid,
    );
    yield* requireQueryGenerationEvidence(
      evidence.currentActiveHead.observedAtCommitSeq >=
        evidence.snapshotToken.commitSeq,
      "currentHeadCommitSeq",
      `>=${evidence.snapshotToken.commitSeq}`,
      evidence.currentActiveHead.observedAtCommitSeq.toString(),
    );

    if (
      evidence.currentActiveHead.activationSequence !==
        identity.activationSequence ||
      evidence.currentActiveHead.activeHeadSha256Hex !==
        identity.activeHeadSha256Hex
    ) {
      return Object.freeze({
        kind: "resnapshotRequired",
        identity,
        generation: provisional.generation,
        expectedActiveHead: Object.freeze({
          activationSequence: identity.activationSequence,
          activeHeadSha256Hex: identity.activeHeadSha256Hex,
        }),
        currentActiveHead: Object.freeze({
          activationSequence:
            evidence.currentActiveHead.activationSequence,
          activeHeadSha256Hex:
            evidence.currentActiveHead.activeHeadSha256Hex,
        }),
      } satisfies ScopeSyncQueryActivationDecision);
    }
    if (
      evidence.dirtyThroughCommitSeq !== null &&
      evidence.dirtyThroughCommitSeq > evidence.snapshotToken.commitSeq
    ) {
      return Object.freeze({
        kind: "rerunRequired",
        identity,
        generation: provisional.generation,
        snapshotCommitSeq: evidence.snapshotToken.commitSeq,
        dirtyThroughCommitSeq: evidence.dirtyThroughCommitSeq,
      } satisfies ScopeSyncQueryActivationDecision);
    }

    const dependencies = yield* normalizeScopeSyncDependencyKeySetV1Result(
      evidence.dependencies,
    );
    const activeGeneration = captureScopeSyncQueryGenerationV1({
      format: SCOPE_SYNC_QUERY_GENERATION_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      phase: "active",
      identity,
      generation: provisional.generation,
      snapshotCommitSeq: evidence.snapshotToken.commitSeq,
      refreshedThroughCursor: evidence.refreshedThroughCursor,
      dependencies,
      resultSha256Hex: evidence.resultSha256Hex,
    });
    return Object.freeze({
      kind: "activated",
      activeGeneration,
    } satisfies ScopeSyncQueryActivationDecision);
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

function requireQueryGenerationEvidence(
  condition: boolean,
  field: ScopeSyncQueryGenerationEvidenceError["field"],
  expected: string,
  observed: string,
): Result.Result<void, ScopeSyncQueryGenerationEvidenceError> {
  return condition
    ? Result.succeed(undefined)
    : queryGenerationEvidenceFailure(
      "activateQueryGeneration",
      field,
      expected,
      observed,
    );
}

function queryGenerationEvidenceFailure(
  operation: ScopeSyncQueryGenerationEvidenceError["operation"],
  field: ScopeSyncQueryGenerationEvidenceError["field"],
  expected: string,
  observed: string,
): Result.Result<never, ScopeSyncQueryGenerationEvidenceError> {
  return Result.fail(new ScopeSyncQueryGenerationEvidenceError({
    operation,
    field,
    expected,
    observed,
  }));
}
