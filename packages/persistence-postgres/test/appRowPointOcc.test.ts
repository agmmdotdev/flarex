import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import {
  CommitSeqSchema,
  MAX_PERSISTED_SIGNED_INT64_V1,
  ScopeEpochSchema,
  ScopeIdSchema,
  SnapshotTokenSchema,
  type CommitSeq,
  type ScopeId,
  type SnapshotToken,
} from "flarex-protocol/storage-authority";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  AppRowIdentityV1,
  AppRowPointDependencyV1,
  MissingAppRowPointDependencyV1,
  PresentAppRowPointDependencyV1,
} from "../src/appRows";
import {
  validateAppRowPointOccV1,
  type AppRowPointHeadObservationV1,
  type AppRowPointOccValidationV1,
} from "../src/appRowPointOcc";

const scopeId = ScopeIdSchema.make(
  "scope_61000000-0000-0000-0000-000000000001",
);
const otherScopeId = ScopeIdSchema.make(
  "scope_61000000-0000-0000-0000-000000000002",
);
const epoch = ScopeEpochSchema.make(
  "epoch_61000000-0000-0000-0000-000000000003",
);
const tableId = decodeCatalogTableId(1);
const otherTableId = decodeCatalogTableId(2);
const rowId = decodeAppRowIdHexV1("61000000000000000000000000000004");
const otherRowId = decodeAppRowIdHexV1(
  "61000000000000000000000000000005",
);
const identity = Object.freeze({ scopeId, tableId, rowId }) satisfies AppRowIdentityV1;

