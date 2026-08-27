import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import {
  ApplicationActivationSequenceV1Schema,
  ApplicationActiveHeadSha256HexV1Schema,
} from "flarex-protocol/commit-protocol";
import {
  SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
  SCOPE_SYNC_CANONICAL_QUERY_FORMAT_V1,
  SCOPE_SYNC_CURSOR_FORMAT_V1,
  SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
  SCOPE_SYNC_PROTOCOL_VERSION_V1,
  ScopeSyncQueryArgumentsSha256HexV1Schema,
  ScopeSyncQueryGenerationSequenceV1Schema,
  ScopeSyncQueryIdentityAccessPolicySha256HexV1Schema,
  ScopeSyncQueryResultSha256HexV1Schema,
  ScopeSyncQuerySourcePackageSha256HexV1Schema,
  captureScopeSyncActiveHeadObservationV1,
  captureScopeSyncCanonicalQueryIdentityV1,
  captureScopeSyncCursorV1,
  captureScopeSyncDependencyKeyV1,
  type ScopeSyncCanonicalQueryIdentityV1,
  type ScopeSyncCursorV1,
  type ScopeSyncDependencyKeyV1,
  type ScopeSyncProvisionalQueryGenerationV1,
} from "flarex-protocol/internal/scope-sync-v1";
import { CatalogSchemaVersionIdSchema } from
  "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  LegacyV1StorageGenerationSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
  replacementScopeEpochV1FromUuid,
  replacementScopeIdV1FromUuid,
} from "flarex-protocol/storage-authority";

