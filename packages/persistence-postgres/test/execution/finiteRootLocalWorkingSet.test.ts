import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import type { LiveAppRowRevisionV1 } from "../../src/storage/documents/appRows";
import { Cause, Effect, Exit, Result } from "effect";
import { expect, it, vi } from "vitest";
import { AppCreationTimeV1Schema, canonicalizeAppDocumentV1 } from "flarex-protocol/app-document";
import {
  MetadataSequenceSchema,
  LogicalMetadataReadDependencySchema,
  canonicalizeSessionJournalEffect,
  SESSION_JOURNAL_FORMAT,
} from "flarex-protocol/commit-protocol";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { CommitSeqSchema, FlarexDbV1StorageGenerationSchema, ScopeEpochSchema,
  ScopeIdSchema, ScopeUuidV1Schema, ScopeEpochUuidV1Schema, StorageGenerationFenceSchema } from "flarex-protocol/storage-authority";
import {
  makeBoundedRequestLifetime,
  projectBoundedRequestLifetime,
  type RequestFailureReason,
} from "../../src/execution/preparation/boundedRequestLifetime";
import type { FlarexMetadataTransaction } from "../../src/database/metadataTransaction";
import type {
  SessionJournalAttempt,
} from "../../src/execution/journal/api";
import { makeLogicalDocumentRootEvaluator, attachLogicalDocumentRootEvaluator,
  recordLogicalDocumentRootMetadataDependency, consumeLogicalDocumentRootMetadataDependency, takeLogicalDocumentRootSnapshot,
  borrowClosedLogicalDocumentRoot, consumeClosedLogicalDocumentRoot } from "../../src/storage/documents/logicalDocuments/rootEvaluator";
import { makeLogicalDocumentWorkingSet, prepareLogicalWriteMechanics, combineLogicalWriteMechanics } from "../../src/storage/documents/logicalDocuments/workingSet";
import type { PreparedLogicalDocumentWriteMechanics } from "../../src/storage/documents/logicalDocuments/model";
import { runEffect } from "../support/effectTestRuntime";
import {
  captureFiniteMetadataDependency,
  disposeFiniteMetadataProjection,
  finiteMetadataContractKey,
  prepareFiniteMetadataProjection,
} from "../../src/execution/finiteMetadataDependencies";
import {
  makeLogicalCommerceActivityProjection,
} from "../../src/frameworks/commerceTransaction/logicalParticipant";
import { ExecutionDiagnostics } from "../../src/execution/diagnostics/operation";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { isJsonObject } from "flarex-protocol/json";
import { prepareLogicalCanonicalDocumentSemantics } from "../../src/storage/documents/logicalDocuments/relationalRows";
import { decodeStoredAppRowRevisionEvidenceEffect, inspectStoredAppDocumentEvidence } from "../../src/storage/documents/appRowCanonicalEvidence";
import { detachLogicalDocumentChanges } from "../../src/storage/documents/logicalDocuments/detachChanges";
import { validateLogicalDocumentChanges } from "../../src/storage/documents/logicalDocuments/contribution";
import { bindLogicalInsertionRoot, hasLogicalInsertionEvidence } from "../../src/storage/documents/logicalDocuments/insertionOrder";
import { capturePrivateJsonData } from "../../src/values/privateJsonData";

const tableId = CatalogTableIdSchema.make(1);
const scopeId = ScopeIdSchema.make("scope_91000000-0000-4000-8000-000000000001");
const snapshotCommitSeq = CommitSeqSchema.make(1n);
// SAFETY: the root issuer authenticates this opaque handle by object identity;
// this local working-set fixture does not invoke the journal issuer.
const attempt = Object.freeze({}) as SessionJournalAttempt;
const attemptFence = "1";
const missingId = appDocumentIdV1FromRowIdentity({ tableId,
  rowId: decodeAppRowIdHexV1("ffffffffffffffffffffffffffffffff") });

it("preserves canonical metadata ordering across punctuation and non-ASCII names at seal", () =>
  runEffect(Effect.gen(function* () {
    const metadataWatermark = MetadataSequenceSchema.make(1n);
    const pins = { attempt, scopeId, snapshotCommitSeq, attemptFence, metadataWatermark };
    const root = makeLogicalDocumentRootEvaluator(pins, { identities: 16, workingBytes: 16_000 });
    try {
      const state = attachLogicalDocumentRootEvaluator(root, pins);
      if (state === null) throw new Error("Missing local evaluator owner state");
      for (const name of ["é", "a_", "a.", "a-"]) expect(recordLogicalDocumentRootMetadataDependency(state,
        LogicalMetadataReadDependencySchema.make({ kind: "metadata", namespace: "binding", ownerKey: "source_a",
          contractKey: JSON.stringify(["index", name]), capturedWatermark: metadataWatermark,
          observed: { kind: "present", semanticSha256Hex: "a".repeat(64) } }))).toBe(true);
      const dependencies = root.snapshot().metadataDependencies;
      if (dependencies === undefined) throw new Error("Missing captured finite dependencies");
      expect(dependencies.map(member => member.contractKey)).toEqual(["a-", "a.", "a_", "é"].map(name => JSON.stringify(["index", name])));
      const sealed = yield* canonicalizeSessionJournalEffect({
        format: SESSION_JOURNAL_FORMAT, protocolVersion: 1, valueCodecVersion: 1,
        finalSyscallSequence: 0n, finiteMetadataReservationSha256Hex: "b".repeat(64),
        readDependencies: dependencies, readUsage: { documentsRead: 0, semanticBytesRead: 0 },
        writes: [], operationUsage: { receiptEvidenceBytes: 0, participantWorkBytes: 0, participantWorkCalls: 0 }, participantOperations: [],
      });
      expect(sealed.journal.readDependencies).toEqual(dependencies);
    } finally { root.close(); }
  })));

const make = (read: () => Effect.Effect<never, Error> = () => Effect.fail(new Error("unexpected database read")),
  calls = 32, mechanics?: PreparedLogicalDocumentWriteMechanics) =>
  Effect.gen(function* () {
    let readCalls = 0;
    const lifetime = yield* makeBoundedRequestLifetime(
      (reason: RequestFailureReason) => new Error(reason),
      { calls, commandBytes: 128_000, commandMs: 30_000 },
      attempt, Object.freeze({}), "finite-local-request", "write", "require");
    const id = yield* lifetime.begin(lifetime.context);
    const root = makeLogicalDocumentRootEvaluator({ attempt, scopeId, snapshotCommitSeq, attemptFence },
      { identities: 64, workingBytes: 128_000 });
    const transaction = {} as FlarexMetadataTransaction;
    const reopen = () => makeLogicalDocumentWorkingSet({
      readTransaction: () => Effect.sync(() => { readCalls++; }).pipe(Effect.andThen(read())),
      requireAdmission: Effect.void,
      scopeId, clock: { scopeId, storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
        storageGenerationFence: StorageGenerationFenceSchema.make(1n), lastCommitSeq: snapshotCommitSeq,
        lastMetadataSequence: MetadataSequenceSchema.make(0n),
        oldestAvailableCommitSeq: CommitSeqSchema.make(0n), epoch: ScopeEpochSchema.make("test_epoch"),
        updatedAt: new Date(0) },
      snapshotCommitSeq, rootEvaluator: root, rootAttempt: attempt, rootAttemptFence: attemptFence,
      lifetime, tables: mechanics?.tables ?? [{ tableId, logicalName: "items" }],
      ...(mechanics === undefined ? {} : { writeMechanics: mechanics, searchDefinitions: mechanics.searchDefinitions,
        ...(mechanics.relationalCapabilities === undefined ? {} : { relationalCapabilities: mechanics.relationalCapabilities }) }), limits: {
        pageRows: 32, identities: 64, documentBytes: 16_000,
      }, validateDocument: () => Effect.void,
      error: reason => new Error(reason), uniqueConflict: () => new Error("uniqueConflict"),
    }, AppCreationTimeV1Schema.make(1), mechanics?.unique ?? [], mechanics?.indexes ?? [], undefined, transaction);
    const working = yield* reopen();
    return { root, lifetime, id, working, reopen, transaction, readCalls: () => readCalls };
  });

it.each(["insert charge", "row-use receipt"] as const)("retains the completed working-set charge Cause after trusted catch: %s", path =>
  runEffect(Effect.gen(function* () {
    const { root, lifetime, id, working, reopen, readCalls } = yield* make();
    try {
      const cleanup = new TypeError("working-set charge finalizer");
      let work: Effect.Effect<unknown, Error>;
      if (path === "insert charge") {
        Result.getOrThrow(lifetime.charge(lifetime.remainingBytes() - 64));
        work = working.documents.insert(lifetime.context, id, "items", {});
      } else {
        const inserted = yield* working.documents.insert(lifetime.context, id, "items", { name: "Ada" });
        if (typeof inserted._id !== "string") throw new Error("Missing genuine pending document ID");
        const borrowed = yield* reopen();
        const input = [inserted._id];
        const captured = Result.getOrThrow(capturePrivateJsonData(input, lifetime.remainingBytes(), reason => new Error(reason)));
        Result.getOrThrow(lifetime.charge(lifetime.remainingBytes() - captured.bytes - 16));
        work = borrowed.documents.getMany(lifetime.context, id, "items", input);
      }
      const before = root.snapshot();
      const completed = yield* Effect.exit(work.pipe(Effect.ensuring(Effect.die(cleanup))));
      if (Exit.isSuccess(completed)) throw new Error("Expected genuine working-set charge overflow");
      const first = completed.cause.reasons.find(Cause.isFailReason);
      if (first === undefined) throw new Error("Missing actual charge failure");
      expect(first.error.message).toBe("limitExceeded");
      expect(completed.cause.reasons.filter(reason => Cause.isDieReason(reason) && reason.defect === cleanup)).toHaveLength(1);
      expect(Result.isSuccess(lifetime.recordFailure(lifetime.context, completed.cause))).toBe(true);
      const sealed = yield* Effect.exit(lifetime.seal);
      if (Exit.isSuccess(sealed)) throw new Error("Trusted catch must not discharge the charge failure");
      expect(sealed.cause.reasons.filter(reason => Cause.isFailReason(reason) && reason.error === first.error)).toHaveLength(1);
      expect(sealed.cause.reasons.filter(reason => Cause.isDieReason(reason) && reason.defect === cleanup)).toHaveLength(1);
      expect(root.snapshot().attempts).toEqual(before.attempts);
      expect(root.snapshot().changes).toEqual(before.changes);
      expect(readCalls()).toBe(0);
    } finally {
      yield* lifetime.close;
      root.close();
    }
  })));

