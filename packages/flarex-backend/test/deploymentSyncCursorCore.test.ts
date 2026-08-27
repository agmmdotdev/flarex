import type { CommitFeedCommitV1 } from
  "@flarex/persistence-postgres/internal/commit-feed";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  SCOPE_SYNC_CURSOR_FORMAT_V1,
  SCOPE_SYNC_PROTOCOL_VERSION_V1,
  SCOPE_SYNC_WAKE_FORMAT_V1,
  captureScopeSyncCursorV1,
  captureScopeSyncWakeV1,
  type ScopeSyncCursorV1,
  type ScopeSyncWakeV1,
} from "flarex-protocol/internal/scope-sync-v1";
import {
  CommitSeqSchema,
  MAX_PERSISTED_SIGNED_INT64_V1,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
} from "flarex-protocol/storage-authority";

import {
  advanceScopeSyncCursorV1,
  classifyScopeSyncWakeV1,
  resolveScopeSyncEpochAuthorityV1,
} from "../src/deploymentSync";

const scopeUuid = ScopeUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000001",
);
const otherScopeUuid = ScopeUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000002",
);
const epochUuid = ScopeEpochUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000003",
);
const otherEpochUuid = ScopeEpochUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000004",
);

describe("deployment sync cursor core", () => {
  it.each([
    [5n, "duplicate"],
    [6n, "exactNext"],
    [9n, "gap"],
  ] as const)("classifies wake sequence %s as %s without advancing", (
    observedCommitSeq,
    kind,
  ) => {
    const cursor = makeCursor(5n);
    const decision = Result.getOrThrow(classifyScopeSyncWakeV1(
      cursor,
      makeWake(observedCommitSeq),
    ));

    expect(decision.kind).toBe(kind);
    expect(cursor.appliedThroughCommitSeq).toBe(5n);
  });

  it("requires an authority check when a wake observes another epoch", () => {
    const decision = Result.getOrThrow(classifyScopeSyncWakeV1(
      makeCursor(5n),
      makeWake(6n, { epochUuid: otherEpochUuid }),
    ));

    expect(decision).toEqual({
      kind: "epochCheckRequired",
      expectedEpochUuid: epochUuid,
      observedEpochUuid: otherEpochUuid,
    });
  });

  it("treats a mismatched wake as an old-epoch duplicate when authority agrees with the cursor", () => {
    const decision = resolveScopeSyncEpochAuthorityV1(
      epochUuid,
      otherEpochUuid,
      epochUuid,
    );

    expect(decision).toEqual({
      kind: "oldEpochDuplicate",
      cursorEpochUuid: epochUuid,
      observedWakeEpochUuid: otherEpochUuid,
    });
  });

  it("requires reset only when current authority has left the cursor epoch", () => {
    const decision = resolveScopeSyncEpochAuthorityV1(
      epochUuid,
      otherEpochUuid,
      otherEpochUuid,
    );

    expect(decision).toEqual({
      kind: "resetRequired",
      cursorEpochUuid: epochUuid,
      authoritativeEpochUuid: otherEpochUuid,
    });
  });

  it("rejects a wake from another scope", () => {
    const failure = expectFailure(classifyScopeSyncWakeV1(
      makeCursor(5n),
      makeWake(6n, { scopeUuid: otherScopeUuid }),
    ));

    expect(failure).toMatchObject({
      _tag: "ScopeSyncScopeMismatchError",
      operation: "classifyWake",
      expectedScopeUuid: scopeUuid,
      observedScopeUuid: otherScopeUuid,
    });
  });

  it("advances only after an exact contiguous feed commit", () => {
    const cursor = makeCursor(5n);
    const decision = Result.getOrThrow(advanceScopeSyncCursorV1(
      cursor,
      makeCommit(6n),
    ));

    expect(decision.kind).toBe("exactNext");
    if (decision.kind !== "exactNext") {
      throw new Error("Expected an exact-next commit decision.");
    }
    expect(decision.nextCursor).toEqual({
      ...cursor,
      appliedThroughCommitSeq: 6n,
    });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.nextCursor)).toBe(true);
    expect(cursor.appliedThroughCommitSeq).toBe(5n);
  });

  it("accepts an already applied commit as an idempotent no-op", () => {
    const cursor = makeCursor(5n);
    const decision = Result.getOrThrow(advanceScopeSyncCursorV1(
      cursor,
      makeCommit(5n),
    ));

    expect(decision).toMatchObject({
      kind: "duplicate",
      observedCommitSeq: 5n,
    });
    if (decision.kind !== "duplicate") {
      throw new Error("Expected a duplicate commit decision.");
    }
    expect(decision.cursor).toBe(cursor);
    expect(Object.isFrozen(decision)).toBe(true);
  });

  it("classifies the maximum persisted sequence without overflowing", () => {
    const cursor = makeCursor(MAX_PERSISTED_SIGNED_INT64_V1);
    const wakeDecision = Result.getOrThrow(classifyScopeSyncWakeV1(
      cursor,
      makeWake(MAX_PERSISTED_SIGNED_INT64_V1),
    ));
    const advanceDecision = Result.getOrThrow(advanceScopeSyncCursorV1(
      cursor,
      makeCommit(MAX_PERSISTED_SIGNED_INT64_V1),
    ));

    expect(wakeDecision.kind).toBe("duplicate");
    expect(advanceDecision).toMatchObject({
      kind: "duplicate",
      observedCommitSeq: MAX_PERSISTED_SIGNED_INT64_V1,
    });
  });

  it("rejects a commit gap", () => {
    const failure = expectFailure(advanceScopeSyncCursorV1(
      makeCursor(5n),
      makeCommit(7n),
    ));

    expect(failure).toMatchObject({
      _tag: "ScopeSyncCommitGapError",
      operation: "advanceCommit",
      nextRequiredCommitSeq: 6n,
      observedCommitSeq: 7n,
    });
  });

  it("rejects a feed commit from another epoch", () => {
    const failure = expectFailure(advanceScopeSyncCursorV1(
      makeCursor(5n),
      makeCommit(6n, { epochUuid: otherEpochUuid }),
    ));

    expect(failure).toMatchObject({
      _tag: "ScopeSyncEpochMismatchError",
      operation: "advanceCommit",
      expectedEpochUuid: epochUuid,
      observedEpochUuid: otherEpochUuid,
    });
  });

  it("rejects a feed commit from another scope", () => {
    const failure = expectFailure(advanceScopeSyncCursorV1(
      makeCursor(5n),
      makeCommit(6n, { scopeUuid: otherScopeUuid }),
    ));

    expect(failure).toMatchObject({
      _tag: "ScopeSyncScopeMismatchError",
      operation: "advanceCommit",
      expectedScopeUuid: scopeUuid,
      observedScopeUuid: otherScopeUuid,
    });
  });
});

