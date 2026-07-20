import type {
  RunSessionJournalPointOperationV1Result,
  SessionJournalPointOperationV1,
} from "@flarex/persistence-postgres/session-journal-store";
import {
  TransactionExecutionClaimFenceV1Schema,
  TransactionExecutionClaimOwnerV1Schema,
} from "@flarex/persistence-postgres/transaction-execution-claim";
import {
  InvalidSessionJournalInputV1Error,
  PinnedPointTableNotFoundV1Error,
  SessionJournalAttemptUnavailableV1Error,
  SessionJournalLeasePromotionV1Error,
  SessionJournalPersistenceV1Error,
} from "@flarex/persistence-postgres/session-journal-store";
import {
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAttemptLoadResultV1,
  type PointMutationSessionAttemptSelectorV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import { Effect, Fiber } from "effect";
import {
  COMMIT_ENVELOPE_FORMAT_V1,
  CommitProtocolV1Error,
  CommitFinalSyscallSequenceV1Schema,
  CommitReadDocumentsV1Schema,
  CommitReadSemanticBytesV1Schema,
  CommitSyscallSequenceV1Schema,
  SESSION_JOURNAL_FORMAT_V1,
  type CanonicalSessionJournalV1,
  type CanonicalSuccessfulResultV1,
  type SessionJournalV1,
  type StoredForSessionAttemptCommitEnvelopeV1,
} from "flarex-protocol/commit-protocol";
import {
  CatalogSchemaVersionIdSchema,
  SchemaManifestAppTableNameSchema,
} from "flarex-protocol/schema-manifest";
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
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  TransactionAttemptFenceSchema,
  TransactionRequestKeyV1Schema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import { FLAREX_VALUE_CODEC_VERSION_V1 } from "flarex-protocol/value";
import { describe, expect, it } from "vitest";

import {
  InvalidPointMutationJournalCapabilityV1Error,
  PointMutationJournalAttemptUnavailableV1Error,
  PointMutationJournalAttemptPinsV1Error,
  PointMutationJournalPersistenceV1Error,
  UnsupportedPointMutationJournalOperationV1Error,
  createPointMutationJournalV1,
  type PointMutationJournalV1,
} from "../src/pointMutationJournal";
import {
  createPointMutationExecutionClaimVaultV1,
  type PointMutationExecutionClaimVaultV1,
  type PointMutationExecutionScopeV1,
} from "../src/pointMutationExecutionClaim";
import {
  createPointMutationSessionAttemptLoadingV1,
  type LoadedPointMutationSessionAttemptV1,
  type PointMutationSessionAttemptSelectorWireV1,
} from "../src/pointMutationSessionActivation";
import {
  runEffect,
  runEffectFailure as runFailure,
} from "./effectTestRuntime";

const DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment_point_journal",
);
const SCOPE_ID = ReplacementScopeIdV1Schema.make(
  "scope_718f22e2-58cc-4b2a-91d8-f3f3401a0874",
);
const SESSION_ID = TransactionSessionIdV1Schema.make(
  "71000000-0000-4000-8000-000000000001",
);
const ATTEMPT_FENCE = TransactionAttemptFenceSchema.make(7n);
const SCHEMA_VERSION_ID = CatalogSchemaVersionIdSchema.make(
  "schema_point_journal",
);
const USERS_TABLE_NAME = SchemaManifestAppTableNameSchema.make("users");
const DOCUMENT_ID = "1:00000000-0000-0000-0000-000000000001";
const SELECTOR = Object.freeze({
  deploymentId: DEPLOYMENT_ID,
  scopeId: SCOPE_ID,
  sessionId: SESSION_ID,
  attemptFence: ATTEMPT_FENCE.toString(),
} satisfies PointMutationSessionAttemptSelectorWireV1);

const EXECUTED_MISSING = Object.freeze({
  kind: "completed",
  delivery: "executed",
  outcome: Object.freeze({ kind: "missing", document: null }),
} satisfies RunSessionJournalPointOperationV1Result);

const REPLAYED_MISSING = Object.freeze({
  kind: "completed",
  delivery: "replayed",
  outcome: Object.freeze({ kind: "missing", document: null }),
} satisfies RunSessionJournalPointOperationV1Result);

