import { Effect, Result, Schema } from "effect";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceCommand, makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import type { LogicalCallReceiptValidation } from "../../src/repository/call-receipt";
import { correlatePhysicalGraphReceipt } from "../../src/repository/physical-graph-receipt";
import { medusaLifecycle } from "../../src/repository/lifecycle";
import { decodeCompiledDml } from "../../src/schema/compiled";
import { lowerDmlSchema } from "../../src/schema/lower";
import { commerceDecoder } from "../../src/value/decoder";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

const stamp = "2026-10-23T00:00:00.000Z";
export const selfCascadeNode = (id: string, parent_id: string | null = null, historical = false) => ({
  id, parent_id, created_at: stamp, updated_at: stamp, deleted_at: historical ? stamp : null,
});
const Node = Schema.Struct({ id: Schema.String, parent_id: Schema.NullOr(Schema.String),
  created_at: Schema.String, updated_at: Schema.String, deleted_at: Schema.NullOr(Schema.String) });
const Ids = Schema.Array(Schema.String);
const Delete = Schema.Struct({ ids: Ids,
  recipe: Schema.optionalKey(Schema.Literals(["incomplete", "overBound", "lateRefusal"])) });
const Output = Schema.Struct({ roots: Ids, deleted: Ids });
const Event = Schema.Struct({ name: Schema.Literal("neutral_node.deleted"), data: Schema.Struct({ id: Schema.String }) });
const decodeOutput = commerceDecoder(Output, "receiptMismatch");
const decodeIds = commerceDecoder(Ids, "receiptMismatch");
const decodeEvent = commerceDecoder(Event, "receiptMismatch");
const decodePatch = commerceDecoder(Schema.Array(Schema.Struct({ id: Schema.String,
  parent_id: Schema.NullOr(Schema.String) })), "invalidInput");
const decodeDelete = commerceDecoder(Delete, "invalidInput");
const decodeDeleteReceipt = commerceDecoder(Delete, "receiptMismatch");
const decodeNode = commerceDecoder(Node, "receiptMismatch");
type Activity = Parameters<LogicalCallReceiptValidation>[1];

/** A neutral installed source. The fixture supplies metadata and commands;
 * production lifecycle and receipt owners perform every graph traversal. */
