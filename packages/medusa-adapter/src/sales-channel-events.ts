import { Modules } from "@medusajs/framework/utils/portable";
import { scalarLogicalEventPolicy } from "./scalar-events";

const commands = { insert: "salesChannelCreate", update: "salesChannelUpdate", delete: "salesChannelDelete" };

export function salesChannelLogicalEventPolicy() {
  return scalarLogicalEventPolicy(Modules.SALES_CHANNEL, "sales_channel", commands);
}
