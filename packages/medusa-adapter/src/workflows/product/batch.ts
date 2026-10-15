import { Effect, Result, Schema } from "effect";
import { batchProductsWorkflow } from "@medusajs/core-flows/product/batch-products";
import { batchProductVariantsWorkflow } from "@medusajs/core-flows/product/batch-product-variants";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductBatchWorkflowModule } from "../../modules/product/product-batch-workflow";
import { ProductDeletionIds } from "../../modules/product/commands/deletion";
import { ProductLifecycleIds } from "../../modules/product/lifecycle";
import { ProductUpdateOutput, ProductUpdatePreimages, productUpdateData } from "../../modules/product/product-update-input";
import { SimpleVariantInput, variantUpdateData } from "../../modules/product/variant-workflow-input";
import { BasePriceInput, BasePricesUpdate } from "../../modules/pricing/input";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import type { makeLocalInventoryCommands } from "../../modules/inventory/service";
import { decodeInventoryDeletionInput, inventoryDeletionIds } from "../../modules/inventory/deletion-lifecycle";
import type { makeStockLocationCommands } from "../../modules/stock-location/service";
import type { makeLocalSalesChannelCommands } from "../../modules/sales-channel/service";
import type { makeLocalShippingProfileCommands } from "../../modules/fulfillment/shipping-profile-service";
import type { prepareLocalProductLinks } from "../../links/product-service";
import { VariantInventoryLinkRows, type prepareLocalVariantLinks } from "../../links/variant-service";
import type { prepareProductBatchLinkResource } from "../../links/product-batch-resource";
import { workflowModuleDefinition, type WorkflowMethod } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { prepareWorkflowResources } from "../../workflow/resources";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule, type WorkflowCallResults } from "../../workflow/host";
import { productBatchResources, productBatchParticipantResources } from "../../workflow/policy";
import { decodeGraphCount } from "../../local-graph/query";
import { productCreationWorkflowEntry } from "./create-input";
import { ProductCreationOutput } from "./creation";
import { ProductVariantInventoryOutput } from "./variant-inventory";
import { ProductVariantUpdateOutput } from "./variant-update";
import { orderedProductWorkflowEvents } from "./events";

type Runtime<Factory extends (...args: never[]) => unknown> = Effect.Success<ReturnType<Factory>>;
type Link = Result.Result.Success<ReturnType<typeof prepareProductBatchLinkResource>>;
type SharedSelections = {
  readonly pricing: { readonly module: Runtime<typeof makeLocalPricingCommands>["workflow"]; readonly methods: readonly ["createPriceSets", "listPriceSets", "upsertPriceSets", "updatePriceSets", "softDeletePriceSets"]; readonly graph: true };
  readonly inventory: { readonly module: Runtime<typeof makeLocalInventoryCommands>["workflow"]; readonly methods: readonly ["createInventoryItems", "createInventoryLevels", "softDeleteInventoryItems"]; readonly graph: true };
  readonly stock_location: { readonly module: Runtime<typeof makeStockLocationCommands>["workflow"]; readonly methods: readonly []; readonly graph: true };
  readonly sales_channel: { readonly module: Runtime<typeof makeLocalSalesChannelCommands>["workflow"]; readonly methods: readonly []; readonly graph: true };
  readonly fulfillment: { readonly module: Runtime<typeof makeLocalShippingProfileCommands>["workflow"]; readonly methods: readonly []; readonly graph: true };
  readonly product_links: { readonly module: Runtime<typeof prepareLocalProductLinks>["workflow"]; readonly methods: readonly ["salesNativeCreate", "salesNativeList", "salesNativeDismiss", "salesNativeSoftDelete", "shippingNativeCreate", "shippingNativeList", "shippingNativeDismiss", "shippingNativeSoftDelete"]; readonly graph: true; readonly expose: false };
  readonly variant_links: { readonly module: Runtime<typeof prepareLocalVariantLinks>["workflow"]; readonly methods: readonly ["inventoryNativeCreate", "inventoryNativeList", "inventoryNativeDismiss", "inventoryNativeSoftDelete", "pricingNativeCreate", "pricingNativeList", "pricingNativeSoftDelete"]; readonly graph: true; readonly expose: false };
};
interface BatchInput {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductBatchWorkflowModule> } & {
    readonly [Key in keyof SharedSelections]: InstalledWorkflowModule<SharedSelections[Key]["module"]>;
  };
  readonly link: Link; readonly revision: string; readonly subscribers: AtomicCommerceEvents["subscribers"];
}
const Id = ProductLifecycleIds.value;
const IdRows = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id }), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4));
const decodeIdRows = commerceDecoder(IdRows, "receiptMismatch");
const decodeIds = commerceDecoder(ProductDeletionIds, "receiptMismatch");
const decodeProducts = commerceDecoder(ProductUpdatePreimages, "receiptMismatch");
const decodeInventoryLinks = commerceDecoder(VariantInventoryLinkRows, "receiptMismatch");
const CreatedProducts = Schema.Array(ProductCreationOutput.value).check(Schema.isMaxLength(4));
const CreatedVariants = Schema.Array(ProductVariantInventoryOutput.value).check(Schema.isMaxLength(4));
export const ProductBatchOutput = Schema.Struct({ created: CreatedProducts, updated: ProductUpdateOutput, deleted: ProductDeletionIds });
export const ProductVariantBatchOutput = Schema.Struct({ created: CreatedVariants, updated: ProductVariantUpdateOutput, deleted: ProductDeletionIds });

