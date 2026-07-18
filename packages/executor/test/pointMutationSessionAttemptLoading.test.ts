import type {
  PointMutationSessionAnchorV1,
  PointMutationSessionAttemptLoadResultV1,
  PointMutationSessionAttemptSelectorV1,
  PointMutationSessionAttemptTerminalizationResultV1,
  PointMutationSessionTerminalLifecycleV1,
  PointMutationSessionTerminalizedLifecycleV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import {
  PointMutationSessionAttemptLoadV1Error,
  PointMutationSessionAttemptTerminalizationV1Error,
} from "@flarex/persistence-postgres/transaction-session-activation";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ReplacementScopeIdV1Schema,
  ScopeEpochSchema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  TransactionRequestKeyV1Schema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import { Effect } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  InvalidLoadedPointMutationSessionAttemptV1Error,
  InvalidPointMutationSessionAttemptSelectorV1Error,
  PointMutationSessionAttemptLoadContractV1Error,
  PointMutationSessionAttemptTerminalizationContractV1Error,
  createPointMutationSessionAttemptLoadingV1,
  createPointMutationSessionAttemptTerminalizationV1,
  inspectLoadedPointMutationSessionAttemptV1,
  type PointMutationSessionAttemptSelectorWireV1,
} from "../src/pointMutationSessionActivation";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

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
const SCHEMA_VERSION_ID = CatalogSchemaVersionIdSchema.make(
  "schema_attempt_loading",
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

type RootAttemptTerminalizationExport = Extract<
  keyof typeof import("../src"),
  "createPointMutationSessionAttemptTerminalizationV1"
>;

describe("O03-B2a point-mutation attempt loading", () => {
  it("keeps the loader private and mints a fresh capability after every load", async () => {
    expectTypeOf<RootAttemptLoadingExport>().toEqualTypeOf<never>();
    let persistenceCalls = 0;
    const loading = createPointMutationSessionAttemptLoadingV1({
      loadEffect: (selector) => Effect.sync(() => {
        persistenceCalls += 1;
        return loadResult(selector);
      }),
    });
    const serialized = JSON.stringify(SELECTOR);
    expect(persistenceCalls).toBe(0);

    const first = await runEffect(loading.load(JSON.parse(serialized)));
    const restartedLoading = createPointMutationSessionAttemptLoadingV1({
      loadEffect: (selector) => Effect.sync(() => {
        persistenceCalls += 1;
        return loadResult(selector);
      }),
    });
    const second = await runEffect(
      restartedLoading.load(JSON.parse(serialized)),
    );

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
      storageGeneration:
        FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: StorageGenerationFenceSchema.make(3n),
      snapshotToken: {
        scopeId: SCOPE_ID,
        epoch: ScopeEpochSchema.make("epoch_attempt_loading"),
        commitSeq: CommitSeqSchema.make(19n),
      },
      schemaVersionId: SCHEMA_VERSION_ID,
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
      loadEffect: (selector) => Effect.sync(() => {
        persistenceCalls += 1;
        return loadResult(selector);
      }),
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
      await expect(runEffect(loading.load(selector))).rejects.toBeInstanceOf(
        InvalidPointMutationSessionAttemptSelectorV1Error,
      );
    }
    expect(persistenceCalls).toBe(0);
  });

  it("rejects malformed persistence authority before minting a capability", async () => {
    const valid = loadResult(typedSelector());
    const invalidResults: readonly unknown[] = [
      {
        ...valid,
        anchor: {
          ...valid.anchor,
          sessionId: "70000000-0000-4000-8000-000000000099",
        },
      },
      {
        ...valid,
        anchor: { ...valid.anchor, storageGeneration: "legacy" },
      },
      {
        ...valid,
        anchor: { ...valid.anchor, storageGenerationFence: -1n },
      },
    ];

    for (const invalidResult of invalidResults) {
      const loading = Reflect.apply(
        createPointMutationSessionAttemptLoadingV1,
        undefined,
        [{ loadEffect: () => Effect.succeed(invalidResult) }],
      );
      await expect(runEffect(loading.load(SELECTOR))).rejects.toBeInstanceOf(
        PointMutationSessionAttemptLoadContractV1Error,
      );
    }
  });

  it("preserves typed persistence failures and does not recover defects", async () => {
    const expectedFailure = new PointMutationSessionAttemptLoadV1Error({
      reason: "sessionMissing",
    });
    const failing = createPointMutationSessionAttemptLoadingV1({
      loadEffect: () => Effect.fail(expectedFailure),
    });
    await expect(runEffect(failing.load(SELECTOR))).rejects.toBe(
      expectedFailure,
    );

    const defect = new Error("attempt-load persistence defect");
    const defective = createPointMutationSessionAttemptLoadingV1({
      loadEffect: () => Effect.die(defect),
    });
    await expect(runEffect(defective.load(SELECTOR))).rejects.toBe(defect);
  });
});

