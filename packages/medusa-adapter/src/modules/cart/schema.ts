import { Effect } from "effect";
import { Address, Cart, CreditLine, LineItem, LineItemAdjustment, LineItemTaxLine,
  ShippingMethod, ShippingMethodAdjustment, ShippingMethodTaxLine } from "@medusajs/cart/models";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { capturePrivateCanonicalValue, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { decodeCompiledDml } from "../../schema/compiled";
import { lowerDmlSchema } from "../../schema/lower";

export const cartModels = [Cart, Address, CreditLine, LineItem, LineItemAdjustment, LineItemTaxLine,
  ShippingMethod, ShippingMethodAdjustment, ShippingMethodTaxLine] as const;
export const captureCartMetadata = Effect.fn("Cart.captureMetadata")(function* () {
  const source = yield* Effect.try({ try: (): unknown => JSON.parse(JSON.stringify(compileDmlSchema([...cartModels]))),
    catch: cause => commerceError("unsupportedProfile", cause) });
  const compiled = yield* decodeCompiledDml(source).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const names = ["cart", "cart_address", "credit_line", "cart_line_item", "cart_line_item_adjustment", "cart_line_item_tax_line",
    "cart_shipping_method", "cart_shipping_method_adjustment", "cart_shipping_method_tax_line"];
  if (compiled.tables.length !== names.length || names.some(name => compiled.tables.filter(table => table.name === name).length !== 1) ||
    compiled.tables.some(table => table.foreignKeys.some(key => !names.includes(key.referencedTable))))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  return yield* capturePrivateCanonicalValue(compiled, 1_048_576, { invalidInput: () => commerceError("unsupportedProfile"),
    hashFailure: cause => commerceError("unsupportedProfile", cause) });
});
export const cartSourceProvenance = Object.freeze({ kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f", paths: Object.freeze([
    "packages/modules/cart/src/models/cart.ts", "packages/modules/cart/src/models/address.ts", "packages/modules/cart/src/models/credit-line.ts",
    "packages/modules/cart/src/models/line-item.ts", "packages/modules/cart/src/models/line-item-adjustment.ts", "packages/modules/cart/src/models/line-item-tax-line.ts",
    "packages/modules/cart/src/models/shipping-method.ts", "packages/modules/cart/src/models/shipping-method-adjustment.ts",
    "packages/modules/cart/src/models/shipping-method-tax-line.ts", "packages/database/drizzle/src/schema.ts",
  ]) } as const);
export const compileCartDefinition = Effect.fn("Cart.compileDefinition")(function* () {
  const metadata = yield* captureCartMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(metadata.frame.tables, "commerce.cart")));
  return Object.freeze({ schema, provenance: cartSourceProvenance });
});