const prepareInputs = Effect.fn("ProductBatch.prepareInputs")(function* (input: BatchInput) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "link", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 8) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const captured = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations,
    ["product", "pricing", "inventory", "stock_location", "sales_channel", "fulfillment", "product_links", "variant_links"]));
  const definition = workflowModuleDefinition(captured.product.module);
  const inventory = workflowModuleDefinition(captured.inventory.module);
  const product = definition?.graph.reads.find(read => read.model === "Product");
  const variant = definition?.graph.reads.find(read => read.model === "ProductVariant");
  if (definition?.source.name !== "flarex-product-local" || definition.source.profile !== "public.product-batches" || !product || !variant ||
    inventory?.source.name !== "flarex-inventory-local" || inventory.source.profile !== "inventory-product-batches" ||
    captured.inventory.module.methods.softDeleteInventoryItems === undefined)
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const select = <Module extends InstalledWorkflowModule>(binding: Module) => {
    const { logicalPublication: _publication, ...selected } = binding;
    return { ...selected, logicalResources: productBatchParticipantResources };
  };
  const modules = { product: { ...select(captured.product), logicalResources: productBatchResources, logicalPublication: "mixed" as const },
    pricing: { ...select(captured.pricing), logicalPublication: "mixed" as const }, inventory: select(captured.inventory),
    stock_location: select(captured.stock_location), sales_channel: select(captured.sales_channel), fulfillment: select(captured.fulfillment),
    product_links: select(captured.product_links), variant_links: select(captured.variant_links) };
  const shared = {
    pricing: { module: captured.pricing.module, methods: ["createPriceSets", "listPriceSets", "upsertPriceSets", "updatePriceSets", "softDeletePriceSets"], graph: true },
    inventory: { module: captured.inventory.module, methods: ["createInventoryItems", "createInventoryLevels", "softDeleteInventoryItems"], graph: true },
    stock_location: { module: captured.stock_location.module, methods: [], graph: true },
    sales_channel: { module: captured.sales_channel.module, methods: [], graph: true },
    fulfillment: { module: captured.fulfillment.module, methods: [], graph: true },
    product_links: { module: captured.product_links.module, methods: ["salesNativeCreate", "salesNativeList", "salesNativeDismiss", "salesNativeSoftDelete", "shippingNativeCreate", "shippingNativeList", "shippingNativeDismiss", "shippingNativeSoftDelete"], graph: true, expose: false },
    variant_links: { module: captured.variant_links.module, methods: ["inventoryNativeCreate", "inventoryNativeList", "inventoryNativeDismiss", "inventoryNativeSoftDelete", "pricingNativeCreate", "pricingNativeList", "pricingNativeSoftDelete"], graph: true, expose: false },
  } satisfies SharedSelections;
  return { options, captured, modules, shared, product, variant, inventoryDeletion: captured.inventory.module.methods.softDeleteInventoryItems };
});

