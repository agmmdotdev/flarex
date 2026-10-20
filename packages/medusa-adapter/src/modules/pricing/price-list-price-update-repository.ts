import { Effect, Result, Schema } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { assembleCommerceRelations } from "../../query/relations";
import { projectNativeRow } from "../../repository/result";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { ExactNumericRaw, projectExactNumericColumns } from "../../value/exact-numeric";
import { replaceGraphRows } from "../../write/replace";
import type { GraphCatalog, ReplacementProfile } from "../../write/graph-model";
import { jsonEqual } from "flarex-protocol/json";
import { preparePriceListPriceReplacement } from "./price-list-price-repository";
import type { PriceListPriceUpdateContracts } from "./price-list-price-update-input";

const decodeReplayEnvelope = commerceDecoder(Schema.Struct({ input: Schema.Array(Schema.JsonObject)
  .check(Schema.isMaxLength(8)), config: Schema.Struct({ relations: Schema.Tuple([Schema.Literal("price_rules")]) }) }), "invalidInput");
const decodeRaw = commerceDecoder(ExactNumericRaw, "invalidInput");
const decodeObject = commerceDecoder(Schema.JsonObject, "invalidInput");

/** Native compensation replaces the numeric getter values with their exact raw
 * companions. Narrow that native representation before the core history proof;
 * no public numeric round trip or caller-authored timestamp normalization. */
export const capturePriceListPriceReplay = Effect.fn("PricingLists.capturePriceReplay")(function* (
  contracts: PriceListPriceUpdateContracts, input: unknown, config: unknown,
) {
  const envelope = yield* Effect.fromResult(captureCommerceInput({ input, config }).pipe(Result.flatMap(decodeReplayEnvelope)));
  const prices: JsonObject[] = [];
  for (const value of envelope.input) {
    const scalar: Record<string, Json> = { ...value };
    for (const column of contracts.tables.price.columns.filter(column => column.type === "bigNumber")) {
      const companion = scalar["raw_" + column.name];
      if (scalar[column.name] === null && companion === null && column.nullable) continue;
      const raw = yield* Effect.fromResult(decodeRaw(scalar[column.name]));
      if (!jsonEqual(raw, companion ?? null)) return yield* Effect.fail(commerceError("invalidInput"));
      scalar[column.name] = raw.value;
    }
    prices.push(scalar);
  }
  const snapshot = yield* Effect.fromResult(contracts.decodeSnapshot({ prices }));
  return { prices: snapshot.prices, config: envelope.config };
});

export function preparePriceListPriceReplay(contracts: PriceListPriceUpdateContracts) {
  return Result.gen(function* () {
    const base = yield* preparePriceListPriceReplacement(contracts, "update");
    const catalog: GraphCatalog = { ...base.profile.catalog, decodeRow: (entity, input) => Result.gen(function* () {
      if (entity === base.root) {
        const row = yield* decodeObject(input);
        const { price_rules, ...scalar } = row;
        if (!Array.isArray(price_rules)) return yield* Result.fail(commerceError("invalidInput"));
        const complete = yield* contracts.decodePriceRow(scalar);
        return { supplied: { ...complete, price_rules }, key: complete.id };
      }
      if (entity === base.rule) {
        const complete = yield* contracts.decodePriceRuleRow(input); return { supplied: complete, key: complete.id };
      }
      return yield* Result.fail(commerceError("unsupportedProfile"));
    }) };
    const { existingRootWrite: _rootWrite, ownedChildWrite: _childWrite, preserveExistingManagedFields: _managedFields, ...defaultProfile } = base.profile;
    const profile: ReplacementProfile = { ...defaultProfile, catalog, recordedRowReplay: true,
      mutableForeignKeys: () => true, foreignKeyVisibility: () => "existing", project: rows => Result.succeed(rows) };
    const replay = Effect.fn("PricingLists.replayPriceGraphs")(function* (ctx: CommerceCommandContext, input: unknown, config: unknown) {
      const captured = yield* capturePriceListPriceReplay(contracts, input, config);
      const result = yield* replaceGraphRows(ctx, profile, base.root, captured.prices, captured.config);
      return { entities: result.entities, performedActions: yield* Effect.fromResult(contracts.decodeActions(result.performedActions)) };
    });
    return { ...base, profile, replay };
  });
}

/** Native snapshot and forward selectors use the same checked predicate owner;
 * their explicit withDeleted/population choices remain distinct. */
export const readPriceListPriceUpdateRows = Effect.fn("PricingLists.readPriceUpdateRows")(function* (
  ctx: CommerceCommandContext, contracts: PriceListPriceUpdateContracts, input: unknown,
) {
  const plan = yield* Effect.fromResult(contracts.compilePriceReadPlan(input));
  const store = yield* ctx.table(contracts.tables.price.name), roots: (JsonObject & Readonly<{ id: string }>)[] = [];
  for (const value of yield* store.find(ctx.manager, plan.rootQuery)) {
    const row = yield* Effect.fromResult(contracts.decodePriceRow(projectNativeRow(value)));
    if (!plan.withDeleted && row.deleted_at !== null) return yield* ctx.refuse(commerceError("storedCorruption"));
    roots.push(row);
  }
  const numeric = contracts.tables.price.columns.filter(column => column.type === "bigNumber");
  let graph: JsonObject[] = roots;
  if (plan.populate) {
    const children: JsonObject[] = [], rootIds = new Set(roots.map(row => row.id));
    const query = plan.ruleQuery([...rootIds]);
    if (query !== undefined) {
      const rules = yield* ctx.table(contracts.tables.rule.name);
      for (const value of yield* rules.find(ctx.manager, query)) {
        const row = yield* Effect.fromResult(contracts.decodePriceRuleRow(projectNativeRow(value)));
        if (typeof row.price_id !== "string" || !rootIds.has(row.price_id) || !plan.withDeleted && row.deleted_at !== null)
          return yield* ctx.refuse(commerceError("storedCorruption"));
        children.push(row);
      }
    }
    graph = assembleCommerceRelations(contracts.tables.price.name,
      new Map([[contracts.tables.price.name, roots], [contracts.tables.rule.name, children]]), ["price_rules"], contracts.relations);
  }
  const projected = yield* projectExactNumericColumns(graph, numeric);
  if (!Array.isArray(projected)) return yield* ctx.refuse(commerceError("storedCorruption"));
  return structuredClone(projected);
});

export const readPriceListPriceSnapshotRules = Effect.fn("PricingLists.readPriceSnapshotRules")(function* (
  ctx: CommerceCommandContext, contracts: PriceListPriceUpdateContracts, input: unknown,
) {
  const query = yield* Effect.fromResult(contracts.compileRuleReadPlan(input));
  const store = yield* ctx.table(contracts.tables.rule.name), rows: JsonObject[] = [];
  for (const value of yield* store.find(ctx.manager, query)) rows.push(
    yield* Effect.fromResult(contracts.decodePriceRuleRow(projectNativeRow(value))));
  return rows;
});
