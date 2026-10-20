import { Effect, Result, Schema } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { projectNativeRow } from "../../repository/result";
import { assembleCommerceRelations, type CommerceRelationOrder } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { replaceGraphRows } from "../../write/replace";
import type { GraphCatalog, GraphEntity, ReplacementProfile } from "../../write/graph-model";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { NormalizedPriceListUpdate, NormalizedPriceListUpdateRule, type PriceListUpdateContracts } from "./list-update-input";

const decodeReplacement = commerceDecoder(Schema.Struct({ input: Schema.Array(NormalizedPriceListUpdate).check(Schema.isMaxLength(4)),
  config: Schema.Struct({ relations: Schema.Tuple([Schema.Literal("price_list_rules")]) }) }), "unsupportedProfile");
const decodeRoot = commerceDecoder(NormalizedPriceListUpdate, "unsupportedProfile");
const decodeRule = commerceDecoder(NormalizedPriceListUpdateRule, "unsupportedProfile");

/** Native validation and retained snapshots share one checked read plan. The
 * complete selected DML rows are validated before any native projection. */
export const readPriceListUpdateRows = Effect.fn("PricingLists.readForUpdate")(function* (
  ctx: CommerceCommandContext, contracts: PriceListUpdateContracts, input: unknown,
) {
  const plan = yield* Effect.fromResult(contracts.compileNativeReadPlan(input));
  const store = yield* ctx.table(contracts.tables.list.name);
  const roots: (JsonObject & Readonly<{ id: string }>)[] = [];
  for (const value of yield* store.find(ctx.manager, plan.rootQuery)) {
    const row = yield* Effect.fromResult(contracts.decodeListRow(projectNativeRow(value)));
    if (row.deleted_at !== null) return yield* Effect.fail(commerceError("storedCorruption"));
    roots.push(row);
  }
  if (roots.length > 4) return yield* Effect.fail(commerceError("storedCorruption"));
  const rootIds = new Set(roots.map(row => row.id));
  const ruleQuery = plan.ruleQuery([...rootIds]), rules: JsonObject[] = [];
  if (ruleQuery !== undefined) {
    const child = yield* ctx.table(contracts.tables.listRule.name);
    for (const value of yield* child.find(ctx.manager, ruleQuery)) {
      const row = yield* Effect.fromResult(contracts.decodeListRuleRow(projectNativeRow(value)));
      if (typeof row.price_list_id !== "string" || !rootIds.has(row.price_list_id) || row.deleted_at !== null)
        return yield* Effect.fail(commerceError("storedCorruption"));
      rules.push(row);
    }
  }
  const graph = assembleCommerceRelations(contracts.tables.list.name, new Map([
    [contracts.tables.list.name, roots], [contracts.tables.listRule.name, rules],
  ]), plan.paths, contracts.relations);
  const projected = yield* Effect.fromResult(projectRows(graph, plan.projection.node));
  const output = yield* Effect.fromResult(contracts.decodeReadOutput(projected));
  // The native update method later mutates supplied objects. Its detached
  // values must not alias protected core observations.
  return structuredClone(output);
});

/** Only the original module's normalized List/Rule replacement enters this
 * finite graph. Its existing-root upsert preserves native managed stamps;
 * the shared graph owner still proves active roots and owns every write. */
