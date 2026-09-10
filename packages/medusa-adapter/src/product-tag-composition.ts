import { Effect, Result, Schema } from "effect";
import { createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createProductTagsWorkflow } from "@medusajs/core-flows/product/create-product-tags";
import { updateProductTagsWorkflow } from "@medusajs/core-flows/product/update-product-tags";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { ProductTagWorkflowResult, type ProductWorkflowModule } from "./product-workflow-module";
import type { CurrencyWorkflowModule } from "./currency-service";
import { decodeCreatedProductTagHook } from "./product-tag-workflow";
import { decodeUpdatedProductTagHook } from "./product-tag-update-workflow";
import { composedProductTagEvents } from "./product-tag-workflow-events";
import { prepareWorkflowResources, type NativeWorkflowContext, type NativeWorkflowResources } from "./workflow/resources";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "./workflow/host";
import { captureWorkflowRecord } from "./workflow/configuration";

const Input = Schema.Struct({ value: Schema.String, updated_value: Schema.String });
type Selections = {
  readonly product: { readonly module: ProductWorkflowModule; readonly methods: readonly ["createProductTags", "listProductTags", "updateProductTags"]; readonly graph: true };
  readonly currency: { readonly module: CurrencyWorkflowModule; readonly methods: readonly []; readonly graph: true };
};
export type ProductTagCompositionResources = NativeWorkflowResources<Selections, true>;
type Context = NativeWorkflowContext<ProductTagCompositionResources>;
export interface ProductTagCompositionHooks {
  readonly created?: (input: Result.Result.Success<ReturnType<typeof decodeCreatedProductTagHook>>, context: Context) => unknown | Promise<unknown>;
  readonly updated?: (input: Result.Result.Success<ReturnType<typeof decodeUpdatedProductTagHook>>, context: Context) => unknown | Promise<unknown>;
}

/** Bounded private consumer: the imported child workflows retain their business
 * sequences, while this root owns the explicit method/graph/event selection. */
export const prepareProductTagComposition = Effect.fn("MedusaWorkflow.prepareTagComposition")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductWorkflowModule>; readonly currency: InstalledWorkflowModule<CurrencyWorkflowModule> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
  readonly hooks?: ProductTagCompositionHooks;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const modules = { product: yield* Effect.fromResult(captureWorkflowRecord(registrations.product)),
    currency: yield* Effect.fromResult(captureWorkflowRecord(registrations.currency)) };
  const hooks = yield* Effect.fromResult(captureWorkflowRecord(options.hooks ?? {}));
  if (Object.keys(registrations).length !== 2 || Object.keys(hooks).some(name => !["created", "updated"].includes(name))
    || (hooks.created !== undefined && typeof hooks.created !== "function") || (hooks.updated !== undefined && typeof hooks.updated !== "function")) {
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["createProductTags", "listProductTags", "updateProductTags"], graph: true },
    currency: { module: modules.currency.module, methods: [], graph: true },
  }, true));
  const created = hooks.created, updated = hooks.updated;
  const createdHooks = created === undefined ? {} : { productTagsCreated: resources.callback((value: unknown, context) =>
    decodeCreatedProductTagHook(value).pipe(Result.match({ onFailure: error => Promise.reject(error), onSuccess: input => created(input, context) }))) };
  const updatedHooks = updated === undefined ? {} : { productTagsUpdated: resources.callback((value: unknown, context) =>
    decodeUpdatedProductTagHook(value).pipe(Result.match({ onFailure: error => Promise.reject(error), onSuccess: input => updated(input, context) }))) };
  const definition = createWorkflow("create-then-update-product-tag", (input: WorkflowData<typeof Input.Type>) => {
    const tags = createProductTagsWorkflow.runAsStep({ input: { product_tags: [{ value: input.value }] }, hooks: createdHooks });
    const selector = transform(tags, tags => ({ id: tags.map(tag => tag.id) }));
    return new WorkflowResponse(updateProductTagsWorkflow.runAsStep({
      input: { selector, update: { value: input.updated_value } }, hooks: updatedHooks,
    }));
  });
  const prepared = yield* Effect.fromResult(definition.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, workflow: {
    name: "createThenUpdateProductTag", resources, prepared, input: Input, output: ProductTagWorkflowResult,
    events: composedProductTagEvents({ create: modules.product.module.methods.createProductTags, update: modules.product.module.methods.updateProductTags }),
  } });
});
