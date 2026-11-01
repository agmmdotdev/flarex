import { Cause, Context, Effect, Exit, Result, Schema, type Scope } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import { CommonEvents, Modules } from "@medusajs/framework/utils/portable";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, CommerceTransactionError, defaultCommerceResources, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime, type BoundedRequestContext } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/frameworks/commerceTransaction/context";
import type { PreparedCommerceModule } from "../src/module/definition";
import { defineProductModule, type ProductModuleScope } from "../src/modules/product/module";
import { productModuleEventCapture } from "../src/modules/product/events/capture";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { captureProductSchema } from "../src/modules/product/schema";

const Annotation = Context.Service<string>("ProductEventContextTest/Annotation");
const originKey = "Flarex/BoundedRequestFailureOrigin";
let metadata: ProductRuntimeMetadata;
let product: PreparedCommerceModule<ProductModuleScope>;
let capture: ReturnType<typeof productModuleEventCapture>;

beforeAll(async () => {
  const schema = await Effect.runPromise(captureProductSchema("product-event-context-test"));
  metadata = await Effect.runPromise(productRuntimeMetadata(schema.metadata.frame));
  product = Result.getOrThrow(defineProductModule(metadata, "internalProduct"));
  capture = productModuleEventCapture(metadata, defaultCommerceResources);
});

const run = <Value, Failure>(work: Effect.Effect<Value, Failure, Scope.Scope>) => Effect.runPromise(Effect.scoped(work));
const failed = <Value>(exit: Exit.Exit<Value, CommerceTransactionError>) => {
  if (Exit.isSuccess(exit)) throw new Error("Expected the Product event boundary to fail");
  return exit.cause;
};
const errors = (cause: Cause.Cause<CommerceTransactionError>) => cause.reasons.filter(Cause.isFailReason).map(reason => reason.error);
const origins = (cause: Cause.Cause<CommerceTransactionError>) => cause.reasons.map(reason => reason.annotations.get(originKey));
function onlyRefusal(cause: Cause.Cause<CommerceTransactionError>, reason: CommerceTransactionError["reason"]) {
  expect(cause.reasons).toHaveLength(1);
  const [entry] = cause.reasons;
  if (entry === undefined || !Cause.isFailReason(entry)) throw new Error("Expected one typed Product event refusal");
  expect(entry.error).toBeInstanceOf(CommerceTransactionError);
  expect(entry.error.reason).toBe(reason);
  expect(entry.annotations.get(originKey)).toBeTypeOf("object");
  return entry.error;
}
const message = (id = "product-event-owner") => ({ name: metadata.product.updatedEvent,
  metadata: { source: Modules.PRODUCT, object: metadata.product.eventObject, action: CommonEvents.UPDATED }, data: { id } });

/** Use the real Product definition, private bindProduct, service bridge and
 * Promise owner. The injected capture edge decodes the real Product policy;
 * an optional failure models that trusted edge's completion, not its policy.
 * Any unexpected store access fails instead of emulating persistence. */
const fixture = Effect.fn("ProductEventContextTest.fixture")(function* (complete?: (
  manager: BoundedRequestContext, event: Json, index: number,
) => Effect.Effect<void, CommerceTransactionError>) {
  const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError,
    { calls: 16, commandBytes: 1024, commandMs: 10_000 }, {}, {}, "request", "write"), lifetime => lifetime.close);
  let storageCalls = 0;
  const unused = () => Effect.suspend(() => {
    storageCalls++;
    return Effect.die(new Error("Product event propagation attempted storage"));
  });
  const store: CommerceCommandContext["store"] = {
    prepareRead: () => ({ find: unused, findPage: unused, count: unused }),
    aggregate: unused, find: unused, findPage: unused, count: unused, write: unused, delete: unused, lifecycle: unused,
  };
  const managers: BoundedRequestContext[] = [];
  const captured: Json[] = [];
  const captureEvent = Effect.fn("ProductEventContextTest.captureEdge")(function* (manager: BoundedRequestContext, event: unknown) {
    const index = managers.length;
    managers.push(manager);
    const value = yield* capture(event);
    captured.push(value);
    if (complete !== undefined) yield* complete(manager, value, index);
  });
  const context = (manager: BoundedRequestContext) => makeCommerceCommandContext(lifetime,
    { store, resources: defaultCommerceResources, table: unused }, "request", manager, unused, captureEvent);
  const root = context(lifetime.context);
  return { lifetime, root, context, managers, captured, storageCalls: () => storageCalls };
});