describe("O05 pure app-row point OCC", () => {
  it("accepts exactly matching present, tombstone, and never-visible evidence", () => {
    const cases = [
      {
        snapshotToken: snapshot(10n),
        dependency: present(5n),
        head: live(5n),
      },
      {
        snapshotToken: snapshot(10n),
        dependency: tombstoneMissing(5n),
        head: tombstone(5n),
      },
      {
        snapshotToken: snapshot(0n),
        dependency: neverVisible(),
        head: missing(),
      },
      {
        snapshotToken: snapshot(MAX_PERSISTED_SIGNED_INT64_V1),
        dependency: present(MAX_PERSISTED_SIGNED_INT64_V1),
        head: live(MAX_PERSISTED_SIGNED_INT64_V1),
      },
    ] as const satisfies readonly {
      readonly snapshotToken: SnapshotToken;
      readonly dependency: AppRowPointDependencyV1;
      readonly head: AppRowPointHeadObservationV1;
    }[];

    for (const testCase of cases) {
      const first = validateAppRowPointOccV1(testCase);
      const second = validateAppRowPointOccV1(testCase);
      expect(first).toEqual({ kind: "valid" });
      expect(second).toEqual(first);
      expect(Object.isFrozen(first)).toBe(true);
    }
  });

  it("conflicts on every same-row revision committed after the snapshot", () => {
    const cases = [
      {
        name: "same-value update still advances the revision",
        dependency: present(5n),
        head: live(11n),
      },
      {
        name: "delete after a present read",
        dependency: present(5n),
        head: tombstone(11n),
      },
      {
        name: "insert after a never-visible read",
        dependency: neverVisible(),
        head: live(11n),
      },
      {
        name: "insert then delete still leaves conflicting history",
        dependency: neverVisible(),
        head: tombstone(11n),
      },
      {
        name: "reinsertion after an observed tombstone conflicts",
        dependency: tombstoneMissing(5n),
        head: live(11n),
      },
      {
        name: "delete reinsert delete still conflicts",
        dependency: tombstoneMissing(5n),
        head: tombstone(11n),
      },
      {
        name: "signed bigint edge remains exact",
        snapshotToken: snapshot(MAX_PERSISTED_SIGNED_INT64_V1 - 1n),
        dependency: present(MAX_PERSISTED_SIGNED_INT64_V1 - 2n),
        head: live(MAX_PERSISTED_SIGNED_INT64_V1),
      },
    ] as const satisfies readonly {
      readonly name: string;
      readonly snapshotToken?: SnapshotToken;
      readonly dependency: AppRowPointDependencyV1;
      readonly head: AppRowPointHeadObservationV1;
    }[];

    for (const testCase of cases) {
      const result = validateAppRowPointOccV1({
        snapshotToken:
          "snapshotToken" in testCase
            ? testCase.snapshotToken
            : snapshot(10n),
        dependency: testCase.dependency,
        head: testCase.head,
      });
      expect(result.kind, testCase.name).toBe("conflict");
      if (result.kind !== "conflict") continue;
      expect(result.conflict).toMatchObject({
        reason: "revisionAfterSnapshot",
        identity,
        currentState: {
          kind: testCase.head.kind,
          revisionCommitSeq:
            testCase.head.kind === "missing"
              ? undefined
              : testCase.head.revisionCommitSeq,
        },
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.conflict)).toBe(true);
      expect(Object.isFrozen(result.conflict.identity)).toBe(true);
      expect(Object.isFrozen(result.conflict.observedState)).toBe(true);
      expect(Object.isFrozen(result.conflict.currentState)).toBe(true);
    }
  });

  it("fails closed on contradictory history at or below the snapshot", () => {
    const cases = [
      [present(5n), live(6n)],
      [present(5n), live(4n)],
      [present(5n), tombstone(5n)],
      [present(5n), missing()],
      [neverVisible(), live(1n)],
      [neverVisible(), tombstone(10n)],
      [tombstoneMissing(5n), live(5n)],
      [tombstoneMissing(5n), live(6n)],
      [tombstoneMissing(5n), tombstone(4n)],
      [tombstoneMissing(5n), missing()],
    ] as const satisfies readonly (readonly [
      AppRowPointDependencyV1,
      AppRowPointHeadObservationV1,
    ])[];

    for (const [dependency, head] of cases) {
      expect(
        validateAppRowPointOccV1({
          snapshotToken: snapshot(10n),
          dependency,
          head,
        }),
      ).toMatchObject({
        kind: "invalidEvidence",
        issue: { reason: "snapshotEvidenceContradiction" },
      });
    }
  });

  it("rejects impossible dependency and head sequences", () => {
    const cases = [
      {
        dependency: present(0n),
        head: missing(),
        reason: "nonPositiveDependencyRevision",
      },
      {
        dependency: tombstoneMissing(0n),
        head: missing(),
        reason: "nonPositiveDependencyRevision",
      },
      {
        dependency: present(11n),
        head: live(11n),
        reason: "dependencyRevisionAfterSnapshot",
      },
      {
        dependency: tombstoneMissing(11n),
        head: tombstone(11n),
        reason: "dependencyRevisionAfterSnapshot",
      },
      {
        dependency: neverVisible(),
        head: live(0n),
        reason: "nonPositiveHeadRevision",
      },
    ] as const;

    for (const testCase of cases) {
      expect(
        validateAppRowPointOccV1({
          snapshotToken: snapshot(10n),
          dependency: testCase.dependency,
          head: testCase.head,
        }),
      ).toMatchObject({
        kind: "invalidEvidence",
        issue: { reason: testCase.reason },
      });
    }
  });

  it("rejects snapshot scope and exact-head identity mismatches before sequence logic", () => {
    expect(
      validateAppRowPointOccV1({
        snapshotToken: snapshot(10n, otherScopeId),
        dependency: present(5n),
        head: live(5n),
      }),
    ).toMatchObject({
      kind: "invalidEvidence",
      issue: { reason: "snapshotScopeMismatch" },
    });

    for (const mismatchedIdentity of [
      Object.freeze({ ...identity, scopeId: otherScopeId }),
      Object.freeze({ ...identity, tableId: otherTableId }),
      Object.freeze({ ...identity, rowId: otherRowId }),
    ] as const satisfies readonly AppRowIdentityV1[]) {
      const result = validateAppRowPointOccV1({
        snapshotToken: snapshot(10n),
        dependency: present(5n),
        head: live(11n, mismatchedIdentity),
      });
      expect(result).toMatchObject({
        kind: "invalidEvidence",
        issue: { reason: "headIdentityMismatch" },
      });
    }
  });

  it("copies and freezes decisions without freezing or retaining caller objects", () => {
    const callerDependencyIdentity = { scopeId, tableId, rowId };
    const callerHeadIdentity = { scopeId, tableId, rowId };
    const dependency = {
      kind: "present",
      identity: callerDependencyIdentity,
      revisionCommitSeq: seq(5n),
    } satisfies PresentAppRowPointDependencyV1;
    const head = {
      kind: "live",
      identity: callerHeadIdentity,
      revisionCommitSeq: seq(11n),
    } satisfies AppRowPointHeadObservationV1;

    const result = validateAppRowPointOccV1({
      snapshotToken: snapshot(10n),
      dependency,
      head,
    });
    expect(Object.isFrozen(callerDependencyIdentity)).toBe(false);
    expect(Object.isFrozen(callerHeadIdentity)).toBe(false);
    callerDependencyIdentity.tableId = otherTableId;
    callerHeadIdentity.rowId = otherRowId;

    expect(result).toMatchObject({
      kind: "conflict",
      conflict: { identity },
    });
  });

  it("keeps the kernel private and exposes an exhaustive typed result", () => {
    expectTypeOf(validateAppRowPointOccV1).returns.toEqualTypeOf<
      AppRowPointOccValidationV1
    >();
    type ForbiddenRootExport = Extract<
      keyof typeof import("../src"),
      "validateAppRowPointOccV1"
    >;
    const hasNoRootExport: [ForbiddenRootExport] extends [never] ? true : false =
      true;
    expect(hasNoRootExport).toBe(true);
  });
});

