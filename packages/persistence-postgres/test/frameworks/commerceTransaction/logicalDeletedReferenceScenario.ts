import { Deferred, Effect, Fiber, Result, Schema } from "effect";
import { expect } from "vitest";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1FromBytesResult } from "flarex-protocol/app-document-id";
import { jsonEqual, isJsonObject } from "flarex-protocol/json";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "../../application/applicationNativeMutationTestFixture";
import type { FrameworkSchemaTarget } from "../../../src/installation/frameworkSchema/target";
import type { RelationalSession } from "../../../src/database/relationalTransaction/session";
import type { LogicalCommerceSelectionInput } from "../../../src/frameworks/commerceTransaction/logicalSelection";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError, type CommerceTransactionError } from "../../../src/frameworks/commerceTransaction/model";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import type { LogicalCommerceCallValidation } from "../../../src/frameworks/atomicCommerce/participants";
import type { LogicalCommerceActivity } from "../../../src/frameworks/commerceTransaction/logicalParticipant";
import { defaultCommerceResources } from "../../../src/frameworks/commerceTransaction/resources";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { decodeStoredAppDocumentEvidenceEffect } from "../../../src/storage/documents/appRowCanonicalEvidence";
import { locateAppIndexDefinitionByIdEffect } from "../../../src/storage/indexes/appIndexDefinitions";
import { runDrizzleStatementEffect } from "../../../src/database/drizzleStatementEffect";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions, fxAppUniqueKeys,
  fxSystemCommits, fxSystemCommitAppRowChanges, fxSystemIdempotency, fxSystemCommitWakes, fxSystemScopeClocks } from "../../../src/database/schema";

const oldTime = "2020-01-02T03:04:05.000Z";
const successfulModes = ["active", "history", "pendingInsert", "pendingPatch", "pendingRepoint", "pendingRepointInto", "pendingDelete", "pendingBornDeleted", "bornDeleted",
  "recreate", "recreateDelete", "laterWrite", "laterRepoint", "laterDelete", "empty", "escape"] as const;
const refusedModes = ["absentDelete", "wrongFk", "wrongSource", "wrongTarget", "wrongKey", "rollback", "caughtRefusal", "cancellation", "overflow", "split", "splitEmpty"] as const;
const decodeMode = Schema.decodeUnknownEffect(Schema.Literals([...successfulModes, ...refusedModes]));
const decodeRows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));

/** Genuine installed two-table source; the harness only supplies native commands
 * and observes the production working set, publication, receipts and replay. */
