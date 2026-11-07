import { randomUUID } from "node:crypto";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { isRelationalColumnValue, normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { defineCommerceCommand, type CommerceCommandContext, type LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant, type AtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeCoreRelationalNativeDefinition } from "../../persistence-postgres/src/core/nativePolicy";
import { inspectReferenceFailure } from "../../persistence-postgres/src/values/referenceFailure";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import type { AtomicWorkflowHostComposition } from "../src/workflow/host";
import type { SchemaTable } from "../src/schema/model";
import { lowerDmlSchema } from "../src/schema/lower";
import type { CommerceRelation } from "../src/query/relations";
import type { GraphCatalog, GraphEntity, ReplacementProfile } from "../src/write/graph-model";
import { replaceGraphRows } from "../src/write/replace";
import { createCoreNativeWorkflowFixture } from "./support/core-native-workflow-fixture";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
const stamp = "2026-01-01T00:00:00.000Z";
const origin = { kind: "synthetic", sourceId: "neutral-native-update-statements" };
function table(name: string, fields: readonly string[], foreignKeys: SchemaTable["foreignKeys"] = [],
  indexes: SchemaTable["indexes"] = []): SchemaTable {
  return { name, foreignKeys, indexes, columns: [
    ...["id", ...fields].map(field => ({ name: field, type: "text" as const, primaryKey: field === "id", nullable: false, generated: false })),
    ...["created_at", "updated_at", "deleted_at"].map(field => ({ name: field, type: "dateTime" as const,
      primaryKey: false, nullable: field === "deleted_at", generated: false })),
  ] };
}
const anchorTable = table("anchor", ["name"]);
const kindTable = table("kind", ["code", "label"], [], [{ name: "kind.code", columns: ["code"], unique: true, type: "btree" }]);
const documentTable = table("document", ["name", "kind_id", "anchor_id"], [
  { name: "document.kind", columns: ["kind_id"], referencedTable: "kind", referencedColumns: ["id"] },
  { name: "document.anchor", columns: ["anchor_id"], referencedTable: "anchor", referencedColumns: ["id"] },
]);
const entryTable = table("entry", ["document_id", "value"], [
  { name: "entry.document", columns: ["document_id"], referencedTable: "document", referencedColumns: ["id"], onDelete: "cascade" },
], [{ name: "entry.document-order", columns: ["document_id", "id"], unique: false, type: "btree" }]);
const tables = [anchorTable, kindTable, documentTable, entryTable];
const entity = (table: SchemaTable, model: string): GraphEntity => ({ table, model, keyColumn: "id", prefix: undefined });
const anchor = entity(anchorTable, "Anchor"), kind = entity(kindTable, "Kind"), document = entity(documentTable, "Document"), entry = entity(entryTable, "Entry");
const decodeObject = Schema.decodeUnknownResult(Schema.JsonObject);
const decodeId = Schema.decodeUnknownResult(Schema.String);
const decodeManagedUpdate = Schema.decodeUnknownResult(Schema.Struct({
  updated_at: Schema.String.check(Schema.makeFilter(value => isRelationalColumnValue("timestamptz", false, value))),
}));
const catalog: GraphCatalog = {
  entities: [anchor, kind, document, entry], tables, writablePivots: [],
  queryRelations: new Map([["document", new Map<string, CommerceRelation>([
    ["kind", { name: "kind", sourcePrimaryKeys: ["id"], targetTable: "kind", targetPrimaryKeys: ["id"],
      join: { type: "belongsTo", foreignKeys: ["kind_id"] } }],
    ["entries", { name: "entries", sourcePrimaryKeys: ["id"], targetTable: "entry", targetPrimaryKeys: ["id"],
      join: { type: "hasMany", foreignKeys: ["document_id"] } }],
  ])]]),
  decodeRow: (_entity, input) => Result.gen(function* () {
    const supplied = yield* decodeObject(input).pipe(Result.mapError(cause => commerceError("invalidInput", cause)));
    const key = supplied.id === undefined ? undefined
      : yield* decodeId(supplied.id).pipe(Result.mapError(cause => commerceError("invalidInput", cause)));
    return { supplied, key };
  }),
  decodeReference: (_entity, input) => decodeId(input).pipe(Result.map(key => ({ key })),
    Result.mapError(cause => commerceError("invalidInput", cause))),
  decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")),
};
const profile: ReplacementProfile = {
  catalog, operation: "update", allowReconstitution: true, ordering: new Map([["entry", "id"]]),
  allowedRelations: selected => selected === document ? ["kind", "entries"] : [],
  ownedToOne: selected => selected === document ? ["kind"] : [], mutableForeignKeys: selected => selected === document,
  admitSelection: () => Result.succeed(undefined), prepareProjection: () => Effect.void,
  toManyMode: (selected, name, child) => selected === document && name === "entries" && child === entry
    ? Result.succeed("replace") : Result.fail(commerceError("unsupportedProfile")),
  validateLink: () => Effect.fail(commerceError("unsupportedProfile")),
  projectionPaths: (_entity, paths) => paths,
  project: rows => Result.succeed(new Map([...rows].map(([name, rows]) => [name, rows.filter(row => row.deleted_at === null)]))),
};
type Activity = Parameters<LogicalCommerceCallValidation>[1];
const participant = defineAtomicCommerceParticipant("neutral-native-update");
const failures = <A, E>(outcome: Exit.Exit<A, E>) => Exit.isFailure(outcome) ? outcome.cause.reasons.flatMap(reason =>
  Cause.isFailReason(reason) ? [reason.error] : []) : [];
const mixed = [{ id: "document", name: "Changed document", kind: { id: "kind-a", label: "Changed kind" },
  entries: [{ id: "entry-new", value: "new" }] }];

interface FixtureSettings {
  readonly historical?: "root" | "child";
  readonly touchOwnedToOne?: false;
}
async function fixture(settings: FixtureSettings = {}) {
  const activities: Activity[] = [];
  const makeCommand = (selected: boolean) => defineCommerceCommand(selected ? "native-graph-update" : "planned-graph-update", "write",
    (context, input) => replaceGraphRows(context, { ...profile,
      ...(settings.touchOwnedToOne === false ? {} : { touchOwnedToOne: true as const }),
      ...(selected ? { nativeUpdateStatements: true as const } : {}) },
      document, input, { relations: ["kind", "entries"] }).pipe(Effect.map(result => result.entities)));
  const native = makeCommand(true), planned = makeCommand(false);
  const definition = await Effect.runPromise(Effect.gen(function* () {
    const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(tables, origin.sourceId)));
    const source = yield* captureLogicalSchemaSource({ key: "medusa.neutral-native-update", owner: "medusa",
      writeProfile: "medusa.neutral-native-update", evidence: { provenance: origin }, definition: { kind: "relational", schema },
      bindings: schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
        table: { namespace: "medusa", logicalName: `${origin.sourceId}/${table.identity.tableId}` } })) });
    return yield* makeCoreRelationalNativeDefinition({ scopeUuid: randomUUID(), epochUuid: randomUUID(), source, provenance: origin, commands: [] });
  }));
  const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
  const tested = await createCoreNativeWorkflowFixture(driver, { sources: [{ name: "neutral", definition, initialCommands: [native, planned], rows: [
    { table: "anchor", row: { id: "anchor", name: "Active", ...managed } },
    { table: "anchor", row: { id: "historical-anchor", name: "Historical", ...managed, deleted_at: stamp } },
    { table: "kind", row: { id: "kind-a", code: "alpha", label: "Original kind", ...managed } },
    { table: "kind", row: { id: "kind-b", code: "occupied", label: "Other kind", ...managed } },
    { table: "kind", row: { id: "historical-kind", code: "historical", label: "Historical kind", ...managed, deleted_at: stamp } },
    { table: "document", row: { id: "document", name: "Original document", kind_id: "kind-a", anchor_id: "anchor", ...managed,
      ...(settings.historical === "root" ? { deleted_at: stamp } : {}) } },
    { table: "entry", row: { id: "entry-old", document_id: "document", value: "old", ...managed,
      ...(settings.historical === "child" ? { deleted_at: stamp } : {}) } },
  ] }] });
  const root = (selected: boolean) => {
    const command = defineAtomicCommerceCommand(selected ? "neutral-native-update-root" : "neutral-planned-update-root",
      (context, input) => context.call(participant, selected ? native : planned, input));
    const composition = { identityAndAccessPolicy: { profile: "neutral-native-update-statements" }, commands: [command],
      participants: [{ participant, nativeStorage: tested.source("neutral"), commands: [native, planned], statementReferenceChecks: true as const,
        validateLogicalCall: (_call, activity) => Effect.sync(() => { activities.push(structuredClone(activity)); }) }],
    } satisfies AtomicWorkflowHostComposition;
    return { command, prepared: tested.execution.prepare(composition) };
  };
  return { tested, activities, root };
}

