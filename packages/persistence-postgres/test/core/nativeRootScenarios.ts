import { randomBytes } from "node:crypto";
import { Effect, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { defineSchema, defineTable } from "flarex/server";
import { v } from "flarex/values";
import { prepareApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { compileCurrencyCoreDefinition } from "../../../medusa-adapter/src/modules/currency/schema";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import { makeCoreNativeDefinition } from "../../src/core/nativePolicy";
import { makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import { openCoreDatabase } from "../../src/core/database";
import { createTransactionIdGenerator } from "../../src/core/transactionIdGenerator";
import type { CoreDatabase, CoreError, CoreNativeRootOperation, CoreNativeRootParticipant, CoreRequestClaim, CoreRequestIdentity } from "../../src/core/api";
import type { CorePersistenceFixture } from "./fixture";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";
import { coreNativeTestBudget } from "./nativeTestBudget";

const target = { scopeUuid: "64395396-fde0-4f25-b3d5-8e9f323312d4", epochUuid: "8d516cd6-38d2-4c19-b9e7-d750beac4628" };
const payloadBody = (title: string) => ({ title, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" });
const currencyBody = (code: string) => ({ code, name: code, symbol: "N", symbol_native: "N" });
const failure = <Value>(result: Result.Result<Value, CoreError>) => Result.isFailure(result) ? result.failure : undefined;

const setup = Effect.fn("NativeRootFixture.setup")(function* (fixture: CorePersistenceFixture, maxFinalUserDocuments = 128,
  selectedLimits?: Readonly<{ payload: number; currency: number }>) {
  const application = yield* prepareApplicationSchemaSource(defineSchema({ users: defineTable({ name: v.string() }) }));
  const compiled = yield* compilePayloadCollections([{ slug: "posts", fields: [{ name: "title", type: "text", required: true, unique: true }] }]);
  const payload = yield* makeCoreNativeDefinition({ ...target, source: compiled.sourceContract });
  const currency = yield* compileCurrencyCoreDefinition(target);
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "application", definition: application },
    { kind: "native", definition: payload }, { kind: "native", definition: currency }] });
  let now = 1_000_000_000n;
  let latestSeed: Uint8Array | undefined;
  const options = { schemaBundles: [bundle], now: Effect.sync(() => now),
    randomBytes: (length: 16 | 32) => Effect.sync(() => {
      const bytes = randomBytes(length);
      if (length === 32) latestSeed = bytes.slice();
      return bytes;
    }),
    schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, maxBatchDelayMilliseconds: 0 };
  const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
  const proposal = yield* database.prepareSchema({ bundle });
  let ready = false;
  for (let step = 0; step < 128; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
      yield* database.activateSchema(proposal, { programs: [], bundle }); ready = true; break;
    }
    yield* database.advanceSchema(proposal, { pageSize: 8, maxPages: 8 });
  }
  if (!ready) return yield* Effect.die(new Error("Native root schema did not become ready"));
  const payloadBinding = yield* database.bindNative({ definition: payload });
  const currencyBinding = yield* database.bindNative({ definition: currency, commands: [
    { name: "currency-write", mode: "write" }, { name: "currency-read", mode: "read" },
  ] });
  const participants: readonly CoreNativeRootParticipant[] = [
    { binding: payloadBinding, commands: ["payload-create", "payload-update", "payload-delete"],
      limits: { maxIdentities: selectedLimits?.payload ?? 256, maxDocumentBytes: 65536 } },
    { binding: currencyBinding, commands: ["currency-write"], limits: { maxIdentities: selectedLimits?.currency ?? 128, maxDocumentBytes: 65536 } },
  ];
  const root = yield* database.bindNativeRoot({ bundle, contract: { name: "core-native-root-conformance", version: 1 },
    participants, applicationInsert: { table: "users", maxDocumentBytes: 65536 }, maxFinalUserDocuments });
  const metadata = yield* database.readNativeRootBinding(root);
  const grant = metadata.applicationInsert?.binding;
  const currencyTable = currency.tables[0]?.name;
  if (grant === undefined || currencyTable === undefined) return yield* Effect.die(new Error("Missing selected root participant"));
  let requests = 0;
  const begin = Effect.fn("NativeRootFixture.begin")(function* () {
    const identity: CoreRequestIdentity = { kind: "nativeRoot", root: metadata.identity,
      key: `native-root-${++requests}`, requestHash: `arguments-${requests}` };
    const acquired = yield* database.claimRequest(identity, root);
    if (acquired.kind !== "claimed") return yield* Effect.die(new Error("Fresh root request was not claimed"));
    const operation = yield* database.beginNativeRoot(root, { claim: acquired.claim, chargeRetained: coreNativeTestBudget().chargeRetained });
    return { operation, claim: acquired.claim, identity };
  });
  return { database, options, bundle, payload, currency, payloadBinding, currencyBinding, currencyTable,
    root, metadata, grant, begin, expectedInternalIds: (count: number) => {
      if (latestSeed === undefined) throw new Error("Native root did not acquire a transaction seed.");
      const preview = Result.getOrThrow(createTransactionIdGenerator(latestSeed, now));
      return Array.from({ length: count }, () => preview.nextInternalId());
    }, setNow: (value: bigint) => { now = value; } };
});

