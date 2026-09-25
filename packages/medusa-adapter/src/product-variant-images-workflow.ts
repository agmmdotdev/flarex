import { Effect } from "effect";
import { batchVariantImagesWorkflow } from "@medusajs/core-flows/product/batch-variant-images";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { VariantImagesWorkflowInput, VariantImagesWorkflowOutput } from "./product-variant-workflow-input";
import type { ProductWorkflowModule } from "./product-workflow-module";
import { captureWorkflowRecord } from "./workflow/configuration";
import { prepareWorkflowResources } from "./workflow/resources";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "./workflow/host";

export { internalModuleWorkflowEvents as variantImagesWorkflowEvents } from "./workflow/events";
import { internalModuleWorkflowEvents as variantImagesWorkflowEvents } from "./workflow/events";

export const prepareVariantImagesWorkflow = Effect.fn("MedusaWorkflow.prepareVariantImages")(function* (input: {
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
    methods: ["addImageToVariant", "removeImageFromVariant", "listProductVariants", "updateProductVariants"], graph: true,
  } }, true));
  const prepared = yield* Effect.fromResult(batchVariantImagesWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, workflow: { name: "batchVariantImagesWorkflow", resources, prepared,
    input: VariantImagesWorkflowInput, output: VariantImagesWorkflowOutput, events: variantImagesWorkflowEvents,
  } });
});
