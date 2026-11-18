import { Effect, Result, Schema } from "effect";
import { Store, StoreCurrency, StoreLocale } from "@medusajs/store/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { NativePreimageConfig } from "../../workflow/preimage";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureStoreMetadata } from "./schema";
import { defineStorePersistenceModule } from "./module";
import { prepareStoreUpdateRepository } from "./update-repository";
import { storeUpdatePolicy } from "./update-receipt";
import { storeUpdatePreimageSelection } from "./update-query";
import { StoreUpdateSelector, StoreUpdateData, StoreUpdateReadInput, StoreUpdateUpserts,
  decodeStoreUpdateInput, decodeStoreUpdateUpserts } from "./update-input";

const decodeRead = commerceDecoder(StoreUpdateReadInput, "invalidInput");
const decodeListArguments = commerceDecoder(Schema.Tuple([StoreUpdateSelector, NativePreimageConfig]), "invalidInput");
const decodeUpdateArguments = commerceDecoder(Schema.Tuple([StoreUpdateSelector, StoreUpdateData]), "invalidInput");
const decodeUpsertArguments = commerceDecoder(Schema.Tuple([StoreUpdateUpserts]), "invalidInput");

/** Native selector update and retained existing-root inverse. Child/root create,
 * lifecycle and unselected Store APIs remain absent from this admission. */
export const makeStoreUpdateCommands = Effect.fn("StoreAdapter.updateCommands")(function* () {
  const metadata = yield* captureStoreMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareStoreUpdateRepository(metadata.frame);
    const module = yield* defineStorePersistenceModule({ name: "flarex-store-update", profile: "store-update", bind: (ctx, owner) => {
      const bound = prepared.bind(ctx, owner);
      const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
        capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
      return { baseRepository: bound.repository,
        repository: (model: typeof Store | typeof StoreCurrency | typeof StoreLocale) => model === Store ? bound.repository : bound.denied,
        events: bound.mutationEvents, eventBus };
    }, service: native => ({ listStores: native.listStores.bind(native), updateStores: native.updateStores.bind(native), upsertStores: native.upsertStores.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("StoreUpdate.prepare");
    const list = commands.read("storeListForUpdate", prepare(input => captureCommerceInput(input).pipe(Result.flatMap(decodeRead),
      Result.flatMap(value => storeUpdatePreimageSelection(value.config ?? {}, prepared.read).pipe(Result.map(config => ({ filters: value.filters, config })))))),
      ({ service, context }, input) => service.listStores(input.filters, input.config === undefined ? {} : {
        ...(input.config.select === undefined ? {} : { select: [...input.config.select] }),
        ...(input.config.relations === undefined ? {} : { relations: [...input.config.relations] }),
      }, context));
    const updateForWorkflow = commands.write("storeUpdateForWorkflow", prepare(decodeStoreUpdateInput),
      ({ service, context }, input) => service.updateStores(input.selector, input.update, context));
    const upsertForWorkflow = commands.write("storeUpsertForUpdateInverse", prepare(decodeStoreUpdateUpserts),
      ({ service, context }, input) => service.upsertStores(input, context));
    const listStores = yield* defineWorkflowMethod({ command: list, arguments: decodeListArguments,
      encode: ([filters, config]) => ({ filters, config }), output: prepared.contracts.decodePreimages });
    const eventNames = [buildModuleResourceEventName({ prefix: Modules.STORE, objectName: "store", action: "updated" }),
      ...["store_currency", "store_locale"].flatMap(objectName => ["created", "updated", "deleted"].map(action =>
        buildModuleResourceEventName({ prefix: Modules.STORE, objectName, action })))];
    const updateStores = yield* defineWorkflowMethod({ command: updateForWorkflow, arguments: decodeUpdateArguments,
      encode: ([selector, update]) => ({ selector, update }), output: prepared.contracts.creation.decodeRows, moduleEvents: eventNames });
    const upsertStores = yield* defineWorkflowMethod({ command: upsertForWorkflow, arguments: decodeUpsertArguments,
      encode: ([input]) => input, output: prepared.contracts.creation.decodeRows, moduleEvents: eventNames });
    const admitted = [list, updateForWorkflow, upsertForWorkflow], policy = storeUpdatePolicy(prepared);
    const workflow = yield* defineWorkflowModule({ name: Modules.STORE, source: module.description,
      methods: { listStores, updateStores, upsertStores }, graph: { aliases: [], reads: [] },
      logical: { ...policy, commands: admitted, reconstitution: "advanceUpdatedAt" } });
    return { list, updateForWorkflow, upsertForWorkflow, commands: admitted, workflow, withService: module.use,
      logicalEventPolicy: () => ({ ...policy, reconstitution: "advanceUpdatedAt" as const }),
      output: prepared.contracts.creation.Output, decodeOutput: prepared.contracts.creation.decodeRows };
  }));
});
