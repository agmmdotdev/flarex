import { Effect, Schema } from "effect";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceDecoder } from "./commerce-decoder";
import { currencyAnnouncementWrite, currencyCommands } from "./currency-service";
import { makeLocalProductCommands } from "./product-service";

const decode = commerceDecoder(Schema.Struct({
  categoryPrefix: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,39}$/)),
  currency: Schema.Struct({ code: Schema.String, name: Schema.String, symbol: Schema.String,
    symbol_native: Schema.String, decimal_digits: Schema.Int, rounding: Schema.Number }),
}), "invalidInput");

/** Private database conformance command, not a Medusa core workflow. Internal
 * Category and Currency service calls intentionally have no event aggregator. */
export const makeCategoryCurrencyAtomicCommand = Effect.fn("CommerceAdapter.categoryCurrencyCommand")(function* () {
  const product = yield* makeLocalProductCommands();
  const productParticipant = defineAtomicCommerceParticipant("product");
  const currencyParticipant = defineAtomicCommerceParticipant("currency");
  const command = defineAtomicCommerceCommand("createCategoryWithCurrency", Effect.fn("CommerceAdapter.createCategoryWithCurrency")(function* (ctx, input) {
    const args = yield* Effect.fromResult(decode(input));
    const parentId = `${args.categoryPrefix}-parent`;
    const childId = `${args.categoryPrefix}-child`;
    const parent = yield* ctx.call(productParticipant, product.commands.internalCategoryCreate, [{ id: parentId, name: parentId, handle: parentId }]);
    const currency = yield* ctx.call(currencyParticipant, currencyAnnouncementWrite, args.currency);
    const child = yield* ctx.call(productParticipant, product.commands.internalCategoryCreate, [{ id: childId, name: childId, handle: childId, parent_category_id: parentId }]);
    const tree = yield* ctx.call(productParticipant, product.commands.internalCategoryRetrieve, { id: parentId, config: { relations: ["category_children"] } });
    const counted = yield* ctx.call(productParticipant, product.commands.internalCategoryCount, { filters: { parent_category_id: parentId } });
    const reread = yield* ctx.call(currencyParticipant, currencyCommands.retrieve, { code: args.currency.code });
    return { parent, child, currency, tree, counted, reread };
  }));
  return { command, productParticipant, currencyParticipant,
    productCommands: [product.commands.internalCategoryCreate, product.commands.internalCategoryRetrieve, product.commands.internalCategoryCount],
    currencyCommands: [currencyAnnouncementWrite, currencyCommands.retrieve] };
});
