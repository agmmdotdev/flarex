import { Effect, Result, Schema } from "effect";
import { generateEntityId } from "@medusajs/framework/utils/portable";
import { prepareUpsertWithReplaceEntries, uniqueUpsertEntries, planUpsertRelationEntries, applyUpsertRelationResults } from "@medusajs/utils/dal/upsert-planning";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type JsonObject, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { assembleCommerceRelations, type CommerceRelationOrder } from "../../query/relations";
import { resolveCommerceRelationFilter } from "../../query/relation-filter";
import { projectRows } from "../../query/projection";
import { projectNativeRow } from "../../repository/result";
import { captureExactNumericRow, projectExactNumericColumns } from "../../value/exact-numeric";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { replaceGraphRows } from "../../write/replace";
import type { GraphCatalog, GraphEntity, ReplacementProfile } from "../../write/graph-model";
import { NormalizedPriceListPriceRule, EncodedPriceListPrice,
  decodeNormalizedPriceListPrice, type PriceListPriceCreationContracts } from "./price-list-price-input";

const decodeReplacement = commerceDecoder(Schema.Struct({ input: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(8)),
  config: Schema.Struct({ relations: Schema.Tuple([Schema.Literal("price_rules")]) }) }), "invalidInput");
const decodeEncoded = commerceDecoder(EncodedPriceListPrice, "invalidInput");
const decodeRule = commerceDecoder(NormalizedPriceListPriceRule, "invalidInput");
type Identity = (supplied: string | undefined, ordinal: number) => Result.Result<string, CommerceTransactionError>;

/** The same actual native batch owner stages writes and authenticates their
 * returned identities. Identity callbacks select genuine generated IDs during
 * execution or already observed IDs during receipt validation; neither changes
 * native first-write/last-relation/raw-response planning. */
export const planPriceListPriceWrite = Effect.fn("PricingLists.planPriceWrite")(function* (
  contracts: PriceListPriceCreationContracts, input: unknown, config: unknown,
  resources: CommerceCommandContext["resources"], priceIdentity: Identity, ruleIdentity: Identity,
) {
  const args = yield* Effect.fromResult(captureCommerceInput({ input, config }, resources).pipe(Result.flatMap(decodeReplacement)));
  const numeric = contracts.tables.price.columns.filter(column => column.type === "bigNumber");
  const sources: JsonObject[] = [], scalarRows = new WeakMap<JsonObject, JsonObject & { id: string }>();
  for (const [index, inputRow] of args.input.entries()) {
    const source = yield* Effect.fromResult(decodeNormalizedPriceListPrice(inputRow));
    const { price_rules: _children, ...scalar } = source;
    const encoded = yield* captureExactNumericRow(scalar, numeric);
    const entity = { ...encoded, id: yield* Effect.fromResult(priceIdentity(source.id, index)) };
    sources.push(source); scalarRows.set(source, entity);
  }
  const batch = prepareUpsertWithReplaceEntries(sources, source => {
    const entity = scalarRows.get(source);
    if (!entity) throw new Error("Missing prepared native Price scalar row");
    return { entity, relations: { price_rules: undefined } };
  });
  const unique = uniqueUpsertEntries(batch.toUpsert);
  const relationPlan = planUpsertRelationEntries(unique, batch.originalDataMap, batch.reconstructedResponse, "price_rules");
  const relationRows = new Map<string, JsonObject[]>(), relationResults: { index: number; entities: JsonObject[] | undefined }[] = [];
  let childOrdinal = 0;
  for (const relation of relationPlan) {
    const source = yield* Effect.fromResult(decodeNormalizedPriceListPrice(relation.entity));
    const children: JsonObject[] = [];
    for (const child of source.price_rules ?? []) children.push({ ...child,
      id: yield* Effect.fromResult(ruleIdentity(child.id, childOrdinal++)), price_id: relation.entity.id });
    relationRows.set(relation.entity.id, children);
    relationResults.push({ index: relation.index, entities: children.length === 0 ? undefined : children });
  }
  const requested = unique.map(row => ({ ...row, ...(relationRows.has(row.id) ? { price_rules: relationRows.get(row.id)! } : {}) }));
  return { args, batch, unique, relationRows, relationResults, requested, numeric };
});