it("evaluates a finite root's pending writes, cached reads, and close without admission SQL", () =>
  runEffect(Effect.gen(function* () {
    const { root, lifetime, id, working, readCalls } = yield* make();
    const inserted = yield* working.documents.insert(lifetime.context, id, "items", { name: "Ada" });
    const documentId = inserted._id;
    if (typeof documentId !== "string") throw new Error("Missing inserted document ID");
    expect(yield* working.documents.get(lifetime.context, id, documentId, "items"))
      .toMatchObject({ name: "Ada" });
    expect(yield* working.documents.getMany(lifetime.context, id, "items", [documentId]))
      .toEqual([expect.objectContaining({ name: "Ada" })]);
    expect(readCalls()).toBe(0);
    yield* lifetime.seal;
    const changes = yield* working.close();
    expect(changes.attempts).toHaveLength(1);
    expect(readCalls()).toBe(0);
    yield* lifetime.close;
    root.close();
  })));

it("records real decoded positive and negative metadata once while preserving root correlation, capacity and closure", () =>
  runEffect(Effect.gen(function* () {
    const metadataWatermark = MetadataSequenceSchema.make(1n);
    const projection = yield* prepareFiniteMetadataProjection({ indexes: [], unique: [],
      application: { functions: [{ path: "a", semantic: { result: 1 } }], groups: [] } });
    const key = (path: string) => ({ namespace: "execution" as const, ownerKey: "application", contractKey: finiteMetadataContractKey("function", path) });
    const positive = Result.getOrThrow(captureFiniteMetadataDependency(projection, key("a"), metadataWatermark));
    const negative = Result.getOrThrow(captureFiniteMetadataDependency(projection, key("missing"), metadataWatermark));
    const bytes = 512 + 2 * (positive.ownerKey.length + positive.contractKey.length + negative.ownerKey.length + negative.contractKey.length);
    const pins = { attempt, scopeId, snapshotCommitSeq, attemptFence, metadataWatermark };
    const root = makeLogicalDocumentRootEvaluator(pins, { identities: 16, workingBytes: bytes });
    const state = attachLogicalDocumentRootEvaluator(root, pins);
    if (state === null) throw new Error("Missing genuine local root state");
    try {
      expect(Result.isSuccess(consumeLogicalDocumentRootMetadataDependency(state, projection, key("a")))).toBe(true);
      expect(Result.isSuccess(consumeLogicalDocumentRootMetadataDependency(state, projection, key("missing")))).toBe(true);
      const original = [...state.metadataConsumptions.get(projection)?.values() ?? []].find(member => member.contractKey === key("a").contractKey);
      expect(original).toBeDefined();
      expect(state.workingBytes).toBe(bytes);
      for (let index = 0; index < 4; index++) {
        expect(Result.isSuccess(consumeLogicalDocumentRootMetadataDependency(state, projection, key("a")))).toBe(true);
        expect(Result.isSuccess(consumeLogicalDocumentRootMetadataDependency(state, projection, key("missing")))).toBe(true);
      }
      expect([...state.metadataConsumptions.get(projection)?.values() ?? []]).toContain(original);
      expect(state.workingBytes).toBe(bytes);
      expect(recordLogicalDocumentRootMetadataDependency(state,
        Result.getOrThrow(captureFiniteMetadataDependency(projection, key("third"), metadataWatermark)))).toBe(false);
      expect(recordLogicalDocumentRootMetadataDependency(state, { ...positive, capturedWatermark: MetadataSequenceSchema.make(2n) })).toBe(false);
      const foreign = yield* prepareFiniteMetadataProjection({ indexes: [], unique: [],
        application: { functions: [{ path: "a", semantic: { result: 2 } }], groups: [] } });
      expect(recordLogicalDocumentRootMetadataDependency(state,
        Result.getOrThrow(captureFiniteMetadataDependency(foreign, key("a"), metadataWatermark)))).toBe(false);
      expect(consumeLogicalDocumentRootMetadataDependency(state, foreign, key("a")))
        .toMatchObject({ _tag: "Failure", failure: "observationMismatch" });
      disposeFiniteMetadataProjection(projection);
      expect(Result.isFailure(consumeLogicalDocumentRootMetadataDependency(state, projection, key("a")))).toBe(true);
      root.close();
      expect(state.metadataConsumptions.size).toBe(0);
      expect(consumeLogicalDocumentRootMetadataDependency(state, projection, key("missing")))
        .toMatchObject({ _tag: "Failure", failure: "closed" });
      expect(recordLogicalDocumentRootMetadataDependency(state, positive)).toBe(false);
      expect(recordLogicalDocumentRootMetadataDependency(state, negative)).toBe(false);
    } finally { root.close(); }
  })));

it("binds one activity contribution to its original source, cursor, generation and closing lifetime", () =>
  runEffect(Effect.gen(function* () {
    const owner = yield* make(), foreign = yield* make();
    const { root, lifetime, id, working } = owner;
    try {
      const cursor = working.activityCursor();
      const inserted = yield* working.documents.insert(lifetime.context, id, "items", { name: "Ada", nested: { label: "original" } });
      if (typeof inserted._id !== "string") throw new Error("Missing inserted identity");
      const issued = yield* working.activityContribution;
      const activity = yield* working.readActivityContribution(issued, cursor);
      expect(yield* Effect.result(foreign.working.readActivityContribution(issued)))
        .toMatchObject({ _tag: "Failure", failure: new Error("invalidAuthority") });
      expect(yield* Effect.result(working.readActivityContribution(issued, { ...cursor })))
        .toMatchObject({ _tag: "Failure", failure: new Error("invalidAuthority") });
      const project = makeLogicalCommerceActivityProjection(new Map([[tableId, "items"]]));
      const policy = yield* project(activity);
      const repeated = yield* project(activity);
      expect(repeated).toEqual(policy);
      expect(repeated.observedRows[0]?.row).toBe(policy.observedRows[0]?.row);
      const observed = policy.observedRows[0];
      if (observed === undefined) throw new Error("Missing projected row");
      expect(Reflect.set(observed.row, "name", "tampered")).toBe(false);
      const escaped = yield* working.activitySnapshot();
      escaped.attempts[0]?.after?.canonicalBytes.fill(0);
      expect((yield* working.readActivityContribution(issued)).attempts[0]?.after?.canonicalBytes.some(byte => byte !== 0)).toBe(true);
      yield* working.documents.patch(lifetime.context, id, inserted._id, { name: "Grace" }, "items");
      expect(yield* Effect.result(working.readActivityContribution(issued)))
        .toMatchObject({ _tag: "Failure", failure: new Error("invalidAuthority") });
      const refreshed = yield* working.activityContribution;
      const finalActivity = yield* working.readActivityContribution(refreshed);
      const rowId = decodeAppRowIdHexV1("00000000000000000000000000000001");
      const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
      const creationTime = AppCreationTimeV1Schema.make(1);
      const document = yield* Effect.promise(() => canonicalizeAppDocumentV1({ tableId, rowId, creationTime,
        fields: { name: "close-observation" } }));
      const revision: LiveAppRowRevisionV1 = { kind: "live", scopeId, tableId, rowId,
        scopeUuid: ScopeUuidV1Schema.make("91000000-0000-4000-8000-000000000001"),
        writeEpochUuid: ScopeEpochUuidV1Schema.make("91000000-0000-4000-8000-000000000002"),
        commitSeq: snapshotCommitSeq, prevCommitSeq: null,
        schemaVersionId: CatalogSchemaVersionIdSchema.make("root_activity"), creationTime, document };
      yield* Effect.fromResult(root.observePoint("items", { documentId, tableId, rowId, readAt: snapshotCommitSeq,
        dependency: { kind: "appRowPoint", documentId,
          observed: { kind: "present", revisionCommitSeq: snapshotCommitSeq } } }, revision));
      yield* lifetime.seal;
      const closed = yield* working.close();
      const closedContribution = yield* working.closedActivityContribution;
      expect(closedContribution).not.toBe(refreshed);
      expect(yield* Effect.result(working.readActivityContribution(refreshed)))
        .toMatchObject({ _tag: "Failure", failure: new Error("invalidAuthority") });
      const closedActivity = yield* working.readActivityContribution(closedContribution);
      expect(closedActivity.observedRows.map(row => row.value.name).toSorted()).toEqual(["Grace", "close-observation"]);
      expect(finalActivity.observedRows).toHaveLength(1);
      closed.attempts[1]?.after?.canonicalBytes.fill(0);
      expect(finalActivity.attempts[1]?.after?.canonicalBytes.some(byte => byte !== 0)).toBe(true);
      expect(finalActivity.observedRows[0]?.value.name).toBe("Grace");
      yield* lifetime.close;
      expect(yield* Effect.result(working.readActivityContribution(closedContribution)))
        .toMatchObject({ _tag: "Failure", failure: new Error("closed") });
    } finally { yield* lifetime.close; yield* foreign.lifetime.close; root.close(); foreign.root.close(); }
  })));

