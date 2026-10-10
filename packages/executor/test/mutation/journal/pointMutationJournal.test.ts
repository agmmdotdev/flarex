import type {
  RunSessionJournalIndexedQueryV1Result,
  RunSessionJournalRelationIncomingV1Result,
  RunSessionJournalPointOperationV1Result,
  SessionJournalIndexedQueryOperationV1,
  SessionJournalRelationIncomingOperationV1,
  SessionJournalPointOperationV1,
  SessionJournalStorePersistence,
} from "@flarex/persistence-postgres/internal/session-journal";
import { LogicalParticipantAdmissionError } from "@flarex/persistence-postgres/internal/logical-participant-errors";
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
} from "@flarex/persistence-postgres/internal/session-journal";
import type {
  PointMutationSessionAnchorV1,
  PointMutationSessionAttemptLoadResultV1,
  PointMutationSessionAttemptSelectorV1,
} from "@flarex/persistence-postgres/internal/session";
import { Cause, Effect, Exit, Fiber, Result } from "effect";
import { decodeAppDocumentIdV1, decodeAppRowIdHexV1 } from
  "flarex-protocol/app-document-id";
import {
  decodeCatalogEdgeDefinitionId,
  decodeCatalogRelationId,
  decodeCatalogTableId,
} from "flarex-protocol/catalog";
import {
  COMMIT_ENVELOPE_FORMAT_V1,
  CommitProtocolV1Error,
  CommitFinalSyscallSequenceV1Schema,
  CommitReadDocumentsV1Schema,
  CommitReadSemanticBytesV1Schema,
  MetadataSequenceSchema,
  CommitSyscallSequenceV1Schema,
  SESSION_JOURNAL_FORMAT,
  type CanonicalSessionJournal,
  type CanonicalSuccessfulResultV1,
  type SessionJournal,
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
  TransactionExecutionModuleV1Schema,
  TransactionFunctionKindV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import { FLAREX_VALUE_CODEC_VERSION_V1 } from "flarex-protocol/value";
import { describe, expect, it } from "vitest";

import {
  createPointMutationJournalV1,
  type PointMutationJournalAdmittedParticipantV1,
  type PointMutationJournalV1,
  type PointMutationJournalApplicationRelationReadCapability,
} from "../../../src/mutation/journal/pointMutationJournal";
import {
  InvalidPointMutationJournalCapabilityV1Error,
  PointMutationJournalAttemptUnavailableV1Error,
  PointMutationJournalAttemptPinsV1Error,
  PointMutationJournalRelationConflictError,
  PointMutationJournalPersistenceV1Error,
  UnsupportedPointMutationJournalOperationV1Error,
  PointMutationJournalParticipantSetV1Error,
  PointMutationJournalParticipantSelectionV1Error,
  PointMutationJournalParticipantRejectedV1Error,
} from "../../../src/mutation/journal/errors";
import {
  createPointMutationExecutionClaimVaultV1,
  type PointMutationExecutionClaimVaultV1,
  type PointMutationExecutionScopeV1,
} from "../../../src/mutation/claims/pointMutationExecutionClaim";
import {
  createPointMutationSessionAttemptLoadingV1,
  type LoadedPointMutationSessionAttemptV1,
  type PointMutationSessionAttemptSelectorWireV1,
} from "../../../src/mutation/session/pointMutationSessionActivation";
import {
  runEffect,
  runEffectFailure as runFailure,
} from "../../support/effectTestRuntime";

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
const RELATION_TARGET_DOCUMENT_ID = decodeAppDocumentIdV1(DOCUMENT_ID);
const RELATION_CONFLICT = Object.freeze({
  kind: "relationConflict" as const,
  edgeDefinitionId: decodeCatalogEdgeDefinitionId(41),
  targetRowId: decodeAppRowIdHexV1(
    "00000000000000000000000000000001",
  ),
  expectedAdjacencyVersion: CommitSeqSchema.make(5n),
  actualAdjacencyVersion: CommitSeqSchema.make(8n),
  snapshotCommitSeq: CommitSeqSchema.make(6n),
});
const RELATION_REQUEST = Object.freeze({
  format: "flarex.session-journal-syscall" as const,
  codecVersion: 2 as const,
  kind: "relationIncoming" as const,
  syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
  relationId: decodeCatalogRelationId(31),
  edgeDefinitionId: RELATION_CONFLICT.edgeDefinitionId,
  sourceTableId: decodeCatalogTableId(1),
  targetTableId: decodeCatalogTableId(1),
  targetRowId: RELATION_CONFLICT.targetRowId,
  limit: 1,
});
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

const EXECUTED_INDEX_PAGE = Object.freeze({
  kind: "completed",
  delivery: "executed",
  outcome: Object.freeze({
    kind: "indexRangePage",
    documents: Object.freeze([{ status: "open" }]),
    isDone: true,
  }),
} satisfies RunSessionJournalIndexedQueryV1Result);

const executionClaimsByJournal = new WeakMap<
  PointMutationJournalV1,
  PointMutationExecutionClaimVaultV1
>();

describe("C03 executor point-mutation journal boundary", () => {
  const inertParticipant = (participant: string): PointMutationJournalAdmittedParticipantV1 => ({ participant,
    admission: { participant, operationMethods: ["read"], profileRevision: "a".repeat(64),
      sources: [] }, borrow: () => Effect.die("unused") });
  const inertSource = (methods: readonly string[] = ["read"]) => ({
    selection: { bindAttemptEffect: () => Effect.die("unused source") }, methods,
  });

  it.each([
    ["duplicate", ["source.one", "source.one"]],
    ["tooMany", ["source.one", "source.two", "source.three", "source.four"]],
    ["invalidSelector", [" source.one"]],
  ] as const)("refuses a %s trusted participant set before opening persistence", async (reason, names) => {
    const participants = names.map(inertParticipant);
    const harness = createHarness({ admittedParticipants: participants });
    const failure = await runFailure(harness.journal.openAttempt(
      await loadedAttempt(), executionScopeForJournal(harness.journal)));
    expect(failure).toBeInstanceOf(PointMutationJournalParticipantSetV1Error);
    expect((failure as PointMutationJournalParticipantSetV1Error).reason).toBe(reason);
  });

  it("prepares the eagerly captured initial graph after caller arrays change", async () => {
    const operationMethods = ["read"];
    const sourceMethods = ["read"];
    const source = inertSource(sourceMethods);
    const sources = [source];
    const initial = inertParticipant("source.one");
    const participants: PointMutationJournalAdmittedParticipantV1[] = [
      { ...initial, admission: { ...initial.admission, operationMethods, sources } },
    ];
    const harness = createHarness({ executionProfile: "finiteRoot", admittedParticipants: participants });
    operationMethods.push("write");
    sourceMethods.push("write");
    sources.push(inertSource());
    participants.push(inertParticipant("source.two"));
    const prepare = harness.journal.prepareInitialFiniteEntry;
    if (prepare === undefined) throw new Error("Missing finite initial preparation");
    const failure = await runFailure(Effect.scoped(prepare()));
    expect(failure).toBeInstanceOf(PointMutationJournalParticipantRejectedV1Error);
    expect(harness.finiteEntrySelections).toHaveLength(1);
    expect(harness.finiteEntrySelections[0]).toEqual([{ ...initial.admission,
      operationMethods: ["read"], sources: [{ selection: source.selection, methods: ["read"] }] }]);
  });

  it("captures a fresh graph lazily and forwards its actual source selection", async () => {
    const initial = inertParticipant("source.one");
    const initialSource = inertSource();
    const freshSource = inertSource();
    const harness = createHarness({ executionProfile: "finiteRoot", admittedParticipants: [
      { ...initial, admission: { ...initial.admission, sources: [initialSource] } },
    ] });
    let admissionReads = 0;
    const fresh = { ...initial, get admission(): PointMutationJournalAdmittedParticipantV1["admission"] {
      admissionReads += 1;
      return { ...initial.admission, sources: [freshSource] };
    } };
    const prepare = harness.journal.prepareFiniteEntry;
    if (prepare === undefined) throw new Error("Missing finite fresh preparation");
    const preparation = prepare([fresh]);
    expect(admissionReads).toBe(0);
    const failure = await runFailure(Effect.scoped(preparation));
    expect(failure).toBeInstanceOf(PointMutationJournalParticipantRejectedV1Error);
    expect(admissionReads).toBe(4);
    expect(harness.finiteEntrySelections).toHaveLength(1);
    expect(harness.finiteEntrySelections[0]?.[0]?.sources[0]?.selection).toBe(freshSource.selection);
  });

  it.each(["initial", "fresh"] as const)("retains the first duplicate refusal for %s preparation without reading its admission", async kind => {
    const initial = inertParticipant("source.one");
    let duplicateAdmissionReads = 0;
    const duplicate = { ...initial, get admission(): PointMutationJournalAdmittedParticipantV1["admission"] {
      duplicateAdmissionReads += 1;
      throw new Error("Duplicate admission must not be read");
    } };
    const harness = createHarness({ executionProfile: "finiteRoot", admittedParticipants: kind === "initial" ? [initial, duplicate] : [initial] });
    const prepareInitial = harness.journal.prepareInitialFiniteEntry;
    const prepareFresh = harness.journal.prepareFiniteEntry;
    if (prepareInitial === undefined || prepareFresh === undefined) throw new Error("Missing finite preparation");
    const failure = await runFailure(Effect.scoped(kind === "initial" ? prepareInitial() : prepareFresh([initial, duplicate])));
    expect(failure).toBeInstanceOf(PointMutationJournalParticipantSetV1Error);
    expect(failure).toMatchObject({ reason: "duplicate", participant: "source.one" });
    expect(duplicateAdmissionReads).toBe(0);
    expect(harness.finiteEntrySelections).toHaveLength(0);
  });

  it("retains invalid initial-set precedence before reading a fresh graph", async () => {
    const initial = inertParticipant("source.one");
    const harness = createHarness({ executionProfile: "finiteRoot", admittedParticipants: [initial, initial] });
    let freshAdmissionReads = 0;
    const fresh = { ...initial, get admission(): PointMutationJournalAdmittedParticipantV1["admission"] {
      freshAdmissionReads += 1;
      throw new Error("Fresh graph must not be read after initial refusal");
    } };
    const prepare = harness.journal.prepareFiniteEntry;
    if (prepare === undefined) throw new Error("Missing finite fresh preparation");
    const failure = await runFailure(Effect.scoped(prepare([fresh])));
    expect(failure).toBeInstanceOf(PointMutationJournalParticipantSetV1Error);
    expect(failure).toMatchObject({ reason: "duplicate" });
    expect(freshAdmissionReads).toBe(0);
    expect(harness.finiteEntrySelections).toHaveLength(0);
  });

  it.each(["initial", "fresh"] as const)("rejects oversized %s sets before any participant fields are read", async kind => {
    const initial = inertParticipant("source.one");
    let selectorReads = 0;
    const unread = { ...initial, get participant(): string {
      selectorReads += 1;
      throw new Error("Oversized set must refuse before member capture");
    } };
    const oversized = [unread, unread, unread, unread];
    const harness = createHarness({ executionProfile: "finiteRoot", admittedParticipants: kind === "initial" ? oversized : [initial] });
    const prepareInitial = harness.journal.prepareInitialFiniteEntry;
    const prepareFresh = harness.journal.prepareFiniteEntry;
    if (prepareInitial === undefined || prepareFresh === undefined) throw new Error("Missing finite preparation");
    const failure = await runFailure(Effect.scoped(kind === "initial" ? prepareInitial() : prepareFresh(oversized)));
    expect(failure).toBeInstanceOf(PointMutationJournalParticipantSetV1Error);
    expect(failure).toMatchObject({ reason: "tooMany" });
    expect(selectorReads).toBe(0);
    expect(harness.finiteEntrySelections).toHaveLength(0);
  });

  it.each(["initial", "fresh"] as const)("rejects invalid %s selectors before reading admission", async kind => {
    const initial = inertParticipant("source.one");
    let admissionReads = 0;
    const invalid = { ...initial, participant: " source.one", get admission(): PointMutationJournalAdmittedParticipantV1["admission"] {
      admissionReads += 1;
      throw new Error("Invalid selector must refuse before admission capture");
    } };
    const harness = createHarness({ executionProfile: "finiteRoot", admittedParticipants: kind === "initial" ? [invalid] : [initial] });
    const prepareInitial = harness.journal.prepareInitialFiniteEntry;
    const prepareFresh = harness.journal.prepareFiniteEntry;
    if (prepareInitial === undefined || prepareFresh === undefined) throw new Error("Missing finite preparation");
    const failure = await runFailure(Effect.scoped(kind === "initial" ? prepareInitial() : prepareFresh([invalid])));
    expect(failure).toBeInstanceOf(PointMutationJournalParticipantSetV1Error);
    expect(failure).toMatchObject({ reason: "invalidSelector", participant: " source.one" });
    expect(admissionReads).toBe(0);
    expect(harness.finiteEntrySelections).toHaveLength(0);
  });

  it.each(["profile", "operationMethods", "sourceCount", "sourceMethods", "participant"] as const)(
    "refuses fresh %s topology changes before Store issuance", async change => {
      const initial = inertParticipant("source.one");
      const source = inertSource();
      const admitted = { ...initial, admission: { ...initial.admission, sources: [source] } };
      const harness = createHarness({ executionProfile: "finiteRoot", admittedParticipants: [admitted] });
      const participant = change === "participant" ? "source.two" : initial.participant;
      const fresh = { ...admitted, participant, admission: { ...admitted.admission, participant,
        profileRevision: change === "profile" ? "b".repeat(64) : admitted.admission.profileRevision,
        operationMethods: change === "operationMethods" ? ["read", "write"] : admitted.admission.operationMethods,
        sources: change === "sourceCount" ? [source, inertSource()] : change === "sourceMethods" ? [inertSource(["write"])] : [inertSource()],
      } };
      const prepare = harness.journal.prepareFiniteEntry;
      if (prepare === undefined) throw new Error("Missing finite fresh preparation");
      const failure = await runFailure(Effect.scoped(prepare([fresh])));
      expect(failure).toBeInstanceOf(PointMutationJournalParticipantSelectionV1Error);
      expect(failure).toMatchObject({ participant });
      expect(harness.finiteEntrySelections).toHaveLength(0);
    },
  );

  it.each(["added", "removed"] as const)("refuses a %s fresh participant before Store issuance", async change => {
    const participant = inertParticipant("source.one");
    const harness = createHarness({ executionProfile: "finiteRoot", admittedParticipants: [participant] });
    const prepare = harness.journal.prepareFiniteEntry;
    if (prepare === undefined) throw new Error("Missing finite fresh preparation");
    const failure = await runFailure(Effect.scoped(prepare(change === "added"
      ? [participant, inertParticipant("source.two")] : [])));
    expect(failure).toBeInstanceOf(PointMutationJournalParticipantSetV1Error);
    expect(failure).toMatchObject({ reason: "invalidSelector" });
    expect(harness.finiteEntrySelections).toHaveLength(0);
  });

  it.each(["initial", "fresh"] as const)("preserves nominal native failure provenance for %s preparation", async kind => {
    const participant = inertParticipant("source.one");
    const nativeFailure = new LogicalParticipantAdmissionError({ reason: "invalidAuthority", cause: "selected source refused" });
    const harness = createHarness({ executionProfile: "finiteRoot", admittedParticipants: [participant],
      prepareFiniteEntry: () => Effect.fail(nativeFailure) });
    const prepareInitial = harness.journal.prepareInitialFiniteEntry;
    const prepareFresh = harness.journal.prepareFiniteEntry;
    if (prepareInitial === undefined || prepareFresh === undefined) throw new Error("Missing finite preparation");
    const failure = await runFailure(Effect.scoped(kind === "initial" ? prepareInitial() : prepareFresh([participant])));
    expect(failure).toBeInstanceOf(PointMutationJournalParticipantRejectedV1Error);
    expect(failure).toMatchObject({ cause: nativeFailure });
    if (!(failure instanceof PointMutationJournalParticipantRejectedV1Error)) throw new Error("Expected participant refusal");
    expect(failure.cause).toBe(nativeFailure);
    expect(harness.finiteEntrySelections).toHaveLength(1);
  });

  it.each(["initial", "fresh"] as const)("retains an already classified native %s preparation error by identity", async kind => {
    const participant = inertParticipant("source.one");
    const nativeFailure = new InvalidSessionJournalInputV1Error({ operation: "openAttempt", reason: "invalidAttemptPins" });
    const harness = createHarness({ executionProfile: "finiteRoot", admittedParticipants: [participant],
      prepareFiniteEntry: () => Effect.fail(nativeFailure) });
    const prepareInitial = harness.journal.prepareInitialFiniteEntry;
    const prepareFresh = harness.journal.prepareFiniteEntry;
    if (prepareInitial === undefined || prepareFresh === undefined) throw new Error("Missing finite preparation");
    const failure = await runFailure(Effect.scoped(kind === "initial" ? prepareInitial() : prepareFresh([participant])));
    expect(failure).toBeInstanceOf(InvalidSessionJournalInputV1Error);
    expect(failure).toBe(nativeFailure);
    expect(harness.finiteEntrySelections).toHaveLength(1);
  });

  it("preserves a fresh capture getter defect before Store issuance", async () => {
    const participant = inertParticipant("source.one");
    const defect = new Error("Trusted graph getter defect");
    const fresh = { ...participant, get admission(): PointMutationJournalAdmittedParticipantV1["admission"] { throw defect; } };
    const harness = createHarness({ executionProfile: "finiteRoot", admittedParticipants: [participant] });
    const prepare = harness.journal.prepareFiniteEntry;
    if (prepare === undefined) throw new Error("Missing finite fresh preparation");
    const exit = await runEffect(Effect.exit(Effect.scoped(prepare([fresh]))));
    if (!Exit.isFailure(exit)) throw new Error("Expected full capture defect Cause");
    expect(exit.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([defect]);
    expect(harness.finiteEntrySelections).toHaveLength(0);
  });

  it("refuses an unselected participant before invoking its persistence callback", async () => {
    const harness = createHarness({ admittedParticipants: [inertParticipant("source.one")] });
    const attempt = await runEffect(harness.journal.openAttempt(
      await loadedAttempt(), executionScopeForJournal(harness.journal)));
    const runAdmitted = harness.journal.runAdmittedOperation;
    if (runAdmitted === undefined) throw new Error("Missing selected participant runner");
    const input = { operation: { participant: "source.other" } } as unknown as
      Parameters<typeof runAdmitted>[1];
    const failure = await runFailure(runAdmitted(attempt, input));
    expect(failure).toBeInstanceOf(PointMutationJournalParticipantSelectionV1Error);
    expect((failure as PointMutationJournalParticipantSelectionV1Error).participant).toBe("source.other");
  });

  it("rejects unsupported, malformed, accessor, and excess-field operations before persistence", async () => {
    const harness = createHarness();
    const { table } = await openResolvedTable(harness.journal);
    let getterCalls = 0;
    const accessorOperation: Record<string, unknown> = {
      syscallSequence: 1n,
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
      syscallSequence: 1n,
      documentId: DOCUMENT_ID,
    };
    Object.defineProperty(symbolOperation, Symbol("fallback"), {
      value: "scan",
    });
    const cases = [
      { input: null, reason: "notPlainObject" },
      { input: [], reason: "notPlainObject" },
      {
        input: { kind: "scan", syscallSequence: 1n },
        reason: "invalidKind",
      },
      {
        input: {
          kind: "get",
          syscallSequence: 1n,
          documentId: DOCUMENT_ID,
          fallback: "legacy",
        },
        reason: "unexpectedFields",
      },
      { input: symbolOperation, reason: "unexpectedFields" },
      {
        input: {
          kind: "get",
          syscallSequence: 0n,
          documentId: DOCUMENT_ID,
        },
        reason: "invalidSequence",
      },
      {
        input: {
          kind: "get",
          syscallSequence: "1",
          documentId: DOCUMENT_ID,
        },
        reason: "invalidSequence",
      },
      {
        input: {
          kind: "get",
          syscallSequence: 1n,
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

  it("accepts only runtime bigint sequences for indexed RPC operations", async () => {
    const harness = createHarness();
    const { index } = await openResolvedIndex(harness.journal);
    const operation = Object.freeze({
      kind: "indexRange",
      syscallSequence: 1n,
      bounds: Object.freeze({}),
      limit: 2,
    });

    expect(await runEffect(
      harness.journal.runIndexedQuery(index, operation),
    )).toEqual(EXECUTED_INDEX_PAGE);
    expect(harness.indexedOperations).toEqual([operation]);

    const failure = await runFailure(harness.journal.runIndexedQuery(index, {
      ...operation,
      syscallSequence: "2",
    }));
    expect(failure).toBeInstanceOf(
      UnsupportedPointMutationJournalOperationV1Error,
    );
    expect(failure).toMatchObject({
      reason: "invalidFieldShape",
      operationKind: "indexRange",
    });
  });

  it.each(["executed", "replayed"] as const)(
    "turns an %s persisted relation conflict into one same-factory retry claim",
    async (delivery) => {
      const harness = createHarness({
        runRelationIncoming: async () => Object.freeze({
          kind: "conflicted" as const,
          delivery,
          request: RELATION_REQUEST,
          conflict: RELATION_CONFLICT,
        }),
      });
      const foreign = createHarness();
      const relation = await openResolvedRelation(harness.journal);
      const failure = await runFailure(
        harness.journal.runApplicationRelationIncomingRead(
          relation.relation,
          relationIncomingOperation(1n),
        ),
      );

      expect(failure).toBeInstanceOf(
        PointMutationJournalRelationConflictError,
      );
      expect(failure).toMatchObject({ conflict: RELATION_CONFLICT });
      expect(Result.isFailure(
        foreign.journal.claimPersistedRelationConflictForRetry(failure),
      )).toBe(true);
      expect(Result.isFailure(
        harness.journal.claimPersistedRelationConflictForRetry(
          new PointMutationJournalRelationConflictError({
            conflict: RELATION_CONFLICT,
          }),
        ),
      )).toBe(true);

      const claimed = harness.journal
        .claimPersistedRelationConflictForRetry(failure);
      expect(Result.isSuccess(claimed)).toBe(true);
      if (Result.isSuccess(claimed)) {
        expect(claimed.success.error).toBe(failure);
        expect(claimed.success.request).toEqual(RELATION_REQUEST);
        expect(claimed.success.conflict).toEqual(RELATION_CONFLICT);
      }
      expect(Result.isFailure(
        harness.journal.claimPersistedRelationConflictForRetry(failure),
      )).toBe(true);
      expect(harness.relationOperations).toEqual([
        relationIncomingOperation(1n),
      ]);
    },
  );

  it("rejects accessor and excess relation operations before persistence", async () => {
    const harness = createHarness();
    const { relation } = await openResolvedRelation(harness.journal);
    let getterCalls = 0;
    const accessor: Record<string, unknown> = {
      kind: "relationIncoming",
      syscallSequence: 1n,
      targetDocumentId: RELATION_TARGET_DOCUMENT_ID,
    };
    Object.defineProperty(accessor, "limit", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 1;
      },
    });
    const inputs = [
      accessor,
      {
        ...relationIncomingOperation(1n),
        cursor: "not-supported",
      },
      { ...relationIncomingOperation(1n), limit: 0 },
    ];
    for (const input of inputs) {
      await expect(runFailure(
        harness.journal.runApplicationRelationIncomingRead(relation, input),
      )).resolves.toBeInstanceOf(
        UnsupportedPointMutationJournalOperationV1Error,
      );
    }
    expect(getterCalls).toBe(0);
    expect(harness.relationOperations).toEqual([]);
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
  readonly admittedParticipants?: readonly PointMutationJournalAdmittedParticipantV1[];
  readonly executionProfile?: "durableOperations" | "finiteRoot";
  readonly prepareFiniteEntry?: (participants: Parameters<SessionJournalStorePersistence["prepareFiniteEntryEffect"]>[0]) =>
    Effect.Effect<never, Effect.Error<ReturnType<SessionJournalStorePersistence["prepareFiniteEntryEffect"]>>>;
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
  readonly runIndexedQuery?: (
    persistenceIndex: unknown,
    operation: SessionJournalIndexedQueryOperationV1,
  ) => Promise<RunSessionJournalIndexedQueryV1Result>;
  readonly runRelationIncoming?: (
    persistenceRelation: unknown,
    operation: SessionJournalRelationIncomingOperationV1,
  ) => Promise<RunSessionJournalRelationIncomingV1Result>;
  readonly prepareSeal?: (persistenceAttempt: unknown) => Promise<Readonly<{
    readonly preparation: unknown;
    readonly journal: SessionJournal;
  }>>;
  readonly completeSeal?: (
    preparation: unknown,
    journal: CanonicalSessionJournal,
    result: CanonicalSuccessfulResultV1,
  ) => Promise<StoredForSessionAttemptCommitEnvelopeV1>;
}

interface JournalHarness {
  readonly journal: PointMutationJournalV1;
  readonly samePersistenceJournal: PointMutationJournalV1;
  readonly operations: SessionJournalPointOperationV1[];
  readonly indexedOperations: SessionJournalIndexedQueryOperationV1[];
  readonly relationOperations: SessionJournalRelationIncomingOperationV1[];
  readonly finiteEntrySelections: Parameters<SessionJournalStorePersistence["prepareFiniteEntryEffect"]>[0][];
  readonly completeSealCalls: number;
  readonly completedJournal: CanonicalSessionJournal;
  readonly completedResult: CanonicalSuccessfulResultV1;
}

function createHarness(options: HarnessOptions = {}): JournalHarness {
  const persistenceAttempt = Object.freeze({ kind: "test-attempt" });
  const operations: SessionJournalPointOperationV1[] = [];
  const indexedOperations: SessionJournalIndexedQueryOperationV1[] = [];
  const relationOperations: SessionJournalRelationIncomingOperationV1[] = [];
  const finiteEntrySelections: Parameters<SessionJournalStorePersistence["prepareFiniteEntryEffect"]>[0][] = [];
  let completeSealCalls = 0;
  let completedJournal: CanonicalSessionJournal | undefined;
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
    // This refusal-only port records boundary inputs; it never manufactures a
    // Store preparation or a confirmed native attempt capability.
    prepareFiniteEntryEffect: (participants: Parameters<SessionJournalStorePersistence["prepareFiniteEntryEffect"]>[0]) => {
      finiteEntrySelections.push(participants);
      return options.prepareFiniteEntry === undefined
        ? Effect.fail(new LogicalParticipantAdmissionError({ reason: "invalidAuthority", cause: "inert finite boundary" }))
        : options.prepareFiniteEntry(participants);
    },
    admitLogicalParticipantsEffect: () => Effect.succeed(Object.freeze({ kind: "test-participant-admission" })),
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
      validator: unknown,
    ) => {
      if (validator !== syscallValidator) {
        return Effect.die(new Error(
          "The point journal did not forward its exact syscall validator.",
        ));
      }
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
    resolveDeveloperIndexEffect: (
      table: unknown,
      indexDescriptor: unknown,
    ) => Effect.succeed(Object.freeze({ table, indexDescriptor })),
    runIndexedQueryEffect: (
      index: unknown,
      operation: SessionJournalIndexedQueryOperationV1,
    ) => {
      indexedOperations.push(operation);
      const runIndexedQuery = options.runIndexedQuery;
      return runIndexedQuery === undefined
        ? Effect.succeed(EXECUTED_INDEX_PAGE)
        : Effect.tryPromise({
            try: () => runIndexedQuery(index, operation),
            catch: (cause) => new SessionJournalPersistenceV1Error({
              operation: "runIndexedQuery",
              cause,
            }),
          });
    },
    resolveApplicationRelationReadEffect: (
      attempt: unknown,
      capability: unknown,
    ) => Effect.succeed(Object.freeze({ attempt, capability })),
    runApplicationRelationIncomingReadEffect: (
      relation: unknown,
      operation: SessionJournalRelationIncomingOperationV1,
    ) => {
      relationOperations.push(operation);
      const runRelationIncoming = options.runRelationIncoming;
      return runRelationIncoming === undefined
        ? Effect.succeed(Object.freeze({
            kind: "completed" as const,
            delivery: "executed" as const,
            outcome: Object.freeze({
              kind: "relationIncomingPage" as const,
              items: Object.freeze([]),
              exhausted: true,
            }),
          }))
        : Effect.tryPromise({
            try: () => runRelationIncoming(relation, operation),
            catch: (cause) => new SessionJournalPersistenceV1Error({
              operation: "runApplicationRelationRead",
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
      journal: CanonicalSessionJournal,
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
  const syscallValidator = Object.freeze({ kind: "test-syscall-validator" });
  const journal: PointMutationJournalV1 = Reflect.apply(
    createPointMutationJournalV1,
    undefined,
    [persistence, executionClaims.admission, syscallValidator, options.admittedParticipants, options.executionProfile],
  );
  const samePersistenceJournal = journal;
  executionClaimsByJournal.set(journal, executionClaims);

  return {
    journal,
    samePersistenceJournal,
    operations,
    indexedOperations,
    relationOperations,
    finiteEntrySelections,
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

async function openResolvedIndex(journal: PointMutationJournalV1) {
  const { attempt, table } = await openResolvedTable(journal);
  const index = await runEffect(
    journal.resolveDeveloperIndex(table, "by_status"),
  );
  return Object.freeze({ attempt, table, index });
}

async function openResolvedRelation(journal: PointMutationJournalV1) {
  const loaded = await loadedAttempt();
  const attempt = await runEffect(journal.openAttempt(
    loaded,
    executionScopeForJournal(journal),
  ));
  // The persistence package deliberately keeps this capability nominal and
  // process-local. This inert fake exists only at the executor adapter seam.
  const capability = Object.freeze({}) as
    PointMutationJournalApplicationRelationReadCapability;
  const relation = await runEffect(
    journal.resolveApplicationRelationRead(attempt, capability),
  );
  return Object.freeze({ attempt, relation });
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
    lastMetadataSequence: MetadataSequenceSchema.make(0n),
    anchor: anchor(selector),
    executionPin: Object.freeze({ schemaVersionId: SCHEMA_VERSION_ID,
      functionPath: TransactionFunctionPathV1Schema.make("messages:create"),
      functionKind: TransactionFunctionKindV1Schema.make("mutation"),
      executionModule: TransactionExecutionModuleV1Schema.make("flarex/_generated/execution.mjs") }),
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
    executionProfile: "durableOperations",
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
    syscallSequence: sequence,
    documentId: DOCUMENT_ID,
  });
}

function relationIncomingOperation(
  sequence: bigint,
): SessionJournalRelationIncomingOperationV1 {
  return Object.freeze({
    kind: "relationIncoming",
    syscallSequence: CommitSyscallSequenceV1Schema.make(sequence),
    targetDocumentId: RELATION_TARGET_DOCUMENT_ID,
    limit: 1,
  });
}

function emptyJournal(finalSequence: bigint): SessionJournal {
  return Object.freeze({
    format: SESSION_JOURNAL_FORMAT,
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
    participantOperations: [],
    operationUsage: Object.freeze({ receiptEvidenceBytes: 0, participantWorkBytes: 0,
      participantWorkCalls: 0 }),
  });
}

function storedEnvelope(
  journal: CanonicalSessionJournal,
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