const closeRequest = Effect.fn("NativeRootFixture.abort")(function* (
  database: CoreDatabase, selected: Readonly<{ operation: CoreNativeRootOperation; claim: CoreRequestClaim }>,
) { yield* selected.operation.abort(); yield* database.abortRequest(selected.claim); });

export function registerNativeRootScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>): void {
  describe(label, () => {
    it("confines source views and the one Application pending insert grant", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture), selected = yield* tested.begin();
        const payload = yield* selected.operation.native(tested.payloadBinding), currency = yield* selected.operation.native(tested.currencyBinding);
        const application = yield* selected.operation.applicationInsert(tested.grant);
        const id = yield* payload.insert("posts", payloadBody("private source"));
        expect(failure(yield* Effect.result(currency.get(id)))).toMatchObject({ reason: "authorityRevoked" });
        const foreign = yield* tested.database.bindNative({ definition: tested.payload });
        expect(failure(yield* Effect.result(selected.operation.native(foreign)))).toMatchObject({ reason: "authorityRevoked" });
        expect(failure(yield* Effect.result(selected.operation.applicationInsert({ ...tested.grant })))).toMatchObject({ reason: "authorityRevoked" });
        expect(failure(yield* Effect.result(tested.database.begin({ claim: selected.claim })))).toMatchObject({ reason: "foreignClaim" });
        const appId = yield* application.insert({ name: "pending only" });
        expect(Option.getOrThrow(yield* application.readPending(appId))).toMatchObject({ name: "pending only" });
        expect(failure(yield* Effect.result(application.readPending(id)))).toMatchObject({ reason: "authorityRevoked" });
        expect(failure(yield* Effect.result(application.insert({ name: "second insert" })))).toMatchObject({ reason: "capacity" });
        yield* closeRequest(tested.database, selected);
        expect(failure(yield* Effect.result(payload.get(id)))).toMatchObject({ reason: "closed" });
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("publishes all three children with one outcome and authenticates cold replay", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture), selected = yield* tested.begin();
        const expectedIds = tested.expectedInternalIds(3);
        const payload = yield* selected.operation.native(tested.payloadBinding), currency = yield* selected.operation.native(tested.currencyBinding);
        const application = yield* selected.operation.applicationInsert(tested.grant);
        const postId = yield* payload.insert("posts", payloadBody("atomic"));
        const rows = yield* currency.writeRows(tested.currencyTable, "upsert", [currencyBody("xzz")]);
        expect(rows).toMatchObject([{ code: "xzz", decimal_digits: 0, rounding: "0", raw_rounding: { value: "0", precision: 20 } }]);
        const appId = yield* application.insert({ name: "atomic" });
        const currencyId = rows[0]?._id;
        if (typeof currencyId !== "string") return yield* Effect.die(new Error("Missing generated Currency ID."));
        expect([postId, currencyId, appId].map(id => Result.getOrThrow(decodeDocumentId(id)).internalId)).toEqual(expectedIds);
        const before = yield* tested.database.publishedTimestamp;
        const result = { postId, appId, code: "xzz" };
        const committed = yield* tested.database.commit(yield* selected.operation.finalize(), { claim: selected.claim, result });
        expect(committed).toBeGreaterThan(before);
        expect(yield* tested.database.publishedTimestamp).toBe(committed);
        expect(yield* tested.database.claimRequest(selected.identity, tested.root)).toEqual({ kind: "committed", timestamp: committed, result });
        expect(yield* tested.database.publishedTimestamp).toBe(committed);
        const ordinary = yield* tested.database.begin();
        expect(Option.getOrThrow(yield* ordinary.get(appId))).toMatchObject({ name: "atomic" });
        yield* ordinary.abort();
        yield* tested.database.close();
        const reopened = yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.promise(() => fixture.reopen()), tested.options), db => db.close());
        const payloadBinding = yield* reopened.bindNative({ definition: tested.payload });
        const currencyBinding = yield* reopened.bindNative({ definition: tested.currency, commands: [
          { name: "currency-write", mode: "write" }, { name: "currency-read", mode: "read" },
        ] });
        const rebuiltRoot = yield* reopened.bindNativeRoot({ bundle: tested.bundle, contract: { name: "core-native-root-conformance", version: 1 },
          participants: tested.metadata.participants.map(participant => ({ binding: participant.definition.identity.sourceKey === "payload" ? payloadBinding : currencyBinding,
            commands: participant.commands.map(command => command.name), limits: participant.limits })),
          applicationInsert: { table: "users", maxDocumentBytes: 65536 }, maxFinalUserDocuments: 128 });
        expect((yield* reopened.readNativeRootBinding(rebuiltRoot)).identity).toEqual(tested.metadata.identity);
        expect(yield* reopened.claimRequest(selected.identity, rebuiltRoot)).toEqual({ kind: "committed", timestamp: committed, result });
        const read = yield* reopened.beginNative(currencyBinding, { ...coreNativeTestBudget(), commandName: "currency-read" });
        expect(yield* read.operations.find(tested.currencyTable, { code: "xzz" })).toMatchObject([{ code: "xzz" }]);
        yield* read.finishRead();
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("counts coalesced final user identities rather than staging attempts", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture, 2), selected = yield* tested.begin();
        const payload = yield* selected.operation.native(tested.payloadBinding);
        const first = yield* payload.insert("posts", payloadBody("first"));
        yield* payload.patch(first, { title: "second" }); yield* payload.patch(first, { title: "second" });
        const removed = yield* payload.insert("posts", payloadBody("new then removed")); yield* payload.delete(removed);
        const application = yield* selected.operation.applicationInsert(tested.grant); yield* application.insert({ name: "second final identity" });
        yield* tested.database.commit(yield* selected.operation.finalize(), { claim: selected.claim, result: null });
        const refused = yield* tested.begin(), other = yield* refused.operation.native(tested.payloadBinding);
        for (const title of ["over-one", "over-two", "over-three"]) yield* other.insert("posts", payloadBody(title));
        expect(failure(yield* Effect.result(refused.operation.finalize()))).toMatchObject({ reason: "capacity" });
        yield* closeRequest(tested.database, refused);
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("preserves a child's identity cap when aggregate root capacity remains available", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture, 128, { payload: 1, currency: 2 }), selected = yield* tested.begin();
        const currency = yield* selected.operation.native(tested.currencyBinding), payload = yield* selected.operation.native(tested.payloadBinding);
        expect(yield* currency.writeRows(tested.currencyTable, "upsert", [currencyBody("xsc"), currencyBody("xsd")])).toHaveLength(2);
        yield* payload.insert("posts", payloadBody("one Payload identity"));
        // The aggregate still has the unused App allowance. It cannot be spent
        // as a second identity by this source.
        expect(failure(yield* Effect.result(payload.insert("posts", payloadBody("second Payload identity")))))
          .toMatchObject({ reason: "capacity" });
        yield* closeRequest(tested.database, selected);
      }))); } finally { await fixture.close(); }
    }, 90_000);

    it("validates a whole relational batch before mutation and preserves distinct upsert/update time", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const tested = yield* setup(fixture), invalid = yield* tested.begin();
        const currency = yield* invalid.operation.native(tested.currencyBinding);
        const [expectedFirstId] = tested.expectedInternalIds(1);
        expect(failure(yield* Effect.result(currency.writeRows(tested.currencyTable, "upsert", [currencyBody("xaa"),
          { ...currencyBody("xab"), decimal_digits: "invalid" }])))).toMatchObject({ reason: "documentValidation" });
        expect(failure(yield* Effect.result(currency.writeRows(tested.currencyTable, "upsert", [currencyBody("xaa"), currencyBody("xaa")]))))
          .toMatchObject({ reason: "invalidInput" });
        expect(yield* currency.find(tested.currencyTable, {})).toEqual([]);
        const [afterRefusal] = yield* currency.writeRows(tested.currencyTable, "upsert", [currencyBody("xaa")]);
        if (typeof afterRefusal?._id !== "string") return yield* Effect.die(new Error("Missing first generated Currency ID."));
        expect(Result.getOrThrow(decodeDocumentId(afterRefusal._id)).internalId).toEqual(expectedFirstId);
        yield* closeRequest(tested.database, invalid);
        const first = yield* tested.begin(), create = yield* first.operation.native(tested.currencyBinding);
        const [inserted] = yield* create.writeRows(tested.currencyTable, "upsert", [currencyBody("xzc")]);
        if (inserted === undefined || typeof inserted._id !== "string") return yield* Effect.die(new Error("Missing inserted Currency"));
        yield* tested.database.commit(yield* first.operation.finalize(), { claim: first.claim, result: null });
        tested.setNow(2_000_000_000n);
        const deleted = yield* tested.begin(), soft = yield* deleted.operation.native(tested.currencyBinding);
        const [deletedRow] = yield* soft.writeRows(tested.currencyTable, "update", [{ code: "xzc", deleted_at: "2026-11-01T00:00:00.000Z" }]);
        expect(deletedRow?.updated_at).not.toBe(inserted.updated_at);
        yield* tested.database.commit(yield* deleted.operation.finalize(), { claim: deleted.claim, result: null });
        tested.setNow(3_000_000_000n);
        const changed = yield* tested.begin(), update = yield* changed.operation.native(tested.currencyBinding);
        const [restored] = yield* update.writeRows(tested.currencyTable, "upsert", [{ code: "xzc", name: "restored" }]);
        expect(restored).toMatchObject({ deleted_at: null, updated_at: deletedRow?.updated_at });
        const [advanced] = yield* update.writeRows(tested.currencyTable, "update", [{ code: "xzc", name: "updated" }]);
        expect(advanced?.updated_at).toBe(new Date(changed.operation.unixTime).toISOString());
        expect(advanced?.updated_at).not.toBe(restored?.updated_at);
        expect(yield* update.writeRows(tested.currencyTable, "update", [{ code: "missing", name: "skip" }])).toEqual([]);
        const removed = yield* update.deleteRows(tested.currencyTable, ["xzc"]);
        expect(removed).toMatchObject([{ code: "xzc", _id: inserted._id }]);
        const [replacement] = yield* update.writeRows(tested.currencyTable, "upsert", [currencyBody("xzc")]);
        expect(replacement?._id).not.toBe(inserted._id);
        yield* tested.database.commit(yield* changed.operation.finalize(), { claim: changed.claim, result: null });
      }))); } finally { await fixture.close(); }
    }, 90_000);
  });
}
