import { Effect, Result, Schema } from "effect";
import { generateEntityId } from "@medusajs/framework/utils/portable";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, defaultCommerceResources, type CommerceResources, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "../value/input";
import { commerceDecoder } from "../value/decoder";
import { GraphInsertion, type CreatedGraph, type CreationNode, type CreationProfile, type GraphCatalog, type GraphRows } from "./graph-model";

const decodeGraphArray = commerceDecoder(Schema.Array(Schema.Json), "invalidInput");
const decodeOwnedToOne = commerceDecoder(Schema.Union([Schema.String, Schema.JsonObject, Schema.Null]), "invalidInput");
const decodeInsertionOrder = commerceDecoder(Schema.Array(GraphInsertion), "invalidInput");

/** Traverse the module's declared steps in order. Each root owns its reference
 * snapshots; duplicate identities and the row budget cover the entire graph. */
export const captureGraph = Effect.fn("MedusaGraph.capture")(function* (
  profile: CreationProfile, input: unknown, resources: CommerceResources = defaultCommerceResources,
) {
  const captured = yield* Effect.fromResult(captureCommerceInput(input, resources));
  const inputs = yield* Effect.fromResult(decodeGraphArray(captured));
  const rows = new Map<string, JsonObject[]>(profile.catalog.entities.map(entity => [entity.table.name, []]));
  for (const table of profile.catalog.writablePivots) rows.set(table.name, []);
  const insertionOrder: GraphInsertion[] = [];
  const append = (table: string, row: JsonObject) => {
    const group = rows.get(table);
    if (group === undefined) return Result.fail(commerceError("unsupportedProfile"));
    insertionOrder.push({ table, rowIndex: group.length });
    group.push(row);
    return Result.succeed(undefined);
  };
  const ids = new Set<string>();
  const roots: string[] = [];
  const add = Effect.fn("MedusaGraph.captureNode")(function* (
    node: CreationNode, inputRow: Json, extra: JsonObject, scope: Map<string, JsonObject>,
  ): Effect.fn.Return<string, CommerceTransactionError> {
    const { supplied, key: suppliedKey } = yield* Effect.fromResult(profile.catalog.decodeRow(node.entity, inputRow));
    if (Object.keys(extra).some(name => supplied[name] !== undefined && supplied[name] !== extra[name])) return yield* Effect.fail(commerceError("invalidInput"));
    const key = generateEntityId(suppliedKey, node.entity.prefix);
    const token = node.entity.table.name + ":" + key;
    if (ids.has(token)) return yield* Effect.fail(commerceError("invalidInput"));
    ids.add(token);
    const row: Record<string, Json> = { ...Object.fromEntries(Object.entries(supplied).filter(([name]) => !node.omitRelations.includes(name))), ...extra, [node.entity.keyColumn]: key };
    // Native create resolves owned to-one values before inserting the owner.
    // The already normalized relation value takes precedence over its FK.
    for (const step of node.steps) if (step.kind === "ownedToOne" && supplied[step.name] !== undefined) {
      const target = yield* Effect.fromResult(decodeOwnedToOne(supplied[step.name]));
      if (target === null) row[step.foreignKey] = null;
      else if (typeof target === "string")
        row[step.foreignKey] = (yield* Effect.fromResult(profile.catalog.decodeReference(step.node.entity, target))).key;
      else row[step.foreignKey] = yield* add(step.node, target, {}, scope);
    }
    yield* Effect.fromResult(append(node.entity.table.name, row));
    scope.set(token, supplied);
    for (const step of node.steps) {
      if (step.kind === "ownedToOne") continue;
      if (step.kind === "children") {
        const members = yield* Effect.fromResult(decodeGraphArray(supplied[step.name] ?? []));
        for (const member of members) yield* add(step.node, member, { [step.foreignKey]: key }, scope);
      } else {
        const link = yield* Effect.fromResult(step.resolve());
        const members = yield* Effect.fromResult(decodeGraphArray(supplied[step.name] ?? []));
        const linked = new Set<string>();
        for (const member of members) {
          const reference = yield* Effect.fromResult(step.decode(member));
          if (linked.has(reference.key)) return yield* Effect.fail(commerceError("invalidInput"));
          if (step.membership === "declaredSnapshot") {
            const declared = scope.get(step.target.table.name + ":" + reference.key);
            if (declared === undefined || JSON.stringify(declared) !== JSON.stringify(reference.supplied)) return yield* Effect.fail(commerceError("invalidInput"));
          }
          linked.add(reference.key);
          yield* Effect.fromResult(append(link.table, link.link(key, reference.key)));
        }
      }
    }
    return key;
  });
  for (const inputRow of inputs) roots.push(yield* add(profile.root, inputRow, {}, new Map()));
  const graphRows = [...rows.values()].reduce((sum, group) => sum + group.length, 0);
  if (graphRows > resources.facts) return yield* Effect.fail(commerceError("limitExceeded", profile.rowLimitDetail(
    resources.facts, graphRows, Object.fromEntries([...rows].map(([table, group]) => [table, group.length])),
  )));
  return { roots, rows, insertionOrder } satisfies CreatedGraph;
});

