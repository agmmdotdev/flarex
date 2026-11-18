import { planScalarCreateBatch } from "@medusajs/utils/dal/create-planning";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { StockLocationsInput } from "./input";

type AddressSelection = { readonly kind: "none" } | { readonly kind: "reference"; readonly id: string } |
  { readonly kind: "nested"; readonly input: JsonObject };

/** Native Stock Location creation resolves the to-one relation before child
 * persistence. An ignored later Address must never enter the Address cohort.
 * Repeated references to the selected explicit child may hydrate its nullish
 * fields; a different child identity cannot replace that selection. */
export function planStockLocationCreates(inputs: typeof StockLocationsInput.Type, identities: readonly string[]) {
  const sources = inputs.map(({ address: _address, ...row }, index) => ({ ...row, id: identities[index]! }));
  const plan = planScalarCreateBatch(sources);
  const addresses: AddressSelection[] = plan.entities.map(() => ({ kind: "none" }));
  for (const [index, input] of inputs.entries()) {
    const position = plan.positions[index]!, selected = addresses[position]!;
    if (selected.kind === "none") {
      if (input.address !== undefined) addresses[position] = { kind: "nested", input: { ...input.address } };
      else if (typeof input.address_id === "string") addresses[position] = { kind: "reference", id: input.address_id };
    } else if (selected.kind === "nested" && typeof selected.input.id === "string" &&
      input.address?.id === selected.input.id) {
      const merged = planScalarCreateBatch([{ ...selected.input, id: selected.input.id }, { ...input.address, id: selected.input.id }]);
      addresses[position] = { kind: "nested", input: merged.entities[0]! };
    }
  }
  return { ...plan, addresses };
}
