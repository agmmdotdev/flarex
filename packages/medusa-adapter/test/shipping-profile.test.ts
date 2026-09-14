import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Schema } from "effect";
import { FulfillmentModuleService, FulfillmentProviderService } from "@medusajs/fulfillment/services";
import type { CreateShippingProfileDTO, IEventBusModuleService } from "@medusajs/framework/types";
import { captureCommerceInput } from "../src/commerce-input";
import { registerNativeShippingProfileTests, type NativeShippingProfileRow } from "./support/shipping-profile-native-tests";
import { makeLocalShippingProfileCommands } from "../src/shipping-profile-service";
import { prepareLocalShippingProfile } from "../src/product-shipping-profile-schema";
import { captureShippingProfileMetadata } from "../src/shipping-profile-schema";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../persistence-postgres/test/commerceHostFixture";
import { commerceInventory } from "../../persistence-postgres/test/commerceInventory";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../persistence-postgres/test/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid ShippingProfile test driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: CommerceHostTestFixture;
let commands: Effect.Success<ReturnType<typeof makeLocalShippingProfileCommands>>;
const delivered: unknown[] = [];
beforeAll(async () => {
  const registerCleanup = (close: () => Promise<void>) => { cleanup.push(close); };
  const resource = driver === "pglite" ? await createRelationalPGliteFixture({ registerCleanup }) : await (async () => {
    const database = await createFileScopedPostgresFixture(); registerCleanup(database.dispose);
    return { persistence: database.persistence, session: makePostgresRelationalSession(database.persistence) };
  })();
  const control = driver === "pglite" ? await createMigratedPGlitePersistence(registerCleanup) : resource.persistence;
  commands = await runEffect(makeLocalShippingProfileCommands());
  fixture = await commerceHostFixture(resource.persistence, resource.session, prepareLocalShippingProfile,
    commands.commands, control, descriptor => commands.eventPolicy(descriptor, events => Effect.sync(() => { delivered.push(...events); })));
});
afterAll(async () => {
  const failures: unknown[] = [];
  for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
  if (failures.length) throw new AggregateError(failures, "ShippingProfile fixture cleanup failed");
});
describe("native Fulfillment ShippingProfile", () => {
  it("keeps native provider execution absent and validates metadata and managed fields", async () => {
    const provider = vi.spyOn(FulfillmentProviderService.prototype, "getFulfillmentOptions");
    const price = vi.spyOn(FulfillmentProviderService.prototype, "calculatePrice");
    try {
      const result = await runEffect(fixture.host.run(fixture.host.newRequestKey(), commands.create,
        { id: "sp_metadata", name: "Metadata profile", type: "metadata", metadata: { tags: ["fragile"], enabled: true } }));
      expect(result).toMatchObject({ id: "sp_metadata", metadata: { tags: ["fragile"], enabled: true } });
      expect(provider).not.toHaveBeenCalled(); expect(price).not.toHaveBeenCalled();
      const before = await commerceInventory(fixture);
      for (const invalid of [{ id: 42 }, { id: "" }, { created_at: "2026-01-01T00:00:00Z" }, { deleted_at: null }, { shipping_options: [] }]) {
        expect(await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), commands.create,
          { name: "Invalid profile", type: "default", ...invalid }))).toMatchObject({ _tag: "CommerceTransactionError" });
        expect(await commerceInventory(fixture)).toEqual(before);
      }
    } finally { provider.mockRestore(); price.mockRestore(); }
  });
  it("keeps a caught native deletion validation fatal before unselected ShippingOption access", async () => {
    const original = FulfillmentModuleService.prototype.createShippingProfiles_;
    let reached = false;
    const create = vi.spyOn(FulfillmentModuleService.prototype, "createShippingProfiles_").mockImplementation(async function (this: FulfillmentModuleService, data, context) {
      const rows = await original.call(this, data, context);
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("Missing native ShippingProfile");
      reached = true;
      try { await this.deleteShippingProfiles(id, context); } catch { /* Native relation validation reaches the denied repository; refusal stays fatal. */ }
      return rows;
    });
    const before = await commerceInventory(fixture);
    try {
      expect(await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), commands.create,
        { name: "Caught delete", type: "default" }))).toMatchObject({ reason: "rollbackOnly" });
      expect(reached).toBe(true); expect(await commerceInventory(fixture)).toEqual(before);
    } finally { create.mockRestore(); }
  });
  it("installs exactly the selected 17 tables and retains inverse metadata without hydration", async () => {
    expect(fixture.descriptor.layout.frame.tables.map(table => table.identity.tableId).sort()).toEqual([
      "image", "product", "product_category", "product_category_product", "product_collection",
      "product_option", "product_option_value", "product_sales_channel", "product_shipping_profile", "product_tag",
      "product_tags", "product_type", "product_variant", "product_variant_option", "product_variant_product_image",
      "sales_channel", "shipping_profile",
    ]);
    const metadata = await runEffect(captureShippingProfileMetadata());
    expect(metadata.frame.tables[0]?.relationships[0]).toMatchObject({ name: "shipping_options", targetTable: "shipping_option" });
  });
  it("constructs real native services and creates scalar, array and empty inputs", async () => {
    const before = delivered.length;
    const scalar = await runEffect(fixture.host.run(fixture.host.newRequestKey(), commands.create, { name: "default", type: "default" }));
    expect(scalar).toMatchObject({ id: expect.stringMatching(/^sp_/), name: "default", type: "default", deleted_at: null });
    expect(delivered.slice(before)).toEqual([expect.objectContaining({
      name: "fulfillment.shipping-profile.created", metadata: { source: "fulfillment", object: "shipping_profile", action: "created" },
    })]);
    const rows = await runEffect(fixture.host.run(fixture.host.newRequestKey(), commands.create,
      [{ id: "sp_custom", name: "custom", type: "custom" }, { name: "third", type: "default" }]));
    expect(rows).toHaveLength(2);
    const emptyBefore = delivered.length;
    expect(await runEffect(fixture.host.run(fixture.host.newRequestKey(), commands.create, []))).toEqual([]);
    expect(delivered).toHaveLength(emptyBefore);
    expect(await runEffect(fixture.host.read(commands.retrieve, { id: "sp_custom" }))).toMatchObject({ name: "custom" });
    expect(await runEffect(fixture.host.read(commands.count, { filters: { type: "custom" } })))
      .toEqual([[expect.objectContaining({ id: "sp_custom" })], 1]);
  });
  it("requires name and type, refuses hydration, and rolls back duplicate active names", async () => {
    const before = await commerceInventory(fixture);
    for (const data of [{ name: "missing-type" }, { type: "missing-name" }]) {
      expect(await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), commands.create, data))).toMatchObject({ reason: "invalidInput" });
    }
    expect(await runEffectFailure(fixture.host.read(commands.list,
      { config: { relations: ["shipping_options"] } }))).toMatchObject({ reason: "invalidInput" });
    expect(await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), commands.create,
      [{ name: "duplicate", type: "default" }, { name: "duplicate", type: "custom" }]))).toMatchObject({ _tag: "CommerceTransactionError" });
    expect(await commerceInventory(fixture)).toEqual(before);
  });
});

