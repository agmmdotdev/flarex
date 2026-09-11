import { Effect } from "effect";
import { createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { useQueryGraphStep } from "@medusajs/core-flows/common/use-query-graph";
import { batchLinkProductsToCollectionWorkflow } from "@medusajs/core-flows/product/batch-link-products-collection";
import { batchLinkProductsToCategoryWorkflow } from "@medusajs/core-flows/product/batch-products-in-category";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ProductRelationshipsInput, ProductRelationshipsOutput } from "./product-relationship-workflow-input";
import type { ProductWorkflowModule } from "./product-workflow-module";
import { captureWorkflowRecord } from "./workflow/configuration";
import { prepareWorkflowResources } from "./workflow/resources";
import { internalModuleWorkflowEvents } from "./workflow/events";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "./workflow/host";

/** Explicit source order: collection assignment, category membership, then
 * reads of pending relations. Both imported children borrow the same root. */
export const productRelationshipsWorkflow = createWorkflow("update-product-relationships", (input: WorkflowData<typeof ProductRelationshipsInput.Type>) => {
  const collectionInput = transform(input.collection, change => ({ id: change.id, add: [...change.add ?? []], remove: [...change.remove ?? []] }));
  const categoryInput = transform(input.category, change => ({ id: change.id, add: [...change.add ?? []], remove: [...change.remove ?? []] }));
  batchLinkProductsToCollectionWorkflow.runAsStep({ input: collectionInput });
  batchLinkProductsToCategoryWorkflow.runAsStep({ input: categoryInput });
  const ids = transform(input, ({ collection, category }) => [...new Set([
    ...(collection.add ?? []), ...(collection.remove ?? []), ...(category.add ?? []), ...(category.remove ?? []),
  ])]);
  const products = useQueryGraphStep({ entity: "product", fields: ["id", "collection_id", "categories.id"],
    filters: { id: ids }, pagination: { take: 256 },
  }).config({ name: "pending-product-relationships" });
  const collections = useQueryGraphStep({ entity: "product_collection", fields: ["id", "products.id"],
    filters: { id: input.collection.id }, pagination: { take: 1 },
  }).config({ name: "pending-collection-members" });
  return new WorkflowResponse({ products: products.data, collections: collections.data });
});

export const prepareProductRelationshipsWorkflow = Effect.fn("MedusaWorkflow.prepareProductRelationships")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductWorkflowModule> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const modules = { product: yield* Effect.fromResult(captureWorkflowRecord(registrations.product)) };
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ product: { module: modules.product.module,
    methods: ["listProducts", "retrieveProductCollection", "upsertProducts", "updateProductCollections"], graph: true,
  } }, true));
  const prepared = yield* Effect.fromResult(productRelationshipsWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, workflow: { name: "productRelationships", resources, prepared,
    input: ProductRelationshipsInput, output: ProductRelationshipsOutput, events: internalModuleWorkflowEvents,
  } });
});
