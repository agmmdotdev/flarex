import { Result, Schema, type Effect } from "effect";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";
import { ExactNumericRaw } from "../../value/exact-numeric";
import { ListPriceInput, PriceListInput, PricingId } from "./input";
import type { capturePricingMetadata } from "./schema";

const Text = Schema.String.check(Schema.isMaxLength(256));
const Quantity = Schema.optionalKey(Schema.NullOr(Schema.Number.check(Schema.isFinite())));
/** The native workflow declares variant IDs and numeric prices; its module
 * command instead receives resolved PriceSet IDs and admits module fields. */
export const PriceListWorkflowInput = Schema.Struct({ price_lists_data: Schema.Array(Schema.Struct({
  title: PriceListInput.fields.title, description: PriceListInput.fields.description,
  status: PriceListInput.fields.status, starts_at: PriceListInput.fields.starts_at, ends_at: PriceListInput.fields.ends_at,
  rules: PriceListInput.fields.rules,
  prices: Schema.optionalKey(Schema.Array(Schema.Struct({ variant_id: Text,
    currency_code: ListPriceInput.fields.currency_code, amount: Schema.Number.check(Schema.isFinite()),
    min_quantity: Quantity, max_quantity: Quantity, rules: ListPriceInput.fields.rules,
  })).check(Schema.isMaxLength(2))),
})).check(Schema.isMaxLength(4)) });

export const PriceListDeletionIds = Schema.Array(Text).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodePriceListDeletionIds = commerceDecoder(PriceListDeletionIds, "invalidInput");
export const decodePriceListDeletionArguments = commerceDecoder(Schema.Tuple([PriceListDeletionIds]), "invalidInput");
export const decodePriceListPhysicalSelection = commerceDecoder(Schema.Struct({
  $or: Schema.Array(Schema.Struct({ id: Text })).check(Schema.isMaxLength(4)),
}), "unsupportedProfile");

const Numeric = Schema.Union([Schema.String, Schema.Number.check(Schema.isFinite())]);
export const NormalizedListPriceRule = Schema.Struct({ id: Schema.optionalKey(PricingId),
  attribute: Text, value: Text, priority: Schema.optionalKey(Schema.Literals([0, 1])),
  operator: Schema.optionalKey(Schema.Literal("eq")),
});
export const NormalizedListPrice = Schema.Struct({ id: Schema.optionalKey(PricingId),
  title: Schema.optionalKey(Schema.NullOr(Schema.String)), price_set_id: PricingId,
  price_list_id: Schema.optionalKey(PricingId), currency_code: Text, amount: Numeric,
  min_quantity: Schema.optionalKey(Schema.NullOr(Numeric)), max_quantity: Schema.optionalKey(Schema.NullOr(Numeric)),
  rules_count: Schema.optionalKey(Schema.Literals([0, 1, 2])),
  price_rules: Schema.optionalKey(Schema.Array(NormalizedListPriceRule).check(Schema.isMaxLength(2))),
});
export const NormalizedPriceListRule = Schema.Struct({ id: Schema.optionalKey(PricingId),
  attribute: Text, value: Schema.Array(Text).check(Schema.isMaxLength(2)),
});
export const NormalizedPriceList = Schema.Struct({ id: Schema.optionalKey(PricingId),
  title: PriceListInput.fields.title, description: PriceListInput.fields.description,
  status: PriceListInput.fields.status, type: PriceListInput.fields.type,
  starts_at: PriceListInput.fields.starts_at, ends_at: PriceListInput.fields.ends_at,
  rules_count: Schema.optionalKey(Schema.Literals([0, 1, 2])),
  prices: Schema.optionalKey(Schema.Array(NormalizedListPrice).check(Schema.isMaxLength(2))),
  price_list_rules: Schema.optionalKey(Schema.Array(NormalizedPriceListRule).check(Schema.isMaxLength(2))),
});

