import { Effect, Schema } from "effect";
import { createProductVariantInventoryLinksWorkflow, updateProductVariantInventoryLinksWorkflow,
  dismissProductVariantInventoryLinksWorkflow, batchProductVariantInventoryLinksWorkflow } from "@medusajs/core-flows/product/product-variant-inventory-links";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductVariantInventoryLinkWorkflowModule } from "../../modules/product/variant-inventory-link-workflow";
import type { prepareLocalVariantLinks } from "../../links/variant-service";
import { VariantInventoryLinkBatch } from "../../links/variant-service";
import { prepareVariantInventoryLinkResource } from "../../links/variant-inventory-resource";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";

type Links = Effect.Success<ReturnType<typeof prepareLocalVariantLinks>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const ProductVariantInventoryLinksInput = Schema.Struct({ product_id: Id, links: VariantInventoryLinkBatch });
export const ProductVariantInventoryLinkBatchInput = Schema.Struct({ product_id: Id,
  create: VariantInventoryLinkBatch, update: VariantInventoryLinkBatch, delete: VariantInventoryLinkBatch,
}).check(Schema.makeFilter(value => value.create.length + value.update.length + value.delete.length <= 8));
export const ProductVariantInventoryLinksOutput = VariantInventoryLinkBatch;
export const ProductVariantInventoryLinkBatchOutput = Schema.Struct({
  created: VariantInventoryLinkBatch, updated: VariantInventoryLinkBatch, deleted: VariantInventoryLinkBatch,
});

/** Four bounded Product-owned roots keep generic native Link workflows intact.
 * The Product query finishes before Link fanout and shares its settlement owner. */
export const prepareProductVariantInventoryLinkWorkflows = Effect.fn("ProductVariantInventoryLinks.prepare")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly product: InstalledWorkflowModule<ProductVariantInventoryLinkWorkflowModule>;
    readonly variant_links: InstalledWorkflowModule<Links["workflow"]> };
  readonly nativeInventoryLink: unknown;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 2) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["product", "variant_links"]));
  const product = workflowModuleDefinition(modules.product.module)?.source;
  if (product?.name !== "flarex-product-local" || product.profile !== "public.variant-inventory-links")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const link = yield* Effect.fromResult(prepareVariantInventoryLinkResource(options.nativeInventoryLink));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: ["listProductVariants"], graph: false },
    variant_links: { module: modules.variant_links.module,
      methods: ["inventoryNativeCreate", "inventoryNativeList", "inventoryNativeDismiss"], graph: false, expose: false },
  }, true, { link }));
  const create = yield* Effect.fromResult(createProductVariantInventoryLinksWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const update = yield* Effect.fromResult(updateProductVariantInventoryLinksWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const dismiss = yield* Effect.fromResult(dismissProductVariantInventoryLinksWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const batch = yield* Effect.fromResult(batchProductVariantInventoryLinksWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const common = { execution: options.execution, modules, revision: options.revision, subscribers: options.subscribers,
    operationScheduling: "queued" as const, borrowedOperationScheduling: "queued" as const };
  return {
    create: yield* prepareAtomicWorkflowHost({ ...common, workflow: {
      name: "createProductVariantInventoryLinksWorkflow", resources, prepared: create,
      input: ProductVariantInventoryLinksInput, output: ProductVariantInventoryLinksOutput, events: internalModuleWorkflowEvents,
    } }),
    update: yield* prepareAtomicWorkflowHost({ ...common, workflow: {
      name: "updateProductVariantInventoryLinksWorkflow", resources, prepared: update,
      input: ProductVariantInventoryLinksInput, output: ProductVariantInventoryLinksOutput, events: internalModuleWorkflowEvents,
    } }),
    dismiss: yield* prepareAtomicWorkflowHost({ ...common, workflow: {
      name: "dismissProductVariantInventoryLinksWorkflow", resources, prepared: dismiss,
      input: ProductVariantInventoryLinksInput, output: ProductVariantInventoryLinksOutput, events: internalModuleWorkflowEvents,
    } }),
    batch: yield* prepareAtomicWorkflowHost({ ...common, workflow: {
      name: "batchProductVariantInventoryLinksWorkflow", resources, prepared: batch,
      input: ProductVariantInventoryLinkBatchInput, output: ProductVariantInventoryLinkBatchOutput, events: internalModuleWorkflowEvents,
    } }),
  };
});
