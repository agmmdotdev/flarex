import { Effect } from "effect";
import { OrderPaymentCollection } from "@medusajs/link-modules";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { makeCoreRelationalNativeDefinition } from "@flarex/persistence-postgres/internal/core";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLinkMetadata, linkSchemaOrigins, LinkSchemaError } from "./schema";
import { lowerDmlSchema } from "../schema/lower";

export const captureOrderPaymentCollectionLinkMetadata = Effect.fn("OrderPaymentCollectionLink.captureMetadata")(function* () {
  const [order, payment] = OrderPaymentCollection.relationships ?? [];
  if (order?.serviceName !== "order" || order.entity !== "Order" || order.foreignKey !== "order_id" ||
    order.hasMany !== undefined || order.deleteCascade !== undefined || payment?.serviceName !== "payment" ||
    payment.entity !== "PaymentCollection" || payment.foreignKey !== "payment_collection_id" ||
    payment.hasMany !== true || payment.deleteCascade !== true ||
    OrderPaymentCollection.databaseConfig?.tableName !== "order_payment_collection" ||
    OrderPaymentCollection.databaseConfig.idPrefix !== "ordpay")
    return yield* Effect.fail(new LinkSchemaError({ cause: "Unsupported Order Payment Collection Link" }));
  return yield* captureLinkMetadata(OrderPaymentCollection);
});
export const orderPaymentCollectionLinkProvenance = Object.freeze({ kind: "sourceSnapshot",
  repository: "https://github.com/agmmdotdev/medusa-fork.git", revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/link-modules/src/definitions/order-payment-collection.ts",
    "packages/modules/link-modules/src/utils/generate-entity.ts"]),
} as const);
export const compileOrderPaymentCollectionLinkDefinition = Effect.fn("OrderPaymentCollectionLink.compileDefinition")(function* () {
  const metadata = yield* captureOrderPaymentCollectionLinkMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema([metadata.frame],
    "commerce.link.order-payment-collection", linkSchemaOrigins)));
  return Object.freeze({ schema, provenance: orderPaymentCollectionLinkProvenance });
});

export const compileOrderPaymentCollectionLinkCoreDefinition = Effect.fn("OrderPaymentCollectionLink.compileCoreDefinition")(function* ({ scopeUuid, epochUuid }: Readonly<{
  scopeUuid: string; epochUuid: string;
}>) {
  const { schema, provenance } = yield* compileOrderPaymentCollectionLinkDefinition();
  const source = yield* captureLogicalSchemaSource({ key: "medusa.link.orderPaymentCollection", owner: "medusa", writeProfile: "medusa.link.orderPaymentCollection",
    evidence: { provenance, profile: "medusa.link.orderPaymentCollection" }, definition: { kind: "relational", schema },
    bindings: schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${schema.coordinate.lineageId}/${table.identity.tableId}` } })) });
  return yield* makeCoreRelationalNativeDefinition({ scopeUuid, epochUuid, applicationRead: false, source, provenance, commands: [] });
});
