import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { capturePrivateCanonicalValue, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { captureCartCreationMetadata, compileCartCreationDefinition } from "../src/modules/cart/creation-schema";
import { prepareCartCreationOwnership } from "../src/modules/cart/creation-ownership";
import { withCommerceService } from "../src/module/service-bridge";
import { medusaLifecycle } from "../src/repository/lifecycle";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const participant = defineAtomicCommerceParticipant("cartOwnership");
const Id = Schema.String;
const Seed = Schema.Struct({ cart: Id, address: Id, shared: Schema.optionalKey(Id), soft: Schema.optionalKey(Schema.Boolean) });
const decodeSeed = Schema.decodeUnknownResult(Seed);
const decodeHandle = Schema.decodeUnknownResult(Schema.Struct({ operation_id: Id }));
const handle = Schema.decodeUnknownSync(Schema.Struct({ operation_id: Id }));
let connected: Awaited<ReturnType<typeof prepare>>;

/** These commands exercise the real native receipt store and logical DAL
 * boundary. Trusted initialization supplies rows; this fixture does not claim
 * native Cart creation/workflow admission or reproduce ownership decisions. */
async function prepare() {
  const definition = await Effect.runPromise(compileCartCreationDefinition());
  const metadata = (await Effect.runPromise(captureCartCreationMetadata())).frame;
  const ownership = Result.getOrThrow(prepareCartCreationOwnership(metadata));
  let addressFault = false;
  const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.cart-ownership", owner: "medusa", writeProfile: "medusa.cart-ownership",
    evidence: definition.provenance, definition: { kind: "relational", schema: definition.schema },
    bindings: definition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
  }));
  const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [source] });
  const seed = defineCommerceCommand("cartOwnershipSeed", "write", Effect.fn(function* (ctx, input) {
    const value = yield* Effect.fromResult(decodeSeed(input)).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    yield* (yield* ctx.table("cart_address")).write(ctx.manager, "insert", [{ id: value.address, country_code: "us" }]);
    const carts = [{ id: value.cart, currency_code: "usd", shipping_address_id: value.address },
      ...(value.shared === undefined ? [] : [{ id: value.shared, currency_code: "usd", billing_address_id: value.address,
        ...(value.soft === true ? { deleted_at: "2026-10-28T00:00:00.000Z" } : {}) }])];
    yield* (yield* ctx.table("cart")).write(ctx.manager, "insert", carts);
    return yield* withCommerceService(ctx, owner => ownership.bind(ctx, owner), bound => bound.store.record({
      carts: [{ id: value.cart, shipping_address_id: value.address, billing_address_id: null }], addresses: [value.address],
    }, { transactionManager: ctx.manager }));
  }));
  const inverse = defineCommerceCommand("cartOwnershipInverse", "write", Effect.fn(function* (ctx, input) {
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
  const commands = [seed, inverse, mutate, read, reclaim];
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => new Error("Invalid empty Cart ownership dataset"), hashFailure: cause => new Error("Cart ownership hash", { cause }) }));
  const storage = { ...fixture.hostInput.logicalStorage, source: { sourceKey: source.key, writeProfile: source.writeProfile, schema: definition.schema, evidence: definition.provenance },
    initialization: { stepId: "cart-ownership-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
  const reader = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage, commands }));
  cleanup.push(() => Effect.runPromise(reader.close)); await Effect.runPromise(reader.initialize([]));
  const seedRoot = defineAtomicCommerceCommand("cartOwnershipSeedRoot", (ctx, input) => ctx.call(participant, seed, input));
  const inverseRoot = defineAtomicCommerceCommand("cartOwnershipInverseRoot", (ctx, input) => ctx.call(participant, inverse, input));
  const mutateRoot = defineAtomicCommerceCommand("cartOwnershipMutateRoot", (ctx, input) => ctx.call(participant, mutate, input));
  const reclaimRoot = defineAtomicCommerceCommand("cartOwnershipReclaimRoot", (ctx, input) => ctx.call(participant, reclaim, input));
  const options = { ...fixture.hostInput, participants: [{ participant, logicalStorage: storage, commands }], commands: [seedRoot, inverseRoot, mutateRoot, reclaimRoot] };
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...options, executionIsolation: "scopeExclusive" }));
  cleanup.push(() => Effect.runPromise(host.close));
  const ordinary = await Effect.runPromise(makeAtomicCommerceHost(options)); cleanup.push(() => Effect.runPromise(ordinary.close));
  return { fixture, reader, host, ordinary, seedRoot, inverseRoot, mutateRoot, reclaimRoot, read,
    failAddressOnce: () => { addressFault = true; },
    seed: async (cart: string, address: string, shared?: string, soft?: boolean) => handle(await Effect.runPromise(host.run(host.newRequestKey(), seedRoot,
      { cart, address, ...(shared === undefined ? {} : { shared }), ...(soft === undefined ? {} : { soft }) }))),
    snapshot: async () => Promise.all(["cart", "cart_address", "cart_creation_operation", "cart_creation_cart", "cart_creation_address"]
      .map(table => Effect.runPromise(reader.read(read, table)))),
  };
}

