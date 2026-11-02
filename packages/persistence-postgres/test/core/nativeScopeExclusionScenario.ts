import { createHash, randomBytes } from "node:crypto";
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Option, Result, type Scope } from "effect";
import { describe, expect, it, vi } from "vitest";
import { prepareApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { defineSchema, defineTable } from "flarex/server";
import { v } from "flarex/values";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { compileCurrencyCoreDefinition } from "../../../medusa-adapter/src/modules/currency/schema";
import type { CoreDatabase, CoreError, CoreNativeRootBinding, CoreNativeRootBindingInput,
  CoreNativeRootOperation, CoreRequestClaim, CoreRequestIdentity } from "../../src/core/api";
import { makeCoreApplicationOwner } from "../../src/core/applicationOwner";
import * as committerModule from "../../src/core/committer";
import type { CoreCommitter } from "../../src/core/committer";
import { CorePersistenceError, type CorePersistence, type CoreWriteBatch } from "../../src/core/contracts";
import { openCoreDatabase } from "../../src/core/database";
import { captureCoreNativeRootIdentity } from "../../src/core/nativeRootRequest";
import type { CoreNativeScopeExclusion } from "../../src/core/nativeScopeExclusion";
import type { CoreTableNamespace } from "../../src/core/namespace";
import { readDocumentObject, SCHEMAS } from "../../src/core/registry";
import { makeCoreSchemaBundle, type CoreSchemaBundle } from "../../src/core/schemaBundle";
import type { CoreFinalizedState } from "../../src/core/transaction";
import { readCoreFixtureRegistry, type CorePersistenceFixture } from "./fixture";
import { coreNativeTestBudget } from "./nativeTestBudget";
import { activateCoreSchema, CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const target = { scopeUuid: "7a6247dc-ccf0-4ca7-b6ed-d843a6383ef1", epochUuid: "d61e94e1-b52f-4d19-a33e-f6e01af96923" };
const commands = [{ name: "scope-write", mode: "write" }, { name: "scope-read", mode: "read" }] as const;
const contract = { name: "native-scope-exclusion-conformance", version: 1 };
const currency = (code: string) => ({ code, name: code, symbol: "N", symbol_native: "N" });
const failure = <A, E>(result: Result.Result<A, E>) => Result.isFailure(result) ? result.failure : undefined;
const documents = (batch: CoreWriteBatch) => batch.documents.filter(document => !document.deleted)
  .map(document => Result.getOrThrow(readDocumentObject(document)));
const component = (value: number): CoreTableNamespace => ({ kind: "byComponent",
  id: Result.getOrThrow(encodeDocumentId(10001, new Uint8Array(16).fill(value))) });

interface ClaimedRoot {
  readonly root: CoreNativeRootBinding;
  readonly identity: CoreRequestIdentity;
  readonly claim: CoreRequestClaim;
}
type OpenRoot = ClaimedRoot & Readonly<{ operation: CoreNativeRootOperation }>;

/** Genuine source composition and lifecycle calls only. Exclusion, accepted
 * ownership, metadata classification and recovery all remain production owners. */
const setup = Effect.fn("NativeScopeExclusionFixture.setup")(function* (fixture: CorePersistenceFixture,
  persistence: CorePersistence = fixture.persistence, multipleNamespaces = false) {
  const definition = yield* compileCurrencyCoreDefinition(target);
  const application = yield* prepareApplicationSchemaSource(defineSchema({ entries: defineTable({ name: v.string() }) }));
  const nextApplication = yield* prepareApplicationSchemaSource(defineSchema({ entries: defineTable({ name: v.string(), note: v.optional(v.string()) }) }));
  const namespaces: readonly CoreTableNamespace[] = multipleNamespaces ? [null, component(1)] : [null];
  const profiles = yield* Effect.forEach(namespaces, namespace => Effect.gen(function* () {
    const bundle = yield* makeCoreSchemaBundle({ namespace, sources: [{ kind: "application", definition: application }, { kind: "native", definition }] });
    const successor = yield* makeCoreSchemaBundle({ namespace, sources: [{ kind: "application", definition: nextApplication }, { kind: "native", definition }] });
    return { namespace, bundle, successor };
  }));
  const options = { schemaBundles: profiles.flatMap(profile => [profile.bundle, profile.successor]),
    now: Effect.succeed(1_000_000_000n), randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)),
    schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, maxConcurrentSaves: 2, maxBatchDelayMilliseconds: 0 };
  const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, options), db => db.close());
  for (const profile of profiles) {
    const proposal = yield* database.prepareSchema({ bundle: profile.bundle });
    let active = false;
    for (let step = 0; step < 256; step++) {
      const status = yield* database.schemaStatus(proposal);
      if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
        yield* database.activateSchema(proposal, { namespace: profile.namespace, bundle: profile.bundle, programs: [] });
        active = true; break;
      }
      if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error("Scope fixture schema refused"));
      yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
    }
    if (!active) return yield* Effect.die(new Error("Scope fixture schema did not activate"));
  }
  const table = definition.tables[0]?.name;
  if (table === undefined) return yield* Effect.die(new Error("Missing real Currency source table"));
  const bind = Effect.fn("NativeScopeExclusionFixture.bind")(function* (db: CoreDatabase, bundle: CoreSchemaBundle) {
    const binding = yield* db.bindNative({ definition, namespace: bundle.namespace, commands });
    const rootInput: CoreNativeRootBindingInput = { bundle, contract,
      participants: [{ binding, commands: ["scope-write"], limits: coreNativeTestBudget().limits }],
      maxFinalUserDocuments: 128, retryProvenNoncommit: true };
    const ordinary = yield* db.bindNativeRoot(rootInput);
    const selected = yield* db.bindNativeRoot({ ...rootInput, executionIsolation: "scopeExclusive" });
    return { binding, ordinary, selected, rootInput, metadata: yield* db.readNativeRootBinding(ordinary) };
  });
  const scopes = yield* Effect.forEach(profiles, profile => Effect.gen(function* () {
    return { ...profile, ...yield* bind(database, profile.bundle) };
  }));
  const first = scopes[0];
  if (first === undefined) return yield* Effect.die(new Error("Missing root namespace"));
  return { database, definition, options, profiles, scopes, first, table, bind };
});