export async function prepareLogicalSelfCascade(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly ReturnType<typeof selfCascadeNode>[]) {
  const metadata = await Effect.runPromise(decodeCompiledDml({ tables: [{ name: "neutral_node", columns: [
    { name: "id", type: "id", primaryKey: true, nullable: false },
    { name: "parent_id", type: "text", primaryKey: false, nullable: true },
    ...["created_at", "updated_at", "deleted_at"].map(name => ({ name, type: "dateTime", primaryKey: false, nullable: name === "deleted_at" })),
  ], indexes: [{ name: "node_parent", columns: ["parent_id"], unique: false }], checks: [],
  foreignKeys: [{ name: "node_parent_fk", columns: ["parent_id"], referencedTable: "neutral_node", referencedColumns: ["id"], onDelete: "cascade" }],
  relationships: [
    { name: "parent", type: "belongsTo", targetModel: "NeutralNode", targetTable: "neutral_node", nullable: true,
      cascadeDelete: false, cascadeDetach: false, foreignKeyName: "node_parent_fk" },
    { name: "children", type: "hasMany", targetModel: "NeutralNode", targetTable: "neutral_node", mappedBy: "parent", nullable: false,
      cascadeDelete: true, cascadeDetach: false },
  ], cascades: { delete: ["children"], detach: [] } }] }));
  const table = metadata.tables[0];
  if (table === undefined) throw new Error("Missing neutral self-cascade metadata");
  const schema = Result.getOrThrow(normalizeRelationalSchema(lowerDmlSchema(metadata.tables, "commerce.self-cascade-fixture")));
  const evidence = { kind: "synthetic", sourceId: "neutral-self-cascade-fixture" };
  const key = "medusa.self-cascade-fixture";
  const source = await Effect.runPromise(captureLogicalSchemaSource({ key, owner: "medusa", writeProfile: key,
    evidence, definition: { kind: "relational", schema }, bindings: [{ kind: "definition", localName: table.name,
      table: { namespace: "medusa", logicalName: "commerce.self-cascade-fixture/neutral_node" } }] }));
  const fixture = await logicalCurrencyFixture(driver, close, { additionalSources: [source] });
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) }));
  const logicalStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey: key, writeProfile: key, schema, evidence },
    initialization: { stepId: "neutral-self-cascade-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
  const list = defineCommerceCommand("neutralSelfCascadeList", "read", Effect.fn("SelfCascade.list")(function* (ctx) {
    return [...yield* (yield* ctx.table(table.name)).find(ctx.manager, { order: { column: "id", direction: "asc" } })];
  }));
  const seed = defineCommerceCommand("neutralSelfCascadeSeed", "write", Effect.fn("SelfCascade.seed")(function* (ctx) {
    if (rows.length) yield* (yield* ctx.table(table.name)).write(ctx.manager, "insert", rows);
    return null;
  }));
  const patch = defineCommerceCommand("neutralSelfCascadePatch", "write", Effect.fn("SelfCascade.patch")(function* (ctx, input) {
    const values = yield* Effect.fromResult(decodePatch(input));
    yield* (yield* ctx.table(table.name)).write(ctx.manager, "update", values); return null;
  }));
  const ordinary = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage, commands: [list, seed, patch] }));
  close(() => Effect.runPromise(ordinary.close));
  await Effect.runPromise(ordinary.initialize([]));
  // Neutral rows enter through their own real trusted command and constraints.
  await Effect.runPromise(ordinary.run(ordinary.newRequestKey(), seed, null));
  const activities: Activity[] = [];
  const remove = defineCommerceCommand("neutralSelfCascadeDelete", "write", Effect.fn("SelfCascade.delete")(function* (ctx, input) {
    const value = yield* Effect.fromResult(decodeDelete(input));
    const lifecycle = medusaLifecycle(ctx, { tables: metadata.tables, entities: [{ table, model: "NeutralNode" }] }, "delete");
    const selected = yield* lifecycle.roots(table, value.ids);
    const plan = yield* lifecycle.plan(table, selected);
    const changed = yield* plan.apply();
    const roots: string[] = [], deleted: string[] = [];
    for (const row of changed.roots) {
      if (typeof row.id !== "string") return yield* ctx.refuse(commerceError("storedCorruption"));
      roots.push(row.id);
    }
    for (const row of changed.cascades.NeutralNode ?? []) {
      if (typeof row.id !== "string") return yield* ctx.refuse(commerceError("storedCorruption"));
      deleted.push(row.id);
    }
    for (const id of roots) yield* ctx.captureLocalEvent({ name: "neutral_node.deleted", data: { id } });
    if (value.recipe === "lateRefusal") return yield* ctx.refuse(commerceError("invalidInput"));
    return { roots, deleted };
  }));
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("SelfCascade.validate")(function* (call, activity) {
    activities.push(activity);
    const input = yield* Effect.fromResult(decodeDeleteReceipt(call.input));
    const output = yield* Effect.fromResult(decodeOutput(call.result));
    const ids = yield* Effect.fromResult(correlatePhysicalGraphReceipt({
      tables: input.recipe === "incomplete" ? [{ ...table, foreignKeys: [] }] : metadata.tables,
      entities: [{ table, maximum: input.recipe === "overBound" ? 2 : 16, decodeRow: decodeNode }],
      root: table, requestedIds: input.ids, activity,
    }));
    const deletedIds = yield* Effect.fromResult(decodeIds(activity.mutations.map(mutation => mutation.before?.id)));
    if (!jsonEqual(ids, output.roots) || !jsonEqual(deletedIds, output.deleted) ||
      activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const events: JsonObject[] = [];
    for (const event of call.events) events.push(yield* Effect.fromResult(decodeEvent(event)));
    if (!jsonEqual(events, ids.map(id => ({ name: "neutral_node.deleted", data: { id } }))))
      return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  const participant = defineAtomicCommerceParticipant("neutralSelfCascade");
  const root = defineAtomicCommerceCommand("neutralSelfCascadeRoot", (ctx, input) => ctx.call(participant, remove, input));
  const revision = "b".repeat(64);
  const contract = defineCommerceEventContract({ name: "neutral_node.deleted", revision, internal: true, decode: value => Effect.fromResult(decodeEvent(value)) });
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
    commands: [root], participants: [{ participant, logicalStorage, commands: [remove], validateLogicalCall,
      events: { contracts: [contract], select: () => Effect.succeed(contract) } }],
    events: { producerRevision: revision, contracts: [contract], subscribers: [{ id: "neutral-self-cascade", revision }],
      validate: events => events.every(event => event.internal) ? Effect.void : Effect.fail(commerceError("unadmittedEvent")) },
  }));
  close(() => Effect.runPromise(host.close));
  return { fixture, host, root, activities,
    run: (input: typeof Delete.Type, request = host.newRequestKey()) => Effect.runPromise(host.run(request, root, input)),
    read: () => Effect.runPromise(ordinary.read(list, null)),
    patch: (input: readonly { id: string; parent_id: string | null }[]) => Effect.runPromise(ordinary.run(ordinary.newRequestKey(), patch, [...input])),
    snapshot: () => logicalCurrencyInventory(fixture),
  };
}
