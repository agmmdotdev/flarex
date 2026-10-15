import { Effect } from "effect";
import { batchVariantImagesWorkflow } from "@medusajs/core-flows/product/batch-variant-images";
import { batchImageVariantsWorkflow } from "@medusajs/core-flows/product/batch-image-variants";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { VariantImagesWorkflowInput, VariantImagesWorkflowOutput, ImageVariantsWorkflowInput, ImageVariantsWorkflowOutput } from "../../modules/product/variant-workflow-input";
import type { ProductWorkflowModule } from "../../modules/product/workflow";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { workflowModuleDefinition } from "../../workflow/module";
import { productImageVariantResources } from "../../workflow/policy";
import { prepareWorkflowResources } from "../../workflow/resources";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule, captureInstalledWorkflowModules } from "../../workflow/host";

export { internalModuleWorkflowEvents as variantImagesWorkflowEvents } from "../../workflow/events";
import { internalModuleWorkflowEvents as variantImagesWorkflowEvents } from "../../workflow/events";

interface ImageAssociationWorkflowInput {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductWorkflowModule> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}

const prepareImageAssociationResources = Effect.fn("MedusaWorkflow.prepareImageAssociationResources")(function* (input: ImageAssociationWorkflowInput) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["product"]));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ product: { module: modules.product.module,
    methods: ["addImageToVariant", "removeImageFromVariant", "listProductVariants", "updateProductVariants"], graph: true,
  } }, true));
  return { options, modules, resources };
});

export const prepareVariantImagesWorkflow = Effect.fn("MedusaWorkflow.prepareVariantImages")(function* (input: ImageAssociationWorkflowInput) {
  const { options, modules, resources } = yield* prepareImageAssociationResources(input);
  const prepared = yield* Effect.fromResult(batchVariantImagesWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, workflow: { name: "batchVariantImagesWorkflow", resources, prepared,
    input: VariantImagesWorkflowInput, output: VariantImagesWorkflowOutput, events: variantImagesWorkflowEvents,
  } });
});

/** The genuine inverse composer retains both parallel assignment branches,
 * its two removal queries and native URL-filtered thumbnail update. */
export const prepareImageVariantsWorkflow = Effect.fn("MedusaWorkflow.prepareImageVariants")(function* (input: ImageAssociationWorkflowInput) {
  const { options, modules, resources } = yield* prepareImageAssociationResources(input);
  const definition = workflowModuleDefinition(modules.product.module);
  if (definition?.source.name !== "flarex-product-local" || definition.source.profile !== "public.product-image-variant-workflows")
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const prepared = yield* Effect.fromResult(batchImageVariantsWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options,
    modules: { product: { ...modules.product, logicalResources: productImageVariantResources } },
    requestCallLimit: productImageVariantResources.calls, operationScheduling: "queued",
    workflow: { name: "batchImageVariantsWorkflow", resources, prepared,
      input: ImageVariantsWorkflowInput, output: ImageVariantsWorkflowOutput, events: variantImagesWorkflowEvents,
    } });
});
