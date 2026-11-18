import { Result, Schema } from "effect";
import { WorkflowDefinitionError } from "@medusajs/workflows-sdk";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Rows = Schema.Array(Schema.Struct({ id: Id, manage_inventory: Schema.Boolean,
  inventory: Schema.Array(Schema.NullOr(Schema.Struct({ id: Id,
    variants: Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(4)),
  }))).check(Schema.isMaxLength(2)),
})).check(Schema.isMaxLength(4), Schema.makeFilter(rows => new Set(rows.flatMap(row => row.inventory.flatMap(item => item === null ? [] : [item.id]))).size <= 8));
const decode = Schema.decodeUnknownResult(Rows, { onExcessProperty: "error" });

/** Partial native graph DTO, with complete inverse ownership supplied by Query.
 * The unchanged native transform remains the sole Inventory deletion decision. */
export const deletionVariantRows = (input: unknown) => Result.getOrThrow(decode(input).pipe(Result.mapError(() => new WorkflowDefinitionError({
  reason: "unsupportedProfile", detail: "Product deletion ownership graph exceeds its admitted native result contract",
}))));