const resultIds = (methods: readonly WorkflowMethod[]) => Effect.fn("ProductBatch.returnedIds")(function* (calls: WorkflowCallResults) {
  const ids: string[] = [];
  for (const method of methods) for (const result of calls.results(method)) ids.push(...(yield* Effect.fromResult(decodeIdRows(result))).map(row => row.id));
  return ids;
});
const requestedIds = (method: WorkflowMethod) => Effect.fn("ProductBatch.requestedIds")(function* (calls: WorkflowCallResults) {
  const ids: string[] = [];
  for (const call of calls.calls(method)) ids.push(...yield* Effect.fromResult(decodeIds(call.input)));
  return ids;
});

/** Native results bound incoming Variants. Variant roots also expose their old
 * cohort directly; Product's old cohort is checked by its aggregate receipt
 * policy because sparse native Product reads can omit retained Variants. */
const validateCohorts = Effect.fn("ProductBatch.validateCohorts")(function* (calls: WorkflowCallResults, product: ProductBatchWorkflowModule, kind: "product" | "variant") {
  const old = new Set<string>(), incoming = new Set<string>();
  const nested = (rows: typeof ProductUpdatePreimages.Type, destination: Set<string>) => {
    for (const row of rows) for (const variant of row.variants ?? []) destination.add(variant.id);
  };
  if (kind === "product") {
    for (const method of [product.methods.upsertProducts, product.methods.updateProducts])
      for (const result of calls.results(method)) nested(yield* Effect.fromResult(decodeProducts(result)), incoming);
  } else {
    for (const result of calls.results(product.methods.listProductVariants))
      for (const row of yield* Effect.fromResult(decodeIdRows(result))) old.add(row.id);
    for (const call of calls.calls(product.methods.countProductVariantsForBatch)) {
      const config = isJsonObject(call.input) ? call.input.config : undefined;
      if (config === undefined || !isJsonObject(config) || !Array.isArray(config.select) || !config.select.includes("manage_inventory")) continue;
      const [rows] = yield* Effect.fromResult(decodeGraphCount(call.result));
      for (const row of yield* Effect.fromResult(decodeIdRows(rows))) old.add(row.id);
    }
    for (const method of [product.methods.upsertProductVariants, product.methods.updateProductVariants])
      for (const result of calls.results(method)) for (const row of yield* Effect.fromResult(decodeIdRows(result))) incoming.add(row.id);
  }
  for (const result of calls.results(product.methods.createProductVariants))
    for (const row of yield* Effect.fromResult(decodeIdRows(result))) incoming.add(row.id);
  if (old.size > 4 || incoming.size > 4) return yield* Effect.fail(commerceError("unsupportedProfile"));
});

/** This bounded composition excludes Item IDs both attached and requested for
 * deletion by successful siblings. Native deletion snapshots do not establish
 * final active ownership across parallel children. This order-independent scope
 * restriction uses existing receipts and performs no additional reads. */
const validateItemLifetime = Effect.fn("ProductBatch.validateItemLifetime")(function* (
  calls: WorkflowCallResults, deletion: WorkflowMethod, attachment: WorkflowMethod,
) {
  const deleted = new Set<string>();
  for (const call of calls.calls(deletion)) {
    const input = yield* Effect.fromResult(decodeInventoryDeletionInput(call.input));
    for (const id of inventoryDeletionIds(input.selector)) deleted.add(id);
  }
  for (const result of calls.results(attachment)) {
    for (const row of yield* Effect.fromResult(decodeInventoryLinks(result))) {
      if (deleted.has(row.inventory_item_id)) return yield* Effect.fail(commerceError("unsupportedProfile"));
    }
  }
});

