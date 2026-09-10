import { Effect, Result, Schema } from "effect";
import { updateProductTagsWorkflow } from "@medusajs/core-flows/product/update-product-tags";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceDecoder } from "./commerce-decoder";
import { ProductTagUpdateInput } from "./product-tag-update-input";
import { ProductTagWorkflowResult, type ProductWorkflowModule } from "./product-workflow-module";
import { productTagWorkflowEvents } from "./product-tag-workflow-events";
import { prepareWorkflowResources, type NativeWorkflowContext, type NativeWorkflowResources } from "./workflow/resources";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "./workflow/host";
import { captureWorkflowRecord } from "./workflow/configuration";
import { captureCommerceInput } from "./commerce-input";

const WorkflowInput = Schema.Struct({ ...ProductTagUpdateInput.fields, additional_data: Schema.optionalKey(Schema.JsonObject) });
const HookInput = Schema.Struct({ product_tags: ProductTagWorkflowResult, additional_data: Schema.optionalKey(Schema.JsonObject) });
const decodeHook = commerceDecoder(HookInput, "invalidInput");
type ProductTagUpdateSelections = {
  readonly product: { readonly module: ProductWorkflowModule; readonly methods: readonly ["listProductTags", "updateProductTags"]; readonly graph: true };
};
export type ProductTagUpdateResources = NativeWorkflowResources<ProductTagUpdateSelections, true>;
export interface ProductTagUpdateWorkflowHooks {
  readonly productTagsUpdated?: (input: typeof HookInput.Type, context: NativeWorkflowContext<ProductTagUpdateResources>) => unknown | Promise<unknown>;
}
type MedusaHooks = NonNullable<Parameters<typeof updateProductTagsWorkflow.prepare>[0]>;

/** Business facade over the shared host. Only Product is selected, irrespective
 * of other active installations in the trusted deployment. */
export const prepareProductTagUpdateWorkflow = Effect.fn("MedusaWorkflow.prepareProductTagUpdates")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductWorkflowModule> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
  readonly hooks?: ProductTagUpdateWorkflowHooks;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const modules = { product: yield* Effect.fromResult(captureWorkflowRecord(registrations.product)) };
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registeredHooks = yield* Effect.fromResult(captureWorkflowRecord(options.hooks ?? {}));
  if (Object.keys(registeredHooks).some(name => name !== "productTagsUpdated")
    || (registeredHooks.productTagsUpdated !== undefined && typeof registeredHooks.productTagsUpdated !== "function")) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["listProductTags", "updateProductTags"], graph: true },
  }, true));
  const handler = registeredHooks.productTagsUpdated;
  const hooks: MedusaHooks = handler === undefined ? {} : { productTagsUpdated: resources.callback((value: unknown, context) =>
    captureCommerceInput(value).pipe(Result.flatMap(decodeHook), Result.match({
      onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context),
    }))) };
  const prepared = yield* Effect.fromResult(updateProductTagsWorkflow.prepare(hooks)).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, workflow: {
    name: "updateProductTagsWorkflow", resources, prepared, input: WorkflowInput, output: ProductTagWorkflowResult,
    events: productTagWorkflowEvents("product-tag.updated", modules.product.module.methods.updateProductTags),
  } });
});
