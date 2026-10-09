import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import type { LiveAppRowRevisionV1 } from "../../src/storage/documents/appRows";
import { Effect, Exit, Result } from "effect";
import { expect, it } from "vitest";
import { AppCreationTimeV1Schema, canonicalizeAppDocumentV1 } from "flarex-protocol/app-document";
import { MetadataSequenceSchema, LogicalMetadataReadDependencySchema, canonicalizeSessionJournalEffect, SESSION_JOURNAL_FORMAT } from "flarex-protocol/commit-protocol";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { CommitSeqSchema, FlarexDbV1StorageGenerationSchema, ScopeEpochSchema,
  ScopeIdSchema, ScopeUuidV1Schema, ScopeEpochUuidV1Schema, StorageGenerationFenceSchema } from "flarex-protocol/storage-authority";
import { makeBoundedRequestLifetime, type RequestFailureReason } from "../../src/execution/preparation/boundedRequestLifetime";
import type { FlarexMetadataTransaction } from "../../src/database/metadataTransaction";
import type { SessionJournalAttempt } from "../../src/execution/sessionJournalStore";
import { makeLogicalDocumentRootEvaluator, attachLogicalDocumentRootEvaluator,
  recordLogicalDocumentRootMetadataDependency, consumeLogicalDocumentRootMetadataDependency, takeLogicalDocumentRootSnapshot,
  borrowClosedLogicalDocumentRoot, consumeClosedLogicalDocumentRoot } from "../../src/storage/documents/logicalDocuments/rootEvaluator";
import { makeLogicalDocumentWorkingSet } from "../../src/storage/documents/logicalDocuments/workingSet";
import { runEffect } from "../support/effectTestRuntime";
import { captureFiniteMetadataDependency, disposeFiniteMetadataProjection, finiteMetadataContractKey, prepareFiniteMetadataProjection } from "../../src/execution/finiteMetadataDependencies";
import { makeLogicalCommerceActivityProjection } from "../../src/frameworks/commerceTransaction/logicalParticipant";
import { ExecutionDiagnostics } from "../../src/execution/diagnostics/operation";

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
  calls = 32) =>
  Effect.gen(function* () {
    let readCalls = 0;
    const lifetime = yield* makeBoundedRequestLifetime(
      (reason: RequestFailureReason) => new Error(reason),
      { calls, commandBytes: 128_000, commandMs: 30_000 },
      attempt, Object.freeze({}), "finite-local-request", "write", "require");
    const id = yield* lifetime.begin(lifetime.context);
    const root = makeLogicalDocumentRootEvaluator({ attempt, scopeId, snapshotCommitSeq, attemptFence },
      { identities: 64, workingBytes: 128_000 });
    const working = yield* makeLogicalDocumentWorkingSet({
      readTransaction: () => Effect.sync(() => { readCalls++; }).pipe(Effect.andThen(read())),
      requireAdmission: Effect.void,
      scopeId, clock: { scopeId, storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
        storageGenerationFence: StorageGenerationFenceSchema.make(1n), lastCommitSeq: snapshotCommitSeq,
        lastMetadataSequence: MetadataSequenceSchema.make(0n),
        oldestAvailableCommitSeq: CommitSeqSchema.make(0n), epoch: ScopeEpochSchema.make("test_epoch"),
        updatedAt: new Date(0) },
      snapshotCommitSeq, rootEvaluator: root, rootAttempt: attempt, rootAttemptFence: attemptFence,
      lifetime, tables: [{ tableId, logicalName: "items" }], limits: {
        pageRows: 32, identities: 64, documentBytes: 16_000,
      }, validateDocument: () => Effect.void,
      error: reason => new Error(reason), uniqueConflict: () => new Error("uniqueConflict"),
    }, AppCreationTimeV1Schema.make(1), [], [], undefined, {} as FlarexMetadataTransaction);
    return { root, lifetime, id, working, readCalls: () => readCalls };
  });

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
      expect(yield* project(activity)).toBe(policy);
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

it("detaches only cursor activity while retaining complete observed rows and relative ordinals", () =>
  runEffect(Effect.gen(function* () {
    const { root, lifetime, id, working } = yield* make();
    try {
      const changed = yield* working.documents.insert(lifetime.context, id, "items", { name: "Ada", nested: { label: "before" } });
      yield* working.documents.insert(lifetime.context, id, "items", { name: "untouched" });
      if (typeof changed._id !== "string") throw new Error("Missing cursor document identity");
      const cursor = working.activityCursor();
      const before = yield* working.activitySnapshot(cursor);
      expect(before.attempts).toEqual([]);
      expect(before.observedRows).toHaveLength(2);
      yield* working.documents.patch(lifetime.context, id, changed._id, { name: "Grace" }, "items");
      const delta = yield* working.activitySnapshot(cursor);
      expect(delta.attempts.map(member => member.ordinal)).toEqual([0]);
      expect(delta.attempts[0]?.operation).toBe("patch");
      expect(delta.observedRows.map(row => row.value.name).toSorted()).toEqual(["Grace", "untouched"]);
      expect(before.observedRows.map(row => row.value.name).toSorted()).toEqual(["Ada", "untouched"]);
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
      expect(next.observedRows.map(row => row.value.name).toSorted()).toEqual(["Grace", "untouched"]);
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
