import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Schema } from "effect";
import { SalesChannelModuleService } from "@medusajs/sales-channel/services";
import { prepareCoreSalesChannelCreation } from "./support/core-sales-channel-creation-fixture";
import { expectWorkflowDefect, expectWorkflowRefusal } from "./support/workflow-failure-assertions";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreSalesChannelCreation>>;
const rows = async () => (await connected.fixture.snapshot()).rows;
const commits = async () => (await connected.fixture.snapshot()).outcomes;
const events = async () => (await connected.fixture.snapshot()).events;
const snapshot = () => connected.fixture.snapshot();

/** Each case invokes the actual native composer and Sales Channel service on
 * admitted shared logical storage. These are not provider or scheduler proofs. */
describe("native Sales Channel creation on shared logical storage", { concurrent: false }, () => {
  beforeAll(async () => {
    connected = await prepareCoreSalesChannelCreation(driver, close => cleanup.push(close));
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("executes genuine empty creation once without row or event publication", async () => {
    const native = vi.spyOn(SalesChannelModuleService.prototype, "createSalesChannels");
    const host = await connected.prepare();
    try {
      const before = await snapshot(), key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { salesChannelsData: [] }))).toEqual([]);
      expect(native).toHaveBeenCalledTimes(1);
      expect(native.mock.calls[0]?.[0]).toEqual([]);
      expect(await rows()).toEqual(before.rows);
      expect(await events()).toEqual(before.events);
      expect((await commits()).length - before.outcomes.length).toBe(1);
      const committed = await snapshot();
      expect(await Effect.runPromise(host.run(key, { salesChannelsData: [] }))).toEqual([]);
      expect(native).toHaveBeenCalledTimes(1);
      expect(await snapshot()).toEqual(committed);
    } finally { native.mockRestore(); }
  }, 120_000);

  it("creates four complete native rows with ordered events, defaults and durable replay", async () => {
    const native = vi.spyOn(SalesChannelModuleService.prototype, "createSalesChannels");
    const host = await connected.prepare(), changed = await connected.prepare("c".repeat(64));
    const input = { salesChannelsData: [
      { id: "sales-native-rich", name: "Web", description: "Native description", is_disabled: true,
        metadata: { nested: { enabled: true }, order: [1, null, "web"] } },
      { name: "Generated channel" },
      { id: "sales-native-null", name: "Explicit null", description: null, metadata: null, is_disabled: false },
      { id: "sales-native-empty", name: "Explicit empty", description: "", metadata: {}, is_disabled: true },
    ] };
    try {
      const before = await snapshot(), key = host.newRequestKey();
      const result = await Effect.runPromise(host.run(key, input));
      expect(result).toHaveLength(4);
      expect(result.map(row => row.name)).toEqual(input.salesChannelsData.map(row => row.name));
      expect(result[0]).toMatchObject(input.salesChannelsData[0]!);
      expect(result[1]).toMatchObject({ id: expect.stringMatching(/^sc_/), name: "Generated channel",
        description: null, is_disabled: false, metadata: null });
      expect(result[2]).toMatchObject(input.salesChannelsData[2]!);
      expect(result[3]).toMatchObject(input.salesChannelsData[3]!);
      const table = connected.sales.schema.tables.find(value => value.identity.tableId === "sales_channel");
      if (table === undefined) throw new Error("Missing genuine Sales Channel schema");
      for (const row of result) {
        expect(Object.keys(row).sort()).toEqual(table.columns.map(column => column.identity.columnId).sort());
        expect(row).toMatchObject({ created_at: expect.any(String), updated_at: expect.any(String), deleted_at: null });
      }
      expect((await rows()).length - before.rows.length).toBe(4);
      expect((await commits()).length - before.outcomes.length).toBe(1);
      const emitted = (await events()).slice(before.events.length), ids = result.map(row => row.id);
      expect(emitted.map(event => event.envelope.contract)).toEqual([
        ...ids.map(() => "sales_channel.sales-channel.created"), ...ids.map(() => "sales-channel.created"),
      ]);
      expect(emitted.map(event => event.envelope.internal)).toEqual([...ids.map(() => true), ...ids.map(() => false)]);
      for (const contract of ["sales_channel.sales-channel.created", "sales-channel.created"])
        expect(emitted.filter(event => event.envelope.contract === contract).map(event => event.envelope.message))
          .toEqual(ids.map(id => expect.objectContaining({ data: { id } })));
      expect(new Set(emitted.map(event => event.timestamp)).size).toBe(1);
      const committed = await snapshot();
      expect(await Effect.runPromise(host.run(key, input))).toEqual(result);
      expect(native).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(host.run(key, { salesChannelsData: [{ name: "Conflicting request" }] })))
        .rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await snapshot()).toEqual(committed);
      expect(await Effect.runPromise(connected.list(ids))).toEqual(expect.arrayContaining([...result]));
    } finally { native.mockRestore(); }
  }, 120_000);

  it("refuses managed fields, unknown fields and more than four rows before native mutation", async () => {
    const native = vi.spyOn(SalesChannelModuleService.prototype, "createSalesChannels");
    const host = await connected.prepare();
    try {
      const before = await snapshot();
      const rejected = [
        { salesChannelsData: [{ name: "Managed creation", created_at: "2020-01-01T00:00:00Z" }] },
        { salesChannelsData: [{ name: "Managed update", updated_at: "2020-01-01T00:00:00Z" }] },
        { salesChannelsData: [{ name: "Managed deletion", deleted_at: null }] },
        { salesChannelsData: [{ name: "Unknown row field", foreign_field: true }] },
        { salesChannelsData: [{ name: "Unknown envelope" }], foreign_field: true },
        { salesChannelsData: Array.from({ length: 5 }, (_, index) => ({ name: "Overflow " + index })) },
      ];
      for (const input of rejected)
        await expect(Effect.runPromise(host.run(host.newRequestKey(), input))).rejects.toMatchObject({ reason: "invalidInput" });
      expect(native).not.toHaveBeenCalled();
      expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 120_000);

  it("returns final canonical DTOs at every repeated supplied-ID position", async () => {
    const host = await connected.prepare(), before = await snapshot();
    const input = { salesChannelsData: [
      { id: "sales-create-alias", name: "First", description: null, metadata: null },
      { id: "sales-create-between", name: "Between" },
      { id: "sales-create-alias", name: "Ignored", description: "Filled", is_disabled: true, metadata: { retained: true } },
    ] };
    const key = host.newRequestKey(), result = await Effect.runPromise(host.run(key, input));
    expect(result.map(row => row.id)).toEqual(["sales-create-alias", "sales-create-between", "sales-create-alias"]);
    expect(result[0]).toEqual(result[2]);
    expect(result[0]).toMatchObject({ name: "First", description: "Filled", is_disabled: true, metadata: { retained: true } });
    const after = await snapshot();
    expect(after.rows.length - before.rows.length).toBe(2);
    for (const contract of ["sales_channel.sales-channel.created", "sales-channel.created"])
      expect(after.events.slice(before.events.length).filter(event => event.envelope.contract === contract).map(event => event.envelope.message))
        .toEqual((contract === "sales-channel.created" ? result.map(row => row.id) : ["sales-create-alias", "sales-create-between"])
          .map(id => expect.objectContaining({ data: { id } })));
    expect(await Effect.runPromise(connected.list(["sales-create-alias"]))).toEqual([result[0]]);
    expect(await Effect.runPromise(host.run(key, input))).toEqual(result);
    expect(await snapshot()).toEqual(after);
    await expect(Effect.runPromise(host.run(host.newRequestKey(), input))).rejects.toBeDefined();
    expect(await snapshot()).toEqual(after);
  }, 120_000);

  it("rolls back a real native write and captured internal event on a late service failure", async () => {
    const original = SalesChannelModuleService.prototype.createSalesChannels;
    const failure = new Error("Late native Sales Channel failure");
    let nativeCompleted = false;
    const native = vi.spyOn(SalesChannelModuleService.prototype, "createSalesChannels")
      .mockImplementation(async function (this: SalesChannelModuleService, ...args) {
        await Reflect.apply(original, this, args);
        nativeCompleted = true;
        throw failure;
      });
    const host = await connected.prepare();
    try {
      const before = await snapshot();
      const result = await Effect.runPromiseExit(host.run(host.newRequestKey(), {
        salesChannelsData: [{ id: "sales-native-late-failure", name: "Late failure" }],
      }));
      expectWorkflowDefect(result, failure);
      expect(nativeCompleted).toBe(true);
      expect(native).toHaveBeenCalledTimes(1);
      expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 120_000);

  it("rejects a malformed complete native return after real writes and publishes nothing", async () => {
    const original = SalesChannelModuleService.prototype.createSalesChannels;
    let nativeCompleted = false;
    const native = vi.spyOn(SalesChannelModuleService.prototype, "createSalesChannels")
      .mockImplementation(async function (this: SalesChannelModuleService, ...args) {
        const result = structuredClone(await Reflect.apply(original, this, args));
        const row = Array.isArray(result) && result.length === 1 ? result[0] : undefined;
        if (typeof row !== "object" || row === null) throw new Error("Missing actual native Sales Channel result");
        nativeCompleted = true;
        // Deliberately corrupt the foreign return after the native service and
        // its real mutation/event path complete; never fabricate a storage row.
        Object.defineProperty(row, "is_disabled", { value: "invalid", enumerable: true, configurable: true, writable: true });
        return result;
      });
    const host = await connected.prepare();
    try {
      const before = await snapshot();
      const result = await Effect.runPromiseExit(host.run(host.newRequestKey(), {
        salesChannelsData: [{ id: "sales-native-malformed-return", name: "Malformed native return" }],
      }));
      expectWorkflowRefusal(result, "receiptMismatch");
      expect(nativeCompleted).toBe(true);
      expect(native).toHaveBeenCalledTimes(1);
      expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 120_000);

  it("isolates colliding Sales Channel IDs and request keys across genuine scopes", async () => {
    const other = await prepareCoreSalesChannelCreation(driver, close => cleanup.push(close), {
      physical: connected.fixture.physical,
    });
    const first = await connected.prepare(), second = await other.prepare(), key = first.newRequestKey();
    const left = { salesChannelsData: [{ id: "sales-shared-id", name: "First shop" }, { id: "sales-only-first", name: "First only" }] };
    const right = { salesChannelsData: [{ id: "sales-shared-id", name: "Second shop", is_disabled: true }] };
    const firstResult = await Effect.runPromise(first.run(key, left));
    expect(connected.target.scopeUuid).not.toBe(other.target.scopeUuid);
    expect(connected.fixture.physical.instanceName).not.toBe(other.fixture.physical.instanceName);
    const firstRows = await rows();
    const secondResult = await Effect.runPromise(second.run(key, right));
    expect(await rows()).toEqual(firstRows);
    expect(await Effect.runPromise(connected.list(["sales-shared-id"]))).toMatchObject([{ id: "sales-shared-id", name: "First shop" }]);
    expect(await Effect.runPromise(other.list(["sales-shared-id"]))).toMatchObject([{ id: "sales-shared-id", name: "Second shop", is_disabled: true }]);
    expect(await Effect.runPromise(other.list(["sales-only-first"]))).toEqual([]);
    const committed = await Promise.all([snapshot(), other.fixture.snapshot()]);
    expect(await Effect.runPromise(first.run(key, left))).toEqual(firstResult);
    expect(await Effect.runPromise(second.run(key, right))).toEqual(secondResult);
    expect(await Promise.all([snapshot(), other.fixture.snapshot()])).toEqual(committed);
  }, 180_000);
});
