import { Effect } from "effect";
import { CartPaymentCollection } from "@medusajs/link-modules";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { makeCoreRelationalNativeDefinition } from "@flarex/persistence-postgres/internal/core";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLinkMetadata, linkSchemaOrigins, LinkSchemaError } from "./schema";
import { lowerDmlSchema } from "../schema/lower";

export const captureCartPaymentCollectionLinkMetadata = Effect.fn("CartPaymentCollectionLink.captureMetadata")(function* () {
  const [cart, payment] = CartPaymentCollection.relationships ?? [];
  if (cart?.serviceName !== "cart" || cart.entity !== "Cart" || cart.foreignKey !== "cart_id" ||
    cart.hasMany !== undefined || cart.deleteCascade !== undefined || payment?.serviceName !== "payment" ||
    payment.entity !== "PaymentCollection" || payment.foreignKey !== "payment_collection_id" ||
    payment.hasMany !== true || payment.deleteCascade !== undefined ||
    CartPaymentCollection.databaseConfig?.tableName !== "cart_payment_collection" ||
    CartPaymentCollection.databaseConfig.idPrefix !== "capaycol")
    return yield* Effect.fail(new LinkSchemaError({ cause: "Unsupported Cart Payment Collection Link" }));
  return yield* captureLinkMetadata(CartPaymentCollection);
});
export const cartPaymentCollectionLinkProvenance = Object.freeze({ kind: "sourceSnapshot",
  repository: "https://github.com/agmmdotdev/medusa-fork.git", revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/link-modules/src/definitions/cart-payment-collection.ts",
    "packages/modules/link-modules/src/utils/generate-entity.ts"]),
} as const);
export const compileCartPaymentCollectionLinkDefinition = Effect.fn("CartPaymentCollectionLink.compileDefinition")(function* () {
  const metadata = yield* captureCartPaymentCollectionLinkMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema([metadata.frame],
    "commerce.link.cart-payment-collection", linkSchemaOrigins)));
  return Object.freeze({ schema, provenance: cartPaymentCollectionLinkProvenance });
});

export const compileCartPaymentCollectionLinkCoreDefinition = Effect.fn("CartPaymentCollectionLink.compileCoreDefinition")(function* ({ scopeUuid, epochUuid }: Readonly<{
  scopeUuid: string;
  epochUuid: string;
}>) {
  const { schema, provenance } = yield* compileCartPaymentCollectionLinkDefinition();
  const source = yield* captureLogicalSchemaSource({ key: "medusa.link.cartPaymentCollection", owner: "medusa", writeProfile: "medusa.link.cartPaymentCollection",
    evidence: { provenance, profile: "medusa.link.cartPaymentCollection" }, definition: { kind: "relational", schema },
    bindings: schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${schema.coordinate.lineageId}/${table.identity.tableId}` } })) });
  return yield* makeCoreRelationalNativeDefinition({ scopeUuid, epochUuid, applicationRead: false, source, provenance, commands: [] });
});
