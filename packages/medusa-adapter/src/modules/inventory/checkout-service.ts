import { Effect, Result, Schema } from "effect";
import type { LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceDecoder } from "../../value/decoder";
import { defineWorkflowMethod, defineWorkflowModule, workflowModuleDefinition } from "../../workflow/module";
import { makeLocalInventoryCommands, prepareInventoryCommandModule } from "./service";
import { compileReservationLineItemContracts } from "./reservation-line-item-input";
import { decodeCheckoutReservations, decodeCheckoutReservationIds, decodeCheckoutReservationArguments,
  decodeCheckoutReservationIdArguments, decodeCheckoutReservationOutput } from "./checkout-input";
import { inventoryCheckoutPolicy } from "./checkout-receipt";

/** One Inventory participant composes existing native graph reads with the
 * native reservation service. Each command keeps its real service/repository
 * owner; the outer workflow alone owns exclusion, replay and settlement. */
export const makeInventoryCheckoutCommands = Effect.fn("InventoryAdapter.checkoutCommands")(function* () {
  const native = yield* prepareInventoryCommandModule("checkout"), reads = yield* makeLocalInventoryCommands("variant-price-calculation");
  const graph = workflowModuleDefinition(reads.workflow);
  if (graph?.logical === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const contracts = yield* Effect.fromResult(compileReservationLineItemContracts(native.metadata.frame.tables));
  const policy = inventoryCheckoutPolicy(contracts), readPolicy = graph.logical;
  const commands = commerceServiceCommands(native.module.use), prepare = commerceCommandPreparation("InventoryCheckout.prepare");
  const reserve = commands.write("inventoryReserveForCheckout", prepare(decodeCheckoutReservations),
    ({ service, context }, rows) => service.createReservationItems([...rows], context));
  const remove = commands.write("inventoryDeleteReservationsForCheckout", prepare(decodeCheckoutReservationIds), async ({ service, context }, ids) => {
    const result = await service.deleteReservationItems([...ids], context);
    if (result !== undefined) throw commerceError("storedCorruption");
    return null;
  });
  const createReservationItems = yield* Effect.fromResult(defineWorkflowMethod({ command: reserve,
    arguments: decodeCheckoutReservationArguments, encode: ([rows]) => rows, output: decodeCheckoutReservationOutput,
    moduleEvents: ["inventory.reservation-item.created", "inventory.inventory-level.updated"] }));
  const deleteReservationItems = yield* Effect.fromResult(defineWorkflowMethod({ command: remove,
    arguments: decodeCheckoutReservationIdArguments, encode: ([ids]) => ids, output: commerceDecoder(Schema.Null, "storedCorruption"),
    moduleEvents: ["inventory.reservation-item.deleted", "inventory.inventory-level.updated"] }));
  const validateLogicalCall: LogicalCommerceCallValidation = Effect.fn("InventoryCheckout.validateCall")(function* (call, activity, command) {
    if (command === reserve || command === remove) return yield* policy.validateLogicalCall(call, activity);
    if (!readPolicy.commands.includes(command)) return yield* Effect.fail(commerceError("invalidAuthority"));
    yield* readPolicy.validateLogicalCall(call, activity, command);
  });
  const admitted = [...readPolicy.commands, reserve, remove];
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: reads.workflow.name, source: native.module.description,
    methods: { createReservationItems, deleteReservationItems }, graph: graph.graph,
    logical: { capture: policy.capture, validateLogicalCall, commands: admitted } }));
  return { workflow, reserve, remove, commands: admitted, contracts, logicalEventPolicy: () => ({ capture: policy.capture, validateLogicalCall }) };
});