function makeCursor(commitSeq: bigint): ScopeSyncCursorV1 {
  return captureScopeSyncCursorV1({
    format: SCOPE_SYNC_CURSOR_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid,
    epochUuid,
    appliedThroughCommitSeq: CommitSeqSchema.make(commitSeq),
  });
}

function makeWake(
  commitSeq: bigint,
  overrides: Partial<Pick<
    ScopeSyncWakeV1,
    "scopeUuid" | "epochUuid"
  >> = {},
): ScopeSyncWakeV1 {
  return captureScopeSyncWakeV1({
    format: SCOPE_SYNC_WAKE_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid: overrides.scopeUuid ?? scopeUuid,
    epochUuid: overrides.epochUuid ?? epochUuid,
    observedCommitSeq: CommitSeqSchema.make(commitSeq),
  });
}

function makeCommit(
  commitSeq: bigint,
  overrides: Partial<Pick<
    CommitFeedCommitV1,
    "scopeUuid" | "epochUuid"
  >> = {},
): CommitFeedCommitV1 {
  return Object.freeze({
    scopeUuid: overrides.scopeUuid ?? scopeUuid,
    epochUuid: overrides.epochUuid ?? epochUuid,
    commitSeq: CommitSeqSchema.make(commitSeq),
    committedAtMilliseconds: 1_000,
    appRowChanges: Object.freeze([]),
    relationAdjacencyChanges: Object.freeze([]),
  });
}

function expectFailure<A, E>(result: Result.Result<A, E>): E {
  return Result.match(result, {
    onFailure: failure => failure,
    onSuccess: () => {
      throw new Error("Expected Result failure.");
    },
  });
}
