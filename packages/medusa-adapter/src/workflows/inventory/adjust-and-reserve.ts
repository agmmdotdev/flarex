import { Effect, Result, Schema } from "effect";
import { createWorkflow, WorkflowResponse, type PreparedWorkflow, type WorkflowData } from "@medusajs/workflows-sdk";
import { adjustInventoryLevelsStep } from "@medusajs/core-flows/inventory/adjust-inventory-levels-step";
import { createReservationsWorkflow } from "@medusajs/core-flows/reservation/create-reservations";
import { updateReservationsWorkflow } from "@medusajs/core-flows/reservation/update-reservations";
import { deleteReservationsWorkflow } from "@medusajs/core-flows/reservation/delete-reservations";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { Json, CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ScalarId } from "../../repository/scalar-id-read";
import { InventoryLevelsOutput } from "../../modules/inventory/level-input";
import { ReservationCreates, ReservationUpdates, ReservationIds, ReservationOutput } from "../../modules/inventory/reservation-input";
import { prepareWorkflowLocking } from "../../workflow/locking";
import { prepareWorkflowResources, type PreparedWorkflowResources } from "../../workflow/resources";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import type { makeLocalInventoryCommands } from "../../modules/inventory/service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { workflowModuleDefinition } from "../../workflow/module";

type InventoryModule = Effect.Success<ReturnType<typeof makeLocalInventoryCommands>>["workflow"];
type Options = { readonly execution: AtomicWorkflowExecution; readonly inventory: InstalledWorkflowModule<InventoryModule>;
  readonly revision: string; readonly subscribers: AtomicCommerceEvents["subscribers"] };
export const StockAdjustmentsInput = Schema.Array(Schema.Struct({ inventory_item_id: ScalarId, location_id: ScalarId,
  adjustment: Schema.Number.check(Schema.isFinite()) })).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const stockAdjustmentsWorkflow = createWorkflow("adjust-inventory-stock", (input: WorkflowData<typeof StockAdjustmentsInput.Type>) => new WorkflowResponse(adjustInventoryLevelsStep(input)));

const prepare = Effect.fn("InventoryStockWorkflow.prepare")(function* <Input extends Json, Output extends Json>(
  options: Options, kind: "adjust" | "create" | "update" | "release", name: string, native: PreparedWorkflow,
  input: Schema.Codec<Input>, output: Schema.ConstraintDecoder<Output>,
) {
  const captured = yield* Effect.fromResult(captureWorkflowRecord(options));
  const registration = yield* Effect.fromResult(captureWorkflowRecord(captured.inventory));
  const inventory = registration.module;
  if (workflowModuleDefinition(inventory) === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const selected = { adjust: ["adjustInventory"], create: ["createReservationItems"],
    update: ["listReservationItems", "updateReservationItems"], release: ["softDeleteReservationItems"] } as const;
  const locking = yield* Effect.fromResult(prepareWorkflowLocking(selected[kind].map(name => inventory.methods[name])));
  const selection = { module: inventory, graph: false as const };
  // No hooks cross this facade, so erase only the resource view after each
  // literal selection has passed the common static and authentic-token checks.
  const resourceDefinition = (): Result.Result<PreparedWorkflowResources, CommerceTransactionError> => {
    switch (kind) {
      case "adjust": return prepareWorkflowResources({ inventory: { ...selection, methods: ["adjustInventory"] } }, true, { locking });
      case "create": return prepareWorkflowResources({ inventory: { ...selection, methods: ["createReservationItems"] } }, true, { locking });
      case "update": return prepareWorkflowResources({ inventory: { ...selection, methods: ["listReservationItems", "updateReservationItems"] } }, true, { locking });
      case "release": return prepareWorkflowResources({ inventory: { ...selection, methods: ["softDeleteReservationItems"] } }, true, { locking });
    }
  };
  const resources = yield* Effect.fromResult(resourceDefinition());
  return yield* prepareAtomicWorkflowHost({ execution: captured.execution, revision: captured.revision, subscribers: captured.subscribers,
    modules: { inventory: registration }, workflow: {
    name, resources, prepared: native, input, output, events: { contracts: [], validate: () => Effect.void },
  } });
});
export const prepareStockAdjustmentsWorkflow = Effect.fn("InventoryWorkflow.adjust")(function* (options: Options) {
  return yield* prepare(options, "adjust", "adjustInventoryStock", yield* Effect.fromResult(stockAdjustmentsWorkflow.prepare()), StockAdjustmentsInput, InventoryLevelsOutput);
});
export const prepareCreateReservationWorkflow = Effect.fn("InventoryWorkflow.reserve")(function* (options: Options) {
  return yield* prepare(options, "create", "createInventoryReservation", yield* Effect.fromResult(createReservationsWorkflow.prepare()), Schema.Struct({ reservations: ReservationCreates }), ReservationOutput);
});
export const prepareUpdateReservationWorkflow = Effect.fn("InventoryWorkflow.updateReservation")(function* (options: Options) {
  return yield* prepare(options, "update", "updateInventoryReservation", yield* Effect.fromResult(updateReservationsWorkflow.prepare()), Schema.Struct({ updates: ReservationUpdates }), ReservationOutput);
});
export const prepareReleaseReservationWorkflow = Effect.fn("InventoryWorkflow.release")(function* (options: Options) {
  return yield* prepare(options, "release", "releaseInventoryReservation", yield* Effect.fromResult(deleteReservationsWorkflow.prepare()), Schema.Struct({ ids: ReservationIds }), Schema.Null);
});
