import { randomBytes } from "node:crypto";
import { Deferred, Effect, Exit, Fiber, Result, Scope } from "effect";
import { describe, expect, it } from "vitest";
import type { DocumentObject } from "flarex-protocol/document-value";
import { compileCurrencyCoreDefinition } from "../../../medusa-adapter/src/modules/currency/schema";
import { compileProductCoreDefinition } from "../../../medusa-adapter/src/modules/product/schema";
import { CoreTransactionError, type CoreDatabase, type CoreError, type CoreNativeOperations,
  type CoreRequestIdentity } from "../../src/core/api";
import { makeCoreApplicationOwner, type CoreApplicationOwner, type CoreApplicationMaintenance } from "../../src/core/applicationOwner";
import { openCoreDatabase } from "../../src/core/database";
import { CorePersistenceError, type CorePersistence, type CoreWriteBatch } from "../../src/core/contracts";
import { readDocumentObject } from "../../src/core/registry";
import { makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import type { CoreNativeDefinition } from "../../src/core/nativePolicy";
import type { CorePersistenceFixture } from "./fixture";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";
import { coreNativeTestBudget } from "./nativeTestBudget";

const target = { scopeUuid: "c55f0efb-510b-4c6f-b20f-28c1ef590815", epochUuid: "4ada3dc3-b2f3-4b32-a9c0-9c191adf18ad" };
const currency = (code: string) => ({ code, name: code, symbol: "N", symbol_native: "N" });
const documents = (batch: CoreWriteBatch) => batch.documents.filter(document => !document.deleted)
  .map(document => Result.getOrThrow(readDocumentObject(document)));
const failure = <A, E>(result: Result.Result<A, E>) => Result.isFailure(result) ? result.failure : undefined;
interface Prepared { readonly database: CoreDatabase }
interface Profile { readonly definition: CoreNativeDefinition; readonly bundle: Effect.Success<ReturnType<typeof makeCoreSchemaBundle>> }

const install = Effect.fn("ApplicationOwnerFixture.install")(function* (fixture: CorePersistenceFixture, product = false) {
  const definition = product ? yield* compileProductCoreDefinition(target) : yield* compileCurrencyCoreDefinition(target);
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
  const options = { schemaBundles: [bundle], schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, now: Effect.succeed(1_000_000_000n),
    randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)), maxConcurrentSaves: 2, maxBatchDelayMilliseconds: 0 };
  yield* Effect.scoped(Effect.gen(function* () {
    const database = yield* openCoreDatabase(fixture.persistence, options);
    const proposal = yield* database.prepareSchema({ bundle });
    for (let step = 0; step < 256; step++) {
      const status = yield* database.schemaStatus(proposal);
      if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
        yield* database.activateSchema(proposal, { programs: [], bundle }); return;
      }
      if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error("Owner fixture schema refused"));
      yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
    }
    return yield* Effect.die(new Error("Owner fixture schema did not activate"));
  }));
  return { definition, bundle, options };
});

const bindings = Effect.fn("ApplicationOwnerFixture.bindings")(function* (database: CoreDatabase, profile: Profile) {
  const binding = yield* database.bindNative({ definition: profile.definition, commands: [{ name: "owner-write", mode: "write" }, { name: "owner-read", mode: "read" }] });
  const root = yield* database.bindNativeRoot({ bundle: profile.bundle, contract: { owner: "recovery-conformance" }, retryProvenNoncommit: true,
    participants: [{ binding, commands: ["owner-write"], limits: { maxIdentities: 128, maxDocumentBytes: 65536 } }], maxFinalUserDocuments: 128 });
  return { binding, root, metadata: yield* database.readNativeRootBinding(root) };
});
const request = (hash: string, key: string): CoreRequestIdentity => ({ kind: "nativeRoot",
  root: { definitionHash: hash }, key, requestHash: key });
