import { Effect, Schema } from "effect";
import { batchInventoryItemLevelsWorkflow } from "@medusajs/core-flows/inventory/batch-inventory-item-levels";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { InventoryLevelInput } from "../../modules/inventory/level-input";
import { InventoryLevelUpdates } from "../../modules/inventory/update-level-input";
import { InventoryLevelDeletionIds } from "../../modules/inventory/delete-level-input";
import { InventoryLevelRows, InventoryLevelCreatedRows } from "../../modules/inventory/level-contracts";
import type { makeInventoryLevelBatchCommands } from "../../modules/inventory/batch-level-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

// Native workflow arrays are mutable. This Effect version rebuilds arrays in
// Schema.mutable, so apply collection bounds after that conversion.
const Creates = Schema.Array(InventoryLevelInput).pipe(Schema.mutable).check(Schema.isMaxLength(8));
export const InventoryLevelBatchInput = Schema.Struct({ create: Schema.optionalKey(Creates), update: Schema.optionalKey(InventoryLevelUpdates),
  delete: Schema.optionalKey(InventoryLevelDeletionIds.pipe(Schema.mutable).check(Schema.isMaxLength(4))), force: Schema.optionalKey(Schema.Boolean) });
export const InventoryLevelBatchOutput = Schema.Struct({ created: InventoryLevelCreatedRows,
  updated: InventoryLevelRows, deleted: Schema.optionalKey(InventoryLevelDeletionIds) });
type Inventory = Effect.Success<ReturnType<typeof makeInventoryLevelBatchCommands>>["workflow"];

/** The native parallel batch shares one finite Inventory owner. Its omitted
 * deleted output stays omitted; the creation callback grants no Location read. */
export const prepareInventoryLevelBatchWorkflow = Effect.fn("Inventory.prepareLevelBatch")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly inventory: InstalledWorkflowModule<Inventory> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["inventory"]));
  const source = workflowModuleDefinition(modules.inventory.module)?.source;
  if (source?.name !== "flarex-inventory-local" || source.profile !== "inventory-level-batches")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ inventory: { module: modules.inventory.module,
    methods: ["createInventoryLevels", "listInventoryLevels", "updateInventoryLevels", "softDeleteInventoryLevels", "restoreInventoryLevels", "deleteInventoryLevels"], graph: true } }, true));
  const prepared = yield* Effect.fromResult(batchInventoryItemLevelsWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued",
    workflow: { name: "batchInventoryItemLevelsWorkflow", resources, prepared,
      input: InventoryLevelBatchInput, output: InventoryLevelBatchOutput, events: internalModuleWorkflowEvents } });
});