const executionClaimsByJournal = new WeakMap<
  PointMutationJournalV1,
  PointMutationExecutionClaimVaultV1
>();

describe("C03 executor point-mutation journal boundary", () => {
  it("rejects unsupported, malformed, accessor, and excess-field operations before persistence", async () => {
    const harness = createHarness();
    const { table } = await openResolvedTable(harness.journal);
    let getterCalls = 0;
    const accessorOperation: Record<string, unknown> = {
      syscallSequence: "1",
      documentId: DOCUMENT_ID,
    };
    Object.defineProperty(accessorOperation, "kind", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "get";
      },
    });
    const symbolOperation = {
      kind: "get",
      syscallSequence: "1",
      documentId: DOCUMENT_ID,
    };
    Object.defineProperty(symbolOperation, Symbol("fallback"), {
      value: "scan",
    });
    const cases = [
      { input: null, reason: "notPlainObject" },
      { input: [], reason: "notPlainObject" },
      {
        input: { kind: "scan", syscallSequence: "1" },
        reason: "invalidKind",
      },
      {
        input: {
          kind: "get",
          syscallSequence: "1",
          documentId: DOCUMENT_ID,
          fallback: "legacy",
        },
        reason: "unexpectedFields",
      },
      { input: symbolOperation, reason: "unexpectedFields" },
      {
        input: {
          kind: "get",
          syscallSequence: "0",
          documentId: DOCUMENT_ID,
        },
        reason: "invalidSequence",
      },
      {
        input: {
          kind: "get",
          syscallSequence: "1",
          documentId: "legacy-id",
        },
        reason: "invalidFieldShape",
      },
      { input: accessorOperation, reason: "invalidFieldShape" },
    ] as const;

    for (const testCase of cases) {
      const failure = await runFailure(
        harness.journal.runPointOperation(table, testCase.input),
      );
      expect(failure).toBeInstanceOf(
        UnsupportedPointMutationJournalOperationV1Error,
      );
      expect(failure).toMatchObject({ reason: testCase.reason });
    }

    expect(getterCalls).toBe(0);
    expect(harness.operations).toEqual([]);
  });

  it("serializes adjacent concurrent sequences across tables for one attempt", async () => {
    const firstDurable = deferred<void>();
    const enteredSequences: bigint[] = [];
    let lastAccepted = 0n;
    const harness = createHarness({
      runPointOperation: async (_table, operation) => {
        enteredSequences.push(operation.syscallSequence);
        if (operation.syscallSequence === 1n) {
          await firstDurable.promise;
        }
        const expectedNext = lastAccepted + 1n;
        if (operation.syscallSequence !== expectedNext) {
          return Object.freeze({
            kind: "sequenceRejected",
            issue: Object.freeze({
              reason: "sequenceGap",
              actual: operation.syscallSequence,
              expectedNext: CommitSyscallSequenceV1Schema.make(expectedNext),
            }),
          });
        }
        lastAccepted = operation.syscallSequence;
        return EXECUTED_MISSING;
      },
    });
    const { attempt, table: firstTable } = await openResolvedTable(
      harness.journal,
    );
    const secondTable = await runEffect(
      harness.journal.resolvePointTable(attempt, "orders"),
    );

    const first = runEffect(harness.journal.runPointOperation(
      firstTable,
      getOperation(1n),
    ));
    await waitFor(() => enteredSequences.length === 1);
    const second = runEffect(harness.journal.runPointOperation(
      secondTable,
      getOperation(2n),
    ));
    await yieldToScheduler();

    expect(enteredSequences).toEqual([1n]);
    firstDurable.resolve();
    await expect(first).resolves.toEqual(EXECUTED_MISSING);
    await expect(second).resolves.toEqual(EXECUTED_MISSING);
    expect(enteredSequences).toEqual([1n, 2n]);
    expect(lastAccepted).toBe(2n);
  });

  it("shares exact-attempt serialization across independently loaded handles", async () => {
    const firstDurable = deferred<void>();
    const enteredSequences: bigint[] = [];
    const harness = createHarness({
      runPointOperation: async (_table, operation) => {
        enteredSequences.push(operation.syscallSequence);
        if (operation.syscallSequence === 1n) {
          await firstDurable.promise;
        }
        return EXECUTED_MISSING;
      },
    });
    const [firstLoaded, secondLoaded] = await Promise.all([
      loadedAttempt(),
      loadedAttempt(),
    ]);
    expect(secondLoaded).not.toBe(firstLoaded);
    expect(harness.samePersistenceJournal).toBe(harness.journal);

    const [firstAttempt, secondAttempt] = await Promise.all([
      runEffect(harness.journal.openAttempt(
        firstLoaded,
        executionScopeForJournal(harness.journal),
      )),
      runEffect(harness.journal.openAttempt(
        secondLoaded,
        executionScopeForJournal(harness.journal),
      )),
    ]);
    const [firstTable, secondTable] = await Promise.all([
      runEffect(harness.journal.resolvePointTable(firstAttempt, "users")),
      runEffect(harness.journal.resolvePointTable(secondAttempt, "users")),
    ]);

    const first = runEffect(harness.journal.runPointOperation(
      firstTable,
      getOperation(1n),
    ));
    await waitFor(() => enteredSequences.length === 1);
    const adjacent = runEffect(harness.journal.runPointOperation(
      secondTable,
      getOperation(2n),
    ));
    await yieldToScheduler();
    await yieldToScheduler();

    expect(enteredSequences).toEqual([1n]);
    firstDurable.resolve();
    await expect(first).resolves.toEqual(EXECUTED_MISSING);
    await expect(adjacent).resolves.toEqual(EXECUTED_MISSING);
    expect(enteredSequences).toEqual([1n, 2n]);
  });

  it("rejects conflicting immutable pins for one exact attempt", async () => {
    const harness = createHarness();
    const firstLoaded = await loadedAttempt();
    const conflictingLoading = createPointMutationSessionAttemptLoadingV1({
      loadEffect: (selector) => Effect.sync(() => {
        const result = loadResult(selector);
        return Object.freeze({
          ...result,
          anchor: Object.freeze({
            ...result.anchor,
            snapshotToken: SnapshotTokenSchema.make({
              scopeId: result.anchor.snapshotToken.scopeId,
              epoch: result.anchor.snapshotToken.epoch,
              commitSeq: CommitSeqSchema.make(20n),
            }),
          }),
        });
      }),
    });
    const conflictingLoaded = await runEffect(conflictingLoading.load(SELECTOR));

    await runEffect(harness.journal.openAttempt(
      firstLoaded,
      executionScopeForJournal(harness.journal),
    ));
    const failure = await runFailure(
      harness.journal.openAttempt(
        conflictingLoaded,
        executionScopeForJournal(harness.journal),
      ),
    );

    expect(failure).toBeInstanceOf(PointMutationJournalAttemptPinsV1Error);
    expect(failure).toMatchObject({ reason: "immutablePinsMismatch" });
  });

  it("retains the permit after interruption until the Promise-native syscall settles", async () => {
    const firstSettled = deferred<void>();
    const enteredSequences: bigint[] = [];
    const harness = createHarness({
      runPointOperation: async (_table, operation) => {
        enteredSequences.push(operation.syscallSequence);
        if (operation.syscallSequence === 1n) {
          await firstSettled.promise;
        }
        return EXECUTED_MISSING;
      },
    });
    const { table } = await openResolvedTable(harness.journal);
    const firstFiber = Effect.runFork(
      harness.journal.runPointOperation(table, getOperation(1n)),
    );
    await waitFor(() => enteredSequences.length === 1);

    const interruption = runEffect(Fiber.interrupt(firstFiber));
    const adjacent = runEffect(
      harness.journal.runPointOperation(table, getOperation(2n)),
    );
    await yieldToScheduler();
    await yieldToScheduler();

    expect(enteredSequences).toEqual([1n]);
    firstSettled.resolve();
    await interruption;
    await expect(adjacent).resolves.toEqual(EXECUTED_MISSING);
    expect(enteredSequences).toEqual([1n, 2n]);
  });

  it("retains the permit after interrupted table resolution until its Promise settles", async () => {
    const resolutionSettled = deferred<void>();
    const events: string[] = [];
    const harness = createHarness({
      resolvePointTable: async (attempt, tableName) => {
        events.push("resolve:entered");
        await resolutionSettled.promise;
        events.push("resolve:settled");
        return Object.freeze({ attempt, tableName });
      },
      prepareSeal: async () => {
        events.push("seal:prepared");
        return Object.freeze({
          preparation: Object.freeze({ kind: "test-seal-preparation" }),
          journal: emptyJournal(0n),
        });
      },
    });
    const loaded = await loadedAttempt();
    const attempt = await runEffect(harness.journal.openAttempt(
      loaded,
      executionScopeForJournal(harness.journal),
    ));
    const resolutionFiber = Effect.runFork(
      harness.journal.resolvePointTable(attempt, "users"),
    );
    await waitFor(() => events.length === 1);

    const interruption = runEffect(Fiber.interrupt(resolutionFiber));
    const seal = runEffect(
      harness.journal.sealSuccessfulResult(attempt, { ok: true }),
    );
    await yieldToScheduler();
    await yieldToScheduler();

    expect(events).toEqual(["resolve:entered"]);
    resolutionSettled.resolve();
    await interruption;
    await expect(seal).resolves.toBeDefined();
    expect(events).toEqual([
      "resolve:entered",
      "resolve:settled",
      "seal:prepared",
    ]);
  });

  it("replays an exact lost response before allowing the next syscall to enter", async () => {
    const lostResponse = new Error("response lost after durable commit");
    const replayDurable = deferred<void>();
    const enteredSequences: bigint[] = [];
    let storedRequest: string | undefined;
    let firstDeliveryLost = false;
    const harness = createHarness({
      runPointOperation: async (_table, operation) => {
        enteredSequences.push(operation.syscallSequence);
        const request = operation.kind === "get"
          ? `${operation.kind}:${operation.syscallSequence}:${operation.documentId}`
          : `${operation.kind}:${operation.syscallSequence}`;
        if (operation.syscallSequence === 1n && storedRequest === undefined) {
          storedRequest = request;
          firstDeliveryLost = true;
          throw lostResponse;
        }
        if (operation.syscallSequence === 1n) {
          if (request !== storedRequest) {
            return Object.freeze({
              kind: "sequenceRejected",
              issue: Object.freeze({
                reason: "requestMismatch",
                syscallSequence: operation.syscallSequence,
              }),
            });
          }
          await replayDurable.promise;
          return REPLAYED_MISSING;
        }
        return EXECUTED_MISSING;
      },
    });
    const { table } = await openResolvedTable(harness.journal);
    const exactFirstRequest = getOperation(1n);

    const lostFailure = await runFailure(
      harness.journal.runPointOperation(table, exactFirstRequest),
    );
    expect(firstDeliveryLost).toBe(true);
    expect(lostFailure).toBeInstanceOf(PointMutationJournalPersistenceV1Error);
    expect(lostFailure).toMatchObject({ cause: lostResponse });

    const replay = runEffect(harness.journal.runPointOperation(
      table,
      exactFirstRequest,
    ));
    await waitFor(() => enteredSequences.length === 2);
    const next = runEffect(harness.journal.runPointOperation(
      table,
      getOperation(2n),
    ));
    await yieldToScheduler();

    expect(enteredSequences).toEqual([1n, 1n]);
    replayDurable.resolve();
    await expect(replay).resolves.toEqual(REPLAYED_MISSING);
    await expect(next).resolves.toEqual(EXECUTED_MISSING);
    expect(enteredSequences).toEqual([1n, 1n, 2n]);
  });

  it("preserves typed capability and persistence failures at the Effect boundary", async () => {
    const invalidPins = new InvalidSessionJournalInputV1Error({
      operation: "openAttempt",
      reason: "invalidAttemptPins",
    });
    const openHarness = createHarness({ openAttemptFailure: invalidPins });
    const openFailure = await runFailure(
      openHarness.journal.openAttempt(
        await loadedAttempt(),
        executionScopeForJournal(openHarness.journal),
      ),
    );
    expect(openFailure).toBe(invalidPins);

    const missingTable = new PinnedPointTableNotFoundV1Error({
      deploymentId: DEPLOYMENT_ID,
      schemaVersionId: SCHEMA_VERSION_ID,
      tableName: USERS_TABLE_NAME,
    });
    const resolveHarness = createHarness({
      resolvePointTable: async () => {
        throw missingTable;
      },
    });
    const loaded = await loadedAttempt();
    const attempt = await runEffect(resolveHarness.journal.openAttempt(
      loaded,
      executionScopeForJournal(resolveHarness.journal),
    ));

    const missingFailure = await runFailure(
      resolveHarness.journal.resolvePointTable(attempt, "users"),
    );
    expect(missingFailure).toBe(missingTable);

    const resolutionCause = new Error("table resolution unavailable");
    const unavailableHarness = createHarness({
      resolvePointTable: async () => {
        throw resolutionCause;
      },
    });
    const unavailableAttempt = await runEffect(
      unavailableHarness.journal.openAttempt(
        await loadedAttempt(),
        executionScopeForJournal(unavailableHarness.journal),
      ),
    );
    const unavailableFailure = await runFailure(
      unavailableHarness.journal.resolvePointTable(
        unavailableAttempt,
        "users",
      ),
    );
    expect(unavailableFailure).toBeInstanceOf(
      PointMutationJournalPersistenceV1Error,
    );
    expect(unavailableFailure).toMatchObject({ cause: resolutionCause });

    const invalidAttemptEffect = Reflect.apply(
      resolveHarness.journal.resolvePointTable,
      undefined,
      [Object.freeze({}), "users"],
    );
    const invalidAttemptFailure = await runFailure(invalidAttemptEffect);
    expect(invalidAttemptFailure).toBeInstanceOf(
      InvalidPointMutationJournalCapabilityV1Error,
    );
    expect(invalidAttemptFailure).toMatchObject({ capability: "attempt" });

    const operationHarness = createHarness();
    const invalidTableEffect = Reflect.apply(
      operationHarness.journal.runPointOperation,
      undefined,
      [Object.freeze({}), getOperation(1n)],
    );
    const invalidTableFailure = await runFailure(invalidTableEffect);
    expect(invalidTableFailure).toBeInstanceOf(
      InvalidPointMutationJournalCapabilityV1Error,
    );
    expect(invalidTableFailure).toMatchObject({ capability: "table" });

    const rawFailure = new Error("database driver escaped its adapter");
    const rawHarness = createHarness({
      runPointOperation: async () => {
        throw rawFailure;
      },
    });
    const { table } = await openResolvedTable(rawHarness.journal);
    const wrappedFailure = await runFailure(
      rawHarness.journal.runPointOperation(table, getOperation(1n)),
    );
    expect(wrappedFailure).toBeInstanceOf(
      PointMutationJournalPersistenceV1Error,
    );
    expect(wrappedFailure).toMatchObject({ cause: rawFailure });
  });

  it("preserves exact-attempt lifecycle failures as executor-domain failures", async () => {
    const issues = [
      Object.freeze({
        reason: "attemptNotRunning",
        lifecycle: "finishing",
      }),
      Object.freeze({ reason: "activeAttemptExpired" }),
    ] satisfies ReadonlyArray<SessionJournalAttemptUnavailableV1Error["issue"]>;

    for (const issue of issues) {
      const harness = createHarness({
        runPointOperationEffect: () => Effect.fail(
          new SessionJournalAttemptUnavailableV1Error({ issue }),
        ),
      });
      const { table } = await openResolvedTable(harness.journal);
      const failure = await runFailure(
        harness.journal.runPointOperation(table, getOperation(1n)),
      );

      expect(failure).toBeInstanceOf(
        PointMutationJournalAttemptUnavailableV1Error,
      );
      expect(failure).toMatchObject({ issue });
    }
  });

  it("preserves typed sealed-lease promotion failures at the executor boundary", async () => {
    const promotionFailure = new SessionJournalLeasePromotionV1Error({
      issue: Object.freeze({
        kind: "retentionBudgetExceeded",
        remainingMilliseconds: 2,
        maximumLiveSnapshotRetentionMilliseconds: 1,
      }),
    });
    const harness = createHarness({
      completeSeal: async () => {
        throw promotionFailure;
      },
    });
    const { attempt } = await openResolvedTable(harness.journal);

    const failure = await runFailure(
      harness.journal.sealSuccessfulResult(attempt, { ok: true }),
    );

    expect(failure).toBe(promotionFailure);
    expect(harness.completeSealCalls).toBe(1);
  });

  it("waits for the in-flight syscall, then prepares, canonicalizes, and completes the seal", async () => {
    const operationDurable = deferred<void>();
    const events: string[] = [];
    const journalCandidate = emptyJournal(1n);
    const harness = createHarness({
      runPointOperation: async () => {
        events.push("operation:entered");
        await operationDurable.promise;
        events.push("operation:durable");
        return EXECUTED_MISSING;
      },
      prepareSeal: async () => {
        events.push("seal:prepared");
        return Object.freeze({
          preparation: Object.freeze({ kind: "test-seal-preparation" }),
          journal: journalCandidate,
        });
      },
      completeSeal: async (_preparation, journal, result) => {
        events.push("seal:completed");
        return storedEnvelope(journal, result);
      },
    });
    const { attempt, table } = await openResolvedTable(harness.journal);

    const operation = runEffect(harness.journal.runPointOperation(
      table,
      getOperation(1n),
    ));
    await waitFor(() => events.length === 1);
    const seal = runEffect(
      harness.journal.sealSuccessfulResult(attempt, { ok: true }),
    );
    await yieldToScheduler();

    expect(events).toEqual(["operation:entered"]);
    operationDurable.resolve();
    await expect(operation).resolves.toEqual(EXECUTED_MISSING);
    const envelope = await seal;

    expect(events).toEqual([
      "operation:entered",
      "operation:durable",
      "seal:prepared",
      "seal:completed",
    ]);
    expect(envelope).toEqual(storedEnvelope(
      harness.completedJournal,
      harness.completedResult,
    ));
    expect(envelope.journal).toEqual({ kind: "storedForSessionAttempt" });
  });

  it("does not complete a seal when canonical result validation fails", async () => {
    const harness = createHarness({
      prepareSeal: async () => Object.freeze({
        preparation: Object.freeze({ kind: "test-seal-preparation" }),
        journal: emptyJournal(0n),
      }),
    });
    const loaded = await loadedAttempt();
    const attempt = await runEffect(harness.journal.openAttempt(
      loaded,
      executionScopeForJournal(harness.journal),
    ));

    const failure = await runFailure(harness.journal.sealSuccessfulResult(
      attempt,
      { unsupported: () => "not a Flarex value" },
    ));
    expect(failure).toBeInstanceOf(CommitProtocolV1Error);
    expect(harness.completeSealCalls).toBe(0);
  });
});

