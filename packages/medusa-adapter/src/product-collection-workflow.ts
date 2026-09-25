import { Effect } from "effect";
import { createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { batchLinkProductsToCollectionWorkflow } from "@medusajs/core-flows/product/batch-link-products-collection";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ProductMembershipChange, ProductCollectionMembershipOutput, collectionReplacementResult } from "./product-relationship-workflow-input";
import type { ProductWorkflowModule } from "./product-workflow-module";
import { captureWorkflowRecord } from "./workflow/configuration";
import { prepareWorkflowResources } from "./workflow/resources";
import { internalModuleWorkflowEvents } from "./workflow/events";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "./workflow/host";

/** The native child owns membership calculation; replacement is terminal. */
const productCollectionMembershipWorkflow = createWorkflow("assign-products-to-collection", (
  input: WorkflowData<typeof ProductMembershipChange.Type>,
) => {
  const change = transform(input, value => ({ id: value.id,
    add: [...value.add ?? []], remove: [...value.remove ?? []],
  }));
  const updated = batchLinkProductsToCollectionWorkflow.runAsStep({ input: change });
  return new WorkflowResponse(transform({ id: input.id, updated }, value => collectionReplacementResult(value.id, value.updated)));
});

export const prepareProductCollectionMembershipWorkflow = Effect.fn("MedusaWorkflow.prepareCollectionMembership")(function* (input: {
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
    methods: ["retrieveProductCollection", "updateProductCollections"], graph: false,
  } }, true));
  const prepared = yield* Effect.fromResult(productCollectionMembershipWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, workflow: {
    name: "productCollectionMembership", resources, prepared,
    input: ProductMembershipChange, output: ProductCollectionMembershipOutput,
    events: internalModuleWorkflowEvents,
  } });
});