import {
  activateScopeSyncQueryGenerationV1,
  beginScopeSyncQueryGenerationV1,
  type ScopeSyncQueryActivationEvidenceV1,
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
const activationSequence = ApplicationActivationSequenceV1Schema.make(3n);
const activeHeadSha256Hex = ApplicationActiveHeadSha256HexV1Schema.make(
  "11".repeat(32),
);

describe("deployment sync query generation core", () => {
  it("activates one exact generation with owned canonical dependencies", () => {
    const provisional = makeProvisional();
    const first = tableKey(1);
    const second = tableKey(2);
    const source = [second, first, second];
    const decision = Result.getOrThrow(activateScopeSyncQueryGenerationV1(
      provisional,
      makeEvidence({
        dirtyThroughCommitSeq: CommitSeqSchema.make(6n),
        dependencies: source,
      }),
    ));

    source[0] = first;
    expect(decision.kind).toBe("activated");
    if (decision.kind !== "activated") {
      throw new Error("Expected an activated generation.");
    }
    expect(decision.activeGeneration).toMatchObject({
      phase: "active",
      generation: 1n,
      snapshotCommitSeq: 6n,
      dependencies: [first, second],
      resultSha256Hex: "44".repeat(32),
    });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.activeGeneration)).toBe(true);
    expect(Object.isFrozen(decision.activeGeneration.identity)).toBe(true);
    expect(Object.isFrozen(decision.activeGeneration.dependencies)).toBe(true);
    expect(decision.activeGeneration.dependencies).not.toBe(source);
  });

  it("returns rerun when a relevant commit follows the query snapshot", () => {
    const decision = Result.getOrThrow(activateScopeSyncQueryGenerationV1(
      makeProvisional(),
      makeEvidence({ dirtyThroughCommitSeq: CommitSeqSchema.make(7n) }),
    ));

    expect(decision).toMatchObject({
      kind: "rerunRequired",
      generation: 1n,
      snapshotCommitSeq: 6n,
      dirtyThroughCommitSeq: 7n,
    });
    expect(Object.isFrozen(decision)).toBe(true);
  });

  it("returns resnapshot when authenticated active-head authority changed", () => {
    const decision = Result.getOrThrow(activateScopeSyncQueryGenerationV1(
      makeProvisional(),
      makeEvidence({
        currentActiveHead: currentHeadObservation({
          activationSequence: ApplicationActivationSequenceV1Schema.make(4n),
          activeHeadSha256Hex:
            ApplicationActiveHeadSha256HexV1Schema.make("66".repeat(32)),
        }),
      }),
    ));

    expect(decision).toMatchObject({
      kind: "resnapshotRequired",
      generation: 1n,
      expectedActiveHead: {
        activationSequence: 3n,
        activeHeadSha256Hex: "11".repeat(32),
      },
      currentActiveHead: {
        activationSequence: 4n,
        activeHeadSha256Hex: "66".repeat(32),
      },
    });
    expect(Object.isFrozen(decision)).toBe(true);
    if (decision.kind !== "resnapshotRequired") {
      throw new Error("Expected a resnapshot decision.");
    }
    expect(Object.isFrozen(decision.expectedActiveHead)).toBe(true);
    expect(Object.isFrozen(decision.currentActiveHead)).toBe(true);
  });

  it("rejects a stale completion generation", () => {
    const failure = expectFailure(activateScopeSyncQueryGenerationV1(
      makeProvisional(),
      makeEvidence({
        expectedGeneration: ScopeSyncQueryGenerationSequenceV1Schema.make(2n),
      }),
    ));

    expect(failure).toMatchObject({
      _tag: "ScopeSyncQueryGenerationMismatchError",
      expectedGeneration: 1n,
      observedGeneration: 2n,
    });
  });

  it("rejects a receipt produced under another active head", () => {
    const failure = expectFailure(activateScopeSyncQueryGenerationV1(
      makeProvisional(),
      makeEvidence({
        receiptActiveHead: Object.freeze({
          activationSequence,
          activeHeadSha256Hex:
            ApplicationActiveHeadSha256HexV1Schema.make("77".repeat(32)),
        }),
      }),
    ));

    expect(failure).toMatchObject({
      _tag: "ScopeSyncQueryGenerationEvidenceError",
      field: "receiptActiveHeadSha256Hex",
      expected: "11".repeat(32),
      observed: "77".repeat(32),
    });
  });

  it.each([
    ["snapshotScopeId", () => makeEvidence({
      snapshotToken: snapshot(6n, { scopeUuid: otherScopeUuid }),
    })],
    ["snapshotEpoch", () => makeEvidence({
      snapshotToken: snapshot(6n, { epochUuid: otherEpochUuid }),
    })],
    ["snapshotCommitSeq", () => makeEvidence({
      snapshotToken: snapshot(4n),
    })],
    ["refreshScopeUuid", () => makeEvidence({
      refreshedThroughCursor: cursor(7n, { scopeUuid: otherScopeUuid }),
    })],
    ["refreshEpochUuid", () => makeEvidence({
      refreshedThroughCursor: cursor(7n, { epochUuid: otherEpochUuid }),
    })],
    ["refreshCommitSeq", () => makeEvidence({
      refreshedThroughCursor: cursor(5n),
    })],
    ["receiptStorageGeneration", () => makeEvidence({
      receiptStorageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1"),
    })],
    ["receiptStorageGenerationFence", () => makeEvidence({
      receiptStorageGenerationFence: StorageGenerationFenceSchema.make(10n),
    })],
    ["currentHeadScopeUuid", () => makeEvidence({
      currentActiveHead: currentHeadObservation({
        scopeUuid: otherScopeUuid,
      }),
    })],
    ["currentHeadEpochUuid", () => makeEvidence({
      currentActiveHead: currentHeadObservation({
        epochUuid: otherEpochUuid,
      }),
    })],
    ["currentHeadCommitSeq", () => makeEvidence({
      currentActiveHead: currentHeadObservation({
        observedAtCommitSeq: CommitSeqSchema.make(5n),
      }),
    })],
  ] as const)("rejects invalid %s activation evidence", (field, evidence) => {
    const failure = expectFailure(activateScopeSyncQueryGenerationV1(
      makeProvisional(),
      evidence(),
    ));

    expect(failure).toMatchObject({
      _tag: "ScopeSyncQueryGenerationEvidenceError",
      field,
    });
  });

  it("rejects a registration cursor from another scope or epoch", () => {
    for (const registeredAtCursor of [
      cursor(5n, { scopeUuid: otherScopeUuid }),
      cursor(5n, { epochUuid: otherEpochUuid }),
    ]) {
      const failure = expectFailure(beginScopeSyncQueryGenerationV1({
        identity: identity(),
        generation: ScopeSyncQueryGenerationSequenceV1Schema.make(1n),
        registeredAtCursor,
      }));
      expect(failure._tag).toBe("ScopeSyncQueryGenerationEvidenceError");
    }
  });
});

