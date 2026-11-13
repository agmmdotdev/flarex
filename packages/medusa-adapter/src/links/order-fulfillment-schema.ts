import { Effect } from "effect";
import { OrderFulfillment } from "@medusajs/link-modules";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { makeMedusaCoreDefinition } from "../schema/core-definition";
import { lowerDmlSchema } from "../schema/lower";
import { captureLinkMetadata, linkSchemaOrigins, LinkSchemaError } from "./schema";

export const captureOrderFulfillmentLinkMetadata = Effect.fn("OrderFulfillmentLink.captureMetadata")(function* () {
  const [order, fulfillment] = OrderFulfillment.relationships ?? [];
  if (order?.serviceName !== "order" || order.entity !== "Order" || order.foreignKey !== "order_id" || order.hasMany !== undefined ||
    order.deleteCascade !== undefined || fulfillment?.serviceName !== "fulfillment" || fulfillment.entity !== "Fulfillment" ||
    fulfillment.foreignKey !== "fulfillment_id" || fulfillment.hasMany !== true || fulfillment.deleteCascade !== undefined ||
    OrderFulfillment.databaseConfig?.tableName !== "order_fulfillment" || OrderFulfillment.databaseConfig.idPrefix !== "ordful")
    return yield* Effect.fail(new LinkSchemaError({ cause: "Unsupported Order Fulfillment Link" }));
  return yield* captureLinkMetadata(OrderFulfillment);
});
export const orderFulfillmentLinkProvenance = Object.freeze({ kind: "sourceSnapshot",
  repository: "https://github.com/agmmdotdev/medusa-fork.git", revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/link-modules/src/definitions/order-fulfillment.ts", "packages/modules/link-modules/src/utils/generate-entity.ts"]),
} as const);
export const compileOrderFulfillmentLinkCoreDefinition = Effect.fn("OrderFulfillmentLink.compileCoreDefinition")(function* (target: Readonly<{
  scopeUuid: string; epochUuid: string;
}>) {
  const metadata = yield* captureOrderFulfillmentLinkMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema([metadata.frame], "commerce.link.order-fulfillment", linkSchemaOrigins)));
  const provenance = orderFulfillmentLinkProvenance, profile = "medusa.link.orderFulfillment";
  return yield* makeMedusaCoreDefinition({ ...target, applicationRead: false }, { schema, provenance },
    { key: profile, writeProfile: profile, evidence: { provenance, profile } });
});
