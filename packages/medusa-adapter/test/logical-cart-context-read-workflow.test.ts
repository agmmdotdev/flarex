import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { StoreModuleService } from "@medusajs/store/services";
import { RegionModuleService } from "@medusajs/region/services";
import { SalesChannelModuleService } from "@medusajs/sales-channel/services";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant,
  type LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeDocumentValue } from "flarex-protocol/document-value";
import { CartContextReadOutput, prepareCartContextReadWorkflow } from "../src/workflows/cart/context-read";
import { prepareCoreCartContextReads, cartContextCountries, cartContextRows } from "./support/core-cart-context-read-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreCartContextReads>>;
type Host = Effect.Success<ReturnType<typeof prepareCartContextReadWorkflow>>;
type Input = Parameters<Host["run"]>[1];
type Inventory = Awaited<ReturnType<typeof connected.snapshot>>;
const run = (host: Host, input: Input) => Effect.runPromise(host.run(host.newRequestKey(), input));
const businessState = ({ outcomes: _outcomes, ...state }: Inventory) => state;
const decodeOutput = Schema.decodeUnknownSync(CartContextReadOutput);
const explicit = { sales_channel_id: cartContextRows.channel.id, region_id: cartContextRows.region.id };
async function refused(host: Host, input: Input, message: string) {
  const outcome = await Effect.runPromiseExit(host.run(host.newRequestKey(), input));
  expect(Exit.isFailure(outcome)).toBe(true);
  if (Exit.isFailure(outcome)) expect(Cause.pretty(outcome.cause)).toContain(message);
}

beforeAll(async () => { connected = await prepareCoreCartContextReads(driver, close => cleanup.push(close)); }, 180_000);
afterEach(() => vi.restoreAllMocks());
afterAll(() => finishOrderFixture(cleanup.splice(0).reverse()), 180_000);