async function withFixture(body: (prepared: Awaited<ReturnType<typeof fixture>>,
  open: (selected: boolean) => Promise<{ readonly command: ReturnType<typeof defineAtomicCommerceCommand>; readonly host: AtomicCommerceHost }>) => Promise<void>,
  settings: FixtureSettings = {}) {
  const prepared = await fixture(settings), hosts: AtomicCommerceHost[] = [];
  const open = async (selected: boolean) => {
    const root = prepared.root(selected), host = await prepared.tested.run(root.prepared);
    hosts.push(host); return { command: root.command, host };
  };
  try { await body(prepared, open); }
  finally {
    const errors: unknown[] = [];
    for (const host of hosts.reverse()) try { await Effect.runPromise(host.close); } catch (error) { errors.push(error); }
    try { await prepared.tested.close(); } catch (error) { errors.push(error); }
    if (errors.length !== 0) throw new AggregateError(errors, "Native graph owner fixture cleanup failed");
  }
}

describe(`${driver} native update statement phases`, () => {
  it("refuses incompatible statement policies before borrowing a table", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(reason => commerceError(reason),
        { calls: 32, commandBytes: 65_536, commandMs: 30_000 }, {}, {}, "native-graph-policy", "write"), value => value.close);
      let tableCalls = 0;
      const context: Pick<CommerceCommandContext, "manager" | "table" | "resources"> = {
        manager: lifetime.context, resources: defaultCommerceResources,
        table: () => Effect.suspend(() => { tableCalls++; return Effect.fail(commerceError("invalidAuthority")); }),
      };
      const selected = { ...profile, nativeUpdateStatements: true as const };
      const falseFlag = { ...selected };
      Object.defineProperty(falseFlag, "nativeUpdateStatements", { value: false });
      const candidates: readonly { readonly profile: ReplacementProfile; readonly creation: boolean }[] = [
        { profile: selected, creation: true }, { profile: { ...selected, operation: "upsertWithReplace" }, creation: false },
        { profile: { ...selected, orderedDeletionTables: [] }, creation: false },
        { profile: { ...selected, touchExistingRoot: true }, creation: false },
        { profile: { ...selected, ownedChildUpdatedAt: "managed" }, creation: false },
        { profile: { ...selected, foreignKeyVisibility: () => "existing" }, creation: false },
        { profile: falseFlag, creation: false },
      ];
      for (const candidate of candidates) {
        const outcome = yield* Effect.exit(replaceGraphRows(context, candidate.profile, document, [], { relations: [] }, candidate.creation));
        expect(failures(outcome)).toEqual([expect.objectContaining({ reason: "unsupportedProfile" })]);
      }
      expect(tableCalls).toBe(0);
    })));
  });

  it.each([true, false])("keeps actual managed rows and the selected=%s storage order", selected =>
    withFixture(async ({ tested, activities }, open) => {
      const { host, command } = await open(selected);
      const result = await Effect.runPromise(host.run(host.newRequestKey(), command, mixed));
      expect(activities).toHaveLength(1);
      const mutations = activities[0]?.mutations ?? [];
      expect(mutations.map(row => `${row.table}:${row.operation}`)).toEqual(selected
        ? ["kind:patch", "document:patch", "entry:delete", "entry:insert"]
        : ["entry:delete", "entry:insert", "kind:patch", "document:patch"]);
      expect(result).toEqual([expect.objectContaining({ id: "document", name: "Changed document",
        kind: expect.objectContaining({ id: "kind-a", label: "Changed kind" }),
        entries: [expect.objectContaining({ id: "entry-new", value: "new" })] })]);
      const rootWrite = mutations.find(row => row.table === "document");
      const kindWrite = mutations.find(row => row.table === "kind");
      const rootManaged = Result.getOrThrow(decodeManagedUpdate(rootWrite?.after));
      const kindManaged = Result.getOrThrow(decodeManagedUpdate(kindWrite?.after));
      expect(result).toEqual([expect.objectContaining({ updated_at: rootManaged.updated_at,
        kind: expect.objectContaining({ updated_at: kindManaged.updated_at }) })]);
      expect((await tested.readRows("neutral", ["entry-old"]))).toEqual([]);
    }), 120_000);

  it.each([true, false])("preserves the selected=%s competing failure boundary and rolls back the root", selected =>
    withFixture(async ({ tested, activities }, open) => {
      const { host, command } = await open(selected);
      const before = await tested.snapshot();
      const outcome = await Effect.runPromiseExit(host.run(host.newRequestKey(), command,
        [{ id: "document", anchor_id: "missing-anchor", kind: { id: "kind-a", code: "occupied" }, entries: [{ id: "entry-new", value: "new" }] }]));
      expect(Exit.isFailure(outcome)).toBe(true);
      const errors = failures(outcome);
      expect(errors).toEqual(expect.arrayContaining([selected
        ? expect.objectContaining({ reason: "invalidInput", cause: expect.objectContaining({ _tag: "CoreNativeUniqueConflict" }) })
        : expect.objectContaining({ reason: "adapterFailure", cause: expect.objectContaining({ message: expect.stringContaining("anchor_id: missing-anchor") }) })]));
      expect(errors.some(error => inspectReferenceFailure(error) !== undefined)).toBe(false);
      expect(activities).toEqual([]);
      expect(await tested.snapshot()).toEqual(before);
    }), 120_000);

  it("uses Core physical existence for a historical target while retaining default active planning", () =>
    withFixture(async ({ tested }, open) => {
      const native = await open(true), planned = await open(false);
      const input = [{ id: "document", anchor_id: "historical-anchor" }];
      expect(await Effect.runPromise(native.host.run(native.host.newRequestKey(), native.command, input)))
        .toEqual([expect.objectContaining({ id: "document", anchor_id: "historical-anchor" })]);
      const before = await tested.snapshot();
      const outcome = await Effect.runPromiseExit(planned.host.run(planned.host.newRequestKey(), planned.command, input));
      expect(failures(outcome)).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "adapterFailure" })]));
      expect(await tested.snapshot()).toEqual(before);
    }), 120_000);

  it("touches only selected historical owned-to-one objects and preserves their lifecycle and Core identity", () =>
    withFixture(async ({ tested, activities }, open) => {
      const native = await open(true), planned = await open(false);
      const original = (await tested.snapshot()).rows.find(row => row.value.id === "historical-kind");
      if (original === undefined) throw new Error("Missing historical owned-to-one fixture row");
      expect(typeof original.value._id).toBe("string");
      expect(typeof original.value._creationTime).toBe("number");
      const keyOnly = [{ id: "document", kind: { id: "historical-kind" } }];
      expect(await Effect.runPromise(native.host.run(native.host.newRequestKey(), native.command, keyOnly)))
        .toEqual([expect.objectContaining({ id: "document", kind_id: "historical-kind", kind: null })]);
      expect(activities[0]?.mutations.map(row => `${row.table}:${row.operation}`)).toEqual(["kind:patch", "document:patch"]);
      const touched = Result.getOrThrow(decodeManagedUpdate(activities[0]?.mutations[0]?.after));
      expect(touched.updated_at).not.toBe(stamp);
      const input = [{ id: "document", kind: { id: "historical-kind", label: "Changed historical kind",
        created_at: stamp, updated_at: touched.updated_at, deleted_at: stamp } }];
      expect(await Effect.runPromise(native.host.run(native.host.newRequestKey(), native.command, input)))
        .toEqual([expect.objectContaining({ id: "document", kind_id: "historical-kind", kind: null })]);
      expect(activities[1]?.mutations.map(row => `${row.table}:${row.operation}`)).toEqual(["kind:patch", "document:patch"]);
      const updated = Result.getOrThrow(decodeManagedUpdate(activities[1]?.mutations[0]?.after));
      expect(await tested.readRows("neutral", ["historical-kind"]))
        .toEqual([{ id: "historical-kind", code: "historical", label: "Changed historical kind",
          created_at: stamp, updated_at: updated.updated_at, deleted_at: stamp }]);
      const current = (await tested.snapshot()).rows.find(row => row.value.id === "historical-kind");
      if (current === undefined) throw new Error("Historical owned-to-one update lost its physical row");
      expect(current.value._id).toBe(original.value._id);
      expect(current.value._creationTime).toBe(original.value._creationTime);
      const beforeDenied = await tested.snapshot();
      const denied = await Effect.runPromiseExit(planned.host.run(planned.host.newRequestKey(), planned.command, keyOnly));
      expect(Exit.isFailure(denied) ? denied.cause.reasons : []).toHaveLength(2);
      expect(failures(denied)).toEqual([
        expect.objectContaining({ reason: "invalidInput" }), expect.objectContaining({ reason: "rollbackOnly" }),
      ]);
      expect(activities).toHaveLength(2);
      expect(await tested.snapshot()).toEqual(beforeDenied);
    }), 120_000);

  it("requires the owned-to-one touch selection before admitting a historical object", () =>
    withFixture(async ({ tested, activities }, open) => {
      const { host, command } = await open(true), before = await tested.snapshot();
      const denied = await Effect.runPromiseExit(host.run(host.newRequestKey(), command,
        [{ id: "document", kind: { id: "historical-kind", label: "Refused" } }]));
      expect(Exit.isFailure(denied) ? denied.cause.reasons : []).toHaveLength(2);
      expect(failures(denied)).toEqual([
        expect.objectContaining({ reason: "invalidInput" }), expect.objectContaining({ reason: "rollbackOnly" }),
      ]);
      expect(activities).toEqual([]);
      expect(await tested.snapshot()).toEqual(before);
    }, { touchOwnedToOne: false }), 120_000);

  it.each(["root", "child"] as const)("does not admit historical %s writes through the owned-to-one selection", historical =>
    withFixture(async ({ tested, activities }, open) => {
      const { host, command } = await open(true), before = await tested.snapshot();
      const denied = await Effect.runPromiseExit(host.run(host.newRequestKey(), command,
        [{ id: "document", name: "Refused", entries: [{ id: "entry-old", value: "Refused" }] }]));
      expect(Exit.isFailure(denied) ? denied.cause.reasons : []).toHaveLength(2);
      expect(failures(denied)).toEqual([
        expect.objectContaining({ reason: "invalidInput" }), expect.objectContaining({ reason: "rollbackOnly" }),
      ]);
      expect(activities).toEqual([]);
      expect(await tested.snapshot()).toEqual(before);
    }, { historical }), 120_000);

  it("keeps supplied managed fields strict on historical owned-to-one updates", () =>
    withFixture(async ({ tested, activities }, open) => {
      const before = await tested.snapshot();
      for (const altered of [
        { created_at: "2025-01-01T00:00:00.000Z" },
        { updated_at: "2027-01-01T00:00:00.000Z" },
        { deleted_at: null },
      ]) {
        const { host, command } = await open(true);
        const denied = await Effect.runPromiseExit(host.run(host.newRequestKey(), command,
          [{ id: "document", kind: { id: "historical-kind", label: "Refused", ...altered } }]));
        expect(Exit.isFailure(denied) ? denied.cause.reasons : []).toHaveLength(2);
        expect(failures(denied)).toEqual([
          expect.objectContaining({ reason: "invalidInput" }), expect.objectContaining({ reason: "rollbackOnly" }),
        ]);
        expect(await tested.snapshot()).toEqual(before);
      }
      expect(activities).toEqual([]);
    }), 120_000);

  it("skips key-only/equal-child writes but touches an owned key-only object and its root", () =>
    withFixture(async ({ tested, activities }, open) => {
      const { host, command } = await open(true);
      const before = await tested.snapshot();
      await Effect.runPromise(host.run(host.newRequestKey(), command,
        [{ id: "document", entries: [{ id: "entry-old", value: "old" }] }]));
      expect(activities[0]?.mutations).toEqual([]);
      const unchanged = await tested.snapshot();
      expect(unchanged.rows).toEqual(before.rows); expect(unchanged.revisions).toEqual(before.revisions);
      await Effect.runPromise(host.run(host.newRequestKey(), command, [{ id: "document", kind: { id: "kind-a" } }]));
      expect(activities[1]?.mutations.map(row => `${row.table}:${row.operation}`)).toEqual(["kind:patch", "document:patch"]);
      const kindWrite = activities[1]?.mutations[0];
      expect(kindWrite?.after?.created_at).toBe(stamp);
      expect(kindWrite?.after?.updated_at).not.toBe(stamp);
    }), 120_000);
});
