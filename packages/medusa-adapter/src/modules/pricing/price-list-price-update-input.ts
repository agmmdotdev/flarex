import { Result, Schema, type Effect } from "effect";
import { PricingRuleOperator } from "@medusajs/framework/utils/portable";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { ExactNumericRaw } from "../../value/exact-numeric";
import { compileWhere } from "../../query/predicate";
import { commerceRelationReadQuery } from "../../query/relations";
import { ListPriceInput, PricingId } from "./input";
import { compilePriceListPriceCreationContracts, priceListPriceCandidateWhere } from "./price-list-price-input";
import type { capturePricingMetadata } from "./schema";

const Text = Schema.String.check(Schema.isMaxLength(256));
const Finite = Schema.Number.check(Schema.isFinite());
const Numeric = Schema.Union([Schema.String, Finite]);
const Fields = { id: Schema.optionalKey(Text), currency_code: Schema.optionalKey(Text),
  amount: Schema.optionalKey(Finite), min_quantity: Schema.optionalKey(Schema.NullOr(Finite)),
  max_quantity: Schema.optionalKey(Schema.NullOr(Finite)), rules: ListPriceInput.fields.rules };
/** The corrected private callback retains the original optional-ID execution
 * contract, raw list/price order, and omitted quantity keys. */
export const PriceListPriceUpdateWorkflowInput = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Text,
  prices: Schema.Array(Schema.Struct({ ...Fields, variant_id: Text })).check(Schema.isMaxLength(2)),
})).check(Schema.isMaxLength(4)) });
export const UpdatePriceListPricesInput = Schema.Array(Schema.Struct({ price_list_id: Text,
  prices: Schema.Array(Schema.Struct({ ...Fields, price_set_id: Text })).check(Schema.isMaxLength(2)),
})).check(Schema.isMaxLength(4));
export const decodeUpdatePriceListPrices = commerceDecoder(UpdatePriceListPricesInput, "invalidInput");

const Stamps = { created_at: Schema.String, updated_at: Schema.String, deleted_at: Schema.NullOr(Schema.String) };
const SnapshotRule = Schema.Struct({ id: PricingId, price_id: PricingId, attribute: Schema.String, value: Schema.String,
  operator: Schema.Literals(Object.values(PricingRuleOperator)), priority: Finite, ...Stamps });
const SnapshotPrice = Schema.Struct({ id: PricingId, title: Schema.NullOr(Schema.String), currency_code: Schema.String,
  amount: Numeric, raw_amount: ExactNumericRaw, min_quantity: Schema.NullOr(Numeric), raw_min_quantity: Schema.NullOr(ExactNumericRaw),
  max_quantity: Schema.NullOr(Numeric), raw_max_quantity: Schema.NullOr(ExactNumericRaw), rules_count: Schema.NullOr(Finite),
  price_set_id: PricingId, price_list_id: Schema.NullOr(PricingId), ...Stamps,
  price_rules: Schema.Array(SnapshotRule).check(Schema.isMaxLength(defaultCommerceResources.queryRows)),
});
const SnapshotPrices = Schema.Array(SnapshotPrice).check(Schema.isMaxLength(defaultCommerceResources.queryRows));
const SnapshotShape = Schema.Struct({ prices: SnapshotPrices });
const CompensationShape = Schema.Struct({ before: Schema.Array(SnapshotPrice).check(Schema.isMaxLength(8)),
  createdPriceIds: Schema.Array(PricingId).check(Schema.isMaxLength(8)) });
const decodeSnapshotShape = commerceDecoder(SnapshotShape, "storedCorruption");
const decodeCompensationShape = commerceDecoder(CompensationShape, "invalidInput");
const decodeEnvelope = commerceDecoder(Schema.Struct({ where: Schema.Unknown, options: Schema.Struct({
  populate: Schema.Array(Schema.Literal("price_rules")).check(Schema.isMaxLength(1)),
  filters: Schema.optionalKey(Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Literal(true) }) })),
  orderBy: Schema.Struct({ id: Schema.Literal("ASC") }),
}) }), "unsupportedProfile");
const decodeRuleEnvelope = commerceDecoder(Schema.Struct({ where: Schema.Struct({
  price_id: Schema.Array(PricingId).check(Schema.isMaxLength(defaultCommerceResources.queryRows)),
}), options: Schema.Struct({ populate: Schema.Tuple([]),
  filters: Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Literal(true) }) }),
  orderBy: Schema.Struct({ id: Schema.Literal("ASC") }),
}) }), "unsupportedProfile");

