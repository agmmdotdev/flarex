import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { appRowIdHexV1FromBytes, decodeAppDocumentIdentityV1 } from "flarex-protocol/app-document-id";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import type { LogicalCommerceCallValidation } from "../../persistence-postgres/src/frameworks/atomicCommerce/participants";
import type { LogicalCommerceMutation } from "../../persistence-postgres/src/frameworks/commerceTransaction/logicalParticipant";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { replaceGraphRows } from "../src/write/replace";
import type { ReplacementProfile } from "../src/write/graph-model";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { volumes, editions, volume, decodeKey, profile, sourceKey, evidence, schema } from "./support/logical-volume-graph";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const preservingProfile: ReplacementProfile = { ...profile, operation: "upsertWithReplace", existingRootWrite: "upsert" };
const preservingSeed = defineCommerceCommand("neutralExistingRootUpsertSeed", "write", Effect.fn(function* (ctx, input) {
  const prefix = yield* Effect.fromResult(decodeKey(input)), oldTime = "2020-01-02T03:04:05.000Z";
  yield* (yield* ctx.table("volumes")).write(ctx.manager, "insert", [
    { isbn: prefix + "-own", title: "Own", created_at: oldTime, updated_at: oldTime, deleted_at: null },
    { isbn: prefix + "-past", title: "Historical", created_at: oldTime, updated_at: oldTime, deleted_at: oldTime },
  ]);
  yield* (yield* ctx.table("editions")).write(ctx.manager, "insert", [
    { serial: prefix + "-kept", volume_isbn: prefix + "-own", label: "Kept", created_at: oldTime, updated_at: oldTime, deleted_at: null },
  ]);
  return null;
}));
const preservingWrite = defineCommerceCommand("neutralExistingRootUpsert", "write", Effect.fn(function* (ctx, input) {
  const graph = yield* replaceGraphRows(ctx, preservingProfile, volume, input, { relations: ["editions"] });
  return { entities: graph.entities, performedActions: { created: { ...graph.performedActions.created },
    updated: { ...graph.performedActions.updated }, deleted: { ...graph.performedActions.deleted } } };
}));
const preservingLate = defineCommerceCommand("neutralExistingRootUpsertLateFailure", "write", Effect.fn(function* (ctx, input) {
  yield* replaceGraphRows(ctx, preservingProfile, volume, input, { relations: ["editions"] });
  return yield* ctx.refuse(commerceError("invalidInput"));
}));
const { replacementMembers: _activeReplacement, ...allHistoryProfile } = preservingProfile;
const orderedDeletionProfile: ReplacementProfile = { ...allHistoryProfile, orderedDeletionTables: [editions.name],
  ordering: new Map([[editions.name, { kind: "storageInsertion", direction: "asc" }]]) };
