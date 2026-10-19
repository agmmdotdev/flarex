import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { shippingOptionCreationInput } from "./support/logical-shipping-option-creation-fixture";
import { fulfillmentCreationInput } from "./support/logical-fulfillment-create-fixture";
import { prepareLogicalShippingOptionReferenceDetachment } from "./support/logical-shipping-option-reference-detachment-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalShippingOptionReferenceDetachment>>;
type Snapshot = Awaited<ReturnType<typeof connected.snapshot>>;
const eventsSince = (before: Snapshot, after: Snapshot) => after.events.filter(event => !before.events.some(prior =>
  prior.scopeUuid === event.scopeUuid && prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
function retainedTap() {
  const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
  if (getter === undefined) throw new Error("Missing genuine retained input getter");
  const definitions = {
    creation: Schema.Struct({ createdIds: Schema.Array(Schema.String), updatedPreviousData: Schema.Array(Schema.Json) }),
    pricing: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
    links: Schema.Struct({ linksToCreate: Schema.Array(Schema.Json), linksToRemove: Schema.Array(Schema.Json) }),
    event: Schema.Struct({ eventGroupId: Schema.String, eventName: Schema.Literal("shipping-option.created") }),
  };
  const values: unknown[] = [];
  const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
    const value: unknown = Reflect.apply(getter, this, []); values.push(value); return value;
  });
  const one = <Value>(schema: Schema.Codec<Value>) => {
    const selected = values.filter(Schema.is(schema));
    if (selected.length !== 1) throw new Error("Expected exactly one actual retained native payload");
    return selected[0];
  };
  return { restore: () => spy.mockRestore(), getCreation: () => one(definitions.creation), get: () => ({ creation: one(definitions.creation), pricing: one(definitions.pricing),
    links: one(definitions.links), event: one(definitions.event) }) };
}
function retainedIdsTap(prefix: "serzo_" | "fuset_") {
  const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
  if (getter === undefined) throw new Error("Missing native retained ID getter");
  const values: unknown[] = [];
  const schema = Schema.Array(Schema.String.check(Schema.isStartsWith(prefix))).check(Schema.isMinLength(1));
  const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
    const value: unknown = Reflect.apply(getter, this, []); if (Schema.is(schema)(value)) values.push(value); return value;
  });
  return { restore: () => spy.mockRestore(), get: () => {
    if (values.length !== 1) throw new Error("Expected one actual retained parent ID cohort");
    return values[0];
  } };
}

