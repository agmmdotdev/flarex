import { Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import type { WorkflowModule } from "../workflow/module";
import { ProductLinkBatch } from "./product-service";
import { VariantInventoryLinkBatch, VariantPricingLinkBatch } from "./variant-service";
import { captureProductLinkCascade, decodeLinkCascade, nativePricingCascadeModule } from "./product-cascade";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const ProductBatch = ProductLinkBatch.check(Schema.isMaxLength(8));
const CreateBatch = Schema.Union([ProductBatch, VariantPricingLinkBatch]);
const DismissBatch = Schema.Union([ProductBatch, VariantInventoryLinkBatch]);
const decodeCreate = commerceDecoder(Schema.Tuple([CreateBatch]), "invalidInput");
const decodeDismiss = commerceDecoder(Schema.Tuple([DismissBatch]), "invalidInput");
const decodeList = commerceDecoder(Schema.Tuple([ProductBatch, Schema.Struct({ asLinkDefinition: Schema.Literal(true) })]), "invalidInput");
const decodeDelete = commerceDecoder(Schema.Tuple([Schema.Struct({ product: Schema.Struct({
  variant_id: Schema.Array(Id).check(Schema.isMaxLength(4)),
}) })]), "invalidInput");
const decodeRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8)), "storedCorruption");

/** Native routing owns replacement and cascade traversal. Each callback borrows
 * its authentic source command; the asynchronous ABI returns JSON, never a
 * module service, DAL handle or a second transaction owner. */
export function prepareProductUpdateLinkResource(services: {
  readonly sales: unknown; readonly shipping: unknown; readonly inventory: unknown; readonly pricing: unknown;
}, pricingWorkflow: WorkflowModule) {
  return Result.gen(function* () {
    const cascade = yield* captureProductLinkCascade(services, pricingWorkflow, ["dismiss", "dismiss", "cascade", "cascade"]);
    const { sales, shipping, inventory, pricing, selected, softDeletePriceSets, pricingJoiner } = cascade;
    const salesDismiss = sales.dismissMethod, shippingDismiss = shipping.dismissMethod, inventoryDismiss = inventory.dismissMethod;
    const inventoryDelete = inventory.softDeleteMethod, pricingDelete = pricing.softDeleteMethod;
    if (salesDismiss === undefined || shippingDismiss === undefined || inventoryDismiss === undefined || inventoryDelete === undefined || pricingDelete === undefined)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    return yield* defineComposedWorkflowResource({ identity: { format: "medusa.product.update-links",
      services: selected.map(service => service.routing), pricing: { module: pricingWorkflow.name, joiner: pricingJoiner } },
      dependencies: [sales.createMethod, sales.listMethod, salesDismiss, shipping.createMethod, shipping.listMethod, shippingDismiss,
        inventoryDismiss, inventoryDelete, pricing.createMethod, pricing.listMethod, pricingDelete, softDeletePriceSets],
      methods: { create: { arguments: decodeCreate, output: decodeRows }, list: { arguments: decodeList, output: decodeRows },
        dismiss: { arguments: decodeDismiss, output: decodeRows }, delete: { arguments: decodeDelete, output: decodeLinkCascade } },
      bind: invoke => {
        const loaded = selected.map(service => ({ ...structuredClone(service.routing),
          list: async (filters: unknown = {}, config: unknown = {}) => [...await invoke(service.listMethod, filters, config)],
          ...(service === inventory ? {} : { create: async (bulk: unknown) => [...await invoke(service.createMethod, bulk)] }),
          ...(service === sales ? { dismiss: async (bulk: unknown) => [...await invoke(salesDismiss, bulk)] }
            : service === shipping ? { dismiss: async (bulk: unknown) => [...await invoke(shippingDismiss, bulk)] }
              : service === inventory ? { dismiss: async (bulk: unknown) => [...await invoke(inventoryDismiss, bulk)] } : {}),
          ...(service === inventory ? { softDelete: (selector: unknown, config: unknown) => invoke(inventoryDelete, selector, config) }
            : service === pricing ? { softDelete: (selector: unknown, config: unknown) => invoke(pricingDelete, selector, config) } : {}),
        }));
        const native = new Link([...loaded, nativePricingCascadeModule(cascade, invoke)]);
        return { create: input => native.create(structuredClone(input)),
          list: (input, options) => native.list(structuredClone(input), options),
          dismiss: input => native.dismiss(structuredClone(input)),
          delete: input => native.delete({ product: { variant_id: [...input.product.variant_id] } }),
        };
      },
    });
  });
}
