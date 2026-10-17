import { and, eq } from "drizzle-orm";
import { Clock, Context, Deferred, Effect, Fiber, Result, Schema } from "effect";
import { expect } from "vitest";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1FromBytesResult } from "flarex-protocol/app-document-id";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "../../application/applicationNativeMutationTestFixture";
import type { FrameworkSchemaTarget } from "../../../src/installation/frameworkSchema/target";
import type { RelationalSession } from "../../../src/database/relationalTransaction/session";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import type { LogicalCommerceSelectionInput } from "../../../src/frameworks/commerceTransaction/logicalSelection";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError, type CommerceTransactionError } from "../../../src/frameworks/commerceTransaction/model";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import { requireAtomicCommerceScopeExclusion } from "../../../src/frameworks/atomicCommerce/execution";
import type { LogicalCommerceCallValidation } from "../../../src/frameworks/atomicCommerce/participants";
import type { LogicalCommerceActivity } from "../../../src/frameworks/commerceTransaction/logicalParticipant";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { runDrizzleStatementEffect } from "../../../src/database/drizzleStatementEffect";
import { runEffectTransaction } from "../../../src/database/effectTransaction";
import { readAppRowAtSnapshotInTransactionEffect, type AppRowReadResultV1, type ReadAppRowError } from "../../../src/storage/documents/appRows";
import { fxAppRowCurrent, fxAppRowRevisions, fxSystemCommits, fxSystemCommitAppRowChanges, fxSystemIdempotency, fxSystemScopeClocks } from "../../../src/database/schema";

const decodeRows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const keys = (value: unknown) => decodeRows(value).map(row => Schema.decodeUnknownSync(Schema.String)(row.entry_key));
const operations = Schema.decodeUnknownEffect(Schema.Literals(["seed", "append", "pending", "lifecycle", "patchA", "reconstitute", "reuse", "escape", "cancel", "forgedGeneration", "denied", "caughtDenied"]));
const insertionQuery = (direction: "asc" | "desc" = "asc") => ({ fields: ["entry_key", "text", "deleted_at"],
  predicate: { kind: "in", column: "folio_key", values: ["owner"] }, order: { kind: "storageInsertion", direction }, skip: 0, take: 8 });

/** These are real installed neutral sources. The three cases isolate read/write
 * lifecycle, retained metadata and concurrent indexed membership respectively. */
