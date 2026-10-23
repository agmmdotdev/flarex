import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/frameworks/commerceTransaction/context";
import { commerceRelationReadQuery } from "../src/query/relations";
import { medusaLifecycle } from "../src/repository/lifecycle";
import { correlatePhysicalGraphReceipt } from "../src/repository/physical-graph-receipt";
import { decodeCompiledDml } from "../src/schema/compiled";
import { commerceDecoder } from "../src/value/decoder";
import { mockRelationalRead } from "./mock-relational-read";

type Table = Effect.Success<ReturnType<typeof decodeCompiledDml>>["tables"][number];
type Activity = Parameters<typeof correlatePhysicalGraphReceipt>[0]["activity"];
const stamp = "2026-10-23T00:00:00.000Z";
const node = (id: string, parent: string | null = null, historical = false): JsonObject =>
  ({ id, parent_id: parent, deleted_at: historical ? stamp : null });
const parent = node("a"), child = node("b", "a", true);
let table: Table;
const decodeRow = commerceDecoder(Schema.Struct({ id: Schema.String, parent_id: Schema.NullOr(Schema.String),
  deleted_at: Schema.NullOr(Schema.String) }), "receiptMismatch");
const decodeQuery = commerceDecoder(Schema.Struct({ take: Schema.Number,
  order: Schema.Struct({ column: Schema.Literal("id"), direction: Schema.Literal("asc") }),
  predicate: Schema.Struct({ kind: Schema.Literal("in"), column: Schema.String, values: Schema.Array(Schema.String) }),
}), "unsupportedProfile");
const decodeKeys = commerceDecoder(Schema.Array(Schema.Struct({ id: Schema.String })), "invalidInput");
const read = (column: string, values: readonly string[], total: number): Activity["relationalReads"][number] => ({ table: "node",
  query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column, values: [...values] }), total, returned: total });
const remove = (row: JsonObject, ordinal: number): Activity["mutations"][number] =>
  ({ table: "node", operation: "delete", before: row, after: null, ordinal });
const activity = (rows: readonly JsonObject[], reads: Activity["relationalReads"], deleted = rows): Activity =>
  ({ observedRows: rows.map(row => ({ table: "node", row })), relationalReads: reads,
    mutations: deleted.map(remove), lifecycle: [], setNull: [], referenceReplacements: [] });
const correlate = (evidence: Activity, requestedIds: readonly string[], maximum = 8) => correlatePhysicalGraphReceipt({
  tables: [table], entities: [{ table, maximum, decodeRow }], root: table, requestedIds, activity: evidence,
});
const refused = (evidence: Activity, requestedIds: readonly string[], maximum = 8) =>
  expect(correlate(evidence, requestedIds, maximum)).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

// A scripted store records selections and scalar key application only. The
// independent logical-store fixture owns real constraint and rollback proof.
function executePlanner(rows: readonly JsonObject[], ids: readonly string[], operation: "delete" | "softDelete" | "restore" = "delete",
  checked = table) {
  const deleted: string[] = [], lifecycleKeys: string[] = [], reads: Activity["relationalReads"][number][] = [];
  const work = Effect.scoped(Effect.gen(function* () {
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError,
      commerceLimits, {}, {}, "neutralSelfCascade", "write"), lifetime => lifetime.close);
    const remaining = new Map(rows.map(row => [String(row.id), row]));
    const unused = () => Effect.fail(commerceError("unsupportedProfile"));
    const store: CommerceCommandContext["store"] = {
      prepareRead(query: unknown) { return mockRelationalRead(this, query); },
      find: Effect.fn("NeutralSelfCascade.find")(function* (_manager, query) {
        const selection = yield* Effect.fromResult(decodeQuery(query));
        const selected = [...remaining.values()].filter(row => selection.predicate.values.includes(String(row[selection.predicate.column])))
          .sort((left, right) => String(left.id).localeCompare(String(right.id)));
        reads.push({ table: "node", query: selection, total: selected.length, returned: selected.length });
        return selected;
      }),
      delete: Effect.fn("NeutralSelfCascade.delete")(function* (_manager, keys) {
        const changed: JsonObject[] = [];
        for (const key of yield* Effect.fromResult(decodeKeys(keys))) {
          const row = remaining.get(key.id);
          if (row === undefined) continue;
          remaining.delete(key.id); deleted.push(key.id); changed.push(row);
        }
        return changed;
      }),
      lifecycle: Effect.fn("NeutralSelfCascade.lifecycle")(function* (_manager, _operation, keys) {
        const selected: JsonObject[] = [];
        for (const key of yield* Effect.fromResult(decodeKeys(keys))) {
          const row = remaining.get(key.id);
          if (row !== undefined) { lifecycleKeys.push(key.id); selected.push(row); }
        }
        return selected;
      }),
      aggregate: unused, count: unused, findPage: unused, write: unused,
    };
    const ctx = makeCommerceCommandContext(lifetime, { store, resources: defaultCommerceResources,
      table: () => Effect.succeed(store) }, "neutralSelfCascade", lifetime.context, unused, unused);
    const lifecycle = medusaLifecycle(ctx, { tables: [checked], entities: [{ table: checked, model: "Node" }] }, operation);
    const roots = yield* lifecycle.roots(checked, ids);
    const plan = yield* lifecycle.plan(checked, roots);
    const planned = plan.rows(checked).map(row => row.id);
    const changed = yield* plan.apply();
    return { ...changed, planned };
  }));
  return { work, deleted, reads, lifecycleKeys };
}

