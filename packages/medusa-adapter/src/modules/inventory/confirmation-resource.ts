import { defineComposedWorkflowResource } from "../../workflow/composed-resource";
import type { WorkflowMethod } from "../../workflow/module";
import { decodeInventoryConfirmationOutput, normalizeInventoryConfirmationArguments } from "./confirmation-input";

/** Preserve the native confirmInventory ABI while only the authentic hidden
 * method token receives a JSON-safe exact quantity. No storage is exposed. */
export function makeInventoryConfirmationResource(confirmInventory: WorkflowMethod<readonly [string, readonly string[], string], boolean>) {
  return defineComposedWorkflowResource({ identity: { kind: "inventory-confirmation", maximumLocations: 4, maximumLevels: 16 },
    dependencies: [confirmInventory], methods: { confirmInventory: {
      arguments: normalizeInventoryConfirmationArguments, output: decodeInventoryConfirmationOutput,
    } },
    bind: invoke => ({ confirmInventory: (item, locations, quantity) => invoke(confirmInventory, item, locations, quantity) }) });
}