interface HarnessOptions {
  readonly openAttemptFailure?: InvalidSessionJournalInputV1Error;
  readonly resolvePointTable?: (
    persistenceAttempt: unknown,
    tableName: unknown,
  ) => Promise<unknown>;
  readonly runPointOperation?: (
    persistenceTable: unknown,
    operation: SessionJournalPointOperationV1,
  ) => Promise<RunSessionJournalPointOperationV1Result>;
  readonly runPointOperationEffect?: (
    persistenceTable: unknown,
    operation: SessionJournalPointOperationV1,
  ) => Effect.Effect<
    RunSessionJournalPointOperationV1Result,
    SessionJournalAttemptUnavailableV1Error
  >;
  readonly prepareSeal?: (persistenceAttempt: unknown) => Promise<Readonly<{
    readonly preparation: unknown;
    readonly journal: SessionJournalV1;
  }>>;
  readonly completeSeal?: (
    preparation: unknown,
    journal: CanonicalSessionJournalV1,
    result: CanonicalSuccessfulResultV1,
  ) => Promise<StoredForSessionAttemptCommitEnvelopeV1>;
}

interface JournalHarness {
  readonly journal: PointMutationJournalV1;
  readonly samePersistenceJournal: PointMutationJournalV1;
  readonly operations: SessionJournalPointOperationV1[];
  readonly completeSealCalls: number;
  readonly completedJournal: CanonicalSessionJournalV1;
  readonly completedResult: CanonicalSuccessfulResultV1;
}

