import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import type { LogicalCommerceCallValidation } from "../../persistence-postgres/src/frameworks/atomicCommerce/participants";
import { captureCartCreationMetadata } from "../src/modules/cart/creation-schema";
import { prepareCartCreationOwnership } from "../src/modules/cart/creation-ownership";
import { withCommerceService } from "../src/module/service-bridge";
import { medusaLifecycle } from "../src/repository/lifecycle";
import { prepareCoreCartFixture } from "./support/core-cart-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const participant = defineAtomicCommerceParticipant("cartOwnership");
const Id = Schema.String;
const Seed = Schema.Struct({ cart: Id, address: Id, shared: Schema.optionalKey(Id), soft: Schema.optionalKey(Schema.Boolean) });
const decodeSeed = Schema.decodeUnknownResult(Seed);
const decodeHandle = Schema.decodeUnknownResult(Schema.Struct({ operation_id: Id }));
const handle = Schema.decodeUnknownSync(Schema.Struct({ operation_id: Id }));
let connected: Awaited<ReturnType<typeof prepare>>;

/** The ownership probes call the native receipt store and lifecycle through
 * one installed Cart source and the same Core settlement as workflow roots. */
async function prepare() {
  const metadata = (await Effect.runPromise(captureCartCreationMetadata())).frame;
  const ownership = Result.getOrThrow(prepareCartCreationOwnership(metadata));
  let addressFault = false;
  let inverseInvocations = 0;
  const traces: { call: Parameters<LogicalCommerceCallValidation>[0]; activity: Parameters<LogicalCommerceCallValidation>[1] }[] = [];
  const { fixture } = await prepareCoreCartFixture(driver, close => cleanup.push(close), []);
  const seed = defineCommerceCommand("cartOwnershipSeed", "write", Effect.fn(function* (ctx, input) {
    const value = yield* Effect.fromResult(decodeSeed(input)).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    yield* (yield* ctx.table("cart_address")).write(ctx.manager, "insert", [{ id: value.address, country_code: "us" }]);
    const carts = [{ id: value.cart, currency_code: "usd", shipping_address_id: value.address },
      ...(value.shared === undefined ? [] : [{ id: value.shared, currency_code: "usd",
        ...(value.soft === true ? { billing_address_id: value.address, deleted_at: "2026-10-28T00:00:00.000Z" }
          : { shipping_address_id: value.address }) }])];
    yield* (yield* ctx.table("cart")).write(ctx.manager, "insert", carts);
    return yield* withCommerceService(ctx, owner => ownership.bind(ctx, owner), bound => bound.store.record({
      carts: [{ id: value.cart, shipping_address_id: value.address, billing_address_id: null }], addresses: [value.address],
    }, { transactionManager: ctx.manager }));
  }));
  const inverse = defineCommerceCommand("cartOwnershipInverse", "write", Effect.fn(function* (ctx, input) {
    inverseInvocations++;
    const receipt = yield* Effect.fromResult(decodeHandle(input)).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    return yield* withCommerceService(ctx, owner => ({ owner, ...ownership.bind(ctx, owner) }), bound => bound.store.compensate(receipt,
      { transactionManager: ctx.manager }, {
        carts: ids => bound.owner.run(Effect.gen(function* () {
          const table = metadata.tables.find(table => table.name === "cart");
          if (table === undefined) return yield* Effect.die(new Error("Missing native Cart metadata"));
          const lifecycle = medusaLifecycle(ctx, { tables: metadata.tables, entities: [] }, "delete");
          return yield* (yield* lifecycle.plan(table, yield* lifecycle.roots(table, ids))).apply();
        })),
        addresses: ids => bound.owner.run(Effect.gen(function* () {
          if (addressFault) { addressFault = false; return yield* Effect.die(new Error("Cart ownership Address deletion fault")); }
          return yield* (yield* ctx.table("cart_address")).delete(ctx.manager, ids.map(id => ({ id })));
        })),
      }));
  }));
  const mutate = defineCommerceCommand("cartOwnershipMutate", "write", Effect.fn(function* (ctx, input) {
    const value = yield* Effect.fromResult(Schema.decodeUnknownResult(Schema.Struct({ cart: Id, address: Id,
      mode: Schema.Literals(["replace-cart", "replace-address", "delete-cart", "tombstone-claims"]) }))(input))
      .pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    const cart = metadata.tables.find(table => table.name === "cart");
    if (cart === undefined) return yield* Effect.die(new Error("Missing native Cart metadata"));
    if (value.mode === "tombstone-claims") {
      const lifecycle = medusaLifecycle(ctx, { tables: metadata.tables, entities: [] }, "softDelete");
      for (const [name, id] of [["cart_creation_cart", value.cart], ["cart_creation_address", value.address]]) {
        const table = metadata.tables.find(table => table.name === name);
        if (table === undefined || id === undefined) return yield* Effect.die(new Error("Missing claim model"));
        yield* (yield* lifecycle.plan(table, yield* lifecycle.roots(table, [id]))).apply();
      }
      return null;
    }
    const lifecycle = medusaLifecycle(ctx, { tables: metadata.tables, entities: [] }, "delete");
    yield* (yield* lifecycle.plan(cart, yield* lifecycle.roots(cart, [value.cart]))).apply();
    if (value.mode === "replace-cart") yield* (yield* ctx.table("cart")).write(ctx.manager, "insert", [
      { id: value.cart, currency_code: "usd", shipping_address_id: value.address },
    ]);
    if (value.mode === "replace-address") {
      const address = metadata.tables.find(table => table.name === "cart_address");
      if (address === undefined) return yield* Effect.die(new Error("Missing native Address metadata"));
      yield* (yield* lifecycle.plan(address, yield* lifecycle.roots(address, [value.address]))).apply();
      yield* (yield* ctx.table("cart_address")).write(ctx.manager, "insert", [{ id: value.address, country_code: "us" }]);
    }
    return null;
  }));
  const read = defineCommerceCommand("cartOwnershipRead", "read", Effect.fn(function* (ctx, input) {
    const table = yield* Effect.fromResult(Schema.decodeUnknownResult(Schema.Literals(["cart", "cart_address", "cart_creation_operation", "cart_creation_cart", "cart_creation_address"]))(input))
      .pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    return [...yield* (yield* ctx.table(table)).find(ctx.manager, { take: 256, order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [] } })];
  }));
  const reclaim = defineCommerceCommand("cartOwnershipReclaimProbe", "write", Effect.fn(function* (ctx, input) {
    const value = yield* Effect.fromResult(Schema.decodeUnknownResult(Schema.Struct({ cart: Id, address: Id, operation_id: Id,
      target: Schema.Literals(["cart", "address"]) }))(input)).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    if (value.target === "address") return [...yield* (yield* ctx.table("cart_creation_address")).write(ctx.manager, "insert", [
      { id: value.address, operation_id: value.operation_id, address_id: value.address },
    ])];
    return yield* withCommerceService(ctx, owner => ownership.bind(ctx, owner), bound => bound.store.record({
      carts: [{ id: value.cart, shipping_address_id: value.address, billing_address_id: null }], addresses: [value.address],
    }, { transactionManager: ctx.manager }));
  }));
  const reader = await Effect.runPromise(fixture.openReadHost("cart", [read]));
  cleanup.push(() => Effect.runPromise(reader.close));
  const seedRoot = defineAtomicCommerceCommand("cartOwnershipSeedRoot", (ctx, input) => ctx.call(participant, seed, input));
  const inverseRoot = defineAtomicCommerceCommand("cartOwnershipInverseRoot", (ctx, input) => ctx.call(participant, inverse, input));
  const mutateRoot = defineAtomicCommerceCommand("cartOwnershipMutateRoot", (ctx, input) => ctx.call(participant, mutate, input));
  const reclaimRoot = defineAtomicCommerceCommand("cartOwnershipReclaimRoot", (ctx, input) => ctx.call(participant, reclaim, input));
  const observe: LogicalCommerceCallValidation = (call, activity) => Effect.sync(() => {
    if (call.commandName === "cartOwnershipInverse" || call.commandName === "cartOwnershipMutate") traces.push({ call, activity });
  });
  const options = { identityAndAccessPolicy: fixture.execution.identityAndAccessPolicy,
    participants: [{ participant, nativeStorage: fixture.source("cart"), commands: [seed, inverse, mutate, reclaim], validateLogicalCall: observe }],
    commands: [seedRoot, inverseRoot, mutateRoot, reclaimRoot] };
  const host = await Effect.runPromise(fixture.execution.prepare({ ...options, executionIsolation: "scopeExclusive" }));
  cleanup.push(() => Effect.runPromise(host.close));
  const ordinary = await Effect.runPromise(fixture.execution.prepare(options));
  cleanup.push(() => Effect.runPromise(ordinary.close));
  return { fixture, host, ordinary, seedRoot, inverseRoot, mutateRoot, reclaimRoot,
    inverseInvocations: () => inverseInvocations,
    lastTrace: (name: "cartOwnershipInverse" | "cartOwnershipMutate") => traces.findLast(trace => trace.call.commandName === name)?.activity,
    failAddressOnce: () => { addressFault = true; },
    seed: async (cart: string, address: string, shared?: string, soft?: boolean) => handle(await Effect.runPromise(host.run(host.newRequestKey(), seedRoot,
      { cart, address, ...(shared === undefined ? {} : { shared }), ...(soft === undefined ? {} : { soft }) }))),
    snapshot: async () => Promise.all(["cart", "cart_address", "cart_creation_operation", "cart_creation_cart", "cart_creation_address"]
      .map(table => Effect.runPromise(reader.read(read, table)))),
  };
}