describe("native physical Option reference detachment", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalShippingOptionReferenceDetachment(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("executes the actual retained Option inverse against a committed Fulfillment reference while preserving source timestamps", async () => {
    const tap = retainedTap();
    let actual: ReturnType<typeof tap.get>, option: string;
    try {
      const forward = await connected.creation.prepare();
      const created = await Effect.runPromise(forward.run(forward.newRequestKey(), shippingOptionCreationInput("detach142-target")));
      const id = created[0]?.id;
      if (typeof id !== "string") throw new Error("Missing genuine native Option ID");
      option = id; actual = tap.get();
    } finally { tap.restore(); }
    const protectedOption = await connected.seedOption("detach142-protected");
    const fulfillment = await connected.prepare();
    const created = await Effect.runPromise(fulfillment.run(fulfillment.newRequestKey(), {
      ...fulfillmentCreationInput("detach142-source"), shipping_option_id: option,
    }));
    if (typeof created.id !== "string") throw new Error("Missing genuine Fulfillment source identity");
    const beforeRows = await connected.read(), before = beforeRows.find(row => row.id === created.id),
      link = beforeRows.find(row => row.shipping_option_id === option && typeof row.price_set_id === "string"),
      protectedRow = beforeRows.find(row => row.id === protectedOption);
    expect(before).toMatchObject({ shipping_option_id: option, deleted_at: null });
    expect(beforeRows.find(row => row.id === option)).toBeDefined();
    expect(link).toMatchObject({ deleted_at: null, price_set_id: expect.any(String) });
    expect(beforeRows.find(row => row.id === link?.price_set_id)).toBeDefined();
    const inverse = await connected.prepareOptionInverse(() => actual), key = inverse.newRequestKey(), snapshot = await connected.snapshot();
    // Pre-fix native default-PG expectation: this callback succeeds and changes
    // only the surviving FK. The current cascade-only adapter instead refuses
    // the still-attached source at final reference validation (document142).
    expect(await Effect.runPromise(inverse.run(key, null))).toBeNull();
    const rows = await connected.read();
    expect(rows.some(row => row.id === option)).toBe(false);
    expect(rows.find(row => row.id === created.id)).toEqual({ ...before, shipping_option_id: null });
    expect(rows.find(row => row.id === link?.id)?.deleted_at).not.toBeNull();
    expect(rows.find(row => row.id === link?.price_set_id)).toBeUndefined();
    expect(rows.filter(row => row.price_set_id === link?.price_set_id && typeof row.currency_code === "string")).toEqual([]);
    expect(rows.find(row => row.id === protectedOption)).toEqual(protectedRow);
    const settled = await connected.snapshot(), events = eventsSince(snapshot, settled);
    expect(events.filter(event => event.envelope.contract === "fulfillment.fulfillment.updated")).toEqual([]);
    expect(events.filter(event => event.envelope.contract === "fulfillment.shipping-option.deleted")).toHaveLength(1);
    expect(await Effect.runPromise(inverse.run(key, null))).toBeNull(); expect(await connected.snapshot()).toEqual(settled);
    const original = beforeRows.find(row => row.id === option);
    if (original === undefined) throw new Error("Missing complete original native Option row");
    // Trusted canonical arrangement tests identity reuse without widening the
    // public creation grammar. It is not a native supplied-ID creation claim.
    await connected.arrangeReference("shipping_option", "insert", [original]);
    expect((await connected.read()).find(row => row.id === created.id)).toEqual({ ...before, shipping_option_id: null });
    const cancel = await connected.prepareCancel(), cancelled = await Effect.runPromise(cancel.run(cancel.newRequestKey(), created.id));
    expect(cancelled).toMatchObject({ shipping_option_id: null, shipping_option: null, canceled_at: expect.any(String) });
  }, 240_000);

  it.each(["zone", "set"] as const)("executes the actual retained %s inverse over active and historical Fulfillment sources", async kind => {
    const prefix = "detach142-parent-" + kind, tap = retainedIdsTap(kind === "zone" ? "serzo_" : "fuset_");
    let target: string, retained: unknown;
    try {
      if (kind === "zone") {
        const host = await connected.prepareZone(), result = await Effect.runPromise(host.run(host.newRequestKey(), {
          data: [{ name: prefix, fulfillment_set_id: "set138", geo_zones: [{ type: "country", country_code: "mm" }] }],
        }));
        const id = result[0]?.id; if (typeof id !== "string") throw new Error("Missing genuine Zone ID"); target = id;
      } else {
        const host = await connected.prepareSet(), result = await Effect.runPromise(host.run(host.newRequestKey(), [{ name: prefix, type: "shipping" }]));
        const id = result[0]?.id; if (typeof id !== "string") throw new Error("Missing genuine Set ID"); target = id;
      }
      retained = tap.get();
    } finally { tap.restore(); }
    let zone = target;
    if (kind === "set") {
      const host = await connected.prepareZone(), result = await Effect.runPromise(host.run(host.newRequestKey(), {
        data: [{ name: prefix + "-zone", fulfillment_set_id: target, geo_zones: [{ type: "country", country_code: "us" }] }],
      }));
      const id = result[0]?.id; if (typeof id !== "string") throw new Error("Missing child native Zone ID"); zone = id;
    }
    const option = await connected.seedBareOption(prefix, zone), fulfillment = await connected.prepare(), ids: string[] = [];
    for (const mode of ["active", "historical"]) {
      const created = await Effect.runPromise(fulfillment.run(fulfillment.newRequestKey(), { ...fulfillmentCreationInput(prefix + mode), shipping_option_id: option }));
      if (typeof created.id !== "string") throw new Error("Missing genuine Fulfillment source ID");
      ids.push(created.id);
      if (mode === "historical") await connected.arrangeReference("fulfillment", "softDelete", [{ id: created.id }]);
    }
    const before = await connected.read(), snapshots = ids.map(id => before.find(row => row.id === id)), protectedSet = before.find(row => row.id === "set138");
    expect(snapshots[0]?.deleted_at).toBeNull(); expect(snapshots[1]?.deleted_at).not.toBeNull();
    const host = await connected.prepareParentInverse(kind, () => retained);
    expect(await Effect.runPromise(host.run(host.newRequestKey(), null))).toBeNull();
    const after = await connected.read();
    for (const [index, id] of ids.entries()) expect(after.find(row => row.id === id)).toEqual({ ...snapshots[index], shipping_option_id: null });
    expect(after.find(row => row.id === target)).toBeUndefined(); expect(after.find(row => row.id === option)).toBeUndefined();
    expect(after.filter(row => row.shipping_option_id === option)).toEqual([]);
    expect(after.find(row => row.id === "set138")).toEqual(protectedSet);
  }, 300_000);

  it.each([false, true])("executes genuine same-root create, pending cancellation=%s, inverse and later native cancellation reads", async cancelBefore => {
    const tap = retainedTap();
    try {
      const host = await connected.prepareCombined("detach142-combined-" + cancelBefore, tap.getCreation, { cancelBefore });
      const result = await Effect.runPromise(host.run(host.newRequestKey(), null));
      expect(result.after).toMatchObject({ shipping_option_id: null, shipping_option: null, canceled_at: expect.any(String) });
      expect(result.repeat).toEqual(result.after);
      if (cancelBefore) {
        expect(result.before).toMatchObject({ shipping_option_id: expect.any(String), canceled_at: expect.any(String) });
        expect(result.after).toMatchObject({ updated_at: Schema.decodeUnknownSync(Schema.JsonObject)(result.before).updated_at });
      }
      const stored = Schema.decodeUnknownSync(Schema.JsonObject)(result.after), rows = await connected.read();
      expect(rows.find(row => row.id === stored.id)).toMatchObject({ shipping_option_id: null, canceled_at: stored.canceled_at });
      expect(rows.find(row => row.id === stored.id)?.updated_at).toBe(stored.updated_at);
    } finally { tap.restore(); }
  }, 240_000);

  it("rolls back real same-root graph changes, eager detachment and cancellation after a late failure", async () => {
    const tap = retainedTap();
    try {
      const host = await connected.prepareCombined("detach142-late", tap.getCreation, { cancelBefore: true, lateFailure: true }), before = await connected.snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), null))))).toBe(true);
      expect(await connected.snapshot()).toEqual(before);
    } finally { tap.restore(); }
  }, 240_000);

  it("preserves shared call-limit exhaustion and atomic refusal in the combined native profile", async () => {
    const tap = retainedTap();
    try {
      const host = await connected.prepareCombined("detach142-overflow", tap.getCreation, { calls: 8 }), before = await connected.snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), null))))).toBe(true);
      expect(await connected.snapshot()).toEqual(before);
    } finally { tap.restore(); }
  }, 240_000);

  it("refuses a real source cohort beyond the existing complete-query bound and rolls back the entire retained inverse", async () => {
    const tap = retainedTap(); let actual: ReturnType<typeof tap.get>, option: string;
    try {
      const forward = await connected.creation.prepare(), result = await Effect.runPromise(forward.run(forward.newRequestKey(), shippingOptionCreationInput("detach142-source-overflow")));
      const id = result[0]?.id; if (typeof id !== "string") throw new Error("Missing native overflow Option");
      option = id; actual = tap.get();
    } finally { tap.restore(); }
    const native = await connected.prepare(), created = await Effect.runPromise(native.run(native.newRequestKey(), {
      ...fulfillmentCreationInput("detach142-overflow-template"), shipping_option_id: option,
      delivery_address: null, items: [], labels: [],
    }));
    const template = (await connected.read()).find(row => row.id === created.id);
    if (template === undefined) throw new Error("Missing native complete source template");
    // Canonical fixture data uses the existing scalar write/materialization
    // owner in bounded batches. No graph or reference-selection logic is
    // reproduced. The target must refuse its complete actual selection.
    const maximum = connected.creation.modules.fulfillment.logicalResources.queryRows;
    const rows = Array.from({ length: maximum }, (_, index) => ({ ...template, id: "ful_detach142_overflow_" + index }));
    for (let offset = 0; offset < rows.length; offset += 32)
      await connected.arrangeReference("fulfillment", "insert", rows.slice(offset, offset + 32));
    const host = await connected.prepareOptionInverse(() => actual), before = await connected.snapshot();
    const outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), null)));
    expect(Result.isFailure(outcome)).toBe(true); expect(await connected.snapshot()).toEqual(before);
    expect((await connected.read()).find(row => row.id === option)).toBeDefined();
  }, 300_000);
});
