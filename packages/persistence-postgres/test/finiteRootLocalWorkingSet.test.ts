import { Effect, Exit, Result } from "effect";
import { expect, it } from "vitest";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { MetadataSequenceSchema, LogicalMetadataReadDependencySchema, canonicalizeSessionJournalEffect, SESSION_JOURNAL_FORMAT } from "flarex-protocol/commit-protocol";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { CommitSeqSchema, FlarexDbV1StorageGenerationSchema, ScopeEpochSchema,
  ScopeIdSchema, StorageGenerationFenceSchema } from "flarex-protocol/storage-authority";
import { makeBoundedRequestLifetime, type RequestFailureReason } from "../src/boundedRequestLifetime";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import type { SessionJournalAttempt } from "../src/sessionJournalStore";
import { makeLogicalDocumentRootEvaluator, attachLogicalDocumentRootEvaluator,
  recordLogicalDocumentRootMetadataDependency, takeLogicalDocumentRootSnapshot } from "../src/logicalDocuments/rootEvaluator";
import { makeLogicalDocumentWorkingSet } from "../src/logicalDocuments/workingSet";
import { runEffect } from "./effectTestRuntime";
import { captureFiniteMetadataDependency, finiteMetadataContractKey, prepareFiniteMetadataProjection } from "../src/finiteMetadataDependencies";

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
      expect(recordLogicalDocumentRootMetadataDependency(state, positive)).toBe(true);
      expect(recordLogicalDocumentRootMetadataDependency(state, negative)).toBe(true);
      expect(state.workingBytes).toBe(bytes);
      for (let index = 0; index < 4; index++) {
        expect(recordLogicalDocumentRootMetadataDependency(state, positive)).toBe(true);
        expect(recordLogicalDocumentRootMetadataDependency(state, negative)).toBe(true);
      }
      expect(state.workingBytes).toBe(bytes);
      expect(recordLogicalDocumentRootMetadataDependency(state,
        Result.getOrThrow(captureFiniteMetadataDependency(projection, key("third"), metadataWatermark)))).toBe(false);
      expect(recordLogicalDocumentRootMetadataDependency(state, { ...positive, capturedWatermark: MetadataSequenceSchema.make(2n) })).toBe(false);
      const foreign = yield* prepareFiniteMetadataProjection({ indexes: [], unique: [],
        application: { functions: [{ path: "a", semantic: { result: 2 } }], groups: [] } });
      expect(recordLogicalDocumentRootMetadataDependency(state,
        Result.getOrThrow(captureFiniteMetadataDependency(foreign, key("a"), metadataWatermark)))).toBe(false);
      root.close();
      expect(recordLogicalDocumentRootMetadataDependency(state, positive)).toBe(false);
      expect(recordLogicalDocumentRootMetadataDependency(state, negative)).toBe(false);
    } finally { root.close(); }
  })));

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
      const transferred = yield* Effect.fromResult(takeLogicalDocumentRootSnapshot(root));
      expect(transferred.graph.changes).toHaveLength(2);
      expect(transferred.originalRows).toEqual([]);
      expect(transferred.graph.attempts[1]?.after?.canonicalBytes.some(byte => byte !== 0)).toBe(true);
      expect(() => root.snapshot()).toThrow("closed");
      expect(() => takeLogicalDocumentRootSnapshot({ ...root })).toThrow("foreign");
      expect(() => takeLogicalDocumentRootSnapshot(root)).toThrow("closed");
      expect(readCalls()).toBe(0);
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