function createHarness(options: HarnessOptions = {}): JournalHarness {
  const persistenceAttempt = Object.freeze({ kind: "test-attempt" });
  const operations: SessionJournalPointOperationV1[] = [];
  let completeSealCalls = 0;
  let completedJournal: CanonicalSessionJournalV1 | undefined;
  let completedResult: CanonicalSuccessfulResultV1 | undefined;
  const runPointOperation = async (
    table: unknown,
    operation: SessionJournalPointOperationV1,
  ): Promise<RunSessionJournalPointOperationV1Result> => {
    operations.push(operation);
    return options.runPointOperation === undefined
      ? EXECUTED_MISSING
      : options.runPointOperation(table, operation);
  };
  const persistence = Object.freeze({
    openAttemptEffect: () => options.openAttemptFailure === undefined
      ? Effect.succeed(persistenceAttempt)
      : Effect.fail(options.openAttemptFailure),
    resolvePointTableEffect: (
      attempt: unknown,
      tableName: unknown,
    ) => Effect.tryPromise({
      try: () => options.resolvePointTable === undefined
        ? Promise.resolve(Object.freeze({ attempt, tableName }))
        : options.resolvePointTable(attempt, tableName),
      catch: (cause) => cause instanceof PinnedPointTableNotFoundV1Error
        ? cause
        : new SessionJournalPersistenceV1Error({
          operation: "resolvePinnedPointTable",
          cause,
        }),
    }),
    runPointOperationEffect: (
      table: unknown,
      operation: SessionJournalPointOperationV1,
    ) => {
      if (options.runPointOperationEffect !== undefined) {
        operations.push(operation);
        return options.runPointOperationEffect(table, operation);
      }
      return Effect.tryPromise({
        try: () => runPointOperation(table, operation),
        catch: (cause) => new SessionJournalPersistenceV1Error({
          operation: "runPointOperation",
          cause,
        }),
      });
    },
    prepareSealEffect: (attempt: unknown) => Effect.tryPromise({
      try: () => options.prepareSeal !== undefined
        ? options.prepareSeal(attempt)
        : Promise.resolve(Object.freeze({
          preparation: Object.freeze({ kind: "test-seal-preparation" }),
          journal: emptyJournal(0n),
        })),
      catch: (cause) => new SessionJournalPersistenceV1Error({
        operation: "prepareSealSnapshot",
        cause,
      }),
    }),
    completeSealEffect: (
      preparation: unknown,
      journal: CanonicalSessionJournalV1,
      result: CanonicalSuccessfulResultV1,
    ) => Effect.tryPromise({
      try: async (): Promise<StoredForSessionAttemptCommitEnvelopeV1> => {
        completeSealCalls += 1;
        completedJournal = journal;
        completedResult = result;
        if (options.completeSeal !== undefined) {
          return options.completeSeal(preparation, journal, result);
        }
        return storedEnvelope(journal, result);
      },
      catch: (cause) =>
        cause instanceof SessionJournalLeasePromotionV1Error
          ? cause
          : new SessionJournalPersistenceV1Error({
            operation: "completeSealTransaction",
            cause,
          }),
    }),
  });

  // The persistence package deliberately hides capability brands. Reflection
  // keeps this fake at the runtime adapter edge instead of forging/exporting a
  // production capability solely for executor orchestration tests.
  const executionClaims = createPointMutationExecutionClaimVaultV1();
  const journal: PointMutationJournalV1 = Reflect.apply(
    createPointMutationJournalV1,
    undefined,
    [persistence, executionClaims.admission],
  );
  const samePersistenceJournal = journal;
  executionClaimsByJournal.set(journal, executionClaims);

  return {
    journal,
    samePersistenceJournal,
    operations,
    get completeSealCalls() {
      return completeSealCalls;
    },
    get completedJournal() {
      if (completedJournal === undefined) {
        throw new Error("The harness has not completed a seal.");
      }
      return completedJournal;
    },
    get completedResult() {
      if (completedResult === undefined) {
        throw new Error("The harness has not completed a seal.");
      }
      return completedResult;
    },
  };
}

