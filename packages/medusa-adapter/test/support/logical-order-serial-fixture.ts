import { Effect, Result, Schema } from "effect";
import { OrderChange, OrderChangeAction } from "@medusajs/order/models";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { defineOrderPersistenceModule } from "../../src/modules/order/module";
import { captureOrderMetadata } from "../../src/modules/order/schema";
import { prepareScalarRepository } from "../../src/repository/scalar";
import { scalarIdWhere } from "../../src/repository/scalar-id-read";
import { deniedCommerceRepository } from "../../src/repository/denied";
import { commerceModuleEventBus } from "../../src/module/events";
import { commerceCommandPreparation, commerceServiceCommands } from "../../src/module/commands";
import { commerceDecoder } from "../../src/value/decoder";
import { captureExactNumericRow } from "../../src/value/exact-numeric";
import { captureCommerceInput } from "../../src/value/input";
import { compileCompleteRow } from "../../src/value/complete-row";
import { prepareLogicalOrderFixture } from "./logical-order-fixture";
import { orderCompletionRows } from "./logical-order-complete-fixture";

const Input = Schema.Struct({ order_change_id: Schema.String, action: Schema.Literal("CREDIT_LINE_ADD"),
  amount: Schema.String, details: Schema.Struct({ reference: Schema.Literal("refund"), reference_id: Schema.String }) });
const decodeCreates = commerceDecoder(Schema.Array(Schema.Unknown).check(Schema.isLengthBetween(1, 4)), "invalidInput");

/** A serial consumer witness, not a financial API or a replacement native DAL.
 * All Order business code and storage allocation execute their real owners.
 * The event bus records native emissions for assertions at this test boundary. */
export async function prepareLogicalOrderSerial(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const metadata = await Effect.runPromise(captureOrderMetadata());
  const action = metadata.frame.tables.find(table => table.name === "order_change_action"),
    change = metadata.frame.tables.find(table => table.name === "order_change");
  if (action === undefined || change === undefined) throw new Error("Missing genuine Order Change metadata");
  const complete = Result.getOrThrow(compileCompleteRow(action));
  const actions = Result.getOrThrow(prepareScalarRepository(action, "OrderChangeAction", scalarIdWhere)),
    changes = Result.getOrThrow(prepareScalarRepository(change, "OrderChange", scalarIdWhere));
  const emitted: unknown[] = [];
  const module = Result.getOrThrow(defineOrderPersistenceModule({ name: "order-serial-consumer", profile: "order.serial-consumer",
    bind: (ctx, owner) => {
      const bound = actions.bind(ctx, owner), parent = changes.bind(ctx, owner, bound.events, bound.bridge),
        denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const repository = { ...bound.repository, create: (input: unknown, shared?: Parameters<typeof bound.repository.create>[1]) =>
        bound.bridge.execute(shared, current => bound.bridge.checked(current, Effect.gen(function* () {
          const rows = yield* Effect.fromResult(decodeCreates(input));
          const captured = [];
          for (const row of rows) captured.push(yield* captureExactNumericRow(row, [{ name: "amount", nullable: true }]));
          const created = yield* bound.createRows(current, captured, shared);
          for (const row of created) yield* Effect.fromResult(complete(row));
          return created;
        }))) };
      const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
        capture: message => Effect.sync(() => { emitted.push(structuredClone(message)); }),
        check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
      return { baseRepository: repository, repository: model => model === OrderChangeAction ? repository :
        model === OrderChange ? parent.repository : denied, events: bound.mutationEvents, eventBus };
    }, service: native => ({ addOrderAction: native.addOrderAction.bind(native) }) }));
  const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("OrderSerial.prepare");
  const create = commands.write("nativeOrderSerialConsumer", prepare(commerceDecoder(Input, "invalidInput")),
    ({ service, context }, input) => Reflect.apply(service.addOrderAction, service, [input, context]));
  // An existing 203 ordinal is an intentional preservation witness. The
  // genuine native method supplies order/version after validating the Change.
  const parent = orderCompletionRows()[0];
  if (parent === undefined) throw new Error("Missing existing Order seed");
  const base = await prepareLogicalOrderFixture(driver, close, [create], "order-serial", [parent,
    { table: "order_change", row: { id: "ordch-serial", order_id: "order173-d", version: 1, status: "pending" } },
    { table: "order_change_action", row: { id: "ordchact-existing", order_id: "order173-d", order_change_id: "ordch-serial",
      ordering: 203, action: "CREDIT_LINE_ADD", details: {} } },
  ], undefined, "generate");
  const host = await Effect.runPromise(makeCommerceHost({ ...base.fixture.hostInput, commands: [create],
    logicalStorage: base.logicalStorage, identityAndAccessPolicy: { profile: "native-order-serial-consumer" } }));
  close(() => Effect.runPromise(host.close));
  const run = (key: string, refundId: string) => host.run(key, create, Result.getOrThrow(captureCommerceInput({
    order_change_id: "ordch-serial", action: "CREDIT_LINE_ADD", amount: "3.125",
    details: { reference: "refund", reference_id: refundId },
  })));
  return { ...base, host, run, emitted };
}
