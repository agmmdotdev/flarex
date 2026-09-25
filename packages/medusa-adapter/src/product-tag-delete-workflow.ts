import { Effect, Result, Schema } from "effect";
import { deleteProductTagsWorkflow } from "@medusajs/core-flows/product/delete-product-tags";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceDecoder } from "./commerce-decoder";
import { ProductLifecycleIds } from "./product-lifecycle";
import type { ProductWorkflowModule } from "./product-workflow-module";
import { productTagDeletionEvents } from "./product-tag-workflow-events";
import { prepareWorkflowResources, type NativeWorkflowContext, type NativeWorkflowResources } from "./workflow/resources";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "./workflow/host";
import { captureWorkflowRecord } from "./workflow/configuration";
import { captureCommerceInput } from "./commerce-input";

const WorkflowInput = Schema.Struct({ ids: ProductLifecycleIds });
const decodeHook = commerceDecoder(WorkflowInput, "invalidInput");
type ProductTagDeleteSelections = {
  readonly product: { readonly module: ProductWorkflowModule; readonly methods: readonly ["softDeleteProductTags"]; readonly graph: true };
};
export type ProductTagDeleteResources = NativeWorkflowResources<ProductTagDeleteSelections, true>;
export interface ProductTagDeleteWorkflowHooks {
  readonly productTagsDeleted?: (input: typeof WorkflowInput.Type, context: NativeWorkflowContext<ProductTagDeleteResources>) => unknown | Promise<unknown>;
}
type MedusaHooks = NonNullable<Parameters<typeof deleteProductTagsWorkflow.prepare>[0]>;

/** The original soft-delete flow uses the existing atomic host and returns null
 * at the native completion boundary. Its restore compensator stays unadmitted. */
export const prepareProductTagDeleteWorkflow = Effect.fn("MedusaWorkflow.prepareProductTagDeletion")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductWorkflowModule> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
  readonly hooks?: ProductTagDeleteWorkflowHooks;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const modules = { product: yield* Effect.fromResult(captureWorkflowRecord(registrations.product)) };
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registeredHooks = yield* Effect.fromResult(captureWorkflowRecord(options.hooks ?? {}));
  if (Object.keys(registeredHooks).some(name => name !== "productTagsDeleted")
    || (registeredHooks.productTagsDeleted !== undefined && typeof registeredHooks.productTagsDeleted !== "function")) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["softDeleteProductTags"], graph: true },
  }, true));
  const handler = registeredHooks.productTagsDeleted;
  const hooks: MedusaHooks = handler === undefined ? {} : { productTagsDeleted: resources.callback((value: unknown, context) =>
    captureCommerceInput(value).pipe(Result.flatMap(decodeHook), Result.match({
      onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context),
    }))) };
  const prepared = yield* Effect.fromResult(deleteProductTagsWorkflow.prepare(hooks)).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, workflow: {
    name: "deleteProductTagsWorkflow", resources, prepared, input: WorkflowInput, output: Schema.Null,
    events: productTagDeletionEvents(modules.product.module.methods.softDeleteProductTags),
  } });
});
