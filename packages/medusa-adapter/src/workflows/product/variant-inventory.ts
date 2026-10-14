import { Effect, Result, Schema } from "effect";
import { createProductVariantsWorkflow } from "@medusajs/core-flows/product/create-product-variants";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { SimpleVariantInput } from "../../modules/product/variant-workflow-input";
import { BasePriceInput } from "../../modules/pricing/input";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import type { ProductWorkflowModule } from "../../modules/product/workflow";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import type { makeLocalInventoryCommands } from "../../modules/inventory/service";
import type { makeStockLocationReads } from "../../modules/stock-location/service";
import type { prepareLocalVariantLinks } from "../../links/variant-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { prepareWorkflowResources, type NativeWorkflowContext, type NativeWorkflowResources } from "../../workflow/resources";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule, captureInstalledWorkflowModules } from "../../workflow/host";
import { productVariantInventoryResources } from "../../workflow/policy";
import { orderedProductWorkflowEvents } from "./events";

export const ProductVariantInventoryInput = Schema.Struct({
  product_variants: Schema.Array(Schema.Struct({ ...SimpleVariantInput.fields,
    prices: Schema.optionalKey(Schema.Array(BasePriceInput).check(Schema.isMaxLength(2))),
  })).check(Schema.isLengthBetween(1, 4), Schema.makeFilter(rows => new Set(rows.map(row => row.product_id)).size === 1)),
  additional_data: Schema.optionalKey(Schema.JsonObject),
});
export const ProductVariantInventoryOutput = Schema.Array(Schema.StructWithRest(
  Schema.Struct({ id: Schema.String, title: Schema.String, product_id: Schema.String, manage_inventory: Schema.Boolean,
    prices: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(2)),
  }), [Schema.Record(Schema.String, Schema.Json)],
)).check(Schema.isLengthBetween(1, 4));
const decodeHook = commerceDecoder(Schema.Struct({ product_variants: ProductVariantInventoryOutput,
  additional_data: Schema.optionalKey(Schema.JsonObject),
}), "invalidInput");
const decodeReturnedIds = commerceDecoder(Schema.Array(Schema.StructWithRest(
  Schema.Struct({ id: Schema.String }), [Schema.Record(Schema.String, Schema.Json)],
)), "receiptMismatch");
type PricingModule = Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"];
type InventoryModule = Effect.Success<ReturnType<typeof makeLocalInventoryCommands>>["workflow"];
type StockModule = Effect.Success<ReturnType<typeof makeStockLocationReads>>["workflow"];
type LinkModule = Effect.Success<ReturnType<typeof prepareLocalVariantLinks>>["workflow"];
type Selections = {
  readonly product: { readonly module: ProductWorkflowModule; readonly methods: readonly ["createProductVariants"]; readonly graph: true };
  readonly pricing: { readonly module: PricingModule; readonly methods: readonly ["createPriceSets"]; readonly graph: true };
  readonly inventory: { readonly module: InventoryModule; readonly methods: readonly ["createInventoryItems", "createInventoryLevels"]; readonly graph: true };
  readonly stock_location: { readonly module: StockModule; readonly methods: readonly []; readonly graph: true };
  readonly link: { readonly module: LinkModule; readonly methods: readonly ["create"]; readonly graph: true };
};
type Resources = NativeWorkflowResources<Selections, true>;
export interface ProductVariantInventoryHooks {
  readonly productVariantsCreated?: (input: Result.Result.Success<ReturnType<typeof decodeHook>>,
    context: NativeWorkflowContext<Resources>) => unknown | Promise<unknown>;
}

/** The real native composer owns Inventory defaults, validation, children,
 * routing and Pricing order. The existing trusted host owns settlement. */
export const prepareProductVariantInventoryWorkflow = Effect.fn("MedusaWorkflow.prepareProductVariantInventory")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductWorkflowModule>; readonly pricing: InstalledWorkflowModule<PricingModule>;
    readonly inventory: InstalledWorkflowModule<InventoryModule>; readonly stock_location: InstalledWorkflowModule<StockModule>;
    readonly link: InstalledWorkflowModule<LinkModule> };
  readonly revision: string; readonly subscribers: AtomicCommerceEvents["subscribers"];
  readonly hooks?: ProductVariantInventoryHooks;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["product", "pricing", "inventory", "stock_location", "link"]));
  if (Object.keys(registrations).length !== 5) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registeredHooks = yield* Effect.fromResult(captureWorkflowRecord(options.hooks ?? {}));
  if (Object.keys(registeredHooks).some(name => name !== "productVariantsCreated") ||
    registeredHooks.productVariantsCreated !== undefined && typeof registeredHooks.productVariantsCreated !== "function")
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["createProductVariants"], graph: true },
    pricing: { module: modules.pricing.module, methods: ["createPriceSets"], graph: true },
    inventory: { module: modules.inventory.module, methods: ["createInventoryItems", "createInventoryLevels"], graph: true },
    stock_location: { module: modules.stock_location.module, methods: [], graph: true },
    link: { module: modules.link.module, methods: ["create"], graph: true },
  }, true));
  const handler = registeredHooks.productVariantsCreated;
  type Hooks = NonNullable<Parameters<typeof createProductVariantsWorkflow.prepare>[0]>;
  const hooks: Hooks = handler === undefined ? {} : { productVariantsCreated: resources.callback((value: unknown, context) =>
    captureCommerceInput(value).pipe(Result.flatMap(decodeHook), Result.match({ onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context) }))) };
  const prepared = yield* Effect.fromResult(createProductVariantsWorkflow.prepare(hooks)).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedProductWorkflowEvents("product-variant.created", Effect.fn("VariantWorkflow.returnedIds")(function* (calls) {
    const ids: string[] = [];
    for (const result of calls.results(modules.product.module.methods.createProductVariants)) {
      const rows = yield* Effect.fromResult(decodeReturnedIds(result));
      ids.push(...rows.map(row => row.id));
    }
    return ids;
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productVariantInventoryResources.calls, workflow: {
    name: "createProductVariantsWorkflow", resources, prepared, input: ProductVariantInventoryInput, output: ProductVariantInventoryOutput, events,
  } });
});