it("retains a stored row's immutable policy projection across fresh activity generations and refuses foreign mutable-view reuse", () =>
  runEffect(Effect.gen(function* () {
    const { root, lifetime, id, working } = yield* make();
    try {
      const rowId = decodeAppRowIdHexV1("00000000000000000000000000000001");
      const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
      const creationTime = AppCreationTimeV1Schema.make(1);
      const document = yield* Effect.promise(() => canonicalizeAppDocumentV1({ tableId, rowId, creationTime,
        fields: { name: "stored", nested: { label: "original" } } }));
      const revision: LiveAppRowRevisionV1 = { kind: "live", scopeId, tableId, rowId,
        scopeUuid: ScopeUuidV1Schema.make("91000000-0000-4000-8000-000000000001"),
        writeEpochUuid: ScopeEpochUuidV1Schema.make("91000000-0000-4000-8000-000000000002"),
        commitSeq: snapshotCommitSeq, prevCommitSeq: null,
        schemaVersionId: CatalogSchemaVersionIdSchema.make("stored_activity"), creationTime, document };
      yield* Effect.fromResult(root.observePoint("items", { documentId, tableId, rowId, readAt: snapshotCommitSeq,
        dependency: { kind: "appRowPoint", documentId, observed: { kind: "present", revisionCommitSeq: snapshotCommitSeq } } }, revision));
      const project = makeLogicalCommerceActivityProjection(new Map([[tableId, "items"]]));
      const initialContribution = yield* working.activityContribution;
      const firstActivity = yield* working.readActivityContribution(initialContribution);
      const initialBytes = lifetime.remainingBytes();
      const firstPolicy = yield* project(firstActivity);
      expect(lifetime.remainingBytes()).toBe(initialBytes);
      const escaped = structuredClone(firstPolicy.observedRows[0]?.row);
      if (escaped === undefined) throw new Error("Missing stored policy row");
      Reflect.set(escaped, "name", "escaped");
      yield* working.documents.get(lifetime.context, id, documentId, "items");
      const nextContribution = yield* working.activityContribution;
      expect(nextContribution).not.toBe(initialContribution);
      const nextActivity = yield* working.readActivityContribution(nextContribution);
      const nextPolicy = yield* project(nextActivity);
      expect(nextActivity.observedRows[0]).toBe(firstActivity.observedRows[0]);
      expect(nextPolicy.observedRows[0]?.row).toBe(firstPolicy.observedRows[0]?.row);
      expect(nextPolicy.observedRows[0]?.row).toMatchObject({ name: "stored", nested: { label: "original" } });
      expect(Reflect.set(nextPolicy.observedRows[0]?.row ?? {}, "name", "escaped")).toBe(false);
      const observed = firstActivity.observedRows[0];
      if (observed === undefined) throw new Error("Missing stored observation");
      const foreignValue = { name: "foreign-before", nested: { label: "foreign-before" } };
      const foreignObservation = { ...observed, value: foreignValue };
      const foreignActivity = { ...firstActivity, observedRows: [foreignObservation] };
      const foreignFirst = yield* project(foreignActivity);
      foreignValue.name = "foreign-after"; foreignValue.nested.label = "foreign-after";
      const foreignNext = yield* project(foreignActivity);
      expect(foreignNext.observedRows[0]?.row).not.toBe(foreignFirst.observedRows[0]?.row);
      expect(foreignFirst.observedRows[0]?.row).toMatchObject({ name: "foreign-before", nested: { label: "foreign-before" } });
      expect(foreignNext.observedRows[0]?.row).toMatchObject({ name: "foreign-after", nested: { label: "foreign-after" } });
      foreignObservation.tableName = "forged";
      expect(yield* Effect.result(project(foreignActivity)))
        .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    } finally { yield* lifetime.close; root.close(); }
  })));

it("selects observed rows by the original admitted source while retaining shared call mutation evidence", () =>
  runEffect(Effect.gen(function* () {
    const otherId = CatalogTableIdSchema.make(2);
    const failure = (reason: string) => new Error(reason);
    const first = yield* prepareLogicalWriteMechanics({ tables: [{ tableId, logicalName: "items" }], indexes: [], unique: [] }, failure);
    const second = yield* prepareLogicalWriteMechanics({ tables: [{ tableId: otherId, logicalName: "others" }], indexes: [], unique: [] }, failure);
    const foreign = yield* prepareLogicalWriteMechanics({ tables: [{ tableId, logicalName: "items" }], indexes: [], unique: [] }, failure);
    const combined = yield* combineLogicalWriteMechanics([first, second], failure);
    const { root, lifetime, id, working } = yield* make(undefined, 32, combined);
    try {
      const firstRow = yield* working.documents.insert(lifetime.context, id, "items", { name: "selected", nested: { label: "original" } });
      yield* working.documents.insert(lifetime.context, id, "others", { name: "other-source" });
      const cursor = working.activityCursor();
      if (typeof firstRow._id !== "string") throw new Error("Missing source row identity");
      yield* working.documents.patch(lifetime.context, id, firstRow._id, { name: "changed" }, "items");
      yield* working.documents.insert(lifetime.context, id, "others", { name: "shared-mutation" });
      const issued = yield* working.activityContribution;
      const selected = yield* working.readActivityContribution(issued, cursor, first);
      expect(selected.observedRows.map(row => row.value.name)).toEqual(["changed"]);
      expect(selected.attempts.map(row => [row.ordinal, row.tableName])).toEqual([[0, "items"], [1, "others"]]);
      expect(yield* Effect.result(working.readActivityContribution(issued, cursor, foreign)))
        .toMatchObject({ _tag: "Failure", failure: new Error("invalidAuthority") });
      const project = makeLogicalCommerceActivityProjection(new Map([[tableId, "items"], [otherId, "others"]]));
      const projected = yield* project(selected);
      expect(projected.observedRows).toHaveLength(1);
      expect(projected.mutations.map(row => row.table)).toEqual(["items", "others"]);
      const complete = yield* working.readActivityContribution(issued, cursor);
      expect(complete.observedRows.map(row => row.value.name).toSorted()).toEqual(["changed", "shared-mutation"]);
      expect((yield* working.readActivityContribution(issued)).observedRows).toHaveLength(3);
      expect(projected.observedRows[0]?.row).toMatchObject({ nested: { label: "original" } });
      expect(Reflect.set(projected.observedRows[0]?.row ?? {}, "name", "escaped")).toBe(false);
    } finally { yield* lifetime.close; root.close(); }
  })));

it("observes actual lazy WorkingSet operations only through the explicitly provided SDK policy", () => {
  const names: string[] = [];
  return runEffect(Effect.gen(function* () {
    const { root, lifetime, id, working } = yield* make();
    try {
      const insert = working.documents.insert(lifetime.context, id, "items", { name: "Ada" });
      expect(names).not.toContain("LogicalDocuments.insert");
      yield* insert;
      yield* lifetime.seal;
      yield* working.close();
      expect(names).toContain("LogicalDocuments.make");
      expect(names).toContain("LogicalDocuments.insert");
      expect(names).toContain("LogicalDocuments.close");
      expect(names).toContain("BoundedRequest.makeLifetime");
      expect(names).toContain("BoundedRequest.operation");
      expect(names).toContain("BoundedRequest.enter");
      expect(names).toContain("BoundedRequest.resolveId");
      expect(names.filter(name => name === "BoundedRequest.checkContext").length).toBeGreaterThanOrEqual(2);
    } finally { yield* lifetime.close; root.close(); }
  }).pipe(Effect.provideService(ExecutionDiagnostics, {
    observe: (name, work) => Effect.sync(() => { names.push(name); }).pipe(Effect.andThen(work)),
  })));
});

it("detaches activity and final graph values once without lending mutable root evidence", () =>
  runEffect(Effect.gen(function* () {
    const { root, lifetime, id, working } = yield* make();
    try {
      const inserted = yield* working.documents.insert(lifetime.context, id, "items", { name: "Ada", nested: { label: "original" } });
      if (typeof inserted._id !== "string") throw new Error("Missing inserted identity");
      const activity = yield* working.activitySnapshot();
      const observed = activity.observedRows[0], after = activity.attempts[0]?.after;
      if (observed === undefined || after == null) throw new Error("Missing captured activity");
      Reflect.set(observed.value, "name", "activity-tampered");
      after.canonicalBytes.fill(0);
      const beforeClose = root.snapshot();
      const observedRoot = beforeClose.observedRows[0], change = beforeClose.changes[0];
      if (observedRoot === undefined || change?.kind !== "live") throw new Error("Missing captured graph");
      expect(observedRoot.value).toMatchObject({ name: "Ada", nested: { label: "original" } });
      expect(change.document.canonicalBytes.some(byte => byte !== 0)).toBe(true);
      Reflect.set(observedRoot.value, "name", "graph-tampered");
      change.document.canonicalBytes.fill(0);
      yield* lifetime.seal;
      const closed = yield* working.close();
      expect(closed.observedRows[0]?.value).toMatchObject({ name: "Ada" });
      const closedAfter = closed.attempts[0]?.after;
      if (closedAfter == null) throw new Error("Missing detached close value");
      expect(closedAfter.canonicalBytes.some(byte => byte !== 0)).toBe(true);
      Reflect.set(closed.observedRows[0]?.value ?? {}, "name", "close-tampered");
      closedAfter.canonicalBytes.fill(0);
      expect(root.snapshot().observedRows[0]?.value).toMatchObject({ name: "Ada" });
      const final = root.snapshot().changes[0];
      expect(final?.kind === "live" && final.document.canonicalBytes.some(byte => byte !== 0)).toBe(true);
    } finally { yield* lifetime.close; root.close(); }
  })));

