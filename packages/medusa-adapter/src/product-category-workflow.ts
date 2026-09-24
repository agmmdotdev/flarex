import { Effect, Schema } from "effect";
import { createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { batchLinkProductsToCategoryWorkflow } from "@medusajs/core-flows/product/batch-products-in-category";
import { useQueryGraphStep } from "@medusajs/core-flows/common/use-query-graph";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ProductCategoryMembershipInput } from "./product-relationship-workflow-input";
import type { ProductWorkflowModule } from "./product-workflow-module";
import { captureWorkflowRecord } from "./workflow/configuration";
import { prepareWorkflowResources } from "./workflow/resources";
import { internalModuleWorkflowEvents } from "./workflow/events";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "./workflow/host";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const ProductCategoryMembershipOutput = Schema.Array(Schema.Struct({
  id: Id, categories: Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(256)),
})).check(Schema.isMaxLength(256));

/** Run the pinned membership step and read its pending Product relations. */
const productCategoryMembershipWorkflow = createWorkflow("assign-products-to-category", (
  input: WorkflowData<typeof ProductCategoryMembershipInput.Type>,
) => {
  const change = transform(input, value => ({ id: value.id,
    add: [...value.add ?? []], remove: [...value.remove ?? []],
  }));
  batchLinkProductsToCategoryWorkflow.runAsStep({ input: change });
  const ids = transform(input, ({ add, remove }) => [...new Set([...(add ?? []), ...(remove ?? [])])]);
  const products = useQueryGraphStep({ entity: "product", fields: ["id", "categories.id"],
    filters: { id: ids }, pagination: { take: 256 },
  });
  return new WorkflowResponse(products.data);
});

export const prepareProductCategoryMembershipWorkflow = Effect.fn("MedusaWorkflow.prepareCategoryMembership")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductWorkflowModule, "logical"> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const modules = { product: yield* Effect.fromResult(captureWorkflowRecord(registrations.product)) };
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ product: { module: modules.product.module,
    methods: ["listProducts", "upsertProducts"], graph: true,
  } }, true));
  const prepared = yield* Effect.fromResult(productCategoryMembershipWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, workflow: {
    name: "productCategoryMembership", resources, prepared,
    input: ProductCategoryMembershipInput, output: ProductCategoryMembershipOutput,
    events: internalModuleWorkflowEvents,
  } });
});
