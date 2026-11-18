import { Modules } from "@medusajs/framework/utils/portable";
import { scalarLogicalEventPolicy } from "../../repository/scalar-events";

export function shippingProfileLogicalEventPolicy() {
  return scalarLogicalEventPolicy(Modules.FULFILLMENT, "shipping_profile", { insert: "shippingProfileCreate" });
}
