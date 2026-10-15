import { Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { ProductSalesChannel, ProductShippingProfile, ProductVariantInventoryItem, ProductVariantPriceSet } from "@medusajs/link-modules";
import { Modules } from "@medusajs/framework/utils/portable";
import { pricingStaticResources } from "@medusajs/pricing/static-manifest";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { workflowModuleDefinition, type WorkflowModule } from "../workflow/module";
import { ProductLinkBatch } from "./product-service";
import { VariantInventoryLinkBatch, VariantPricingLinkBatch } from "./variant-service";
import { linkWorkflowServiceDefinition } from "./workflow-service";

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
const decodeCascade = commerceDecoder(Schema.Tuple([
  Schema.Union([Schema.Null, Schema.Array(Schema.Struct({ serviceName: Schema.String, method: Schema.String,
    args: Schema.Json, error: Schema.JsonObject })).check(Schema.isLengthBetween(1, 8))]),
  Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Array(Id).check(Schema.isMaxLength(16)))),
]), "storedCorruption");

/** Native routing owns replacement and cascade traversal. Each callback borrows
 * its authentic source command; the asynchronous ABI returns JSON, never a
 * module service, DAL handle or a second transaction owner. */
export function prepareProductUpdateLinkResource(services: {
  readonly sales: unknown; readonly shipping: unknown; readonly inventory: unknown; readonly pricing: unknown;
}, pricingWorkflow: WorkflowModule) {
  return Result.gen(function* () {
    const sales = linkWorkflowServiceDefinition(services.sales), shipping = linkWorkflowServiceDefinition(services.shipping);
    const inventory = linkWorkflowServiceDefinition(services.inventory), pricing = linkWorkflowServiceDefinition(services.pricing);
    const pricingDefinition = workflowModuleDefinition(pricingWorkflow);
    if (sales === undefined || shipping === undefined || inventory === undefined || pricing === undefined || pricingDefinition === undefined)
      return yield* Result.fail(commerceError("invalidAuthority"));
    const selected = [sales, shipping, inventory, pricing];
    const expected = [ProductSalesChannel, ProductShippingProfile, ProductVariantInventoryItem, ProductVariantPriceSet];
    if (selected.some((service, index) => service.routing.__joinerConfig.serviceName !== expected[index]?.serviceName) ||
      pricingWorkflow.name !== Modules.PRICING || pricingDefinition.source.name !== "flarex-pricing-local" ||
      pricingDefinition.source.profile !== "pricing-product-updates")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const salesDismiss = sales.dismissMethod, shippingDismiss = shipping.dismissMethod, inventoryDismiss = inventory.dismissMethod;
    const inventoryDelete = inventory.softDeleteMethod, pricingDelete = pricing.softDeleteMethod;
    const softDeletePriceSets = pricingWorkflow.methods.softDeletePriceSets;
    const pricingJoiner = pricingStaticResources.joinerConfig === undefined ? undefined : structuredClone(pricingStaticResources.joinerConfig);
    if (salesDismiss === undefined || shippingDismiss === undefined || inventoryDismiss === undefined || inventoryDelete === undefined ||
      pricingDelete === undefined || softDeletePriceSets === undefined || pricingJoiner === undefined)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    return yield* defineComposedWorkflowResource({ identity: { format: "medusa.product.update-links",
      services: selected.map(service => service.routing), pricing: { module: pricingWorkflow.name, joiner: pricingJoiner } },
      dependencies: [sales.createMethod, sales.listMethod, salesDismiss, shipping.createMethod, shipping.listMethod, shippingDismiss,
        inventoryDismiss, inventoryDelete, pricing.createMethod, pricing.listMethod, pricingDelete, softDeletePriceSets],
      methods: { create: { arguments: decodeCreate, output: decodeRows }, list: { arguments: decodeList, output: decodeRows },
        dismiss: { arguments: decodeDismiss, output: decodeRows }, delete: { arguments: decodeDelete, output: decodeCascade } },
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
        const nativePricing = { __joinerConfig: structuredClone(pricingJoiner), __definition: {
          key: Modules.PRICING, defaultPackage: "@medusajs/pricing", label: "Pricing", isQueryable: true,
          defaultModuleDeclaration: { scope: "internal" as const },
        }, softDeletePriceSets: (selector: unknown, config: unknown) => invoke(softDeletePriceSets, selector, config) };
        const native = new Link([...loaded, nativePricing]);
        return { create: input => native.create(structuredClone(input)),
          list: (input, options) => native.list(structuredClone(input), options),
          dismiss: input => native.dismiss(structuredClone(input)),
          delete: input => native.delete({ product: { variant_id: [...input.product.variant_id] } }),
        };
      },
    });
  });
}
