import { Result, Schema } from "effect";
import type { Context } from "@medusajs/framework/types";
import type { InventoryModuleService } from "@medusajs/inventory/services";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { PreparedCommerceModule } from "../../module/definition";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { defineWorkflowMethod } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import type { compileInventoryLevelContracts } from "./level-contracts";
import { InventoryLevelPhysicalDeletionIds, decodeInventoryLevelPhysicalDeletionIds } from "./level-lifecycle";
import { InventoryLevelsInput } from "./level-input";

const decodeCreate = commerceDecoder(InventoryLevelsInput, "invalidInput");
const decodeCreateArguments = commerceDecoder(Schema.Tuple([InventoryLevelsInput]), "invalidInput");
const decodePhysicalArguments = commerceDecoder(Schema.Tuple([InventoryLevelPhysicalDeletionIds]), "invalidInput");

/** The same genuine Level creation and retained physical inverse serve the
 * direct batch and the standalone Item workflow's validated Location child. */
export function prepareInventoryLevelCreationMethods<Service extends { readonly service: Pick<InventoryModuleService, "createInventoryLevels" | "deleteInventoryLevels">; readonly context: Context }>(
  use: PreparedCommerceModule<Service>["use"], contracts: Result.Result.Success<ReturnType<typeof compileInventoryLevelContracts>>,
) {
  return Result.gen(function* () {
    const commands = commerceServiceCommands(use), prepare = commerceCommandPreparation("InventoryLevelBatch.prepare");
    const createLevels = commands.write("inventoryCreateLevels", prepare(decodeCreate), ({ service, context }, input) =>
      service.createInventoryLevels([...input], context));
    const deleteForWorkflow = commands.write("inventoryLevelPhysicalDeleteForWorkflow", prepare(decodeInventoryLevelPhysicalDeletionIds),
      async ({ service, context }, ids) => {
        const result = await service.deleteInventoryLevels([...ids], context);
        if (result !== undefined) throw commerceError("storedCorruption");
        return null;
      });
    const createInventoryLevels = yield* defineWorkflowMethod({ command: createLevels, arguments: decodeCreateArguments,
      encode: ([input]) => input, output: contracts.decodeCreatedRows,
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "inventory_level", action: "created" })] });
    const deleteInventoryLevels = yield* defineWorkflowMethod({ command: deleteForWorkflow, arguments: decodePhysicalArguments,
      encode: ([ids]) => ids, output: commerceDecoder(Schema.Null, "storedCorruption"),
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "inventory_level", action: "deleted" })] });
    return { createLevels, deleteForWorkflow, createInventoryLevels, deleteInventoryLevels };
  });
}
