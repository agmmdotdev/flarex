import { Modules } from "@medusajs/framework/utils/portable";
import type { CommerceProfileState, LocalCommerceEventPolicy } from "@flarex/persistence-postgres/internal/commerce-profile";
import { scalarEventPolicy, scalarLogicalEventPolicy } from "./scalar-events";

const commands = { insert: "salesChannelCreate", update: "salesChannelUpdate", delete: "salesChannelDelete" };

export function salesChannelEventPolicy(descriptor: CommerceProfileState, deliver: LocalCommerceEventPolicy["deliver"]) {
  return scalarEventPolicy(Modules.SALES_CHANNEL, "sales_channel",
    commands, descriptor, deliver);
}

export function salesChannelLogicalEventPolicy() {
  return scalarLogicalEventPolicy(Modules.SALES_CHANNEL, "sales_channel", commands);
}
