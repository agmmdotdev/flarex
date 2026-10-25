import { model } from "@medusajs/framework/utils/portable"

/** Durable native outcome. Cancellation tombstones arbitrate an operation ID
 * against an apply whose database outcome has not yet been observed. */
const LinkWorkflowOperation = model.define("LinkWorkflowOperation", {
  id: model.id({ prefix: "lop" }).primaryKey(),
  service_name: model.text(),
  request: model.json(),
  state: model.enum(["applied", "compensated", "cancelled"]),
  changes: model.json(),
  events: model.json(),
  compensation_events: model.json(),
}).indexes([{ on: ["service_name", "state"] }])

export default LinkWorkflowOperation