async function openResolvedTable(journal: PointMutationJournalV1) {
  const loaded = await loadedAttempt();
  const attempt = await runEffect(journal.openAttempt(
    loaded,
    executionScopeForJournal(journal),
  ));
  const table = await runEffect(journal.resolvePointTable(attempt, "users"));
  return Object.freeze({ attempt, table });
}

function executionScopeForJournal(
  journal: PointMutationJournalV1,
): PointMutationExecutionScopeV1 {
  const executionClaims = executionClaimsByJournal.get(journal);
  if (executionClaims === undefined) {
    throw new Error("Point-mutation journal execution scope is missing.");
  }
  const executionClaim = executionClaims.issuer.mint({
    selector: Object.freeze({
      deploymentId: DEPLOYMENT_ID,
      scopeId: SCOPE_ID,
      sessionId: SESSION_ID,
      attemptFence: ATTEMPT_FENCE,
    }),
    observation: Object.freeze({
      claimOwner: TransactionExecutionClaimOwnerV1Schema.make(
        "71000000-0000-4000-8000-000000000002",
      ),
      claimFence: TransactionExecutionClaimFenceV1Schema.make(1n),
      claimedAt: "2026-07-15T00:00:00.000Z",
      claimExpiresAt: "2098-12-31T23:59:00.000Z",
    }),
    mode: "execute",
  });
  return Effect.runSync(
    Effect.fromResult(
      executionClaims.admission.admit(executionClaim, "execute"),
    ),
  );
}

