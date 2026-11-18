import { model } from "@medusajs/framework/utils/portable"

/** Independent of the rich Link row: physical deletion must retain its fence.
 * The deterministic ID encodes service plus the ordered endpoint tuple. */
const LinkPairRevision = model.define("LinkPairRevision", {
  id: model.id({ prefix: "lpr" }).primaryKey(),
  service_name: model.text(),
  primary_value: model.text(),
  foreign_value: model.text(),
  revision: model.text(),
})

export default LinkPairRevision
