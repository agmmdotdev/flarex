import type {
  PointMutationSessionAnchorV1,
  PointMutationSessionAttemptLoadResultV1,
  PointMutationSessionAttemptSelectorV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ReplacementScopeIdV1Schema,
  ScopeEpochSchema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  TransactionRequestKeyV1Schema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  InvalidLoadedPointMutationSessionAttemptV1Error,
  InvalidPointMutationSessionAttemptSelectorV1Error,
  PointMutationSessionAttemptLoadContractV1Error,
  createPointMutationSessionAttemptLoadingV1,
  inspectLoadedPointMutationSessionAttemptV1,
  type PointMutationSessionAttemptSelectorWireV1,
} from "../src/pointMutationSessionActivation";

const DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment_attempt_loading",
);
const SCOPE_ID = ReplacementScopeIdV1Schema.make(
  "scope_718f22e2-58cc-4b2a-91d8-f3f3401a0874",
);
const SESSION_ID = TransactionSessionIdV1Schema.make(
  "70000000-0000-4000-8000-000000000001",
);
const MAX_ATTEMPT_FENCE = TransactionAttemptFenceSchema.make(
  9_223_372_036_854_775_807n,
);
const SELECTOR = Object.freeze({
  deploymentId: DEPLOYMENT_ID,
  scopeId: SCOPE_ID,
  sessionId: SESSION_ID,
  attemptFence: MAX_ATTEMPT_FENCE.toString(),
} satisfies PointMutationSessionAttemptSelectorWireV1);

type RootAttemptLoadingExport = Extract<
  keyof typeof import("../src"),
  "createPointMutationSessionAttemptLoadingV1"
>;

describe("O03-B2a point-mutation attempt loading", () => {
  it("keeps the loader private and mints a fresh capability after every load", async () => {
    expectTypeOf<RootAttemptLoadingExport>().toEqualTypeOf<never>();
    let persistenceCalls = 0;
    const loading = createPointMutationSessionAttemptLoadingV1({
      load: async (selector) => {
        persistenceCalls += 1;
        return loadResult(selector);
      },
    });
    const serialized = JSON.stringify(SELECTOR);

    const first = await loading.load(JSON.parse(serialized));
    const restartedLoading = createPointMutationSessionAttemptLoadingV1({
      load: async (selector) => {
        persistenceCalls += 1;
        return loadResult(selector);
      },
    });
    const second = await restartedLoading.load(JSON.parse(serialized));

    expect(persistenceCalls).toBe(2);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(JSON.stringify(first)).toBe("{}");
    const inspection = inspectLoadedPointMutationSessionAttemptV1(second);
    expect(Object.isFrozen(inspection)).toBe(true);
    expect(Object.isFrozen(inspection.selector)).toBe(true);
    expect(Object.isFrozen(inspection.snapshotToken)).toBe(true);
    expect(inspection).toEqual({
      selector: {
        deploymentId: DEPLOYMENT_ID,
        scopeId: SCOPE_ID,
        sessionId: SESSION_ID,
        attemptFence: MAX_ATTEMPT_FENCE,
      },
      snapshotToken: {
        scopeId: SCOPE_ID,
        epoch: ScopeEpochSchema.make("epoch_attempt_loading"),
        commitSeq: CommitSeqSchema.make(19n),
      },
    });

    for (const invalid of [
      { ...first },
      JSON.parse(JSON.stringify(first)),
      Object.create(first),
      SELECTOR,
    ]) {
      expect(() => inspectLoadedPointMutationSessionAttemptV1(invalid))
        .toThrow(InvalidLoadedPointMutationSessionAttemptV1Error);
    }
  });

  it("rejects non-canonical or authority-shaped selectors before persistence", async () => {
    let persistenceCalls = 0;
    const loading = createPointMutationSessionAttemptLoadingV1({
      load: async (selector) => {
        persistenceCalls += 1;
        return loadResult(selector);
      },
    });
    const getterSelector = { ...SELECTOR };
    Object.defineProperty(getterSelector, "attemptFence", {
      enumerable: true,
      get: () => {
        throw new Error("selector getter must not run");
      },
    });
    const nonEnumerableSelector = { ...SELECTOR };
    Object.defineProperty(nonEnumerableSelector, "attemptFence", {
      enumerable: false,
      value: SELECTOR.attemptFence,
    });
    const symbolSelector = { ...SELECTOR };
    Object.defineProperty(symbolSelector, Symbol("authority"), {
      enumerable: false,
      value: "hidden",
    });
    const invalidSelectors: readonly unknown[] = [
      null,
      [],
      { ...SELECTOR, attemptFence: 1 },
      { ...SELECTOR, attemptFence: "0" },
      { ...SELECTOR, attemptFence: "01" },
      { ...SELECTOR, attemptFence: "+1" },
      { ...SELECTOR, attemptFence: "-1" },
      { ...SELECTOR, attemptFence: "1.0" },
      { ...SELECTOR, attemptFence: " 1" },
      { ...SELECTOR, attemptFence: "9223372036854775808" },
      { ...SELECTOR, snapshotToken: { commitSeq: "19" } },
      {
        deploymentId: SELECTOR.deploymentId,
        scopeId: SELECTOR.scopeId,
        sessionId: SELECTOR.sessionId,
      },
      getterSelector,
      nonEnumerableSelector,
      symbolSelector,
    ];

    for (const selector of invalidSelectors) {
      await expect(loading.load(selector)).rejects.toBeInstanceOf(
        InvalidPointMutationSessionAttemptSelectorV1Error,
      );
    }
    expect(persistenceCalls).toBe(0);
  });

  it("rejects persistence authority that does not match the decoded selector", async () => {
    const loading = createPointMutationSessionAttemptLoadingV1({
      load: async (selector) => ({
        status: "loaded",
        anchor: {
          ...anchor(selector),
          sessionId: TransactionSessionIdV1Schema.make(
            "70000000-0000-4000-8000-000000000099",
          ),
        },
      }),
    });

    await expect(loading.load(SELECTOR)).rejects.toBeInstanceOf(
      PointMutationSessionAttemptLoadContractV1Error,
    );
  });
});

function loadResult(
  selector: PointMutationSessionAttemptSelectorV1,
): PointMutationSessionAttemptLoadResultV1 {
  return Object.freeze({
    status: "loaded",
    anchor: anchor(selector),
  });
}

function anchor(
  selector: PointMutationSessionAttemptSelectorV1,
): PointMutationSessionAnchorV1 {
  return Object.freeze({
    deploymentId: selector.deploymentId,
    scopeId: selector.scopeId,
    sessionId: selector.sessionId,
    requestKey: TransactionRequestKeyV1Schema.make("request:attempt:loading"),
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(3n),
    attemptFence: selector.attemptFence,
    snapshotToken: SnapshotTokenSchema.make({
      scopeId: selector.scopeId,
      epoch: ScopeEpochSchema.make("epoch_attempt_loading"),
      commitSeq: CommitSeqSchema.make(19n),
    }),
    hardExpiresAt: "2099-01-01T00:00:00.000Z",
    leaseExpiresAt: "2098-12-31T23:59:00.000Z",
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  });
}