/** Selected traversal coordinates preserve native graph phases. Other profiles
 * retain catalog order. Both selections use one executor and actual receipts. */
export const insertGraphRows = Effect.fn("MedusaGraph.insert")(function* (
  ctx: Pick<CommerceCommandContext, "manager" | "table">, catalog: GraphCatalog, graph: GraphRows,
  options: { readonly allowReconstitution?: true; readonly insertionOrder?: readonly GraphInsertion[] } = {},
) {
  const tables = [...catalog.entities.map(item => item.table.name), ...catalog.writablePivots.map(item => item.name)];
  const segments: Array<Readonly<{ table: string; rows: readonly JsonObject[] }>> = [];
  if (options.insertionOrder === undefined) {
    for (const table of tables) {
      const rows = graph.get(table) ?? [];
      if (rows.length) segments.push({ table, rows });
    }
  } else {
    const order = yield* Effect.fromResult(decodeInsertionOrder(options.insertionOrder));
    const writable = new Set(tables);
    if (writable.size !== tables.length || [...graph.keys()].some(table => !writable.has(table)) ||
      order.length !== [...graph.values()].reduce((count, rows) => count + rows.length, 0))
      return yield* Effect.fail(commerceError("invalidInput"));
    const selected = new Map<string, Set<number>>();
    let segment: { table: string; rows: JsonObject[] } | undefined;
    for (const { table, rowIndex } of order) {
      const row = graph.get(table)?.[rowIndex], previous = selected.get(table) ?? new Set<number>();
      if (!writable.has(table) || row === undefined || previous.has(rowIndex))
        return yield* Effect.fail(commerceError("invalidInput"));
      previous.add(rowIndex); selected.set(table, previous);
      if (segment?.table !== table) { segment = { table, rows: [] }; segments.push(segment); }
      segment.rows.push(row);
    }
  }
  const inserted = new Map<string, readonly JsonObject[]>(tables.map(table => [table, []]));
  const stores = new Map<string, Effect.Success<ReturnType<typeof ctx.table>>>();
  for (const { table, rows } of segments) {
    let store = stores.get(table);
    if (store === undefined) { store = yield* ctx.table(table); stores.set(table, store); }
    const restored: JsonObject[] = [];
    let start = 0;
    while (start < rows.length) {
      const reconstitute = options.allowReconstitution === true && rows[start]?.created_at !== undefined;
      let end = start + 1;
      while (end < rows.length && (options.allowReconstitution === true && rows[end]?.created_at !== undefined) === reconstitute) end++;
      const cohort = rows.slice(start, end);
      // Complete retained rows still require the core's exact same-root deletion
      // proof. Keep mixed cohorts in native order and preserve ordinary inserts.
      if (reconstitute) {
        const restore = store.reconstitute;
        if (restore === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
        restored.push(...(yield* restore(ctx.manager, cohort)));
      } else restored.push(...(yield* store.write(ctx.manager, "insert", cohort)));
      start = end;
    }
    inserted.set(table, [...(inserted.get(table) ?? []), ...restored]);
  }
  return inserted;
});