it("invalidates prepared activity for work after a snapshot and preserves root transfer revocation", () =>
  runEffect(Effect.gen(function* () {
    const { root, lifetime, id, working, readCalls } = yield* make();
    try {
      const inserted = yield* working.documents.insert(lifetime.context, id, "items", { name: "Ada" });
      if (typeof inserted._id !== "string") throw new Error("Missing inserted document identity");
      const first = yield* working.activitySnapshot();
      expect(first.attempts).toHaveLength(1);
      yield* working.documents.patch(lifetime.context, id, inserted._id, { name: "Grace" }, "items");
      yield* working.documents.insert(lifetime.context, id, "items", { name: "Lin" });
      const second = yield* working.activitySnapshot();
      expect(second.attempts).toHaveLength(3);
      expect(second.observedRows.map(row => row.value.name).toSorted()).toEqual(["Grace", "Lin"]);
      expect(first.observedRows[0]?.value.name).toBe("Ada");
      const escaped = second.attempts[1]?.after;
      if (escaped == null) throw new Error("Missing late patch activity");
      escaped.canonicalBytes.fill(0);
      Reflect.set(second.observedRows[0]?.value ?? {}, "name", "escaped");
      yield* lifetime.seal;
      const closed = yield* working.close();
      expect(closed.attempts).toHaveLength(3);
      expect(closed.observedRows.map(row => row.value.name).toSorted()).toEqual(["Grace", "Lin"]);
      const projectedGraph = root.snapshot();
      const expectedNames = projectedGraph.observedRows.map(row => row.value.name);
      const capsule = yield* Effect.fromResult(takeLogicalDocumentRootSnapshot(root));
      const transferred = borrowClosedLogicalDocumentRoot(capsule, root, attempt);
      if (transferred === undefined) throw new Error("Missing issued root transfer");
      expect(transferred.graph.changes).toHaveLength(2);
      expect(transferred.originalRows).toEqual([]);
      expect(transferred.graph.attempts[1]?.after?.canonicalBytes.some(byte => byte !== 0)).toBe(true);
      const otherRoot = makeLogicalDocumentRootEvaluator({ attempt, scopeId, snapshotCommitSeq, attemptFence },
        { identities: 64, workingBytes: 128_000 });
      try {
        expect(borrowClosedLogicalDocumentRoot({ ...capsule }, root, attempt)).toBeUndefined();
        expect(borrowClosedLogicalDocumentRoot(capsule, otherRoot, attempt)).toBeUndefined();
        // SAFETY: this is a distinct opaque handle used only for issuer refusal.
        const otherAttempt = Object.freeze({}) as SessionJournalAttempt;
        expect(consumeClosedLogicalDocumentRoot(capsule, root, otherAttempt)).toBeUndefined();
        const projected = projectedGraph.changes[0];
        if (projected?.kind !== "live") throw new Error("Missing retained live document");
        projected.document.canonicalBytes.fill(0);
        const projectedValue = projected.document.valueJson;
        if (typeof projectedValue !== "object" || projectedValue === null) throw new Error("Missing projected document object");
        Reflect.set(projectedValue, "name", "escaped");
        const owned = consumeClosedLogicalDocumentRoot(capsule, root, attempt);
        expect(owned?.graph.observedRows.map(row => row.value.name)).toEqual(expectedNames);
        expect(owned?.graph.changes[0]?.kind === "live" && owned.graph.changes[0].document.canonicalBytes.some(byte => byte !== 0)).toBe(true);
        expect(consumeClosedLogicalDocumentRoot(capsule, root, attempt)).toBeUndefined();
        expect(borrowClosedLogicalDocumentRoot(capsule, root, attempt)).toBeUndefined();
      } finally { otherRoot.close(); }
      expect(() => root.snapshot()).toThrow("closed");
      expect(() => takeLogicalDocumentRootSnapshot({ ...root })).toThrow("foreign");
      expect(() => takeLogicalDocumentRootSnapshot(root)).toThrow("closed");
      expect(readCalls()).toBe(0);
    } finally { yield* lifetime.close; root.close(); }
  })));

it("records cached point and batch rereads after their cursor without replaying unrelated retained rows", () =>
  runEffect(Effect.gen(function* () {
    const { root, lifetime, id, working, readCalls } = yield* make();
    try {
      const selected = yield* working.documents.insert(lifetime.context, id, "items", { name: "selected" });
      const unrelated = yield* working.documents.insert(lifetime.context, id, "items", { name: "unrelated" });
      if (typeof selected._id !== "string" || typeof unrelated._id !== "string") throw new Error("Missing cached reread identities");
      const cursor = working.activityCursor();
      expect((yield* working.activitySnapshot(cursor)).observedRows).toEqual([]);
      yield* working.documents.get(lifetime.context, id, selected._id, "items");
      const first = yield* working.readActivityContribution(yield* working.activityContribution, cursor);
      expect(first.observedRows.map(row => row.value.name)).toEqual(["selected"]);
      expect(first.attempts).toEqual([]);
      const project = makeLogicalCommerceActivityProjection(new Map([[tableId, "items"]]));
      const policy = yield* project(first);
      yield* working.documents.getMany(lifetime.context, id, "items", [selected._id]);
      const repeated = yield* working.readActivityContribution(yield* working.activityContribution, cursor);
      expect(repeated.observedRows).toHaveLength(1);
      expect((yield* project(repeated)).observedRows[0]?.row).toBe(policy.observedRows[0]?.row);
      const next = working.activityCursor();
      expect((yield* working.activitySnapshot(next)).observedRows).toEqual([]);
      yield* working.documents.get(lifetime.context, id, unrelated._id, "items");
      expect((yield* working.activitySnapshot(next)).observedRows.map(row => row.value.name)).toEqual(["unrelated"]);
      expect((yield* working.activitySnapshot()).observedRows).toHaveLength(2);
      expect(yield* Effect.result(working.activitySnapshot({ ...next })))
        .toMatchObject({ _tag: "Failure", failure: new Error("invalidAuthority") });
      expect(readCalls()).toBe(0);
      yield* lifetime.seal;
      const closed = yield* working.close();
      expect(closed.observedRows.map(row => row.value.name).toSorted()).toEqual(["selected", "unrelated"]);
      expect(closed.attempts).toHaveLength(2);
    } finally { yield* lifetime.close; root.close(); }
  })));

it("detaches call-local cursor activity while retaining complete aggregate rows and relative ordinals", () =>
  runEffect(Effect.gen(function* () {
    const { root, lifetime, id, working } = yield* make();
    try {
      const changed = yield* working.documents.insert(lifetime.context, id, "items", { name: "Ada", nested: { label: "before" } });
      yield* working.documents.insert(lifetime.context, id, "items", { name: "untouched" });
      if (typeof changed._id !== "string") throw new Error("Missing cursor document identity");
      const completeBefore = yield* working.activitySnapshot();
      const cursor = working.activityCursor();
      const before = yield* working.activitySnapshot(cursor);
      expect(before.attempts).toEqual([]);
      expect(before.observedRows).toEqual([]);
      yield* working.documents.patch(lifetime.context, id, changed._id, { name: "Grace" }, "items");
      const delta = yield* working.activitySnapshot(cursor);
      expect(delta.attempts.map(member => member.ordinal)).toEqual([0]);
      expect(delta.attempts[0]?.operation).toBe("patch");
      expect(delta.observedRows.map(row => row.value.name)).toEqual(["Grace"]);
      expect(before.observedRows).toEqual([]);
      expect(completeBefore.observedRows.map(row => row.value.name).toSorted()).toEqual(["Ada", "untouched"]);
      const after = delta.attempts[0]?.after;
      if (after == null) throw new Error("Missing cursor canonical value");
      after.canonicalBytes.fill(0);
      Reflect.set(delta.observedRows[0]?.value ?? {}, "name", "escaped");
      const escapedNested = after.valueJson;
      if (typeof escapedNested !== "object" || escapedNested === null || Array.isArray(escapedNested))
        throw new Error("Missing cursor JSON document");
      const nested = Reflect.get(escapedNested, "nested");
      if (typeof nested !== "object" || nested === null) throw new Error("Missing cursor nested value");
      Reflect.set(nested, "label", "escaped nested value");
      const next = yield* working.activitySnapshot(cursor);
      expect(next.attempts[0]?.after?.canonicalBytes.some(byte => byte !== 0)).toBe(true);
      expect(next.attempts[0]?.after?.valueJson).toMatchObject({ nested: { label: "before" } });
      expect(next.observedRows.map(row => row.value.name)).toEqual(["Grace"]);
      yield* lifetime.seal;
      const closed = yield* working.close();
      expect(closed.attempts.map(member => member.ordinal)).toEqual([0, 1, 2]);
      expect(closed.observedRows.map(row => row.value.name).toSorted()).toEqual(["Grace", "untouched"]);
    } finally { yield* lifetime.close; root.close(); }
  })));

