import { Result, Schema } from "effect";
import { WorkflowDefinitionError } from "@medusajs/workflows-sdk";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Quantity = Schema.Number.check(Schema.isFinite());
const Rows = Schema.Array(Schema.Struct({ id: Id, stocked_quantity: Quantity,
  reserved_quantity: Quantity, location_id: Id })).check(Schema.isMaxLength(4));
const decode = Schema.decodeUnknownResult(Rows, { onExcessProperty: "error" });

/** The genuine remote query returns four selected fields, rather than a full
 * InventoryLevelDTO. In particular, incoming_quantity remains absent. */
export const levelDeletionRows = (input: unknown) => Result.getOrThrow(decode(input).pipe(Result.mapError(() => new WorkflowDefinitionError({
  reason: "unsupportedProfile", detail: "Inventory Level deletion query exceeds its admitted native result contract",
}))));