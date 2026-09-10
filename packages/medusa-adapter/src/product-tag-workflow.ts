import { Effect, Result, Schema } from "effect";
import { createProductTagsWorkflow } from "@medusajs/core-flows/product/create-product-tags";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceDecoder } from "./commerce-decoder";
import { ProductTagWorkflowInput, ProductTagWorkflowResult, decodeProductTagWorkflowResult, type ProductWorkflowModule } from "./product-workflow-module";
import type { CurrencyWorkflowModule } from "./currency-service";
import { prepareWorkflowResources, type NativeWorkflowContext, type NativeWorkflowResources } from "./workflow/resources";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "./workflow/host";
import { captureWorkflowRecord } from "./workflow/configuration";
import { captureCommerceInput } from "./commerce-input";

import { productTagWorkflowEvents } from "./product-tag-workflow-events";
const WorkflowInput = Schema.Struct({ product_tags: ProductTagWorkflowInput,
  additional_data: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
});
const decodeInput = commerceDecoder(WorkflowInput, "invalidInput");
type ProductTagSelections = {
  readonly product: { readonly module: ProductWorkflowModule; readonly methods: readonly ["createProductTags"]; readonly graph: true };
  readonly currency: { readonly module: CurrencyWorkflowModule; readonly methods: readonly []; readonly graph: true };
};
export type ProductTagResources = NativeWorkflowResources<ProductTagSelections, true>;
type MedusaHooks = NonNullable<Parameters<typeof createProductTagsWorkflow.prepare>[0]>;
type CreatedTags = Result.Result.Success<ReturnType<typeof decodeProductTagWorkflowResult>>;
type AdditionalData = Result.Result.Success<ReturnType<typeof decodeInput>>["additional_data"];
export interface ProductTagWorkflowHooks {
  readonly productTagsCreated?: (input: { readonly product_tags: CreatedTags; readonly additional_data: AdditionalData },
    context: NativeWorkflowContext<ProductTagResources>) => unknown | Promise<unknown>;
}
const decodeHookInput = commerceDecoder(Schema.Struct({
  product_tags: Schema.Json, additional_data: Schema.optionalKey(Schema.JsonObject),
}), "invalidInput");
const decodeHook = (value: unknown) => captureCommerceInput(value).pipe(Result.flatMap(decodeHookInput), Result.flatMap(input => decodeProductTagWorkflowResult(input.product_tags).pipe(
  Result.map(product_tags => ({ product_tags, additional_data: input.additional_data })),
)));

/** Product-tag owns only selection, business input/hook and event correlation.
 * Shared assembly derives every wrapper, participant, graph and event binding. */
export const prepareProductTagWorkflow = Effect.fn("MedusaWorkflow.prepareProductTags")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductWorkflowModule>; readonly currency: InstalledWorkflowModule<CurrencyWorkflowModule> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
  readonly hooks?: ProductTagWorkflowHooks;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const modules = {
    product: yield* Effect.fromResult(captureWorkflowRecord(registrations.product)),
    currency: yield* Effect.fromResult(captureWorkflowRecord(registrations.currency)),
  };
  if (Object.keys(registrations).length !== 2) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registeredHooks = yield* Effect.fromResult(captureWorkflowRecord(options.hooks ?? {}));
  if (Object.keys(registeredHooks).some(name => name !== "productTagsCreated")
    || (registeredHooks.productTagsCreated !== undefined && typeof registeredHooks.productTagsCreated !== "function")) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["createProductTags"], graph: true },
    currency: { module: modules.currency.module, methods: [], graph: true },
  }, true));
  const handler = registeredHooks.productTagsCreated;
  // Decode the native hook view rather than inheriting Medusa's full DTO types
  // (whose date fields differ from the JSON command boundary).
  const hooks: MedusaHooks = handler === undefined ? {} : { productTagsCreated: resources.callback((value: unknown, context) =>
    decodeHook(value).pipe(Result.match({ onFailure: error => Promise.reject(error), onSuccess: decoded => handler(decoded, context) }))),
  };
  const prepared = yield* Effect.fromResult(createProductTagsWorkflow.prepare(hooks)).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const created = modules.product.module.methods.createProductTags;
  return yield* prepareAtomicWorkflowHost({ ...options, modules, workflow: {
    name: "createProductTagsWorkflow", resources, prepared, input: WorkflowInput, output: ProductTagWorkflowResult,
    events: productTagWorkflowEvents("product-tag.created", created),
  } });
});
