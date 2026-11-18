import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Deferred, Effect, Fiber, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import type { Json } from "flarex-protocol/json";
import { decodeOrderedIndexComponentsV1, orderedIndexKeyBytesHexV1FromBytes } from "flarex-protocol/ordered-index";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareBooleanPartialIndexSchema } from "./support/boolean-partial-index-schema";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makePreparedHostRuntime, retainPreparedHost } from "../../persistence-postgres/src/execution/preparation/preparedHostRuntime";
import { prepareLogicalReadMetadata } from "../../persistence-postgres/src/storage/documents/logicalReadMetadata";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions, fxAppUniqueKeys,
  fxControlIndexDefinitions, fxControlUniqueConstraintDefinitions, fxSystemCommits } from "../../persistence-postgres/src/database/schema";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const sourceKey = "medusa.boolean-partial-address";
const evidence = { kind: "nativeDml", sourceId: "BooleanPartialAddress" };
let schema: Effect.Success<ReturnType<typeof prepareBooleanPartialIndexSchema>>;
let tableName: string;
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let host: Effect.Success<ReturnType<typeof makeCommerceHost>>;
let storage: Awaited<ReturnType<typeof makeStorage>>;
let ordered: typeof fxControlIndexDefinitions.$inferSelect;
let unique: typeof fxControlUniqueConstraintDefinitions.$inferSelect;
const insert = defineCommerceCommand("booleanPartialInsert", "write", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table(tableName); return [...yield* table.write(ctx.manager, "insert", input)];
}));
const update = defineCommerceCommand("booleanPartialUpdate", "write", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table(tableName); return [...yield* table.write(ctx.manager, "update", input)];
}));
const remove = defineCommerceCommand("booleanPartialSoftDelete", "write", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table(tableName); return [...yield* table.lifecycle(ctx.manager, "softDelete", input)];
}));
const restore = defineCommerceCommand("booleanPartialRestore", "write", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table(tableName); return [...yield* table.lifecycle(ctx.manager, "restore", input)];
}));
const read = defineCommerceCommand("booleanPartialRead", "read", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table(tableName); return [...yield* table.find(ctx.manager, input)];
}));
const commands = [insert, update, remove, restore, read];
const selection = (parent: string, selected: boolean, active = true) => ({ order: { column: "id", direction: "asc" }, predicate: {
  kind: "and", children: [{ kind: "in", column: "parent_id", values: [parent] },
    { kind: "in", column: "selected", values: [selected] }, ...(active ? [{ kind: "isNull", column: "deleted_at" }] : [])],
} });
const run = (command: typeof insert, input: Json) => Effect.runPromise(host.run(host.newRequestKey(), command, input));
const rows = (parent: string, selected: boolean, active = true) => Effect.runPromise(host.read(read, selection(parent, selected, active)));
const snapshot = async () => ({
  rows: await fixture.persistence.drizzle.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId),
  revisions: await fixture.persistence.drizzle.select().from(fxAppRowRevisions).orderBy(fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
  index: await fixture.persistence.drizzle.select().from(fxAppIndexEntryCurrent).orderBy(fxAppIndexEntryCurrent.indexDefinitionId, fxAppIndexEntryCurrent.rowId),
  indexRevisions: await fixture.persistence.drizzle.select().from(fxAppIndexEntryRevisions).orderBy(fxAppIndexEntryRevisions.indexDefinitionId, fxAppIndexEntryRevisions.rowId, fxAppIndexEntryRevisions.commitSeq, fxAppIndexEntryRevisions.encodedKey),
  claims: await fixture.persistence.drizzle.select().from(fxAppUniqueKeys).orderBy(fxAppUniqueKeys.constraintId, fxAppUniqueKeys.rowId),
  commits: await fixture.persistence.drizzle.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq),
});
async function makeStorage() {
  const empty = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => new Error("Invalid Boolean index dataset"), hashFailure: cause => new Error("Boolean index dataset hash", { cause }) }));
  return { ...fixture.hostInput.logicalStorage, source: { sourceKey, writeProfile: sourceKey, schema, evidence },
    initialization: { stepId: "boolean-partial-empty", datasetSha256: empty.sha256Hex, expectedRowCount: 0 } };
}
async function currentMembership() {
  const entries = await fixture.persistence.drizzle.select().from(fxAppIndexEntryCurrent)
    .where(eq(fxAppIndexEntryCurrent.indexDefinitionId, ordered.indexDefinitionId)).orderBy(fxAppIndexEntryCurrent.encodedKey);
  const claims = await fixture.persistence.drizzle.select().from(fxAppUniqueKeys)
    .where(eq(fxAppUniqueKeys.constraintId, unique.uniqueConstraintDefinitionId));
  const ids = entries.map(entry => {
    const components = decodeOrderedIndexComponentsV1(orderedIndexKeyBytesHexV1FromBytes(entry.encodedKey), 3);
    expect(components[0]).toEqual({ kind: "boolean", value: true });
    const id = components[1]; if (id?.kind !== "string") throw new Error("Missing native Boolean index ID component");
    return id.value;
  });
  expect(claims.map(claim => Buffer.from(claim.rowId).toString("hex")).toSorted())
    .toEqual(entries.map(entry => Buffer.from(entry.rowId).toString("hex")).toSorted());
  return ids;
}

