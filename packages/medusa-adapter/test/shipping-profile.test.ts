import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Schema } from "effect";
import { FulfillmentModuleService, FulfillmentProviderService } from "@medusajs/fulfillment/services";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { CreateShippingProfileDTO, IEventBusModuleService } from "@medusajs/framework/types";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "../src/value/input";
import { captureShippingProfileMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { registerNativeShippingProfileTests, type NativeShippingProfileRow } from "./support/shipping-profile-native-tests";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalShippingProfileHost } from "./support/logical-shipping-profile-fixture";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { fxAppRowCurrent } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid ShippingProfile test driver");
const cleanup: Array<() => Promise<void>> = [];
const participant = defineAtomicCommerceParticipant("fulfillment");
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let shipping: Awaited<ReturnType<typeof prepareLogicalShippingProfileHost>>;
let host: Effect.Success<ReturnType<typeof makeAtomicCommerceHost>>;
let reader: Effect.Success<ReturnType<typeof makeCommerceHost>>;
const create = defineAtomicCommerceCommand("nativeShippingProfileCreate", (ctx, input) =>
  ctx.call(participant, shipping.runtime.create, input));
const eventName = buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: "shipping_profile", action: "created" });
const rows = () => fixture.persistence.drizzle.select().from(fxAppRowCurrent);
const events = () => fixture.persistence.drizzle.select().from(fxSystemCommitEvents);

beforeAll(async () => {
  fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeShippingProfile: true });
  shipping = await prepareLogicalShippingProfileHost(fixture);
  await Effect.runPromise(shipping.host.initialize([]));
  await Effect.runPromise(shipping.host.close);
  const policy = shipping.runtime.logicalEventPolicy();
  const contract = defineCommerceEventContract({ name: eventName, revision: "1".repeat(64), internal: true, decode: policy.capture });
  host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
    identityAndAccessPolicy: { profile: "logical-shipping-profile-native" },
    participants: [{ participant, logicalStorage: shipping.hostInput.logicalStorage,
      commands: shipping.runtime.commands, validateLogicalCall: policy.validateLogicalCall,
      events: { contracts: [contract], select: (message: Json) =>
        isJsonObject(message) && message.name === eventName ? Effect.succeed(contract) : Effect.fail(commerceError("unadmittedEvent")) } }],
    commands: [create],
    events: { producerRevision: "1".repeat(64), contracts: [contract],
      subscribers: [{ id: "logical-shipping-profile", revision: "2".repeat(64) }],
      validate: emitted => emitted.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  cleanup.push(() => Effect.runPromise(host.close));
  reader = await Effect.runPromise(makeCommerceHost(shipping.hostInput));
  cleanup.push(() => Effect.runPromise(reader.close));
}, 150_000);
afterAll(async () => {
  const failures: unknown[] = [];
  for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
  if (failures.length) throw new AggregateError(failures, "ShippingProfile logical fixture cleanup failed");
}, 150_000);

