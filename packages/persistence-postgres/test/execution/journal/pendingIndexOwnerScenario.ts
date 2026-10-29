import { Effect, Option, Result } from "effect";
import { expect } from "vitest";
import { decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1, type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { canonicalizeFlarexValueV1Effect, isCanonicalFlarexRuntimeObjectV1, type CanonicalFlarexValueV1 } from "flarex-protocol/value";
import { lowerAppDeveloperIndexKeyV1 } from "../../../src/storage/indexes/appDeveloperIndexKeys";
import { locateAppIndexDefinitionByIdEffect } from "../../../src/storage/indexes/appIndexDefinitions";
import { mapRunIndexedQueryFailure, mapRunPointOperationFailure } from "../../../src/execution/journal/journalFailures";
import { readOwnedFrozenFiniteAttempt, type FrozenFiniteAttempt } from "../../../src/execution/journal/frozenAttempt";
import { attachLogicalDocumentRootEvaluator, makeLogicalDocumentRootEvaluator,
  LogicalDocumentRootLimitError, lookupLogicalDocumentRootPendingKey,
  readLogicalDocumentRootPendingIndex, registerLogicalDocumentRootIndexes, retainLogicalDocumentRootIndexKey,
  type LogicalDocumentRootPendingIndexInput, type LogicalDocumentRootPointFailure } from "../../../src/storage/documents/logicalDocuments/rootEvaluator";
import type { ApplicationDocumentObservation } from "../../../src/storage/materialization/model";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "../../application/applicationNativeMutationTestFixture";
import { makeFiniteIndexedQueriesHarness } from "./finiteIndexedQueriesScenario";
import { pendingCanonicalIndexCacheScenario } from "./pendingCanonicalIndexCacheScenario";
import { pendingPredicateIndexScenario } from "./pendingPredicateIndexScenario";
import { pendingRootViewScenario } from "./pendingRootViewScenario";

type Fixture = ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>;
type Harness = Effect.Success<ReturnType<typeof makeFiniteIndexedQueriesHarness>>;
type ReadFailure = Result.Result.Failure<ReturnType<typeof lowerAppDeveloperIndexKeyV1>> |
  LogicalDocumentRootPointFailure | "loweringRefused" | "retentionRefused";
type Input = LogicalDocumentRootPendingIndexInput<ReadFailure>;

/** Direct portable-owner proof only. The actual journal supplies observations,
 * attempt identity and timestamps; the catalog supplies the genuine index.
 * These separate constructor roots do not claim live admission or publication. */
export const pendingIndexOwnerScenario = Effect.fn("PendingIndex.ownerScenario")(
  function* (native: Fixture, harness: Harness, published: FrozenFiniteAttempt) {
    const entry = yield* harness.open();
    const sample = yield* harness.store.runPointOperationEffect(entry.table, {
      kind: "get", syscallSequence: CommitSyscallSequenceV1Schema.make(1n), documentId: harness.alphaId,
    }, entry.validator);
    if (sample.kind !== "completed" || sample.outcome.kind !== "present" ||
      !isCanonicalFlarexRuntimeObjectV1(sample.outcome.document)) throw new Error("Missing actual owner fixture timestamp");
    const creationTime = decodeAppCreationTimeV1(sample.outcome.document._creationTime);
    const firstRowId = decodeAppRowIdHexV1("9a000000000000000000000000000001");
    const secondRowId = decodeAppRowIdHexV1("9b000000000000000000000000000002");
    for (const [offset, rowId] of [firstRowId, secondRowId].entries()) expect(yield* harness.store.runPointOperationEffect(entry.table, {
      kind: "get", syscallSequence: CommitSyscallSequenceV1Schema.make(BigInt(offset + 2)),
      documentId: appDocumentIdV1FromRowIdentity({ tableId: harness.tableId, rowId }),
    }, entry.validator)).toMatchObject({ kind: "completed", outcome: { kind: "missing", document: null } });
    const frozen = yield* harness.freeze(entry);
    const observation = (rowId: AppRowIdHexV1): ApplicationDocumentObservation => {
      const point = frozen.view.graph.dependencies.find(candidate => candidate.tableId === harness.tableId && candidate.rowId === rowId);
      if (point === undefined || point.dependency.kind !== "appRowPoint" || point.dependency.observed.kind !== "missing")
        throw new Error("Missing genuine owner fixture observation");
      expect(point.dependency.observed).toEqual({ kind: "missing", basis: { kind: "noVisibleRevision" } });
      return Object.freeze({ ...point, dependency: point.dependency });
    };
    const first = observation(firstRowId);
    const second = observation(secondRowId);
    const definitions = yield* native.developerIndexes.locate({
      deploymentId: TransactionGrantDeploymentIdV1Schema.make(native.deploymentId), scopeId: entry.activation.anchor.scopeId,
      schemaVersionId: entry.context.executionPin.schemaVersionId, tableIds: [harness.tableId], maximumDefinitions: 4,
    });
    const definition = definitions?.find(candidate => candidate.access.kind === "developer" && candidate.access.tableId === harness.tableId);
    if (definition === undefined) throw new Error("Missing authentic owner fixture index");
    const pins = Object.freeze({ attempt: entry.attempt, scopeId: entry.context.anchor.scopeId,
      snapshotCommitSeq: entry.context.anchor.snapshotToken.commitSeq, attemptFence: String(entry.context.anchor.attemptFence) });
    const makeRoot = Effect.fn("PendingIndex.ownerRoot")(function* (workingBytes = 1_048_576) {
      const root = yield* Effect.acquireRelease(Effect.sync(() => makeLogicalDocumentRootEvaluator(pins,
        { identities: 8, workingBytes })), owner => Effect.sync(owner.close));
      const state = attachLogicalDocumentRootEvaluator(root, pins);
      if (state === null) throw new Error("Missing issued direct-owner root");
      for (const point of [first, second]) Result.getOrThrow(root.observePoint("users", point, { kind: "missing" }));
      return Object.freeze({ root, state });
    });
    const { root, state } = yield* makeRoot();
    const document = Effect.fn("PendingIndex.ownerDocument")(function* (point: ApplicationDocumentObservation, name: string, padding?: string) {
      return yield* canonicalizeFlarexValueV1Effect({ _id: point.documentId, _creationTime: creationTime, name,
        ...(padding === undefined ? {} : { padding }) }, "appDocument");
    });
    const write = (point: ApplicationDocumentObservation, value: CanonicalFlarexValueV1, operation: "insert" | "patch" = "patch") =>
      Result.getOrThrow(root.writePoint("users", point, { kind: "live", creationTime, document: value }, operation));
    const currentDocument = (point: ApplicationDocumentObservation) => {
      const value = state.rows.get(point.documentId)?.current;
      if (value == null) throw new Error("Missing actual current owner document");
      return value;
    };
    // Pure retention-bridge contract: this explicit caller envelope matches the
    // native key record. It does not claim native canonical-cache admission.
    const retainInterpretedKey = (value: CanonicalFlarexValueV1) => {
      const key = Result.getOrThrow(lowerAppDeveloperIndexKeyV1(definition, value, creationTime));
      if (key === null) throw new Error("Expected a real encoded owner fixture key");
      const fullBytes = 128 + key.length * 2;
      const beforeBytes = state.workingBytes;
      let nativeBytes = 0;
      Result.getOrThrow(retainLogicalDocumentRootIndexKey(state, definition, value, creationTime, key, fullBytes, {
        error: failure => failure, charge: bytes => { nativeBytes += bytes; return Result.succeed(undefined); },
      }));
      return Object.freeze({ key, fullBytes, nativeBytes, rootBytes: state.workingBytes - beforeBytes });
    };
    const lowered: string[] = [];
    const lower: Input["lower"] = row => {
      if (row.current === null) throw new Error("Deleted rows must not require key lowering");
      lowered.push(row.documentId);
      return lowerAppDeveloperIndexKeyV1(definition, row.current, row.creationTime);
    };
    const read = (options: Partial<Pick<Input, "lower" | "charge">> = {}, selected = definition) =>
      readLogicalDocumentRootPendingIndex<ReadFailure>(state, selected, { order: "application", lower,
        error: failure => failure, charge: () => Result.succeed(undefined), ...options });

    write(first, yield* document(first, "Alpha pending"), "insert");
    write(second, yield* document(second, "Beta pending"), "insert");
    // Registration after accepted writes must fold the actual complete history.
    Result.getOrThrow(registerLogicalDocumentRootIndexes(state, [definition], { error: failure => failure }));
    const initial = Result.getOrThrow(read());
    expect(initial.positions.map(position => position.documentId)).toEqual([first.documentId, second.documentId]);
    expect(initial.writtenCount).toBe(2);
    expect(initial.hasWritten(first.rowId)).toBe(true);
    expect(lowered).toEqual([first.documentId, second.documentId]);
    const initialBytes = state.workingBytes;
    lowered.length = 0;
    expect(Result.getOrThrow(read()).positions).toEqual(initial.positions);
    expect(lowered).toEqual([]);
    expect(state.workingBytes).toBe(initialBytes);

    // The same catalog identity may be reissued to a later trusted borrower.
    const reissued = yield* locateAppIndexDefinitionByIdEffect(native.control.drizzle, entry.activation.anchor.scopeId, definition.indexDefinitionId);
    if (reissued === null) throw new Error("Missing reissued authentic definition");
    expect(reissued).not.toBe(definition);
    Result.getOrThrow(registerLogicalDocumentRootIndexes(state, [reissued], { error: failure => failure }));
    expect(Result.getOrThrow(read({}, reissued)).positions).toEqual(initial.positions);
    expect(lowered).toEqual([]);
    // A copied shape cannot replace the catalog's issuance proof.
    expect(Result.isFailure(registerLogicalDocumentRootIndexes(state, [{ ...definition }], { error: failure => failure }))).toBe(true);
    expect(Result.isFailure(read({}, { ...definition }))).toBe(true);
    expect(lowered).toEqual([]);

    const publication = readOwnedFrozenFiniteAttempt(published);
    const original = publication?.originalRows.find(row =>
      appDocumentIdV1FromRowIdentity(row) === harness.alphaId);
    if (original === undefined) throw new Error("Missing genuinely decoded original publisher body");
    yield* pendingCanonicalIndexCacheScenario(native, { root, state, definition, reissued, original });
    yield* pendingPredicateIndexScenario(native, { manifest: entry.schemaManifest,
      selectedSchemaVersionId: entry.context.executionPin.schemaVersionId, definition, pins, observation: first, creationTime });
    yield* pendingRootViewScenario({ pins, observation: first, definition, creationTime });

    write(first, yield* document(first, "Z".repeat(3_000)));
    write(first, yield* document(first, "Intermediate"));
    write(first, yield* document(first, "Alpha latest"));
    const moved = Result.getOrThrow(read());
    expect(lowered).toEqual([first.documentId]);
    expect(moved.positions).toMatchObject([{ documentId: first.documentId, document: { value: { name: "Alpha latest" } } },
      { documentId: second.documentId, document: { value: { name: "Beta pending" } } }]);
    lowered.length = 0;
    write(first, yield* document(first, "Alpha latest", "new body"));
    const freshBody = currentDocument(first);
    expect(Result.getOrThrow(lookupLogicalDocumentRootPendingKey(state, definition, freshBody, creationTime))).toEqual(Option.none());
    const equalKeyRetention = retainInterpretedKey(freshBody);
    expect(equalKeyRetention.nativeBytes).toBe(equalKeyRetention.fullBytes);
    expect(equalKeyRetention.rootBytes).toBe(128);
    // Reusing an already retained tuple payload after actual interpretation
    // must not manufacture a key hint for this unapplied new body.
    expect(Result.getOrThrow(lookupLogicalDocumentRootPendingKey(state, definition, freshBody, creationTime))).toEqual(Option.none());
    expect(Result.getOrThrow(read()).positions).toMatchObject([
      { documentId: first.documentId, document: { value: { name: "Alpha latest", padding: "new body" } } },
      { documentId: second.documentId, document: { value: { name: "Beta pending" } } },
    ]);
    expect(lowered).toEqual([first.documentId]);

    const unrelatedBody = yield* document(first, "Alpha latest", "unrelated wrapper");
    expect(Result.getOrThrow(lookupLogicalDocumentRootPendingKey(state, definition, unrelatedBody, creationTime))).toEqual(Option.none());
    const unrelatedRetention = retainInterpretedKey(unrelatedBody);
    expect(unrelatedRetention.key).toBe(equalKeyRetention.key);
    expect(unrelatedRetention.nativeBytes).toBe(unrelatedRetention.fullBytes);
    expect(unrelatedRetention.rootBytes).toBe(unrelatedRetention.fullBytes);
    lowered.length = 0;
    write(first, yield* document(first, "Alpha payload control", "different key"));
    const changedBody = currentDocument(first);
    expect(Result.getOrThrow(lookupLogicalDocumentRootPendingKey(state, definition, changedBody, creationTime))).toEqual(Option.none());
    const changedRetention = retainInterpretedKey(changedBody);
    expect(changedRetention.key).not.toBe(equalKeyRetention.key);
    expect(changedRetention.nativeBytes).toBe(changedRetention.fullBytes);
    expect(changedRetention.rootBytes).toBe(changedRetention.fullBytes);
    expect(Result.getOrThrow(read()).positions).toMatchObject([
      { document: { value: { name: "Alpha payload control", padding: "different key" } } },
      { document: { value: { name: "Beta pending" } } },
    ]);
    expect(lowered).toEqual([first.documentId]);

    // A null interpreter verdict removes membership, not accepted write intent.
    // This is callback-contract coverage, not a sparse-schema integration claim.
    lowered.length = 0;
    const omittedDocument = yield* document(second, "Omitted");
    write(second, omittedDocument);
    const currentOmitted = currentDocument(second);
    expect(Result.getOrThrow(lookupLogicalDocumentRootPendingKey(state, definition, currentOmitted, creationTime))).toEqual(Option.none());
    const omitted = Result.getOrThrow(read({ lower: row => row.documentId === second.documentId ? Result.succeed(null) : lower(row) }));
    expect(omitted.positions.map(position => position.documentId)).toEqual([first.documentId]);
    expect(omitted.writtenCount).toBe(2);
    expect(omitted.hasWritten(second.rowId)).toBe(true);
    expect(Result.getOrThrow(lookupLogicalDocumentRootPendingKey(state, definition, currentOmitted, creationTime))).toEqual(Option.some(null));
    expect(root.snapshot().changes.map(change => change.documentId).toSorted()).toEqual([first.documentId, second.documentId].toSorted());
    expect(root.snapshot().changes.every(change => change.kind === "live")).toBe(true);
    write(second, yield* document(second, "Beta returned"));
    expect(Result.getOrThrow(read()).positions.map(position => position.documentId)).toEqual([first.documentId, second.documentId]);

    write(first, yield* document(first, "Alpha retry"));
    write(second, yield* document(second, "Beta retry"));
    lowered.length = 0;
    const beforeFailureBytes = state.workingBytes;
    const refused = read({ lower: row => {
      if (row.documentId === second.documentId) { lowered.push(row.documentId); return Result.fail("loweringRefused"); }
      return lower(row);
    } });
    expect(refused).toMatchObject({ _tag: "Failure", failure: "loweringRefused" });
    expect(lowered).toEqual([first.documentId, second.documentId]);
    expect(state.workingBytes).toBe(beforeFailureBytes);
    lowered.length = 0;
    expect(Result.getOrThrow(read()).positions).toMatchObject([
      { document: { value: { name: "Alpha retry" } } }, { document: { value: { name: "Beta retry" } } },
    ]);
    expect(lowered).toEqual([first.documentId, second.documentId]);

    write(first, yield* document(first, "Alpha " + "x".repeat(200)));
    write(second, yield* document(second, "Beta " + "x".repeat(200)));
    lowered.length = 0;
    const beforeRetentionBytes = state.workingBytes;
    let refusedRetentionBytes = 0;
    expect(read({ charge: bytes => { refusedRetentionBytes += bytes; return Result.fail("retentionRefused"); } }))
      .toMatchObject({ _tag: "Failure", failure: "retentionRefused" });
    expect(refusedRetentionBytes).toBeGreaterThan(0);
    expect(lowered).toEqual([first.documentId, second.documentId]);
    expect(state.workingBytes).toBe(beforeRetentionBytes);
    lowered.length = 0;
    expect(Result.getOrThrow(read()).positions).toHaveLength(2);
    expect(lowered).toEqual([first.documentId, second.documentId]);
    expect(state.workingBytes).toBeGreaterThan(beforeRetentionBytes);

    write(first, yield* document(first, "Alpha " + "y".repeat(300)));
    write(second, yield* document(second, "Beta " + "y".repeat(300)));
    const latest = yield* document(first, "Alpha after charge");
    expect(Result.isFailure(read({ charge: () => { write(first, latest); return Result.succeed(undefined); } }))).toBe(true);
    lowered.length = 0;
    expect(Result.getOrThrow(read()).positions).toMatchObject([
      { document: { value: { name: "Alpha after charge" } } },
      { document: { value: { name: "Beta " + "y".repeat(300) } } },
    ]);
    expect(lowered).toEqual([first.documentId, second.documentId]);

    write(first, yield* document(first, "Alpha " + "z".repeat(400)));
    expect(read({ charge: () => { root.close(); return Result.succeed(undefined); } }))
      .toMatchObject({ _tag: "Failure", failure: "closed" });
    lowered.length = 0;
    expect(read()).toMatchObject({ _tag: "Failure", failure: "closed" });
    expect(lowered).toEqual([]);
    expect(root.point(first.tableId, first.rowId)).toBeUndefined();

    // Calibrate a real owner quota from one complete operation, without
    // reproducing the accounting formula or creating a huge session fixture.
    const quotaFirst = yield* document(first, "Alpha quota base");
    const quotaSecond = yield* document(second, "Beta quota base");
    const quotaGrowth = yield* document(first, "Alpha quota " + "q".repeat(200));
    type Owner = Effect.Success<ReturnType<typeof makeRoot>>;
    let quotaLowerings = 0;
    const quotaRead = (owner: Owner) => readLogicalDocumentRootPendingIndex<ReadFailure>(owner.state, definition, {
      order: "application", error: failure => failure, charge: () => Result.succeed(undefined),
      lower: row => {
        if (row.current === null) throw new Error("Quota root lost its pending body");
        quotaLowerings++;
        return lowerAppDeveloperIndexKeyV1(definition, row.current, row.creationTime);
      },
    });
    const initializeQuotaRoot = (owner: Owner) => {
      Result.getOrThrow(owner.root.writePoint("users", first,
        { kind: "live", creationTime, document: quotaFirst }, "insert"));
      Result.getOrThrow(owner.root.writePoint("users", second,
        { kind: "live", creationTime, document: quotaSecond }, "insert"));
      Result.getOrThrow(registerLogicalDocumentRootIndexes(owner.state, [definition], { error: failure => failure }));
      expect(Result.getOrThrow(quotaRead(owner)).positions).toHaveLength(2);
      Result.getOrThrow(owner.root.writePoint("users", first,
        { kind: "live", creationTime, document: quotaGrowth }, "patch"));
    };
    const probe = yield* makeRoot();
    initializeQuotaRoot(probe);
    const beforeQuotaRead = probe.state.workingBytes;
    Result.getOrThrow(quotaRead(probe));
    const completeQuotaBytes = probe.state.workingBytes;
    expect(completeQuotaBytes).toBeGreaterThan(beforeQuotaRead);
    probe.root.close();

    const limited = yield* makeRoot(completeQuotaBytes - 1);
    initializeQuotaRoot(limited);
    expect(limited.state.workingBytes).toBe(beforeQuotaRead);
    for (let refusedRead = 0; refusedRead < 2; refusedRead++) {
      quotaLowerings = 0;
      const refusal = quotaRead(limited);
      if (!Result.isFailure(refusal)) throw new Error("Expected real pending-index retention refusal");
      expect(refusal.failure).toBeInstanceOf(LogicalDocumentRootLimitError);
      expect(refusal.failure).toMatchObject({ resource: "workingBytes", observed: completeQuotaBytes, maximum: completeQuotaBytes - 1 });
      // These actual journal boundary mappers must preserve the emitted resource
      // object, rather than recategorize quota exhaustion as stored corruption.
      expect(mapRunPointOperationFailure(refusal.failure)).toBe(refusal.failure);
      expect(mapRunIndexedQueryFailure(refusal.failure)).toBe(refusal.failure);
      expect(quotaLowerings).toBe(1);
      expect(limited.state.workingBytes).toBe(beforeQuotaRead);
    }
  },
);
