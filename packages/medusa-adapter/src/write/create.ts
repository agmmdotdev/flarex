import { Effect, Schema } from "effect";
import { generateEntityId } from "@medusajs/framework/utils/portable";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, defaultCommerceResources, type CommerceResources, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "../commerce-input";
import { commerceDecoder } from "../commerce-decoder";
import type { CreatedGraph, CreationNode, CreationProfile, GraphCatalog, GraphRows } from "./graph-model";

const decodeGraphArray = commerceDecoder(Schema.Array(Schema.Json), "invalidInput");

/** Traverse the module's declared steps in order. Each root owns its reference
 * snapshots; duplicate identities and the row budget cover the entire graph. */
export const captureGraph = Effect.fn("MedusaGraph.capture")(function* (
  profile: CreationProfile, input: unknown, resources: CommerceResources = defaultCommerceResources,
) {
  const captured = yield* Effect.fromResult(captureCommerceInput(input, resources));
  const inputs = yield* Effect.fromResult(decodeGraphArray(captured));
  const rows = new Map<string, JsonObject[]>(profile.catalog.entities.map(entity => [entity.table.name, []]));
  for (const table of profile.catalog.writablePivots) rows.set(table.name, []);
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
    const row: JsonObject = { ...Object.fromEntries(Object.entries(supplied).filter(([name]) => !node.omitRelations.includes(name))), ...extra, [node.entity.keyColumn]: key };
    rows.get(node.entity.table.name)?.push(row);
    scope.set(token, supplied);
    for (const step of node.steps) {
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
          rows.get(link.table)?.push(link.link(key, reference.key));
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
  return { roots, rows } satisfies CreatedGraph;
});

/** The checked catalog supplies insertion order. The caller retains the sole
 * transaction manager; only rows actually returned by writes leave this step. */
export const insertGraphRows = Effect.fn("MedusaGraph.insert")(function* (
  ctx: Pick<CommerceCommandContext, "manager" | "table">, catalog: GraphCatalog, graph: GraphRows,
) {
  const inserted = new Map<string, readonly JsonObject[]>();
  for (const table of [...catalog.entities.map(item => item.table.name), ...catalog.writablePivots.map(item => item.name)]) {
    const rows = graph.get(table) ?? [];
    if (rows.length === 0) { inserted.set(table, []); continue; }
    const store = yield* ctx.table(table);
    inserted.set(table, yield* store.write(ctx.manager, "insert", rows));
  }
  return inserted;
});