const write = Effect.fn("ApplicationOwnerFixture.write")(function* (owner: CoreApplicationOwner<Prepared>, profile: Profile, key: string,
  body: (operations: CoreNativeOperations) => Effect.Effect<unknown, CoreError>, phase: (value: string) => void = () => {},
  beforeBody: Effect.Effect<void, CoreError> = Effect.void) {
  return yield* owner.use(prepared => Effect.gen(function* () {
    const selected = yield* bindings(prepared.database, profile);
    const identity = request(selected.metadata.identity.definitionHash, key);
    phase(`${key}:claim-start`);
    const acquired = yield* prepared.database.claimRequest(identity, selected.root);
    phase(`${key}:claim-ack`);
    if (acquired.kind !== "claimed") return yield* Effect.die(new Error(`Expected fresh claim: ${acquired.kind}`));
    return yield* Effect.acquireUseRelease(prepared.database.beginNativeRoot(selected.root,
      { claim: acquired.claim, chargeRetained: coreNativeTestBudget().chargeRetained }), operation => Effect.gen(function* () {
      yield* beforeBody;
      phase(`${key}:body`);
      yield* body(yield* operation.native(selected.binding));
      yield* prepared.database.commit(yield* operation.finalize(), { claim: acquired.claim, result: { key } });
      return identity;
    }), operation => operation.abort());
  }));
});
const read = (owner: CoreApplicationOwner<Prepared>, profile: Profile, table: string) => owner.use(prepared => Effect.gen(function* () {
  const selected = yield* bindings(prepared.database, profile);
  return yield* Effect.acquireUseRelease(prepared.database.beginNative(selected.binding, { commandName: "owner-read", ...coreNativeTestBudget() }), operation =>
    Effect.gen(function* () { const rows = yield* operation.operations.find(table, {}); yield* operation.finishRead(); return rows; }), operation => operation.abort());
}));