describe("selected pinned ShippingProfile creation and event assertions", () => {
  const eventBusEmitSpy = vi.fn<IEventBusModuleService["emit"]>();
  beforeEach(() => {
    const original = FulfillmentModuleService.prototype.createShippingProfiles_;
    vi.spyOn(FulfillmentModuleService.prototype, "createShippingProfiles_").mockImplementation(function (this: FulfillmentModuleService, data, context) {
      // SAFETY: the pinned MedusaService constructor owns this public field;
      // its generated declaration exposes methods but omits inherited fields.
      const bus = (this as FulfillmentModuleService & { eventBusModuleService_: IEventBusModuleService }).eventBusModuleService_;
      const emit = bus.emit.bind(bus);
      vi.spyOn(bus, "emit").mockImplementation((...args) => {
        eventBusEmitSpy(...args);
        return emit(...args);
      });
      return original.call(this, data, context);
    });
  });
  afterEach(() => { vi.restoreAllMocks(); eventBusEmitSpy.mockClear(); });
  const row = Schema.StructWithRest(Schema.Struct({ id: Schema.String, name: Schema.String, type: Schema.String }),
    [Schema.Record(Schema.String, Schema.Json)]);
  function createShippingProfiles(data: CreateShippingProfileDTO): Promise<NativeShippingProfileRow>;
  function createShippingProfiles(data: CreateShippingProfileDTO[]): Promise<readonly NativeShippingProfileRow[]>;
  async function createShippingProfiles(data: CreateShippingProfileDTO | CreateShippingProfileDTO[]): Promise<NativeShippingProfileRow | readonly NativeShippingProfileRow[]> {
    const input = await runEffect(Effect.fromResult(captureCommerceInput(data)));
    const result = await runEffect(fixture.host.run(fixture.host.newRequestKey(), commands.create, input));
    return Array.isArray(data) ? Schema.decodeUnknownSync(Schema.Array(row))(result) : Schema.decodeUnknownSync(row)(result);
  }
  registerNativeShippingProfileTests({ createShippingProfiles }, eventBusEmitSpy);
});
