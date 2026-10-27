import { Effect } from "effect";
import { CartPromotion } from "@medusajs/link-modules";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLinkMetadata, linkSchemaOrigins, LinkSchemaError } from "./schema";
import { lowerDmlSchema } from "../schema/lower";

export const captureCartPromotionLinkMetadata = Effect.fn("CartPromotionLink.captureMetadata")(function* () {
  const [cart, promotion] = CartPromotion.relationships ?? [];
  if (cart?.serviceName !== "cart" || cart.entity !== "Cart" || cart.foreignKey !== "cart_id" || cart.hasMany !== true ||
    promotion?.serviceName !== "promotion" || promotion.entity !== "Promotion" || promotion.foreignKey !== "promotion_id" || promotion.hasMany !== true ||
    cart.deleteCascade !== undefined || promotion.deleteCascade !== undefined ||
    CartPromotion.databaseConfig?.tableName !== "cart_promotion" || CartPromotion.databaseConfig.idPrefix !== "cartpromo")
    return yield* Effect.fail(new LinkSchemaError({ cause: "Unsupported native Cart-Promotion Link" }));
  return yield* captureLinkMetadata(CartPromotion);
});
export const cartPromotionLinkProvenance = Object.freeze({ kind: "sourceSnapshot",
  repository: "https://github.com/agmmdotdev/medusa-fork.git", revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/link-modules/src/definitions/cart-promotion.ts", "packages/modules/link-modules/src/utils/generate-entity.ts"]),
} as const);
export const compileCartPromotionLinkDefinition = Effect.fn("CartPromotionLink.compileDefinition")(function* () {
  const metadata = yield* captureCartPromotionLinkMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema([metadata.frame], "commerce.link.cart-promotion", linkSchemaOrigins)));
  return Object.freeze({ schema, provenance: cartPromotionLinkProvenance });
});
