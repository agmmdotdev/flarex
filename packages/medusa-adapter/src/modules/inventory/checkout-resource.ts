import { Schema } from "effect";
import { defineComposedWorkflowResource } from "../../workflow/composed-resource";
import type { WorkflowMethod } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { decodeCheckoutReservationIdArguments, decodeCheckoutReservationOutput, normalizeCheckoutReservationArguments } from "./checkout-input";

/** Preserve the native callback ABI without exposing its exact numeric
 * transport methods or an independent Inventory execution lifetime. */
export function makeCheckoutInventoryResource(create: WorkflowMethod, remove: WorkflowMethod) {
  return defineComposedWorkflowResource({ identity: { profile: "inventory-checkout", maximumReservations: 4 },
    dependencies: [create, remove], methods: {
      createReservationItems: { arguments: normalizeCheckoutReservationArguments, output: decodeCheckoutReservationOutput },
      deleteReservationItems: { arguments: decodeCheckoutReservationIdArguments, output: commerceDecoder(Schema.Null, "storedCorruption") },
    }, bind: invoke => ({ createReservationItems: rows => invoke(create, rows), deleteReservationItems: ids => invoke(remove, ids) }) });
}