describe("O03-B2b1 point-mutation attempt terminalization", () => {
  it("keeps terminalization private and requires a genuine loaded capability for abort", async () => {
    expectTypeOf<RootAttemptTerminalizationExport>().toEqualTypeOf<never>();
    const loaded = await runEffect(
      createPointMutationSessionAttemptLoadingV1({
        loadEffect: (selector) => Effect.succeed(loadResult(selector)),
      }).load(SELECTOR),
    );
    let abortCalls = 0;
    const terminalization = createPointMutationSessionAttemptTerminalizationV1({
      abortEffect: (input) => Effect.sync(() => {
        abortCalls += 1;
        expect(input.selector).toEqual({
          ...SELECTOR,
          attemptFence: MAX_ATTEMPT_FENCE,
        });
        expect(input.expectedSnapshotToken).toEqual(
          anchor(input.selector).snapshotToken,
        );
        return terminalizationResult(
          input.selector,
          "terminalized",
          "aborted",
        );
      }),
      expireEffect: (selector) => Effect.succeed(
        terminalizationResult(selector, "terminalized", "expired"),
      ),
    });

    await expect(runEffect(terminalization.abort(loaded))).resolves
      .toMatchObject({
        status: "terminalized",
        terminal: { lifecycle: "aborted" },
      });

    for (const invalid of [
      { ...loaded },
      JSON.parse(JSON.stringify(loaded)),
      Object.create(loaded),
      SELECTOR,
    ]) {
      await expect(
        runEffect(
          Reflect.apply(terminalization.abort, terminalization, [invalid]),
        ),
      ).rejects.toBeInstanceOf(
        InvalidLoadedPointMutationSessionAttemptV1Error,
      );
    }
    expect(abortCalls).toBe(1);
  });

  it("expires through the strict restart-safe selector decoder", async () => {
    const observedSelectors: PointMutationSessionAttemptSelectorV1[] = [];
    const terminalization = createPointMutationSessionAttemptTerminalizationV1({
      abortEffect: (input) => Effect.succeed(
        terminalizationResult(input.selector, "terminalized", "aborted"),
      ),
      expireEffect: (selector) => Effect.sync(() => {
        observedSelectors.push(selector);
        return terminalizationResult(selector, "terminalized", "expired");
      }),
    });

    const restarted = createPointMutationSessionAttemptTerminalizationV1({
      abortEffect: (input) => Effect.succeed(
        terminalizationResult(input.selector, "terminalized", "aborted"),
      ),
      expireEffect: (selector) => Effect.sync(() => {
        observedSelectors.push(selector);
        return terminalizationResult(selector, "observed", "expired");
      }),
    });
    await expect(
      runEffect(restarted.expire(JSON.parse(JSON.stringify(SELECTOR)))),
    ).resolves.toMatchObject({
      status: "observed",
      terminal: { lifecycle: "expired" },
    });
    await expect(
      runEffect(terminalization.expire({
        ...SELECTOR,
        snapshotToken: { commitSeq: "19" },
      })),
    ).rejects.toBeInstanceOf(
      InvalidPointMutationSessionAttemptSelectorV1Error,
    );
    await expect(
      runEffect(terminalization.expire({
        ...SELECTOR,
        attemptFence: "01",
      })),
    ).rejects.toBeInstanceOf(
      InvalidPointMutationSessionAttemptSelectorV1Error,
    );
    expect(observedSelectors).toHaveLength(1);
  });

  it("rejects persistence terminal observations outside the exact selector contract", async () => {
    const mismatchedSessionId = TransactionSessionIdV1Schema.make(
      "70000000-0000-4000-8000-000000000099",
    );
    const invalidResults: readonly PointMutationSessionAttemptTerminalizationResultV1[] = [
      {
        ...terminalizationResult(typedSelector(), "observed", "aborted"),
        terminal: {
          ...terminalizationResult(
            typedSelector(),
            "observed",
            "aborted",
          ).terminal,
          sessionId: mismatchedSessionId,
        },
      },
      {
        ...terminalizationResult(
          typedSelector(),
          "observed",
          "expired",
        ),
        terminal: {
          ...terminalizationResult(
            typedSelector(),
            "observed",
            "expired",
          ).terminal,
          terminalizedAt: "not-an-iso-timestamp",
        },
      },
    ];

    for (const result of invalidResults) {
      const terminalization = createPointMutationSessionAttemptTerminalizationV1({
        abortEffect: () => Effect.succeed(result),
        expireEffect: () => Effect.succeed(result),
      });
      await expect(runEffect(terminalization.expire(SELECTOR))).rejects
        .toBeInstanceOf(
          PointMutationSessionAttemptTerminalizationContractV1Error,
        );
    }
  });

  it("rejects impossible and accessor-backed persistence results without executing getters", async () => {
    const committedObservation = terminalizationResult(
      typedSelector(),
      "observed",
      "committed",
    );
    let getterCalls = 0;
    const accessorResult: Record<string, unknown> = {
      status: "observed",
    };
    Object.defineProperty(accessorResult, "terminal", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error("terminal getter must not run");
      },
    });
    const invalidResults = [
      {
        result: {
          ...committedObservation,
          status: "terminalized",
        },
        reason: "invalidStatusOrLifecycle",
      },
      {
        result: {
          ...committedObservation,
          status: "unknown",
        },
        reason: "invalidStatusOrLifecycle",
      },
      {
        result: accessorResult,
        reason: "invalidStatusOrLifecycle",
      },
    ] as const;

    for (const invalid of invalidResults) {
      const terminalization = Reflect.apply(
        createPointMutationSessionAttemptTerminalizationV1,
        undefined,
        [{
          abortEffect: () => Effect.succeed(invalid.result),
          expireEffect: () => Effect.succeed(invalid.result),
        }],
      );
      await expect(runEffect(terminalization.expire(SELECTOR))).rejects
        .toMatchObject({
          issue: { reason: invalid.reason },
        } satisfies Partial<PointMutationSessionAttemptTerminalizationContractV1Error>);
    }
    expect(getterCalls).toBe(0);
  });

  it("preserves typed terminalization failures and does not recover defects", async () => {
    const expectedFailure = new PointMutationSessionAttemptTerminalizationV1Error({
      reason: "attemptStillLive",
      effectiveExpiresAt: "2099-01-01T00:00:00.000Z",
    });
    const failing = createPointMutationSessionAttemptTerminalizationV1({
      abortEffect: () => Effect.fail(expectedFailure),
      expireEffect: () => Effect.fail(expectedFailure),
    });
    await expect(runEffectFailure(failing.expire(SELECTOR))).resolves.toBe(
      expectedFailure,
    );

    const defect = new Error("attempt-terminalization persistence defect");
    const defective = createPointMutationSessionAttemptTerminalizationV1({
      abortEffect: () => Effect.die(defect),
      expireEffect: () => Effect.die(defect),
    });
    await expect(runEffect(defective.expire(SELECTOR))).rejects.toBe(defect);
  });
});

