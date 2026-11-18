import { Effect, Result, Schema } from "effect";
import { Store, StoreCurrency, StoreLocale } from "@medusajs/store/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { captureStoreMetadata } from "./schema";
import { defineStorePersistenceModule } from "./module";
import { prepareStoreCreationRepository } from "./create-repository";
import { StoreCreates, StorePhysicalDeletionIds, decodeStoreCreates, decodeStorePhysicalDeletionIds } from "./create-input";
import { storeCreationPolicy } from "./create-receipt";

const decodeCreateArguments = commerceDecoder(Schema.Tuple([StoreCreates]), "invalidInput");
const decodePhysicalArguments = commerceDecoder(Schema.Tuple([StorePhysicalDeletionIds]), "invalidInput");

/** Native Store creation and its retained physical inverse form one explicit
 * profile. Update, reads, lifecycle restoration and child root APIs stay denied. */
export const makeStoreCreationCommands = Effect.fn("StoreAdapter.createCommands")(function* () {
  const metadata = yield* captureStoreMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareStoreCreationRepository(metadata.frame);
    const module = yield* defineStorePersistenceModule({ name: "flarex-store-create", profile: "store-create", bind: (ctx, owner) => {
      const bound = prepared.bind(ctx, owner);
      const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
        capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
      return { baseRepository: bound.repository,
        repository: (model: typeof Store | typeof StoreCurrency | typeof StoreLocale) => model === Store ? bound.repository : bound.denied,
        events: bound.mutationEvents, eventBus };
    }, service: native => ({ createStores: native.createStores.bind(native), deleteStores: native.deleteStores.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("StoreCreate.prepare");
    const create = commands.write("storeCreateForWorkflow", prepare(decodeStoreCreates),
      ({ service, context }, input) => service.createStores(input, context));
    const deleteForWorkflow = commands.write("storePhysicalDeleteForWorkflow", prepare(decodeStorePhysicalDeletionIds), async ({ service, context }, ids) => {
      const result = await service.deleteStores([...ids], context);
      if (result !== undefined) throw commerceError("storedCorruption");
      return null;
    });
    const createStores = yield* defineWorkflowMethod({ command: create,
      arguments: decodeCreateArguments, encode: ([input]) => input,
      output: prepared.contracts.decodeRows, moduleEvents: ["store", "store_currency", "store_locale"].map(objectName =>
        buildModuleResourceEventName({ prefix: Modules.STORE, objectName, action: "created" })) });
    const deleteStores = yield* defineWorkflowMethod({ command: deleteForWorkflow,
      arguments: decodePhysicalArguments, encode: ([ids]) => ids,
      output: commerceDecoder(Schema.Null, "storedCorruption"),
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.STORE, objectName: "store", action: "deleted" })] });
    const admitted = [create, deleteForWorkflow], policy = storeCreationPolicy(prepared.contracts);
    const workflow = yield* defineWorkflowModule({ name: Modules.STORE, source: module.description,
      methods: { createStores, deleteStores }, graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    return { create, deleteForWorkflow, commands: admitted, workflow, withService: module.use,
      logicalEventPolicy: () => policy, output: prepared.contracts.Output, decodeOutput: prepared.contracts.decodeRows };
  }));
});