/** The executing native service constructs the candidate selector. Shared
 * predicates execute it; no JavaScript candidate or hash replay occurs here. */
export const readPriceListPriceCandidates = Effect.fn("PricingLists.readPriceCandidates")(function* (
  ctx: CommerceCommandContext, contracts: PriceListPriceCreationContracts, input: unknown,
) {
  const plan = yield* Effect.fromResult(contracts.compileNativeCandidatePlan(input));
  const activeSetMembership = yield* resolveCommerceRelationFilter({ ...ctx,
    admitSelection: (table, rows) => Result.gen(function* () {
      if (table !== contracts.tables.set.name) return yield* Result.fail(commerceError("unsupportedProfile"));
      for (const row of rows) yield* contracts.decodeSetRow(projectNativeRow(row));
    }) }, contracts.tables.price.name, "price_set", plan.setPredicate, contracts.relations);
  const roots: (JsonObject & Readonly<{ id: string }>)[] = [];
  const store = yield* ctx.table(contracts.tables.price.name);
  for (const input of yield* store.find(ctx.manager, plan.rootQuery(activeSetMembership))) {
    const row = yield* Effect.fromResult(contracts.decodePriceRow(projectNativeRow(input)));
    if (row.deleted_at !== null) return yield* ctx.refuse(commerceError("storedCorruption"));
    roots.push(row);
  }
  const rootIds = new Set(roots.map(row => row.id)), children: JsonObject[] = [];
  const ruleQuery = plan.ruleQuery([...rootIds]);
  if (ruleQuery !== undefined) {
    const rules = yield* ctx.table(contracts.tables.rule.name);
    for (const input of yield* rules.find(ctx.manager, ruleQuery)) {
      const row = yield* Effect.fromResult(contracts.decodePriceRuleRow(projectNativeRow(input)));
      if (row.deleted_at !== null || typeof row.price_id !== "string" || !rootIds.has(row.price_id))
        return yield* ctx.refuse(commerceError("storedCorruption"));
      children.push(row);
    }
  }
  const graph = assembleCommerceRelations(contracts.tables.price.name,
    new Map([[contracts.tables.price.name, roots], [contracts.tables.rule.name, children]]), plan.paths, contracts.relations);
  const projected = yield* Effect.fromResult(projectRows(graph, plan.projection.node));
  const numeric = contracts.tables.price.columns.filter(column => column.type === "bigNumber");
  const output: JsonObject[] = [];
  for (const row of projected) {
    const value = yield* projectExactNumericColumns(row, numeric);
    if (!isJsonObject(value)) return yield* ctx.refuse(commerceError("storedCorruption"));
    output.push(value);
  }
  // normalizePrices mutates incoming native objects. Protected observations
  // and complete core rows must not alias those mutable normalization values.
  return structuredClone(output);
});

/** Actual native batch helpers retain first scalar writes, last relation input,
 * and every sparse response position. Shared graph planning never sees repeated
 * roots or obtains a waiver for its existing duplicate/owner guards. */
