import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber } from "effect";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant, defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxAppRowCurrent, fxSystemCommits } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalInventoryHosts, prepareInventoryCreateHost } from "./support/logical-inventory-fixture";
import { prepareInventoryStockingWorkflow } from "../src/workflows/inventory/stock";
import { prepareStockAdjustmentsWorkflow, prepareCreateReservationWorkflow, prepareUpdateReservationWorkflow, prepareReleaseReservationWorkflow } from "../src/workflows/inventory/adjust-and-reserve";
import type { AtomicWorkflowExecution } from "../src/workflow/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid reservation driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let members: Awaited<ReturnType<typeof prepareLogicalInventoryHosts>>;
let adjust: Effect.Success<ReturnType<typeof prepareStockAdjustmentsWorkflow>>;
let create: Effect.Success<ReturnType<typeof prepareCreateReservationWorkflow>>;
let update: Effect.Success<ReturnType<typeof prepareUpdateReservationWorkflow>>;
let release: Effect.Success<ReturnType<typeof prepareReleaseReservationWorkflow>>;
let stock: Effect.Success<ReturnType<typeof prepareInventoryStockingWorkflow>>;
const revision = "8".repeat(64);
const subscribers = [{ id: "inventory-reservations", revision }];
const levelIds = new Map<string, string>();
const data = (location: string, quantity = 1) => ({ inventory_item_id: "reserved-item", location_id: location, quantity });
const run = <Input, Output>(host: { newRequestKey(): string; run(key: string, input: Input): Effect.Effect<Output, CommerceTransactionError> }, input: Input) => Effect.runPromise(host.run(host.newRequestKey(), input));
function nativeFailure(value: unknown): unknown {
  if (Cause.isCause(value)) return nativeFailure(Cause.squash(value));
  if (value instanceof Error && value.cause !== undefined) return nativeFailure(value.cause);
  return value;
}
const rows = () => fixture.persistence.drizzle.select().from(fxAppRowCurrent);
const events = () => fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
async function seed(location: string, quantity = 5) {
  const created = await run(stock, { locations: [{ id: location, name: location }], inventory_levels: [
    { inventory_item_id: "reserved-item", location_index: 0, stocked_quantity: quantity },
  ] });
  levelIds.set(location, created.inventory_levels[0]!.id);
}
async function probe(location: string, reservationIds: readonly string[], scope = { fixture, members, levelId: levelIds.get(location) }) {
  const participant = defineAtomicCommerceParticipant("inventory");
  const read = defineCommerceCommand("reservationProofRead", "read", Effect.fn("ReservationProof.read")(function* (ctx) {
    const levelId = scope.levelId;
    if (levelId === undefined) throw new Error("Missing authentic level result");
    const query = (ids: readonly string[]) => ({ predicate: { kind: "in", column: "id", values: ids }, take: 8, order: { column: "id", direction: "asc" } });
    return { levels: yield* (yield* ctx.table("inventory_level")).find(ctx.manager, query([levelId])),
      reservations: yield* (yield* ctx.table("reservation_item")).find(ctx.manager, query(reservationIds)) };
  }));
  const command = defineAtomicCommerceCommand("reservationProof", ctx => ctx.call(participant, read, null));
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...scope.fixture.hostInput, commands: [command], participants: [{
    participant, logicalStorage: scope.members.inventory.hostInput.logicalStorage, commands: [read],
  }] }));
  try { return await Effect.runPromise(host.run(host.newRequestKey(), command, null)); }
  finally { await Effect.runPromise(host.close); }
}