export function registerApplicationOwnerScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>): void {
  describe(label, () => {
    const run = <E>(body: (fixture: CorePersistenceFixture) => Effect.Effect<void, E, Scope.Scope>) => async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(body(fixture).pipe(Effect.timeout("60 seconds")))); } finally { await fixture.close(); }
    };

    it("preserves independently durable B after A fails, gates reads and fences stale capabilities without replay", run(fixture => Effect.gen(function* () {
      const profile = yield* install(fixture), table = profile.definition.tables[0]?.name;
      if (table === undefined) return yield* Effect.die(new Error("Missing Currency table"));
      const enteredA = yield* Deferred.make<void>(), releaseA = yield* Deferred.make<void>(), durableB = yield* Deferred.make<void>();
      const claimedB = yield* Deferred.make<void>(), startB = yield* Deferred.make<void>();
      const readEntered = yield* Deferred.make<void>(), readDrained = yield* Deferred.make<void>();
      const phases: string[] = [];
      let armed = false, preparations = 0, callsA = 0, callsB = 0;
      const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
        const rows = documents(batch);
        if (armed && rows.some(document => document.code === "xaa")) {
          phases.push("A:save-held");
          yield* Deferred.succeed(enteredA, undefined); yield* Deferred.await(releaseA);
          return yield* new CorePersistenceError({ reason: "unavailable", cause: "A save refused" });
        }
        yield* fixture.persistence.write(lease, batch);
        if (armed && rows.some(document => document.key === "owner-B" && document.state === "claimed")) phases.push("B:claim-persisted");
        if (armed && rows.some(document => document.code === "xbb")) yield* Deferred.succeed(durableB, undefined);
      }) };
      const owner = yield* makeCoreApplicationOwner({ persistence, options: profile.options, maximumRequests: 8,
        prepare: database => Effect.sync(() => { preparations++; return { database }; }) });
      const old = yield* owner.use(prepared => Effect.gen(function* () {
        const selected = yield* bindings(prepared.database, profile);
        const claim = yield* prepared.database.claimRequest(request(selected.metadata.identity.definitionHash, "stale-claim"), selected.root);
        if (claim.kind !== "claimed") return yield* Effect.die(new Error("Missing stale-claim witness"));
        return { database: prepared.database, ...selected, claim: claim.claim };
      }));
      const holdingRead = yield* Effect.forkChild(Effect.exit(owner.use(() => Effect.gen(function* () {
        yield* Deferred.succeed(readEntered, undefined); return yield* Effect.never.pipe(Effect.ensuring(Deferred.succeed(readDrained, undefined)));
      }))));
      yield* Deferred.await(readEntered);
      yield* Effect.gen(function* () {
        armed = true;
        // Claim publication is ordered too. Admit B before holding A's body
        // save, while keeping both full owner.use lifetimes tracked.
        const b = yield* Effect.forkChild(Effect.result(write(owner, profile, "owner-B", operations => Effect.gen(function* () { callsB++; yield* operations.writeRows(table, "insert", [currency("xbb")]); }),
          value => { phases.push(value); }, Effect.andThen(Deferred.succeed(claimedB, undefined), Deferred.await(startB)))));
        yield* Deferred.await(claimedB).pipe(Effect.timeoutOrElse({ duration: 5000,
          orElse: () => Effect.die(new Error(`Owner claim barrier: ${phases.join(" > ")}`)) }));
        const a = yield* Effect.forkChild(Effect.result(write(owner, profile, "owner-A", operations => Effect.gen(function* () { callsA++; yield* operations.writeRows(table, "insert", [currency("xaa")]); }), value => { phases.push(value); })));
        yield* Deferred.await(enteredA);
        yield* Deferred.succeed(startB, undefined);
        yield* Deferred.await(durableB).pipe(Effect.timeoutOrElse({ duration: 5000,
          orElse: () => Effect.die(new Error(`Owner schedule barrier: ${phases.join(" > ")}`)) }));
        yield* Deferred.succeed(releaseA, undefined);
        expect(failure(yield* Fiber.join(a))).toMatchObject({ reason: "unavailable", cause: "A save refused" });
        expect(Result.isFailure(yield* Fiber.join(b))).toBe(true);
      }).pipe(Effect.ensuring(Effect.andThen(Deferred.succeed(startB, undefined), Deferred.succeed(releaseA, undefined))));
      yield* owner.recover;
      expect(yield* Deferred.isDone(readDrained)).toBe(true);
      expect(Exit.isFailure(yield* Fiber.join(holdingRead))).toBe(true);
      expect(callsA).toBe(1); expect(callsB).toBe(1); expect(preparations).toBe(2);
      expect((yield* read(owner, profile, table)).map(row => row.code)).toEqual(["xbb"]);
      expect(failure(yield* Effect.result(old.database.readNativeRootBinding(old.root)))).toMatchObject({ reason: "closed" });
      yield* owner.use(prepared => Effect.gen(function* () {
        const selected = yield* bindings(prepared.database, profile);
        expect(failure(yield* Effect.result(prepared.database.readNativeBinding(old.binding)))).toMatchObject({ reason: "authorityRevoked" });
        expect(failure(yield* Effect.result(prepared.database.abortRequest(old.claim)))).toMatchObject({ reason: "foreignClaim" });
        expect(yield* prepared.database.resolveRequest(request(selected.metadata.identity.definitionHash, "owner-A"))).toEqual({ kind: "failed" });
        expect(yield* prepared.database.resolveRequest(request(selected.metadata.identity.definitionHash, "owner-B")))
          .toMatchObject({ kind: "committed", result: { key: "owner-B" } });
      }));
      armed = false;
      yield* write(owner, profile, "owner-A", operations => Effect.gen(function* () { callsA++; yield* operations.writeRows(table, "insert", [currency("xaa")]); }));
      expect(callsA).toBe(2); expect(callsB).toBe(1);
    })), 90_000);

    it("never saves a dependent child when its accepted parent fails, then reconstructs a fresh owner", run(fixture => Effect.gen(function* () {
      const profile = yield* install(fixture, true);
      const parent = profile.definition.tables.find(table => table.localName === "product")?.name;
      const child = profile.definition.tables.find(table => table.localName === "product_variant")?.name;
      if (parent === undefined || child === undefined) return yield* Effect.die(new Error("Missing actual Product tables"));
      const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>(), childAdmitted = yield* Deferred.make<void>();
      const childClaimed = yield* Deferred.make<void>(), startChild = yield* Deferred.make<void>();
      const phases: string[] = [];
      const savedChildren: DocumentObject[] = [];
      let armed = false, signalChildAdmission = false;
      const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
        const rows = documents(batch);
        if (armed && rows.some(document => document.id === "failed-parent")) {
          phases.push("parent:save-held");
          yield* Deferred.succeed(entered, undefined); yield* Deferred.await(release);
          return yield* new CorePersistenceError({ reason: "unavailable" });
        }
        yield* fixture.persistence.write(lease, batch);
        savedChildren.push(...rows.filter(document => document.id === "dependent-child"));
      }) };
      const owner = yield* makeCoreApplicationOwner({ persistence, maximumRequests: 8, options: { ...profile.options, now: Effect.gen(function* () {
        if (signalChildAdmission) { signalChildAdmission = false; phases.push("child:validated"); yield* Deferred.succeed(childAdmitted, undefined); } return 1_000_000_000n;
      }) }, prepare: database => Effect.succeed({ database }) });
      yield* Effect.gen(function* () {
        armed = true;
        const savingChild = yield* Effect.forkChild(Effect.result(write(owner, profile, "dependent-child", operations => Effect.gen(function* () {
          yield* operations.writeRows(child, "insert", [{ id: "dependent-child", title: "child", product_id: "failed-parent" }]); signalChildAdmission = true;
        }), value => { phases.push(value); }, Effect.andThen(Deferred.succeed(childClaimed, undefined), Deferred.await(startChild)))));
        yield* Deferred.await(childClaimed).pipe(Effect.timeoutOrElse({ duration: 5000,
          orElse: () => Effect.die(new Error(`Dependent claim barrier: ${phases.join(" > ")}`)) }));
        const savingParent = yield* Effect.forkChild(Effect.result(write(owner, profile, "failed-parent", operations => operations.writeRows(parent, "insert", [{ id: "failed-parent", title: "parent", handle: "parent" }]), value => { phases.push(value); })));
        yield* Deferred.await(entered);
        yield* Deferred.succeed(startChild, undefined);
        yield* Deferred.await(childAdmitted).pipe(Effect.timeoutOrElse({ duration: 5000,
          orElse: () => Effect.die(new Error(`Dependent admission barrier: ${phases.join(" > ")}`)) }));
        yield* Deferred.succeed(release, undefined);
        expect(Result.isFailure(yield* Fiber.join(savingParent))).toBe(true);
        expect(Result.isFailure(yield* Fiber.join(savingChild))).toBe(true);
      }).pipe(Effect.ensuring(Effect.andThen(Deferred.succeed(startChild, undefined), Deferred.succeed(release, undefined))));
      yield* owner.recover;
      expect(savedChildren).toEqual([]);
      expect(yield* read(owner, profile, parent)).toEqual([]);
      expect(yield* read(owner, profile, child)).toEqual([]);
    })), 90_000);

    it("retains unknown claim enrollment before token issuance and reconciles unknown committed outcomes", run(fixture => Effect.gen(function* () {
      const profile = yield* install(fixture), table = profile.definition.tables[0]?.name;
      if (table === undefined) return yield* Effect.die(new Error("Missing Currency table"));
      let lose: "none" | "claimed" | "committed" = "none", preparations = 0;
      const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
        yield* fixture.persistence.write(lease, batch);
        if (lose !== "none" && documents(batch).some(document => document.state === lose)) {
          lose = "none"; return yield* new CorePersistenceError({ reason: "uncertainWrite" });
        }
      }) };
      const owner = yield* makeCoreApplicationOwner({ persistence, options: profile.options, maximumRequests: 4,
        prepare: database => Effect.sync(() => { preparations++; return { database }; }) });
      let identity: CoreRequestIdentity | undefined;
      lose = "claimed";
      expect(failure(yield* Effect.result(owner.use(prepared => Effect.gen(function* () {
        const selected = yield* bindings(prepared.database, profile);
        identity = request(selected.metadata.identity.definitionHash, "unknown-claim");
        return yield* prepared.database.claimRequest(identity, selected.root);
      }))))).toMatchObject({ reason: "uncertainWrite" });
      yield* owner.recover;
      if (identity === undefined) return yield* Effect.die(new Error("Missing attempted request correlation"));
      const observed = identity;
      expect(yield* owner.use(prepared => prepared.database.resolveRequest(observed))).toEqual({ kind: "failed" });
      yield* write(owner, profile, "unknown-claim", operations => operations.writeRows(table, "insert", [currency("xcc")]));
      lose = "committed";
      expect(failure(yield* Effect.result(write(owner, profile, "unknown-commit", operations => operations.writeRows(table, "insert", [currency("xdd")])))))
        .toMatchObject({ reason: "uncertainWrite" });
      yield* owner.recover;
      expect(preparations).toBe(3);
      yield* owner.use(prepared => Effect.gen(function* () {
        const selected = yield* bindings(prepared.database, profile);
        expect(yield* prepared.database.claimRequest(request(selected.metadata.identity.definitionHash, "unknown-commit"), selected.root))
          .toMatchObject({ kind: "committed", result: { key: "unknown-commit" } });
      }));
      expect((yield* read(owner, profile, table)).map(row => row.code).toSorted()).toEqual(["xcc", "xdd"]);
    })), 90_000);

    it("allows tracked boot maintenance, bounds multiple claims within one use and keeps failed reconstruction unavailable", run(fixture => Effect.gen(function* () {
      const profile = yield* install(fixture);
      const maintenanceReady = yield* Deferred.make<CoreApplicationMaintenance>();
      const maintenanceRan = yield* Deferred.make<void>();
      let refuse = false;
      const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => refuse
        ? Effect.fail(new CorePersistenceError({ reason: "unavailable" })) : fixture.persistence.write(lease, batch) };
      const building = yield* Effect.forkChild(makeCoreApplicationOwner({ persistence, options: profile.options, maximumRequests: 2,
        onKernelReady: (maintenance, phase) => phase === "initial" ? Deferred.succeed(maintenanceReady, maintenance).pipe(Effect.asVoid) : Effect.void,
        prepare: (database, phase) => phase === "initial" ? Deferred.await(maintenanceRan).pipe(Effect.as({ database }))
          : Effect.fail(new CoreTransactionError({ reason: "authorityRevoked", cause: "Reconstruction refused" })) }));
      const maintenance = yield* Deferred.await(maintenanceReady);
      yield* maintenance.useDatabase(database => database.publishedTimestamp);
      yield* Deferred.succeed(maintenanceRan, undefined);
      const owner = yield* Fiber.join(building);
      yield* owner.use(prepared => Effect.gen(function* () {
        const selected = yield* bindings(prepared.database, profile);
        const first = yield* prepared.database.claimRequest(request(selected.metadata.identity.definitionHash, "capacity-one"), selected.root);
        const second = yield* prepared.database.claimRequest(request(selected.metadata.identity.definitionHash, "capacity-two"), selected.root);
        expect(failure(yield* Effect.result(prepared.database.claimRequest(request(selected.metadata.identity.definitionHash, "capacity-three"), selected.root))))
          .toMatchObject({ reason: "capacity", cause: "Unresolved request census limit" });
        expect(yield* prepared.database.resolveRequest(request(selected.metadata.identity.definitionHash, "capacity-three"))).toEqual({ kind: "missing" });
        if (first.kind !== "claimed" || second.kind !== "claimed") return yield* Effect.die(new Error("Missing bounded claims"));
        yield* prepared.database.abortRequest(first.claim); yield* prepared.database.abortRequest(second.claim);
      }));
      refuse = true;
      expect(Result.isFailure(yield* Effect.result(owner.use(prepared => Effect.gen(function* () {
        const selected = yield* bindings(prepared.database, profile);
        return yield* prepared.database.claimRequest(request(selected.metadata.identity.definitionHash, "fail-build"), selected.root);
      }))))).toBe(true);
      refuse = false;
      expect(Result.isFailure(yield* Effect.result(owner.recover))).toBe(true);
      let invoked = false;
      expect(Result.isFailure(yield* Effect.result(owner.use(() => Effect.sync(() => { invoked = true; }))))).toBe(true);
      expect(invoked).toBe(false);
      yield* owner.close;
      expect(failure(yield* Effect.result(owner.recover))).toMatchObject({ reason: "closed" });
    })), 90_000);
  });
}