beforeAll(async () => {
  const compiled = await Effect.runPromise(decodeCompiledDml({ tables: [{ name: "node", columns: [
    { name: "id", type: "id", primaryKey: true, nullable: false },
    { name: "parent_id", type: "id", primaryKey: false, nullable: true },
    { name: "deleted_at", type: "dateTime", primaryKey: false, nullable: true },
  ], indexes: [], checks: [], foreignKeys: [{ name: "node_parent", columns: ["parent_id"], referencedTable: "node",
    referencedColumns: ["id"], onDelete: "cascade" }], relationships: [
      { name: "parent", type: "belongsTo", targetModel: "Node", targetTable: "node", nullable: true,
        cascadeDelete: false, cascadeDetach: false, foreignKeyName: "node_parent" },
      { name: "children", type: "hasMany", targetModel: "Node", targetTable: "node", mappedBy: "parent", nullable: false,
        cascadeDelete: true, cascadeDetach: false },
    ], cascades: { delete: ["children"], detach: [] } }] }));
  const checked = compiled.tables[0];
  if (checked === undefined) throw new Error("Missing checked neutral node table");
  table = checked;
});

describe("bounded self-referencing physical lifecycle", () => {
  it("authenticates a requested parent and its historical same-table child without returning the child as a root", () => {
    const evidence = activity([parent, child], [read("id", ["a"], 1), read("parent_id", ["a"], 1),
      read("parent_id", ["b"], 0)], [child, parent]);
    expect(Result.getOrThrow(correlate(evidence, ["a"]))).toEqual(["a"]);
  });

  it("deduplicates overlapping explicit roots while authenticating the original raw selector", () => {
    const raw = ["a", "b", "missing", "a"];
    const evidence = activity([parent, child], [read("id", raw, 2), read("parent_id", ["a"], 1),
      read("parent_id", ["b"], 0)], [child, parent]);
    expect(Result.getOrThrow(correlate(evidence, raw))).toEqual(["b", "a"]);
    refused({ ...evidence, relationalReads: [read("id", ["a", "b"], 2), ...evidence.relationalReads.slice(1)] }, raw);
    refused({ ...evidence, relationalReads: [...evidence.relationalReads, read("parent_id", ["b"], 0)] }, raw);
  });

  it("authenticates eight same-table levels using the admitted row bound rather than the table count", () => {
    const chain = Array.from({ length: 8 }, (_unused, index) => node(String(index), index === 0 ? null : String(index - 1), index % 2 === 1));
    const reads = [read("id", ["0"], 1), ...chain.map((row, index) => read("parent_id", [String(row.id)], index === 7 ? 0 : 1))];
    const evidence = activity(chain, reads, [...chain].reverse());
    expect(Result.getOrThrow(correlate(evidence, ["0"]))).toEqual(["0"]);
    refused(evidence, ["0"], 7);
  });

  it("refuses omitted indexed reads, descendants, delete preimages and parent-first mutations", () => {
    const evidence = activity([parent, child], [read("id", ["a"], 1), read("parent_id", ["a"], 1),
      read("parent_id", ["b"], 0)], [child, parent]);
    for (let index = 0; index < evidence.relationalReads.length; index++)
      refused({ ...evidence, relationalReads: evidence.relationalReads.filter((_read, ordinal) => ordinal !== index) }, ["a"]);
    refused({ ...evidence, mutations: [remove(parent, 0)] }, ["a"]);
    refused({ ...evidence, observedRows: [{ table: "node", row: parent }], mutations: [remove(parent, 0)] }, ["a"]);
    refused({ ...evidence, mutations: [remove(parent, 0), remove(child, 1)] }, ["a"]);
    refused({ ...evidence, observedRows: [...evidence.observedRows, { table: "node", row: node("orphan", "outside") }] }, ["a"]);
  });

  it("refuses self-cycles and two-row cycles even with complete forged deletion evidence", () => {
    const self = node("a", "a");
    refused(activity([self], [read("id", ["a"], 1), read("parent_id", ["a"], 1)], [self]), ["a"]);
    const first = node("a", "b"), second = node("b", "a");
    refused(activity([first, second], [read("id", ["a"], 1), read("parent_id", ["a"], 1), read("parent_id", ["b"], 1)],
      [second, first]), ["a"]);
  });

  it("authenticates missing duplicate IDs and distinguishes an empty selector from a missing read", () => {
    expect(Result.getOrThrow(correlate(activity([], []), []))).toEqual([]);
    const raw = ["missing", "missing"];
    expect(Result.getOrThrow(correlate(activity([], [read("id", raw, 0)]), raw))).toEqual([]);
    refused(activity([], []), raw);
  });

  it("executes the actual planner child-first when the store deletes keys sequentially", async () => {
    const proof = executePlanner([parent, child], ["a"]), result = await Effect.runPromise(proof.work);
    expect(proof.deleted).toEqual(["b", "a"]);
    expect(result.planned).toEqual(["a", "b"]);
    expect(result.roots.map(row => row.id)).toEqual(["a"]);
    expect(result.cascades.Node?.map(row => row.id)).toEqual(["b", "a"]);
    expect(proof.reads).toEqual([read("id", ["a"], 1), read("parent_id", ["a"], 1), read("parent_id", ["b"], 0)]);
  });

  it("keeps overlapping roots and cached self-edge reads exact in the actual planner", async () => {
    const checked: Table = { ...table, foreignKeys: [...table.foreignKeys, { name: "node_parent_duplicate",
      columns: ["parent_id"], referencedTable: "node", referencedColumns: ["id"], onDelete: "cascade" }] };
    const raw = ["a", "b", "missing", "a"], proof = executePlanner([parent, child], raw, "delete", checked);
    const result = await Effect.runPromise(proof.work);
    expect(result.roots.map(row => row.id)).toEqual(["b", "a"]);
    expect(proof.reads).toEqual([read("id", raw, 2), read("parent_id", ["a"], 1), read("parent_id", ["b"], 0)]);
    expect(Result.getOrThrow(correlatePhysicalGraphReceipt({ tables: [checked], entities: [{ table: checked, maximum: 8, decodeRow }],
      root: checked, requestedIds: raw, activity: activity([parent, child], proof.reads, [child, parent]) }))).toEqual(["b", "a"]);
  });

  it.each([{ rows: [node("a", "a")] }, { rows: [node("a", "b"), node("b", "a")] }])("refuses cyclic dependency order before any mutation", async ({ rows }) => {
    const proof = executePlanner(rows, ["a"]);
    expect(await Effect.runPromise(Effect.result(proof.work))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(proof.deleted).toEqual([]);
  });

  it("retains scalar-FK-only refusal before any mutation", async () => {
    const checked: Table = { ...table, foreignKeys: [{ name: "node_parent_composite", columns: ["parent_id", "id"],
      referencedTable: "node", referencedColumns: ["id", "parent_id"], onDelete: "cascade" }] };
    const proof = executePlanner([parent, child], ["a"], "delete", checked);
    expect(await Effect.runPromise(Effect.result(proof.work))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(proof.deleted).toEqual([]);
  });

  it.each(["softDelete", "restore"] as const)("preserves existing %s discovery order", async operation => {
    const proof = executePlanner([parent, child], ["a"], operation), result = await Effect.runPromise(proof.work);
    expect(result.planned).toEqual(["a", "b"]);
    expect(proof.lifecycleKeys).toEqual(["a", "b"]);
    expect(proof.deleted).toEqual([]);
  });
});