function loadResult(
  selector: PointMutationSessionAttemptSelectorV1,
): PointMutationSessionAttemptLoadResultV1 {
  return Object.freeze({
    status: "loaded",
    anchor: anchor(selector),
    executionPin: Object.freeze({ schemaVersionId: SCHEMA_VERSION_ID }),
    attemptFacet: Object.freeze({ kind: "nonPristine" }),
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

function typedSelector(): PointMutationSessionAttemptSelectorV1 {
  return Object.freeze({
    deploymentId: DEPLOYMENT_ID,
    scopeId: SCOPE_ID,
    sessionId: SESSION_ID,
    attemptFence: MAX_ATTEMPT_FENCE,
  });
}

function terminalizationResult(
  selector: PointMutationSessionAttemptSelectorV1,
  status: "terminalized",
  lifecycle: PointMutationSessionTerminalizedLifecycleV1,
): Extract<
  PointMutationSessionAttemptTerminalizationResultV1,
  { readonly status: "terminalized" }
>;
function terminalizationResult(
  selector: PointMutationSessionAttemptSelectorV1,
  status: "observed",
  lifecycle: PointMutationSessionTerminalLifecycleV1,
): Extract<
  PointMutationSessionAttemptTerminalizationResultV1,
  { readonly status: "observed" }
>;
function terminalizationResult(
  selector: PointMutationSessionAttemptSelectorV1,
  status: PointMutationSessionAttemptTerminalizationResultV1["status"],
  lifecycle: PointMutationSessionTerminalLifecycleV1,
): PointMutationSessionAttemptTerminalizationResultV1 {
  switch (status) {
    case "terminalized": {
      if (lifecycle === "committed") {
        throw new Error("Committed is not a B2b1 terminalization result.");
      }
      return Object.freeze({
        status: "terminalized",
        terminal: Object.freeze({
          ...selector,
          lifecycle,
          terminalizedAt: "2026-07-15T01:00:00.000Z",
        }),
      });
    }
    case "observed":
      return Object.freeze({
        status: "observed",
        terminal: Object.freeze({
          ...selector,
          lifecycle,
          terminalizedAt: "2026-07-15T01:00:00.000Z",
        }),
      });
  }
}
