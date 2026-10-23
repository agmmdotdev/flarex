import { Effect } from "effect";
import { orderModuleModels } from "@medusajs/order/static-manifest";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { capturePrivateCanonicalValue, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { decodeCompiledDml } from "../../schema/compiled";
import { lowerDmlSchema } from "../../schema/lower";

/** Preserve the complete native model closure and serial identity metadata.
 * Capturing it grants no Order, Return, Claim or Exchange operation authority. */
export const captureOrderMetadata = Effect.fn("Order.captureMetadata")(function* () {
  const source = yield* Effect.try({ try: (): unknown => JSON.parse(JSON.stringify(compileDmlSchema(orderModuleModels))),
    catch: cause => commerceError("unsupportedProfile", cause) });
  const compiled = yield* decodeCompiledDml(source).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const names = ["order", "order_address", "order_change", "order_change_action", "order_claim", "order_claim_item",
    "order_claim_item_image", "order_credit_line", "order_exchange", "order_exchange_item", "order_item", "order_line_item",
    "order_line_item_adjustment", "order_line_item_tax_line", "order_shipping", "order_shipping_method",
    "order_shipping_method_adjustment", "order_shipping_method_tax_line", "order_summary", "order_transaction",
    "return", "return_item", "return_reason"];
  if (compiled.tables.length !== names.length || names.some(name => compiled.tables.filter(table => table.name === name).length !== 1)
    || compiled.tables.some(table => table.foreignKeys.some(key => !names.includes(key.referencedTable))
      || table.relationships.some(relation => !names.includes(relation.targetTable)))) {
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  return yield* capturePrivateCanonicalValue(compiled, 1_048_576, { invalidInput: () => commerceError("unsupportedProfile"),
    hashFailure: cause => commerceError("unsupportedProfile", cause) });
});

export const orderSourceProvenance = Object.freeze({ kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f", paths: Object.freeze([
    "packages/modules/order/src/models/order.ts", "packages/modules/order/src/models/address.ts",
    "packages/modules/order/src/models/order-change.ts", "packages/modules/order/src/models/order-change-action.ts",
    "packages/modules/order/src/models/claim.ts", "packages/modules/order/src/models/claim-item.ts",
    "packages/modules/order/src/models/claim-item-image.ts", "packages/modules/order/src/models/credit-line.ts",
    "packages/modules/order/src/models/exchange.ts", "packages/modules/order/src/models/exchange-item.ts",
    "packages/modules/order/src/models/order-item.ts", "packages/modules/order/src/models/line-item.ts",
    "packages/modules/order/src/models/line-item-adjustment.ts", "packages/modules/order/src/models/line-item-tax-line.ts",
    "packages/modules/order/src/models/order-shipping-method.ts", "packages/modules/order/src/models/shipping-method.ts",
    "packages/modules/order/src/models/shipping-method-adjustment.ts", "packages/modules/order/src/models/shipping-method-tax-line.ts",
    "packages/modules/order/src/models/order-summary.ts", "packages/modules/order/src/models/transaction.ts",
    "packages/modules/order/src/models/return.ts", "packages/modules/order/src/models/return-item.ts",
    "packages/modules/order/src/models/return-reason.ts", "packages/modules/order/src/static-manifest.ts",
    "packages/database/drizzle/src/schema.ts",
  ]) } as const);

/** Fresh installation definition; no populated Order schema upgrade. */
export const compileOrderDefinition = Effect.fn("Order.compileDefinition")(function* () {
  const metadata = yield* captureOrderMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(metadata.frame.tables, "commerce.order")));
  return Object.freeze({ schema, provenance: orderSourceProvenance });
});
