import { Effect } from "effect";
import { OrderPromotion } from "@medusajs/link-modules";
import { makeMedusaCoreDefinition } from "../schema/core-definition";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLinkMetadata, linkSchemaOrigins, LinkSchemaError } from "./schema";
import { lowerDmlSchema } from "../schema/lower";

export const captureOrderPromotionLinkMetadata = Effect.fn("OrderPromotionLink.captureMetadata")(function* () {
  const [order, promotion] = OrderPromotion.relationships ?? [];
  if (order?.serviceName !== "order" || order.entity !== "Order" || order.foreignKey !== "order_id" || order.hasMany !== true ||
    promotion?.serviceName !== "promotion" || promotion.entity !== "Promotion" || promotion.foreignKey !== "promotion_id" || promotion.hasMany !== true ||
    order.deleteCascade !== undefined || promotion.deleteCascade !== undefined ||
    OrderPromotion.databaseConfig?.tableName !== "order_promotion" || OrderPromotion.databaseConfig.idPrefix !== "orderpromo")
    return yield* Effect.fail(new LinkSchemaError({ cause: "Unsupported native Order-Promotion Link" }));
  return yield* captureLinkMetadata(OrderPromotion);
});
const orderPromotionLinkProvenance = Object.freeze({ kind: "sourceSnapshot",
  repository: "https://github.com/agmmdotdev/medusa-fork.git", revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/link-modules/src/definitions/order-promotion.ts",
    "packages/modules/link-modules/src/utils/generate-entity.ts"]),
} as const);
export const compileOrderPromotionLinkCoreDefinition = Effect.fn("OrderPromotionLink.compileCoreDefinition")(function* ({ scopeUuid, epochUuid }: Readonly<{
  scopeUuid: string; epochUuid: string;
}>) {
  const metadata = yield* captureOrderPromotionLinkMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema([metadata.frame],
    "commerce.link.order-promotion", linkSchemaOrigins)));
  return yield* makeMedusaCoreDefinition({ scopeUuid, epochUuid, applicationRead: false },
    { schema, provenance: orderPromotionLinkProvenance },
    { key: "medusa.link.orderPromotion", writeProfile: "medusa.link.orderPromotion", evidence: { provenance: orderPromotionLinkProvenance, profile: "medusa.link.orderPromotion" } });
});