/** Complete snapshot rows share the checked DML decoders. Typed public schemas
 * never independently grant restoration of managed fields or deleted rows. */
export function compilePriceListPriceUpdateContracts(metadata: Effect.Success<ReturnType<typeof capturePricingMetadata>>["frame"]) {
  return Result.gen(function* () {
    const base = yield* compilePriceListPriceCreationContracts(metadata);
    const logical = priceListPriceCandidateWhere.logical;
    if (logical === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const validatePrices = (rows: typeof SnapshotPrices.Type) => Result.gen(function* () {
      const ids = new Set<string>(), ruleIds = new Set<string>();
      for (const input of rows) {
        const { price_rules, ...scalar } = input;
        const row = yield* base.decodePriceRow(scalar);
        if (ids.has(row.id)) return yield* Result.fail(commerceError("storedCorruption"));
        ids.add(row.id);
        for (const inputRule of price_rules) {
          const rule = yield* base.decodePriceRuleRow(inputRule);
          if (rule.price_id !== row.id || ruleIds.has(rule.id)) return yield* Result.fail(commerceError("storedCorruption"));
          ruleIds.add(rule.id);
        }
      }
    });
    const decodeSnapshot = (input: unknown) => Result.gen(function* () {
      const value = yield* decodeSnapshotShape(input); yield* validatePrices(value.prices); return value;
    });
    const decodeCompensation = (input: unknown) => Result.gen(function* () {
      const value = yield* decodeCompensationShape(input); yield* validatePrices(value.before);
      const before = new Set(value.before.map(row => row.id)), created = new Set(value.createdPriceIds);
      if (created.size !== value.createdPriceIds.length || value.createdPriceIds.some(id => before.has(id)))
        return yield* Result.fail(commerceError("invalidInput"));
      return value;
    });
    const Snapshot = SnapshotShape.check(Schema.makeFilter(value => Result.isSuccess(validatePrices(value.prices)) || "Expected complete Price snapshots"));
    const Compensation = CompensationShape.check(Schema.makeFilter(value => Result.isSuccess(decodeCompensation(value)) || "Expected disjoint complete Price compensation"));
    const compilePriceReadPlan = (input: unknown) => Result.gen(function* () {
      const envelope = yield* captureCommerceInput(input).pipe(Result.flatMap(decodeEnvelope));
      const withDeleted = envelope.options.filters?.softDeletable.withDeleted === true;
      if (withDeleted ? envelope.options.populate.length !== 0 : envelope.options.populate.length !== 1)
        return yield* Result.fail(commerceError("unsupportedProfile"));
      const predicate = yield* compileWhere(envelope.where, { ...priceListPriceCandidateWhere,
        logical: { ...logical, nodes: 32, depth: 4 } });
      return { withDeleted, populate: !withDeleted,
        rootQuery: commerceRelationReadQuery(defaultCommerceResources, { kind: "and", children: [predicate,
          ...(withDeleted ? [] : [{ kind: "isNull", column: "deleted_at" }])] }, "id", { includeIdentities: true }),
        ruleQuery: (ids: readonly string[]) => ids.length === 0 ? undefined : commerceRelationReadQuery(defaultCommerceResources,
          { kind: "and", children: [{ kind: "in", column: "price_id", values: [...new Set(ids)] },
            ...(withDeleted ? [] : [{ kind: "isNull", column: "deleted_at" }])] },
          withDeleted ? "id" : { kind: "storageInsertion", direction: "asc" }, { includeIdentities: true }),
      };
    });
    const compileRuleReadPlan = (input: unknown) => Result.gen(function* () {
      const envelope = yield* captureCommerceInput(input).pipe(Result.flatMap(decodeRuleEnvelope));
      return commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "price_id", values: [...new Set(envelope.where.price_id)] },
        "id", { includeIdentities: true });
    });
    return { ...base, Snapshot, Compensation, decodeSnapshot, decodeCompensation, compilePriceReadPlan, compileRuleReadPlan };
  });
}
export type PriceListPriceUpdateContracts = Result.Result.Success<ReturnType<typeof compilePriceListPriceUpdateContracts>>;