export const prepareProductBatchWorkflow = Effect.fn("ProductBatch.prepareProduct")(function* (input: BatchInput) {
  const { options, captured, modules, shared, product, variant, inventoryDeletion } = yield* prepareInputs(input);
  const variants = Schema.Array(variantUpdateData(variant.table.columns, { id: Schema.optionalKey(Id), prices: Schema.optionalKey(BasePricesUpdate) })).check(Schema.isMaxLength(4));
  const update = productUpdateData(product.table.columns, { id: Id, variants: Schema.optionalKey(variants),
    sales_channels: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(2))), shipping_profile_id: Schema.optionalKey(Schema.NullOr(Id)) });
  const boundary = Schema.Struct({ create: Schema.optionalKey(Schema.Array(productCreationWorkflowEntry(product.table.columns)).check(Schema.isMaxLength(4))),
    update: Schema.optionalKey(Schema.Array(update).check(Schema.isMaxLength(4))), delete: Schema.optionalKey(ProductDeletionIds),
  }).check(Schema.makeFilter(value => (value.create?.length ?? 0) + (value.update?.length ?? 0) + (value.delete?.length ?? 0) <= 4),
    Schema.makeFilter(value => [...value.create ?? [], ...value.update ?? []].reduce((sum, row) => sum + (row.variants?.length ?? 0), 0) <= 4));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ ...shared, product: { module: captured.product.module,
    methods: ["createProducts", "createProductVariants", "listProducts", "upsertProducts", "updateProducts", "softDeleteProducts", "countProductVariantsForBatch"], graph: true } }, true, { link: options.link }));
  const prepared = yield* Effect.fromResult(batchProductsWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const method = captured.product.module.methods;
  const policies = [orderedProductWorkflowEvents("product-variant.created", resultIds([method.createProductVariants])),
    orderedProductWorkflowEvents("product.created", resultIds([method.createProducts])),
    orderedProductWorkflowEvents("product.updated", resultIds([method.upsertProducts, method.updateProducts])),
    orderedProductWorkflowEvents("product.deleted", requestedIds(method.softDeleteProducts))];
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productBatchResources.calls, requestByteLimit: productBatchResources.commandBytes,
    requestEventLimit: productBatchResources.eventMessages, operationScheduling: "queued", workflow: { name: "batchProductsWorkflow", resources, prepared, input: boundary, output: ProductBatchOutput,
      events: { contracts: policies.flatMap(policy => policy.contracts), validate: Effect.fn("ProductBatch.validateEvents")(function* (events: Parameters<AtomicCommerceEvents["validate"]>[0], calls: WorkflowCallResults) {
        for (const policy of policies) yield* policy.validate(events, calls);
        yield* validateCohorts(calls, captured.product.module, "product");
        yield* validateItemLifetime(calls, inventoryDeletion, captured.variant_links.module.methods.inventoryNativeCreate);
      }) } } });
});

export const prepareProductVariantBatchWorkflow = Effect.fn("ProductBatch.prepareVariant")(function* (input: BatchInput) {
  const { options, captured, modules, shared, variant, inventoryDeletion } = yield* prepareInputs(input);
  const create = Schema.Struct({ ...SimpleVariantInput.fields, prices: Schema.optionalKey(Schema.Array(BasePriceInput).check(Schema.isMaxLength(2))) });
  const update = variantUpdateData(variant.table.columns, { id: Id, prices: Schema.optionalKey(BasePricesUpdate) });
  const boundary = Schema.Struct({ create: Schema.optionalKey(Schema.Array(create).check(Schema.isMaxLength(4))),
    update: Schema.optionalKey(Schema.Array(update).check(Schema.isMaxLength(4))), delete: Schema.optionalKey(ProductDeletionIds),
  }).check(Schema.makeFilter(value => (value.create?.length ?? 0) + (value.update?.length ?? 0) + (value.delete?.length ?? 0) <= 4));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ ...shared, product: { module: captured.product.module,
    methods: ["createProductVariants", "listProductVariants", "upsertProductVariants", "updateProductVariants", "softDeleteProductVariants", "countProductVariantsForBatch"], graph: true } }, true, { link: options.link }));
  const prepared = yield* Effect.fromResult(batchProductVariantsWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const method = captured.product.module.methods;
  const policies = [orderedProductWorkflowEvents("product-variant.created", resultIds([method.createProductVariants])),
    orderedProductWorkflowEvents("product-variant.updated", resultIds([method.upsertProductVariants, method.updateProductVariants])),
    orderedProductWorkflowEvents("product-variant.deleted", requestedIds(method.softDeleteProductVariants))];
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productBatchResources.calls, requestByteLimit: productBatchResources.commandBytes,
    requestEventLimit: productBatchResources.eventMessages, operationScheduling: "queued", workflow: { name: "batchProductVariantsWorkflow", resources, prepared, input: boundary, output: ProductVariantBatchOutput,
      events: { contracts: policies.flatMap(policy => policy.contracts), validate: Effect.fn("VariantBatch.validateEvents")(function* (events: Parameters<AtomicCommerceEvents["validate"]>[0], calls: WorkflowCallResults) {
        for (const policy of policies) yield* policy.validate(events, calls);
        yield* validateCohorts(calls, captured.product.module, "variant");
        yield* validateItemLifetime(calls, inventoryDeletion, captured.variant_links.module.methods.inventoryNativeCreate);
      }) } } });
});