describe("native ShippingProfile on shared logical storage", () => {
  it("compiles its active-name constraint without a generated module table", async () => {
    expect(shipping.definition.schema.tables.map(table => table.identity.tableId)).toEqual(["shipping_profile"]);
    const table = shipping.definition.schema.tables[0];
    expect(table?.indexes.filter(index => index.kind === "uniqueBtree").map(index => ({
      columns: index.columns.map(column => column.columnId), predicate: index.predicate?.kind,
    }))).toEqual([{ columns: ["name"], predicate: "isNull" }]);
    const metadata = await Effect.runPromise(captureShippingProfileMetadata());
    expect(metadata.frame.tables[0]?.relationships[0]).toMatchObject({ name: "shipping_options", targetTable: "shipping_option" });
    expect((await fixture.persistence.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
      .toEqual(fixture.physicalTablesBeforeCandidate);
  });

  it("creates native scalar and batch rows with exact events, bounded reads and replay", async () => {
    const beforeEvents = await events();
    const key = host.newRequestKey();
    const created = await Effect.runPromise(host.run(key, create,
      { id: "sp_logical", name: "Logical", type: "default", metadata: { tags: ["fragile"] } }));
    expect(created).toEqual({ id: "sp_logical", name: "Logical", type: "default", metadata: { tags: ["fragile"] },
      created_at: expect.any(String), updated_at: expect.any(String), deleted_at: null, shipping_options: [] });
    expect(await Effect.runPromise(host.run(key, create,
      { id: "sp_logical", name: "Logical", type: "default", metadata: { tags: ["fragile"] } }))).toEqual(created);
    const many = await Effect.runPromise(host.run(host.newRequestKey(), create,
      [{ id: "sp_batch_a", name: "Batch A", type: "default" }, { id: "sp_batch_b", name: "Batch B", type: "custom" }]));
    expect(many).toHaveLength(2);
    expect(many).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "sp_batch_a", shipping_options: [] }),
      expect.objectContaining({ id: "sp_batch_b", shipping_options: [] }),
    ]));
    expect(await Effect.runPromise(host.run(host.newRequestKey(), create, []))).toEqual([]);
    expect((await events()).slice(beforeEvents.length).map(event => event.envelope.contract)).toEqual([eventName, eventName, eventName]);
    const retrieved = await Effect.runPromise(reader.read(shipping.runtime.retrieve, { id: "sp_logical" }));
    expect(retrieved).toMatchObject({ name: "Logical" });
    expect(retrieved).not.toHaveProperty("shipping_options");
    expect(await Effect.runPromise(reader.read(shipping.runtime.count,
      { filters: { type: "custom" }, config: { select: ["id", "name"], take: 1 } })))
      .toEqual([[{ id: "sp_batch_b", name: "Batch B" }], 1]);
    expect(await Effect.runPromise(reader.read(shipping.runtime.count,
      { filters: { name: "Logical" }, config: { select: ["id"], take: 1 } })))
      .toEqual([[{ id: "sp_logical" }], 1]);
  }, 120_000);

  it("refuses invalid fields, hydration and duplicate active names without publication", async () => {
    const beforeRows = await rows(), beforeEvents = await events();
    for (const input of [{ name: "missing-type" }, { type: "missing-name" }])
      await expect(Effect.runPromise(host.run(host.newRequestKey(), create, input)))
        .rejects.toMatchObject({ reason: "invalidInput" });
    for (const input of [
      { id: "sp_bad", name: "Bad", type: "default", created_at: "2026-01-01T00:00:00Z" },
      { name: "Bad", type: "default", shipping_options: [] },
    ])
      await expect(Effect.runPromise(host.run(host.newRequestKey(), create, input)))
        .rejects.toMatchObject({ _tag: "CommerceTransactionError", reason: "unsupportedProfile" });
    await expect(Effect.runPromise(reader.read(shipping.runtime.list,
      { config: { relations: ["shipping_options"] } }))).rejects.toMatchObject({ reason: "invalidInput" });
    await expect(Effect.runPromise(host.run(host.newRequestKey(), create,
      [{ name: "duplicate-logical", type: "default" }, { name: "duplicate-logical", type: "custom" }])))
      .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    expect(await rows()).toEqual(beforeRows);
    expect(await events()).toEqual(beforeEvents);
  }, 120_000);

  it("keeps caught native deletion refusal fatal and never enters provider services", async () => {
    const provider = vi.spyOn(FulfillmentProviderService.prototype, "getFulfillmentOptions");
    const price = vi.spyOn(FulfillmentProviderService.prototype, "calculatePrice");
    const original = FulfillmentModuleService.prototype.createShippingProfiles_;
    const createSpy = vi.spyOn(FulfillmentModuleService.prototype, "createShippingProfiles_").mockImplementation(async function (this: FulfillmentModuleService, data, context) {
      const result = await original.call(this, data, context);
      const id = result[0]?.id;
      if (id === undefined) throw new Error("Missing native ShippingProfile");
      try { await this.deleteShippingProfiles(id, context); } catch { /* Sticky core refusal. */ }
      return result;
    });
    const beforeRows = await rows();
    try {
      await expect(Effect.runPromise(host.run(host.newRequestKey(), create,
        { name: "Caught delete logical", type: "default" }))).rejects.toMatchObject({ reason: "rollbackOnly" });
      expect(await rows()).toEqual(beforeRows);
      expect(provider).not.toHaveBeenCalled(); expect(price).not.toHaveBeenCalled();
    } finally { createSpy.mockRestore(); provider.mockRestore(); price.mockRestore(); }
  }, 120_000);
});

describe("selected pinned ShippingProfile creation and event assertions", () => {
  const eventBusEmitSpy = vi.fn<IEventBusModuleService["emit"]>();
  beforeEach(() => {
    const original = FulfillmentModuleService.prototype.createShippingProfiles_;
    vi.spyOn(FulfillmentModuleService.prototype, "createShippingProfiles_").mockImplementation(function (this: FulfillmentModuleService, data, context) {
      // SAFETY: pinned service owns this field; its declaration omits inherited fields.
      const bus = (this as FulfillmentModuleService & { eventBusModuleService_: IEventBusModuleService }).eventBusModuleService_;
      const emit = bus.emit.bind(bus);
      vi.spyOn(bus, "emit").mockImplementation((...args) => { eventBusEmitSpy(...args); return emit(...args); });
      return original.call(this, data, context);
    });
  });
  afterEach(() => { vi.restoreAllMocks(); eventBusEmitSpy.mockClear(); });
  const row = Schema.StructWithRest(Schema.Struct({ id: Schema.String, name: Schema.String, type: Schema.String }),
    [Schema.Record(Schema.String, Schema.Json)]);
  function createShippingProfiles(data: CreateShippingProfileDTO): Promise<NativeShippingProfileRow>;
  function createShippingProfiles(data: CreateShippingProfileDTO[]): Promise<readonly NativeShippingProfileRow[]>;
  async function createShippingProfiles(data: CreateShippingProfileDTO | CreateShippingProfileDTO[]): Promise<NativeShippingProfileRow | readonly NativeShippingProfileRow[]> {
    const input = await Effect.runPromise(Effect.fromResult(captureCommerceInput(data)));
    const result = await Effect.runPromise(host.run(host.newRequestKey(), create, input));
    return Array.isArray(data) ? Schema.decodeUnknownSync(Schema.Array(row))(result) : Schema.decodeUnknownSync(row)(result);
  }
  registerNativeShippingProfileTests({ createShippingProfiles }, eventBusEmitSpy);
});