const claim = Effect.fn("NativeScopeExclusionFixture.claim")(function* (database: CoreDatabase, root: CoreNativeRootBinding, key: string): Effect.fn.Return<ClaimedRoot, CoreError> {
  const metadata = yield* database.readNativeRootBinding(root);
  const identity: CoreRequestIdentity = { kind: "nativeRoot", root: metadata.identity, key,
    requestHash: createHash("sha256").update(`arguments:${key}`).digest("hex") };
  const acquired = yield* database.claimRequest(identity, root);
  if (acquired.kind !== "claimed") return yield* Effect.die(new Error(`Fresh request was ${acquired.kind}`));
  return { root, identity, claim: acquired.claim };
});
const begin = Effect.fn("NativeScopeExclusionFixture.begin")(function* (database: CoreDatabase, claimed: ClaimedRoot,
  deadline?: number): Effect.fn.Return<OpenRoot, CoreError> {
  const operation = yield* database.beginNativeRoot(claimed.root, { claim: claimed.claim,
    chargeRetained: coreNativeTestBudget().chargeRetained,
    ...(deadline === undefined ? {} : { admissionDeadlineUnixMilliseconds: deadline }) });
  return { ...claimed, operation };
});
const abandon = Effect.fn("NativeScopeExclusionFixture.abandon")(function* (database: CoreDatabase, root: OpenRoot) {
  yield* root.operation.abort(); yield* database.abortRequest(root.claim);
});
const settle = Effect.fn("NativeScopeExclusionFixture.settle")(function* (database: CoreDatabase, root: OpenRoot) {
  const finalized = yield* root.operation.finalize();
  // The native host drains/closes this operation before asking Core to settle.
  yield* root.operation.abort();
  return yield* database.commit(finalized, { claim: root.claim, result: { key: root.identity.key } });
});
const pending = Effect.fn("NativeScopeExclusionFixture.pending")(function* (done: Deferred.Deferred<void>) {
  yield* Effect.sleep("20 millis");
  expect(yield* Deferred.isDone(done)).toBe(false);
});

const globalFunction = (name: string) => `native19a-global:${name}`;
const writesGlobalProgram = (batch: CoreWriteBatch, name: string) => documents(batch).some(document => {
  const identity = document.identity;
  return document.kind === "revision" && identity !== null && typeof identity === "object"
    && "functionPath" in identity && identity.functionPath === globalFunction(name);
});
const prepareGlobalNamespace = Effect.fn("NativeScopeExclusionFixture.prepareGlobalNamespace")((database: CoreDatabase) => activateCoreSchema(database,
  { tables: [{ tableName: "administrative", documentType: { type: "any" }, indexes: [] }], schemaValidation: false },
  { namespace: component(2), programs: [] }));
const publishGlobal = Effect.fn("NativeScopeExclusionFixture.publishGlobal")((database: CoreDatabase, name: string) => database.publishPrograms({ namespace: component(2),
  programs: [{ identity: { functionPath: globalFunction(name), programHash: name, schemaHash: "native19a-administrative" }, metadata: { globalProof: name } }] }));

/** Signals actual ticket-readiness evaluation without replacing the ticket,
 * queue, ownership callback, deadline or its admission decision. */
const watchGateReadiness = Effect.fn("NativeScopeExclusionFixture.watchGateReadiness")(function* () {
  const observed: { gate?: CoreNativeScopeExclusion } = {};
  const restores: Array<() => void> = [];
  let nextReadiness: Deferred.Deferred<void> | undefined;
  const originalMake = committerModule.makeCoreCommitter;
  const make = vi.spyOn(committerModule, "makeCoreCommitter").mockImplementation((...parameters) => originalMake(...parameters)
    .pipe(Effect.tap(() => Effect.sync(() => {
      const gate = parameters[8];
      if (gate === undefined) throw new Error("Actual Core constructor did not supply its shared settlement owner");
      observed.gate = gate;
    }))));
  restores.push(() => make.mockRestore());
  yield* Effect.addFinalizer(() => Effect.sync(() => { for (const restore of restores.toReversed()) restore(); }));
  return {
    connect: Effect.sync(() => {
      const gate = observed.gate;
      if (gate === undefined) throw new Error("Missing actual Core readiness owner");
      const beforeDeadline = gate.beforeDeadline;
      const readiness = vi.spyOn(gate, "beforeDeadline").mockImplementation((work, deadline) => {
        const marker = nextReadiness; nextReadiness = undefined;
        return beforeDeadline(marker === undefined ? work : Effect.andThen(Deferred.succeed(marker, undefined), work), deadline);
      });
      restores.push(() => readiness.mockRestore());
    }),
    next: (marker: Deferred.Deferred<void>) => Effect.sync(() => {
      if (nextReadiness !== undefined) throw new Error("Previous actual gate-readiness observation was not consumed");
      nextReadiness = marker;
    }),
  };
});

/** Only actual persistence transport is held: first before SQL, second after
 * durable SQL but before its acknowledgement reaches the existing committer. */
const holdGlobalPair = Effect.fn("NativeScopeExclusionFixture.holdGlobalPair")(function* (
  fixture: CorePersistenceFixture, first: string, second: string,
) {
  const firstStarted = yield* Deferred.make<void>(), releaseFirst = yield* Deferred.make<void>();
  const secondSaved = yield* Deferred.make<void>(), releaseSecond = yield* Deferred.make<void>();
  let armed = false;
  const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
    const holdFirst = armed && writesGlobalProgram(batch, first), holdSecond = armed && writesGlobalProgram(batch, second);
    if (holdFirst) { yield* Deferred.succeed(firstStarted, undefined); yield* Deferred.await(releaseFirst); }
    yield* fixture.persistence.write(lease, batch);
    if (holdSecond) { yield* Deferred.succeed(secondSaved, undefined); yield* Deferred.await(releaseSecond); }
  }) };
  return { persistence, firstStarted, secondSaved, releaseFirst, releaseSecond,
    arm: Effect.sync(() => { armed = true; }),
    release: Effect.andThen(Deferred.succeed(releaseFirst, undefined), Deferred.succeed(releaseSecond, undefined)) };
});
const reached = Effect.fn("NativeScopeExclusionFixture.reached")(function* <A, E>(
  marker: Deferred.Deferred<void>, fiber: Fiber.Fiber<A, E>,
) {
  yield* Effect.raceFirst(Deferred.await(marker), Fiber.join(fiber).pipe(Effect.asVoid));
  expect(yield* Deferred.isDone(marker)).toBe(true);
});

export function registerNativeScopeExclusionScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>): void {
  describe(label, () => {
    const run = <E>(body: (fixture: CorePersistenceFixture) => Effect.Effect<void, E, Scope.Scope>) => async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(body(fixture).pipe(Effect.timeout("60 seconds")))); } finally { await fixture.close(); }
    };

    it("preserves the default frame bytes and binds selected isolation into request identity", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), scope = graph.first;
      const root = yield* begin(graph.database, yield* claim(graph.database, scope.ordinary, "default-frame"));
      const evidence = yield* graph.database.readNativeRootRequestEvidence(yield* root.operation.native(scope.binding));
      const expectedFrame = { format: "flarex.core-native-root", version: 1, namespace: null, contract,
        participants: [{ source: graph.definition.identity, commands: [commands[0]], limits: coreNativeTestBudget().limits }],
        applicationInsert: null, maxFinalUserDocuments: 128, retryProvenNoncommit: true };
      expect(evidence.frame).toEqual(expectedFrame);
      expect(evidence.root).toEqual((yield* captureCoreNativeRootIdentity(expectedFrame)).identity);
      expect(Object.hasOwn(evidence.frame, "executionIsolation")).toBe(false);
      const selectedMetadata = yield* graph.database.readNativeRootBinding(scope.selected);
      expect(selectedMetadata.identity).toEqual((yield* captureCoreNativeRootIdentity({ ...expectedFrame, executionIsolation: "scopeExclusive" })).identity);
      expect(selectedMetadata.identity).not.toEqual(evidence.root);
      yield* abandon(graph.database, root);
      expect(failure(yield* Effect.result(graph.database.claimRequest({ ...root.identity,
        kind: "nativeRoot", root: selectedMetadata.identity }, scope.selected)))).toMatchObject({ reason: "requestMismatch" });
    })), 90_000);

    it("serializes selected roots from distinct bindings and keeps finalization protected after host abort", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), scope = graph.first;
      const peer = yield* graph.bind(graph.database, scope.bundle);
      const first = yield* begin(graph.database, yield* claim(graph.database, scope.selected, "selected-first"));
      yield* first.operation.requireScopeExclusion;
      const secondClaim = yield* claim(graph.database, peer.selected, "selected-second");
      const entered = yield* Deferred.make<void>();
      const second = yield* Effect.forkChild(begin(graph.database, secondClaim).pipe(Effect.tap(() => Deferred.succeed(entered, undefined))));
      yield* pending(entered);
      const packet = yield* first.operation.finalize();
      yield* first.operation.abort();
      expect(failure(yield* Effect.result(first.operation.requireScopeExclusion))).toMatchObject({ reason: "authorityRevoked" });
      yield* pending(entered);
      yield* graph.database.commit(packet, { claim: first.claim, result: { original: true } });
      const acquired = yield* Fiber.join(second);
      yield* acquired.operation.requireScopeExclusion;
      yield* abandon(graph.database, acquired);
      const last = yield* begin(graph.database, yield* claim(graph.database, scope.selected, "selected-after-abort"));
      yield* abandon(graph.database, last);
    })), 90_000);

    it.each(["business", "resultOnly", "application"] as const)("admits fresh ordinary claims and bodies while %s settlement waits", mode => run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), scope = graph.first;
      const selected = yield* begin(graph.database, yield* claim(graph.database, scope.selected, `holder-${mode}`));
      // This claim is created after exclusive entry. Claim/abort control cannot
      // wait for the application permit or ordinary bodies would stop too.
      const ordinary = yield* begin(graph.database, yield* claim(graph.database, scope.ordinary, `ordinary-${mode}`));
      const abortable = yield* claim(graph.database, scope.ordinary, `abort-${mode}`);
      yield* graph.database.abortRequest(abortable.claim);
      expect(yield* graph.database.resolveRequest(abortable.identity)).toEqual({ kind: "failed" });
      let commit: Effect.Effect<bigint, CoreError>;
      if (mode === "application") {
        const application = yield* graph.database.begin();
        yield* application.insert("entries", { name: "ordinary body started" });
        commit = graph.database.commit(yield* application.finalize());
        yield* abandon(graph.database, ordinary);
      } else {
        if (mode === "business") yield* (yield* ordinary.operation.native(scope.binding)).writeRows(graph.table, "insert", [currency("xob")]);
        const finalized = yield* ordinary.operation.finalize();
        yield* ordinary.operation.abort();
        commit = graph.database.commit(finalized, { claim: ordinary.claim, result: { bodyStarted: true, mode } });
      }
      const done = yield* Deferred.make<void>();
      const writer = yield* Effect.forkChild(commit.pipe(Effect.tap(() => Deferred.succeed(done, undefined))));
      yield* pending(done);
      yield* selected.operation.requireScopeExclusion;
      yield* settle(graph.database, selected);
      yield* Fiber.join(writer);
      expect(yield* Deferred.isDone(done)).toBe(true);
      if (mode !== "application") expect(yield* graph.database.resolveRequest(ordinary.identity))
        .toMatchObject({ kind: "committed", result: { bodyStarted: true, mode } });
    }))(), 90_000);

    it("lets selected native progress past a held ordinary delete and rejects its stale finalization", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), scope = graph.first;
      const seed = yield* graph.database.beginNative(scope.binding, { commandName: "scope-write", ...coreNativeTestBudget() });
      const inserted = yield* seed.operations.writeRows(graph.table, "insert", [currency("xdl")]);
      const id = inserted[0]?._id;
      if (typeof id !== "string") return yield* Effect.die(new Error("Missing native Currency document ID"));
      yield* graph.database.commit(yield* seed.finalize());
      const deletion = yield* graph.database.beginNative(scope.binding, { commandName: "scope-write", ...coreNativeTestBudget() });
      expect(Option.getOrThrow(yield* deletion.operations.get(id))).toMatchObject({ code: "xdl", name: "xdl" });
      yield* deletion.operations.delete(id);
      const selected = yield* begin(graph.database, yield* claim(graph.database, scope.selected, "selected-beats-held-delete"));
      yield* (yield* selected.operation.native(scope.binding)).writeRows(graph.table, "update", [{ code: "xdl", name: "selected survived" }]);
      yield* settle(graph.database, selected);
      expect(failure(yield* Effect.result(graph.database.commit(yield* deletion.finalize())))).toMatchObject({ reason: "conflict" });
      const read = yield* graph.database.beginNative(scope.binding, { commandName: "scope-read", ...coreNativeTestBudget() });
      expect(Option.getOrThrow(yield* read.operations.get(id))).toMatchObject({ name: "selected survived" });
      yield* read.finishRead();
    })), 90_000);

    it("keeps actual root and component namespaces independent inside one Core kernel", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture, fixture.persistence, true), secondScope = graph.scopes[1];
      if (secondScope === undefined) return yield* Effect.die(new Error("Missing actual component namespace"));
      expect(graph.first.namespace).toBeNull(); expect(secondScope.namespace).not.toBeNull();
      const first = yield* begin(graph.database, yield* claim(graph.database, graph.first.selected, "root-namespace-held"));
      const second = yield* begin(graph.database, yield* claim(graph.database, secondScope.selected, "component-progress"));
      yield* first.operation.requireScopeExclusion; yield* second.operation.requireScopeExclusion;
      yield* (yield* first.operation.native(graph.first.binding)).writeRows(graph.table, "insert", [currency("xns")]);
      yield* (yield* second.operation.native(secondScope.binding)).writeRows(graph.table, "insert", [currency("xns")]);
      yield* settle(graph.database, second);
      yield* first.operation.requireScopeExclusion;
      yield* settle(graph.database, first);
      for (const scope of graph.scopes) {
        const read = yield* graph.database.beginNative(scope.binding, { commandName: "scope-read", ...coreNativeTestBudget() });
        expect(yield* read.operations.find(graph.table, { code: "xns" })).toHaveLength(1);
        yield* read.finishRead();
      }
    })), 90_000);

    it("allows other-namespace metadata while same-namespace metadata waits for exclusion", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture, fixture.persistence, true), other = graph.scopes[1];
      if (other === undefined) return yield* Effect.die(new Error("Missing actual component namespace"));
      const selected = yield* begin(graph.database, yield* claim(graph.database, graph.first.selected, "metadata-holder"));
      const done = yield* Deferred.make<void>();
      const blocked = yield* Effect.forkChild(Effect.result(graph.database.prepareSchema({ bundle: graph.first.successor })
        .pipe(Effect.tap(() => Deferred.succeed(done, undefined)))));
      yield* pending(done);
      const independent = yield* graph.database.prepareSchema({ bundle: other.successor });
      expect(independent.namespace).toEqual(other.namespace);
      const independentTimestamp = yield* graph.database.publishedTimestamp;
      const registry = yield* readCoreFixtureRegistry(fixture, independentTimestamp);
      const stateIndex = registry.table(SCHEMAS, other.namespace)?.definition.indexes.find(index => index.name === "by_state");
      if (stateIndex === undefined) return yield* Effect.die(new Error("Missing authentic component schema state index"));
      const independentState = yield* Effect.fromResult(registry.schemas.getByState(
        other.namespace, "pending", stateIndex.ref, () => undefined));
      expect(Option.getOrThrow(independentState).id).toBe(independent.id);
      expect((yield* graph.database.schemaStatus(independent)).state).toBe("pending");
      yield* pending(done);
      yield* abandon(graph.database, selected);
      // The typed Application absence guard does not consume another
      // namespace's schema state. Exclusion still holds this preparation until
      // release; the independent proposal does not create a false OCC conflict.
      const prepared = yield* Effect.fromResult(yield* Fiber.join(blocked));
      expect(prepared.namespace).toBeNull();
      expect(yield* Deferred.isDone(done)).toBe(true);
      expect(yield* graph.database.publishedTimestamp).toBeGreaterThan(independentTimestamp);
      expect((yield* graph.database.schemaStatus(prepared)).state).toBe("pending");
      expect((yield* graph.database.schemaStatus(independent)).state).toBe("pending");
      const fresh = yield* graph.database.prepareSchema({ bundle: graph.first.successor });
      expect(fresh).toEqual(prepared);
      expect((yield* graph.database.schemaStatus(fresh)).state).toBe("pending");
    })), 90_000);

    it.each(["authority", "programPublication"] as const)("fences global %s across namespaces without self-commit deadlock", mode => run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture, fixture.persistence, true), other = graph.scopes[1];
      if (other === undefined) return yield* Effect.die(new Error("Missing actual component namespace"));
      const administrativeNamespace = component(2);
      if (mode === "programPublication") yield* activateCoreSchema(graph.database,
        { tables: [{ tableName: "administrative", documentType: { type: "any" }, indexes: [] }], schemaValidation: false },
        { namespace: administrativeNamespace, programs: [] });
      const selected = yield* begin(graph.database, yield* claim(graph.database, other.selected, `global-${mode}`));
      const done = yield* Deferred.make<void>();
      const publication = mode === "authority" ? graph.database.advanceAuthorityEpoch(1n)
        : graph.database.publishPrograms({ namespace: administrativeNamespace, programs: [], authorityEpoch: 1n });
      const publishing = yield* Effect.forkChild(publication.pipe(Effect.tap(() => Deferred.succeed(done, undefined))));
      yield* pending(done);
      // A queued global writer must not make the selected holder reacquire
      // global shared protection behind that same writer.
      yield* settle(graph.database, selected);
      yield* Fiber.join(publishing);
      expect(yield* graph.database.readAuthorityEpoch).toBe(1n);
    }))(), 90_000);

    it("refuses copied issuer capabilities and never borrows an ordinary root's nonexistent selected proof", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), scope = graph.first;
      const selected = yield* claim(graph.database, scope.selected, "issuer-selected");
      expect(failure(yield* Effect.result(graph.database.readNativeRootBinding({ ...scope.selected })))).toMatchObject({ reason: "authorityRevoked" });
      expect(failure(yield* Effect.result(graph.database.beginNativeRoot(new Proxy(scope.selected, {}), {
        claim: selected.claim, chargeRetained: coreNativeTestBudget().chargeRetained })))).toMatchObject({ reason: "authorityRevoked" });
      expect(failure(yield* Effect.result(graph.database.abortRequest({ ...selected.claim })))).toMatchObject({ reason: "foreignClaim" });
      const ordinary = yield* begin(graph.database, yield* claim(graph.database, scope.ordinary, "issuer-ordinary"));
      expect(failure(yield* Effect.result(ordinary.operation.requireScopeExclusion))).toMatchObject({ reason: "authorityRevoked" });
      yield* abandon(graph.database, ordinary);
      const root = yield* begin(graph.database, selected);
      const packet = yield* root.operation.finalize();
      expect(failure(yield* Effect.result(graph.database.commit({ ...packet }, { claim: root.claim, result: {} })))).toMatchObject({ reason: "foreignFinalization" });
      expect(failure(yield* Effect.result(graph.database.commit(new Proxy(packet, {}), { claim: root.claim, result: {} })))).toMatchObject({ reason: "foreignFinalization" });
      yield* graph.database.commit(packet, { claim: root.claim, result: { authentic: true } });
      expect(failure(yield* Effect.result(root.operation.requireScopeExclusion))).toMatchObject({ reason: "authorityRevoked" });
    })), 90_000);

    it("confines real request-control authorization to its exact packet and generation", run(fixture => Effect.gen(function* () {
      // Observe the actual constructor and issuer; no second gate, committer or
      // persistence model supplies either admission or the expected decision.
      const observed: { committer?: CoreCommitter; gate?: CoreNativeScopeExclusion } = {};
      const restores: Array<() => void> = [];
      const originalMake = committerModule.makeCoreCommitter;
      const make = vi.spyOn(committerModule, "makeCoreCommitter").mockImplementation((...parameters) => originalMake(...parameters)
        .pipe(Effect.tap(committer => Effect.sync(() => {
          const gate = parameters[8];
          if (gate === undefined) throw new Error("Actual Core constructor did not supply its shared settlement owner");
          observed.committer = committer; observed.gate = gate;
        }))));
      restores.push(() => make.mockRestore());
      yield* Effect.gen(function* () {
        const graph = yield* setup(fixture), scope = graph.first;
        const committer = observed.committer, gate = observed.gate;
        if (committer === undefined || gate === undefined) return yield* Effect.die(new Error("Missing actual Core settlement owner"));
        const controls: CoreFinalizedState[] = [], submitted: CoreFinalizedState[] = [];
        const authorize = gate.authorize;
        const issuer = vi.spyOn(gate, "authorize").mockImplementation((transaction, purpose) => {
          const authorized = authorize(transaction, purpose);
          if (purpose === "requestControl") controls.push(authorized);
          return authorized;
        });
        restores.push(() => issuer.mockRestore());
        const selected = yield* begin(graph.database, yield* claim(graph.database, scope.selected, "control-holder"));
        const ordinary = yield* begin(graph.database, yield* claim(graph.database, scope.ordinary, "control-empty-result"));
        const abortable = yield* claim(graph.database, scope.ordinary, "control-abort");
        yield* graph.database.abortRequest(abortable.claim);
        expect(controls.some(state => state.changes.some(change => change.finalDocument?.key === "control-abort"
          && change.finalDocument.state === "failed"))).toBe(true);
        const authorized = controls.find(state => state.changes.some(change => change.finalDocument?.key === ordinary.identity.key));
        if (authorized?.settlementAuthorization === undefined) return yield* Effect.die(new Error("Missing genuine request-control authorization"));
        const originalSubmit = committer.submit;
        const reachedResult = yield* Deferred.make<void>(), reachedApplication = yield* Deferred.make<void>();
        const submission = vi.spyOn(committer, "submit").mockImplementation(transaction => Effect.gen(function* () {
          submitted.push(transaction);
          if (transaction.changes.some(change => change.finalDocument?.key === ordinary.identity.key
            && change.finalDocument.state === "committed")) yield* Deferred.succeed(reachedResult, undefined);
          if (transaction.changes.some(change => change.finalDocument?.name === "control-unrelated-write"))
            yield* Deferred.succeed(reachedApplication, undefined);
          return yield* originalSubmit(transaction);
        }));
        restores.push(() => submission.mockRestore());
        const resultDone = yield* Deferred.make<void>(), applicationDone = yield* Deferred.make<void>();
        const result = yield* Effect.forkChild(settle(graph.database, ordinary).pipe(Effect.tap(() => Deferred.succeed(resultDone, undefined))));
        const application = yield* graph.database.begin();
        yield* application.insert("entries", { name: "control-unrelated-write" });
        const writing = yield* Effect.forkChild(graph.database.commit(yield* application.finalize())
          .pipe(Effect.tap(() => Deferred.succeed(applicationDone, undefined))));
        yield* Deferred.await(reachedResult); yield* Deferred.await(reachedApplication);
        const resultState = submitted.find(state => state.changes.some(change => change.finalDocument?.key === ordinary.identity.key));
        const unrelated = submitted.find(state => state.changes.some(change => change.finalDocument?.name === "control-unrelated-write"));
        if (resultState === undefined || unrelated === undefined) return yield* Effect.die(new Error("Missing authentic settlement packets"));
        for (const state of [authorized, resultState, unrelated]) {
          expect(failure(yield* Effect.result(originalSubmit({ ...state,
            settlementAuthorization: authorized.settlementAuthorization })))).toMatchObject({ reason: "foreignFinalization" });
        }
        // A public-looking classifier grants nothing, including on an otherwise
        // genuine empty-business committed DTO. Cancel it before releasing hold.
        const classifier = { ...resultState, settlementPurpose: "requestControl" };
        const forgedDone = yield* Deferred.make<void>();
        const forged = yield* Effect.forkChild(originalSubmit(classifier).pipe(Effect.tap(() => Deferred.succeed(forgedDone, undefined))));
        yield* pending(forgedDone);
        yield* Fiber.interrupt(forged);
        const interruptedForgery = yield* Fiber.await(forged);
        expect(Exit.isFailure(interruptedForgery) && Cause.hasInterrupts(interruptedForgery.cause)).toBe(true);
        yield* pending(resultDone); yield* pending(applicationDone);
        yield* settle(graph.database, selected);
        yield* Fiber.join(result); yield* Fiber.join(writing);
        yield* graph.database.close();
        yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.tryPromise({ try: () => fixture.reopen(), catch: cause => cause }), graph.options), database => database.close());
        const successorCommitter = observed.committer;
        if (successorCommitter === undefined) return yield* Effect.die(new Error("Missing reconstructed Core committer"));
        expect(successorCommitter).not.toBe(committer);
        // Even the original exact packet belongs to its old private issuer.
        expect(failure(yield* Effect.result(successorCommitter.submit(authorized)))).toMatchObject({ reason: "foreignFinalization" });
      }).pipe(Effect.ensuring(Effect.sync(() => { for (const restore of restores.toReversed()) restore(); })));
    })), 90_000);

    it.each(["exclusive grant", "settlement permit"] as const)("releases the actual %s when successful handoff is interrupted", mode => run(fixture => Effect.gen(function* () {
      const observed: { gate?: CoreNativeScopeExclusion } = {};
      const restores: Array<() => void> = [];
      const originalMake = committerModule.makeCoreCommitter;
      const make = vi.spyOn(committerModule, "makeCoreCommitter").mockImplementation((...parameters) => originalMake(...parameters)
        .pipe(Effect.tap(() => Effect.sync(() => {
          const gate = parameters[8];
          if (gate === undefined) throw new Error("Actual Core constructor did not supply its shared settlement owner");
          observed.gate = gate;
        }))));
      restores.push(() => make.mockRestore());
      const obtained = yield* Deferred.make<void>(), releaseHandoff = yield* Deferred.make<void>();
      let capturedCleanup: Effect.Effect<void> = Effect.void;
      yield* Effect.gen(function* () {
        const graph = yield* setup(fixture), scope = graph.first, gate = observed.gate;
        if (gate === undefined) return yield* Effect.die(new Error("Missing actual Core handoff owner"));
        const interruptedClaim = yield* claim(graph.database, mode === "exclusive grant" ? scope.selected : scope.ordinary, "handoff-interrupted");
        const followingClaim = yield* claim(graph.database, scope.selected, "handoff-following");
        const delivered = yield* Deferred.make<void>();
        let acquisition: Effect.Effect<unknown, CoreError>;
        if (mode === "exclusive grant") {
          const acquireExclusive = gate.acquireExclusive;
          let armed = true;
          const handoff = vi.spyOn(gate, "acquireExclusive").mockImplementation((...parameters) => acquireExclusive(...parameters)
            .pipe(Effect.tap(grant => Effect.suspend(() => {
              if (!armed) return Effect.void;
              armed = false;
              capturedCleanup = grant.drain;
              return Effect.andThen(Deferred.succeed(obtained, undefined), Deferred.await(releaseHandoff));
            }))));
          restores.push(() => handoff.mockRestore());
          acquisition = begin(graph.database, interruptedClaim);
        } else {
          const ordinary = yield* begin(graph.database, interruptedClaim);
          yield* (yield* ordinary.operation.native(scope.binding)).writeRows(graph.table, "insert", [currency("xhp")]);
          const finalized = yield* ordinary.operation.finalize();
          yield* ordinary.operation.abort();
          const settlement = gate.settlement;
          let armed = true;
          const handoff = vi.spyOn(gate, "settlement").mockImplementation((...parameters) => settlement(...parameters)
            .pipe(Effect.tap(permit => Effect.suspend(() => {
              if (!armed) return Effect.void;
              armed = false;
              capturedCleanup = permit.release;
              return Effect.andThen(Deferred.succeed(obtained, undefined), Deferred.await(releaseHandoff));
            }))));
          restores.push(() => handoff.mockRestore());
          acquisition = graph.database.commit(finalized, { claim: ordinary.claim, result: { mustNotCommit: true } });
        }
        // The original production acquisition has succeeded. This transparent
        // wrapper holds its authentic resource before its immediate owner can
        // receive it; no fake permit or replacement scheduler supplies success.
        const acquiring = yield* Effect.forkChild(acquisition.pipe(Effect.tap(() => Deferred.succeed(delivered, undefined))));
        yield* Deferred.await(obtained);
        const interrupting = yield* Effect.forkChild(Fiber.interrupt(acquiring));
        yield* Effect.sleep("20 millis");
        // A correct masked handoff may finish only after this signal. Releasing
        // it does not release the captured resource or repair the failing path.
        yield* Deferred.succeed(releaseHandoff, undefined);
        yield* Fiber.join(interrupting);
        const interrupted = yield* Fiber.await(acquiring);
        expect(Exit.isFailure(interrupted) && Cause.hasInterrupts(interrupted.cause)).toBe(true);
        expect(yield* Deferred.isDone(delivered)).toBe(false);
        yield* graph.database.assertOpen;
        expect(yield* graph.database.resolveRequest(interruptedClaim.identity)).toEqual({ kind: "busy" });
        const following = yield* begin(graph.database, followingClaim, (yield* Clock.currentTimeMillis) + 1000);
        yield* following.operation.requireScopeExclusion;
        if (mode === "settlement permit") expect(yield* (yield* following.operation.native(scope.binding)).find(graph.table, { code: "xhp" })).toEqual([]);
        yield* abandon(graph.database, following);
        yield* graph.database.abortRequest(interruptedClaim.claim);
      }).pipe(Effect.ensuring(Effect.gen(function* () {
        yield* Deferred.succeed(releaseHandoff, undefined);
        // Test-owned disposal only, after success/failure has been established.
        // The expected next admission above cannot depend on this cleanup.
        yield* Effect.suspend(() => capturedCleanup);
        yield* Effect.sync(() => { for (const restore of restores.toReversed()) restore(); });
      })));
    }))(), 90_000);

    it("removes canceled and expired waiters and gives a queued exclusive root precedence over later writers", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), scope = graph.first;
      const first = yield* begin(graph.database, yield* claim(graph.database, scope.selected, "queue-holder"));
      const canceledClaim = yield* claim(graph.database, scope.selected, "queue-canceled");
      const expiredClaim = yield* claim(graph.database, scope.selected, "queue-expired");
      const nextClaim = yield* claim(graph.database, scope.selected, "queue-next");
      const ordinary = yield* begin(graph.database, yield* claim(graph.database, scope.ordinary, "queue-later-writer"));
      const canceledEntered = yield* Deferred.make<void>();
      const canceled = yield* Effect.forkChild(begin(graph.database, canceledClaim)
        .pipe(Effect.tap(() => Deferred.succeed(canceledEntered, undefined))));
      yield* pending(canceledEntered);
      yield* Fiber.interrupt(canceled);
      const canceledExit = yield* Fiber.await(canceled);
      expect(Exit.isFailure(canceledExit) && Cause.hasInterrupts(canceledExit.cause)).toBe(true);
      const deadline = (yield* Clock.currentTimeMillis) + 30;
      expect(failure(yield* Effect.result(begin(graph.database, expiredClaim, deadline)))).toMatchObject({ reason: "admissionExpired" });
      const nextEntered = yield* Deferred.make<void>();
      const next = yield* Effect.forkChild(begin(graph.database, nextClaim).pipe(Effect.tap(() => Deferred.succeed(nextEntered, undefined))));
      yield* pending(nextEntered);
      const written = yield* Deferred.make<void>();
      const later = yield* Effect.forkChild(settle(graph.database, ordinary).pipe(Effect.tap(() => Deferred.succeed(written, undefined))));
      yield* pending(written);
      yield* abandon(graph.database, first);
      const acquired = yield* Fiber.join(next);
      yield* pending(written);
      expect(yield* Deferred.isDone(canceledEntered)).toBe(false);
      yield* settle(graph.database, acquired);
      yield* Fiber.join(later);
      yield* graph.database.abortRequest(canceledClaim.claim); yield* graph.database.abortRequest(expiredClaim.claim);
      const final = yield* begin(graph.database, yield* claim(graph.database, scope.selected, "queue-after-cancel"));
      const packet = yield* final.operation.finalize(); yield* final.operation.abort();
      expect(failure(yield* Effect.result(graph.database.commit(packet, { claim: final.claim,
        admissionDeadlineUnixMilliseconds: (yield* Clock.currentTimeMillis) - 1 })))).toMatchObject({ reason: "admissionExpired" });
      yield* graph.database.abortRequest(final.claim);
      const afterExpiry = yield* begin(graph.database, yield* claim(graph.database, scope.selected, "queue-after-preaccept-expiry"));
      yield* abandon(graph.database, afterExpiry);
    })), 90_000);

    it.each([false, true])("retains accepted unsaved shared ownership when caller interruption is %s", interruptCaller => run(fixture => Effect.gen(function* () {
      const saving = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
      let armed = false;
      const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
        if (armed && documents(batch).some(document => document.code === "xac")) {
          yield* Deferred.succeed(saving, undefined); yield* Deferred.await(release);
        }
        yield* fixture.persistence.write(lease, batch);
      }) };
      const graph = yield* setup(fixture, persistence), scope = graph.first;
      const ordinary = yield* begin(graph.database, yield* claim(graph.database, scope.ordinary, "accepted-write"));
      const selectedClaim = yield* claim(graph.database, scope.selected, "accepted-exclusive");
      yield* (yield* ordinary.operation.native(scope.binding)).writeRows(graph.table, "insert", [currency("xac")]);
      yield* Effect.gen(function* () {
        armed = true;
        const writer = yield* Effect.forkChild(settle(graph.database, ordinary));
        yield* Deferred.await(saving);
        const entered = yield* Deferred.make<void>();
        const waiting = yield* Effect.forkChild(begin(graph.database, selectedClaim).pipe(Effect.tap(() => Deferred.succeed(entered, undefined))));
        yield* pending(entered);
        if (interruptCaller) {
          yield* Fiber.interrupt(writer);
          const interruptedWriter = yield* Fiber.await(writer);
          expect(Exit.isFailure(interruptedWriter) && Cause.hasInterrupts(interruptedWriter.cause)).toBe(true);
        }
        yield* pending(entered);
        yield* Deferred.succeed(release, undefined);
        if (!interruptCaller) yield* Fiber.join(writer);
        const selected = yield* Fiber.join(waiting);
        expect(yield* graph.database.resolveRequest(ordinary.identity)).toMatchObject({ kind: "committed", result: { key: "accepted-write" } });
        yield* abandon(graph.database, selected);
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
    }))(), 90_000);

    it("closes the stopped gate before failed ACKs and reconstructs all outcomes through the canonical owner", run(fixture => Effect.gen(function* () {
      const installed = yield* setup(fixture); yield* installed.database.close();
      const saving = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
      let armed = false, generations = 0, bodyCalls = 0;
      const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
        const selected = armed && documents(batch).some(document => document.code === "xla");
        if (selected) { yield* Deferred.succeed(saving, undefined); yield* Deferred.await(release); }
        yield* fixture.persistence.write(lease, batch);
        if (selected) { armed = false; return yield* new CorePersistenceError({ reason: "uncertainWrite" }); }
      }) };
      const owner = yield* makeCoreApplicationOwner({ persistence, options: installed.options, maximumRequests: 8,
        prepare: database => Effect.gen(function* () { generations++; return { database, ...yield* installed.bind(database, installed.first.bundle) }; }) });
      const old = yield* owner.use(prepared => Effect.gen(function* () {
        const committed = yield* claim(prepared.database, prepared.selected, "lost-ack-committed");
        const waiting = yield* claim(prepared.database, prepared.selected, "lost-ack-waiting");
        const neverStarted = yield* claim(prepared.database, prepared.ordinary, "lost-ack-abandoned");
        return { ...prepared, committed, waiting, neverStarted };
      }));
      yield* Effect.gen(function* () {
        const operation = yield* begin(old.database, old.committed);
        yield* (yield* operation.operation.native(old.binding)).writeRows(installed.table, "insert", [currency("xla")]);
        bodyCalls++;
        armed = true;
        const committing = yield* Effect.forkChild(Effect.result(owner.use(() => settle(old.database, operation))));
        yield* Deferred.await(saving);
        const queued = yield* Effect.forkChild(Effect.exit(owner.use(() => begin(old.database, old.waiting)
          .pipe(Effect.tap(() => Effect.sync(() => { bodyCalls++; }))))));
        yield* Effect.sleep("20 millis");
        yield* Deferred.succeed(release, undefined);
        expect(Result.isFailure(yield* Fiber.join(committing))).toBe(true);
        expect(Exit.isFailure(yield* Fiber.join(queued))).toBe(true);
        expect(Result.isFailure(yield* Effect.result(old.database.assertOpen))).toBe(true);
        expect(Result.isFailure(yield* Effect.result(begin(old.database, old.waiting)))).toBe(true);
        expect(bodyCalls).toBe(1);
        yield* owner.recover;
        expect(generations).toBe(2); expect(bodyCalls).toBe(1);
        expect(failure(yield* Effect.result(old.database.assertOpen))).toMatchObject({ reason: "closed" });
        yield* owner.use(prepared => Effect.gen(function* () {
          expect(yield* prepared.database.resolveRequest(old.committed.identity)).toMatchObject({ kind: "committed", result: { key: "lost-ack-committed" } });
          expect(yield* prepared.database.resolveRequest(old.waiting.identity)).toEqual({ kind: "failed" });
          expect(yield* prepared.database.resolveRequest(old.neverStarted.identity)).toEqual({ kind: "failed" });
          expect(failure(yield* Effect.result(prepared.database.readNativeRootBinding(old.selected)))).toMatchObject({ reason: "authorityRevoked" });
          const fresh = yield* begin(prepared.database, yield* claim(prepared.database, prepared.selected, "reconstructed-exclusive"));
          yield* abandon(prepared.database, fresh);
        }));
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
    })), 90_000);

    it("closes the gate before draining a schema worker that is waiting for settlement protection", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), scope = graph.first;
      const seed = yield* graph.database.begin(); yield* seed.insert("entries", { name: "validation witness" });
      yield* graph.database.commit(yield* seed.finalize());
      const proposal = yield* graph.database.prepareSchema({ bundle: scope.successor });
      const selected = yield* begin(graph.database, yield* claim(graph.database, scope.selected, "schema-shutdown-holder"));
      const advanced = yield* Deferred.make<void>();
      const worker = yield* Effect.forkChild(Effect.result(graph.database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 })
        .pipe(Effect.tap(() => Deferred.succeed(advanced, undefined)))));
      yield* pending(advanced);
      yield* graph.database.close();
      expect(Result.isFailure(yield* Fiber.join(worker))).toBe(true);
      expect(failure(yield* Effect.result(selected.operation.requireScopeExclusion))).toMatchObject({ reason: "closed" });
    })), 90_000);

    it("keeps selected admission behind every accepted global publication while independent global saves overlap", run(fixture => Effect.gen(function* () {
      const observation = yield* watchGateReadiness(), pair = yield* holdGlobalPair(fixture, "before-alpha", "before-beta");
      const graph = yield* setup(fixture, pair.persistence);
      yield* prepareGlobalNamespace(graph.database);
      const selectedClaim = yield* claim(graph.database, graph.first.selected, "after-global-pair");
      yield* observation.connect; yield* pair.arm;
      yield* Effect.gen(function* () {
        const first = yield* Effect.forkChild(publishGlobal(graph.database, "before-alpha"));
        yield* reached(pair.firstStarted, first);
        const secondDone = yield* Deferred.make<void>();
        const second = yield* Effect.forkChild(publishGlobal(graph.database, "before-beta").pipe(Effect.tap(() => Deferred.succeed(secondDone, undefined))));
        yield* reached(pair.secondSaved, second);
        yield* pending(secondDone);
        const attempted = yield* Deferred.make<void>(), entered = yield* Deferred.make<void>();
        yield* observation.next(attempted);
        const waiting = yield* Effect.forkChild(begin(graph.database, selectedClaim).pipe(Effect.tap(() => Deferred.succeed(entered, undefined))));
        yield* reached(attempted, waiting); yield* pending(entered);
        expect(yield* Effect.sync(() => waiting.pollUnsafe())).toBeUndefined();
        yield* Deferred.succeed(pair.releaseFirst, undefined);
        yield* Fiber.join(first);
        // The second SQL write is durable, but its original accepted owner has
        // not published or acknowledged it. Releasing only the first G cannot
        // admit a selected callback through the remaining G lifetime.
        yield* pending(entered); yield* pending(secondDone);
        yield* Deferred.succeed(pair.releaseSecond, undefined);
        yield* Fiber.join(second);
        const selected = yield* Fiber.join(waiting);
        yield* selected.operation.requireScopeExclusion;
        expect((yield* graph.database.selectProgram(globalFunction("before-alpha"))).metadata.globalProof).toBe("before-alpha");
        expect((yield* graph.database.selectProgram(globalFunction("before-beta"))).metadata.globalProof).toBe("before-beta");
        yield* abandon(graph.database, selected);
      }).pipe(Effect.ensuring(pair.release));
    })), 90_000);

    it("fences queued globals behind all selected namespaces and reuses their self-settlement ahead of later selection", run(fixture => Effect.gen(function* () {
      const observation = yield* watchGateReadiness(), pair = yield* holdGlobalPair(fixture, "after-alpha", "after-beta");
      const graph = yield* setup(fixture, pair.persistence, true), other = graph.scopes[1];
      if (other === undefined) return yield* Effect.die(new Error("Missing actual component namespace"));
      yield* prepareGlobalNamespace(graph.database);
      const firstClaim = yield* claim(graph.database, graph.first.selected, "selected-global-first");
      const secondClaim = yield* claim(graph.database, other.selected, "selected-global-second");
      const laterClaim = yield* claim(graph.database, graph.first.selected, "selected-global-later");
      const first = yield* begin(graph.database, firstClaim), second = yield* begin(graph.database, secondClaim);
      yield* first.operation.requireScopeExclusion; yield* second.operation.requireScopeExclusion;
      yield* observation.connect; yield* pair.arm;
      yield* Effect.gen(function* () {
        const firstAttempt = yield* Deferred.make<void>(), firstDone = yield* Deferred.make<void>();
        yield* observation.next(firstAttempt);
        const firstGlobal = yield* Effect.forkChild(publishGlobal(graph.database, "after-alpha").pipe(Effect.tap(() => Deferred.succeed(firstDone, undefined))));
        yield* reached(firstAttempt, firstGlobal); yield* pending(firstDone);
        const secondAttempt = yield* Deferred.make<void>(), secondDone = yield* Deferred.make<void>();
        yield* observation.next(secondAttempt);
        const secondGlobal = yield* Effect.forkChild(publishGlobal(graph.database, "after-beta").pipe(Effect.tap(() => Deferred.succeed(secondDone, undefined))));
        yield* reached(secondAttempt, secondGlobal); yield* pending(secondDone);
        const laterAttempt = yield* Deferred.make<void>(), laterEntered = yield* Deferred.make<void>();
        yield* observation.next(laterAttempt);
        const later = yield* Effect.forkChild(begin(graph.database, laterClaim).pipe(Effect.tap(() => Deferred.succeed(laterEntered, undefined))));
        yield* reached(laterAttempt, later); yield* pending(laterEntered);
        yield* settle(graph.database, first);
        // Root namespace is now free. A later S must still honor the already
        // queued G group, while the independent component S remains live.
        yield* second.operation.requireScopeExclusion;
        expect(yield* Deferred.isDone(pair.firstStarted)).toBe(false);
        yield* pending(laterEntered);
        yield* settle(graph.database, second);
        yield* reached(pair.firstStarted, firstGlobal);
        yield* reached(pair.secondSaved, secondGlobal);
        yield* pending(laterEntered); yield* pending(secondDone);
        yield* Deferred.succeed(pair.releaseFirst, undefined);
        yield* Fiber.join(firstGlobal);
        yield* pending(laterEntered);
        yield* Deferred.succeed(pair.releaseSecond, undefined);
        yield* Fiber.join(secondGlobal);
        const last = yield* Fiber.join(later);
        yield* last.operation.requireScopeExclusion;
        yield* abandon(graph.database, last);
      }).pipe(Effect.ensuring(pair.release));
    })), 90_000);

    it.each(["granted", "original deadline expires"] as const)("keeps global-to-selected-to-global order when the selected waiter is %s", outcome => run(fixture => Effect.gen(function* () {
      const observation = yield* watchGateReadiness(), pair = yield* holdGlobalPair(fixture, "fair-alpha", "fair-beta");
      const graph = yield* setup(fixture, pair.persistence);
      yield* prepareGlobalNamespace(graph.database);
      const selectedClaim = yield* claim(graph.database, graph.first.selected, `global-fair-${outcome}`);
      yield* observation.connect; yield* pair.arm;
      yield* Effect.gen(function* () {
        const firstGlobal = yield* Effect.forkChild(publishGlobal(graph.database, "fair-alpha"));
        yield* reached(pair.firstStarted, firstGlobal);
        const selectedAttempt = yield* Deferred.make<void>(), selectedEntered = yield* Deferred.make<void>();
        yield* observation.next(selectedAttempt);
        const deadline = outcome === "granted" ? undefined : (yield* Clock.currentTimeMillis) + 2000;
        const selected = yield* Effect.forkChild(Effect.result(begin(graph.database, selectedClaim, deadline)
          .pipe(Effect.tap(() => Deferred.succeed(selectedEntered, undefined)))));
        yield* reached(selectedAttempt, selected); yield* pending(selectedEntered);
        const laterAttempt = yield* Deferred.make<void>(), laterDone = yield* Deferred.make<void>();
        yield* observation.next(laterAttempt);
        const laterGlobal = yield* Effect.forkChild(publishGlobal(graph.database, "fair-beta").pipe(Effect.tap(() => Deferred.succeed(laterDone, undefined))));
        yield* reached(laterAttempt, laterGlobal);
        yield* pending(pair.secondSaved);
        if (outcome === "granted") {
          yield* Deferred.succeed(pair.releaseFirst, undefined);
          yield* Fiber.join(firstGlobal);
          const root = yield* Effect.fromResult(yield* Fiber.join(selected));
          yield* root.operation.requireScopeExclusion;
          yield* pending(pair.secondSaved);
          // This is authenticated self-settlement while another global caller
          // is already queued, rather than a fresh global-group acquisition.
          yield* settle(graph.database, root);
          yield* reached(pair.secondSaved, laterGlobal);
        } else {
          expect(failure(yield* Fiber.join(selected))).toMatchObject({ reason: "admissionExpired" });
          expect(yield* Deferred.isDone(selectedEntered)).toBe(false);
          // Removing the expired opposite-group ticket lets the later G join
          // the still-held first G. No first-G release supplies this progress.
          yield* reached(pair.secondSaved, laterGlobal);
          yield* pending(laterDone);
          yield* Deferred.succeed(pair.releaseFirst, undefined);
          yield* Fiber.join(firstGlobal);
        }
        yield* Deferred.succeed(pair.releaseSecond, undefined);
        yield* Fiber.join(laterGlobal);
        if (outcome !== "granted") yield* graph.database.abortRequest(selectedClaim.claim);
        const fresh = yield* begin(graph.database, yield* claim(graph.database, graph.first.selected, "after-global-fairness"));
        yield* abandon(graph.database, fresh);
      }).pipe(Effect.ensuring(pair.release));
    }))(), 90_000);

    it("allows independent ordinary and global saves in both acceptance orders with ordered acknowledgements", run(fixture => Effect.gen(function* () {
      type HeldSave = Readonly<{ name: string; held: "ordinary" | "global"; started: Deferred.Deferred<void>;
        release: Deferred.Deferred<void>; independentSaved: Deferred.Deferred<void> }>;
      let heldSave: HeldSave | undefined;
      const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
        const selected = heldSave;
        const ordinary = selected !== undefined && documents(batch).some(document => document.name === selected.name);
        const global = selected !== undefined && writesGlobalProgram(batch, selected.name);
        const held = selected !== undefined && (selected.held === "ordinary" ? ordinary : global);
        const independent = selected !== undefined && (selected.held === "ordinary" ? global : ordinary);
        if (held) { yield* Deferred.succeed(selected.started, undefined); yield* Deferred.await(selected.release); }
        yield* fixture.persistence.write(lease, batch);
        if (independent) yield* Deferred.succeed(selected.independentSaved, undefined);
      }) };
      const graph = yield* setup(fixture, persistence);
      yield* prepareGlobalNamespace(graph.database);
      for (const held of ["ordinary", "global"] as const) {
        const name = `ordinary-global-${held}`, started = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
        const independentSaved = yield* Deferred.make<void>(), independentDone = yield* Deferred.make<void>();
        const ordinary = yield* graph.database.begin();
        yield* ordinary.insert("entries", { name });
        const finalized = yield* ordinary.finalize();
        heldSave = { name, held, started, release, independentSaved };
        yield* Effect.gen(function* () {
          const ordinaryCommit = graph.database.commit(finalized).pipe(Effect.asVoid), globalCommit = publishGlobal(graph.database, name).pipe(Effect.asVoid);
          const first = yield* Effect.forkChild(held === "ordinary" ? ordinaryCommit : globalCommit);
          yield* reached(started, first);
          const independent = yield* Effect.forkChild((held === "ordinary" ? globalCommit : ordinaryCommit)
            .pipe(Effect.tap(() => Deferred.succeed(independentDone, undefined))));
          yield* reached(independentSaved, independent);
          yield* pending(independentDone);
          expect(yield* Effect.sync(() => independent.pollUnsafe())).toBeUndefined();
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(first); yield* Fiber.join(independent);
          expect((yield* graph.database.selectProgram(globalFunction(name))).metadata.globalProof).toBe(name);
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        heldSave = undefined;
      }
      const read = yield* graph.database.begin();
      expect((yield* read.scan("entries", "by_id")).map(row => row.name).toSorted()).toEqual(["ordinary-global-global", "ordinary-global-ordinary"]);
      yield* read.abort();
    })), 90_000);
  });
}