export const logicalInsertionOrderScenario = Effect.fn("LogicalInsertionOrder.scenario")(function* <Persistence extends ApplicationNativeMutationPersistence>(
  fixture: ApplicationNativeMutationFixture<Persistence>, target: FrameworkSchemaTarget,
  schemaVersionId: CatalogSchemaVersionId, source: unknown, session: RelationalSession,
  proof: "lifecycle" | "metadata" | "race",
) {
  const dataset = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] },
    1_048_576, { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
  const logicalStorage: LogicalCommerceSelectionInput = { ports: { controlDb: fixture.control.drizzle, authority: fixture.authorityPorts },
    unique: fixture.uniqueConstraintEligibility, schemaVersionId, source,
    initialization: { stepId: "folio.empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
  const hostInput = { hostRuntime: preparedHostTestRuntime(fixture.target.drizzle), database: fixture.target.drizzle,
    session, target, deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
    authority: fixture.authorityPorts, application: fixture.activation, identityAndAccessPolicy: { profile: "neutral-storage-insertion-order" } };
  const participant = defineAtomicCommerceParticipant("neutralInsertionOrder");
  const selected = defineCommerceCommand("neutralInsertionRead", "read", (ctx, input) => Effect.gen(function* () {
    const store = yield* ctx.table("entry");
    const query = insertionQuery(input === "desc" ? "desc" : "asc");
    if (input === "fresh") query.predicate = { kind: "in", column: "entry_key", values: ["post-upgrade"] };
    return [...yield* store.prepareRead(query).find(ctx.manager)];
  }));
  const ordinary = defineCommerceCommand("neutralInsertionOrdinaryRead", "read", ctx => Effect.gen(function* () {
    return [...yield* (yield* ctx.table("entry")).find(ctx.manager, { order: { column: "entry_key", direction: "asc" } })];
  }));
  yield* Effect.acquireUseRelease(makeCommerceHost({ ...hostInput, logicalStorage, commands: [ordinary] }), host => host.initialize([]), host => host.close);
  let escaped: (() => Effect.Effect<unknown, CommerceTransactionError>) | undefined, invocations = 0;
  const mutate = defineCommerceCommand("neutralInsertionWrite", "write", (ctx, input) => Effect.gen(function* () {
    invocations++;
    const operation = yield* operations(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    const table = yield* ctx.table("entry");
    const read = () => table.prepareRead(insertionQuery()).find(ctx.manager);
    if (operation === "seed") {
      yield* (yield* ctx.table("folio")).write(ctx.manager, "insert", [{ folio_key: "owner" }, { folio_key: "outside" }]);
      yield* table.write(ctx.manager, "insert", [{ entry_key: "Z", folio_key: "owner", text: "first" },
        { entry_key: "A", folio_key: "owner", text: "second" }, { entry_key: "outside", folio_key: "outside", text: "excluded" }]);
    } else if (operation === "append" || operation === "cancel") {
      yield* table.write(ctx.manager, "insert", [{ entry_key: operation === "append" ? "B" : "cancelled", folio_key: "owner", text: "tail" }]);
      if (operation === "cancel") return yield* Effect.interrupt;
    } else if (operation === "pending") {
      yield* table.write(ctx.manager, "insert", [{ entry_key: "C", folio_key: "owner", text: "pending" }]);
      yield* table.write(ctx.manager, "upsert", [{ entry_key: "C", text: "patched" }]);
      yield* table.write(ctx.manager, "insert", [{ entry_key: "transient", folio_key: "owner", text: "deleted" }]);
      yield* table.delete(ctx.manager, [{ entry_key: "transient" }]);
    } else if (operation === "lifecycle") {
      yield* table.write(ctx.manager, "upsert", [{ entry_key: "Z", text: "updated" }]);
      yield* table.lifecycle(ctx.manager, "softDelete", [{ entry_key: "Z" }]);
      yield* table.lifecycle(ctx.manager, "restore", [{ entry_key: "Z" }]);
    } else if (operation === "patchA") {
      yield* table.write(ctx.manager, "upsert", [{ entry_key: "A", text: "later retained revision" }]);
    } else if (operation === "reconstitute") {
      const removed = yield* table.delete(ctx.manager, [{ entry_key: "Z" }]);
      if (table.reconstitute === undefined || removed[0] === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      yield* table.reconstitute(ctx.manager, [removed[0]]);
    } else if (operation === "reuse") {
      yield* table.delete(ctx.manager, [{ entry_key: "A" }]);
      yield* table.write(ctx.manager, "insert", [{ entry_key: "A", folio_key: "owner", text: "new identity" }]);
    } else if (operation === "forgedGeneration") {
      yield* table.write(ctx.manager, "insert", [{ entry_key: "forged", folio_key: "owner", text: "untrusted birth", insertionCommitSeq: 1, insertionAttemptOrdinal: 0 }]);
    } else if (operation === "escape") escaped = read;
    else if (operation === "denied" || operation === "caughtDenied") {
      const attempt = read();
      if (operation === "caughtDenied") { yield* Effect.result(attempt); return null; }
      return [...yield* attempt];
    }
    return [...yield* read()];
  }));
  const activities: LogicalCommerceActivity[] = [];
  const validateLogicalCall: LogicalCommerceCallValidation = (_call, activity) => Effect.sync(() => { activities.push(activity); });
  const root = defineAtomicCommerceCommand("neutralInsertionRoot", (ctx, input) => Effect.gen(function* () {
    yield* requireAtomicCommerceScopeExclusion(ctx); return yield* ctx.call(participant, mutate, input);
  }));
  const readRoot = defineAtomicCommerceCommand("neutralInsertionReadRoot", (ctx, input) => ctx.call(participant, selected, input));
  const ordinaryRoot = defineAtomicCommerceCommand("neutralInsertionOrdinaryRoot", ctx => ctx.call(participant, ordinary, null));
  const commands = [mutate, selected, ordinary], roots = [root, readRoot, ordinaryRoot];
  const member = { participant, logicalStorage, commands, allowReconstitution: true as const,
    allowStorageInsertionOrder: true as const, validateLogicalCall };
  const statement = <A>(query: PromiseLike<A>) => runDrizzleStatementEffect(query, cause => new Error("Neutral insertion inventory", { cause }));
  const documentId = (row: typeof fxAppRowRevisions.$inferSelect) => appDocumentIdV1FromRowIdentity({ tableId: row.tableId,
    rowId: Result.getOrThrow(appRowIdHexV1FromBytesResult(row.rowId)) });
  const inventory = Effect.gen(function* () { return {
    pointers: yield* statement(fixture.target.drizzle.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId)),
    revisions: yield* statement(fixture.target.drizzle.select().from(fxAppRowRevisions).orderBy(fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq)),
    commits: yield* statement(fixture.target.drizzle.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq)),
    facts: yield* statement(fixture.target.drizzle.select().from(fxSystemCommitAppRowChanges).orderBy(fxSystemCommitAppRowChanges.commitSeq, fxSystemCommitAppRowChanges.changeOrdinal)),
    outcomes: yield* statement(fixture.target.drizzle.select().from(fxSystemIdempotency).orderBy(fxSystemIdempotency.requestKey)),
    clocks: yield* statement(fixture.target.drizzle.select().from(fxSystemScopeClocks)),
  }; });
  const live = Context.get(Context.empty(), Clock.Clock);
  const clockAt = (time: number): Clock.Clock => ({ currentTimeMillis: Effect.succeed(time), currentTimeMillisUnsafe: () => time,
    currentTimeNanos: Effect.succeed(BigInt(time) * 1_000_000n), currentTimeNanosUnsafe: () => BigInt(time) * 1_000_000n,
    monotonicTimeNanos: live.monotonicTimeNanos, monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(), sleep: duration => live.sleep(duration) });
  yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, executionIsolation: "scopeExclusive", commands: roots, participants: [member] }), host => Effect.gen(function* () {
    expect(keys(yield* host.run(host.newRequestKey(), root, "seed").pipe(Effect.provideService(Clock.Clock, clockAt(5_000))))).toEqual(["Z", "A"]);
    const seeded = yield* inventory;
    const seedActivity = activities[0], zMutation = seedActivity?.mutations.find(mutation => mutation.after?.entry_key === "Z");
    if (zMutation?.after === null || zMutation?.after === undefined) return yield* Effect.die(new Error("Missing authentic Z birth"));
    const zId = zMutation.after._id;
    if (typeof zId !== "string") return yield* Effect.die(new Error("Missing internal Z identity"));
    const zBirth = seeded.revisions.find(row => documentId(row) === zId);
    if (zBirth === undefined) return yield* Effect.die(new Error("Missing committed Z birth revision"));
    expect(zBirth.insertionCommitSeq).toBe(zBirth.commitSeq); expect(zBirth.insertionAttemptOrdinal).toBe(2);
    expect(seedActivity?.relationalReads.at(-1)).toMatchObject({ total: 2, returned: 2, orderedIdentities: [{ entry_key: "Z" }, { entry_key: "A" }] });
    expect(keys(yield* host.run(host.newRequestKey(), readRoot, "desc"))).toEqual(["A", "Z"]);
    if (proof === "race") {
      const reached = yield* Deferred.make<void>(), resume = yield* Deferred.make<void>();
      const readyToInsert = yield* Deferred.make<void>(), insertResume = yield* Deferred.make<void>();
      const raceInsert = defineCommerceCommand("neutralInsertionRaceInsert", "write", (ctx, input) => Effect.gen(function* () {
        const key = yield* Schema.decodeUnknownEffect(Schema.String)(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
        return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", [{ entry_key: key, folio_key: "owner", text: "concurrent tail" }])];
      }));
      const pendingRead = defineAtomicCommerceCommand("neutralInsertionPendingRead", ctx => Effect.gen(function* () {
        const rows = yield* ctx.call(participant, selected, "asc");
        yield* Deferred.succeed(reached, undefined); yield* Deferred.await(resume); return rows;
      }));
      const insertRoot = defineAtomicCommerceCommand("neutralInsertionRaceRoot", (ctx, input) => ctx.call(participant, raceInsert, input));
      const delayedInsert = defineAtomicCommerceCommand("neutralInsertionDelayedInsert", ctx => Effect.gen(function* () {
        yield* Deferred.succeed(readyToInsert, undefined); yield* Deferred.await(insertResume);
        return yield* ctx.call(participant, raceInsert, "G");
      }));
      yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: [pendingRead, insertRoot, delayedInsert, readRoot],
        participants: [{ participant, logicalStorage, commands: [selected, raceInsert], allowStorageInsertionOrder: true, validateLogicalCall }] }), racing => Effect.gen(function* () {
        const pending = yield* Effect.forkChild(Effect.result(racing.run(racing.newRequestKey(), pendingRead, null)));
        yield* Deferred.await(reached);
        yield* racing.run(racing.newRequestKey(), insertRoot, "E");
        yield* Deferred.succeed(resume, undefined);
        expect(yield* Fiber.join(pending)).toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
        expect(keys(yield* racing.run(racing.newRequestKey(), readRoot, "asc"))).toEqual(["Z", "A", "E"]);
        const earlierStarted = yield* Effect.forkChild(racing.run(racing.newRequestKey(), delayedInsert, null).pipe(Effect.provideService(Clock.Clock, clockAt(1_000))));
        yield* Deferred.await(readyToInsert);
        yield* racing.run(racing.newRequestKey(), insertRoot, "F").pipe(Effect.provideService(Clock.Clock, clockAt(9_000)));
        yield* Deferred.succeed(insertResume, undefined); yield* Fiber.join(earlierStarted);
        expect(keys(yield* racing.run(racing.newRequestKey(), readRoot, "asc"))).toEqual(["Z", "A", "E", "F", "G"]);
      }), racing => racing.close);
      return;
    }
    if (proof === "lifecycle") {
      expect(keys(yield* host.run(host.newRequestKey(), root, "append").pipe(Effect.provideService(Clock.Clock, clockAt(1_000))))).toEqual(["Z", "A", "B"]);
      const request = host.newRequestKey();
      const pending = yield* host.run(request, root, "pending").pipe(Effect.provideService(Clock.Clock, clockAt(1_000)));
      expect(keys(pending)).toEqual(["Z", "A", "B", "C"]);
      const settled = yield* inventory, called = invocations;
      const pendingActivity = activities.at(-1), cInsert = pendingActivity?.mutations.find(mutation => mutation.after?.entry_key === "C"),
        transient = pendingActivity?.mutations.find(mutation => mutation.after?.entry_key === "transient");
      const cRevision = settled.revisions.find(row => documentId(row) === cInsert?.after?._id);
      expect(cRevision).toMatchObject({ insertionAttemptOrdinal: 0 }); expect(cRevision?.insertionCommitSeq).toBe(cRevision?.commitSeq);
      expect(settled.revisions.some(row => documentId(row) === transient?.after?._id)).toBe(false);
      expect(yield* host.run(request, root, "pending")).toEqual(pending); expect(invocations).toBe(called); expect(yield* inventory).toEqual(settled);
      expect(keys(yield* host.run(host.newRequestKey(), root, "lifecycle"))).toEqual(["Z", "A", "B", "C"]);
      const stable = (yield* inventory).revisions.filter(row => Buffer.from(row.rowId).equals(Buffer.from(zBirth.rowId)));
      expect(stable.every(row => row.insertionCommitSeq === zBirth.insertionCommitSeq && row.insertionAttemptOrdinal === zBirth.insertionAttemptOrdinal)).toBe(true);
      expect(keys(yield* host.run(host.newRequestKey(), root, "reconstitute"))).toEqual(["A", "B", "C", "Z"]);
      const reborn = (yield* inventory).revisions.filter(row => Buffer.from(row.rowId).equals(Buffer.from(zBirth.rowId))).at(-1);
      expect(reborn).toMatchObject({ rowId: zBirth.rowId, creationTime: zBirth.creationTime });
      expect(reborn?.insertionCommitSeq).toBe(reborn?.commitSeq); expect(reborn?.insertionCommitSeq).not.toBe(zBirth.insertionCommitSeq);
      expect(keys(yield* host.run(host.newRequestKey(), root, "reuse"))).toEqual(["B", "C", "Z", "A"]);
      const oldA = seedActivity?.mutations.find(mutation => mutation.after?.entry_key === "A"),
        newA = activities.at(-1)?.mutations.find(mutation => mutation.operation === "insert" && mutation.after?.entry_key === "A");
      expect(newA?.after?._id).toEqual(expect.any(String)); expect(newA?.after?._id).not.toBe(oldA?.after?._id);
      const newARevision = (yield* inventory).revisions.find(row => documentId(row) === newA?.after?._id);
      expect(newARevision?.insertionCommitSeq).toBe(newARevision?.commitSeq); expect(newARevision?.insertionAttemptOrdinal).toBe(0);
      const beforeCancel = yield* inventory;
      expect((yield* Effect.exit(host.run(host.newRequestKey(), root, "cancel")))._tag).toBe("Failure"); expect(yield* inventory).toEqual(beforeCancel);
      expect(yield* Effect.result(host.run(host.newRequestKey(), root, "forgedGeneration"))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      expect(yield* inventory).toEqual(beforeCancel);
      yield* host.run(host.newRequestKey(), root, "escape");
      if (escaped === undefined) return yield* Effect.die(new Error("Missing escaped ordered-read handle"));
      const closed = yield* inventory;
      expect(yield* Effect.result(escaped())).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } }); expect(yield* inventory).toEqual(closed);
      yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, executionIsolation: "scopeExclusive", commands: roots,
        participants: [{ participant, logicalStorage, commands, allowReconstitution: true, validateLogicalCall }] }), denied => Effect.gen(function* () {
        expect(yield* Effect.result(denied.run(request, root, "pending"))).toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
        expect(yield* Effect.result(denied.run(denied.newRequestKey(), root, "denied"))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
        expect(yield* Effect.result(denied.run(denied.newRequestKey(), root, "caughtDenied"))).toMatchObject({ _tag: "Failure", failure: { reason: "rollbackOnly" } });
        expect(yield* inventory).toEqual(closed);
      }), denied => denied.close);
    } else {
      yield* host.run(host.newRequestKey(), root, "reconstitute");
      const current = yield* inventory, latest = current.revisions.filter(row => Buffer.from(row.rowId).equals(Buffer.from(zBirth.rowId))).at(-1);
      if (latest === undefined) return yield* Effect.die(new Error("Missing reconstitution revision"));
      const snapshot = (commit: typeof zBirth.commitSeq) => runEffectTransaction<AppRowReadResultV1, ReadAppRowError, Error, FlarexMetadataTransaction>(
        callback => fixture.target.drizzle.transaction(callback), "Insertion snapshot metadata",
        tx => readAppRowAtSnapshotInTransactionEffect(tx, {
          scopeId: fixture.authority.scopeId, tableId: zBirth.tableId, rowId: Result.getOrThrow(appRowIdHexV1FromBytesResult(zBirth.rowId)), snapshotCommitSeq: commit,
        }), cause => new Error("Insertion snapshot failed", { cause }));
      const old = yield* snapshot(zBirth.commitSeq), fresh = yield* snapshot(latest.commitSeq);
      expect(old).toMatchObject({ kind: "live", insertionOrder: { commitSeq: zBirth.insertionCommitSeq, attemptOrdinal: zBirth.insertionAttemptOrdinal } });
      expect(fresh).toMatchObject({ kind: "live", insertionOrder: { commitSeq: latest.insertionCommitSeq, attemptOrdinal: latest.insertionAttemptOrdinal } });
      if (old.kind !== "live" || fresh.kind !== "live") return yield* Effect.die(new Error("Missing selected live snapshot revisions"));
      expect(old.document.valueJson).not.toHaveProperty("insertionOrder"); expect(fresh.document.valueJson).not.toHaveProperty("insertionCommitSeq");
      expect(fresh.document.valueJson).toMatchObject({ _id: zId, _creationTime: zBirth.creationTime });
      yield* host.run(host.newRequestKey(), root, "patchA");
      const aMutation = seedActivity?.mutations.find(mutation => mutation.after?.entry_key === "A");
      const aLatest = (yield* inventory).revisions.filter(row => documentId(row) === aMutation?.after?._id).at(-1);
      if (aLatest === undefined) return yield* Effect.die(new Error("Missing later A revision"));
      const aWhere = and(eq(fxAppRowRevisions.tableId, aLatest.tableId), eq(fxAppRowRevisions.rowId, aLatest.rowId), eq(fxAppRowRevisions.commitSeq, aLatest.commitSeq));
      // Preserved generations legitimately repeat across revision history, so a
      // later revision can pass per-row SQL checks yet forge an ambiguous pair
      // with another live identity. The runtime must refuse without an ID tie.
      yield* statement(fixture.target.drizzle.update(fxAppRowRevisions).set({ insertionCommitSeq: latest.insertionCommitSeq,
        insertionAttemptOrdinal: latest.insertionAttemptOrdinal }).where(aWhere));
      const ambiguous = yield* inventory;
      expect(yield* Effect.result(host.run(host.newRequestKey(), readRoot, "asc"))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
      expect(yield* inventory).toEqual(ambiguous);
      yield* statement(fixture.target.drizzle.update(fxAppRowRevisions).set({ insertionCommitSeq: aLatest.insertionCommitSeq,
        insertionAttemptOrdinal: aLatest.insertionAttemptOrdinal }).where(aWhere));
      yield* statement(fixture.target.drizzle.update(fxAppRowRevisions).set({ insertionCommitSeq: null, insertionAttemptOrdinal: null })
        .where(eq(fxAppRowRevisions.tableId, zBirth.tableId)));
      const unknown = yield* inventory;
      expect(yield* snapshot(zBirth.commitSeq)).not.toHaveProperty("insertionOrder");
      expect(keys(yield* host.run(host.newRequestKey(), ordinaryRoot, null))).toEqual(["A", "Z", "outside"]);
      const beforeRefusal = yield* inventory;
      const refused = yield* Effect.result(host.run(host.newRequestKey(), readRoot, "asc"));
      expect(refused).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      expect(yield* inventory).toEqual(beforeRefusal);
      // An old profile may still update rows with unknown birth evidence. Its
      // ordinary scalar write must not fabricate an insertion generation.
      const ordinaryPatch = defineCommerceCommand("neutralUnknownPatch", "write", ctx => Effect.gen(function* () {
        const table = yield* ctx.table("entry");
        const old = yield* table.write(ctx.manager, "upsert", [{ entry_key: "Z", text: "old profile remains usable" }]);
        const fresh = yield* table.write(ctx.manager, "insert", [{ entry_key: "post-upgrade", folio_key: "outside", text: "fresh generation" }]);
        return [...old, ...fresh];
      }));
      const ordinaryPatchRoot = defineAtomicCommerceCommand("neutralUnknownPatchRoot", ctx => ctx.call(participant, ordinaryPatch, null));
      yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: [ordinaryPatchRoot],
        participants: [{ participant, logicalStorage, commands: [ordinaryPatch] }] }), oldHost => oldHost.run(oldHost.newRequestKey(), ordinaryPatchRoot, null), oldHost => oldHost.close);
      const afterPatch = yield* inventory;
      expect(afterPatch.revisions.filter(row => row.tableId === zBirth.tableId && unknown.revisions.some(old => documentId(old) === documentId(row)))
        .every(row => row.insertionCommitSeq === null && row.insertionAttemptOrdinal === null)).toBe(true);
      expect(afterPatch.revisions).toHaveLength(unknown.revisions.length + 2);
      expect(keys(yield* host.run(host.newRequestKey(), readRoot, "fresh"))).toEqual(["post-upgrade"]);
    }
  }), host => host.close);
});
