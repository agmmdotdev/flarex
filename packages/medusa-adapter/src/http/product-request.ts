import { Cause, Effect, Exit, Result, Scope } from "effect";
import { asValue, type AwilixContainer } from "@medusajs/deps/awilix-portable";
import { MedusaError } from "@medusajs/utils/common/errors";
import { Modules } from "@medusajs/utils/modules-sdk/definition";
import type { MedusaRequest } from "@medusajs/framework/http";
import { makeCoreSchemaBundle, type CoreDatabase, type CoreNativeDefinition } from "@flarex/persistence-postgres/internal/core";
import type { PreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { makeAtomicCommerceNativeHost, defineAtomicCommerceNativeSource, compileCoreNativeEventStorageDefinition } from "@flarex/persistence-postgres/internal/commerce-native";
import { capturePrivateCanonicalValue, commerceError, CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { type CommerceCommand, type AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { compileProductCoreDefinition } from "../modules/product/schema";
import { makeLocalProductCommands } from "../modules/product/service";
import { compilePricingCoreDefinition } from "../modules/pricing/schema";
import { makeLocalPricingCommands } from "../modules/pricing/service";
import { compileInventoryCoreDefinition } from "../modules/inventory/schema";
import { makeLocalInventoryCommands } from "../modules/inventory/service";
import { compileStockLocationCoreDefinition } from "../modules/stock-location/schema";
import { makeStockLocationCommands } from "../modules/stock-location/service";
import { compileSalesChannelCoreDefinition } from "../modules/sales-channel/schema";
import { makeLocalSalesChannelCommands } from "../modules/sales-channel/service";
import { compileShippingProfileCoreDefinition } from "../modules/fulfillment/shipping-profile-schema";
import { makeLocalShippingProfileCommands } from "../modules/fulfillment/shipping-profile-service";
import { compileProductLinksCoreDefinition } from "../links/product-definition";
import { prepareLocalProductLinks } from "../links/product-service";
import { compileVariantLinksCoreDefinition } from "../links/variant-definition";
import { prepareLocalVariantLinks } from "../links/variant-service";
import { prepareProductNativeLinkResource } from "../links/product-resource";
import { prepareProductUpdateLinkResource } from "../links/product-update-resource";
import { prepareProductDeletionLinkResource } from "../links/product-deletion-resource";
import { prepareProductOptionDeletionLinkResource } from "../links/product-option-resource";
import { prepareProductTypeDeletionLinkResource } from "../links/product-type-resource";
import { prepareProductCategoryDeletionLinkResource } from "../links/product-category-resource";
import { prepareProductCollectionDeletionLinkResource } from "../links/product-collection-resource";
import { prepareProductCategoryCreationWorkflow, prepareProductCategoryUpdateWorkflow, prepareProductCategoryDeletionWorkflow } from "../workflows/product/category-workflows";
import { prepareProductCollectionCreationWorkflow, prepareProductCollectionUpdateWorkflow, prepareProductCollectionDeletionWorkflow } from "../workflows/product/collection-workflows";
import { prepareProductCategoryMembershipWorkflow } from "../workflows/product/category";
import { prepareProductCollectionMembershipWorkflow } from "../workflows/product/collection";
import { prepareProductTypeCreationWorkflow, prepareProductTypeUpdateWorkflow, prepareProductTypeDeletionWorkflow } from "../workflows/product/type";
import { prepareProductTagWorkflow } from "../workflows/product/tag";
import { prepareProductTagUpdateWorkflow } from "../workflows/product/tag-update";
import { prepareProductTagDeleteWorkflow } from "../workflows/product/tag-delete";
import { prepareProductCreationWorkflow } from "../workflows/product/creation";
import { prepareProductUpdateWorkflow } from "../workflows/product/update";
import { prepareProductDeletionWorkflow, prepareProductVariantDeletionWorkflow } from "../workflows/product/deletion";
import { prepareProductVariantInventoryWorkflow } from "../workflows/product/variant-inventory";
import { prepareProductVariantUpdateWorkflow } from "../workflows/product/variant-update";
import { prepareProductOptionCreationWorkflow, prepareProductOptionUpdateWorkflow, prepareProductOptionDeletionWorkflow } from "../workflows/product/option-workflows";
import { prepareVariantImagesWorkflow, prepareImageVariantsWorkflow } from "../workflows/product/variant-images";
import { captureCommerceInput } from "../value/input";
import type { AtomicWorkflowExecution } from "../workflow/host";
import { makeProductRequestReads } from "./product-request-reads";

/** Metadata production only. Bootstrap must separately admit the bundle and
 * commit all exact empty-source initialization receipts before HTTP activation. */
export const compileProductRequestCatalog = Effect.fn("ProductRequest.compileCatalog")(function* (
  target: Readonly<{ scopeUuid: string; epochUuid: string }>,
) {
  const product = yield* makeLocalProductCommands(), pricing = yield* makeLocalPricingCommands(), inventory = yield* makeLocalInventoryCommands();
  const inventoryReads = yield* makeLocalInventoryCommands("variant-price-calculation");
  const stock = yield* makeStockLocationCommands(), sales = yield* makeLocalSalesChannelCommands(), fulfillment = yield* makeLocalShippingProfileCommands();
  const productLinks = yield* prepareLocalProductLinks(), variantLinks = yield* prepareLocalVariantLinks();
  const updatePricing = yield* makeLocalPricingCommands("product-updates");
  const variantUpdatePricing = yield* makeLocalPricingCommands("variant-updates");
  const variantUpdateLinks = yield* prepareLocalVariantLinks("variant-updates");
  const updateProductLinks = yield* prepareLocalProductLinks("product-updates"), updateVariantLinks = yield* prepareLocalVariantLinks("product-updates");
  const deletionInventory = yield* makeLocalInventoryCommands("product-deletions");
  const deletionProductLinks = yield* prepareLocalProductLinks("product-deletions"), deletionVariantLinks = yield* prepareLocalVariantLinks("product-deletions");
  const empty = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
  const source = (name: string, definition: CoreNativeDefinition, commands: readonly CommerceCommand[]) => defineAtomicCommerceNativeSource(name, definition).pipe(
    Result.map(native => Object.freeze({ name, definition, source: native, commands: Object.freeze([...commands]),
      initialization: Object.freeze({ stepId: `${name}-initial`, datasetSha256: empty.sha256Hex, expectedRowCount: 0 }) })));
  const productSource = yield* Effect.fromResult(source("product", yield* compileProductCoreDefinition(target), Object.values(product.commands)));
  const pricingSource = yield* Effect.fromResult(source("pricing", yield* compilePricingCoreDefinition(target), pricing.commands));
  const inventorySource = yield* Effect.fromResult(source("inventory", yield* compileInventoryCoreDefinition(target), inventory.commands));
  const stockSource = yield* Effect.fromResult(source("stock_location", yield* compileStockLocationCoreDefinition(target), stock.commands));
  const salesSource = yield* Effect.fromResult(source("sales_channel", yield* compileSalesChannelCoreDefinition(target), sales.commands));
  const fulfillmentSource = yield* Effect.fromResult(source("fulfillment", yield* compileShippingProfileCoreDefinition(target), fulfillment.commands));
  const productLinksSource = yield* Effect.fromResult(source("product_links", yield* compileProductLinksCoreDefinition(target, { salesChannel: true, shippingProfile: true }), productLinks.commands));
  const variantLinksSource = yield* Effect.fromResult(source("variant_links", yield* compileVariantLinksCoreDefinition(target), variantLinks.commands));
  const sources = Object.freeze([productSource, pricingSource, inventorySource, stockSource, salesSource, fulfillmentSource, productLinksSource, variantLinksSource]);
  const eventDefinition = yield* compileCoreNativeEventStorageDefinition(target);
  const bundle = yield* makeCoreSchemaBundle({ sources: [...sources.map(member => ({ kind: "native" as const, definition: member.definition })),
    { kind: "native", definition: eventDefinition }] });
  const modules = Object.freeze({ product: { module: product.workflow, nativeStorage: productSource.source },
    pricing: { module: pricing.workflow, nativeStorage: pricingSource.source }, inventory: { module: inventory.workflow, nativeStorage: inventorySource.source },
    stock_location: { module: stock.workflow, nativeStorage: stockSource.source }, sales_channel: { module: sales.workflow, nativeStorage: salesSource.source },
    fulfillment: { module: fulfillment.workflow, nativeStorage: fulfillmentSource.source },
    product_links: { module: productLinks.workflow, nativeStorage: productLinksSource.source }, variant_links: { module: variantLinks.workflow, nativeStorage: variantLinksSource.source } });
  const link = yield* Effect.fromResult(prepareProductNativeLinkResource([productLinks.nativeServices.sales, productLinks.nativeServices.shipping,
    variantLinks.nativeServices.inventory, variantLinks.nativeServices.pricing]));
  const updateModules = Object.freeze({ product: { module: product.productUpdateWorkflow, nativeStorage: productSource.source },
    pricing: { module: updatePricing.workflow, nativeStorage: pricingSource.source },
    product_links: { module: updateProductLinks.workflow, nativeStorage: productLinksSource.source },
    variant_links: { module: updateVariantLinks.workflow, nativeStorage: variantLinksSource.source } });
  const updateLink = yield* Effect.fromResult(prepareProductUpdateLinkResource({ sales: updateProductLinks.nativeServices.sales,
    shipping: updateProductLinks.nativeServices.shipping, inventory: updateVariantLinks.nativeServices.inventory,
    pricing: updateVariantLinks.nativeServices.pricing }, updatePricing.workflow));
  const deletionModules = Object.freeze({ product: { module: product.productDeletionWorkflow, nativeStorage: productSource.source },
    inventory: { module: deletionInventory.workflow, nativeStorage: inventorySource.source },
    pricing: { module: updatePricing.workflow, nativeStorage: pricingSource.source },
    product_links: { module: deletionProductLinks.workflow, nativeStorage: productLinksSource.source },
    variant_links: { module: deletionVariantLinks.workflow, nativeStorage: variantLinksSource.source } });
  const deletionLink = yield* Effect.fromResult(prepareProductDeletionLinkResource({ sales: deletionProductLinks.nativeServices.sales,
    shipping: deletionProductLinks.nativeServices.shipping, inventory: deletionVariantLinks.nativeServices.inventory,
    pricing: deletionVariantLinks.nativeServices.pricing }, updatePricing.workflow));
  const variantUpdateModules = Object.freeze({ product: { module: product.variantUpdateWorkflow, nativeStorage: productSource.source },
    pricing: { module: variantUpdatePricing.workflow, nativeStorage: pricingSource.source },
    variant_links: { module: variantUpdateLinks.workflow, nativeStorage: variantLinksSource.source } });
  const optionModules = Object.freeze({ product: { module: product.productOptionWorkflow, nativeStorage: productSource.source } });
  const optionDeletionLink = yield* Effect.fromResult(prepareProductOptionDeletionLinkResource());
  const typeModules = Object.freeze({ product: { module: product.productTypeWorkflow, nativeStorage: productSource.source } });
  const typeDeletionLink = yield* Effect.fromResult(prepareProductTypeDeletionLinkResource());
  const categoryModules = Object.freeze({ product: { module: product.productCategoryWorkflow, nativeStorage: productSource.source } });
  const categoryDeletionLink = yield* Effect.fromResult(prepareProductCategoryDeletionLinkResource());
  const collectionModules = Object.freeze({ product: { module: product.productCollectionWorkflow, nativeStorage: productSource.source } });
  const collectionDeletionLink = yield* Effect.fromResult(prepareProductCollectionDeletionLinkResource());
  const variantImageModules = Object.freeze({ product: { module: product.productVariantImageWorkflow, nativeStorage: productSource.source } });
  const imageVariantModules = Object.freeze({ product: { module: product.productImageVariantWorkflow, nativeStorage: productSource.source } });
  return Object.freeze({ target: Object.freeze({ ...target }), sources, productSource, productRuntime: product,
    runtimes: Object.freeze({ product, pricing, inventory, inventoryReads, stock, sales, fulfillment, productLinks, variantLinks }), modules, link, updateModules, updateLink,
    deletionModules, deletionLink, variantUpdateModules, variantUpdateNativeLinks: variantUpdateLinks.nativeServices, optionModules, optionDeletionLink, typeModules, typeDeletionLink, categoryModules, categoryDeletionLink, collectionModules, collectionDeletionLink, variantImageModules, imageVariantModules, bundle, eventDefinition });
});
export type ProductRequestCatalog = Effect.Success<ReturnType<typeof compileProductRequestCatalog>>;

/** Existing atomic Core execution owns mutations and committed outcomes. The
 * POST's subsequent refetch is an independent native Product read operation. */
export const makeProductRequestOperations = Effect.fn("ProductRequest.makeOperations")(function* (input: Readonly<{
  database: CoreDatabase; hostRuntime: PreparedHostRuntime; catalog: ProductRequestCatalog; identityAndAccessPolicy: Json;
  revision: string; subscribers: AtomicCommerceEvents["subscribers"];
}>) {
  const generationScope = yield* Effect.scope;
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: input.identityAndAccessPolicy,
    prepare: composition => Scope.provide(generationScope)(Effect.acquireRelease(makeAtomicCommerceNativeHost({ ...composition,
      database: input.database, hostRuntime: input.hostRuntime, bundle: input.catalog.bundle, sources: input.catalog.sources,
      eventStorage: { definition: input.catalog.eventDefinition } }), host => host.close)),
  };
  const workflow = yield* prepareProductCreationWorkflow({ execution, modules: input.catalog.modules, link: input.catalog.link,
    revision: input.revision, subscribers: input.subscribers });
  const update = yield* prepareProductUpdateWorkflow({ execution, modules: input.catalog.updateModules,
    link: input.catalog.updateLink, revision: input.revision, subscribers: input.subscribers });
  const deletion = yield* prepareProductDeletionWorkflow({ execution, modules: input.catalog.deletionModules,
    link: input.catalog.deletionLink, revision: input.revision, subscribers: input.subscribers });
  const variantDeletion = yield* prepareProductVariantDeletionWorkflow({ execution, modules: input.catalog.deletionModules,
    link: input.catalog.deletionLink, revision: input.revision, subscribers: input.subscribers });
  const variantCreation = yield* prepareProductVariantInventoryWorkflow({ execution, modules: {
    product: input.catalog.modules.product, pricing: input.catalog.modules.pricing, inventory: input.catalog.modules.inventory,
    stock_location: input.catalog.modules.stock_location, link: input.catalog.modules.variant_links,
  }, revision: input.revision, subscribers: input.subscribers });
  const variantUpdate = yield* prepareProductVariantUpdateWorkflow({ execution, modules: input.catalog.variantUpdateModules,
    nativeLinks: input.catalog.variantUpdateNativeLinks, revision: input.revision, subscribers: input.subscribers });
  const optionCreation = yield* prepareProductOptionCreationWorkflow({ execution, modules: input.catalog.optionModules,
    revision: input.revision, subscribers: input.subscribers });
  const optionUpdate = yield* prepareProductOptionUpdateWorkflow({ execution, modules: input.catalog.optionModules,
    revision: input.revision, subscribers: input.subscribers });
  const optionDeletion = yield* prepareProductOptionDeletionWorkflow({ execution, modules: input.catalog.optionModules,
    link: input.catalog.optionDeletionLink, revision: input.revision, subscribers: input.subscribers });
  const variantImages = yield* prepareVariantImagesWorkflow({ execution, admission: "parent-qualified", modules: input.catalog.variantImageModules,
    revision: input.revision, subscribers: input.subscribers });
  const imageVariants = yield* prepareImageVariantsWorkflow({ execution, modules: input.catalog.imageVariantModules,
    revision: input.revision, subscribers: input.subscribers });
  const typeCreation = yield* prepareProductTypeCreationWorkflow({ execution, modules: input.catalog.typeModules,
    revision: input.revision, subscribers: input.subscribers });
  const typeUpdate = yield* prepareProductTypeUpdateWorkflow({ execution, modules: input.catalog.typeModules,
    revision: input.revision, subscribers: input.subscribers });
  const typeDeletion = yield* prepareProductTypeDeletionWorkflow({ execution, modules: input.catalog.typeModules,
    link: input.catalog.typeDeletionLink, revision: input.revision, subscribers: input.subscribers });
  const tagCreation = yield* prepareProductTagWorkflow({ execution, modules: { product: input.catalog.modules.product },
    revision: input.revision, subscribers: input.subscribers });
  const tagUpdate = yield* prepareProductTagUpdateWorkflow({ execution, modules: { product: input.catalog.modules.product },
    revision: input.revision, subscribers: input.subscribers });
  const tagDeletion = yield* prepareProductTagDeleteWorkflow({ execution, modules: { product: input.catalog.modules.product },
    revision: input.revision, subscribers: input.subscribers });
  const categoryCreation = yield* prepareProductCategoryCreationWorkflow({ execution, modules: input.catalog.categoryModules,
    revision: input.revision, subscribers: input.subscribers });
  const categoryUpdate = yield* prepareProductCategoryUpdateWorkflow({ execution, modules: input.catalog.categoryModules,
    revision: input.revision, subscribers: input.subscribers });
  const categoryDeletion = yield* prepareProductCategoryDeletionWorkflow({ execution, modules: input.catalog.categoryModules,
    link: input.catalog.categoryDeletionLink, revision: input.revision, subscribers: input.subscribers });
  const collectionCreation = yield* prepareProductCollectionCreationWorkflow({ execution, modules: input.catalog.collectionModules,
    revision: input.revision, subscribers: input.subscribers });
  const collectionUpdate = yield* prepareProductCollectionUpdateWorkflow({ execution, modules: input.catalog.collectionModules,
    revision: input.revision, subscribers: input.subscribers });
  const collectionDeletion = yield* prepareProductCollectionDeletionWorkflow({ execution, modules: input.catalog.collectionModules,
    link: input.catalog.collectionDeletionLink, revision: input.revision, subscribers: input.subscribers });
  const categoryMembership = yield* prepareProductCategoryMembershipWorkflow({ execution, modules: { product: input.catalog.modules.product },
    revision: input.revision, subscribers: input.subscribers });
  const collectionMembership = yield* prepareProductCollectionMembershipWorkflow({ execution, modules: { product: input.catalog.modules.product },
    revision: input.revision, subscribers: input.subscribers });
  const read = yield* makeProductRequestReads(input);
  const admitProductRefetchFields = (fields: readonly string[]): void => {
    Result.getOrThrowWith(read.admitProductRefetchFields(fields), cause => new MedusaError(MedusaError.Types.INVALID_DATA,
      "The private Product profile requires supported response fields before execution.", undefined, undefined, { cause }));
  };
  const admitCatalogRefetchFields = (entity: "product_type" | "product_tag" | "product_category" | "product_collection", fields: readonly string[]): void => {
    Result.getOrThrowWith(read.admitCatalogRefetchFields(entity, fields), cause => new MedusaError(MedusaError.Types.INVALID_DATA,
      "The private catalog profile requires supported response fields before execution.", undefined, undefined, { cause }));
  };
  const executeWorkflow = Effect.fn("ProductRequest.runWorkflow")(function* (name: string, value: unknown) {
    // This exact decoder runs before acquiring any atomic request/claim. Its
    // refusal is caller input outside the admitted HTTP profile; later native
    // failures, defects and settlement uncertainty retain their own channels.
    const refusal = (cause: unknown) => commerceError("adapterFailure", new MedusaError(MedusaError.Types.INVALID_DATA,
      "Product workflow input is outside the private supported profile; each workflow retains its existing bounded input contract.",
      undefined, "Product workflow admission refused", { cause }));
    switch (name) {
      case "create-products": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(workflow.decodeInput), Result.mapError(refusal)));
        return { result: yield* workflow.run(workflow.newRequestKey(), args) };
      }
      case "update-products": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(update.decodeInput), Result.mapError(refusal)));
        return { result: yield* update.run(update.newRequestKey(), args) };
      }
      case "delete-products": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(deletion.decodeInput), Result.mapError(refusal)));
        return { result: yield* deletion.run(deletion.newRequestKey(), args) };
      }
      case "delete-product-variants": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(variantDeletion.decodeInput), Result.mapError(refusal)));
        return { result: yield* variantDeletion.run(variantDeletion.newRequestKey(), args) };
      }
      case "create-product-variants": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(variantCreation.decodeInput), Result.mapError(refusal)));
        return { result: yield* variantCreation.run(variantCreation.newRequestKey(), args) };
      }
      case "update-product-variants": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(variantUpdate.decodeInput), Result.mapError(refusal)));
        return { result: yield* variantUpdate.run(variantUpdate.newRequestKey(), args) };
      }
      case "create-product-options": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(optionCreation.decodeInput), Result.mapError(refusal)));
        return { result: yield* optionCreation.run(optionCreation.newRequestKey(), args) };
      }
      case "update-product-options": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(optionUpdate.decodeInput), Result.mapError(refusal)));
        return { result: yield* optionUpdate.run(optionUpdate.newRequestKey(), args) };
      }
      case "delete-product-options": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(optionDeletion.decodeInput), Result.mapError(refusal)));
        return { result: yield* optionDeletion.run(optionDeletion.newRequestKey(), args) };
      }
      case "batch-variant-images": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(variantImages.decodeInput), Result.mapError(refusal)));
        return { result: yield* variantImages.run(variantImages.newRequestKey(), args) };
      }
      case "batch-image-variants": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(imageVariants.decodeInput), Result.mapError(refusal)));
        return { result: yield* imageVariants.run(imageVariants.newRequestKey(), args) };
      }
      case "create-product-types": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(typeCreation.decodeInput), Result.mapError(refusal)));
        return { result: yield* typeCreation.run(typeCreation.newRequestKey(), args) };
      }
      case "update-product-types": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(typeUpdate.decodeInput), Result.mapError(refusal)));
        return { result: yield* typeUpdate.run(typeUpdate.newRequestKey(), args) };
      }
      case "delete-product-types": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(typeDeletion.decodeInput), Result.mapError(refusal)));
        return { result: yield* typeDeletion.run(typeDeletion.newRequestKey(), args) };
      }
      case "create-product-tags": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(tagCreation.decodeInput), Result.mapError(refusal)));
        return { result: yield* tagCreation.run(tagCreation.newRequestKey(), args) };
      }
      case "update-product-tags": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(tagUpdate.decodeInput), Result.mapError(refusal)));
        return { result: yield* tagUpdate.run(tagUpdate.newRequestKey(), args) };
      }
      case "delete-product-tags": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(tagDeletion.decodeInput), Result.mapError(refusal)));
        return { result: yield* tagDeletion.run(tagDeletion.newRequestKey(), args) };
      }
      case "create-product-categories": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(categoryCreation.decodeInput), Result.mapError(refusal)));
        return { result: yield* categoryCreation.run(categoryCreation.newRequestKey(), args) };
      }
      case "update-product-categories": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(categoryUpdate.decodeInput), Result.mapError(refusal)));
        return { result: yield* categoryUpdate.run(categoryUpdate.newRequestKey(), args) };
      }
      case "delete-product-categories": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(categoryDeletion.decodeInput), Result.mapError(refusal)));
        return { result: yield* categoryDeletion.run(categoryDeletion.newRequestKey(), args) };
      }
      case "batch-link-products-to-category": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(categoryMembership.decodeInput), Result.mapError(refusal)));
        return { result: yield* categoryMembership.run(categoryMembership.newRequestKey(), args) };
      }
      case "create-collections": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(collectionCreation.decodeInput), Result.mapError(refusal)));
        return { result: yield* collectionCreation.run(collectionCreation.newRequestKey(), args) };
      }
      case "update-collections": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(collectionUpdate.decodeInput), Result.mapError(refusal)));
        return { result: yield* collectionUpdate.run(collectionUpdate.newRequestKey(), args) };
      }
      case "delete-collections": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(collectionDeletion.decodeInput), Result.mapError(refusal)));
        return { result: yield* collectionDeletion.run(collectionDeletion.newRequestKey(), args) };
      }
      case "batch-link-products-collection": {
        const args = yield* Effect.fromResult(captureCommerceInput(value).pipe(Result.flatMap(collectionMembership.decodeInput), Result.mapError(refusal)));
        return { result: yield* collectionMembership.run(collectionMembership.newRequestKey(), args) };
      }
      default: return yield* commerceError("unsupportedProfile");
    }
  });
  function runWorkflow(name: "create-products", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof workflow.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "update-products", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof update.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "delete-products", value: unknown): Effect.Effect<{ result: null }, CommerceTransactionError>;
  function runWorkflow(name: "delete-product-variants", value: unknown): Effect.Effect<{ result: null }, CommerceTransactionError>;
  function runWorkflow(name: "create-product-variants", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof variantCreation.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "update-product-variants", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof variantUpdate.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "create-product-options", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof optionCreation.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "update-product-options", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof optionUpdate.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "delete-product-options", value: unknown): Effect.Effect<{ result: null }, CommerceTransactionError>;
  function runWorkflow(name: "batch-variant-images", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof variantImages.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "batch-image-variants", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof imageVariants.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "create-product-types", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof typeCreation.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "update-product-types", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof typeUpdate.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "delete-product-types", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof typeDeletion.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "create-product-tags", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof tagCreation.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "update-product-tags", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof tagUpdate.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "delete-product-tags", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof tagDeletion.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "create-product-categories", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof categoryCreation.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "update-product-categories", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof categoryUpdate.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "delete-product-categories", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof categoryDeletion.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "batch-link-products-to-category", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof categoryMembership.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "create-collections", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof collectionCreation.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "update-collections", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof collectionUpdate.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "delete-collections", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof collectionDeletion.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "batch-link-products-collection", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof collectionMembership.run>> }, CommerceTransactionError>;
  function runWorkflow(name: string, value: unknown): ReturnType<typeof executeWorkflow>;
  function runWorkflow(name: string, value: unknown): ReturnType<typeof executeWorkflow> { return executeWorkflow(name, value); }
  const index = Effect.fn("ProductRequest.unsupportedIndex")(() => Effect.fail(commerceError("adapterFailure",
    new MedusaError(MedusaError.Types.NOT_ALLOWED, "Index engine is outside the admitted Product profile"))));
  return Object.freeze({ runWorkflow, query: Object.freeze({ graph: read.graph, index }), remoteQuery: read.remoteQuery,
    admitProductRefetchFields, admitCatalogRefetchFields,
    close: workflow.close.pipe(Effect.ensuring(update.close), Effect.ensuring(deletion.close), Effect.ensuring(variantDeletion.close), Effect.ensuring(variantCreation.close), Effect.ensuring(variantUpdate.close),
      Effect.ensuring(optionCreation.close), Effect.ensuring(optionUpdate.close), Effect.ensuring(optionDeletion.close),
      Effect.ensuring(variantImages.close), Effect.ensuring(imageVariants.close),
      Effect.ensuring(typeCreation.close), Effect.ensuring(typeUpdate.close), Effect.ensuring(typeDeletion.close),
      Effect.ensuring(tagCreation.close), Effect.ensuring(tagUpdate.close), Effect.ensuring(tagDeletion.close)).pipe(
      Effect.ensuring(categoryCreation.close), Effect.ensuring(categoryUpdate.close), Effect.ensuring(categoryDeletion.close), Effect.ensuring(categoryMembership.close),
      Effect.ensuring(collectionCreation.close), Effect.ensuring(collectionUpdate.close), Effect.ensuring(collectionDeletion.close), Effect.ensuring(collectionMembership.close), Effect.ensuring(read.close)) });
});
export type ProductRequestOperations = Effect.Success<ReturnType<typeof makeProductRequestOperations>>;

