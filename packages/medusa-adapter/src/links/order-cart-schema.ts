import { Effect } from "effect";
import { OrderCart } from "@medusajs/link-modules";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLinkMetadata, linkSchemaOrigins, LinkSchemaError } from "./schema";
import { lowerDmlSchema } from "../schema/lower";

export const captureOrderCartLinkMetadata = Effect.fn("OrderCartLink.captureMetadata")(function* () {
  const [order, cart] = OrderCart.relationships ?? [];
  if (order?.serviceName !== "order" || order.entity !== "Order" || order.foreignKey !== "order_id" || order.hasMany !== true ||
    cart?.serviceName !== "cart" || cart.entity !== "Cart" || cart.foreignKey !== "cart_id" || cart.hasMany !== undefined ||
    order.deleteCascade !== undefined || cart.deleteCascade !== undefined ||
    OrderCart.databaseConfig?.tableName !== "order_cart" || OrderCart.databaseConfig.idPrefix !== "ordercart")
    return yield* Effect.fail(new LinkSchemaError({ cause: "Unsupported native Order-Cart Link" }));
  return yield* captureLinkMetadata(OrderCart);
});
export const orderCartLinkProvenance = Object.freeze({ kind: "sourceSnapshot",
  repository: "https://github.com/agmmdotdev/medusa-fork.git", revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/link-modules/src/definitions/order-cart.ts",
    "packages/modules/link-modules/src/utils/generate-entity.ts"]),
} as const);
export const compileOrderCartLinkDefinition = Effect.fn("OrderCartLink.compileDefinition")(function* () {
  const metadata = yield* captureOrderCartLinkMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema([metadata.frame],
    "commerce.link.order-cart", linkSchemaOrigins)));
  return Object.freeze({ schema, provenance: orderCartLinkProvenance });
});
