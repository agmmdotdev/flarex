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
import { prepareProductCreationWorkflow } from "../workflows/product/creation";
import { prepareProductUpdateWorkflow } from "../workflows/product/update";
import { prepareProductDeletionWorkflow } from "../workflows/product/deletion";
import { captureCommerceInput } from "../value/input";
import type { AtomicWorkflowExecution } from "../workflow/host";
import { makeProductRequestReads } from "./product-request-reads";

/** Metadata production only. Bootstrap must separately admit the bundle and
 * commit all exact empty-source initialization receipts before HTTP activation. */
export const compileProductRequestCatalog = Effect.fn("ProductRequest.compileCatalog")(function* (
  target: Readonly<{ scopeUuid: string; epochUuid: string }>,
) {
  const product = yield* makeLocalProductCommands(), pricing = yield* makeLocalPricingCommands(), inventory = yield* makeLocalInventoryCommands();
  const stock = yield* makeStockLocationCommands(), sales = yield* makeLocalSalesChannelCommands(), fulfillment = yield* makeLocalShippingProfileCommands();
  const productLinks = yield* prepareLocalProductLinks(), variantLinks = yield* prepareLocalVariantLinks();
  const updatePricing = yield* makeLocalPricingCommands("product-updates");
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
  return Object.freeze({ target: Object.freeze({ ...target }), sources, productSource, productRuntime: product,
    runtimes: Object.freeze({ product, pricing, inventory, stock, sales, fulfillment, productLinks, variantLinks }), modules, link, updateModules, updateLink,
    deletionModules, deletionLink, bundle, eventDefinition });
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
  const read = yield* makeProductRequestReads(input);
  const admitProductRefetchFields = (fields: readonly string[]): void => {
    Result.getOrThrowWith(read.admitProductRefetchFields(fields), cause => new MedusaError(MedusaError.Types.INVALID_DATA,
      "The private Product profile requires supported response fields before execution.", undefined, undefined, { cause }));
  };
  const executeWorkflow = Effect.fn("ProductRequest.runWorkflow")(function* (name: string, value: unknown) {
    // This exact decoder runs before acquiring any atomic request/claim. Its
    // refusal is caller input outside the admitted HTTP profile; later native
    // failures, defects and settlement uncertainty retain their own channels.
    const refusal = (cause: unknown) => commerceError("adapterFailure", new MedusaError(MedusaError.Types.INVALID_DATA,
      "Product workflow input is outside the private supported profile: up to 4 products or deletion IDs, 1 option, 4 variants total, and 2 prices per variant.",
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
      default: return yield* commerceError("unsupportedProfile");
    }
  });
  function runWorkflow(name: "create-products", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof workflow.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "update-products", value: unknown): Effect.Effect<{ result: Effect.Success<ReturnType<typeof update.run>> }, CommerceTransactionError>;
  function runWorkflow(name: "delete-products", value: unknown): Effect.Effect<{ result: null }, CommerceTransactionError>;
  function runWorkflow(name: string, value: unknown): ReturnType<typeof executeWorkflow>;
  function runWorkflow(name: string, value: unknown): ReturnType<typeof executeWorkflow> { return executeWorkflow(name, value); }
  const index = Effect.fn("ProductRequest.unsupportedIndex")(() => Effect.fail(commerceError("adapterFailure",
    new MedusaError(MedusaError.Types.NOT_ALLOWED, "Index engine is outside the admitted Product profile"))));
  const remoteQuery = Effect.fn("ProductRequest.unsupportedRemoteQuery")((_value: unknown) => Effect.fail(commerceError("adapterFailure",
    new MedusaError(MedusaError.Types.INVALID_DATA, "Remote Product filters are outside the private supported profile"))));
  return Object.freeze({ runWorkflow, query: Object.freeze({ graph: read.graph, index }), remoteQuery, admitProductRefetchFields,
    close: workflow.close.pipe(Effect.ensuring(update.close), Effect.ensuring(deletion.close), Effect.ensuring(read.close)) });
});
export type ProductRequestOperations = Effect.Success<ReturnType<typeof makeProductRequestOperations>>;

/** Foreign HTTP Promise presentation retains the complete authoritative Cause.
 * Only one actual Medusa refusal plus its rollback markers receives native HTTP
 * status. Defects, interruption, mixed failures and uncertainty remain unknown. */
async function runProductRequestPromise<A, E>(work: Effect.Effect<A, E>): Promise<A> {
  const exit = await Effect.runPromiseExit(work);
  if (Exit.isSuccess(exit)) return exit.value;
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
