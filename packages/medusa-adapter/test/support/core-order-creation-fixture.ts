import { Effect, Result, Schema } from "effect";
import { defineOrderPersistenceModule } from "../../src/modules/order/module";
import { captureOrderMetadata } from "../../src/modules/order/schema";
import { prepareOrderCreationRepository } from "../../src/modules/order/finance-repository";
import { decodeOrderCreates } from "../../src/modules/order/creation-input";
import { commerceModuleEventBus } from "../../src/module/events";
import { commerceCommandPreparation, commerceServiceCommands } from "../../src/module/commands";
import { commerceDecoder } from "../../src/value/decoder";
import { captureNativeNumericDto } from "../../src/value/native-numeric";
import { orderFixtureHosts, prepareCoreOrderFixture } from "./core-order-fixture";

/** Native module consumer witness. This grants no checkout workflow facade;
 * native event observations remain diagnostic until call receipts are admitted. */
export async function prepareCoreOrderCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const metadata = await Effect.runPromise(captureOrderMetadata()), prepared = Result.getOrThrow(prepareOrderCreationRepository(metadata.frame));
  const emitted: unknown[] = [];
  const module = Result.getOrThrow(defineOrderPersistenceModule({ name: "order-creation-consumer", profile: "order.creation-consumer",
    bind: (ctx, owner) => {
      const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
        capture: message => Effect.sync(() => { emitted.push(structuredClone(message)); }),
        check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
      return { baseRepository: { ...bound.denied, serialize: bound.serialize }, repository: bound.repository,
        events: bound.mutationEvents, eventBus };
    }, service: native => ({ createOrders: native.createOrders.bind(native), deleteOrders: native.deleteOrders.bind(native) }) }));
  const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("OrderCreationConsumer.prepare");
  const create = commands.write("nativeOrderCreationConsumer", prepare(decodeOrderCreates), async ({ service, context }, input) =>
    Result.getOrThrow(captureNativeNumericDto(await Reflect.apply(service.createOrders, service, [input, context]))));
  const fail = commands.write("nativeOrderCreationLateFailureConsumer", prepare(decodeOrderCreates), async ({ service, context }, input) => {
    await Reflect.apply(service.createOrders, service, [input, context]); throw new Error("Late failure after genuine Order creation");
  });
  const remove = commands.write("nativeOrderCreationDeleteConsumer", prepare(commerceDecoder(Schema.Array(Schema.String)
    .check(Schema.isMaxLength(4)), "invalidInput")), async ({ service, context }, input) => {
      await service.deleteOrders([...input], context); return null;
    });
  const selected = [create, fail, remove];
  const base = await prepareCoreOrderFixture(driver, close, selected, [
    { table: "order", row: { id: "order-existing-creation", display_id: 400, currency_code: "usd", status: "pending" } },
  ], undefined, "generate");
  const hosts = orderFixtureHosts(close);
  const host = hosts.own(await base.fixture.run(base.fixture.openWriteHost("order", selected)));
  return { ...base, host, create, fail, remove, emitted };
}