beforeAll(async () => { connected = await prepare(); }, 240_000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);
describe("native Cart ownership on logical storage", { concurrent: false }, () => {
  it("refuses receipt issuance without authenticated scope exclusion and rolls earlier writes back", async () => {
    const before = await connected.snapshot();
    const exit = await Effect.runPromiseExit(connected.ordinary.run(connected.ordinary.newRequestKey(), connected.seedRoot, { cart: "no-scope-cart", address: "no-scope-address" }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "unsupportedProfile")).toBe(true);
    expect(await connected.snapshot()).toEqual(before);
  });
  it("deletes native claims with their targets and retains an idempotent operation", async () => {
    const receipt = await connected.seed("owned-cart", "owned-address");
    const result = await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.inverseRoot, receipt));
    expect(result).toEqual({ status: "compensated", deletedCartIds: ["owned-cart"], deletedAddressIds: ["owned-address"], retainedAddressIds: [] });
    const after = await connected.snapshot();
    expect(after[0]).toEqual([]); expect(after[1]).toEqual([]); expect(after[3]).toEqual([]); expect(after[4]).toEqual([]);
    expect(after[2]).toEqual([expect.objectContaining({ id: receipt.operation_id, state: "compensated" })]);
    expect(await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.inverseRoot, receipt)))
      .toEqual({ status: "alreadyCompensated", deletedCartIds: [], deletedAddressIds: [], retainedAddressIds: [] });
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
  });
  it.each(["replace-cart", "replace-address"] as const)("refuses %s after physical native ID reuse", async mode => {
    const cart = mode + "-cart", address = mode + "-address", receipt = await connected.seed(cart, address);
    await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), connected.mutateRoot, { cart, address, mode }));
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
  });
  it("rolls a partial inverse back with its native receipt, then permits retry and exact root replay", async () => {
    const receipt = await connected.seed("fault-cart", "fault-address"), before = await connected.snapshot();
    connected.failAddressOnce();
    const failed = await Effect.runPromiseExit(connected.host.run(connected.host.newRequestKey(), connected.inverseRoot, receipt));
    expect(Exit.isFailure(failed)).toBe(true); if (Exit.isFailure(failed)) expect(Cause.pretty(failed.cause)).toContain("Cart ownership Address deletion fault");
    expect(await connected.snapshot()).toEqual(before);
    const key = connected.host.newRequestKey(), result = await Effect.runPromise(connected.host.run(key, connected.inverseRoot, receipt)), after = await connected.snapshot();
    expect(result).toEqual({ status: "compensated", deletedCartIds: ["fault-cart"], deletedAddressIds: ["fault-address"], retainedAddressIds: [] });
    expect(await Effect.runPromise(connected.host.run(key, connected.inverseRoot, receipt))).toEqual(result);
    expect(await connected.snapshot()).toEqual(after);
  });
});