const orderedSerials = ["z", "a", "q", "b", "x", "c", "w", "d"];
const orderedSeed = defineCommerceCommand("neutralOrderedChildDeletionSeed", "write", Effect.fn(function* (ctx, input) {
  const prefix = yield* Effect.fromResult(decodeKey(input)), owners = ["a", "b", "c", "d"], oldTime = "2020-01-02T03:04:05.000Z";
  yield* (yield* ctx.table("volumes")).write(ctx.manager, "insert", [...owners, "outside"].map(isbn => ({
    isbn: prefix + "-" + isbn, title: isbn, created_at: oldTime, updated_at: oldTime, deleted_at: null,
  })));
  const children: JsonObject[] = orderedSerials.map((serial, index) => ({ serial: prefix + "-" + serial,
    volume_isbn: prefix + "-" + owners[index % 4], label: serial,
    // Public timestamps and lexical keys deliberately disagree with physical
    // insertion order. Historical members remain part of the replacement.
    created_at: index % 2 === 0 ? "2021-01-02T03:04:05.000Z" : "2019-01-02T03:04:05.000Z",
    updated_at: oldTime, deleted_at: index === 1 || index === 6 ? oldTime : null,
  }));
  children.splice(2, 0, { serial: prefix + "-outside", volume_isbn: prefix + "-outside", label: "Unrelated history",
    created_at: oldTime, updated_at: oldTime, deleted_at: oldTime });
  yield* (yield* ctx.table("editions")).write(ctx.manager, "insert", children);
  return null;
}));
const orderedWrite = defineCommerceCommand("neutralOrderedChildDeletion", "write", Effect.fn(function* (ctx, input) {
  const graph = yield* replaceGraphRows(ctx, orderedDeletionProfile, volume, input, { relations: ["editions"] });
  return { entities: graph.entities, performedActions: { created: { ...graph.performedActions.created },
    updated: { ...graph.performedActions.updated }, deleted: { ...graph.performedActions.deleted } } };
}));
const orderedLate = defineCommerceCommand("neutralOrderedChildDeletionLateFailure", "write", Effect.fn(function* (ctx, input) {
  yield* replaceGraphRows(ctx, orderedDeletionProfile, volume, input, { relations: ["editions"] });
  return yield* ctx.refuse(commerceError("invalidInput"));
}));
const preservingParticipant = defineAtomicCommerceParticipant("neutralExistingRootUpsert");
const preservingRoot = defineAtomicCommerceCommand("neutralExistingRootUpsertRoot", (ctx, input) => ctx.call(preservingParticipant, preservingWrite, input));
const preservingLateRoot = defineAtomicCommerceCommand("neutralExistingRootUpsertLateRoot", (ctx, input) => ctx.call(preservingParticipant, preservingLate, input));
const orderedRoot = defineAtomicCommerceCommand("neutralOrderedChildDeletionRoot", (ctx, input) => ctx.call(preservingParticipant, orderedWrite, input));
const orderedLateRoot = defineAtomicCommerceCommand("neutralOrderedChildDeletionLateRoot", (ctx, input) => ctx.call(preservingParticipant, orderedLate, input));
const preservingReceipts: LogicalCommerceMutation[] = [];
const orderedDeletionReads: Parameters<LogicalCommerceCallValidation>[1]["relationalReads"][number][] = [];
const validatePreserving: LogicalCommerceCallValidation = Effect.fn("NeutralExistingRootUpsert.validate")((
  call: Parameters<LogicalCommerceCallValidation>[0], activity: Parameters<LogicalCommerceCallValidation>[1],
) => Effect.sync(() => {
  expect(call.events).toEqual([]); expect(activity.lifecycle).toEqual([]); expect(activity.setNull).toEqual([]);
  expect(activity.referenceReplacements).toEqual([]);
  const roots = activity.mutations.filter(mutation => mutation.table === "volumes");
  expect(roots.length).toBeGreaterThan(0);
  for (const mutation of roots) {
    expect(mutation.operation).toBe("patch"); expect(mutation.before).not.toBeNull(); expect(mutation.after).not.toBeNull();
    expect(mutation.before?.deleted_at).toBeNull(); expect(mutation.after?.deleted_at).toBeNull();
    expect(mutation.after?.updated_at).toBe(mutation.before?.updated_at);
    expect(mutation.after?.created_at).toBe(mutation.before?.created_at);
    expect(mutation.after?._id).toBe(mutation.before?._id); expect(mutation.after?._creationTime).toBe(mutation.before?._creationTime);
  }
  if (call.commandName === "neutralOrderedChildDeletion") {
    const cohort = activity.relationalReads.filter(read => read.table === "editions" && isJsonObject(read.query) &&
      read.query.predicate !== undefined && isJsonObject(read.query.predicate) && read.query.predicate.column === "serial");
    expect(cohort).toHaveLength(1);
    const deletions = activity.mutations.filter(mutation => mutation.table === "editions" && mutation.operation === "delete");
    expect(cohort[0]?.orderedIdentities).toEqual(deletions.map(mutation => ({ serial: mutation.before?.serial })));
    expect(cohort[0]?.total).toBe(deletions.length); expect(cohort[0]?.returned).toBe(deletions.length);
    orderedDeletionReads.push(...cohort);
  }
  preservingReceipts.push(...activity.mutations);
}));
const read = defineCommerceCommand("neutralExistingRootUpsertRead", "read", Effect.fn(function* (ctx) {
  const output: JsonObject[] = [];
  for (const [name, key] of [[volumes.name, "isbn"], [editions.name, "serial"]]) {
    if (name === undefined || key === undefined) return yield* ctx.refuse(commerceError("invalidInput"));
    output.push(...yield* (yield* ctx.table(name)).find(ctx.manager, { take: 64, order: { column: key, direction: "asc" } }));
  }
  return output;
}));
const commands = [preservingSeed, preservingWrite, preservingLate, orderedSeed, orderedWrite, orderedLate, read];
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>, host: Effect.Success<ReturnType<typeof makeCommerceHost>>;
let preservingHost: Effect.Success<ReturnType<typeof makeAtomicCommerceHost>>;
const run = (command: typeof preservingWrite, input: Json) => Effect.runPromise(host.run(host.newRequestKey(), command, input));
const decodeReadRows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const rows = async () => decodeReadRows(await Effect.runPromise(host.read(read, null)));

