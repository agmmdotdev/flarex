import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Result, Schema } from "effect";
import { StockLocationModuleService } from "@medusajs/stock-location/services";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxAppRowCurrent, fxSystemCommits, fxSystemCommitAppRowChanges } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { prepareLogicalStockLocationUpdate } from "./support/logical-stock-location-update-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalStockLocationUpdate>>;
const rows = () => connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
const facts = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitAppRowChanges);
const commits = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommits);
const events = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const snapshot = async () => ({ rows: await rows(), facts: await facts(), commits: await commits(), events: await events() });
const locationUpdated = "stock_location.stock-location.updated";
const addressUpdated = "stock_location.stock-location-address.updated";
const addressCreated = "stock_location.stock-location-address.created";
function failurePath(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? failurePath(reason.error)
    : reason._tag === "Die" ? failurePath(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...failurePath(value.cause)];
  return value instanceof Error ? [value.message, ...failurePath(value.cause)] : [];
}

describe("native Stock Location selector and Address update on shared logical storage", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalStockLocationUpdate(driver, close => cleanup.push(close)); }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("preserves zero matches, empty native Address calls and successful undefined as public null", async () => {
    const list = vi.spyOn(StockLocationModuleService.prototype, "listStockLocationAddresses");
    const upsert = vi.spyOn(StockLocationModuleService.prototype, "upsertStockLocationAddresses");
    const update = vi.spyOn(StockLocationModuleService.prototype, "updateStockLocations");
    const host = await connected.prepare();
    try {
      const before = await snapshot(), key = host.newRequestKey(), input = { selector: {}, update: {} };
      expect(await Effect.runPromise(host.run(key, input))).toBeNull();
      expect(list).toHaveBeenCalledTimes(1); expect(upsert).toHaveBeenCalledTimes(1); expect(update).toHaveBeenCalledTimes(1);
      expect(list.mock.calls[0]?.[0]).toEqual({ id: [] });
      expect(upsert.mock.calls[0]?.[0]).toEqual([]);
      expect(await update.mock.results[0]?.value).toBeUndefined();
      expect(await rows()).toEqual(before.rows); expect(await facts()).toEqual(before.facts); expect(await events()).toEqual(before.events);
      expect((await commits()).length - before.commits.length).toBe(1);
      const committed = await snapshot();
      expect(await Effect.runPromise(host.run(key, input))).toBeNull();
      expect(update).toHaveBeenCalledTimes(1); expect(await snapshot()).toEqual(committed);
    } finally { list.mockRestore(); upsert.mockRestore(); update.mockRestore(); }
  }, 120_000);

  it("updates four actual matches and Addresses with native scalar-first output, exact events, settlement and replay", async () => {
    const ids = await connected.seed("stock-update-four", 4), addressIds = ids.map((_, index) => "stock-update-four-address-" + index);
    const native = vi.spyOn(StockLocationModuleService.prototype, "updateStockLocations");
    const host = await connected.prepare(), changed = await connected.prepare("e".repeat(64));
    const input = { selector: { name: "stock-update-four" }, update: { name: "Updated four warehouses", address: { city: "After" } } };
    try {
      const before = await snapshot(), key = host.newRequestKey();
      const result = await Effect.runPromise(host.run(key, input));
      expect(Array.isArray(result)).toBe(false); expect(result).toMatchObject({ id: ids[0], name: input.update.name });
      const table = connected.definition.schema.tables.find(value => value.identity.tableId === "stock_location");
      if (table === undefined || result === null) throw new Error("Missing genuine Stock Location output");
      expect(Object.keys(result).sort()).toEqual(table.columns.map(column => column.identity.columnId).sort());
      expect(await Effect.runPromise(connected.list(ids, true))).toMatchObject(ids.map((id, index) => ({ id, name: input.update.name,
        address_id: addressIds[index], address: { id: addressIds[index], address_1: "Street " + index, country_code: "US", city: "After" } })));
      const emitted = (await events()).slice(before.events.length);
      expect(emitted.map(event => event.envelope.contract)).toEqual([...ids.map(() => addressUpdated), ...ids.map(() => locationUpdated)]);
      expect(emitted.map(event => event.envelope.message)).toEqual([...addressIds, ...ids].map(id => expect.objectContaining({ data: { id } })));
      expect(emitted.every(event => event.envelope.internal)).toBe(true);
      expect((await facts()).length - before.facts.length).toBe(8);
      expect((await commits()).length - before.commits.length).toBe(1);
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      const committed = await snapshot();
      expect(await Effect.runPromise(host.run(key, input))).toEqual(result); expect(native).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(host.run(key, { ...input, update: { name: "Conflict" } }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await snapshot()).toEqual(committed);
    } finally { native.mockRestore(); }
  }, 120_000);

  it("preserves an empty native result when an indexed ID candidate fails the admitted name residual", async () => {
    const ids = await connected.seed("stock-update-id-name-residual", 1);
    const host = await connected.prepare();
    const before = await snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), {
      selector: { id: ids, name: "A different warehouse name" }, update: {},
    }))).toBeNull();
    const after = await snapshot();
    expect(after.rows).toEqual(before.rows);
    expect(after.facts).toEqual(before.facts);
    expect(after.events).toEqual(before.events);
    expect(after.commits.length - before.commits.length).toBe(1);
  }, 120_000);

  it("retains partial Address patches and ordered metadata merge while Address-only input leaves Location rows untouched", async () => {
    const ids = await connected.seed("stock-update-partial", 2), addressIds = ids.map((_, index) => "stock-update-partial-address-" + index);
    const host = await connected.prepare();
    const beforeLocations = await Effect.runPromise(connected.list(ids));
    const before = await snapshot();
    await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: ids }, update: {
      address: { city: "City-only patch", metadata: { drop: "", added: true } },
    } }));
    expect(await Effect.runPromise(connected.addresses(addressIds))).toMatchObject(addressIds.map((id, index) => ({ id,
      address_1: "Street " + index, country_code: "US", city: "City-only patch", metadata: { keep: "address-" + index, added: true } })));
    expect(await Effect.runPromise(connected.list(ids))).toEqual(beforeLocations);
    expect((await facts()).length - before.facts.length).toBe(2);
    expect((await events()).slice(before.events.length).map(event => event.envelope.contract)).toEqual([addressUpdated, addressUpdated]);
    const beforeEmpty = await snapshot();
    await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: ids }, update: { address: {} } }));
    expect(await rows()).toEqual(beforeEmpty.rows); expect(await facts()).toEqual(beforeEmpty.facts); expect(await events()).toEqual(beforeEmpty.events);
    await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: ids }, update: { metadata: { drop: "", added: true } } }));
    // The genuine selector path shares its patch across rows. Its final
    // cumulative merge reaches every write and reintroduces the second drop.
    expect((await Effect.runPromise(connected.list(ids))).map(row => row.metadata)).toEqual(
      ids.map(() => ({ keep: "location-0", drop: "old", added: true })));
  }, 120_000);

  it("preserves mixed create-before-update Address upsert and leaves newly created Addresses standalone", async () => {
    const ids = await connected.seed("stock-update-mixed", 4, "mixed"), host = await connected.prepare();
    const upsert = vi.spyOn(StockLocationModuleService.prototype, "upsertStockLocationAddresses");
    try {
      const before = await snapshot();
      const result = await Effect.runPromise(host.run(host.newRequestKey(), { selector: { name: "stock-update-mixed" },
        update: { name: "Four mixed warehouses", address: { address_1: "New street", country_code: "GB", city: "London" } } }));
      expect(result).toMatchObject({ id: ids[0], name: "Four mixed warehouses" });
      const returned = await upsert.mock.results[0]?.value;
      if (!Array.isArray(returned) || returned.length !== 4) throw new Error("Missing genuine native Address upsert results");
      const created = returned.slice(0, 2), updated = returned.slice(2);
      expect(updated.map(row => row.id)).toEqual(["stock-update-mixed-address-0", "stock-update-mixed-address-2"]);
      expect(new Set(returned.map(row => row.id)).size).toBe(4);
      expect(await Effect.runPromise(connected.addresses(returned.map(row => row.id)))).toEqual(expect.arrayContaining(
        returned.map(row => expect.objectContaining({ id: row.id, address_1: "New street", country_code: "GB", city: "London" }))));
      expect(await Effect.runPromise(connected.list(ids, true))).toMatchObject([
        { id: ids[0], address_id: "stock-update-mixed-address-0", address: { id: "stock-update-mixed-address-0" } },
        { id: ids[1], address_id: null, address: null },
        { id: ids[2], address_id: "stock-update-mixed-address-2", address: { id: "stock-update-mixed-address-2" } },
        { id: ids[3], address_id: null, address: null },
      ]);
      expect((await facts()).length - before.facts.length).toBe(8);
      const emitted = (await events()).slice(before.events.length);
      expect(emitted.map(event => event.envelope.contract)).toEqual([
        addressCreated, addressCreated, addressUpdated, addressUpdated, ...ids.map(() => locationUpdated),
      ]);
      expect(emitted.map(event => event.envelope.message)).toEqual([...created, ...updated, ...ids.map(id => ({ id }))]
        .map(row => expect.objectContaining({ data: { id: row.id } })));
      expect((await commits()).length - before.commits.length).toBe(1);
    } finally { upsert.mockRestore(); }
  }, 120_000);

  it("preserves ignored address_id and a genuine empty root update without writes or events", async () => {
    const ids = await connected.seed("stock-update-ignored"), host = await connected.prepare(), before = await snapshot();
    const first = ids[0];
    if (first === undefined) throw new Error("Missing ignored-input seed");
    const previous = await Effect.runPromise(connected.list(ids));
    const result = await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: [first, first, "missing-native-location"] },
      update: { address_id: "nonexistent-ignored-address" } }));
    expect(result).toEqual(previous[0]);
    expect(await rows()).toEqual(before.rows); expect(await facts()).toEqual(before.facts); expect(await events()).toEqual(before.events);
    expect((await commits()).length - before.commits.length).toBe(1);
  }, 120_000);

  it("refuses an incomplete create branch in a mixed selection and preserves the full root", async () => {
    const ids = await connected.seed("stock-update-incomplete", 2, "mixed"), host = await connected.prepare();
    const before = await snapshot();
    const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), {
      selector: { id: ids }, update: { name: "Must roll back", address: { city: "Missing create-required fields" } },
    })));
    expect(Result.isFailure(result)).toBe(true); expect(await snapshot()).toEqual(before);
  }, 120_000);

  it("refuses malformed admission and a fifth actual selector match before native mutation methods", async () => {
    const ids = await connected.seed("stock-update-overflow", 5), first = ids[0];
    if (first === undefined) throw new Error("Missing overflow seed");
    const host = await connected.prepare(), upsert = vi.spyOn(StockLocationModuleService.prototype, "upsertStockLocationAddresses");
    const update = vi.spyOn(StockLocationModuleService.prototype, "updateStockLocations");
    try {
      const before = await snapshot();
      for (const input of [
        { selector: { id: ids }, update: { name: "Oversized selector" } },
        { selector: { id: first, q: "unsupported" }, update: {} },
        { selector: { id: first }, update: { id: "replacement" } },
        { selector: { id: first }, update: { created_at: "2000-01-01T00:00:00Z" } },
        { selector: { id: first }, update: { address: { id: "override-selected-address" } } },
        { selector: { id: first }, update: { address: { country_code: null } } },
      ]) {
        // @ts-expect-error The nonnullable Address country is deliberately invalid at this public runtime boundary.
        expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))).toBe(true);
      }
      const overflow = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), {
        selector: { name: "stock-update-overflow" }, update: { name: "No truncation", address: { city: "No writes" } },
      })));
      if (Result.isSuccess(overflow)) throw new Error("Fifth actual Stock Location was admitted");
      expect(failurePath(overflow.failure)).toContain("unsupportedProfile");
      expect(upsert).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
    } finally { upsert.mockRestore(); update.mockRestore(); }
  }, 120_000);

  it("rolls back Address and Location writes after a late throw or malformed complete native result", async () => {
    const ids = await connected.seed("stock-update-late"), host = await connected.prepare();
    for (const mode of ["throw", "malformed"] as const) {
      const original = StockLocationModuleService.prototype.updateStockLocations;
      let completed = false;
      const native = vi.spyOn(StockLocationModuleService.prototype, "updateStockLocations")
        .mockImplementation(async function (this: StockLocationModuleService, ...args) {
          const result = await Reflect.apply(original, this, args); completed = true;
          if (mode === "throw") throw new Error("Late native Stock Location update failure");
          if (!Schema.is(Schema.JsonObject)(result)) throw new Error("Missing scalar native result");
          Object.defineProperty(result, "name", { value: 42, enumerable: true, writable: true, configurable: true });
          return result;
        });
      try {
        const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), {
          selector: { id: ids }, update: { name: "Rollback", address: { city: "Rollback" } },
        })));
        if (Result.isSuccess(result)) throw new Error("Late failure committed");
        expect(completed).toBe(true); expect(failurePath(result.failure)).toContain(mode === "throw" ? "adapterFailure" : "receiptMismatch");
        expect(await snapshot()).toEqual(before);
      } finally { native.mockRestore(); }
    }
  }, 120_000);

  it("poisons the root when native code catches a denied sibling mutation after successful writes", async () => {
    const ids = await connected.seed("stock-update-poison"), host = await connected.prepare();
    const original = StockLocationModuleService.prototype.updateStockLocations;
    let caught = false, completed = false;
    const native = vi.spyOn(StockLocationModuleService.prototype, "updateStockLocations")
      .mockImplementation(async function (this: StockLocationModuleService, ...args) {
        const result = await Reflect.apply(original, this, args); completed = true;
        try { await this.deleteStockLocations(ids); } catch { caught = true; }
        return result;
      });
    try {
      const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), {
        selector: { id: ids }, update: { name: "Poisoned root", address: { city: "Poisoned Address" } },
      })));
      expect(completed).toBe(true); expect(caught).toBe(true); expect(Result.isFailure(result)).toBe(true); expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 120_000);

  it("isolates identical selectors, native IDs and update request keys across two real scopes", async () => {
    const other = await prepareLogicalStockLocationUpdate(driver, close => cleanup.push(close), {
      resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "stock_location_update_shop_b", projectId: "stock_location_update_shop_b", uuidOffset: 150_000 },
    });
    const ids = await connected.seed("stock-update-scope"), otherIds = await other.seed("stock-update-scope");
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey();
    const leftInput = { selector: { id: ids }, update: { name: "First shop", address: { city: "Left" } } };
    const rightInput = { selector: { id: otherIds }, update: { name: "Second shop", address: { city: "Right" } } };
    const leftResult = await Effect.runPromise(left.run(key, leftInput)), rightResult = await Effect.runPromise(right.run(key, rightInput));
    expect(await Effect.runPromise(connected.list(ids, true))).toMatchObject([{ id: ids[0], name: "First shop", address: { city: "Left" } }]);
    expect(await Effect.runPromise(other.list(otherIds, true))).toMatchObject([{ id: otherIds[0], name: "Second shop", address: { city: "Right" } }]);
    const before = await snapshot();
    expect(await Effect.runPromise(left.run(key, leftInput))).toEqual(leftResult);
    expect(await Effect.runPromise(right.run(key, rightInput))).toEqual(rightResult); expect(await snapshot()).toEqual(before);
  }, 180_000);
});