describe("installed native Boolean partial indexes", { concurrent: false }, () => {
  beforeAll(async () => {
    schema = await Effect.runPromise(prepareBooleanPartialIndexSchema());
    const table = schema.tables[0]; if (table === undefined || schema.tables.length !== 1) throw new Error("Missing native Address table");
    tableName = table.identity.tableId;
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: sourceKey, owner: "medusa", writeProfile: sourceKey, evidence,
      definition: { kind: "relational", schema }, bindings: [{ kind: "definition", localName: tableName,
        table: { namespace: "medusa", logicalName: "boolean-partial/addresses" } }] }));
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [source],
      ...(driver === "postgres" ? { managedRead: true } : {}) });
    storage = await makeStorage();
    host = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage, commands }));
    cleanup.push(() => Effect.runPromise(host.close)); await Effect.runPromise(host.initialize([]));
    const indexes = await fixture.control.drizzle.select().from(fxControlIndexDefinitions).where(eq(fxControlIndexDefinitions.deploymentId, fixture.deploymentId));
    const selected = indexes.filter(index => index.physicalSpecJson.predicate?.kind === "fieldIsNullAndBooleanEquals" &&
      index.physicalSpecJson.orderedFields[0]?.kind === "documentPath" && index.physicalSpecJson.orderedFields[0].path === "selected");
    expect(selected).toHaveLength(1); const selectedIndex = selected[0]; if (selectedIndex === undefined) throw new Error("Missing actual Boolean index"); ordered = selectedIndex;
    const uniques = await fixture.control.drizzle.select().from(fxControlUniqueConstraintDefinitions).where(and(
      eq(fxControlUniqueConstraintDefinitions.deploymentId, fixture.deploymentId), eq(fxControlUniqueConstraintDefinitions.tableId, ordered.tableId)));
    const selectedUnique = uniques.filter(item => item.physicalSpecJson.predicate?.kind === "fieldIsNullAndBooleanEquals");
    expect(selectedUnique).toHaveLength(1); const selectedConstraint = selectedUnique[0]; if (selectedConstraint === undefined) throw new Error("Missing actual Boolean unique definition"); unique = selectedConstraint;
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("enforces true membership while allowing false duplicates and independent parents", async () => {
    await run(insert, [{ id: "a", parent_id: "one", selected: true }, { id: "b", parent_id: "one" },
      { id: "c", parent_id: "one", selected: false }, { id: "d", parent_id: "two", selected: true }]);
    expect(await currentMembership()).toEqual(["a", "d"]);
    for (const input of [[{ id: "duplicate", parent_id: "one", selected: true }], [{ id: "b", selected: true }]]) {
      const before = await snapshot(); await expect(run(input[0]?.id === "b" ? update : insert, input)).rejects.toMatchObject({ reason: "invalidInput" });
      expect(await snapshot()).toEqual(before);
    }
    for (const selected of [false, true, false, true]) expect(await rows("one", selected)).toMatchObject(
      selected ? [{ id: "a", selected: true }] : [{ id: "b", selected: false }, { id: "c", selected: false }]);
  });

  it("releases claims on Boolean changes and soft deletion, and rolls back conflicting restore", async () => {
    const before = await snapshot();
    await run(update, [{ id: "a", selected: false }]); await run(update, [{ id: "b", selected: true }]);
    expect(await currentMembership()).toEqual(["b", "d"]);
    await run(remove, [{ id: "b" }]); await run(update, [{ id: "c", selected: true }]);
    const conflicting = await snapshot(); await expect(run(restore, [{ id: "b" }])).rejects.toMatchObject({ reason: "invalidInput" }); expect(await snapshot()).toEqual(conflicting);
    expect(await rows("one", true)).toMatchObject([{ id: "c" }]);
    // Removing active membership makes the partial parent index ineligible.
    // Preserve that refusal, then inspect deleted/current rows by their real
    // unconditional primary-key anchor rather than assuming an all-row scan.
    await expect(rows("one", true, false)).rejects.toMatchObject({ reason: "invalidInput" });
    expect(await Effect.runPromise(host.read(read, { order: { column: "id", direction: "asc" },
      predicate: { kind: "in", column: "id", values: ["b", "c"] } }))).toMatchObject([
      { id: "b", parent_id: "one", selected: true, deleted_at: expect.any(String) },
      { id: "c", parent_id: "one", selected: true, deleted_at: null },
    ]);
    await run(update, [{ id: "c", selected: false }]); await run(restore, [{ id: "b" }]);
    expect(await currentMembership()).toEqual(["b", "d"]);
    const after = await snapshot();
    expect(after.revisions.length).toBeGreaterThan(before.revisions.length);
    for (const revision of before.revisions) expect(after.revisions).toContainEqual(revision);
    for (const revision of before.indexRevisions) expect(after.indexRevisions).toContainEqual(revision);
    const history = after.indexRevisions.filter(entry => entry.indexDefinitionId === ordered.indexDefinitionId);
    expect(history.some(entry => entry.isTombstone)).toBe(true); expect(history.some(entry => !entry.isTombstone)).toBe(true);
  });

  it("reopens the genuine installed host without changing data or partial membership", async () => {
    const before = await snapshot(), reopened = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage, commands }));
    try {
      for (const selected of [true, false, true, false]) expect(await Effect.runPromise(reopened.read(read, selection("one", selected)))).toEqual(await rows("one", selected));
      expect(await currentMembership()).toEqual(["b", "d"]); expect(await snapshot()).toEqual(before);
    } finally { await Effect.runPromise(reopened.close); }
  });

  it.skipIf(driver !== "postgres")("retains actual Boolean selector cache hits and misses in both warming directions", async () => {
    const managed = fixture.managedRead, pin = fixture.sourcePins.find(source => source.sourceKey === sourceKey);
    if (managed === undefined || pin === undefined) throw new Error("Missing real protected Boolean source installation");
    for (const first of [false, true]) await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 16_777_216 });
      const retained = yield* retainPreparedHost(runtime, prepareLogicalReadMetadata(managed.control.drizzle,
        { deploymentId: fixture.deploymentId, scopeId: fixture.application.authority.scopeId, schemaVersionId: fixture.schemaVersionId }, pin, managed.controlInstallation));
      yield* Effect.acquireUseRelease(Effect.succeed(retained), owner => owner.use(metadata => Effect.gen(function* () {
        expect((yield* metadata.table(tableName)).selectorBooleanFields).toEqual(["selected"]);
        for (const value of [first, !first, first, !first]) {
          const selected = yield* metadata.selectIndex(tableName, { parent_id: "one", selected: value, deleted_at: null });
          expect(selected?.physicalSpec.predicate?.kind === "fieldIsNullAndBooleanEquals").toBe(value);
          const page = yield* metadata.selectPage(tableName, "id", { column: "selected", value }, ["deleted_at"]);
          if (value) expect(page?.indexDefinitionId).toBe(ordered.indexDefinitionId); else expect(page).toBeNull();
        }
        for (const where of [{ parent_id: "one", selected: true }, { parent_id: "one", deleted_at: null }])
          expect((yield* metadata.selectIndex(tableName, where))?.physicalSpec.predicate?.kind).not.toBe("fieldIsNullAndBooleanEquals");
        expect(yield* metadata.selectPage(tableName, "id", { column: "selected", value: true }, [])).toBeNull();
        expect((yield* metadata.selectPage(tableName, "id", undefined, ["deleted_at"]))?.physicalSpec.predicate?.kind)
          .not.toBe("fieldIsNullAndBooleanEquals");
      })), owner => owner.close);
    })));
  });

  it.skipIf(driver !== "postgres")("reads historical partial membership after the current owner changes", async () => {
    const baselineMembership = await currentMembership();
    await run(insert, [{ id: "snapshot-anchor", parent_id: "snapshot-anchor", selected: true },
      { id: "snapshot-old", parent_id: "snapshot-parent", selected: true },
      { id: "snapshot-new", parent_id: "snapshot-parent", selected: false }]);
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const historical = defineCommerceCommand("booleanPartialHistoricalRead", "read", Effect.fn(function* (ctx) {
      const table = yield* ctx.table(tableName);
      // Establish the snapshot using an unrelated identity. The Boolean
      // selector and its old member are first read after the external writes.
      expect(yield* table.find(ctx.manager, { order: { column: "id", direction: "asc" },
        predicate: { kind: "in", column: "id", values: ["snapshot-anchor"] } })).toMatchObject([{ id: "snapshot-anchor" }]);
      yield* Deferred.succeed(reached, undefined); yield* Deferred.await(release);
      return [...yield* table.find(ctx.manager, selection("snapshot-parent", true))];
    }));
    const reader = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage, commands: [historical] }));
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const running = yield* Effect.forkChild(reader.read(historical, null));
        yield* Effect.raceFirst(Deferred.await(reached), Fiber.join(running).pipe(
          Effect.flatMap(() => Effect.die(new Error("Historical reader completed before its suspension signal"))),
        )).pipe(Effect.timeout(20_000));
        yield* host.run(host.newRequestKey(), update, [{ id: "snapshot-old", selected: false }]);
        yield* host.run(host.newRequestKey(), update, [{ id: "snapshot-new", selected: true }]);
        yield* Deferred.succeed(release, undefined);
        expect(yield* Fiber.join(running)).toMatchObject([{ id: "snapshot-old" }]);
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout(40_000))));
      expect(await rows("snapshot-parent", true)).toMatchObject([{ id: "snapshot-new" }]);
      expect(await currentMembership()).toEqual([...baselineMembership, "snapshot-anchor", "snapshot-new"].toSorted());
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); await Effect.runPromise(reader.close); }
  }, 120_000);
});