export function preparePriceListUpdateReplacement(contracts: PriceListUpdateContracts) {
  return Result.gen(function* () {
    const entities: GraphEntity[] = [];
    for (const [table, model] of [[contracts.tables.list, "PriceList"], [contracts.tables.listRule, "PriceListRule"]] as const) {
      const key = table.columns.filter(column => column.primaryKey);
      if (key.length !== 1 || key[0]?.name !== "id" || key[0].type !== "id") return yield* Result.fail(commerceError("unsupportedProfile"));
      entities.push({ table, model, keyColumn: "id", prefix: key[0].options?.prefix });
    }
    const root = entities[0], rule = entities[1];
    if (!root || !rule) return yield* Result.fail(commerceError("unsupportedProfile"));
    const catalog: GraphCatalog = { entities, tables: entities.map(entity => entity.table), writablePivots: [],
      queryRelations: contracts.relations,
      decodeRow: (entity, input) => Result.gen(function* () {
        const supplied = entity === root ? yield* decodeRoot(input) : entity === rule ? yield* decodeRule(input)
          : yield* Result.fail(commerceError("unsupportedProfile"));
        return { supplied, key: "id" in supplied && typeof supplied.id === "string" ? supplied.id : undefined };
      }),
      decodeReference: () => Result.fail(commerceError("unsupportedProfile")),
      decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")),
    };
    const profile: ReplacementProfile = { catalog, operation: "upsertWithReplace", existingRootWrite: "upsert",
      orderedDeletionTables: [rule.table.name], ordering: new Map<string, CommerceRelationOrder>([[root.table.name, "id"],
        [rule.table.name, { kind: "storageInsertion", direction: "asc" }]]),
      allowedRelations: entity => entity === root ? ["price_list_rules"] : [], ownedToOne: () => [], mutableForeignKeys: () => false,
      admitSelection: (table, rows) => Result.gen(function* () {
        const decode = table === root.table ? contracts.decodeListRow : table === rule.table ? contracts.decodeListRuleRow : undefined;
        if (!decode) return yield* Result.fail(commerceError("unsupportedProfile"));
        for (const row of rows) yield* decode(projectNativeRow(row));
      }),
      prepareProjection: () => Effect.void,
      toManyMode: (entity, name, child) => entity === root && name === "price_list_rules" && child === rule
        ? Result.succeed("replace") : Result.fail(commerceError("unsupportedProfile")),
      validateLink: () => Effect.fail(commerceError("unsupportedProfile")),
      projectionPaths: (entity, relations) => entity === root ? relations : [],
      // Native populated reads present active Rules. The replacement mutation
      // above still owns every omitted historical member.
      project: rows => Result.succeed(new Map([...rows].map(([table, values]) =>
        [table, table === rule.table.name ? values.filter(row => row.deleted_at === null) : values]))),
    };
    const replace = Effect.fn("PricingLists.replaceForUpdate")(function* (ctx: CommerceCommandContext, input: unknown, config: unknown) {
      const args = yield* Effect.fromResult(captureCommerceInput({ input, config }, ctx.resources).pipe(Result.flatMap(decodeReplacement)));
      const result = yield* replaceGraphRows(ctx, profile, root, args.input, args.config);
      const output: JsonObject[] = [];
      for (const [index, value] of result.entities.entries()) {
        const supplied = args.input[index];
        if (!supplied || value.id !== supplied.id) return yield* Effect.fail(commerceError("storedCorruption"));
        const { price_list_rules, ...scalar } = value;
        const stored = yield* Effect.fromResult(contracts.decodeListRow(projectNativeRow(scalar)));
        const sparse: Record<string, Json> = { id: stored.id };
        for (const [name, inputValue] of Object.entries(supplied)) {
          if (name === "id" || name === "price_list_rules") continue;
          const selected = stored[name];
          if (selected === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
          // Original updatePriceLists_ retains its normalized string date in
          // the sparse result, while core owns the canonical stored value.
          sparse[name] = (name === "starts_at" || name === "ends_at") && typeof inputValue === "string" ? inputValue : selected;
        }
        if (supplied.price_list_rules !== undefined) {
          if (!Array.isArray(price_list_rules)) return yield* Effect.fail(commerceError("storedCorruption"));
          const rules: JsonObject[] = [];
          for (const child of price_list_rules) {
            if (!isJsonObject(child)) return yield* Effect.fail(commerceError("storedCorruption"));
            const row = yield* Effect.fromResult(contracts.decodeListRuleRow(projectNativeRow(child)));
            if (typeof row.attribute !== "string" || row.value === undefined || row.price_list_id !== stored.id)
              return yield* Effect.fail(commerceError("storedCorruption"));
            rules.push({ id: row.id, attribute: row.attribute, value: row.value, price_list_id: stored.id });
          }
          sparse.price_list_rules = rules;
        }
        output.push(sparse);
      }
      return { entities: yield* Effect.fromResult(contracts.decodeUpdateOutput(output)),
        performedActions: yield* Effect.fromResult(contracts.decodeActions(result.performedActions)) };
    });
    return { profile, root, rule, replace };
  });
}