export const logicalDeletedReferenceScenario = Effect.fn("LogicalDeletedReference.scenario")(function* <Persistence extends ApplicationNativeMutationPersistence>(
  fixture: ApplicationNativeMutationFixture<Persistence>, target: FrameworkSchemaTarget,
  schemaVersionId: CatalogSchemaVersionId, source: unknown, session: RelationalSession, race = false,
) {
  const dataset = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] },
    1_048_576, { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
  const logicalStorage: LogicalCommerceSelectionInput = { ports: { controlDb: fixture.control.drizzle, authority: fixture.authorityPorts },
    unique: fixture.uniqueConstraintEligibility, schemaVersionId, source,
    initialization: { stepId: "folio.empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
  const hostInput = { hostRuntime: preparedHostTestRuntime(fixture.target.drizzle), database: fixture.target.drizzle,
    session, target, deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
    authority: fixture.authorityPorts, application: fixture.activation, identityAndAccessPolicy: { profile: "neutral-eager-reference-detachment" } };
  const participant = defineAtomicCommerceParticipant("neutralReferenceDetach");
  const read = defineCommerceCommand("neutralReferenceRead", "read", (ctx, input) => Effect.gen(function* () {
    const mode = yield* decodeMode(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    return [...yield* (yield* ctx.table("entry")).find(ctx.manager, { predicate: { kind: "in", column: "entry_key", values: [mode + ":a", mode + ":b", mode + ":other"] },
      order: { column: "entry_key", direction: "asc" } })];
  }));
  const seed = defineCommerceCommand("neutralReferenceSeed", "write", (ctx, input) => Effect.gen(function* () {
    const mode = yield* decodeMode(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    const owners = yield* ctx.table("folio");
    yield* owners.write(ctx.manager, "insert", [{ folio_key: mode + ":other" }, ...(mode === "bornDeleted" ? [] : [{ folio_key: mode }])]);
    if (mode !== "bornDeleted" && mode !== "empty" && mode !== "splitEmpty") yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", [
      { entry_key: mode + ":a", folio_key: mode, text: "retained", created_at: oldTime, updated_at: oldTime,
        deleted_at: mode === "history" ? oldTime : null },
      { entry_key: mode + ":other", folio_key: mode + ":other", text: "unrelated", created_at: oldTime, updated_at: oldTime, deleted_at: null },
    ]);
    if (mode === "overflow") yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", ["b", "c", "d", "e"].map(key =>
      ({ entry_key: mode + ":" + key, folio_key: mode, text: "bounded cohort" })));
    return null;
  }));
  let invoked = 0;
  let activeRequest: string | undefined;
  let escaped: (() => Effect.Effect<void, CommerceTransactionError>) | undefined;
  const mutate = defineCommerceCommand("neutralReferenceMutate", "write", (ctx, input) => Effect.gen(function* () {
    invoked++;
    const mode = yield* decodeMode(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    const entries = yield* ctx.table("entry"), owners = yield* ctx.table("folio");
    if (mode === "bornDeleted") {
      yield* owners.write(ctx.manager, "insert", [{ folio_key: mode }]);
      yield* entries.write(ctx.manager, "insert", [{ entry_key: mode + ":a", folio_key: mode, text: "born", created_at: oldTime, updated_at: oldTime }]);
    }
    if (mode === "pendingInsert") yield* entries.write(ctx.manager, "insert", [{ entry_key: mode + ":b", folio_key: mode, text: "pending", created_at: oldTime, updated_at: oldTime }]);
    if (mode === "pendingBornDeleted") {
      yield* entries.write(ctx.manager, "insert", [{ entry_key: mode + ":b", folio_key: mode, text: "transient" }]);
      yield* entries.delete(ctx.manager, [{ entry_key: mode + ":b" }]);
    }
    if (mode === "pendingRepointInto") yield* entries.write(ctx.manager, "update", [{ entry_key: mode + ":other", folio_key: mode }]);
    if (mode === "pendingPatch") yield* entries.write(ctx.manager, "update", [{ entry_key: mode + ":a", text: "pending patch" }]);
    if (mode === "pendingRepoint") {
      yield* entries.write(ctx.manager, "update", [{ entry_key: mode + ":a", folio_key: mode + ":other" }]);
      yield* entries.write(ctx.manager, "update", [{ entry_key: mode + ":other", folio_key: mode }]);
      yield* entries.write(ctx.manager, "update", [{ entry_key: mode + ":other", folio_key: mode + ":other" }]);
    }
    if (mode === "pendingDelete") yield* entries.delete(ctx.manager, [{ entry_key: mode + ":a" }]);
    if (mode !== "absentDelete" && mode !== "split" && mode !== "splitEmpty") yield* owners.delete(ctx.manager, [{ folio_key: mode }]);
    const selected = { sourceTable: mode === "wrongSource" ? "unadmitted" : "entry", sourceColumn: mode === "wrongFk" ? "text" : "folio_key",
      targetTable: mode === "wrongTarget" ? "entry" : "folio", targetColumn: "folio_key", targetKey: mode === "wrongKey" ? mode + ":other" : mode };
    const detach = ctx.detachDeletedReference;
    if (detach === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
    if (mode === "caughtRefusal") { yield* Effect.result(detach({ ...selected, sourceColumn: "text" })); return null; }
    yield* detach(selected);
    if (mode === "escape") escaped = () => detach(selected);
    if (mode === "recreateDelete") {
      yield* owners.write(ctx.manager, "insert", [{ folio_key: mode }]);
      yield* entries.write(ctx.manager, "insert", [{ entry_key: mode + ":b", folio_key: mode, text: "new generation", created_at: oldTime, updated_at: oldTime }]);
      yield* owners.delete(ctx.manager, [{ folio_key: mode }]);
      yield* detach(selected);
    }
    const eager = [...yield* entries.find(ctx.manager, { predicate: { kind: "in", column: "entry_key", values: [mode + ":a", mode + ":b", mode + ":other"] }, order: { column: "entry_key", direction: "asc" } })];
    if (mode === "recreate") yield* owners.write(ctx.manager, "insert", [{ folio_key: mode }]);
    if (mode === "laterWrite") yield* entries.write(ctx.manager, "update", [{ entry_key: mode + ":a", text: "later write" }]);
    if (mode === "laterRepoint") yield* entries.write(ctx.manager, "update", [{ entry_key: mode + ":a", folio_key: mode + ":other" }]);
    if (mode === "laterDelete") yield* entries.delete(ctx.manager, [{ entry_key: mode + ":a" }]);
    if (mode === "rollback") return yield* ctx.refuse(commerceError("invalidInput"));
    if (mode === "cancellation") return yield* Effect.interrupt;
    return eager;
  }));
  const remove = defineCommerceCommand("neutralReferenceRemove", "write", (ctx, input) => Effect.gen(function* () {
    const mode = yield* decodeMode(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    yield* (yield* ctx.table("folio")).delete(ctx.manager, [{ folio_key: mode }]);
    return null;
  }));
  const seedRoot = defineAtomicCommerceCommand("neutralReferenceSeedRoot", (ctx, input) => ctx.call(participant, seed, input));
  const root = defineAtomicCommerceCommand("neutralReferenceRoot", (ctx, input) => Effect.gen(function* () {
    if (input === "split" || input === "splitEmpty") yield* ctx.call(participant, remove, input);
    return yield* ctx.call(participant, mutate, input);
  }));
  const readRoot = defineAtomicCommerceCommand("neutralReferenceReadRoot", (ctx, input) => ctx.call(participant, read, input));
  const commands = [seed, mutate, read, remove], roots = [seedRoot, root, readRoot];
  yield* Effect.acquireUseRelease(makeCommerceHost({ ...hostInput, logicalStorage, commands: [read] }), host => host.initialize([]), host => host.close);
  const activities: Array<Readonly<{ mode: unknown; activity: LogicalCommerceActivity }>> = [];
  const validateLogicalCall: LogicalCommerceCallValidation = (call, activity) => Effect.sync(() => {
    expect(call.events).toEqual([]); expect(activity.setNull).toEqual([]); expect(activity.referenceReplacements).toEqual([]);
    activities.push({ mode: call.input, activity });
    for (const mutation of activity.mutations) {
      const cause = mutation.deletedReference;
      if (cause === undefined) continue;
      expect(mutation.operation).toBe("patch"); expect(mutation.table).toBe("entry");
      expect(cause).toMatchObject({ sourceColumn: "folio_key", targetTable: "folio", targetColumn: "folio_key", targetKey: call.input });
      expect(cause.targetDeleteOrdinal).toBeGreaterThanOrEqual(0); expect(cause.targetDeleteOrdinal).toBeLessThan(mutation.ordinal);
      const deleted = activity.mutations[cause.targetDeleteOrdinal];
      expect(deleted).toMatchObject({ table: "folio", operation: "delete", before: { folio_key: call.input }, after: null });
      expect(mutation.before).not.toBeNull(); expect(mutation.after).not.toBeNull();
      expect(jsonEqual({ ...mutation.before, folio_key: null }, mutation.after)).toBe(true);
    }
  });
  const query = <A>(statement: PromiseLike<A>) => runDrizzleStatementEffect(statement, cause => new Error("Neutral detach inventory", { cause }));
  const inventory = Effect.gen(function* () { return {
    rows: yield* query(fixture.target.drizzle.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId)),
    revisions: yield* query(fixture.target.drizzle.select().from(fxAppRowRevisions).orderBy(fxAppRowRevisions.commitSeq, fxAppRowRevisions.rowId)),
    indexes: yield* query(fixture.target.drizzle.select().from(fxAppIndexEntryCurrent).orderBy(fxAppIndexEntryCurrent.indexDefinitionId, fxAppIndexEntryCurrent.rowId)),
    indexRevisions: yield* query(fixture.target.drizzle.select().from(fxAppIndexEntryRevisions).orderBy(fxAppIndexEntryRevisions.commitSeq, fxAppIndexEntryRevisions.indexDefinitionId, fxAppIndexEntryRevisions.rowId)),
    unique: yield* query(fixture.target.drizzle.select().from(fxAppUniqueKeys).orderBy(fxAppUniqueKeys.constraintId, fxAppUniqueKeys.canonicalKeySha256)),
    commits: yield* query(fixture.target.drizzle.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq)),
    facts: yield* query(fixture.target.drizzle.select().from(fxSystemCommitAppRowChanges).orderBy(fxSystemCommitAppRowChanges.commitSeq, fxSystemCommitAppRowChanges.changeOrdinal)),
    outcomes: yield* query(fixture.target.drizzle.select().from(fxSystemIdempotency).orderBy(fxSystemIdempotency.requestKey)),
    wakes: yield* query(fixture.target.drizzle.select().from(fxSystemCommitWakes).orderBy(fxSystemCommitWakes.commitSeq)),
    clocks: yield* query(fixture.target.drizzle.select().from(fxSystemScopeClocks)),
  }; });
  const member: { participant: typeof participant; logicalStorage: LogicalCommerceSelectionInput; commands: typeof commands;
    detachDeletedReferences?: true; validateLogicalCall: LogicalCommerceCallValidation } = {
    participant, logicalStorage, commands, detachDeletedReferences: true, validateLogicalCall,
  };
  yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: roots, participants: [member] }), host => Effect.gen(function* () {
    // Captured capability survives mutation of the caller-owned construction data.
    delete member.detachDeletedReferences;
    for (const mode of [...successfulModes, ...refusedModes]) yield* host.run(host.newRequestKey(), seedRoot, mode);
    for (const mode of successfulModes) {
      const request = host.newRequestKey(), before = yield* inventory;
      if (mode === "active") activeRequest = request;
      const output = decodeRows(yield* host.run(request, root, mode));
      const affected = output.filter(row => row.entry_key !== mode + ":other");
      if (mode !== "pendingRepoint") for (const row of affected) expect(row.folio_key).toBeNull();
      if (mode === "history") expect(affected[0]).toMatchObject({ deleted_at: oldTime, updated_at: oldTime, created_at: oldTime });
      if (mode === "active" || mode === "pendingInsert" || mode === "bornDeleted") for (const row of affected) expect(row.updated_at).toBe(oldTime);
      if (mode === "pendingPatch") expect(affected[0]?.text).toBe("pending patch");
      const final = decodeRows(yield* host.run(host.newRequestKey(), readRoot, mode));
      if (mode === "laterWrite") expect(final.find(row => row.entry_key === mode + ":a")).toMatchObject({ text: "later write", folio_key: null });
      if (mode === "laterRepoint") expect(final.find(row => row.entry_key === mode + ":a")?.folio_key).toBe(mode + ":other");
      if (mode === "laterDelete" || mode === "pendingDelete") expect(final.some(row => row.entry_key === mode + ":a")).toBe(false);
      if (mode !== "pendingRepoint" && mode !== "pendingRepointInto" && mode !== "empty" && mode !== "bornDeleted") expect(final.find(row => row.entry_key === mode + ":other")?.folio_key).toBe(mode + ":other");
      const after = yield* inventory, calls = invoked, validations = activities.length;
      expect(after.commits.length).toBeGreaterThan(before.commits.length);
      expect(yield* host.run(request, root, mode)).toEqual(output); expect(invoked).toBe(calls); expect(activities).toHaveLength(validations); expect(yield* inventory).toEqual(after);
      const activity = activities.findLast(entry => entry.mode === mode && entry.activity.mutations.some(mutation => mutation.operation === "delete"))?.activity;
      if (activity === undefined) return yield* Effect.die(new Error("Missing authentic eager activity"));
      if (mode === "active" || mode === "history") {
        const detached = activity.mutations.find(mutation => mutation.deletedReference !== undefined);
        const removed = activity.mutations.find(mutation => mutation.operation === "delete");
        const sourceId = detached?.before?._id, targetId = removed?.before?._id;
        if (typeof sourceId !== "string" || typeof targetId !== "string") return yield* Effect.die(new Error("Missing authenticated durable row identities"));
        const documentId = (row: Pick<typeof fxAppRowRevisions.$inferSelect, "tableId" | "rowId">) => appDocumentIdV1FromRowIdentity({
          tableId: row.tableId, rowId: Result.getOrThrow(appRowIdHexV1FromBytesResult(row.rowId)),
        });
        // Genuine snapshot differences establish exactly one source revision
        // and one target tombstone, with no unrelated row facts or rewrites.
        expect(after.revisions.slice(0, before.revisions.length)).toEqual(before.revisions);
        expect(after.facts.slice(0, before.facts.length)).toEqual(before.facts);
        const revisions = after.revisions.slice(before.revisions.length), facts = after.facts.slice(before.facts.length);
        const expected = [sourceId, targetId].toSorted();
        expect(revisions.map(documentId).toSorted()).toEqual(expected); expect(facts.map(documentId).toSorted()).toEqual(expected);
        const previous = before.revisions.findLast(row => documentId(row) === sourceId);
        const source = revisions.find(row => documentId(row) === sourceId), target = revisions.find(row => documentId(row) === targetId);
        if (previous === undefined || source === undefined || target === undefined || previous.valueBytes === null || previous.valueSha256 === null ||
          source.valueBytes === null || source.valueSha256 === null) return yield* Effect.die(new Error("Missing committed source revision evidence"));
        expect(source.isTombstone).toBe(false); expect(target.isTombstone).toBe(true);
        expect(target.commitSeq).toBe(source.commitSeq); expect(facts.map(fact => fact.commitSeq)).toEqual([source.commitSeq, source.commitSeq]);
        expect(source.prevCommitSeq).toBe(previous.commitSeq); expect(source.creationTime).toBe(previous.creationTime);
        expect(source.insertionCommitSeq).toBe(previous.insertionCommitSeq); expect(source.insertionAttemptOrdinal).toBe(previous.insertionAttemptOrdinal);
        const oldBody = yield* decodeStoredAppDocumentEvidenceEffect({ tableId: previous.tableId,
          rowId: Result.getOrThrow(appRowIdHexV1FromBytesResult(previous.rowId)), creationTime: previous.creationTime,
          codecVersion: previous.valueCodecVersion, canonicalBytes: previous.valueBytes, sha256: previous.valueSha256 });
        const newBody = yield* decodeStoredAppDocumentEvidenceEffect({ tableId: source.tableId,
          rowId: Result.getOrThrow(appRowIdHexV1FromBytesResult(source.rowId)), creationTime: source.creationTime,
          codecVersion: source.valueCodecVersion, canonicalBytes: source.valueBytes, sha256: source.valueSha256 });
        if (!isJsonObject(oldBody.valueJson) || !isJsonObject(newBody.valueJson)) return yield* Effect.die(new Error("Missing stored native source body"));
        expect(jsonEqual({ ...oldBody.valueJson, folio_key: null }, newBody.valueJson)).toBe(true);
        expect(newBody.valueJson).toMatchObject({ created_at: oldTime, updated_at: oldTime, deleted_at: mode === "history" ? oldTime : null });
        const sourceEntries = before.indexes.filter(entry => Buffer.from(entry.rowId).equals(Buffer.from(previous.rowId)));
        const definitions = yield* Effect.forEach([...new Set(sourceEntries.map(entry => entry.indexDefinitionId))], definitionId =>
          locateAppIndexDefinitionByIdEffect(fixture.control.drizzle, fixture.authority.scopeId, definitionId));
        const referenceDefinitions = new Set(definitions.flatMap(definition => definition !== null && definition.access.kind === "developer" &&
          definition.access.tableId === previous.tableId && definition.physicalSpec.predicate === undefined &&
          definition.physicalSpec.orderedFields.some(field => field.kind === "documentPath" && field.path === "folio_key")
          ? [definition.indexDefinitionId] : []));
        const oldReferences = sourceEntries.filter(entry => referenceDefinitions.has(entry.indexDefinitionId));
        expect(oldReferences.length).toBeGreaterThan(0);
        for (const reference of oldReferences) {
          expect(after.indexes.some(entry => entry.indexDefinitionId === reference.indexDefinitionId &&
            Buffer.from(entry.rowId).equals(Buffer.from(reference.rowId)) && Buffer.from(entry.encodedKey).equals(Buffer.from(reference.encodedKey)))).toBe(false);
          const tombstones = after.indexRevisions.filter(entry => entry.commitSeq === source.commitSeq && entry.indexDefinitionId === reference.indexDefinitionId &&
            Buffer.from(entry.rowId).equals(Buffer.from(reference.rowId)) && Buffer.from(entry.encodedKey).equals(Buffer.from(reference.encodedKey)));
          expect(tombstones).toHaveLength(1); expect(tombstones[0]?.isTombstone).toBe(true);
        }
      }
      const selection = activity.relationalReads.filter(read => jsonEqual(read.query, { predicate: { kind: "in", column: "folio_key", values: [mode] }, order: { column: "entry_key", direction: "asc" } }));
      expect(selection).toHaveLength(mode === "recreateDelete" ? 2 : 1);
      for (const read of selection) expect(read.returned).toBe(read.total);
      if (mode === "empty" || mode === "pendingDelete" || mode === "pendingRepoint") expect(selection[0]?.total).toBe(0);
      if (mode === "pendingInsert" || mode === "pendingRepointInto") expect(selection[0]?.total).toBe(2);
      expect(activity.mutations.filter(mutation => mutation.deletedReference !== undefined)).toHaveLength(selection.reduce((total, read) => total + read.total, 0));
    }
    if (escaped === undefined) return yield* Effect.die(new Error("Missing escaped detach operation"));
    const escapedBefore = yield* inventory;
    expect(yield* Effect.result(escaped())).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } }); expect(yield* inventory).toEqual(escapedBefore);
    for (const mode of refusedModes.filter(mode => mode !== "overflow")) {
      const before = yield* inventory;
      if (mode === "cancellation") expect((yield* Effect.exit(host.run(host.newRequestKey(), root, mode)))._tag).toBe("Failure");
      else expect(yield* Effect.result(host.run(host.newRequestKey(), root, mode))).toMatchObject({ _tag: "Failure", failure: {
        reason: mode === "rollback" ? "invalidInput" : mode === "caughtRefusal" ? "rollbackOnly" : "invalidAuthority",
      } }); expect(yield* inventory).toEqual(before);
    }
    const denied = { participant, logicalStorage, commands, validateLogicalCall };
    yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: roots, participants: [denied] }), ordinary => Effect.gen(function* () {
      const before = yield* inventory, callbacks = invoked;
      if (activeRequest === undefined) return yield* Effect.die(new Error("Missing selected replay request"));
      expect(yield* Effect.result(ordinary.run(activeRequest, root, "active"))).toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
      expect(invoked).toBe(callbacks);
      expect(yield* Effect.result(ordinary.run(ordinary.newRequestKey(), root, "overflow"))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
      expect(yield* inventory).toEqual(before);
    }), ordinary => ordinary.close);
    const limited = { ...denied, detachDeletedReferences: true as const, logicalResources: { ...defaultCommerceResources, catalogRows: 4, queryRows: 4, writeBatchRows: 4 } };
    // Five existing cohort rows exceed this coherent four-row selection, so no partial
    // FK patch or earlier target deletion can survive the real indexed overflow.
    yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: roots, participants: [limited] }), restricted => Effect.gen(function* () {
      const before = yield* inventory;
      expect(yield* Effect.result(restricted.run(restricted.newRequestKey(), root, "overflow"))).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
      expect(yield* inventory).toEqual(before);
    }), restricted => restricted.close);
    if (race) {
      const reached = yield* Deferred.make<void>(), resume = yield* Deferred.make<void>();
      const competingInsert = defineCommerceCommand("neutralReferenceCompetingInsert", "write", ctx => Effect.gen(function* () {
        return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", [{ entry_key: "race:new", folio_key: "race", text: "opposing writer" }])];
      }));
      const prepareRace = defineCommerceCommand("neutralReferenceRaceSeed", "write", ctx => Effect.gen(function* () {
        yield* (yield* ctx.table("folio")).write(ctx.manager, "insert", [{ folio_key: "race" }]);
        return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", [{ entry_key: "race:original", folio_key: "race", text: "initial source" }])];
      }));
      const detachRace = defineCommerceCommand("neutralReferenceRaceDetach", "write", ctx => Effect.gen(function* () {
        yield* (yield* ctx.table("folio")).delete(ctx.manager, [{ folio_key: "race" }]);
        if (ctx.detachDeletedReference === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
        yield* ctx.detachDeletedReference({ sourceTable: "entry", sourceColumn: "folio_key", targetTable: "folio", targetColumn: "folio_key", targetKey: "race" });
        return null;
      }));
      const raceRead = defineCommerceCommand("neutralReferenceRaceRead", "read", ctx => Effect.gen(function* () {
        const entries = [...yield* (yield* ctx.table("entry")).find(ctx.manager, { predicate: { kind: "in", column: "folio_key", values: ["race"] }, order: { column: "entry_key", direction: "asc" } })];
        const owners = [...yield* (yield* ctx.table("folio")).find(ctx.manager, { predicate: { kind: "in", column: "folio_key", values: ["race"] }, order: { column: "folio_key", direction: "asc" } })];
        return { entries, owners };
      }));
      const raceSeedRoot = defineAtomicCommerceCommand("neutralReferenceRaceSeedRoot", ctx => ctx.call(participant, prepareRace, null));
      const pendingDelete = defineAtomicCommerceCommand("neutralReferencePendingDelete", ctx => Effect.gen(function* () {
        yield* ctx.call(participant, detachRace, null);
        yield* Deferred.succeed(reached, undefined); yield* Deferred.await(resume); return null;
      }));
      const insertRoot = defineAtomicCommerceCommand("neutralReferenceCompetingRoot", ctx => ctx.call(participant, competingInsert, null));
      const raceReadRoot = defineAtomicCommerceCommand("neutralReferenceRaceReadRoot", ctx => ctx.call(participant, raceRead, null));
      yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: [raceSeedRoot, pendingDelete, insertRoot, raceReadRoot],
        participants: [{ participant, logicalStorage, commands: [prepareRace, detachRace, competingInsert, raceRead], detachDeletedReferences: true,
          validateLogicalCall: () => Effect.void }],
      }), racing => Effect.gen(function* () {
        yield* racing.run(racing.newRequestKey(), raceSeedRoot, null);
        const pending = yield* Effect.forkChild(Effect.result(racing.run(racing.newRequestKey(), pendingDelete, null)));
        yield* Deferred.await(reached);
        const inserted = yield* Effect.result(racing.run(racing.newRequestKey(), insertRoot, null));
        yield* Deferred.succeed(resume, undefined);
        const deleted = yield* Fiber.join(pending);
        expect(Result.isSuccess(inserted) && Result.isSuccess(deleted)).toBe(false);
        // Real ordering pins the expected successful competing writer. A later
        // delete can conflict/refuse, but may never leave its new FK dangling.
        expect(Result.isSuccess(inserted)).toBe(true); expect(Result.isFailure(deleted)).toBe(true);
        const state = yield* Schema.decodeUnknownEffect(Schema.Struct({ entries: Schema.Array(Schema.JsonObject), owners: Schema.Array(Schema.JsonObject) }))(
          yield* racing.run(racing.newRequestKey(), raceReadRoot, null)).pipe(Effect.mapError(cause => commerceError("storedCorruption", cause)));
        expect(state.entries.map(row => row.entry_key)).toEqual(["race:new", "race:original"]); expect(state.owners).toEqual([{ folio_key: "race" }]);
      }), racing => racing.close);
    }
    expect(yield* Effect.result(makeAtomicCommerceHost({ ...hostInput, commands: roots,
      participants: [{ participant, logicalStorage, commands, detachDeletedReferences: true }],
    }))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  }), host => host.close);
});