const decodeId = commerceDecoder(PricingId, "storedCorruption");
const decodeLists = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");
const decodeChildren = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(2)), "storedCorruption");
const decodeRaw = commerceDecoder(ExactNumericRaw, "storedCorruption");
type IdentifiedPricingRow = JsonObject & Readonly<{ id: string }>;
type CreatedListPrice = IdentifiedPricingRow & Readonly<{ price_rules: IdentifiedPricingRow[] }>;
type CreatedPriceList = IdentifiedPricingRow & Readonly<{
  prices: CreatedListPrice[]; price_list_rules: IdentifiedPricingRow[];
}>;

/** One checked DML owner for complete native creation DTOs and receipts. The
 * native service retains normalization, defaults, hashing and rule ordering. */
export function compilePriceListCreationContracts(metadata: Effect.Success<ReturnType<typeof capturePricingMetadata>>["frame"]) {
  return Result.gen(function* () {
    const list = metadata.tables.find(table => table.name === "price_list"), price = metadata.tables.find(table => table.name === "price"),
      listRule = metadata.tables.find(table => table.name === "price_list_rule"), rule = metadata.tables.find(table => table.name === "price_rule");
    if (!list || !price || !listRule || !rule) return yield* Result.fail(commerceError("unsupportedProfile"));
    const listRow = yield* compileCompleteRow(list), priceRow = yield* compileCompleteRow(price),
      listRuleRow = yield* compileCompleteRow(listRule), ruleRow = yield* compileCompleteRow(rule);
    const identify = (row: JsonObject) => decodeId(row.id).pipe(Result.map(id => {
      const identified: IdentifiedPricingRow = { ...row, id }; return identified;
    }));
    const decodeListRow = (input: unknown) => listRow(input).pipe(Result.flatMap(identify));
    const decodePriceRow = (input: unknown) => priceRow(input).pipe(Result.flatMap(identify));
    const decodeListRuleRow = (input: unknown) => listRuleRow(input).pipe(Result.flatMap(identify));
    const decodePriceRuleRow = (input: unknown) => ruleRow(input).pipe(Result.flatMap(identify));
    const decodeOutput = (input: unknown) => Result.gen(function* () {
      const output: CreatedPriceList[] = [];
      for (const root of yield* decodeLists(input)) {
        const { prices: priceInput, price_list_rules: listRuleInput, ...scalar } = root;
        const row = yield* decodeListRow(scalar), prices: CreatedListPrice[] = [], price_list_rules: IdentifiedPricingRow[] = [];
        for (const input of yield* decodeChildren(priceInput)) {
          const { price_rules: ruleInput, ...scalar } = input;
          const child = yield* decodePriceRow(scalar), price_rules: IdentifiedPricingRow[] = [];
          if (child.price_list_id !== row.id) return yield* Result.fail(commerceError("storedCorruption"));
          for (const column of price.columns.filter(column => column.type === "bigNumber")) {
            if (child[column.name] === null && child["raw_" + column.name] === null && column.nullable) continue;
            yield* decodeRaw(child["raw_" + column.name]);
          }
          for (const input of yield* decodeChildren(ruleInput)) {
            const rule = yield* decodePriceRuleRow(input);
            if (rule.price_id !== child.id) return yield* Result.fail(commerceError("storedCorruption"));
            price_rules.push(rule);
          }
          if (child.rules_count !== price_rules.length) return yield* Result.fail(commerceError("storedCorruption"));
          prices.push({ ...child, price_rules });
        }
        for (const input of yield* decodeChildren(listRuleInput)) {
          const rule = yield* decodeListRuleRow(input);
          if (rule.price_list_id !== row.id) return yield* Result.fail(commerceError("storedCorruption"));
          price_list_rules.push(rule);
        }
        if (row.rules_count !== price_list_rules.length) return yield* Result.fail(commerceError("storedCorruption"));
        output.push({ ...row, prices, price_list_rules });
      }
      return output;
    });
    const Output = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: PricingId }),
      [Schema.Record(Schema.String, Schema.Json)])).check(Schema.makeFilter(rows =>
      Result.isSuccess(decodeOutput(rows)) || "Expected complete native PriceList creation graphs"));
    return { tables: { list, price, listRule, rule }, decodeListRow, decodePriceRow, decodeListRuleRow, decodePriceRuleRow,
      decodeOutput, Output };
  });
}
