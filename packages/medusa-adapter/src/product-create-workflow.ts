import { Effect, Schema } from "effect";
import { createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createProductsStep } from "@medusajs/core-flows/product/create-products-step";
import { useQueryGraphStep } from "@medusajs/core-flows/common/use-query-graph";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { SimpleProductInput, type ProductWorkflowModule } from "./product-workflow-module";
import { captureWorkflowRecord } from "./workflow/configuration";
import { prepareWorkflowResources } from "./workflow/resources";
import { internalModuleWorkflowEvents } from "./workflow/events";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "./workflow/host";

export const ProductCreateInput = Schema.Struct({
  products: Schema.Array(SimpleProductInput).check(Schema.isLengthBetween(1, 4)),
});
export const ProductCreateOutput = Schema.Struct({
  products: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })).check(Schema.isLengthBetween(1, 4)),
});

/** Native creation and pending graph read for the admitted scalar Product
 * contract. Nested graph creation requires its own event and query cutover. */
const productCreateWorkflow = createWorkflow("create-products-simple", (input: WorkflowData<typeof ProductCreateInput.Type>) => {
  const products = createProductsStep(transform(input.products, values => [...values]));
  const ids = transform(products, values => values.map(value => value.id));
  const pending = useQueryGraphStep({ entity: "product", fields: ["id", "title"],
    filters: { id: ids }, pagination: { take: 4 },
  });
  const selected = transform({ created: products, observed: pending.data }, ({ created, observed }) => created.map(product => {
    const row = observed.find(candidate => candidate.id === product.id);
    if (row?.title !== product.title) throw commerceError("receiptMismatch");
    return { id: product.id, title: product.title };
  }));
  return new WorkflowResponse({ products: selected });
});

export const prepareProductCreateWorkflow = Effect.fn("MedusaWorkflow.prepareProductCreate")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductWorkflowModule, "physical" | "logical"> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const modules = { product: yield* Effect.fromResult(captureWorkflowRecord(registrations.product)) };
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["createProducts"], graph: true },
  }, true));
  const prepared = yield* Effect.fromResult(productCreateWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, workflow: {
    name: "productCreate", resources, prepared, input: ProductCreateInput, output: ProductCreateOutput,
    events: internalModuleWorkflowEvents,
  } });
});