describe("native stock adjustments and individual reservation workflows", () => {
  beforeAll(async () => {
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeProduct: true, includePricing: true, includeVariantInventory: true });
    members = await prepareLogicalInventoryHosts(fixture, { stock: true, stockLocations: true });
    const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
    const options = { execution,
      inventory: { module: members.inventory.runtime.workflow, logicalStorage: members.inventory.hostInput.logicalStorage }, revision, subscribers };
    adjust = await Effect.runPromise(prepareStockAdjustmentsWorkflow(options));
    create = await Effect.runPromise(prepareCreateReservationWorkflow(options));
    update = await Effect.runPromise(prepareUpdateReservationWorkflow(options));
    release = await Effect.runPromise(prepareReleaseReservationWorkflow(options));
    stock = await Effect.runPromise(prepareInventoryStockingWorkflow({ execution: options.execution, revision, subscribers, modules: {
      inventory: options.inventory, stock_location: { module: members.stockLocation.runtime.workflow, logicalStorage: members.stockLocation.hostInput.logicalStorage },
    } }));
    for (const host of [adjust, create, update, release, stock]) cleanup.push(() => Effect.runPromise(host.close));
    const seedHost = await prepareInventoryCreateHost(fixture, members.inventory);
    try { await Effect.runPromise(seedHost.host.run(seedHost.host.newRequestKey(), seedHost.create, [{ id: "reserved-item", sku: "reservation-sku" }])); }
    finally { await Effect.runPromise(seedHost.host.close); }
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("refuses forged or missing Inventory tokens before inspecting methods or preparing execution", async () => {
    const getter = vi.fn(() => members.inventory.runtime.workflow.methods);
    const forged = Object.defineProperty({ ...members.inventory.runtime.workflow }, "methods", { get: getter, enumerable: true });
    const prepareExecution = vi.fn(() => Effect.die("Unexpected execution preparation"));
    const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: {}, prepare: prepareExecution };
    for (const token of [forged, undefined, null]) {
      const inventory = { module: members.inventory.runtime.workflow, logicalStorage: members.inventory.hostInput.logicalStorage };
      Reflect.set(inventory, "module", token);
      const options = { execution, inventory, revision, subscribers };
      const preparations = [prepareStockAdjustmentsWorkflow(options).pipe(Effect.asVoid), prepareCreateReservationWorkflow(options).pipe(Effect.asVoid),
        prepareUpdateReservationWorkflow(options).pipe(Effect.asVoid), prepareReleaseReservationWorkflow(options).pipe(Effect.asVoid)];
      for (const preparation of preparations) {
        await expect(Effect.runPromise(preparation))
          .rejects.toMatchObject({ reason: "unsupportedProfile" });
      }
    }
    expect(getter).not.toHaveBeenCalled();
    expect(prepareExecution).not.toHaveBeenCalled();
  });

  it("creates, changes and releases an exact fractional reservation, publishing once and replaying each root", async () => {
    await seed("cycle");
    const before = await fixture.persistence.drizzle.select().from(fxSystemCommits);
    const key = create.newRequestKey(), input = { reservations: [data("cycle", 2.25)] };
    const created = await Effect.runPromise(create.run(key, input));
    expect(created[0]).toMatchObject({ quantity: 2.25, raw_quantity: { value: (2.25).toPrecision(20), precision: 20 } });
    const stableRows = await rows(), stableEvents = await events();
    expect(await Effect.runPromise(create.run(key, input))).toEqual(created);
    expect(await rows()).toEqual(stableRows); expect(await events()).toEqual(stableEvents);
    const id = created[0]!.id;
    expect((await run(update, { updates: [{ id, quantity: 3.5 }] }))[0]).toMatchObject({ quantity: 3.5 });
    expect((await run(update, { updates: [{ id, quantity: 0 }] }))[0]).toMatchObject({ quantity: 0 });
    const releaseKey = release.newRequestKey();
    expect(await Effect.runPromise(release.run(releaseKey, { ids: [id] }))).toBeNull();
    expect(await Effect.runPromise(release.run(releaseKey, { ids: [id] }))).toBeNull();
    expect(await probe("cycle", [id])).toMatchObject({ levels: [{ reserved_quantity: (0).toPrecision(20), raw_reserved_quantity: { value: (0).toPrecision(20) } }],
      reservations: [{ id, quantity: (0).toPrecision(20), deleted_at: expect.any(String) }] });
    expect(await fixture.persistence.drizzle.select().from(fxSystemCommits)).toHaveLength(before.length + 5);
  });

  it("retains sequential repeated-pair deltas, negative stock and native availability failure", async () => {
    await seed("adjust");
    const result = await run(adjust, [1.25, -2, 0.75, 0].map(adjustment => ({ inventory_item_id: "reserved-item", location_id: "adjust", adjustment })));
    expect(result.map(row => row.stocked_quantity)).toEqual([6.25, 4.25, 5, 5]);
    expect((await run(adjust, [{ inventory_item_id: "reserved-item", location_id: "adjust", adjustment: -6 }]))[0]).toMatchObject({ stocked_quantity: -1, available_quantity: -1 });
    const before = await rows();
    await expect(run(create, { reservations: [data("adjust")] }).catch(error => { throw nativeFailure(error); }))
      .rejects.toMatchObject({ type: "not_allowed", message: "Not enough stock available for item reserved-item at location adjust" });
    expect(await rows()).toEqual(before);
  });

  it("retains exact arithmetic across repeated updates beyond numeric DTO precision", async () => {
    await seed("exact-arithmetic", 9007199254740992);
    const result = await run(adjust, [1, 1].map(adjustment => ({ inventory_item_id: "reserved-item", location_id: "exact-arithmetic", adjustment })));
    expect(result[0]?.raw_stocked_quantity).toMatchObject({ value: "9007199254740993.0000", precision: 20 });
    expect(result[1]?.raw_stocked_quantity).toMatchObject({ value: "9007199254740994.0000", precision: 20 });
  });

  it("retains zero and backorder creation and real empty native calls", async () => {
    await seed("zero", 0);
    expect((await run(create, { reservations: [data("zero", 0)] }))[0]).toMatchObject({ quantity: 0 });
    expect((await run(create, { reservations: [{ ...data("zero", 2), allow_backorder: true }] }))[0]).toMatchObject({ quantity: 2, allow_backorder: true });
    const native = vi.spyOn(InventoryModuleService.prototype, "createReservationItems");
    try {
      expect(await run(create, { reservations: [] })).toEqual([]);
      expect(native.mock.calls.some(([input]) => Array.isArray(input) && input.length === 0)).toBe(true);
      expect(await run(adjust, [])).toEqual([]);
      expect(await run(update, { updates: [] })).toEqual([]);
      expect(await run(release, { ids: [] })).toBeNull();
    } finally { native.mockRestore(); }
  });

  it("preserves missing endpoints and refuses batches, relocation and caller-owned raw quantities", async () => {
    const beforeRows = await rows(), beforeEvents = await events();
    for (const input of [{ reservations: [data("missing")] }, { reservations: [data("missing"), data("missing")] },
      { reservations: [{ ...data("missing"), raw_quantity: { value: "1", precision: 20 } }] }]) await expect(run(create, input)).rejects.toBeDefined();
    await expect(run(update, { updates: [{ id: "missing-reservation", quantity: 1 }] }).catch(error => { throw nativeFailure(error); }))
      .rejects.toMatchObject({ type: "invalid_data", message: "Reservation item with id missing-reservation not found" });
    await expect(run(adjust, [{ inventory_item_id: "reserved-item", location_id: "missing", adjustment: 1 }]).catch(error => { throw nativeFailure(error); }))
      .rejects.toMatchObject({ type: "not_found" });
    const relocation = { updates: [{ id: "missing-reservation", quantity: 1, location_id: "elsewhere" }] };
    await expect(run(update, relocation)).rejects.toBeDefined();
    expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
  });

  it("rolls back reservation and level writes plus events after a late native failure", async () => {
    await seed("late");
    const beforeRows = await rows(), beforeEvents = await events();
    const original = InventoryModuleService.prototype.createReservationItems;
    const native = vi.spyOn(InventoryModuleService.prototype, "createReservationItems").mockImplementation(async function (this: InventoryModuleService, input, context) {
      await Reflect.apply(original, this, [input, context]);
      throw new Error("late reservation failure");
    });
    try { await expect(run(create, { reservations: [data("late")] }).catch(error => { throw nativeFailure(error); })).rejects.toThrow("late reservation failure"); }
    finally { native.mockRestore(); }
    expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
  });

  it("authenticates the selected exclusion before native work even when a host drops the profile", async () => {
    const host = await Effect.runPromise(prepareCreateReservationWorkflow({
      execution: { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy, prepare: composition => {
        const { executionIsolation: _selected, ...ordinary } = composition;
        return makeAtomicCommerceHost({ ...fixture.hostInput, ...ordinary });
      } }, inventory: { module: members.inventory.runtime.workflow, logicalStorage: members.inventory.hostInput.logicalStorage }, revision, subscribers,
    }));
    const native = vi.spyOn(InventoryModuleService.prototype, "createReservationItems");
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      await expect(run(host, { reservations: [data("missing")] }).catch(error => { throw nativeFailure(error); }))
        .rejects.toMatchObject({ reason: "unsupportedProfile" });
      expect(native).not.toHaveBeenCalled(); expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { native.mockRestore(); await Effect.runPromise(host.close); }
  });

  it("drains cancellation after pending native writes without publishing, then ignores late completion", async () => {
    await seed("cancel-reservation");
    const reached = await Effect.runPromise(Deferred.make<void>());
    let finish: (() => void) | undefined;
    const original = InventoryModuleService.prototype.createReservationItems;
    const native = vi.spyOn(InventoryModuleService.prototype, "createReservationItems").mockImplementation(async function (this: InventoryModuleService, input, context) {
      const result = await Reflect.apply(original, this, [input, context]);
      await Effect.runPromise(Deferred.succeed(reached, undefined));
      await new Promise<void>(resolve => { finish = resolve; });
      return result;
    });
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(create.run(create.newRequestKey(), { reservations: [data("cancel-reservation")] }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* Fiber.interrupt(fiber);
      }));
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      finish?.();
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { finish?.(); native.mockRestore(); }
  }, 120_000);

  it("recovers uncertain acknowledgement without repeating native reservation creation", async () => {
    await seed("uncertain-reservation");
    let lose = true;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost reservation COMMIT acknowledgement") })); }),
    ));
    const host = await Effect.runPromise(prepareCreateReservationWorkflow({ execution: {
      identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy, prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }),
    }, inventory: { module: members.inventory.runtime.workflow, logicalStorage: members.inventory.hostInput.logicalStorage }, revision, subscribers }));
    const native = vi.spyOn(InventoryModuleService.prototype, "createReservationItems");
    try {
      const key = host.newRequestKey(), input = { reservations: [data("uncertain-reservation")] };
      const result = await Effect.runPromise(host.run(key, input));
      expect(native).toHaveBeenCalledTimes(1); expect(lose).toBe(false);
      const stableRows = await rows(), stableEvents = await events();
      expect(await Effect.runPromise(host.run(key, input))).toEqual(result);
      expect(native).toHaveBeenCalledTimes(1); expect(await rows()).toEqual(stableRows); expect(await events()).toEqual(stableEvents);
    } finally { native.mockRestore(); await Effect.runPromise(host.close); }
  });

  it.skipIf(driver !== "postgres")("serializes distinct reservation keys and returns native stock rejection rather than a stale-write conflict", async () => {
    await seed("competing");
    const results = await Promise.allSettled([run(create, { reservations: [data("competing", 4)] }), run(create, { reservations: [data("competing", 4)] })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected");
    expect(rejected?.status === "rejected" ? nativeFailure(rejected.reason) : undefined).toMatchObject({ type: "not_allowed" });
    const ids = results.flatMap(result => result.status === "fulfilled" ? result.value.map(row => row.id) : []);
    expect(await probe("competing", ids)).toMatchObject({ levels: [{ reserved_quantity: (4).toPrecision(20) }], reservations: [expect.objectContaining({ quantity: (4).toPrecision(20) })] });
  });

  it.skipIf(driver !== "postgres")("confines exclusion and matching native identities to each shop", async () => {
    const other = await logicalCurrencyFixture("postgres", close => cleanup.push(close), {
      includeProduct: true, includePricing: true, includeVariantInventory: true, resource: fixture.resource,
      fixtureIdentity: { deploymentId: "reservation_shop_b", projectId: "reservation_shop_b", uuidOffset: 21_000 },
    });
    const otherMembers = await prepareLogicalInventoryHosts(other, { stock: true, stockLocations: true });
    const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: other.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...other.hostInput, ...composition }) };
    const options = { execution, inventory: { module: otherMembers.inventory.runtime.workflow, logicalStorage: otherMembers.inventory.hostInput.logicalStorage }, revision, subscribers };
    const otherCreate = await Effect.runPromise(prepareCreateReservationWorkflow(options));
    const otherStock = await Effect.runPromise(prepareInventoryStockingWorkflow({ execution, revision, subscribers, modules: {
      inventory: options.inventory, stock_location: { module: otherMembers.stockLocation.runtime.workflow, logicalStorage: otherMembers.stockLocation.hostInput.logicalStorage },
    } }));
    const itemHost = await prepareInventoryCreateHost(other, otherMembers.inventory);
    try { await Effect.runPromise(itemHost.host.run(itemHost.host.newRequestKey(), itemHost.create, [{ id: "reserved-item", sku: "other-reservation-sku" }])); }
    finally { await Effect.runPromise(itemHost.host.close); }
    await seed("same-native-identity");
    const otherLevel = await run(otherStock, { locations: [{ id: "same-native-identity", name: "Other shop" }], inventory_levels: [
      { inventory_item_id: "reserved-item", location_index: 0, stocked_quantity: 7 },
    ] });
    const reached = await Effect.runPromise(Deferred.make<void>());
    let finish: (() => void) | undefined;
    const original = InventoryModuleService.prototype.createReservationItems;
    const native = vi.spyOn(InventoryModuleService.prototype, "createReservationItems").mockImplementation(async function (this: InventoryModuleService, input, context) {
      const result = await Reflect.apply(original, this, [input, context]);
      if (Array.isArray(input) && input[0]?.quantity === 1) {
        await Effect.runPromise(Deferred.succeed(reached, undefined));
        await new Promise<void>(resolve => { finish = resolve; });
      }
      return result;
    });
    try {
      const key = create.newRequestKey();
      const left = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(create.run(key, { reservations: [data("same-native-identity", 1)] }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        // The first shop holds exclusion while a distinct shop completes.
        const right = yield* otherCreate.run(key, { reservations: [data("same-native-identity", 3)] });
        expect(right[0]).toMatchObject({ inventory_item_id: "reserved-item", quantity: 3 });
        finish?.();
        return { left: yield* Fiber.join(first), right };
      })));
      expect(await probe("same-native-identity", left.left.map(row => row.id))).toMatchObject({ levels: [{ reserved_quantity: (1).toPrecision(20) }] });
      expect(await probe("same-native-identity", left.right.map(row => row.id), {
        fixture: other, members: otherMembers, levelId: otherLevel.inventory_levels[0]!.id,
      })).toMatchObject({ levels: [{ reserved_quantity: (3).toPrecision(20) }] });
    } finally { finish?.(); native.mockRestore(); await Effect.runPromise(otherCreate.close); await Effect.runPromise(otherStock.close); }
  }, 180_000);
});