function snapshot(
  commitSeq: bigint,
  selectedScopeId: ScopeId = scopeId,
): SnapshotToken {
  return SnapshotTokenSchema.make({
    scopeId: selectedScopeId,
    epoch,
    commitSeq: seq(commitSeq),
  });
}

function present(
  revisionCommitSeq: bigint,
  selectedIdentity: AppRowIdentityV1 = identity,
): PresentAppRowPointDependencyV1 {
  return Object.freeze({
    kind: "present",
    identity: selectedIdentity,
    revisionCommitSeq: seq(revisionCommitSeq),
  });
}

function neverVisible(
  selectedIdentity: AppRowIdentityV1 = identity,
): MissingAppRowPointDependencyV1 {
  return Object.freeze({
    kind: "missing",
    identity: selectedIdentity,
    basis: Object.freeze({ kind: "noVisibleRevision" }),
  });
}

function tombstoneMissing(
  revisionCommitSeq: bigint,
  selectedIdentity: AppRowIdentityV1 = identity,
): MissingAppRowPointDependencyV1 {
  return Object.freeze({
    kind: "missing",
    identity: selectedIdentity,
    basis: Object.freeze({
      kind: "tombstone",
      revisionCommitSeq: seq(revisionCommitSeq),
    }),
  });
}

function missing(
  selectedIdentity: AppRowIdentityV1 = identity,
): AppRowPointHeadObservationV1 {
  return Object.freeze({ kind: "missing", identity: selectedIdentity });
}

function live(
  revisionCommitSeq: bigint,
  selectedIdentity: AppRowIdentityV1 = identity,
): AppRowPointHeadObservationV1 {
  return Object.freeze({
    kind: "live",
    identity: selectedIdentity,
    revisionCommitSeq: seq(revisionCommitSeq),
  });
}

function tombstone(
  revisionCommitSeq: bigint,
  selectedIdentity: AppRowIdentityV1 = identity,
): AppRowPointHeadObservationV1 {
  return Object.freeze({
    kind: "tombstone",
    identity: selectedIdentity,
    revisionCommitSeq: seq(revisionCommitSeq),
  });
}

function seq(value: bigint): CommitSeq {
  return CommitSeqSchema.make(value);
}