beforeAll(async () => { connected = await prepare(); }, 240_000);
afterAll(() => finishOrderFixture(cleanup.reverse()), 180_000);
describe("native Cart ownership on Core", { concurrent: false }, () => {
  it("refuses receipt issuance without authenticated scope exclusion and rolls earlier writes back", async () => {
    const before = await connected.fixture.snapshot();
    const exit = await Effect.runPromiseExit(connected.ordinary.run(connected.ordinary.newRequestKey(), connected.seedRoot, { cart: "no-scope-cart", address: "no-scope-address" }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "unsupportedProfile")).toBe(true);
    expect(await connected.fixture.snapshot()).toEqual(before);
  });
  it("deletes native claims with their targets and retains an idempotent operation", async () => {
    const receipt = await connected.seed("owned-cart", "owned-address");
    const key = connected.host.newRequestKey();
    const result = await Effect.runPromise(connected.host.run(key, connected.inverseRoot, receipt));
    expect(result).toEqual({ status: "compensated", deletedCartIds: ["owned-cart"], deletedAddressIds: ["owned-address"], retainedAddressIds: [] });
    const after = await connected.snapshot();
    expect(after[0]).toEqual([]); expect(after[1]).toEqual([]); expect(after[3]).toEqual([]); expect(after[4]).toEqual([]);
    expect(after[2]).toEqual([expect.objectContaining({ id: receipt.operation_id, state: "compensated" })]);
    const committed = await connected.fixture.snapshot(), invocations = connected.inverseInvocations();
    expect(await Effect.runPromise(connected.host.run(key, connected.inverseRoot, receipt))).toEqual(result);
    expect(connected.inverseInvocations()).toBe(invocations);
    expect(await connected.fixture.snapshot()).toEqual(committed);
    expect(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.inverseRoot, receipt)))
      .toEqual({ status: "alreadyCompensated", deletedCartIds: [], deletedAddressIds: [], retainedAddressIds: [] });
    expect(connected.inverseInvocations()).toBe(invocations + 1);
    expect(connected.lastTrace("cartOwnershipInverse")?.mutations).toEqual([]);
    expect(await connected.snapshot()).toEqual(after);
  });
  it("keeps canonical Cart and Address claim primary keys unique after tombstoning", async () => {
    const cart = "tombstone-cart", address = "tombstone-address", receipt = await connected.seed(cart, address);
    await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.mutateRoot, { cart, address, mode: "tombstone-claims" }));
    const before = await connected.snapshot();
    for (const target of ["cart", "address"]) {
      const exit = await Effect.runPromiseExit(connected.host.run(connected.host.newRequestKey(), connected.reclaimRoot, { cart, address, operation_id: receipt.operation_id, target }));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "invalidInput")).toBe(true);
      expect(await connected.snapshot()).toEqual(before);
    }
    expect(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.inverseRoot, receipt)))
      .toEqual({ status: "compensated", deletedCartIds: [cart], deletedAddressIds: [address], retainedAddressIds: [] });
  });
  it.each([false, true])("protects outside Cart references including soft-deleted=%s", async soft => {
    const cart = "shared-owner-" + soft, address = "shared-address-" + soft, shared = "outside-cart-" + soft;
    const receipt = await connected.seed(cart, address, shared, soft);
    expect(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.inverseRoot, receipt)))
      .toEqual({ status: "compensated", deletedCartIds: [cart], deletedAddressIds: [], retainedAddressIds: [address] });
    const snapshot = await connected.snapshot(); expect(snapshot[0]).toEqual(expect.arrayContaining([expect.objectContaining({ id: shared })]));
    expect(snapshot[1]).toEqual(expect.arrayContaining([expect.objectContaining({ id: address })]));
    expect(connected.lastTrace("cartOwnershipInverse")?.relationalReads).toContainEqual(expect.objectContaining({
      table: "cart", total: 2, returned: 2, query: expect.objectContaining({ predicate: {
        kind: "or", children: [{ kind: "in", column: "shipping_address_id", values: [address] },
          { kind: "in", column: "billing_address_id", values: [address] }],
      } }),
    }));
  });
  it.each(["replace-cart", "replace-address"] as const)("refuses %s after physical native ID reuse", async mode => {
    const cart = mode + "-cart", address = mode + "-address", receipt = await connected.seed(cart, address);
    await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.mutateRoot, { cart, address, mode }));
    const target = mode === "replace-cart" ? "cart" : "cart_address";
    const claim = mode === "replace-cart" ? "cart_creation_cart" : "cart_creation_address";
    const targetId = mode === "replace-cart" ? cart : address;
    expect(connected.lastTrace("cartOwnershipMutate")?.mutations
      .filter(mutation => mutation.table === target || mutation.table === claim)
      .map(mutation => [mutation.table, mutation.operation, (mutation.after ?? mutation.before)?.id]))
      .toEqual([[claim, "delete", targetId], [target, "delete", targetId], [target, "insert", targetId]]);
    const before = await connected.snapshot();
    const exit = await Effect.runPromiseExit(connected.host.run(connected.host.newRequestKey(), connected.inverseRoot, receipt));
    expect(Exit.isFailure(exit)).toBe(true); if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("superseded creation ownership");
    expect(await connected.snapshot()).toEqual(before);
  });
  it("removes a still-owned orphan when the original Cart is already gone", async () => {
    const cart = "orphan-cart", address = "orphan-address", receipt = await connected.seed(cart, address);
    await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.mutateRoot, { cart, address, mode: "delete-cart" }));
    expect(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.inverseRoot, receipt)))
      .toEqual({ status: "compensated", deletedCartIds: [], deletedAddressIds: [address], retainedAddressIds: [] });
    expect(connected.lastTrace("cartOwnershipInverse")?.relationalReads).toContainEqual(expect.objectContaining({
      table: "cart", total: 0, returned: 0, query: expect.objectContaining({ predicate: {
        kind: "or", children: [{ kind: "in", column: "shipping_address_id", values: [address] },
          { kind: "in", column: "billing_address_id", values: [address] }],
      } }),
    }));
  });
  it("rolls a partial inverse back with its native receipt, then permits retry and exact root replay", async () => {
    const receipt = await connected.seed("fault-cart", "fault-address"), before = await connected.fixture.snapshot();
    connected.failAddressOnce();
    const failed = await Effect.runPromiseExit(connected.host.run(connected.host.newRequestKey(), connected.inverseRoot, receipt));
    expect(Exit.isFailure(failed)).toBe(true); if (Exit.isFailure(failed)) expect(Cause.pretty(failed.cause)).toContain("Cart ownership Address deletion fault");
    expect(await connected.fixture.snapshot()).toEqual(before);
    const key = connected.host.newRequestKey(), result = await Effect.runPromise(connected.host.run(key, connected.inverseRoot, receipt));
    const after = await connected.fixture.snapshot(), invocations = connected.inverseInvocations();
    expect(result).toEqual({ status: "compensated", deletedCartIds: ["fault-cart"], deletedAddressIds: ["fault-address"], retainedAddressIds: [] });
    expect(await Effect.runPromise(connected.host.run(key, connected.inverseRoot, receipt))).toEqual(result);
    expect(connected.inverseInvocations()).toBe(invocations);
    expect(await connected.fixture.snapshot()).toEqual(after);
  });
});
