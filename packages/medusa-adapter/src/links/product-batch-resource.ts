import { Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import type { WorkflowMethod, WorkflowModule } from "../workflow/module";
import { ProductLinkBatch } from "./product-service";
import { VariantInventoryLinkBatch } from "./variant-service";
import { captureProductLinkCascade, decodeLinkCascade, nativePricingCascadeModule } from "./product-cascade";
import { decodeVariantPricingListArguments, listNativeVariantPricing } from "./variant-pricing-read";
import { decodeProductNativeLinkArguments } from "./product-resource";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const ProductBatch = ProductLinkBatch.check(Schema.isMaxLength(8));
const decodeDismiss = commerceDecoder(Schema.Tuple([Schema.Union([ProductBatch, VariantInventoryLinkBatch])]), "invalidInput");
const decodeList = commerceDecoder(Schema.Tuple([ProductBatch, Schema.Struct({ asLinkDefinition: Schema.Literal(true) })]), "invalidInput");
const ProductIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const decodeDelete = commerceDecoder(Schema.Tuple([Schema.Union([
  Schema.Struct({ product: Schema.Struct({ product_id: Schema.optionalKey(ProductIds), variant_id: Schema.optionalKey(ProductIds) }) }),
  Schema.Struct({ inventory: Schema.Struct({ inventory_item_id: Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(8)) }) }),
])]), "invalidInput");
const decodeRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8)), "storedCorruption");

/** One genuine native router serves all batch children. Every callback borrows
 * an authenticated method from its original source and existing receipt owner. */
export function prepareProductBatchLinkResource(services: {
  readonly sales: unknown; readonly shipping: unknown; readonly inventory: unknown; readonly pricing: unknown;
}, pricingWorkflow: WorkflowModule) {
  return Result.gen(function* () {
    const cascade = yield* captureProductLinkCascade(services, pricingWorkflow,
      ["product-deletions", "product-deletions", "inventory-deletions", "product-deletions"]);
    const { selected, pricing, pricingJoiner, softDeletePriceSets } = cascade;
    const admitted: Array<Omit<(typeof selected)[number], "softDeleteMethod" | "dismissMethod"> & {
      readonly softDeleteMethod: WorkflowMethod;
      readonly dismissMethod: (typeof selected)[number]["dismissMethod"];
    }> = [];
    for (const service of selected) {
      if ((service !== pricing && service.dismissMethod === undefined) || service.softDeleteMethod === undefined)
        return yield* Result.fail(commerceError("unsupportedProfile"));
      admitted.push({ ...service, dismissMethod: service === pricing ? undefined : service.dismissMethod, softDeleteMethod: service.softDeleteMethod });
    }
    return yield* defineComposedWorkflowResource({ identity: { format: "medusa.product.batch-links",
      services: selected.map(service => service.routing), pricing: { module: pricingWorkflow.name, joiner: pricingJoiner } },
      dependencies: [...admitted.flatMap(service => [service.createMethod, service.listMethod, service.softDeleteMethod,
        ...(service.dismissMethod === undefined ? [] : [service.dismissMethod])]), softDeletePriceSets],
      methods: { create: { arguments: decodeProductNativeLinkArguments, output: decodeRows }, list: { arguments: decodeList, output: decodeRows },
        dismiss: { arguments: decodeDismiss, output: decodeRows }, delete: { arguments: decodeDelete, output: decodeLinkCascade },
        listVariantPricing: { arguments: decodeVariantPricingListArguments, output: decodeRows } },
      bind: invoke => {
        const loaded = admitted.map(service => {
          const dismiss = service.dismissMethod;
          return { ...structuredClone(service.routing),
            list: async (filters: unknown = {}, config: unknown = {}) => [...await invoke(service.listMethod, filters, config)],
            create: async (bulk: unknown) => [...await invoke(service.createMethod, bulk)],
            ...(dismiss === undefined ? {} : { dismiss: async (bulk: unknown) => [...await invoke(dismiss, bulk)] }),
            softDelete: (selector: unknown, config: unknown) => invoke(service.softDeleteMethod, selector, config),
          };
        });
        const native = new Link([...loaded, nativePricingCascadeModule(cascade, invoke)]);
        return { create: input => native.create(structuredClone(input)),
          list: (input, options) => native.list(structuredClone(input), options),
          dismiss: input => native.dismiss(structuredClone(input)),
          delete: input => native.delete(structuredClone(input)),
          listVariantPricing: (filters, config) => listNativeVariantPricing(native, filters, config),
        };
      },
    });
  });
}
