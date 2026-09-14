import { Modules } from "@medusajs/framework/utils/portable";
import type { CommerceProfileState, LocalCommerceEventPolicy } from "@flarex/persistence-postgres/internal/commerce-profile";
import { scalarEventPolicy } from "./scalar-events";

export function salesChannelEventPolicy(descriptor: CommerceProfileState, deliver: LocalCommerceEventPolicy["deliver"]) {
  return scalarEventPolicy(Modules.SALES_CHANNEL, "sales_channel",
    { insert: "salesChannelCreate", update: "salesChannelUpdate", delete: "salesChannelDelete" }, descriptor, deliver);
}
