import type { CommitFeedCommitV1 } from
  "@flarex/persistence-postgres/internal/commit-feed";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  AppRowIdHexV1Schema,
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1ToBytes,
} from "flarex-protocol/app-document-id";
import {
  CatalogEdgeDefinitionIdSchema,
  CatalogIndexDefinitionIdSchema,
  CatalogTableIdSchema,
} from "flarex-protocol/catalog";
import {
  ApplicationActivationSequenceV1Schema,
  ApplicationActiveHeadSha256HexV1Schema,
  type LogicalReadDependencyV1,
} from "flarex-protocol/commit-protocol";
import { AppIndexPhysicalSpecSha256HexV1Schema } from
  "flarex-protocol/index-definition";
import {
  SCOPE_SYNC_CURSOR_FORMAT_V1,
  SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
  SCOPE_SYNC_PROTOCOL_VERSION_V1,
  SCOPE_SYNC_WAKE_FORMAT_V1,
  captureScopeSyncCursorV1,
  captureScopeSyncWakeV1,
  type ScopeSyncCursorV1,
  type ScopeSyncWakeV1,
} from "flarex-protocol/internal/scope-sync-v1";
import { OrderedIndexKeyCodecVersionSchema } from
  "flarex-protocol/ordered-index";
import {
  CommitSeqSchema,
  MAX_PERSISTED_SIGNED_INT64_V1,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
} from "flarex-protocol/storage-authority";

import {
  advanceScopeSyncCursorV1,
  classifyScopeSyncWakeV1,
  collectScopeSyncCommitInvalidationKeysV1Result,
  resolveScopeSyncEpochAuthorityV1,
  scopeSyncDependencyKeyFromLogicalReadV1,
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
const firstTableId = CatalogTableIdSchema.make(1);
const secondTableId = CatalogTableIdSchema.make(2);
const edgeDefinitionId = CatalogEdgeDefinitionIdSchema.make(7);
const firstRowId = AppRowIdHexV1Schema.make(
  "00000000000040008000000000000001",
);
const secondRowId = AppRowIdHexV1Schema.make(
  "00000000000040008000000000000002",
);
const firstDocumentId = appDocumentIdV1FromRowIdentity({
  tableId: firstTableId,
  rowId: firstRowId,
});
const secondDocumentId = appDocumentIdV1FromRowIdentity({
  tableId: firstTableId,
  rowId: secondRowId,
});

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

  it("projects exact point and relation keys plus a conservative index table key", () => {
    expect(scopeSyncDependencyKeyFromLogicalReadV1(
      pointDependency(),
    )).toEqual({
      format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      kind: "appRowPoint",
      documentId: firstDocumentId,
    });
    expect(scopeSyncDependencyKeyFromLogicalReadV1(
      indexDependency(),
    )).toEqual({
      format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      kind: "appTable",
      tableId: firstTableId,
    });
    const relationKey = scopeSyncDependencyKeyFromLogicalReadV1(
      relationDependency(),
    );
    expect(relationKey).toEqual({
      format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      kind: "appRelationIncoming",
      edgeDefinitionId,
      targetRowId: secondRowId,
    });
    expect(relationKey).not.toHaveProperty("observedAdjacencyVersion");
    expect(relationKey).not.toHaveProperty("activationSequence");
    expect(relationKey).not.toHaveProperty("activeHeadSha256Hex");
    expect(Object.isFrozen(relationKey)).toBe(true);
  });

  it("collects deterministic exact and conservative invalidation keys", () => {
    const commit = makeCommit(6n, {
      appRowChanges: Object.freeze([
        Object.freeze({
          ordinal: 0,
          tableId: firstTableId,
          rowId: appRowIdHexV1ToBytes(secondRowId),
        }),
        Object.freeze({
          ordinal: 1,
          tableId: firstTableId,
          rowId: appRowIdHexV1ToBytes(firstRowId),
        }),
      ]),
      relationAdjacencyChanges: Object.freeze([
        Object.freeze({
          ordinal: 0,
          edgeDefinitionId,
          direction: "outgoing",
          endpointRowId: firstRowId,
        }),
        Object.freeze({
          ordinal: 1,
          edgeDefinitionId,
          direction: "incoming",
          endpointRowId: secondRowId,
        }),
      ]),
    });

    const keys = Result.getOrThrow(
      collectScopeSyncCommitInvalidationKeysV1Result(commit),
    );

    expect(keys).toEqual([
      {
        format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        kind: "appRowPoint",
        documentId: firstDocumentId,
      },
      {
        format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        kind: "appRowPoint",
        documentId: secondDocumentId,
      },
      {
        format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        kind: "appTable",
        tableId: firstTableId,
      },
      {
        format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        kind: "appRelationIncoming",
        edgeDefinitionId,
        targetRowId: secondRowId,
      },
    ]);
    expect(Object.isFrozen(keys)).toBe(true);
    expect(keys.every(Object.isFrozen)).toBe(true);
  });

  it("rejects malformed app-row bytes before producing invalidation keys", () => {
    const failure = expectFailure(
      collectScopeSyncCommitInvalidationKeysV1Result(makeCommit(6n, {
        appRowChanges: Object.freeze([Object.freeze({
          ordinal: 4,
          tableId: secondTableId,
          rowId: new Uint8Array(15),
        })]),
      })),
    );

    expect(failure).toMatchObject({
      _tag: "ScopeSyncInvalidCommitChangeError",
      operation: "collectInvalidationKeys",
      changeKind: "appRow",
      changeOrdinal: 4,
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
    | "scopeUuid"
    | "epochUuid"
    | "appRowChanges"
    | "relationAdjacencyChanges"
  >> = {},
): CommitFeedCommitV1 {
  return Object.freeze({
    scopeUuid: overrides.scopeUuid ?? scopeUuid,
    epochUuid: overrides.epochUuid ?? epochUuid,
    commitSeq: CommitSeqSchema.make(commitSeq),
    committedAtMilliseconds: 1_000,
    appRowChanges: overrides.appRowChanges ?? Object.freeze([]),
    relationAdjacencyChanges:
      overrides.relationAdjacencyChanges ?? Object.freeze([]),
  });
}

function pointDependency(): LogicalReadDependencyV1 {
  return Object.freeze({
    kind: "appRowPoint",
    documentId: firstDocumentId,
    observed: Object.freeze({
      kind: "missing",
      basis: Object.freeze({ kind: "noVisibleRevision" }),
    }),
  });
}

function indexDependency(): LogicalReadDependencyV1 {
  return Object.freeze({
    kind: "appIndexRange",
    tableId: firstTableId,
    indexDefinitionId: CatalogIndexDefinitionIdSchema.make(5),
    keyCodecVersion: OrderedIndexKeyCodecVersionSchema.make(1),
    physicalSpecSha256Hex: AppIndexPhysicalSpecSha256HexV1Schema.make(
      "ab".repeat(32),
    ),
    direction: "asc",
    lower: null,
    upper: null,
  });
}

function relationDependency(): LogicalReadDependencyV1 {
  return Object.freeze({
    kind: "appRelationIncoming",
    edgeDefinitionId,
    targetRowId: secondRowId,
    observedAdjacencyVersion: CommitSeqSchema.make(5n),
    activationSequence: ApplicationActivationSequenceV1Schema.make(3n),
    activeHeadSha256Hex: ApplicationActiveHeadSha256HexV1Schema.make(
      "cd".repeat(32),
    ),
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