describe(`neutral existing-root upsert and ordered child deletion - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => {
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: sourceKey, owner: "medusa", writeProfile: sourceKey,
      evidence, definition: { kind: "relational", schema }, bindings: [volumes.name, editions.name].map(localName => ({ kind: "definition" as const,
        localName, table: { namespace: "medusa" as const, logicalName: "neutral-owned-reference-repetition/" + localName } })) }));
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [source] });
    const empty = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
      { invalidInput: () => new Error("Invalid neutral graph dataset"), hashFailure: cause => new Error("Neutral graph dataset hash", { cause }) }));
    const logicalStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey, writeProfile: sourceKey, schema, evidence },
      initialization: { stepId: "neutral-owned-reference-empty", datasetSha256: empty.sha256Hex, expectedRowCount: 0 } };
    host = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage, commands }));
    cleanup.push(() => Effect.runPromise(host.close)); await Effect.runPromise(host.initialize([]));
    preservingHost = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
      participants: [{ participant: preservingParticipant, logicalStorage, commands: [preservingWrite, preservingLate, orderedWrite, orderedLate],
        allowStorageInsertionOrder: true, validateLogicalCall: validatePreserving }],
      commands: [preservingRoot, preservingLateRoot, orderedRoot, orderedLateRoot] }));
    cleanup.push(() => Effect.runPromise(preservingHost.close));
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("preserves existing root timestamps through real core upsert while retaining child clocks and patch receipts", async () => {
    const prefix = "root-upsert153"; await run(preservingSeed, prefix);
    const beforeRows = await rows(), before = await logicalCurrencyInventory(fixture), receiptStart = preservingReceipts.length;
    const request = [{ isbn: prefix + "-own", title: "Changed", editions: [
      { serial: prefix + "-kept", label: "Changed" }, { serial: prefix + "-new", label: "New" },
    ] }], key = preservingHost.newRequestKey();
    const result = await Effect.runPromise(preservingHost.run(key, preservingRoot, request));
    expect(result).toMatchObject({ entities: [{ isbn: prefix + "-own", title: "Changed", updated_at: "2020-01-02T03:04:05.000Z" }],
      performedActions: { created: { Edition: [{ serial: prefix + "-new" }] },
        updated: { Volume: [{ isbn: prefix + "-own" }], Edition: [{ serial: prefix + "-kept" }] }, deleted: {} } });
    const afterRows = await rows(), root = beforeRows.find(row => row.isbn === prefix + "-own"),
      previousChild = beforeRows.find(row => row.serial === prefix + "-kept"), child = afterRows.find(row => row.serial === prefix + "-kept"),
      inserted = afterRows.find(row => row.serial === prefix + "-new");
    expect(afterRows.find(row => row.isbn === prefix + "-own")).toEqual({ ...root, title: "Changed" });
    expect(child?.created_at).toBe(previousChild?.created_at); expect(child?.updated_at).not.toBe(previousChild?.updated_at);
    expect(inserted?.updated_at).toBe(child?.updated_at); expect(inserted?.created_at).toBe(child?.updated_at);
    expect(afterRows.find(row => row.isbn === prefix + "-past")).toEqual(beforeRows.find(row => row.isbn === prefix + "-past"));
    expect(preservingReceipts.slice(receiptStart).map(mutation => [mutation.table, mutation.operation]))
      .toEqual([["editions", "insert"], ["volumes", "patch"], ["editions", "patch"]]);
    const settled = await logicalCurrencyInventory(fixture);
    expect(settled.revisions).toHaveLength(before.revisions.length + 3); expect(settled.rowChanges).toHaveLength(before.rowChanges.length + 3);
    const receiptCount = preservingReceipts.length;
    expect(await Effect.runPromise(preservingHost.run(key, preservingRoot, request))).toEqual(result);
    expect(preservingReceipts).toHaveLength(receiptCount); expect(await logicalCurrencyInventory(fixture)).toEqual(settled);
  }, 180_000);

  it.each(["id-only", "equal"] as const)("retains a real root patch and updated action for an %s upsert", async mode => {
    const prefix = "root-upsert-noop153-" + mode; await run(preservingSeed, prefix);
    const beforeRows = await rows(), before = await logicalCurrencyInventory(fixture), receiptStart = preservingReceipts.length;
    const result = await Effect.runPromise(preservingHost.run(preservingHost.newRequestKey(), preservingRoot,
      [{ isbn: prefix + "-own", ...(mode === "equal" ? { title: "Own" } : {}) }]));
    expect(result).toMatchObject({ performedActions: { created: {}, updated: { Volume: [{ isbn: prefix + "-own" }] }, deleted: {} } });
    expect(await rows()).toEqual(beforeRows);
    const receipt = preservingReceipts.slice(receiptStart);
    expect(receipt).toHaveLength(1); expect(receipt[0]?.operation).toBe("patch"); expect(receipt[0]?.after).toEqual(receipt[0]?.before);
    const after = await logicalCurrencyInventory(fixture);
    expect(after.revisions).toHaveLength(before.revisions.length + 1); expect(after.rowChanges).toHaveLength(before.rowChanges.length + 1);
  }, 180_000);

  it.each(["missing", "historical", "late-missing", "created_at", "updated_at", "deleted_at"] as const)(
    "refuses %s root upsert misuse without durable writes or receipts", async mode => {
      const prefix = "root-upsert-refused153-" + mode; await run(preservingSeed, prefix);
      const request = mode === "missing" ? [{ isbn: prefix + "-missing", title: "New" }]
        : mode === "historical" ? [{ isbn: prefix + "-past", title: "Changed" }]
        : mode === "late-missing" ? [{ isbn: prefix + "-own", title: "Changed" }, { isbn: prefix + "-missing", title: "New" }]
        : [{ isbn: prefix + "-own", [mode]: "2099-01-01T00:00:00.000Z" }];
      const before = await logicalCurrencyInventory(fixture), receiptCount = preservingReceipts.length;
      expect(await Effect.runPromise(Effect.result(preservingHost.run(preservingHost.newRequestKey(), preservingRoot, request))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      expect(preservingReceipts).toHaveLength(receiptCount); expect(await logicalCurrencyInventory(fixture)).toEqual(before);
    }, 180_000);

  it("rolls back actual root upsert and child replacement when its outer owner refuses", async () => {
    const prefix = "root-upsert-late153"; await run(preservingSeed, prefix);
    const before = await logicalCurrencyInventory(fixture), receiptCount = preservingReceipts.length;
    expect(await Effect.runPromise(Effect.result(preservingHost.run(preservingHost.newRequestKey(), preservingLateRoot,
      [{ isbn: prefix + "-own", title: "Pending", editions: [{ serial: prefix + "-new", label: "Pending" }] }]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(preservingReceipts).toHaveLength(receiptCount); expect(await logicalCurrencyInventory(fixture)).toEqual(before);
  }, 180_000);

  it("deletes interleaved active and historical children in authenticated storage order while retaining reverse root order", async () => {
    const prefix = "ordered-delete153"; await run(orderedSeed, prefix);
    const beforeRows = await rows(), before = await logicalCurrencyInventory(fixture), receiptStart = preservingReceipts.length,
      readStart = orderedDeletionReads.length, reversed = ["d", "c", "b", "a"];
    const request = reversed.map(isbn => ({ isbn: prefix + "-" + isbn, title: "Changed " + isbn, editions: [] })), key = preservingHost.newRequestKey();
    const result = await Effect.runPromise(preservingHost.run(key, orderedRoot, request));
    const actual = Schema.decodeUnknownSync(Schema.Struct({ entities: Schema.Array(Schema.JsonObject) }))(result);
    expect(actual.entities.map(row => row.isbn)).toEqual(request.map(row => row.isbn));
    const deleted = orderedSerials.map(serial => ({ serial: prefix + "-" + serial }));
    expect(result).toMatchObject({ performedActions: { created: {}, deleted: { Edition: deleted },
      updated: { Volume: request.map(row => ({ isbn: row.isbn })) } } });
    const receipts = preservingReceipts.slice(receiptStart), childDeletes = receipts.filter(mutation => mutation.table === "editions");
    expect(childDeletes.map(mutation => [mutation.operation, mutation.before?.serial]))
      .toEqual(orderedSerials.map(serial => ["delete", prefix + "-" + serial]));
    expect(childDeletes.filter(mutation => mutation.before?.deleted_at !== null)).toHaveLength(2);
    expect(receipts.filter(mutation => mutation.table === "volumes").map(mutation => mutation.after?.isbn)).toEqual(request.map(row => row.isbn));
    expect(orderedDeletionReads.slice(readStart)).toHaveLength(1);
    expect(orderedDeletionReads[readStart]?.orderedIdentities).toEqual(deleted);
    const afterRows = await rows();
    expect(afterRows.filter(row => orderedSerials.some(serial => row.serial === prefix + "-" + serial))).toEqual([]);
    expect(afterRows.find(row => row.serial === prefix + "-outside")).toEqual(beforeRows.find(row => row.serial === prefix + "-outside"));
    for (const row of request) expect(afterRows.find(current => current.isbn === row.isbn))
      .toEqual({ ...beforeRows.find(current => current.isbn === row.isbn), title: row.title });
    const settled = await logicalCurrencyInventory(fixture);
    // Current storage retains exact pointers to deletion tombstones. Native
    // rows disappear from reads while their identities and prior bodies remain
    // in the authoritative revision chain.
    const pointerIdentity = (row: typeof settled.rows[number]) => ({ scopeUuid: row.scopeUuid, tableId: row.tableId, rowId: row.rowId });
    expect(settled.rows.map(pointerIdentity)).toEqual(before.rows.map(pointerIdentity));
    const newRevisions = settled.revisions.filter(row => !before.revisions.some(previous => previous.scopeUuid === row.scopeUuid &&
      previous.tableId === row.tableId && previous.commitSeq === row.commitSeq && appRowIdHexV1FromBytes(previous.rowId) === appRowIdHexV1FromBytes(row.rowId)));
    expect(newRevisions.filter(row => row.isTombstone)).toHaveLength(8);
    expect(newRevisions.filter(row => !row.isTombstone)).toHaveLength(4);
    for (const mutation of childDeletes) {
      const identity = decodeAppDocumentIdentityV1(mutation.before?._id);
      const previousPointer = before.rows.find(row => row.tableId === identity.tableId && appRowIdHexV1FromBytes(row.rowId) === identity.rowId);
      if (previousPointer === undefined) throw new Error("Missing deleted child's original current pointer");
      const previousRevision = before.revisions.find(row => row.scopeUuid === previousPointer.scopeUuid && row.tableId === identity.tableId &&
        row.commitSeq === previousPointer.commitSeq && appRowIdHexV1FromBytes(row.rowId) === identity.rowId);
      const tombstone = newRevisions.find(row => row.scopeUuid === previousPointer.scopeUuid && row.tableId === identity.tableId &&
        appRowIdHexV1FromBytes(row.rowId) === identity.rowId);
      if (previousRevision === undefined || tombstone === undefined) throw new Error("Missing deleted child's revision chain");
      expect(previousRevision.isTombstone).toBe(false); expect(previousRevision.valueBytes).not.toBeNull();
      expect(tombstone).toMatchObject({ isTombstone: true, valueBytes: null, valueSha256: null, prevCommitSeq: previousPointer.commitSeq,
        creationTime: previousRevision.creationTime, insertionCommitSeq: previousRevision.insertionCommitSeq,
        insertionAttemptOrdinal: previousRevision.insertionAttemptOrdinal });
      expect(settled.rows.find(row => row.scopeUuid === previousPointer.scopeUuid && row.tableId === identity.tableId &&
        appRowIdHexV1FromBytes(row.rowId) === identity.rowId)).toEqual({ ...previousPointer, commitSeq: tombstone.commitSeq });
      expect(settled.revisions).toContainEqual(previousRevision);
      expect(settled.rowChanges.filter(row => row.scopeUuid === tombstone.scopeUuid && row.tableId === identity.tableId &&
        row.commitSeq === tombstone.commitSeq && appRowIdHexV1FromBytes(row.rowId) === identity.rowId)).toHaveLength(1);
    }
    expect(settled.revisions).toHaveLength(before.revisions.length + 12); expect(settled.rowChanges).toHaveLength(before.rowChanges.length + 12);
    const receiptCount = preservingReceipts.length, readCount = orderedDeletionReads.length;
    expect(await Effect.runPromise(preservingHost.run(key, orderedRoot, request))).toEqual(result);
    expect(preservingReceipts).toHaveLength(receiptCount); expect(orderedDeletionReads).toHaveLength(readCount);
    expect(await logicalCurrencyInventory(fixture)).toEqual(settled);
  }, 180_000);

  it("rolls back ordered history deletion and reverse root updates on late refusal", async () => {
    const prefix = "ordered-delete-late153"; await run(orderedSeed, prefix);
    const request = ["d", "c", "b", "a"].map(isbn => ({ isbn: prefix + "-" + isbn, title: "Pending", editions: [] }));
    const before = await logicalCurrencyInventory(fixture), receiptCount = preservingReceipts.length, readCount = orderedDeletionReads.length;
    expect(await Effect.runPromise(Effect.result(preservingHost.run(preservingHost.newRequestKey(), orderedLateRoot, request))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(preservingReceipts).toHaveLength(receiptCount); expect(orderedDeletionReads).toHaveLength(readCount);
    expect(await logicalCurrencyInventory(fixture)).toEqual(before);
  }, 180_000);
});