/** Foreign HTTP Promise presentation retains the complete authoritative Cause.
 * Only one actual Medusa refusal plus its rollback markers receives native HTTP
 * status. Defects, interruption, mixed failures and uncertainty remain unknown. */
async function runProductRequestPromise<A, E>(work: Effect.Effect<A, E>): Promise<A> {
  const exit = await Effect.runPromiseExit(work);
  // Native middleware mutates its DTOs (for example inventory_quantity). The
  // foreign HTTP caller owns a detached copy, never Core's immutable values.
  if (Exit.isSuccess(exit)) return structuredClone(exit.value);
  const presentations: MedusaError[] = [];
  const expected = exit.cause.reasons.every(reason => {
    if (!Cause.isFailReason(reason) || !(reason.error instanceof CommerceTransactionError)) return false;
    if (reason.error.reason === "rollbackOnly") return true;
    if (reason.error.reason !== "adapterFailure" || !(reason.error.cause instanceof MedusaError)) return false;
    presentations.push(reason.error.cause); return true;
  });
  const native = presentations[0];
  if (expected && native !== undefined && presentations.every(error => error === native))
    throw new MedusaError(native.type, native.message, native.code, native.message, { cause: exit.cause });
  throw new Error("Product request execution failed", { cause: exit.cause });
}
export const makeProductRequestScopeFactory = Effect.fn("ProductRequest.makeScopeFactory")(function* (input: Readonly<{
  operations: ProductRequestOperations; container: AwilixContainer;
}>) {
  const container = yield* Effect.acquireRelease(Effect.sync(() => input.container.createScope().register({
    [Modules.WORKFLOW_ENGINE]: asValue({ run: (name: string, options: Readonly<{ input: unknown }>) => runProductRequestPromise(input.operations.runWorkflow(name, options.input)) }),
    query: asValue({ graph: (query: unknown, options?: unknown) => runProductRequestPromise(input.operations.query.graph(query, options)),
      index: () => runProductRequestPromise(input.operations.query.index()) }),
    remoteQuery: asValue((query: unknown) => runProductRequestPromise(input.operations.remoteQuery(query))),
  })), scope => Effect.promise(() => scope.dispose()));
  return Object.freeze({ createRequestScope: (): MedusaRequest["scope"] => container.createScope() });
});
