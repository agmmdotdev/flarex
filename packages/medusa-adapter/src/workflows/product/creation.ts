import { Effect, Result, Schema } from "effect";
import { createProductsWorkflow } from "@medusajs/core-flows/product/create-products";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileProductDefinition } from "../../modules/product/definition";
import { productCreationInput, ProductImageCreateInput } from "./create-input";
import { SimpleVariantInput } from "../../modules/product/variant-workflow-input";
import { ProductVariantInventoryOutput } from "./variant-inventory";
import { BasePriceInput } from "../../modules/pricing/input";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { orderedProductWorkflowEvents } from "./events";
import type { ProductWorkflowModule } from "../../modules/product/workflow";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import type { makeLocalInventoryCommands } from "../../modules/inventory/service";
import type { makeStockLocationCommands } from "../../modules/stock-location/service";
import type { makeLocalSalesChannelCommands } from "../../modules/sales-channel/service";
import type { makeLocalShippingProfileCommands } from "../../modules/fulfillment/shipping-profile-service";
import type { prepareLocalProductLinks } from "../../links/product-service";
import type { prepareLocalVariantLinks } from "../../links/variant-service";
import type { prepareProductNativeLinkResource } from "../../links/product-resource";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { prepareWorkflowResources, type NativeWorkflowContext, type NativeWorkflowResources } from "../../workflow/resources";
import type { ComposedWorkflowServices } from "../../workflow/composed-resource";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule, type WorkflowCallResults, captureInstalledWorkflowModules } from "../../workflow/host";
import { productCreationResources } from "../../workflow/policy";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const { product_id: _parent, ...variantFields } = SimpleVariantInput.fields;
const Variants = Schema.Array(Schema.Struct({ ...variantFields,
  prices: Schema.optionalKey(Schema.Array(BasePriceInput).check(Schema.isMaxLength(2))),
})).check(Schema.isMaxLength(4));
export const ProductCreationOutput = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id, title: Schema.String,
  variants: Schema.Array(ProductVariantInventoryOutput.value).check(Schema.isMaxLength(4)),
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isLengthBetween(1, 4));
const decodeHook = commerceDecoder(Schema.Struct({ products: ProductCreationOutput, additional_data: Schema.optionalKey(Schema.JsonObject) }), "invalidInput");
const decodeReturnedIds = commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id }), [Schema.Record(Schema.String, Schema.Json)])), "receiptMismatch");

type Runtime<Factory extends (...args: never[]) => unknown> = Effect.Success<ReturnType<Factory>>;
type ProductLinks = Runtime<typeof prepareLocalProductLinks>["workflow"];
type VariantLinks = Runtime<typeof prepareLocalVariantLinks>["workflow"];
type Selections = {
  readonly product: { readonly module: ProductWorkflowModule; readonly methods: readonly ["createProducts", "createProductVariants"]; readonly graph: true };
  readonly pricing: { readonly module: Runtime<typeof makeLocalPricingCommands>["workflow"]; readonly methods: readonly ["createPriceSets"]; readonly graph: true };
  readonly inventory: { readonly module: Runtime<typeof makeLocalInventoryCommands>["workflow"]; readonly methods: readonly ["createInventoryItems", "createInventoryLevels"]; readonly graph: true };
  readonly stock_location: { readonly module: Runtime<typeof makeStockLocationCommands>["workflow"]; readonly methods: readonly []; readonly graph: true };
  readonly sales_channel: { readonly module: Runtime<typeof makeLocalSalesChannelCommands>["workflow"]; readonly methods: readonly []; readonly graph: true };
  readonly fulfillment: { readonly module: Runtime<typeof makeLocalShippingProfileCommands>["workflow"]; readonly methods: readonly []; readonly graph: true };
  readonly product_links: { readonly module: ProductLinks; readonly methods: readonly ["salesNativeCreate", "salesNativeList", "shippingNativeCreate", "shippingNativeList"]; readonly graph: true; readonly expose: false };
  readonly variant_links: { readonly module: VariantLinks; readonly methods: readonly ["inventoryNativeCreate", "inventoryNativeList", "pricingNativeCreate", "pricingNativeList"]; readonly graph: true; readonly expose: false };
};
type LinkResource = Result.Result.Success<ReturnType<typeof prepareProductNativeLinkResource>>;
type Resources = NativeWorkflowResources<Selections, true> & ComposedWorkflowServices<{ readonly link: LinkResource }>;
export interface ProductCreationHooks {
  readonly productsCreated?: (input: Result.Result.Success<ReturnType<typeof decodeHook>>, context: NativeWorkflowContext<Resources>) => unknown | Promise<unknown>;
}

/** The complete pinned composer borrows each original source. It owns business
 * sequencing; the existing host owns the only settlement and durable outcome. */
