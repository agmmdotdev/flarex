import { Effect, Schema } from "effect";
import { createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createCartsStep } from "@medusajs/core-flows/cart/create-carts-step";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { CartCreates } from "../../modules/cart/creation-input";
import type { makeCartCreationCommands } from "../../modules/cart/creation-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Cart = Effect.Success<ReturnType<typeof makeCartCreationCommands>>["workflow"];
export const cartCreationResources = Object.freeze({ ...defaultCommerceResources, calls: 512 });
const native = createWorkflow("native-owned-cart-creation", (input: WorkflowData<typeof CartCreates.Type>) => new WorkflowResponse(createCartsStep(input)));

/** The genuine native creation step and retained inverse over one fresh Cart
 * source. Scope exclusion is required by the native ownership protocol. */
export const prepareOwnedCartCreationWorkflow = Effect.fn("CartCreation.prepareWorkflow")(function* (input: {
  readonly execution: AtomicWorkflowExecution; readonly modules: { readonly cart: InstalledWorkflowModule<Cart> };
  readonly revision: string; readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key))) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["cart"]));
  const source = workflowModuleDefinition(modules.cart.module)?.source;
  if (source?.name !== "flarex-cart-creation" || source.profile !== "cart.creation-owned") return yield* Effect.fail(commerceError("invalidAuthority"));
  if (modules.cart.logicalResources !== undefined || modules.cart.logicalPublication !== undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ cart: { module: modules.cart.module,
    methods: ["createCartsWithOwnership", "compensateCartsCreation"], graph: false } }, true));
  const prepared = yield* Effect.fromResult(native.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules: { cart: { ...modules.cart, logicalResources: cartCreationResources } },
    revision: options.revision, subscribers: options.subscribers, requestCallLimit: cartCreationResources.calls,
    executionIsolation: "scopeExclusive", operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "nativeOwnedCartCreation", resources, prepared, input: CartCreates,
      output: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), events: internalModuleWorkflowEvents } });
});
