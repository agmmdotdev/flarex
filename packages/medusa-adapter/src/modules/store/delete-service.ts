import { Effect, Result } from "effect";
import { Store, StoreCurrency, StoreLocale } from "@medusajs/store/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineStorePersistenceModule } from "./module";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule, defineWorkflowMethod } from "../../workflow/module";
import { captureStoreMetadata } from "./schema";
import { prepareStoreDeletionRepository } from "./delete-repository";
import { decodeStoreDeletionArguments, decodeStoreDeletionIds } from "./delete-input";
import { storeDeletionPolicy } from "./delete-receipt";

/** Distinct deletion admission over the genuine complete native Store service.
 * The existing Sales Channel guard remains a separate read-only profile. */
export const makeStoreDeletionCommands = Effect.fn("StoreAdapter.deleteCommands")(function* () {
  const metadata = yield* captureStoreMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareStoreDeletionRepository(metadata.frame);
    const module = yield* defineStorePersistenceModule({ name: "flarex-store-delete", profile: "store-delete", bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository,
          repository: (model: typeof Store | typeof StoreCurrency | typeof StoreLocale) => model === Store ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus };
      },
      service: native => ({ softDeleteStores: native.softDeleteStores.bind(native), restoreStores: native.restoreStores.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("StoreDelete.prepare");
    const softDeleteForWorkflow = commands.write("storeSoftDeleteForWorkflow", prepare(decodeStoreDeletionIds),
      ({ service, context }, ids) => service.softDeleteStores([...ids], {}, context));
    const restoreForWorkflow = commands.write("storeRestoreForWorkflow", prepare(decodeStoreDeletionIds),
      ({ service, context }, ids) => service.restoreStores([...ids], {}, context));
    const moduleEvents = (action: "deleted" | "restored") => ["store", "store_currency", "store_locale"].map(objectName =>
      buildModuleResourceEventName({ prefix: Modules.STORE, objectName, action }));
    const softDeleteStores = yield* defineWorkflowMethod({ command: softDeleteForWorkflow, arguments: decodeStoreDeletionArguments,
      encode: ([ids]) => ids, output: prepared.contracts.decodeOutput, moduleEvents: moduleEvents("deleted") });
    const restoreStores = yield* defineWorkflowMethod({ command: restoreForWorkflow, arguments: decodeStoreDeletionArguments,
      encode: ([ids]) => ids, output: prepared.contracts.decodeOutput, moduleEvents: moduleEvents("restored") });
    const admitted = [softDeleteForWorkflow, restoreForWorkflow];
    const workflow = yield* defineWorkflowModule({ name: Modules.STORE, source: module.description,
      methods: { softDeleteStores, restoreStores }, graph: { aliases: [], reads: [] },
      logical: { ...storeDeletionPolicy(prepared.contracts), commands: admitted } });
    return { softDeleteForWorkflow, restoreForWorkflow, commands: admitted, workflow, withService: module.use };
  }));
});
