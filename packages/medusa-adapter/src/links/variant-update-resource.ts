import { Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { linkWorkflowServiceDefinition } from "./workflow-service";
import { decodeVariantPricingListArguments, listNativeVariantPricing } from "./variant-pricing-read";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeDismiss = commerceDecoder(Schema.Tuple([Schema.Array(Schema.Struct({
  product: Schema.Struct({ variant_id: Id }), inventory: Schema.Struct({ inventory_item_id: Id }),
})).check(Schema.isMaxLength(8))]), "invalidInput");
const decodeRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8)), "storedCorruption");

/** Exact native routing remains inside a borrowed resource. A service object
 * from synchronous getLinkModule never crosses the asynchronous JSON boundary. */
export function prepareVariantUpdateLinkResource(inventory: unknown, pricing: unknown) {
  return Result.gen(function* () {
    const inventoryDefinition = linkWorkflowServiceDefinition(inventory), pricingDefinition = linkWorkflowServiceDefinition(pricing);
    if (inventoryDefinition === undefined || pricingDefinition === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    const dismissMethod = inventoryDefinition.dismissMethod;
    if (dismissMethod === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const selected = [inventoryDefinition, pricingDefinition];
    return yield* defineComposedWorkflowResource({ identity: { format: "medusa.variant.update-links", services: selected.map(service => service.routing) },
      dependencies: [inventoryDefinition.listMethod, pricingDefinition.listMethod, dismissMethod],
      methods: { dismiss: { arguments: decodeDismiss, output: decodeRows }, listVariantPricing: { arguments: decodeVariantPricingListArguments, output: decodeRows } },
      bind: invoke => {
        const loaded = selected.map(service => ({ ...structuredClone(service.routing),
          list: async (filters: unknown = {}, config: unknown = {}) => [...await invoke(service.listMethod, filters, config)],
          dismiss: async (bulk: unknown) => service.dismissMethod === undefined ? Promise.reject(commerceError("unsupportedProfile"))
            : [...await invoke(service.dismissMethod, bulk)],
        }));
        const native = new Link(loaded);
        return { dismiss: input => native.dismiss(input.map(row => ({ ...row }))),
          listVariantPricing: (filters, config) => listNativeVariantPricing(native, filters, config) };
      } });
  });
}