it("checks live authority on the next uncached read after tentative local work", () =>
  runEffect(Effect.gen(function* () {
    const revoked = new Error("revoked at checked read");
    const { root, lifetime, id, working, readCalls } = yield* make(() => Effect.fail(revoked));
    const inserted = yield* working.documents.insert(lifetime.context, id, "items", { name: "Ada" });
    if (typeof inserted._id !== "string") throw new Error("Missing inserted document ID");
    expect(yield* working.documents.get(lifetime.context, id, inserted._id, "items"))
      .toMatchObject({ name: "Ada" });
    expect(readCalls()).toBe(0);
    const refusal = yield* Effect.result(working.documents.get(lifetime.context, id, missingId, "items"));
    expect(refusal).toMatchObject({ _tag: "Failure", failure: revoked });
    expect(readCalls()).toBe(1);
    expect(Exit.isFailure(yield* Effect.exit(lifetime.seal))).toBe(true);
    yield* lifetime.close;
    root.close();
  })));

it("rejects a cancelled finite root before capturing foreign write input", () =>
  runEffect(Effect.gen(function* () {
    const { root, lifetime, id, working, readCalls } = yield* make();
    let captures = 0;
    const input = new Proxy({}, { ownKeys: () => { captures++; throw new Error("foreign capture"); } });
    root.close();
    const refusal = yield* Effect.result(working.documents.insert(lifetime.context, id, "items", input));
    expect(refusal).toMatchObject({ _tag: "Failure", failure: new Error("closed") });
    expect(captures).toBe(0);
    expect(readCalls()).toBe(0);
    yield* lifetime.close;
  })));

it("refuses wrong-context and exhausted-call writes before Proxy capture", () =>
  runEffect(Effect.gen(function* () {
    let captures = 0;
    const input = new Proxy({}, { ownKeys: () => { captures++; throw new Error("foreign capture"); } });
    const scoped = yield* make();
    const foreign = yield* make();
    const wrongContext = yield* Effect.result(scoped.working.documents.insert(
      foreign.lifetime.context, scoped.id, "items", input));
    expect(wrongContext).toMatchObject({ _tag: "Failure", failure: new Error("invalidAuthority") });
    expect(captures).toBe(0);
    expect(scoped.readCalls()).toBe(0);
    yield* scoped.lifetime.close;
    yield* foreign.lifetime.close;
    scoped.root.close();
    foreign.root.close();

    const limited = yield* make(undefined, 2);
    const overBudget = yield* Effect.result(limited.working.documents.insert(
      limited.lifetime.context, limited.id, "items", input));
    expect(overBudget).toMatchObject({ _tag: "Failure", failure: new Error("limitExceeded") });
    expect(captures).toBe(0);
    expect(limited.readCalls()).toBe(0);
    yield* limited.lifetime.close;
    limited.root.close();
  })));

it("transfers authentic source semantics into private root revisions while public point copies remain foreign", () =>
  runEffect(Effect.gen(function* () {
    const { root, lifetime } = yield* make();
    const pins = { attempt, scopeId, snapshotCommitSeq, attemptFence };
    const state = attachLogicalDocumentRootEvaluator(root, pins);
    if (state === null) throw new Error("Missing authentic root state");
    const rowId = decodeAppRowIdHexV1("00000000000000000000000000000001");
    const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
    const creationTime = AppCreationTimeV1Schema.make(1);
    const canonical = yield* Effect.promise(() => canonicalizeAppDocumentV1({ tableId, rowId, creationTime,
      fields: { name: "original", nested: { label: "owned" } } }));
    const revision = yield* decodeStoredAppRowRevisionEvidenceEffect({ scopeId, tableId, rowId,
      scopeUuid: ScopeUuidV1Schema.make("91000000-0000-4000-8000-000000000001"),
      writeEpochUuid: ScopeEpochUuidV1Schema.make("91000000-0000-4000-8000-000000000002"),
      commitSeq: snapshotCommitSeq, prevCommitSeq: null,
      schemaVersionId: CatalogSchemaVersionIdSchema.make("root_interpretation"), creationTime },
      { tableId, rowId, creationTime, codecVersion: canonical.codecVersion, canonicalBytes: canonical.canonicalBytes, sha256: canonical.sha256 });
    const document = revision.document;
    const validator = vi.fn(() => Result.succeed(true));
    const semantics = prepareLogicalCanonicalDocumentSemantics(validator, () => new Error("storedCorruption"));
    yield* Effect.fromResult(semantics.validate(document));
    const observation = { documentId, tableId, rowId, readAt: snapshotCommitSeq,
      dependency: { kind: "appRowPoint" as const, documentId,
        observed: { kind: "present" as const, revisionCommitSeq: snapshotCommitSeq } } };
    const refused = makeLogicalDocumentRootEvaluator(pins, { identities: 4, workingBytes: 1 });
    const foreignRoot = makeLogicalDocumentRootEvaluator(pins, { identities: 4, workingBytes: 16_000 });
    try {
      expect(refused.observePoint("items", observation, revision)).toMatchObject({ _tag: "Failure", failure: "limitExceeded" });
      expect(refused.point(tableId, rowId)).toBeUndefined();
      yield* Effect.fromResult(foreignRoot.observePoint("items", observation, { ...revision }));
      const foreignState = attachLogicalDocumentRootEvaluator(foreignRoot, pins);
      const foreign = foreignState?.rows.get(documentId)?.current;
      if (foreign == null) throw new Error("Missing synthetic frame document");
      expect(Result.getOrThrow(semantics.inspect(foreign))).toBeUndefined();
      yield* Effect.fromResult(root.observePoint("items", observation, revision));
      const original = state.rows.get(documentId)?.current;
      if (original == null) throw new Error("Missing owned original revision");
      expect(state.workingBytes).toBe(256 + document.canonicalBytes.byteLength);
      expect(original).not.toBe(document);
      expect(original.canonicalBytes).not.toBe(document.canonicalBytes);
      yield* Effect.fromResult(semantics.validate(original));
      expect(validator).toHaveBeenCalledTimes(1);
      const escaped = root.point(tableId, rowId)?.document;
      if (escaped == null) throw new Error("Missing detached public point");
      expect(Result.getOrThrow(semantics.inspect(escaped))).toBeUndefined();
      escaped.sha256.fill(0);
      document.sha256.fill(0);
      expect(Result.getOrThrow(semantics.inspect(original))).toMatchObject({ name: "original" });
      const replacement = yield* Effect.promise(() => canonicalizeAppDocumentV1({ tableId, rowId, creationTime,
        fields: { name: "replacement" } }));
      yield* Effect.fromResult(semantics.validate(replacement));
      const originalBytes = state.workingBytes;
      yield* Effect.fromResult(root.writePoint("items", observation, { kind: "live", creationTime, document: replacement }, "replace"));
      const current = state.rows.get(documentId)?.current;
      if (current == null) throw new Error("Missing owned current revision");
      expect(state.workingBytes).toBe(originalBytes + 128 + replacement.canonicalBytes.byteLength);
      yield* Effect.fromResult(semantics.validate(current));
      expect(validator).toHaveBeenCalledTimes(2);
      current.canonicalBytes.fill(0);
      expect(semantics.inspect(current)).toMatchObject({ _tag: "Failure", failure: new Error("storedCorruption") });
      expect(Result.getOrThrow(semantics.inspect(original))).toMatchObject({ name: "original" });
    } finally { foreignRoot.close(); refused.close(); yield* lifetime.close; root.close(); }
  })));

