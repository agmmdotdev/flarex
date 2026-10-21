import { Effect } from "effect";
import { Modules } from "@medusajs/framework/utils/portable";
import type { CommerceCommand, LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineWorkflowModule, workflowMethodDefinition, workflowModuleDefinition } from "../../workflow/module";
import { makeLocalPricingCommands } from "./service";

/** One installed Pricing participant retains each child's original commands,
 * repositories and receipt issuer. The parent adds no transaction boundary. */
export const makePriceListPriceBatchCommands = Effect.fn("PricingAdapter.priceListPriceBatchCommands")(function* () {
  const creation = yield* makeLocalPricingCommands("price-list-price-creations");
  const update = yield* makeLocalPricingCommands("price-list-price-updates");
  const removal = yield* makeLocalPricingCommands("price-list-price-removals");
  const creationPolicy = workflowModuleDefinition(creation.workflow)?.logical;
  const updatePolicy = workflowModuleDefinition(update.workflow)?.logical;
  const removalPolicy = workflowModuleDefinition(removal.workflow)?.logical;
  if (creationPolicy === undefined || updatePolicy === undefined || removalPolicy === undefined ||
    creationPolicy.validateLogical !== undefined || updatePolicy.validateLogical !== undefined || removalPolicy.validateLogical !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const { listPriceLists, addPriceListPrices, removePrices } = creation.workflow.methods;
  const { snapshotPriceListPricesForUpdate, updatePriceListPrices, restorePriceListPrices } = update.workflow.methods;
  const { listPrices, softDeletePrices, restorePrices } = removal.workflow.methods;
  if (listPriceLists === undefined || addPriceListPrices === undefined || removePrices === undefined ||
    snapshotPriceListPricesForUpdate === undefined || updatePriceListPrices === undefined || restorePriceListPrices === undefined ||
    listPrices === undefined || softDeletePrices === undefined || restorePrices === undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const methods = { listPriceLists, addPriceListPrices, removePrices, snapshotPriceListPricesForUpdate,
    updatePriceListPrices, restorePriceListPrices, listPrices, softDeletePrices, restorePrices };
  const groups = [
    { methods: [listPriceLists, addPriceListPrices, removePrices], policy: creationPolicy },
    { methods: [snapshotPriceListPricesForUpdate, updatePriceListPrices, restorePriceListPrices], policy: updatePolicy },
    { methods: [listPrices, softDeletePrices, restorePrices], policy: removalPolicy },
  ];
  const commands: CommerceCommand[] = [];
  const owners = new Map<CommerceCommand, LogicalCommerceCallValidation>();
  for (const group of groups) for (const method of group.methods) {
    const definition = workflowMethodDefinition(method);
    if (definition === undefined || !group.policy.commands.includes(definition.command) ||
      owners.has(definition.command)) return yield* Effect.fail(commerceError("unsupportedProfile"));
    commands.push(definition.command); owners.set(definition.command, group.policy.validateLogicalCall);
  }
  const validateLogicalCall: LogicalCommerceCallValidation = Effect.fn("PricingBatch.validateChildCall")(function* (call, activity, command) {
    const validate = owners.get(command);
    if (validate === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
    // Forward the exact command object through its original module's issuer
    // check as well as the combined module's enclosing issuer check.
    yield* validate(call, activity, command);
  });
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: Modules.PRICING,
    source: { name: "flarex-pricing-local", profile: "pricing-price-list-price-batch" }, methods,
    graph: { aliases: [], reads: [] }, logical: { commands, capture: creationPolicy.capture, validateLogicalCall,
      allowStorageInsertionOrder: true, allowRecordedRowReplay: true, allowPreservingDeletionUpsert: "preserveTimestamps" },
  }));
  return { workflow, commands };
});