describe("actual Product event bus over its authentic Commerce context", () => {
  it("keeps valid event order and adds no operation, resource charge or storage call", () => run(Effect.gen(function* () {
    const test = yield* fixture();
    Result.getOrThrow(test.lifetime.charge(7));
    const calls = test.lifetime.usedCalls(), bytes = test.lifetime.remainingBytes();
    const messages = [message("first"), message("second")];
    expect(yield* product.use(test.root, async scope => {
      await scope.eventBus.emit(messages, { internal: true });
      return scope.capture(null);
    })).toBeNull();
    expect(test.captured).toEqual(messages);
    expect(test.managers).toEqual([test.root.manager, test.root.manager]);
    expect(test.lifetime.usedCalls()).toBe(calls);
    expect(test.lifetime.remainingBytes()).toBe(bytes);
    expect(test.storageCalls()).toBe(0);
    yield* test.lifetime.seal;
  })));

  it.each(["options", "batch"] as const)("latches fresh %s decoding failure before the Product capture edge", mode => run(Effect.gen(function* () {
    const test = yield* fixture();
    const calls = test.lifetime.usedCalls(), bytes = test.lifetime.remainingBytes();
    const completed = failed(yield* Effect.exit(product.use(test.root, async scope => {
      if (mode === "options") await scope.eventBus.emit([message()], { internal: false });
      else await scope.eventBus.emit(message(), { internal: true });
      return scope.capture(null);
    })));
    const original = onlyRefusal(completed, "unadmittedEvent");
    expect(Schema.isSchemaError(original.cause)).toBe(true);
    expect(test.managers).toEqual([]);
    expect(test.lifetime.usedCalls()).toBe(calls);
    expect(test.lifetime.remainingBytes()).toBe(bytes);
    expect(test.storageCalls()).toBe(0);
    const sealed = failed(yield* Effect.exit(test.lifetime.seal));
    expect(sealed.reasons).toHaveLength(2);
    expect(errors(sealed).map(error => error.reason)).toEqual(["rollbackOnly", "unadmittedEvent"]);
    expect(errors(sealed)[1]).toBe(original);
    expect(origins(sealed).slice(1)).toEqual(origins(completed));
  })));

  it("keeps the real Product event grammar refusal instead of starting another refusal operation", () => run(Effect.gen(function* () {
    const test = yield* fixture();
    const calls = test.lifetime.usedCalls(), bytes = test.lifetime.remainingBytes();
    const completed = failed(yield* Effect.exit(product.use(test.root, async scope => {
      await scope.eventBus.emit([{ ...message(), name: "product.unadmitted.updated" }], { internal: true });
      return scope.capture(null);
    })));
    expect(onlyRefusal(completed, "unadmittedEvent").cause).toBeUndefined();
    expect(test.managers).toEqual([test.root.manager]);
    expect(test.captured).toEqual([]);
    expect(test.lifetime.usedCalls()).toBe(calls);
    expect(test.lifetime.remainingBytes()).toBe(bytes);
    expect(test.storageCalls()).toBe(0);
    const sealed = failed(yield* Effect.exit(test.lifetime.seal));
    expect(sealed.reasons).toHaveLength(2);
    expect(errors(sealed).map(error => error.reason)).toEqual(["rollbackOnly", "unadmittedEvent"]);
  })));

  it("retains the full mixed capture Cause and issued origins through a native Promise rethrow", () => run(Effect.gen(function* () {
    const original = commerceError("unadmittedEvent"), defect = new TypeError("Product capture defect");
    const mixed = Cause.annotate(Cause.combine(Cause.combine(Cause.fail(original), Cause.die(defect)), Cause.interrupt(731)),
      Context.make(Annotation, "original-product-capture"));
    const test = yield* fixture(() => Effect.failCause(mixed));
    const calls = test.lifetime.usedCalls(), bytes = test.lifetime.remainingBytes();
    let rethrows = 0;
    const completed = failed(yield* Effect.exit(product.use(test.root, async scope => {
      try { await scope.eventBus.emit([message()], { internal: true }); } catch (error) { rethrows++; throw error; }
      return scope.capture(null);
    })));
    expect(rethrows).toBe(1);
    expect(completed.reasons).toHaveLength(3);
    expect(errors(completed)).toEqual([original]);
    expect(errors(completed)[0]).toBe(original);
    expect(completed.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([defect]);
    expect(completed.reasons.filter(Cause.isInterruptReason).map(reason => reason.fiberId)).toEqual([731]);
    expect(new Set(origins(completed)).size).toBe(3);
    for (const reason of completed.reasons) {
      expect(reason.annotations.get(originKey)).toBeTypeOf("object");
      expect(reason.annotations.get(Annotation.key)).toBe("original-product-capture");
    }
    expect(test.managers).toEqual([test.root.manager]);
    expect(test.lifetime.usedCalls()).toBe(calls);
    expect(test.lifetime.remainingBytes()).toBe(bytes);
    expect(test.storageCalls()).toBe(0);
    const sealed = failed(yield* Effect.exit(test.lifetime.seal));
    expect(sealed.reasons).toHaveLength(4);
    expect(origins(sealed).slice(1)).toEqual(origins(completed));
  })));

  it("retains independent equal-error occurrences through capture, rethrow and seal", () => run(Effect.gen(function* () {
    const reused = commerceError("unadmittedEvent"), sameCode = commerceError("unadmittedEvent");
    const independent = Cause.fromReasons([Cause.makeFailReason(reused), Cause.makeFailReason(reused), Cause.makeFailReason(sameCode)]);
    const test = yield* fixture(() => Effect.failCause(independent));
    let rethrows = 0;
    const completed = failed(yield* Effect.exit(product.use(test.root, async scope => {
      try { await scope.eventBus.emit([message()], { internal: true }); } catch (error) { rethrows++; throw error; }
      return scope.capture(null);
    })));
    expect(rethrows).toBe(1);
    expect(completed.reasons).toHaveLength(3);
    expect(errors(completed)).toEqual([reused, reused, sameCode]);
    expect(errors(completed)[0]).toBe(errors(completed)[1]);
    expect(errors(completed)[2]).not.toBe(reused);
    expect(origins(completed).every(token => typeof token === "object" && token !== null)).toBe(true);
    expect(new Set(origins(completed)).size).toBe(3);
    const sealed = failed(yield* Effect.exit(test.lifetime.seal));
    expect(sealed.reasons).toHaveLength(4);
    expect(origins(sealed).slice(1)).toEqual(origins(completed));
    expect(test.managers).toEqual([test.root.manager]);
    expect(test.lifetime.usedCalls()).toBe(1);
    expect(test.lifetime.remainingBytes()).toBe(1024);
    expect(test.storageCalls()).toBe(0);
  })));

  it("selects the active borrowed child when the native repository invokes the event bus", () => run(Effect.gen(function* () {
    const original = commerceError("unadmittedEvent");
    const test = yield* fixture(() => Effect.fail(original));
    let childManager: unknown;
    let childCalls = 0, childBytes = 0;
    const completed = failed(yield* Effect.exit(product.use(test.root, scope => scope.repository.transaction(async manager => {
      childManager = manager;
      childCalls = test.lifetime.usedCalls(); childBytes = test.lifetime.remainingBytes();
      await scope.eventBus.emit([message()], { internal: true });
      return scope.capture(null);
    }))));
    expect(onlyRefusal(completed, "unadmittedEvent")).toBe(original);
    expect(childManager).not.toBe(test.root.manager);
    expect(test.managers).toEqual([childManager]);
    expect(childCalls).toBe(2);
    expect(test.lifetime.usedCalls()).toBe(childCalls);
    expect(test.lifetime.remainingBytes()).toBe(childBytes);
    expect(test.storageCalls()).toBe(0);
    const sealed = failed(yield* Effect.exit(test.lifetime.seal));
    expect(sealed.reasons).toHaveLength(2);
    expect(origins(sealed).slice(1)).toEqual(origins(completed));
  })));

  it("stops at a failed capture without invoking later events or admitting another operation", () => run(Effect.gen(function* () {
    const original = commerceError("unadmittedEvent");
    const test = yield* fixture((_manager, _event, index) => index === 1 ? Effect.fail(original) : Effect.void);
    const messages = [message("first"), message("refused"), message("never-entered")];
    const completed = failed(yield* Effect.exit(product.use(test.root, async scope => {
      await scope.eventBus.emit(messages, { internal: true });
      return scope.capture(null);
    })));
    expect(onlyRefusal(completed, "unadmittedEvent")).toBe(original);
    expect(test.captured).toEqual(messages.slice(0, 2));
    expect(test.managers).toHaveLength(2);
    expect(test.lifetime.usedCalls()).toBe(1);
    expect(test.lifetime.remainingBytes()).toBe(1024);
    let entered = false;
    const later = failed(yield* Effect.exit(test.lifetime.operation(test.root.manager, "request", "write", Effect.sync(() => { entered = true; }))));
    expect(onlyRefusal(later, "rollbackOnly").cause).toEqual(completed);
    expect(entered).toBe(false);
    expect(test.storageCalls()).toBe(0);
    const sealed = failed(yield* Effect.exit(test.lifetime.seal));
    expect(sealed.reasons).toHaveLength(2);
    expect(errors(sealed)[1]).toBe(original);
  })));

  it.each(["foreign", "revoked", "closing", "closed"] as const)("keeps the original failure and %s observer refusal without borrowing another owner's authority", mode => run(Effect.gen(function* () {
    const left = yield* fixture(), right = yield* fixture();
    let context = left.root;
    if (mode === "foreign") context = left.context(right.root.manager);
    else if (mode === "revoked") context = yield* left.root.borrow(child => Effect.succeed(child));
    else {
      yield* left.lifetime.seal;
      if (mode === "closed") yield* left.lifetime.close;
    }
    const leftCalls = left.lifetime.usedCalls(), leftBytes = left.lifetime.remainingBytes();
    const rightCalls = right.lifetime.usedCalls(), rightBytes = right.lifetime.remainingBytes();
    const completed = failed(yield* Effect.exit(product.use(context, async scope => {
      await scope.eventBus.emit([message()], { internal: false });
      return scope.capture(null);
    })));
    // The real module retains observation denials at the checked event edge,
    // native Promise completion and joined completion. Invalid contexts cannot
    // authenticate any of those Reasons or replace the original decoder error.
    expect(completed.reasons).toHaveLength(4);
    expect(completed.reasons.every(Cause.isFailReason)).toBe(true);
    expect(completed.reasons.filter(Cause.isDieReason)).toEqual([]);
    expect(completed.reasons.filter(Cause.isInterruptReason)).toEqual([]);
    const denied = mode === "closing" ? "closed" : "invalidAuthority";
    const failures = errors(completed);
    expect(failures.map(error => error.reason)).toEqual(["unadmittedEvent", denied, denied, denied]);
    for (const error of failures) expect(error).toBeInstanceOf(CommerceTransactionError);
    const [original, ...denials] = failures;
    expect(Schema.isSchemaError(original?.cause)).toBe(true);
    expect(new Set(denials).size).toBe(3);
    for (const denial of denials) expect(denial.cause).toBeUndefined();
    for (const [index, reason] of completed.reasons.entries()) {
      expect(reason.annotations.has(originKey)).toBe(false);
      expect(reason.annotations.get("effect/Cause/StackTrace")).toMatchObject({
        name: index < 2 ? "CommerceRepository.checked" : "MedusaAdapter.withService",
      });
    }
    expect(left.managers).toEqual([]); expect(right.managers).toEqual([]);
    expect(left.lifetime.usedCalls()).toBe(leftCalls); expect(left.lifetime.remainingBytes()).toBe(leftBytes);
    expect(right.lifetime.usedCalls()).toBe(rightCalls); expect(right.lifetime.remainingBytes()).toBe(rightBytes);
    if (mode === "foreign" || mode === "revoked") yield* left.lifetime.seal;
    yield* right.lifetime.seal;
    expect(left.storageCalls()).toBe(0); expect(right.storageCalls()).toBe(0);
  })));

  it("refuses an escaped event bus after the actual module Promise owner closes", () => run(Effect.gen(function* () {
    const test = yield* fixture();
    let escaped: ProductModuleScope["eventBus"] | undefined;
    yield* product.use(test.root, scope => {
      escaped = scope.eventBus;
      return scope.capture(null);
    });
    if (escaped === undefined) throw new Error("Product event bus was not retained");
    const bus = escaped;
    const calls = test.lifetime.usedCalls(), bytes = test.lifetime.remainingBytes();
    const late = yield* Effect.exit(Effect.tryPromise({ try: () => bus.emit([message()], { internal: true }), catch: error => error }));
    if (Exit.isSuccess(late)) throw new Error("Closed Product event owner accepted a late event");
    expect(late.cause.reasons).toHaveLength(1);
    const [reason] = late.cause.reasons;
    if (reason === undefined || !Cause.isFailReason(reason)) throw new Error("Late event lost its typed refusal");
    expect(reason.error).toBeInstanceOf(CommerceTransactionError);
    expect(reason.error).toMatchObject({ reason: "closed" });
    expect(test.managers).toEqual([]);
    expect(test.lifetime.usedCalls()).toBe(calls); expect(test.lifetime.remainingBytes()).toBe(bytes);
    expect(test.storageCalls()).toBe(0);
    yield* test.lifetime.seal;
  })));
});