function identity(): ScopeSyncCanonicalQueryIdentityV1 {
  return captureScopeSyncCanonicalQueryIdentityV1({
    format: SCOPE_SYNC_CANONICAL_QUERY_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid,
    epochUuid,
    activationSequence,
    activeHeadSha256Hex,
    sourcePackageSha256Hex:
      ScopeSyncQuerySourcePackageSha256HexV1Schema.make("22".repeat(32)),
    schemaVersionId: CatalogSchemaVersionIdSchema.make("schema_users_v1"),
    policyVersion: "policy_query_v1",
    componentPath: null,
    functionPath: "users:list",
    argumentsSha256Hex:
      ScopeSyncQueryArgumentsSha256HexV1Schema.make("33".repeat(32)),
    identityAccessPolicySha256Hex:
      ScopeSyncQueryIdentityAccessPolicySha256HexV1Schema.make(
        "55".repeat(32),
      ),
  });
}

function makeProvisional(): ScopeSyncProvisionalQueryGenerationV1 {
  return Result.getOrThrow(beginScopeSyncQueryGenerationV1({
    identity: identity(),
    generation: ScopeSyncQueryGenerationSequenceV1Schema.make(1n),
    registeredAtCursor: cursor(5n),
  }));
}

function makeEvidence(
  overrides: Partial<ScopeSyncQueryActivationEvidenceV1> = {},
): ScopeSyncQueryActivationEvidenceV1 {
  const activeHead = Object.freeze({
    activationSequence,
    activeHeadSha256Hex,
  });
  return Object.freeze({
    expectedGeneration: ScopeSyncQueryGenerationSequenceV1Schema.make(1n),
    snapshotToken: snapshot(6n),
    receiptActiveHead: activeHead,
    receiptStorageGeneration: FlarexDbV1StorageGenerationSchema.make(
      "flarexdb_v1",
    ),
    receiptStorageGenerationFence: StorageGenerationFenceSchema.make(9n),
    currentActiveHead: currentHeadObservation(),
    refreshedThroughCursor: cursor(7n),
    dirtyThroughCommitSeq: null,
    dependencies: Object.freeze([tableKey(1)]),
    resultSha256Hex:
      ScopeSyncQueryResultSha256HexV1Schema.make("44".repeat(32)),
    ...overrides,
  });
}

function currentHeadObservation(
  overrides: Partial<ScopeSyncQueryActivationEvidenceV1["currentActiveHead"]> =
    {},
): ScopeSyncQueryActivationEvidenceV1["currentActiveHead"] {
  return captureScopeSyncActiveHeadObservationV1({
    format: SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid,
    epochUuid,
    storageGeneration: FlarexDbV1StorageGenerationSchema.make(
      "flarexdb_v1",
    ),
    storageGenerationFence: StorageGenerationFenceSchema.make(9n),
    observedAtCommitSeq: CommitSeqSchema.make(7n),
    activationSequence,
    activeHeadSha256Hex,
    ...overrides,
  });
}

function snapshot(
  commitSeq: bigint,
  overrides: Readonly<{
    scopeUuid?: typeof scopeUuid;
    epochUuid?: typeof epochUuid;
  }> = {},
) {
  return SnapshotTokenSchema.make({
    scopeId: replacementScopeIdV1FromUuid(
      overrides.scopeUuid ?? scopeUuid,
    ),
    epoch: replacementScopeEpochV1FromUuid(
      overrides.epochUuid ?? epochUuid,
    ),
    commitSeq: CommitSeqSchema.make(commitSeq),
  });
}

function cursor(
  commitSeq: bigint,
  overrides: Readonly<{
    scopeUuid?: typeof scopeUuid;
    epochUuid?: typeof epochUuid;
  }> = {},
): ScopeSyncCursorV1 {
  return captureScopeSyncCursorV1({
    format: SCOPE_SYNC_CURSOR_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid: overrides.scopeUuid ?? scopeUuid,
    epochUuid: overrides.epochUuid ?? epochUuid,
    appliedThroughCommitSeq: CommitSeqSchema.make(commitSeq),
  });
}

function tableKey(tableId: number): ScopeSyncDependencyKeyV1 {
  return captureScopeSyncDependencyKeyV1({
    format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    kind: "appTable",
    tableId: CatalogTableIdSchema.make(tableId),
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
