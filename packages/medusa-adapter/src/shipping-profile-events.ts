import { Modules } from "@medusajs/framework/utils/portable";
import type { CommerceProfileState, LocalCommerceEventPolicy } from "@flarex/persistence-postgres/internal/commerce-profile";
import { scalarEventPolicy, scalarLogicalEventPolicy } from "./scalar-events";

export function shippingProfileEventPolicy(descriptor: CommerceProfileState, deliver: LocalCommerceEventPolicy["deliver"]) {
  return scalarEventPolicy(Modules.FULFILLMENT, "shipping_profile", { insert: "shippingProfileCreate" }, descriptor, deliver);
}

export function shippingProfileLogicalEventPolicy() {
  return scalarLogicalEventPolicy(Modules.FULFILLMENT, "shipping_profile", { insert: "shippingProfileCreate" });
}