export const prepareProductCreationWorkflow = Effect.fn("MedusaWorkflow.prepareProductCreation")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly [Key in keyof Selections]: InstalledWorkflowModule<Selections[Key]["module"]> };
  readonly link: LinkResource;
  readonly revision: string; readonly subscribers: AtomicCommerceEvents["subscribers"];
  readonly hooks?: ProductCreationHooks;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 8) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["product", "pricing", "inventory", "stock_location", "sales_channel", "fulfillment", "product_links", "variant_links"]));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["createProducts", "createProductVariants"], graph: true },
    pricing: { module: modules.pricing.module, methods: ["createPriceSets"], graph: true },
    inventory: { module: modules.inventory.module, methods: ["createInventoryItems", "createInventoryLevels"], graph: true },
    stock_location: { module: modules.stock_location.module, methods: [], graph: true },
    sales_channel: { module: modules.sales_channel.module, methods: [], graph: true },
    fulfillment: { module: modules.fulfillment.module, methods: [], graph: true },
    product_links: { module: modules.product_links.module, methods: ["salesNativeCreate", "salesNativeList", "shippingNativeCreate", "shippingNativeList"], graph: true, expose: false },
    variant_links: { module: modules.variant_links.module, methods: ["inventoryNativeCreate", "inventoryNativeList", "pricingNativeCreate", "pricingNativeList"], graph: true, expose: false },
  }, true, { link: options.link }));
  const metadata = yield* compileProductDefinition();
  const product = metadata.metadata.tables.find(table => table.name === "product");
  if (!product) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const base = productCreationInput(product.columns.map(column => column.name));
  const Product = Schema.Struct({ ...base.fields,
    tag_ids: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(4))),
    category_ids: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(4))),
    images: Schema.optionalKey(Schema.Array(ProductImageCreateInput).check(Schema.isMaxLength(2))),
    options: Schema.optionalKey(Schema.Array(Schema.Struct({ title: Schema.String,
      values: Schema.Array(Schema.String).check(Schema.isLengthBetween(1, 4)),
    })).check(Schema.isMaxLength(1))),
    variants: Schema.optionalKey(Variants),
    sales_channels: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(2))),
    shipping_profile_id: Schema.optionalKey(Id),
  });
  const contract = Schema.Struct({ products: Schema.Array(Product).check(Schema.isLengthBetween(1, 4),
    Schema.makeFilter(products => products.reduce((total, product) => total + (product.variants?.length ?? 0), 0) <= 4)),
    additional_data: Schema.optionalKey(Schema.JsonObject),
  });
  const registeredHooks = yield* Effect.fromResult(captureWorkflowRecord(options.hooks ?? {}));
  if (Object.keys(registeredHooks).some(name => name !== "productsCreated") ||
    registeredHooks.productsCreated !== undefined && typeof registeredHooks.productsCreated !== "function")
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const handler = registeredHooks.productsCreated;
  type Hooks = NonNullable<Parameters<typeof createProductsWorkflow.prepare>[0]>;
  const hooks: Hooks = handler === undefined ? {} : { productsCreated: resources.callback((value: unknown, context) =>
    captureCommerceInput(value).pipe(Result.flatMap(decodeHook), Result.match({ onFailure: error => Promise.reject(error), onSuccess: value => handler(value, context) }))) };
  const prepared = yield* Effect.fromResult(createProductsWorkflow.prepare(hooks)).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const ids = (method: Parameters<WorkflowCallResults["results"]>[0]) => Effect.fn("ProductCreation.returnedIds")(function* (calls: WorkflowCallResults) {
    const result: string[] = [];
    for (const rows of calls.results(method)) result.push(...(yield* Effect.fromResult(decodeReturnedIds(rows))).map(row => row.id));
    return result;
  });
  const policies = [orderedProductWorkflowEvents("product-variant.created", ids(modules.product.module.methods.createProductVariants)),
    orderedProductWorkflowEvents("product.created", ids(modules.product.module.methods.createProducts))];
  const events = { contracts: policies.flatMap(policy => policy.contracts),
    validate: Effect.fn("ProductCreation.validateEvents")(function* (events: Parameters<AtomicCommerceEvents["validate"]>[0], calls: WorkflowCallResults) {
      for (const policy of policies) yield* policy.validate(events, calls);
      const external = events.filter(event => !event.internal).map(event => event.contract);
      if (external.some((name, index) => name === "product-variant.created" && external.slice(0, index).includes("product.created")))
        return yield* Effect.fail(commerceError("receiptMismatch"));
    }),
  };
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productCreationResources.calls,
    requestEventLimit: productCreationResources.eventMessages,
    workflow: { name: "createProductsWorkflow", resources, prepared, input: contract, output: ProductCreationOutput, events } });
});