describe("connected native Cart context read branch", { concurrent: false }, () => {
  it("refuses broader profiles and resource overrides before preparing an execution host", async () => {
    const prepare = vi.fn(connected.options.execution.prepare);
    const options = { ...connected.options, execution: { ...connected.options.execution, prepare } };
    const candidates: Parameters<typeof prepareCartContextReadWorkflow>[0][] = [
      { ...options, ...{ requestCallLimit: 4096 } },
      { ...options, modules: { ...options.modules, store: options.modules.region } },
      { ...options, modules: { ...options.modules, region: options.modules.store } },
      { ...options, modules: { ...options.modules, sales_channel: { ...options.modules.sales_channel, module: connected.sales.workflow } } },
      { ...options, modules: { ...options.modules, store: { ...options.modules.store, logicalResources: defaultCommerceResources } } },
      { ...options, modules: { ...options.modules, region: { ...options.modules.region, logicalPublication: "mixed" } } },
    ];
    for (const candidate of candidates) {
      const outcome = await Effect.runPromiseExit(prepareCartContextReadWorkflow(candidate));
      expect(Exit.isFailure(outcome)).toBe(true);
    }
    const getter = vi.fn(() => options.modules.store);
    const registrations = Object.defineProperty({ ...options.modules }, "store", { get: getter, enumerable: true });
    expect(Exit.isFailure(await Effect.runPromiseExit(prepareCartContextReadWorkflow({ ...options, modules: registrations })))).toBe(true);
    expect(getter).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("selects the first active Store by native ID order and returns complete scalar and Country values", async () => {
    const stores = vi.spyOn(StoreModuleService.prototype, "listStores");
    const channels = vi.spyOn(SalesChannelModuleService.prototype, "retrieveSalesChannel");
    const regions = vi.spyOn(RegionModuleService.prototype, "listAndCountRegions");
    const before = await connected.snapshot(), host = await connected.prepare();
    const key = host.newRequestKey();
    const result = await Effect.runPromise(host.run(key, {}));
    expect(result).toEqual({ sales_channel: cartContextRows.channel,
      region: { ...cartContextRows.region, countries: [cartContextCountries.gb, cartContextCountries.us] } });
    expect(stores).toHaveBeenCalledTimes(1);
    // The actual native internal service adds its default ordering in place.
    expect(stores.mock.calls[0]?.slice(0, 2)).toEqual([{}, { select: ["id", "default_sales_channel_id"], order: { id: "ASC" } }]);
    expect(channels).toHaveBeenCalledTimes(1);
    expect(channels.mock.calls[0]?.[0]).toBe(cartContextRows.channel.id);
    expect(channels.mock.calls[0]?.[1]).toBeUndefined();
    expect(regions).toHaveBeenCalledTimes(1);
    const after = await connected.snapshot();
    expect(businessState(after)).toEqual(businessState(before));
    const outcome = after.outcomes.find(record => record.value.key === key);
    if (outcome === undefined) throw new Error("Missing committed Cart context outcome");
    expect(outcome.value).toMatchObject({ kind: "nativeRoot", state: "committed" });
    const stored = outcome.value.result;
    if (typeof stored !== "string") throw new Error("Missing encoded Cart context result");
    const decoded = Result.getOrThrow(decodeDocumentValue(new TextEncoder().encode(stored)));
    expect(decodeOutput(decoded)).toEqual(result);
    expect(after.outcomes.filter(record => record !== outcome)).toEqual(before.outcomes);
    expect(await Effect.runPromise(host.run(key, {}))).toEqual(result);
    expect(await connected.snapshot()).toEqual(after);
    expect(stores).toHaveBeenCalledTimes(1);
    expect(channels).toHaveBeenCalledTimes(1);
    expect(regions).toHaveBeenCalledTimes(1);
  }, 180_000);

  it("uses explicit IDs without Store fallback and preserves empty and one-Country relations", async () => {
    const stores = vi.spyOn(StoreModuleService.prototype, "listStores");
    const counts = vi.spyOn(StoreModuleService.prototype, "listAndCountStores");
    const host = await connected.prepare(), before = await connected.snapshot();
    expect(await run(host, { ...explicit, region_id: cartContextRows.emptyRegion.id })).toEqual({
      sales_channel: cartContextRows.channel, region: { ...cartContextRows.emptyRegion, countries: [] } });
    expect(await run(host, { ...explicit, region_id: cartContextRows.singleRegion.id })).toEqual({
      sales_channel: cartContextRows.channel, region: { ...cartContextRows.singleRegion, countries: [cartContextCountries.mm] } });
    expect(stores).not.toHaveBeenCalled();
    expect(counts).not.toHaveBeenCalled();
    expect(businessState(await connected.snapshot())).toEqual(businessState(before));
  }, 180_000);

  it("counts the complete native Region cohort and populates Countries for the selected window", async () => {
    const local: Array<() => Promise<void>> = [];
    try {
      const { fixture, region } = connected;
      const participant = defineAtomicCommerceParticipant("cartContextRegion");
      const read = defineAtomicCommerceCommand("cartContextCountRegion", (ctx, input) => ctx.call(participant, region.count, input));
      const policy = region.logicalEventPolicy();
      const observed: Array<{ call: Parameters<LogicalCommerceCallValidation>[0]; activity: Parameters<LogicalCommerceCallValidation>[1] }> = [];
      const validateLogicalCall: LogicalCommerceCallValidation = (call, activity) => policy.validateLogicalCall(call, activity).pipe(
        Effect.tap(() => Effect.sync(() => { observed.push({ call, activity }); })));
      const host = await Effect.runPromise(fixture.execution.prepare({
        identityAndAccessPolicy: fixture.execution.identityAndAccessPolicy, commands: [read],
        participants: [{ participant, nativeStorage: fixture.source("region"), commands: [region.count], validateLogicalCall }],
      }));
      local.push(() => Effect.runPromise(host.close));
      const before = await connected.snapshot();
      const rows = [{ ...cartContextRows.region, countries: [cartContextCountries.gb, cartContextCountries.us] }];
      const key = host.newRequestKey(), result = await Effect.runPromise(host.run(key, read, {
        filters: { id: [cartContextRows.singleRegion.id, cartContextRows.region.id] },
        config: { relations: ["countries"], take: 1, order: { id: "ASC" } },
      }));
      expect(result).toEqual([rows, 2]);
      expect(observed).toHaveLength(1);
      const trace = observed[0];
      if (trace === undefined) throw new Error("Missing counted Region activity");
      expect(trace.activity.relationalReads).toMatchObject([
        { table: "region", total: 2, returned: 2 },
        { table: "region_country", total: 2, returned: 2, query: {
          order: { column: "iso_2", direction: "asc" }, predicate: { kind: "and", children: [
            { kind: "in", column: "region_id", values: [cartContextRows.region.id] }, { kind: "isNull", column: "deleted_at" },
          ] },
        } },
      ]);
      // The parent FK interval may observe deleted rows before the active
      // predicate. All three observations belong to the selected Region.
      const countryObservations = trace.activity.observedRows.filter(row => row.table === "region_country");
      expect(countryObservations).toEqual(expect.arrayContaining(
        [cartContextCountries.deleted, cartContextCountries.gb, cartContextCountries.us].map(row => ({ table: "region_country", row }))));
      expect(countryObservations).toHaveLength(3);
      expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ ...trace.call, result: [rows, 1] }, trace.activity))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
      const truncated = { ...trace.activity, relationalReads: trace.activity.relationalReads.map((receipt, index) =>
        index === 0 ? { ...receipt, returned: 1 } : receipt) };
      expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(trace.call, truncated))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
      expect(businessState(await connected.snapshot())).toEqual(businessState(before));
    } finally { await finishOrderFixture(local.reverse()); }
  }, 180_000);

  it("preserves missing and deleted explicit Region absence without inventing a loaded row", async () => {
    const host = await connected.prepare();
    expect(await run(host, { ...explicit, region_id: "reg-cart-context-missing" })).toEqual({ sales_channel: cartContextRows.channel });
    expect(await run(host, { ...explicit, region_id: cartContextRows.deletedRegion.id })).toEqual({ sales_channel: cartContextRows.channel });
  }, 180_000);

  it("keeps null and empty Channel IDs distinct from omission and runs native required validation", async () => {
    const stores = vi.spyOn(StoreModuleService.prototype, "listStores");
    const channels = vi.spyOn(SalesChannelModuleService.prototype, "retrieveSalesChannel");
    const host = await connected.prepare(), before = await connected.snapshot();
    for (const sales_channel_id of [null, ""]) await refused(host, { ...explicit, sales_channel_id }, "Sales channel is required");
    expect(stores).not.toHaveBeenCalled();
    expect(channels).not.toHaveBeenCalled();
    expect(await connected.snapshot()).toEqual(before);
  }, 180_000);

  it("preserves native disabled and missing Channel failures without mutations or events", async () => {
    const host = await connected.prepare(), before = await connected.snapshot();
    await refused(host, { ...explicit, sales_channel_id: cartContextRows.disabledChannel.id }, "Unable to assign cart to disabled Sales Channel");
    await refused(host, { ...explicit, sales_channel_id: "sc-cart-context-missing" }, "sc-cart-context-missing");
    await refused(host, { ...explicit, sales_channel_id: cartContextRows.deletedChannel.id }, cartContextRows.deletedChannel.id);
    expect(await connected.snapshot()).toEqual(before);
  }, 180_000);

  it("performs the genuine null default Region query and returns native null", async () => {
    const local: Array<() => Promise<void>> = [];
    try {
      const fixture = await prepareCoreCartContextReads(driver, close => local.push(close), "null-region", connected.fixture.physical);
      const host = await fixture.prepare(), regions = vi.spyOn(RegionModuleService.prototype, "listAndCountRegions");
      const before = await fixture.snapshot();
      expect(await run(host, {})).toEqual({ sales_channel: cartContextRows.channel, region: null });
      expect(regions.mock.calls.some(args => args[0]?.id === null)).toBe(true);
      expect(businessState(await fixture.snapshot())).toEqual(businessState(before));
    } finally { await finishOrderFixture(local.reverse()); }
  }, 180_000);

  it("queries an empty default Region ID and preserves a missing default Channel failure", async () => {
    const local: Array<() => Promise<void>> = [];
    try {
      const emptyRegion = await prepareCoreCartContextReads(driver, close => local.push(close), "empty-region", connected.fixture.physical);
      const host = await emptyRegion.prepare(), regions = vi.spyOn(RegionModuleService.prototype, "listAndCountRegions");
      const before = await emptyRegion.snapshot();
      expect(await run(host, {})).toEqual({ sales_channel: cartContextRows.channel, region: null });
      expect(regions.mock.calls.some(args => args[0]?.id === "")).toBe(true);
      expect(businessState(await emptyRegion.snapshot())).toEqual(businessState(before));
      const nullChannel = await prepareCoreCartContextReads(driver, close => local.push(close), "null-channel", connected.fixture.physical);
      const nullHost = await nullChannel.prepare(), channelBefore = await nullChannel.snapshot();
      await refused(nullHost, {}, "Sales channel is required");
      expect(await nullChannel.snapshot()).toEqual(channelBefore);
    } finally { await finishOrderFixture(local.reverse()); }
  }, 180_000);

  it("keeps Store absence conditional on the actual native branches", async () => {
    const local: Array<() => Promise<void>> = [];
    try {
      const fixture = await prepareCoreCartContextReads(driver, close => local.push(close), "none", connected.fixture.physical);
      const host = await fixture.prepare();
      expect(await run(host, explicit)).toEqual({ sales_channel: cartContextRows.channel,
        region: { ...cartContextRows.region, countries: [cartContextCountries.gb, cartContextCountries.us] } });
      const before = await fixture.snapshot();
      await refused(host, {}, "Store not found");
      await refused(host, { region_id: cartContextRows.region.id }, "Sales channel is required");
      expect(await fixture.snapshot()).toEqual(before);
    } finally { await finishOrderFixture(local.reverse()); }
  }, 180_000);

  it("does not turn a caught native Region write refusal into a successful optional Region", async () => {
    const original = RegionModuleService.prototype.listAndCountRegions;
    let caught = false;
    vi.spyOn(RegionModuleService.prototype, "listAndCountRegions").mockImplementation(async function (this: RegionModuleService, ...args) {
      try { await this.createRegions([{ name: "Unadmitted", currency_code: "usd" }], args[2]); }
      catch { caught = true; }
      return Reflect.apply(original, this, args);
    });
    const host = await connected.prepare(), before = await connected.snapshot();
    const outcome = await Effect.runPromiseExit(host.run(host.newRequestKey(), explicit));
    expect(Exit.isFailure(outcome)).toBe(true);
    if (Exit.isFailure(outcome)) expect(outcome.cause.reasons.some(reason =>
      Cause.isFailReason(reason) && reason.error.reason === "unsupportedProfile")).toBe(true);
    expect(caught).toBe(true);
    expect(await connected.snapshot()).toEqual(before);
  }, 180_000);

  it("isolates equal native endpoint identities and Countries in another genuine scope", async () => {
    const local: Array<() => Promise<void>> = [];
    try {
      const other = await prepareCoreCartContextReads(driver, close => local.push(close), "defaults",
        connected.fixture.physical, "Other scope: ");
      expect(other.fixture.physical.namespace).toBe(connected.fixture.physical.namespace);
      expect(other.fixture.physical.instanceName).not.toBe(connected.fixture.physical.instanceName);
      const host = await connected.prepare(), foreign = await other.prepare();
      const actual = await run(host, explicit), foreignResult = await run(foreign, explicit);
      expect(actual.sales_channel.name).toBe(cartContextRows.channel.name);
      expect(actual.region?.name).toBe(cartContextRows.region.name);
      expect(foreignResult.sales_channel.name).toBe("Other scope: " + cartContextRows.channel.name);
      expect(foreignResult.region?.name).toBe("Other scope: " + cartContextRows.region.name);
      expect(foreignResult.region?.countries).toEqual([cartContextCountries.gb, cartContextCountries.us].map(row => ({
        ...row, name: "Other scope: " + row.name, display_name: "Other scope: " + row.display_name,
      })));
      expect(actual).toEqual({ sales_channel: cartContextRows.channel,
        region: { ...cartContextRows.region, countries: [cartContextCountries.gb, cartContextCountries.us] } });
    } finally { await finishOrderFixture(local.reverse()); }
  }, 180_000);
});
