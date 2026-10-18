import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { locationFulfillmentSetCreationResources } from "../src/workflow/policy";
import { prepareLogicalLocationFulfillmentSetCreation, linkedCreationLocations } from "./support/logical-location-fulfillment-set-creation-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalLocationFulfillmentSetCreation>>;
const input = (location: string, name: string) => ({ location_id: location, fulfillment_set_data: { name, type: " Raw TYPE " } });
type Inventory = Awaited<ReturnType<typeof connected.snapshot>>;
const eventDelta = (before: Inventory, after: Inventory) => {
  const keys = new Set(before.events.map(event => JSON.stringify([event.scopeUuid, event.commitSeq.toString(), event.eventOrdinal])));
  return after.events.filter(event => !keys.has(JSON.stringify([event.scopeUuid, event.commitSeq.toString(), event.eventOrdinal])));
};
function retainedTap() {
  const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
  if (getter === undefined) throw new Error("Missing genuine SDK retained input getter");
  const Creation = Schema.Array(Schema.String).check(Schema.isLengthBetween(1, 1));
  const Association = Schema.Array(Schema.Struct({ stock_location: Schema.Struct({ stock_location_id: Schema.String }),
    fulfillment: Schema.Struct({ fulfillment_set_id: Schema.String }) })).check(Schema.isLengthBetween(1, 1));
  const values: unknown[] = [];
  const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
    const value: unknown = Reflect.apply(getter, this, []); values.push(structuredClone(value)); return value;
  });
  return { restore: () => spy.mockRestore(), get: () => {
    const creation = values.filter(Schema.is(Creation)), association = values.filter(Schema.is(Association));
    if (creation.length !== 1 || association.length !== 1) throw new Error("Expected actual native Set and association retained inputs");
    return { creation: creation[0], association: association[0] };
  } };
}

describe("genuine linked Location FulfillmentSet creation", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalLocationFulfillmentSetCreation(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it.each(["active", "missing", "historical"] as const)("creates for %s Location without liveness enforcement, returns void and replays once", async mode => {
    const name = "Linked Set " + mode, value = input(linkedCreationLocations[mode], name), host = await connected.prepare();
    const before = await connected.snapshot(), key = host.newRequestKey(); let calls = 0;
    expect(await Effect.runPromise(host.run(key, value).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (label, work) => Effect.sync(() => { if (label === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    })))).toBeNull();
    console.info("Location FulfillmentSet creation calls", calls);
    expect(calls).toBeLessThanOrEqual(locationFulfillmentSetCreationResources.calls);
    const rows = await connected.read(), set = rows.find(row => row.name === name);
    expect(set).toMatchObject({ id: expect.stringMatching(/^fuset_/), metadata: null, deleted_at: null, type: " Raw TYPE " });
    const link = rows.find(row => row.fulfillment_set_id === set?.id && row.stock_location_id === value.location_id);
    expect(link).toMatchObject({ id: expect.stringMatching(/^locfs_/), deleted_at: null });
    const after = await connected.snapshot(), events = eventDelta(before, after);
    expect(events.map(event => event.envelope.contract)).toEqual(["fulfillment.fulfillment-set.created", "LinkLocationFulfillmentSet.attached"]);
    expect(new Set(events.map(event => event.commitSeq)).size).toBe(1);
    expect(await Effect.runPromise(host.run(key, value))).toBeNull(); expect(await connected.snapshot()).toEqual(after);
    await expect(Effect.runPromise(host.run(key, input(value.location_id, name + " changed")))).rejects.toMatchObject({ reason: "requestConflict" });
  }, 240_000);

  it("ignores extra Set fields exactly at the native composer and refuses active name collisions atomically", async () => {
    const host = await connected.prepare(), value = input(linkedCreationLocations.active, "Ignored Set fields");
    const result = await Effect.runPromise(host.run(host.newRequestKey(), { ...value,
      fulfillment_set_data: { ...value.fulfillment_set_data, id: "ignored", metadata: { ignored: true }, service_zones: [{ name: "ignored" }] } }));
    expect(result).toBeNull();
    expect((await connected.read()).find(row => row.name === value.fulfillment_set_data.name)).toMatchObject({ metadata: null, id: expect.stringMatching(/^fuset_/) });
    const before = await connected.snapshot();
    await expect(Effect.runPromise(host.run(host.newRequestKey(), input(linkedCreationLocations.active, "Reserved Set137")))).rejects.toBeDefined();
    expect(await connected.snapshot()).toEqual(before);
  }, 240_000);

  it("runs genuine root plus actual retained dismiss and physical Set inverse under one commit", async () => {
    const tap = retainedTap();
    try {
      const host = await connected.prepareRoundtrip(tap.get), value = input(linkedCreationLocations.missing, "Retained inverse Set");
      const before = await connected.snapshot(); let calls = 0;
      expect(await Effect.runPromise(host.run(host.newRequestKey(), value).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (label, work) => Effect.sync(() => { if (label === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })))).toBeNull();
      console.info("Location FulfillmentSet full retained roundtrip calls", calls);
      expect(calls).toBeLessThanOrEqual(locationFulfillmentSetCreationResources.calls);
      const after = await connected.snapshot(), events = eventDelta(before, after);
      expect(events.map(event => event.envelope.contract)).toEqual(["fulfillment.fulfillment-set.created", "LinkLocationFulfillmentSet.attached",
        "LinkLocationFulfillmentSet.detached", "fulfillment.fulfillment-set.deleted"]);
      expect(new Set(events.map(event => event.commitSeq)).size).toBe(1);
      const actual = tap.get(), rows = await connected.read();
      expect(rows.some(row => row.name === value.fulfillment_set_data.name)).toBe(false);
      expect(rows.find(row => row.fulfillment_set_id === actual.creation?.[0])).toMatchObject({ stock_location_id: value.location_id, deleted_at: expect.any(String) });
    } finally { tap.restore(); }
  }, 240_000);

  it("rolls back a late failure after both genuine retained callbacks", async () => {
    const tap = retainedTap();
    try {
      const host = await connected.prepareRoundtrip(tap.get, true), before = await connected.snapshot();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), input(linkedCreationLocations.active, "Late rolled back Set")))).rejects.toBeDefined();
      expect(await connected.snapshot()).toEqual(before);
    } finally { tap.restore(); }
  }, 240_000);
});
