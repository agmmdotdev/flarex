import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import { makeCartCompletionCommands } from "../../src/modules/cart/payment-service";
import { compileCartCoreDefinition } from "../../src/modules/cart/schema";
import { makeOrderCheckoutCommands } from "../../src/modules/order/finance-service";
import { compileOrderCoreDefinition } from "../../src/modules/order/schema";
import { createCoreNativeWorkflowFixture, type CoreNativeWorkflowSource } from "./core-native-workflow-fixture";

type Driver = "pglite" | "postgres";
type Own = (cleanup: () => Promise<void>) => void;
type CartRows = CoreNativeWorkflowSource["rows"];
const targetIdentity = () => Object.freeze({ scopeUuid: randomUUID(), epochUuid: randomUUID() });

async function installCart(driver: Driver, close: Own, rows: CartRows, target: ReturnType<typeof targetIdentity>,
  extraSources: readonly CoreNativeWorkflowSource[]) {
  const [cart, cartDefinition, eventDefinition] = await Effect.runPromise(Effect.all([
    makeCartCompletionCommands(), compileCartCoreDefinition(target), compileCoreNativeEventStorageDefinition(target),
  ]));
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition,
    sources: [{ name: "cart", definition: cartDefinition, initialCommands: cart.commands, rows }, ...extraSources] });
  close(fixture.close);
  const modules = { cart: { module: cart.workflow, nativeStorage: fixture.source("cart") } };
  const options = { execution: fixture.execution, revision: "c".repeat(64), subscribers: [{ id: "cart-completion-test", revision: "d".repeat(64) }],
    operationScheduling: "queued" as const, borrowedOperationScheduling: "queued" as const };
  return { fixture, cart, cartDefinition, modules, options, snapshot: fixture.snapshot };
}

export function prepareCoreCartFixture(driver: Driver, close: Own, rows: CartRows) {
  return installCart(driver, close, rows, targetIdentity(), []);
}

export async function prepareCoreCartOrderFixture(driver: Driver, close: Own, rows: CartRows) {
  const target = targetIdentity();
  const [order, orderDefinition] = await Effect.runPromise(Effect.all([
    makeOrderCheckoutCommands(), compileOrderCoreDefinition(target, "generate"),
  ]));
  const base = await installCart(driver, close, rows, target, [
    { name: "order", definition: orderDefinition, initialCommands: order.commands, rows: [] },
  ]);
  return { ...base, order, orderDefinition, modules: { ...base.modules,
    order: { module: order.workflow, nativeStorage: base.fixture.source("order") } } };
}
