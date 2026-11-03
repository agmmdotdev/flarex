import { Effect } from "effect";
import { cartCreationModels } from "@medusajs/cart/creation-models";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { capturePrivateCanonicalValue, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { makeCoreRelationalNativeDefinition } from "@flarex/persistence-postgres/internal/core";
import { decodeCompiledDml } from "../../schema/compiled";
import { lowerDmlSchema } from "../../schema/lower";
import { cartSourceProvenance } from "./schema";

/** An explicit fresh-install creation profile. Existing nine-model Cart
 * installations retain their definition; this is not a populated-data upgrade. */
export const captureCartCreationMetadata = Effect.fn("CartCreation.captureMetadata")(function* () {
  const source = yield* Effect.try({ try: (): unknown => JSON.parse(JSON.stringify(compileDmlSchema(Object.values(cartCreationModels)))),
    catch: cause => commerceError("unsupportedProfile", cause) });
  const compiled = yield* decodeCompiledDml(source).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
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
  const source = yield* captureLogicalSchemaSource({ key: "medusa.cart", owner: "medusa", writeProfile: "medusa.cart",
    evidence: { provenance, profile: "medusa.cart", authoredModels: ["packages/medusa-cart/src/creation/models.ts"] },
    definition: { kind: "relational", schema },
    bindings: schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${schema.coordinate.lineageId}/${table.identity.tableId}` } })) });
  return yield* makeCoreRelationalNativeDefinition({ scopeUuid, epochUuid, applicationRead: false, source, provenance, commands: [] });
});