it("transfers only actual stored decoder evidence at root ingestion and preserves later corruption and copy defect cuts", () =>
  runEffect(Effect.gen(function* () {
    const { root, lifetime } = yield* make();
    const pins = { attempt, scopeId, snapshotCommitSeq, attemptFence };
    const state = attachLogicalDocumentRootEvaluator(root, pins);
    if (state === null) throw new Error("Missing authentic root state");
    const rowId = decodeAppRowIdHexV1("00000000000000000000000000000001");
    const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
    const creationTime = AppCreationTimeV1Schema.make(1);
    const canonical = yield* Effect.promise(() => canonicalizeAppDocumentV1({ tableId, rowId, creationTime, fields: { name: "stored" } }));
    const revision = yield* decodeStoredAppRowRevisionEvidenceEffect({ scopeId, tableId, rowId,
      scopeUuid: ScopeUuidV1Schema.make("91000000-0000-4000-8000-000000000001"),
      writeEpochUuid: ScopeEpochUuidV1Schema.make("91000000-0000-4000-8000-000000000002"),
      commitSeq: snapshotCommitSeq, prevCommitSeq: null,
      schemaVersionId: CatalogSchemaVersionIdSchema.make("root_stored"), creationTime },
      { tableId, rowId, creationTime, codecVersion: canonical.codecVersion, canonicalBytes: canonical.canonicalBytes, sha256: canonical.sha256 });
    const document = revision.document;
    const observation = { documentId, tableId, rowId, readAt: snapshotCommitSeq,
      dependency: { kind: "appRowPoint" as const, documentId,
        observed: { kind: "present" as const, revisionCommitSeq: snapshotCommitSeq } } };
    const foreignRoot = makeLogicalDocumentRootEvaluator(pins, { identities: 4, workingBytes: 16_000 });
    try {
      yield* Effect.fromResult(root.observePoint("items", observation, revision));
      const owned = state.rows.get(documentId)?.current;
      if (owned == null) throw new Error("Missing owned decoder revision");
      expect(Result.getOrThrow(inspectStoredAppDocumentEvidence(owned))?.runtime).toBe(owned.value);
      const escaped = root.point(tableId, rowId)?.document;
      if (escaped == null) throw new Error("Missing public decoder point");
      expect(Result.getOrThrow(inspectStoredAppDocumentEvidence(escaped))).toBeUndefined();
      yield* Effect.fromResult(foreignRoot.observePoint("items", observation, structuredClone(revision)));
      const foreignState = attachLogicalDocumentRootEvaluator(foreignRoot, pins);
      const foreign = foreignState?.rows.get(documentId)?.current;
      if (foreign == null) throw new Error("Missing foreign root revision");
      expect(Result.getOrThrow(inspectStoredAppDocumentEvidence(foreign))).toBeUndefined();
      foreignRoot.forgetUnwrittenPoint(tableId, rowId);
      // A self-removing foreign accessor can return the genuine document at
      // the original guard, then swap the body copied by native structuredClone.
      // Its resulting all-data shape must never acquire frame provenance.
      const swapping = { ...revision };
      let documentReads = 0;
      Object.defineProperty(swapping, "document", { enumerable: true, configurable: true, get() {
        documentReads++;
        Object.defineProperty(swapping, "document", { value: structuredClone(document), enumerable: true, configurable: true });
        return document;
      } });
      yield* Effect.fromResult(foreignRoot.observePoint("items", observation, swapping));
      const swapped = foreignState?.rows.get(documentId)?.current;
      if (swapped == null) throw new Error("Missing foreign swapped revision");
      expect(documentReads).toBe(1);
      expect(Result.getOrThrow(inspectStoredAppDocumentEvidence(swapped))).toBeUndefined();
      foreignRoot.forgetUnwrittenPoint(tableId, rowId);
      const reflection = vi.fn((): never => { throw new Error("foreign descriptor trap"); });
      const proxy = new Proxy(revision, { getOwnPropertyDescriptor: reflection });
      let proxyRefusal: unknown;
      try { foreignRoot.observePoint("items", observation, proxy); } catch (cause) { proxyRefusal = cause; }
      expect(proxyRefusal).toBeInstanceOf(DOMException);
      if (!(proxyRefusal instanceof DOMException)) throw new Error("Missing native clone refusal");
      expect(proxyRefusal.name).toBe("DataCloneError");
      expect(reflection).not.toHaveBeenCalled();
      expect(foreignRoot.point(tableId, rowId)).toBeUndefined();
      document.canonicalBytes.fill(0);
      expect(Result.getOrThrow(inspectStoredAppDocumentEvidence(owned))?.runtime).toBe(owned.value);
      owned.sha256.fill(0);
      expect(inspectStoredAppDocumentEvidence(owned)).toMatchObject({ _tag: "Failure", failure: { issue: { reason: "sha256Mismatch" } } });
      foreignRoot.forgetUnwrittenPoint(tableId, rowId);
      yield* Effect.fromResult(foreignRoot.observePoint("items", observation, revision));
      const changed = foreignState?.rows.get(documentId)?.current;
      if (changed == null) throw new Error("Missing changed stored revision");
      expect(inspectStoredAppDocumentEvidence(changed)).toMatchObject({ _tag: "Failure", failure: { issue: { reason: "canonicalBytesMismatch" } } });
      foreignRoot.forgetUnwrittenPoint(tableId, rowId);
      const defect = new Error("canonical clone getter");
      const late = vi.fn((): never => { throw new Error("later frame getter"); });
      const bad = { ...revision, document: { ...canonical, get value(): never { throw defect; } }, get later(): never { return late(); } };
      let copyRefusal: unknown;
      try { foreignRoot.observePoint("items", observation, bad); } catch (cause) { copyRefusal = cause; }
      expect(copyRefusal).toBe(defect);
      expect(late).not.toHaveBeenCalled();
      expect(foreignRoot.point(tableId, rowId)).toBeUndefined();
    } finally { foreignRoot.close(); yield* lifetime.close; root.close(); }
  })));

it("transfers one detached original and graph while preserving their canonical identity", () =>
  runEffect(Effect.gen(function* () {
    const root = makeLogicalDocumentRootEvaluator({ attempt, scopeId, snapshotCommitSeq, attemptFence },
      { identities: 4, workingBytes: 16_000 });
    const rowId = decodeAppRowIdHexV1("00000000000000000000000000000001");
    const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
    const creationTime = AppCreationTimeV1Schema.make(1);
    const document = yield* Effect.promise(() => canonicalizeAppDocumentV1({ tableId, rowId, creationTime,
      fields: { name: "original", bytes: new Uint8Array([1, 2, 3]).buffer } }));
    const revision: LiveAppRowRevisionV1 = { kind: "live", scopeId, tableId, rowId,
      scopeUuid: ScopeUuidV1Schema.make("91000000-0000-4000-8000-000000000001"),
      writeEpochUuid: ScopeEpochUuidV1Schema.make("91000000-0000-4000-8000-000000000002"),
      commitSeq: snapshotCommitSeq, prevCommitSeq: null,
      schemaVersionId: CatalogSchemaVersionIdSchema.make("root_original"), creationTime, document };
    const observation = { documentId, tableId, rowId, readAt: snapshotCommitSeq,
      dependency: { kind: "appRowPoint" as const, documentId,
        observed: { kind: "present" as const, revisionCommitSeq: snapshotCommitSeq } } };
    try {
      yield* Effect.fromResult(root.observePoint("items", observation, revision));
      yield* Effect.fromResult(root.writePoint("items", observation, { kind: "deleted" }, "delete"));
      document.canonicalBytes.fill(0);
      const inspected = yield* Effect.fromResult(root.snapshotOriginalRows());
      inspected[0]?.document.canonicalBytes.fill(0);
      const point = root.point(tableId, rowId);
      point?.originalDocument?.sha256.fill(0);
      const capsule = yield* Effect.fromResult(takeLogicalDocumentRootSnapshot(root));
      const closed = consumeClosedLogicalDocumentRoot(capsule, root, attempt);
      if (closed === undefined) throw new Error("Missing genuine root transfer");
      const original = closed.originalRows[0]?.document;
      expect(original?.canonicalBytes.some(byte => byte !== 0)).toBe(true);
      expect(original?.sha256.some(byte => byte !== 0)).toBe(true);
      expect(closed.graph.attempts[0]?.before).toBe(original);
      expect(closed.graph.changes[0]?.kind).toBe("deleted");
      expect(attachLogicalDocumentRootEvaluator(root, { attempt, scopeId, snapshotCommitSeq, attemptFence })).toBeNull();
      expect(root.point(tableId, rowId)).toBeUndefined();
      expect(root.points()).toEqual([]);
    } finally { root.close(); }
  })));

it("retains genuine insertion claims through owner detachment and the closed-root transfer", () =>
  runEffect(Effect.gen(function* () {
    const { root, lifetime, transaction, readCalls } = yield* make();
    const rowId = decodeAppRowIdHexV1("00000000000000000000000000000031");
    const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId }), creationTime = AppCreationTimeV1Schema.make(1);
    const document = yield* Effect.promise(() => canonicalizeAppDocumentV1({ tableId, rowId, creationTime, fields: { name: "issued" } }));
    const observation = { documentId, tableId, rowId, readAt: snapshotCommitSeq,
      dependency: { kind: "appRowPoint" as const, documentId, observed: { kind: "missing" as const, basis: { kind: "noVisibleRevision" as const } } } };
    try {
      yield* Effect.fromResult(root.observePoint("items", observation, { kind: "missing" }));
      yield* Effect.fromResult(root.writePoint("items", observation, { kind: "live", creationTime, document }, "insert"));
      const original = root.snapshot(), detached = detachLogicalDocumentChanges(original);
      const issued = original.attempts[0], copied = detached.attempts[0];
      if (issued === undefined || copied === undefined) throw new Error("Missing actual root insertion claim");
      expect(issued.insertionEvidence).toBeDefined(); expect(copied.insertionEvidence).toBe(issued.insertionEvidence);
      expect(detached.insertionRoot).toBe(original.insertionRoot);
      expect(copied.after).not.toBe(issued.after); expect(copied.after?.sha256).not.toBe(issued.after?.sha256);
      expect(hasLogicalInsertionEvidence(scopeId, detached.insertionRoot, copied)).toBe(true);
      yield* validateLogicalDocumentChanges({ tx: transaction, scopeId, tables: new Set([tableId]), maximumIndexEntries: 8,
        error: reason => new Error(reason) }, detached);
      const capsule = yield* Effect.fromResult(takeLogicalDocumentRootSnapshot(root));
      const closed = consumeClosedLogicalDocumentRoot(capsule, root, attempt);
      if (closed === undefined) throw new Error("Missing authentic closed insertion root");
      expect(closed.graph.attempts[0]?.insertionEvidence).toBe(issued.insertionEvidence);
      yield* validateLogicalDocumentChanges({ tx: transaction, scopeId, tables: new Set([tableId]), maximumIndexEntries: 8,
        error: reason => new Error(reason) }, closed.graph);
      expect(readCalls()).toBe(0);
    } finally { yield* lifetime.close; root.close(); }
  })));