async function loadedAttempt(): Promise<LoadedPointMutationSessionAttemptV1> {
  const loading = createPointMutationSessionAttemptLoadingV1({
    loadEffect: (selector) => Effect.succeed(loadResult(selector)),
  });
  return runEffect(loading.load(SELECTOR));
}

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
    requestKey: TransactionRequestKeyV1Schema.make("request:point:journal"),
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(3n),
    attemptFence: selector.attemptFence,
    snapshotToken: SnapshotTokenSchema.make({
      scopeId: selector.scopeId,
      epoch: ScopeEpochSchema.make("epoch_point_journal"),
      commitSeq: CommitSeqSchema.make(19n),
    }),
    hardExpiresAt: "2099-01-01T00:00:00.000Z",
    leaseExpiresAt: "2098-12-31T23:59:00.000Z",
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  });
}

function getOperation(sequence: bigint) {
  return Object.freeze({
    kind: "get",
    syscallSequence: sequence.toString(),
    documentId: DOCUMENT_ID,
  });
}

function emptyJournal(finalSequence: bigint): SessionJournalV1 {
  return Object.freeze({
    format: SESSION_JOURNAL_FORMAT_V1,
    protocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
    valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    finalSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(
      finalSequence,
    ),
    readDependencies: [],
    readUsage: Object.freeze({
      documentsRead: CommitReadDocumentsV1Schema.make(0),
      semanticBytesRead: CommitReadSemanticBytesV1Schema.make(0),
    }),
    writes: [],
  });
}

function storedEnvelope(
  journal: CanonicalSessionJournalV1,
  result: CanonicalSuccessfulResultV1,
): StoredForSessionAttemptCommitEnvelopeV1 {
  return Object.freeze({
    format: COMMIT_ENVELOPE_FORMAT_V1,
    protocolVersion: journal.journal.protocolVersion,
    sessionId: SESSION_ID,
    attemptFence: ATTEMPT_FENCE,
    finalSyscallSequence: journal.journal.finalSyscallSequence,
    journal: Object.freeze({ kind: "storedForSessionAttempt" }),
    journalSha256Hex: journal.sha256Hex,
    successfulResult: result.evidence,
  });
}

function deferred<T>(): Readonly<{
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}>;
function deferred(): Readonly<{
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}>;
function deferred<T = void>() {
  let complete: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    complete = resolve;
  });
  return Object.freeze({
    promise,
    resolve: (value: T) => {
      if (complete === undefined) {
        throw new Error("Deferred resolver was not initialized.");
      }
      complete(value);
    },
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await yieldToScheduler();
  }
  throw new Error("Timed out waiting for the test condition.");
}

async function yieldToScheduler(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
