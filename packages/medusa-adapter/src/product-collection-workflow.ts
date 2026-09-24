import { Effect, Schema } from "effect";
import { createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { batchLinkProductsToCollectionWorkflow } from "@medusajs/core-flows/product/batch-link-products-collection";
import { useQueryGraphStep } from "@medusajs/core-flows/common/use-query-graph";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ProductMembershipChange } from "./product-relationship-workflow-input";
import type { ProductWorkflowModule } from "./product-workflow-module";
import { captureWorkflowRecord } from "./workflow/configuration";
import { prepareWorkflowResources } from "./workflow/resources";
import { internalModuleWorkflowEvents } from "./workflow/events";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "./workflow/host";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const ProductCollectionMembershipOutput = Schema.NullOr(Schema.Struct({
  id: Id, products: Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(256)),
}));

/** Keep the native membership calculation; read the pending result before settlement. */
const productCollectionMembershipWorkflow = createWorkflow("assign-products-to-collection", (
  input: WorkflowData<typeof ProductMembershipChange.Type>,
) => {
  const change = transform(input, value => ({ id: value.id,
    add: [...value.add ?? []], remove: [...value.remove ?? []],
  }));
  batchLinkProductsToCollectionWorkflow.runAsStep({ input: change });
  const collection = useQueryGraphStep({ entity: "product_collection", fields: ["id", "products.id"],
    filters: { id: input.id }, pagination: { take: 1 },
  });
  return new WorkflowResponse(transform(collection.data, rows => rows[0] ?? null));
});

export const prepareProductCollectionMembershipWorkflow = Effect.fn("MedusaWorkflow.prepareCollectionMembership")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductWorkflowModule, "physical" | "logical"> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const modules = { product: yield* Effect.fromResult(captureWorkflowRecord(registrations.product)) };
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ product: { module: modules.product.module,
    methods: ["retrieveProductCollection", "updateProductCollections"], graph: true,
  } }, true));
  const prepared = yield* Effect.fromResult(productCollectionMembershipWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, workflow: {
    name: "productCollectionMembership", resources, prepared,
    input: ProductMembershipChange, output: ProductCollectionMembershipOutput,
    events: internalModuleWorkflowEvents,
  } });
});
