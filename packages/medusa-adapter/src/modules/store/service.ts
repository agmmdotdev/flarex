import { Effect, Result } from "effect";
import { Store, StoreCurrency, StoreLocale } from "@medusajs/store/models";
import { StoreModuleService } from "@medusajs/store/services";
import { Modules } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceModule } from "../../module/definition";
import { commerceModuleEventBus } from "../../module/events";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { captureStoreMetadata } from "./schema";
import { prepareStoreGuardRepository } from "./repository";
import { decodeStoreGuardRead, decodeStoreGuardArguments, decodeStoreGuardOutput } from "./input";

/** Genuine native Store service, admitted only for the deletion guard read. */
export const makeStoreGuardCommands = Effect.fn("StoreAdapter.guardCommands")(function* () {
  const metadata = yield* captureStoreMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareStoreGuardRepository(metadata.frame);
    const module = yield* defineCommerceModule({ name: "flarex-store-sales-channel-guard", models: [Store, StoreCurrency, StoreLocale],
      profile: { name: "store.sales-channel-guard", capabilities: [], bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: () => Effect.fail(commerceError("unadmittedEvent")), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository,
          repository: (model: typeof Store | typeof StoreCurrency | typeof StoreLocale) => model === Store ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus };
      } }, extensions: {},
      service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new StoreModuleService(container, { scope: "internal" });
        return { service: { listStores: native.listStores.bind(native) }, context };
      },
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const list = commerceServiceCommands(module.use).read("storeListForSalesChannelGuard",
      commerceCommandPreparation("Store.prepareGuardRead")(decodeStoreGuardRead), ({ service, context }, args) =>
        service.listStores(args.filters, { select: [...args.config.select] }, context));
    const listStores = yield* defineWorkflowMethod({ command: list, arguments: decodeStoreGuardArguments,
      encode: ([filters, config]) => ({ filters, config }), output: decodeStoreGuardOutput });
    const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("Store.validateGuardRead")(function* (call, activity) {
      if (call.mode !== "read" || call.events.length || activity.mutations.length || activity.lifecycle.length
        || activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    });
    const graph = { aliases: [], reads: [] };
    const workflow = yield* defineWorkflowModule({ name: Modules.STORE, source: module.description, methods: { listStores }, graph,
      logical: { commands: [list], capture: () => Effect.fail(commerceError("unadmittedEvent")), validateLogicalCall } });
    return { list, workflow, graph, commands: [list], withService: module.use };
  }));
});
