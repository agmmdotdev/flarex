import { Effect, Schema } from "effect";
import { createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { getVariantsAndItemsWithPrices } from "@medusajs/core-flows/cart/get-variants-and-items-with-prices";
import { confirmVariantInventoryWorkflow } from "@medusajs/core-flows/cart/confirm-variant-inventory";
import type { CartTypes } from "@medusajs/framework/types";
import type { CommerceCommand, LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeInventoryConfirmationCommands } from "../../modules/inventory/confirmation-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { defineWorkflowModule, workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { variantItemPricingParticipantLimit, variantInventoryConfirmationResources } from "../../workflow/policy";
import { prepareVariantItemPricingModules } from "./variant-item-pricing-graph";
import { VariantItemPricingInput, VariantItemPricingOutput } from "./variant-item-pricing";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Numeric = Schema.Union([Schema.String, Schema.Number.check(Schema.isFinite())]);
/** Supplied Cart context and original Items retain the existing bounded native
 * pricing ABI. The Variant selection follows those Items, never caller rows. */
export const VariantInventoryConfirmationInput = Schema.Struct({
  cart: VariantItemPricingInput.fields.cart, items: VariantItemPricingInput.fields.items,
  setPricingContextResult: VariantItemPricingInput.fields.setPricingContextResult, sales_channel_id: Id,
});
export const VariantInventoryConfirmationOutput = Schema.Struct({ ...VariantItemPricingOutput.fields,
  inventory: Schema.Struct({ items: Schema.Array(Schema.Struct({
    id: Schema.optionalKey(Id), inventory_item_id: Id, required_quantity: Schema.Number.check(Schema.isFinite()),
    allow_backorder: Schema.Boolean, quantity: Numeric, location_ids: Schema.Array(Id).check(Schema.isMaxLength(4)),
  })).check(Schema.isMaxLength(16)) }),
});

/** Both child workflows execute their original native preparation and guards.
 * Confirmation receives the original input Items rather than mapped line data. */
const variantInventoryConfirmationWorkflow = createWorkflow("native-variant-inventory-confirmation",
  (input: WorkflowData<typeof VariantInventoryConfirmationInput.Type>) => {
    const pricingInput = transform(input, value => ({
      cart: value.cart, items: value.items === undefined ? undefined : [...value.items],
      setPricingContextResult: value.setPricingContextResult,
      variants: { id: (value.items ?? []).flatMap(item => item.variant_id === undefined ? [] : [item.variant_id]) },
    }));
    // The already-admitted pricing boundary validates native partial Cart and
    // Item values. Its DTO declares complete mutable Cart items; that authoring
    // declaration does not describe the checked finite runtime input in 159.
    const priced = getVariantsAndItemsWithPrices.runAsStep({
      input: pricingInput as unknown as Parameters<typeof getVariantsAndItemsWithPrices.runAsStep>[0]["input"],
    });
    const confirmationInput = transform({ priced, input }, ({ priced, input }) => ({
      sales_channel_id: input.sales_channel_id, variants: priced.variants, items: input.items,
    }));
    // The native pricing authoring type declares Partial Variant DTOs. This
    // exact default graph validates selected scalars, Links and complete nested
    // Inventory/Location/Channel cohorts before native confirmation consumes
    // them. Empty create input also preserves the native early return before
    // its over-narrow DTO's required items field is accessed.
    const inventory = confirmVariantInventoryWorkflow.runAsStep({
      input: confirmationInput as unknown as WorkflowData<CartTypes.ConfirmVariantInventoryWorkflowInputDTO>,
    });
    return new WorkflowResponse({ variants: priced.variants, lineItems: priced.lineItems, inventory });
  });
const names = ["product", "pricing", "inventory", "stock_location", "sales_channel", "fulfillment",
  "product_links", "variant_links", "sales_channel_locations"] as const;

/** One Inventory participant owns the existing graph reads and confirmation.
 * The composed native ABI receives no database capability or extra lifetime.
 * The named trusted call allowance is bound by the existing host identity API. */
export const prepareVariantInventoryConfirmationWorkflow = Effect.fn("MedusaWorkflow.prepareVariantInventoryConfirmation")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly [Key in typeof names[number]]: InstalledWorkflowModule };
  readonly revision: string;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== names.length) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const captured = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, names));
  // Preserve the original graph owner's source/profile admission before the
  // combined Inventory profile adds a single authentic native method.
  const graphModules = yield* prepareVariantItemPricingModules(captured);
  const confirmation = yield* makeInventoryConfirmationCommands();
  const original = workflowModuleDefinition(graphModules.inventory.module);
  if (original?.logical === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const graphPolicy = original.logical, confirmationPolicy = confirmation.logicalEventPolicy();
  const graphCommands = new Set<CommerceCommand>(original.graph.reads.map(read => read.command));
  const validateLogicalCall: LogicalCommerceCallValidation = Effect.fn("Inventory.validateGraphAndConfirmation")(function* (call, activity, command) {
    if (command === confirmation.confirm) return yield* confirmationPolicy.validateLogicalCall(call, activity);
    if (!graphCommands.has(command)) return yield* Effect.fail(commerceError("invalidAuthority"));
    yield* graphPolicy.validateLogicalCall(call, activity, command);
  });
  const inventoryModule = yield* Effect.fromResult(defineWorkflowModule({ name: graphModules.inventory.module.name,
    source: { ...original.source, profile: "inventory-variant-confirmation" }, methods: confirmation.workflow.methods,
    graph: original.graph, logical: { commands: [...graphCommands, confirmation.confirm],
      capture: confirmationPolicy.capture, validateLogicalCall } }));
  const { inventory: inventoryStorage, ...otherModules } = graphModules;
  const modules = { ...otherModules, inventory_graph: { ...inventoryStorage, module: inventoryModule } };
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: [], graph: true },
    pricing: { module: modules.pricing.module, methods: ["calculatePrices"], graph: true },
    inventory_graph: { module: inventoryModule, methods: ["confirmInventory"], graph: true, expose: false },
    stock_location: { module: modules.stock_location.module, methods: [], graph: true },
    sales_channel: { module: modules.sales_channel.module, methods: [], graph: true },
    fulfillment: { module: modules.fulfillment.module, methods: [], graph: true },
    product_links: { module: modules.product_links.module, methods: [], graph: true, expose: false },
    variant_links: { module: modules.variant_links.module, methods: [], graph: true, expose: false },
    sales_channel_locations: { module: modules.sales_channel_locations.module, methods: [], graph: true, expose: false },
  }, false, { inventory: confirmation.resource }));
  const prepared = yield* Effect.fromResult(variantInventoryConfirmationWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision,
    operationScheduling: "queued", requestParticipantLimit: variantItemPricingParticipantLimit,
    requestCallLimit: variantInventoryConfirmationResources.calls,
    workflow: { name: "nativeVariantInventoryConfirmation", resources, prepared,
      input: VariantInventoryConfirmationInput, output: VariantInventoryConfirmationOutput } });
});