it("rejects correlated ordinal forgery, cloned claims and insertion evidence transferred across rows or scopes", () =>
  runEffect(Effect.gen(function* () {
    const { root, lifetime, transaction, readCalls } = yield* make();
    try {
      for (const [suffix, name] of [["41", "first"], ["42", "second"]] as const) {
        const rowId = decodeAppRowIdHexV1("000000000000000000000000000000" + suffix),
          documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId }), creationTime = AppCreationTimeV1Schema.make(1);
        const document = yield* Effect.promise(() => canonicalizeAppDocumentV1({ tableId, rowId, creationTime, fields: { name } }));
        const observation = { documentId, tableId, rowId, readAt: snapshotCommitSeq,
          dependency: { kind: "appRowPoint" as const, documentId, observed: { kind: "missing" as const, basis: { kind: "noVisibleRevision" as const } } } };
        yield* Effect.fromResult(root.observePoint("items", observation, { kind: "missing" }));
        yield* Effect.fromResult(root.writePoint("items", observation, { kind: "live", creationTime, document }, "insert"));
      }
      const graph = root.snapshot(), first = graph.attempts[0], second = graph.attempts[1];
      if (first?.insertionEvidence === undefined || second?.insertionEvidence === undefined) throw new Error("Missing genuine row-specific insertion proofs");
      const firstProof = first.insertionEvidence, secondProof = second.insertionEvidence, insertionRoot = graph.insertionRoot;
      if (insertionRoot === undefined) throw new Error("Missing authentic root insertion namespace");
      const secondOrdinal = second.insertionAttemptOrdinal;
      if (secondOrdinal === undefined) throw new Error("Missing second authentic insertion ordinal");
      const validate = (closed: typeof graph, selectedScope = scopeId) => validateLogicalDocumentChanges({ tx: transaction, scopeId: selectedScope,
        tables: new Set([tableId]), maximumIndexEntries: 8, error: reason => new Error(reason) }, closed);
      yield* validate(graph);
      const forgedOrdinal = { ...graph,
        changes: graph.changes.map(change => change.documentId === first.documentId ? { ...change, insertionOrder: { kind: "pending" as const, attemptOrdinal: 99 } } : change),
        attempts: graph.attempts.map(attempt => attempt === first ? { ...attempt, insertionAttemptOrdinal: 99 } : attempt) };
      expect(hasLogicalInsertionEvidence(scopeId, insertionRoot, { ...first, insertionAttemptOrdinal: 99 })).toBe(false);
      expect(hasLogicalInsertionEvidence(scopeId, insertionRoot, { ...first, insertionEvidence: structuredClone(firstProof) })).toBe(false);
      const clonedProof = { ...graph, attempts: graph.attempts.map(attempt => attempt === first
        ? { ...attempt, insertionEvidence: structuredClone(firstProof) } : attempt) };
      const transferredAttempt = { ...first, insertionEvidence: secondProof, insertionAttemptOrdinal: secondOrdinal };
      expect(hasLogicalInsertionEvidence(scopeId, graph.insertionRoot, transferredAttempt)).toBe(false);
      const transferredProof = { ...graph, attempts: graph.attempts.map(attempt => attempt === first ? transferredAttempt : attempt),
        changes: graph.changes.map(change => change.documentId === first.documentId ? { ...change,
          insertionOrder: { kind: "pending" as const, attemptOrdinal: secondOrdinal } } : change) };
      const clonedRoot = { ...graph, insertionRoot: structuredClone(insertionRoot) };
      for (const forged of [forgedOrdinal, clonedProof, transferredProof, clonedRoot, structuredClone(graph)])
        expect(yield* Effect.result(validate(forged))).toMatchObject({ _tag: "Failure", failure: new Error("invalidAuthority") });
      const foreignScope = ScopeIdSchema.make("scope_92000000-0000-4000-8000-000000000001");
      expect(hasLogicalInsertionEvidence(foreignScope, graph.insertionRoot, first)).toBe(false);
      expect(yield* Effect.result(validate(graph, foreignScope))).toMatchObject({ _tag: "Failure", failure: new Error("invalidAuthority") });
      const foreignRoot = makeLogicalDocumentRootEvaluator({ attempt, scopeId, snapshotCommitSeq, attemptFence }, { identities: 4, workingBytes: 16_000 });
      try {
        const rowId = decodeAppRowIdHexV1("00000000000000000000000000000041"), documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
        const observation = { documentId, tableId, rowId, readAt: snapshotCommitSeq,
          dependency: { kind: "appRowPoint" as const, documentId, observed: { kind: "missing" as const, basis: { kind: "noVisibleRevision" as const } } } };
        if (first.after === null) throw new Error("Missing inserted canonical body");
        yield* Effect.fromResult(foreignRoot.observePoint("items", observation, { kind: "missing" }));
        yield* Effect.fromResult(foreignRoot.writePoint("items", observation, { kind: "live", creationTime: AppCreationTimeV1Schema.make(1), document: first.after }, "insert"));
        const foreign = foreignRoot.snapshot(), foreignProof = foreign.attempts[0]?.insertionEvidence;
        if (foreignProof === undefined) throw new Error("Missing genuinely issued foreign-root claim");
        expect(foreign.attempts[0]?.insertionAttemptOrdinal).toBe(first.insertionAttemptOrdinal);
        expect(foreign.attempts[0]?.after?.sha256).toEqual(first.after.sha256);
        const transferredRootProof = { ...graph, attempts: graph.attempts.map(attempt => attempt === first ? { ...attempt, insertionEvidence: foreignProof } : attempt) };
        expect(hasLogicalInsertionEvidence(scopeId, insertionRoot, { ...first, insertionEvidence: foreignProof })).toBe(false);
        expect(yield* Effect.result(validate(transferredRootProof))).toMatchObject({ _tag: "Failure", failure: new Error("invalidAuthority") });
        if (foreign.insertionRoot === undefined) throw new Error("Missing genuine foreign insertion namespace");
        const transferredRootAndProof = { ...transferredRootProof, insertionRoot: foreign.insertionRoot };
        expect(hasLogicalInsertionEvidence(scopeId, foreign.insertionRoot, { ...first, insertionEvidence: foreignProof })).toBe(true);
        expect(yield* Effect.result(validate(transferredRootAndProof))).toMatchObject({ _tag: "Failure", failure: new Error("invalidAuthority") });
      } finally { foreignRoot.close(); }
      const replacement = yield* Effect.promise(() => canonicalizeAppDocumentV1({ tableId, rowId: decodeAppRowIdHexV1("00000000000000000000000000000041"),
        creationTime: AppCreationTimeV1Schema.make(1), fields: { name: "altered after issuance" } }));
      const changedBody = { ...graph, attempts: graph.attempts.map(attempt => attempt === first ? { ...attempt, after: replacement } : attempt),
        changes: graph.changes.map(change => change.documentId === first.documentId && change.kind === "live" ? { ...change, document: replacement } : change) };
      expect(yield* Effect.result(validate(changedBody))).toMatchObject({ _tag: "Failure", failure: new Error("invalidAuthority") });
      expect(hasLogicalInsertionEvidence(scopeId, insertionRoot, { ...first, after: replacement })).toBe(false);
      expect(readCalls()).toBe(0);
    } finally { yield* lifetime.close; root.close(); }
  })));

it("aliases genuine borrowed lifetime projections after finite insertion and refuses merging used roots", () =>
  runEffect(Effect.gen(function* () {
    const owner = yield* make(), independent = yield* make();
    const borrowed = yield* makeBoundedRequestLifetime((reason: RequestFailureReason) => new Error(reason),
      { calls: 16, commandBytes: 16_000, commandMs: 30_000 }, attempt, Object.freeze({}), "insertion-alias-borrower", "write", "require");
    try {
      const pins = { attempt, scopeId, snapshotCommitSeq, attemptFence }, state = attachLogicalDocumentRootEvaluator(owner.root, pins);
      if (state === null) throw new Error("Missing genuine evaluator allocation owner");
      const early = yield* Effect.fromResult(bindLogicalInsertionRoot(borrowed, scopeId));
      const handles = [early];
      for (const suffix of ["51", "52"]) {
        const rowId = decodeAppRowIdHexV1("000000000000000000000000000000" + suffix),
          documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId }), creationTime = AppCreationTimeV1Schema.make(1);
        const document = yield* Effect.promise(() => canonicalizeAppDocumentV1({ tableId, rowId, creationTime, fields: { name: suffix } }));
        const observation = { documentId, tableId, rowId, readAt: snapshotCommitSeq,
          dependency: { kind: "appRowPoint" as const, documentId, observed: { kind: "missing" as const, basis: { kind: "noVisibleRevision" as const } } } };
        yield* Effect.fromResult(owner.root.observePoint("items", observation, { kind: "missing" }));
        yield* Effect.fromResult(owner.root.writePoint("items", observation, { kind: "live", creationTime, document }, "insert"));
        if (suffix === "51") {
          handles.push(Result.getOrThrow(bindLogicalInsertionRoot(borrowed, scopeId, state)));
          const projected = projectBoundedRequestLifetime(borrowed, failure => failure);
          handles.push(Result.getOrThrow(bindLogicalInsertionRoot(projected, scopeId)));
        }
      }
      const graph = owner.root.snapshot();
      expect(graph.attempts.map(attempt => attempt.insertionAttemptOrdinal)).toEqual([0, 1]);
      expect(handles).toHaveLength(3);
      expect(handles.every(handle => graph.attempts.every(attempt => hasLogicalInsertionEvidence(scopeId, handle, attempt)))).toBe(true);
      yield* independent.working.documents.insert(independent.lifetime.context, independent.id, "items", { name: "independent issued birth" });
      expect(bindLogicalInsertionRoot(independent.lifetime, scopeId, state)).toMatchObject({ _tag: "Failure", failure: "invalidAuthority" });
      expect(bindLogicalInsertionRoot(borrowed, ScopeIdSchema.make("scope_92000000-0000-4000-8000-000000000001"), state))
        .toMatchObject({ _tag: "Failure", failure: "invalidAuthority" });
    } finally { yield* borrowed.close; yield* independent.lifetime.close; independent.root.close(); yield* owner.lifetime.close; owner.root.close(); }
  })));