export function preparePriceListPriceReplacement(contracts: PriceListPriceCreationContracts) {
  return Result.gen(function* () {
    const entities: GraphEntity[] = [];
    for (const [table, model] of [[contracts.tables.set, "PriceSet"], [contracts.tables.list, "PriceList"],
      [contracts.tables.price, "Price"], [contracts.tables.rule, "PriceRule"]] as const) {
      const key = table.columns.filter(column => column.primaryKey);
      if (key.length !== 1 || key[0]?.name !== "id" || key[0].type !== "id") return yield* Result.fail(commerceError("unsupportedProfile"));
      entities.push({ table, model, keyColumn: "id", prefix: key[0].options?.prefix });
    }
    const root = entities[2], rule = entities[3];
    if (!root || !rule) return yield* Result.fail(commerceError("unsupportedProfile"));
    const numeric = contracts.tables.price.columns.filter(column => column.type === "bigNumber");
    const catalog: GraphCatalog = { entities, tables: entities.map(entity => entity.table), writablePivots: [], queryRelations: contracts.relations,
      decodeRow: (entity, input) => Result.gen(function* () {
        const supplied = entity === root ? yield* decodeEncoded(input) : entity === rule ? yield* decodeRule(input)
          : yield* Result.fail(commerceError("unsupportedProfile"));
        return { supplied, key: supplied.id };
      }), decodeReference: () => Result.fail(commerceError("unsupportedProfile")), decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")) };
    const profile: ReplacementProfile = { catalog, operation: "upsertWithReplace", existingRootWrite: "upsertOrInsert", ownedChildWrite: "upsert",
      foreignKeyVisibility: (entity, column) => entity === root && column === "price_set_id" ? "existing" : "active",
      orderedDeletionTables: [rule.table.name], ordering: new Map<string, CommerceRelationOrder>([[root.table.name, "id"], [contracts.tables.set.name, "id"],
        [contracts.tables.list.name, "id"], [rule.table.name, { kind: "storageInsertion", direction: "asc" }]]),
      allowedRelations: entity => entity === root ? ["price_rules"] : [], ownedToOne: () => [], mutableForeignKeys: () => false,
      admitSelection: (table, rows) => Result.gen(function* () {
        for (const row of rows) {
          if (table === root.table) yield* contracts.decodePriceRow(projectNativeRow(row));
          else if (table === rule.table) yield* contracts.decodePriceRuleRow(projectNativeRow(row));
          else if (table.name === contracts.tables.list.name) yield* contracts.decodeListRow(projectNativeRow(row));
          else if (table.name === contracts.tables.set.name) yield* contracts.decodeSetRow(projectNativeRow(row));
        }
      }), prepareProjection: () => Effect.void,
      toManyMode: (entity, name, child) => entity === root && name === "price_rules" && child === rule
        ? Result.succeed("replace") : Result.fail(commerceError("unsupportedProfile")),
      validateLink: () => Effect.fail(commerceError("unsupportedProfile")), projectionPaths: (entity, relations) => entity === root ? relations : [],
      project: rows => Result.succeed(new Map([...rows].map(([table, values]) =>
        [table, table === rule.table.name ? values.filter(row => row.deleted_at === null) : values]))),
    };
    const replace = Effect.fn("PricingLists.replacePrices")(function* (ctx: CommerceCommandContext, input: unknown, config: unknown) {
      const { args, batch, requested, relationResults } = yield* planPriceListPriceWrite(contracts, input, config, ctx.resources,
        supplied => Result.succeed(generateEntityId(supplied, root.prefix)), supplied => Result.succeed(generateEntityId(supplied, rule.prefix)));
      const result = yield* replaceGraphRows(ctx, profile, root, requested, args.config);
      for (const [index, value] of result.entities.entries()) {
        const supplied = requested[index];
        if (!supplied || value.id !== supplied.id) return yield* ctx.refuse(commerceError("storedCorruption"));
        const { price_rules, ...scalar } = value;
        yield* Effect.fromResult(contracts.decodePriceRow(projectNativeRow(scalar)));
        if (!Array.isArray(price_rules)) return yield* ctx.refuse(commerceError("storedCorruption"));
        for (const child of price_rules) {
          if (!isJsonObject(child)) return yield* ctx.refuse(commerceError("storedCorruption"));
          yield* Effect.fromResult(contracts.decodePriceRuleRow(projectNativeRow(child)));
        }
      }
      applyUpsertRelationResults(batch.reconstructedResponse, "price_rules", relationResults);
      const response = yield* Effect.fromResult(captureCommerceInput(batch.reconstructedResponse, ctx.resources));
      const output = yield* projectExactNumericColumns(response, numeric, "reserialize");
      return { entities: yield* Effect.fromResult(contracts.decodeOutput(output)),
        performedActions: yield* Effect.fromResult(contracts.decodeActions(result.performedActions)) };
    });
    return { root, rule, profile, replace };
  });
}
