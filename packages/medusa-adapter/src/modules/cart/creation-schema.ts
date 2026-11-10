import { Effect } from "effect";
import { cartCreationModels } from "@medusajs/cart/creation-models";
import { compileDmlMetadata } from "../../schema/compile";
import { capturePrivateCanonicalValue, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { makeMedusaCoreDefinition } from "../../schema/core-definition";
import { lowerDmlSchema } from "../../schema/lower";
import { cartSourceProvenance } from "./schema";

/** An explicit fresh-install creation profile. Existing nine-model Cart
 * installations retain their definition; this is not a populated-data upgrade. */
export const captureCartCreationMetadata = Effect.fn("CartCreation.captureMetadata")(function* () {
  const compiled = yield* compileDmlMetadata(Object.values(cartCreationModels), cause => commerceError("unsupportedProfile", cause));
  const names = ["cart", "cart_address", "credit_line", "cart_line_item", "cart_line_item_adjustment", "cart_line_item_tax_line",
    "cart_shipping_method", "cart_shipping_method_adjustment", "cart_shipping_method_tax_line",
    "cart_creation_operation", "cart_creation_cart", "cart_creation_address"];
  if (compiled.tables.length !== names.length || names.some(name => compiled.tables.filter(table => table.name === name).length !== 1) ||
    compiled.tables.some(table => table.foreignKeys.some(key => !names.includes(key.referencedTable))))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  return yield* capturePrivateCanonicalValue(compiled, 1_048_576, { invalidInput: () => commerceError("unsupportedProfile"),
    hashFailure: cause => commerceError("unsupportedProfile", cause) });
});

export const compileCartCreationDefinition = Effect.fn("CartCreation.compileDefinition")(function* () {
  const metadata = yield* captureCartCreationMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(metadata.frame.tables, "commerce.cart")));
  return Object.freeze({ schema, provenance: cartSourceProvenance });
});

/** One fresh Core Cart source, including the three native creation records. */
export const compileCartCoreDefinition = Effect.fn("Cart.compileCoreDefinition")(function* (target: Readonly<{
  scopeUuid: string;
  epochUuid: string;
}>) {
  const { scopeUuid, epochUuid } = target;
  const { schema, provenance } = yield* compileCartCreationDefinition();
  return yield* makeMedusaCoreDefinition({ scopeUuid, epochUuid, applicationRead: false }, { schema, provenance }, { key: "medusa.cart", writeProfile: "medusa.cart",
    evidence: { provenance, profile: "medusa.cart", authoredModels: ["packages/medusa-cart/src/creation/models.ts"] } });
});