it.each([true, false])("refuses downgrading a genuine insertion graph by stripping all generation evidence (keep root: %s)", keepRoot =>
  runEffect(Effect.gen(function* () {
    const { root, lifetime, id, working, transaction } = yield* make();
    try {
      yield* working.documents.insert(lifetime.context, id, "items", { name: "genuine issued insertion" });
      const graph = root.snapshot();
      const validate = (closed: typeof graph) => validateLogicalDocumentChanges({ tx: transaction, scopeId,
        tables: new Set([tableId]), maximumIndexEntries: 8, error: reason => new Error(reason) }, closed);
      yield* validate(graph);
      const attempts = graph.attempts.map(({ insertionAttemptOrdinal: _ordinal, insertionEvidence: _proof, ...attempt }) => attempt);
      const changes = graph.changes.map(({ insertionOrder: _order, ...change }) => change);
      const { insertionRoot: _root, ...withoutRoot } = graph;
      const stripped = { ...(keepRoot ? graph : withoutRoot), attempts, changes };
      expect(yield* Effect.result(validate(stripped))).toMatchObject({ _tag: "Failure", failure: new Error("invalidAuthority") });
    } finally { yield* lifetime.close; root.close(); }
  })));

it.each(["empty", "unknown"] as const)("binds a registered %s graph's scope even without insertion attempts", kind =>
  runEffect(Effect.gen(function* () {
    const { root, lifetime, transaction } = yield* make();
    try {
      if (kind === "unknown") {
        const rowId = decodeAppRowIdHexV1("00000000000000000000000000000061"), documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId }),
          creationTime = AppCreationTimeV1Schema.make(1);
        const canonical = yield* Effect.promise(() => canonicalizeAppDocumentV1({ tableId, rowId, creationTime, fields: { name: "old unknown generation" } }));
        const revision = yield* decodeStoredAppRowRevisionEvidenceEffect({ scopeId, tableId, rowId,
          scopeUuid: ScopeUuidV1Schema.make("91000000-0000-4000-8000-000000000001"),
          writeEpochUuid: ScopeEpochUuidV1Schema.make("91000000-0000-4000-8000-000000000002"),
          commitSeq: snapshotCommitSeq, prevCommitSeq: null, schemaVersionId: CatalogSchemaVersionIdSchema.make("unknown_generation"), creationTime },
        { tableId, rowId, creationTime, codecVersion: canonical.codecVersion, canonicalBytes: canonical.canonicalBytes, sha256: canonical.sha256 });
        yield* Effect.fromResult(root.observePoint("items", { documentId, tableId, rowId, readAt: snapshotCommitSeq,
          dependency: { kind: "appRowPoint", documentId, observed: { kind: "present", revisionCommitSeq: snapshotCommitSeq } } }, revision));
      }
      const graph = root.snapshot();
      expect(graph.attempts).toEqual([]); expect(graph.changes).toEqual([]);
      const validate = (selectedScope: typeof scopeId) => validateLogicalDocumentChanges({ tx: transaction, scopeId: selectedScope,
        tables: new Set([tableId]), maximumIndexEntries: 8, error: reason => new Error(reason) }, graph);
      yield* validate(scopeId);
      expect(yield* Effect.result(validate(ScopeIdSchema.make("scope_92000000-0000-4000-8000-000000000001"))))
        .toMatchObject({ _tag: "Failure", failure: new Error("invalidAuthority") });
    } finally { yield* lifetime.close; root.close(); }
  })));

it("retains genuine empty relational selections with exact cursor and source isolation", () =>
  runEffect(Effect.gen(function* () {
    const otherId = CatalogTableIdSchema.make(2);
    const failure = (reason: string) => new Error(reason);
    const origin = { kind: "synthetic", sourceId: "read-evidence-fixture" };
    const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "neutral-read-evidence", capabilities: [],
      tables: ["items", "others"].map(tableId => ({ tableId, origin,
        columns: [{ columnId: "id", type: "text" as const, nullable: false, default: { kind: "none" as const }, origin }],
        keys: [{ keyId: tableId + ".primary", kind: "primary" as const, columns: ["id"], origin }],
        indexes: [], constraints: [], relationships: [],
      })),
    }));
    const items = schema.tables[0], others = schema.tables[1];
    if (items === undefined || others === undefined) throw new Error("Missing neutral read evidence tables");
    const first = yield* prepareLogicalWriteMechanics({ tables: [{ tableId, logicalName: "items", relational: items }],
      relationalCapabilities: [], indexes: [], unique: [] }, failure);
    const second = yield* prepareLogicalWriteMechanics({ tables: [{ tableId: otherId, logicalName: "others", relational: others }],
      relationalCapabilities: [], indexes: [], unique: [] }, failure);
    const combined = yield* combineLogicalWriteMechanics([first, second], failure);
    const { root, lifetime, id, working, readCalls } = yield* make(undefined, 64, combined);
    try {
      const itemStore = yield* working.relationalTable(lifetime.context, id, "items");
      const otherStore = yield* working.relationalTable(lifetime.context, id, "others");
      const query = { fields: ["id"], take: 8, order: { column: "id", direction: "asc" },
        predicate: { kind: "in", column: "id", values: [] } };
      const expectedQuery = structuredClone(query), program = itemStore.prepareRead(query);
      const before = working.activityCursor();
      expect(yield* program.find(lifetime.context)).toEqual([]);
      // The prepared program owns its original first-execution capture.
      query.take = 4;
      expect(yield* program.count(lifetime.context)).toBe(0);
      const next = working.activityCursor();
      expect(yield* otherStore.count(lifetime.context, expectedQuery)).toBe(0);
      const issued = yield* working.activityContribution;
      const selected = yield* working.readActivityContribution(issued, before, first);
      expect(selected.relationalReads).toEqual([0, 1].map(() => ({ tableId, tableName: "items", query: expectedQuery, total: 0, returned: 0 })));
      expect(selected.observedRows).toEqual([]);
      const current = yield* working.readActivityContribution(issued, next);
      expect(current.relationalReads).toEqual([{ tableId: otherId, tableName: "others", query: expectedQuery, total: 0, returned: 0 }]);
      expect((yield* working.readActivityContribution(issued, next, first)).relationalReads).toEqual([]);
      const projection = makeLogicalCommerceActivityProjection(new Map([[tableId, "items"], [otherId, "others"]]));
      const projected = yield* projection(selected);
      expect(projected.relationalReads).toEqual([0, 1].map(() => ({ table: "items", query: expectedQuery, total: 0, returned: 0 })));
      const ownedQuery = projected.relationalReads[0]?.query;
      if (ownedQuery === undefined || !isJsonObject(ownedQuery)) throw new Error("Missing captured query object");
      expect(Reflect.set(ownedQuery, "take", 100)).toBe(false);
      expect((yield* working.activitySnapshot()).relationalReads).toHaveLength(3);
      expect((yield* working.activitySnapshot(working.activityCursor())).relationalReads).toEqual([]);
      expect(readCalls()).toBe(0);
      yield* lifetime.seal;
      expect((yield* working.close()).relationalReads).toHaveLength(3);
      expect(root.snapshot().relationalReads).toHaveLength(3);
    } finally { yield* lifetime.close; root.close(); }
  })));

it("refuses corrupt relational selection evidence and detaches foreign query objects", () =>
  runEffect(Effect.gen(function* () {
    const projection = makeLogicalCommerceActivityProjection(new Map([[tableId, "items"]]));
    const query = { fields: ["id"], order: { column: "id", direction: "asc" } };
    const observation = { tableId, tableName: "items", query, total: 2, returned: 1 };
    const activity = { attempts: [], lifecycle: [], observedRows: [], relationalReads: [observation], setNull: [], referenceReplacements: [] };
    const first = yield* projection(activity);
    query.fields.push("mutated");
    expect(first.relationalReads[0]?.query).toEqual({ fields: ["id"], order: { column: "id", direction: "asc" } });
    expect((yield* projection(activity)).relationalReads[0]?.query).toEqual(query);
    for (const change of [{ tableName: "foreign" }, { total: -1 }, { returned: 3 }, { total: 1.5 }, { returned: Number.POSITIVE_INFINITY }])
      expect(yield* Effect.result(projection({ ...activity, relationalReads: [{ ...observation, ...change }] })))
        .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    let getterCalls = 0;
    const foreign = Object.defineProperty({}, "order", { enumerable: true, get: () => { getterCalls++; return query.order; } });
    expect(yield* Effect.result(projection({ ...activity, relationalReads: [{ ...observation, query: foreign }] })))
      .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    expect(getterCalls).toBe(0);
  })));
