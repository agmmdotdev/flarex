import { decodeLinkCascade } from "./cascade-result";
import { Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import type { WorkflowModule } from "../workflow/module";
import { captureProductLinkCascade, nativePricingCascadeModule } from "./product-cascade";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const ProductIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const decodeDelete = commerceDecoder(Schema.Tuple([Schema.Union([
  Schema.Struct({ product: Schema.Struct({ product_id: Schema.optionalKey(ProductIds), variant_id: Schema.optionalKey(ProductIds) }) }),
  Schema.Struct({ inventory: Schema.Struct({ inventory_item_id: Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(8)) }) }),
])]), "invalidInput");

/** The genuine Link cascade owns traversal, concurrency and its full result
 * tuple. Only the four named Link families and Pricing lifecycle are loaded. */
export function prepareProductDeletionLinkResource(services: {
  readonly sales: unknown; readonly shipping: unknown; readonly inventory: unknown; readonly pricing: unknown;
}, pricingWorkflow: WorkflowModule) {
  return Result.gen(function* () {
    const cascade = yield* captureProductLinkCascade(services, pricingWorkflow,
      ["product-deletions", "product-deletions", "inventory-deletions", "product-deletions"]);
    const { sales, shipping, inventory, pricing, selected, pricingJoiner, softDeletePriceSets } = cascade;
    const salesDelete = sales.softDeleteMethod, shippingDelete = shipping.softDeleteMethod;
    const inventoryDelete = inventory.softDeleteMethod, pricingDelete = pricing.softDeleteMethod;
    if (salesDelete === undefined || shippingDelete === undefined || inventoryDelete === undefined || pricingDelete === undefined)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    return yield* defineComposedWorkflowResource({ identity: { format: "medusa.product.deletion-links",
      services: selected.map(service => service.routing), pricing: { module: pricingWorkflow.name, joiner: pricingJoiner } },
      dependencies: [salesDelete, shippingDelete, inventoryDelete, pricingDelete, softDeletePriceSets],
      methods: { delete: { arguments: decodeDelete, output: decodeLinkCascade } },
      bind: invoke => {
        const loaded = [{ service: sales, method: salesDelete }, { service: shipping, method: shippingDelete },
          { service: inventory, method: inventoryDelete }, { service: pricing, method: pricingDelete }].map(({ service, method }) =>
          ({ ...structuredClone(service.routing), softDelete: (selector: unknown, config: unknown) => invoke(method, selector, config) }));
        const native = new Link([...loaded, nativePricingCascadeModule(cascade, invoke)]);
        return { delete: input => native.delete(structuredClone(input)) };
      },
    });
  });
}
