import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { ManualFulfillmentService } from "@medusajs/fulfillment-manual/services";
import { buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { jsonEqual } from "flarex-protocol/json";
import { isNonArrayRecord } from "@flarex/utils/records";
import { fulfillmentUpdateResources } from "../src/workflow/policy";
import { prepareLogicalFulfillmentUpdate } from "./support/logical-fulfillment-update-fixture";
import { shippingOptionParents } from "./support/logical-shipping-option-creation-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalFulfillmentUpdate>>;
type Snapshot = Awaited<ReturnType<typeof connected.snapshot>>;
const string = Schema.decodeUnknownSync(Schema.String);
const idOf = (row: JsonObject) => string(row.id);
const stamp = "2026-10-01T01:02:03.456Z", oldStamp = "2026-09-01T01:02:03.456Z";
const labels = (prefix: string, count = 4) => Array.from({ length: count }, (_, index) => ({ tracking_number: prefix + "-tracking-" + index,
  tracking_url: "https://example.test/update/" + prefix + "/" + index, label_url: "https://example.test/label/" + prefix + "/" + index }));
const children = (rows: readonly JsonObject[], id: string, kind: "item" | "label") => rows.filter(row => row.fulfillment_id === id &&
  (kind === "item" ? typeof row.title === "string" : typeof row.tracking_number === "string"));
const members = (row: JsonObject, field: string) => {
  const value = row[field]; if (!Array.isArray(value) || !value.every(isJsonObject)) throw new Error("Missing native update " + field); return value;
};
const eventsSince = (before: Snapshot, after: Snapshot) => after.events.filter(event => !before.events.some(prior =>
  prior.scopeUuid === event.scopeUuid && prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
const noMutation = (before: Snapshot, after: Snapshot) => {
  for (const key of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const)
    expect(after[key], key).toEqual(before[key]);
};
function retainedTap() {
  const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
  if (getter === undefined) throw new Error("Missing genuine finite StepResponse retained getter");
  const values: unknown[] = [], retained = Schema.Struct({ id: Schema.String });
  const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
    const value: unknown = Reflect.apply(getter, this, []);
    if (Schema.is(retained)(value)) values.push(value); return value;
  });
  return { restore: () => spy.mockRestore(), get: () => {
    if (values.length !== 1) throw new Error("Expected one original native update retained preimage");
    return values[0];
  } };
}

describe(`genuine native standalone Fulfillment update - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalFulfillmentUpdate(driver, close => cleanup.push(close)); }, 300_000);
  afterEach(async () => { await connected.closeCaseHosts(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);

  it("updates the complete eight-field maximum graph and Labels atomically, protects siblings and replays once", async () => {
    const created = await connected.seed("update147-maximum", { maximum: true }), id = idOf(created);
    const protectedRoot = await connected.seed("update147-protected", { maximum: true });
    const beforeRows = await connected.read(), before = await connected.snapshot(), host = await connected.prepare(), request = host.newRequestKey();
    const input = { id, location_id: "update147-absent-location", packed_at: stamp, shipped_at: stamp, delivered_at: stamp,
      marked_shipped_by: "marker147", created_by: "creator147", data: { introduced: { nested: [null, { after: true }] } },
      metadata: { changed: "after147" }, labels: labels("maximum") };
    const update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment"), manual = vi.spyOn(ManualFulfillmentService.prototype, "createFulfillment");
    try {
      let calls = 0;
      const result = await Effect.runPromise(host.run(request, input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })));
      expect(result).toMatchObject({ ...input, data: { preserved: { value: "update147-maximum" }, ...input.data },
        metadata: { witness: "update147-maximum", ...input.metadata } });
      expect(members(result, "items")).toEqual(members(created, "items")); expect(members(result, "labels")).toHaveLength(4);
      const actual = update.mock.results[0]; if (actual?.type !== "return") throw new Error("Missing actual native update result");
      expect(await actual.value).toEqual(result); expect(update).toHaveBeenCalledTimes(1); expect(manual).not.toHaveBeenCalled();
      const rows = await connected.read(), after = await connected.snapshot();
      expect(children(rows, id, "item")).toEqual(children(beforeRows, id, "item"));
      expect(rows.filter(row => row.id !== id && row.fulfillment_id !== id)).toEqual(beforeRows.filter(row => row.id !== id && row.fulfillment_id !== id));
      expect(rows.find(row => row.id === protectedRoot.id)).toEqual(beforeRows.find(row => row.id === protectedRoot.id));
      expect(children(rows, id, "label").map(row => row.id).sort()).toEqual(members(result, "labels").map(row => row.id).sort());
      const event = (objectName: string, action: string) => buildModuleResourceEventName({ prefix: "fulfillment", objectName, action });
      expect(eventsSince(before, after).map(value => value.envelope.contract)).toEqual([
        ...Array.from({ length: 4 }, () => event("fulfillment_label", "created")), event("fulfillment", "updated"),
        ...Array.from({ length: 4 }, () => event("fulfillment_label", "deleted")),
      ]);
      expect(after.commits.length - before.commits.length).toBe(1); expect(calls).toBeGreaterThan(0);
      expect(calls).toBeLessThanOrEqual(fulfillmentUpdateResources.calls);
      console.info("Fulfillment standalone update maximum", { calls, messages: eventsSince(before, after).length });
      expect(await Effect.runPromise(host.run(request, input))).toEqual(result); expect(update).toHaveBeenCalledTimes(1);
      expect(await connected.snapshot()).toEqual(after);
      await expect(Effect.runPromise(host.run(request, { ...input, created_by: "conflict147" }))).rejects.toMatchObject({ reason: "requestConflict" });
    } finally { update.mockRestore(); manual.mockRestore(); }
  }, 240_000);

  it.each(["data", "metadata"] as const)("uses whole %s preimages and native nested/null-array normalization", async field => {
    const original = { kept: "original147", nested: { kept: true, changed: "before147" }, list: [{ before: true }, null] };
    const created = await connected.seed("update147-json-" + field, { input: { [field]: original } }), id = idOf(created);
    const retrieve = vi.spyOn(FulfillmentModuleService.prototype, "retrieveFulfillment"), host = await connected.prepare();
    try {
      const value = { nested: { changed: "after147" }, list: [null, { after: true }] };
      const result = await Effect.runPromise(host.run(host.newRequestKey(), { id, [field]: value }));
      expect(retrieve.mock.calls[0]?.[1]).toEqual({ select: [field], relations: [] });
      expect(result[field]).toEqual({ kept: "original147", nested: field === "data" ? { kept: true, changed: "after147" } : value.nested, list: value.list });
      expect((await connected.read()).find(row => row.id === id)?.[field]).toEqual(result[field]);
    } finally { retrieve.mockRestore(); }
  }, 180_000);

  it.each(["data", "metadata"] as const)("preserves native %s introduced-key residual after authentic compensation", async field => {
    const original = { kept: "original147", changed: "before147" };
    const created = await connected.seed("update147-residual-" + field, { input: { [field]: original } }), id = idOf(created), tap = retainedTap();
    const update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment");
    try {
      const host = await connected.prepareWrapped({ retained: tap.get });
      const result = await Effect.runPromise(host.run(host.newRequestKey(), { id, [field]: { changed: "after147", introduced: "new147" } }));
      expect(result[field]).toEqual({ ...original, changed: "after147", introduced: "new147" });
      expect(tap.get()).toMatchObject({ id, [field]: original }); expect(update).toHaveBeenCalledTimes(2);
      expect((await connected.read()).find(row => row.id === id)?.[field]).toEqual({ ...original, introduced: "new147" });
    } finally { tap.restore(); update.mockRestore(); }
  }, 180_000);

  it.each([
    { field: "data", kind: "string", constructorValue: "own-string147" },
    { field: "data", kind: "object", constructorValue: { marker: "own-object147" } },
    { field: "metadata", kind: "string", constructorValue: "own-string147" },
    { field: "metadata", kind: "object", constructorValue: { marker: "own-object147" } },
  ] as const)("keeps actual native $field assignment for an own constructor $kind", async ({ field, constructorValue, kind }) => {
    const prior = { kept: "prior147", changed: "before147", nested: { retained: true } };
    const created = await connected.seed("update147-constructor-" + field + "-" + kind, { input: { [field]: prior } }), id = idOf(created);
    const patch = { constructor: constructorValue, changed: "after147" };
    // The native differential witness owns these expectations: data replaces,
    // while the original internal metadata merge retains its prior keys.
    const expected = field === "data" ? patch : { ...prior, ...patch };
    const host = await connected.prepare(), update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment");
    try {
      const result = await Effect.runPromise(host.run(host.newRequestKey(), { id, [field]: patch }));
      expect(update).toHaveBeenCalledTimes(1); expect(update.mock.calls[0]?.[0]).toBe(id);
      expect(jsonEqual(result[field] ?? null, expected)).toBe(true);
      const actual = update.mock.results[0]; if (actual?.type !== "return") throw new Error("Missing actual constructor JSON service result");
      const native = Schema.decodeUnknownSync(Schema.JsonObject)(await actual.value);
      expect(jsonEqual(native, result)).toBe(true);
      const stored = (await connected.read()).find(row => row.id === id);
      if (stored === undefined) throw new Error("Missing stored constructor JSON root");
      expect(jsonEqual(stored[field] ?? null, expected)).toBe(true);
    } finally { update.mockRestore(); }
  }, 180_000);

  it("refuses own __proto__ update JSON before either native method executes", async () => {
    const created = await connected.seed("update147-unsafe-json"), host = await connected.prepare();
    const unsafe: unknown = JSON.parse('{"__proto__":{"polluted147":true},"kept":"unsafe147"}');
    const update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment"), retrieve = vi.spyOn(FulfillmentModuleService.prototype, "retrieveFulfillment");
    try {
      for (const field of ["data", "metadata"] as const) {
        const before = await connected.snapshot();
        expect(Result.isFailure(await Effect.runPromise(Effect.result(Reflect.apply(host.run, host,
          [host.newRequestKey(), { id: idOf(created), [field]: unsafe }]))))).toBe(true);
        noMutation(before, await connected.snapshot());
      }
      expect(update).not.toHaveBeenCalled(); expect(retrieve).not.toHaveBeenCalled();
      expect(Object.prototype).not.toHaveProperty("polluted147");
    } finally { update.mockRestore(); retrieve.mockRestore(); }
  }, 180_000);

  it("retains native metadata empty-string removal and nullable JSON clearing", async () => {
    const created = await connected.seed("update147-null", { input: { data: { kept: true }, metadata: { removed: "before", kept: true } } });
    const host = await connected.prepare(), id = idOf(created);
    const removed = await Effect.runPromise(host.run(host.newRequestKey(), { id, metadata: { removed: "" } }));
    expect(removed.metadata).toEqual({ kept: true });
    const cleared = await Effect.runPromise(host.run(host.newRequestKey(), { id, data: null, metadata: null }));
    expect(cleared).toMatchObject({ data: null, metadata: null });
    expect((await connected.read()).find(row => row.id === id)).toMatchObject({ data: null, metadata: null });
  }, 180_000);

  it.each(["id-only", "undefined"] as const)("preserves the native %s reference DTO and original no-op inverse", async mode => {
    const created = await connected.seed("update147-empty-" + mode), id = idOf(created), tap = retainedTap();
    const retrieve = vi.spyOn(FulfillmentModuleService.prototype, "retrieveFulfillment"), update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment");
    try {
      const beforeRows = await connected.read(), host = await connected.prepareWrapped({ retained: tap.get });
      const input = mode === "undefined" ? { id, packed_at: undefined, created_by: undefined, data: undefined, metadata: undefined } : { id };
      // Explicit own undefined is outside optionalKey's authoring type. Enter
      // through the actual unknown boundary to observe native SDK omission.
      await Effect.runPromise(Reflect.apply(host.run, host, [host.newRequestKey(), input]));
      expect(retrieve.mock.calls[0]?.[1]).toEqual({ select: [], relations: [] });
      const retained = Schema.decodeUnknownSync(Schema.JsonObject)(tap.get());
      expect(Object.keys(retained).sort()).toEqual(["id", "provider", "provider_id", "shipping_option", "shipping_option_id", "delivery_address", "delivery_address_id"].sort());
      const { id: retainedId, ...references } = retained;
      const inverseCall = update.mock.calls[1];
      if (inverseCall === undefined) throw new Error("Missing actual native inverse call");
      expect(retainedId).toBe(id); expect(inverseCall.slice(0, 2)).toEqual([id, references]);
      // The authenticated module binding appends its actual native context.
      // Both names carry the same opaque manager identity for this call.
      const context: unknown = inverseCall[2];
      if (!isNonArrayRecord(context) || !isNonArrayRecord(context.manager)) throw new Error("Missing actual native manager context");
      expect(Object.keys(context).sort()).toEqual(["manager", "transactionManager"]);
      expect(context.manager).toBe(context.transactionManager);
      expect(Object.keys(context.manager)).toEqual([]);
      expect(await connected.read()).toEqual(beforeRows);
    } finally { tap.restore(); retrieve.mockRestore(); update.mockRestore(); }
  }, 180_000);

  it.each(["shipped_at", "delivered_at", "canceled_at"] as const)("permits ordinary dates and actors on a %s root without added guards", async state => {
    const created = await connected.seed("update147-state-" + state, { input: { [state]: oldStamp } }), id = idOf(created);
    const host = await connected.prepare();
    const result = await Effect.runPromise(host.run(host.newRequestKey(), { id, packed_at: stamp, shipped_at: null, delivered_at: null,
      marked_shipped_by: null, created_by: "actor147" }));
    expect(result).toMatchObject({ packed_at: stamp, shipped_at: null, delivered_at: null, marked_shipped_by: null, created_by: "actor147" });
    if (state === "canceled_at") expect(result.canceled_at).toBe(oldStamp);
  }, 180_000);

  it.each(["retain-one", "duplicate", "mixed", "empty"] as const)("restores complete original Label preimages after %s replacement", async mode => {
    const created = await connected.seed("update147-inverse-" + mode, { maximum: true }), id = idOf(created);
    const beforeRows = await connected.read(), originals = children(beforeRows, id, "label"), first = originals[0];
    if (first === undefined) throw new Error("Missing original Label");
    const tap = retainedTap(), update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment"), retrieve = vi.spyOn(FulfillmentModuleService.prototype, "retrieveFulfillment");
    try {
      const replacement = mode === "empty" ? [] : mode === "mixed" ? [{ id: idOf(first) }, ...labels("inverse-mixed", 3)]
        : mode === "duplicate" ? [{ id: idOf(first) }, { id: idOf(first) }] : [{ id: idOf(first) }];
      const host = await connected.prepareWrapped({ retained: tap.get }); let calls = 0;
      await Effect.runPromise(host.run(host.newRequestKey(), { id, labels: replacement }).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })));
      expect(retrieve.mock.calls[0]?.[1]).toEqual({ select: ["labels.*"], relations: ["labels"] });
      expect(update).toHaveBeenCalledTimes(2);
      const retained = Schema.decodeUnknownSync(Schema.JsonObject)(tap.get());
      expect(members(retained, "labels").map(row => row.id).sort()).toEqual(originals.map(row => row.id).sort());
      for (const row of members(retained, "labels")) expect(row).toHaveProperty("created_at");
      const afterRows = await connected.read(); expect(children(afterRows, id, "label")).toEqual(originals);
      expect(children(afterRows, id, "item")).toEqual(children(beforeRows, id, "item"));
      expect(afterRows.filter(row => row.id !== id && row.fulfillment_id !== id)).toEqual(beforeRows.filter(row => row.id !== id && row.fulfillment_id !== id));
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(fulfillmentUpdateResources.calls);
      console.info("Fulfillment standalone retained inverse", { mode, calls });
    } finally { tap.restore(); update.mockRestore(); retrieve.mockRestore(); }
  }, 240_000);

  it.each(["complete", "partial"] as const)("uses native %s existing Label normalization", async kind => {
    const created = await connected.seed("update147-member-" + kind), id = idOf(created), old = members(created, "labels")[0];
    if (old === undefined) throw new Error("Missing native Label");
    const host = await connected.prepare(), changed = labels("modified", 1)[0];
    if (changed === undefined) throw new Error("Missing updated Label content");
    const value = kind === "complete" ? { id: idOf(old), ...changed } : { id: idOf(old), tracking_url: changed.tracking_url };
    const result = await Effect.runPromise(host.run(host.newRequestKey(), { id, labels: [value] }));
    expect(members(result, "labels")).toEqual([expect.objectContaining({ ...old, ...value, updated_at: expect.any(String) })]);
  }, 180_000);

  it.each(["complete", "partial"] as const)("restores native %s active Label business changes through the authentic inverse", async kind => {
    const created = await connected.seed("update147-active-label-inverse-" + kind), id = idOf(created);
    const beforeRows = await connected.read(), originals = children(beforeRows, id, "label"), original = originals[0];
    if (original === undefined) throw new Error("Missing original active Label");
    const changed = labels("active-label-inverse-" + kind, 1)[0];
    if (changed === undefined) throw new Error("Missing active Label replacement content");
    const patch = kind === "complete" ? { id: idOf(original), ...changed } : { id: idOf(original), tracking_url: changed.tracking_url };
    const tap = retainedTap(), update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment");
    try {
      const host = await connected.prepareWrapped({ retained: tap.get });
      const result = await Effect.runPromise(host.run(host.newRequestKey(), { id, labels: [patch] }));
      expect(members(result, "labels")).toEqual([expect.objectContaining({ ...original, ...patch, updated_at: expect.any(String) })]);
      expect(update).toHaveBeenCalledTimes(2);
      const retained = Schema.decodeUnknownSync(Schema.JsonObject)(tap.get());
      expect(members(retained, "labels")).toEqual(originals);
      const { id: retainedId, ...inverse } = retained;
      expect(retainedId).toBe(id); expect(update.mock.calls[1]?.slice(0, 2)).toEqual([id, inverse]);
      const afterRows = await connected.read(), restored = children(afterRows, id, "label");
      // Native cases 54/55 restore IDs and business content, while the ORM
      // retains its managed updated_at result rather than the old timestamp.
      const business = (row: JsonObject) => { const { updated_at: _updatedAt, ...value } = row; return value; };
      expect(restored.map(business)).toEqual(originals.map(business));
      for (const row of restored) expect(row.updated_at).toEqual(expect.any(String));
      expect(children(afterRows, id, "item")).toEqual(children(beforeRows, id, "item"));
      expect(afterRows.filter(row => row.id !== id && row.fulfillment_id !== id)).toEqual(beforeRows.filter(row => row.id !== id && row.fulfillment_id !== id));
    } finally { tap.restore(); update.mockRestore(); }
  }, 240_000);

  it("repeats the genuine scalar inverse and atomically discards a late parent failure", async () => {
    const created = await connected.seed("update147-repeat"), id = idOf(created), tap = retainedTap();
    const update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment");
    try {
      const host = await connected.prepareWrapped({ retained: tap.get, repeat: true });
      await Effect.runPromise(host.run(host.newRequestKey(), { id, packed_at: stamp }));
      expect(update).toHaveBeenCalledTimes(3); expect((await connected.read()).find(row => row.id === id)?.packed_at).toBeNull();
    } finally { tap.restore(); update.mockRestore(); }
    const lateTap = retainedTap(), late = await connected.prepareWrapped({ retained: lateTap.get, lateFailure: true });
    try {
      const before = await connected.snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(late.run(late.newRequestKey(), { id, metadata: { introduced: true }, labels: labels("late") }))))).toBe(true);
      noMutation(before, await connected.snapshot());
    } finally { lateTap.restore(); }
  }, 240_000);

  it.each(["missing", "historical"] as const)("retains the genuine %s root retrieve error without publication", async kind => {
    const id = kind === "missing" ? "ful147-missing" : idOf(await connected.seed("update147-historical"));
    if (kind === "historical") await connected.arrangeUpdate("fulfillment", "softDelete", [{ id }]);
    const host = await connected.prepare(), before = await connected.snapshot(), retrieve = vi.spyOn(FulfillmentModuleService.prototype, "retrieveFulfillment");
    try {
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id, packed_at: stamp }))))).toBe(true);
      const observed = retrieve.mock.results[0]; if (observed?.type !== "return") throw new Error("Missing native retrieve refusal");
      await expect(observed.value).rejects.toMatchObject({ type: "not_found", message: `Fulfillment with id: ${id} was not found` });
      noMutation(before, await connected.snapshot());
    } finally { retrieve.mockRestore(); }
  }, 180_000);

  it.each(["missing", "historical", "foreign"] as const)("retains native %s Label-ID refusal without mutation", async kind => {
    const root = await connected.seed("update147-invalid-label-" + kind), id = idOf(root);
    const other = kind === "foreign" ? await connected.seed("update147-label-owner") : root;
    const member = members(other, "labels")[0]; if (member === undefined) throw new Error("Missing genuine Label");
    const labelId = kind === "missing" ? "fulla147-missing" : idOf(member);
    if (kind === "historical") await connected.arrangeUpdate("fulfillment_label", "softDelete", [{ id: labelId }]);
    const host = await connected.prepare(), before = await connected.snapshot(), update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment");
    try {
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id, labels: [{ id: labelId }] }))))).toBe(true);
      expect(update).toHaveBeenCalledTimes(1); noMutation(before, await connected.snapshot());
    } finally { update.mockRestore(); }
  }, 180_000);

  it("refuses cross-root Label reconstitution without the original deletion evidence", async () => {
    const created = await connected.seed("update147-cross-root"), id = idOf(created), tap = retainedTap();
    try {
      const host = await connected.prepare(); await Effect.runPromise(host.run(host.newRequestKey(), { id, labels: [] }));
      expect(children(await connected.read(), id, "label")).toEqual([]);
      const actual = tap.get(), inverse = await connected.prepareInverseOnly(() => actual), before = await connected.snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(inverse.run(inverse.newRequestKey(), null))))).toBe(true);
      noMutation(before, await connected.snapshot());
    } finally { tap.restore(); }
  }, 180_000);

  it("refuses changed business fields in the actual retained Label preimage", async () => {
    const created = await connected.seed("update147-forged-preimage"), id = idOf(created), tap = retainedTap();
    try {
      const host = await connected.prepareWrapped({ retained: () => {
        const actual = Schema.decodeUnknownSync(Schema.JsonObject)(tap.get());
        return { ...actual, labels: members(actual, "labels").map(row => ({ ...row, tracking_number: "forged147" })) };
      } }), before = await connected.snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id, labels: [] }))))).toBe(true);
      noMutation(before, await connected.snapshot());
    } finally { tap.restore(); }
  }, 180_000);

  it("rejects an event without a matching native mutation receipt", async () => {
    const created = await connected.seed("update147-event"), host = await connected.prepareWrapped({ forgeEvent: true }), before = await connected.snapshot();
    expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id: idOf(created), created_by: "real147" }))))).toBe(true);
    noMutation(before, await connected.snapshot());
  }, 180_000);

  it("keeps historical Option visibility independent from standalone update validation", async () => {
    const option = await connected.seedBareOption("update147-history-option", shippingOptionParents.zone);
    const root = await connected.seed("update147-history-option", { input: { shipping_option_id: option } }), id = idOf(root);
    await connected.arrangeUpdate("shipping_option", "softDelete", [{ id: option }]);
    const host = await connected.prepare(), before = await connected.read();
    const result = await Effect.runPromise(host.run(host.newRequestKey(), { id, created_by: "allowed147" }));
    expect(result.created_by).toBe("allowed147");
    expect((await connected.read()).find(row => row.id === id)?.shipping_option_id).toBe(before.find(row => row.id === id)?.shipping_option_id);
  }, 180_000);

  it.each([
    { historical: "option", mode: "id-only" }, { historical: "option", mode: "undefined" },
    { historical: "provider", mode: "id-only" }, { historical: "provider", mode: "undefined" },
    { historical: "address", mode: "id-only" }, { historical: "address", mode: "undefined" },
  ] as const)("preserves native reference-only $historical history through the $mode inverse", async ({ historical, mode }) => {
    const prefix = "update147-reference-history-" + historical + "-" + mode;
    const option = await connected.seedBareOption(prefix, shippingOptionParents.zone);
    const created = await connected.seed(prefix, { input: { shipping_option_id: option } }), id = idOf(created);
    const root = (await connected.read()).find(row => row.id === id);
    if (root === undefined) throw new Error("Missing reference history Fulfillment");
    const references = { provider: string(root.provider_id), option: string(root.shipping_option_id), address: string(root.delivery_address_id) };
    const tables = { option: "shipping_option", provider: "fulfillment_provider", address: "fulfillment_address" } as const;
    await connected.arrangeUpdate(tables[historical], "softDelete", [{ id: references[historical] }]);
    const tap = retainedTap(), retrieve = vi.spyOn(FulfillmentModuleService.prototype, "retrieveFulfillment"),
      update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment");
    try {
      const beforeRows = await connected.read(), before = await connected.snapshot(), host = await connected.prepareWrapped({ retained: tap.get });
      const input = mode === "undefined" ? { id, packed_at: undefined, created_by: undefined, data: undefined, metadata: undefined } : { id };
      await Effect.runPromise(Reflect.apply(host.run, host, [host.newRequestKey(), input]));
      expect(retrieve.mock.calls[0]?.[1]).toEqual({ select: [], relations: [] });
      // The original eight-case PostgreSQL witness distinguishes filtered
      // belongsTo nulls from omitted historical hasOne reference pairs.
      const expected = { id,
        ...(historical === "provider" ? {} : { provider: { id: references.provider }, provider_id: references.provider }),
        shipping_option: historical === "option" ? null : { id: references.option },
        shipping_option_id: historical === "option" ? null : references.option,
        ...(historical === "address" ? {} : { delivery_address: { id: references.address }, delivery_address_id: references.address }) };
      const retained = Schema.decodeUnknownSync(Schema.JsonObject)(tap.get());
      expect(retained).toEqual(expected); expect(update).toHaveBeenCalledTimes(2);
      const { id: retainedId, ...inverse } = retained;
      expect(retainedId).toBe(id); expect(update.mock.calls[1]?.slice(0, 2)).toEqual([id, inverse]);
      // Native inverse forwards that exact DTO yet leaves the physical owning
      // references intact. A filtered hasOne causes native root dirty tracking;
      // the historical belongsTo Option remains an ordinary no-op.
      const afterRows = await connected.read(), emitted = eventsSince(before, await connected.snapshot());
      if (historical === "option") {
        expect(afterRows).toEqual(beforeRows); expect(emitted).toEqual([]);
      } else {
        const omitRootUpdateTime = (row: JsonObject) => {
          if (row.id !== id) return row;
          const { updated_at: _updatedAt, ...remaining } = row; return remaining;
        };
        expect(afterRows.map(omitRootUpdateTime)).toEqual(beforeRows.map(omitRootUpdateTime));
        const oldRoot = beforeRows.find(row => row.id === id), currentRoot = afterRows.find(row => row.id === id);
        expect(currentRoot?.updated_at).toEqual(expect.any(String)); expect(currentRoot?.updated_at).not.toBe(oldRoot?.updated_at);
        const updatedEvent = buildModuleResourceEventName({ prefix: "fulfillment", objectName: "fulfillment", action: "updated" });
        expect(emitted.map(event => event.envelope.contract)).toEqual([updatedEvent, updatedEvent]);
        expect(emitted.map(event => event.envelope.message)).toEqual([
          expect.objectContaining({ data: { id } }), expect.objectContaining({ data: { id } }),
        ]);
      }
    } finally {
      tap.restore(); retrieve.mockRestore(); update.mockRestore();
      // The Manual provider is shared by genuine creation seeds in this fixture.
      if (historical === "provider") await connected.arrangeUpdate(tables.provider, "restore", [{ id: references.provider }]);
    }
  }, 240_000);

  it("exposes only selected frozen methods and revokes the borrowed retrieve capability", async () => {
    const created = await connected.seed("update147-authority"); let escaped: (() => Promise<unknown>) | undefined;
    const host = await connected.prepareWrapped({ escape: retrieve => { escaped = retrieve; }, inspectResources: value => {
      expect(value).not.toHaveProperty("manager"); expect(value).not.toHaveProperty("query"); expect(value).not.toHaveProperty("stockLocation");
      if (!isNonArrayRecord(value)) throw new Error("Missing selected resources");
      expect(Object.isFrozen(value)).toBe(true);
      const descriptor = Object.getOwnPropertyDescriptor(value, "fulfillment"), methods: unknown = descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
      if (!isNonArrayRecord(methods)) throw new Error("Missing selected methods");
      expect(Object.keys(methods)).toEqual(["retrieveFulfillment", "updateFulfillment"]); expect(Object.isFrozen(methods)).toBe(true);
    } });
    await Effect.runPromise(host.run(host.newRequestKey(), { id: idOf(created) }));
    if (escaped === undefined) throw new Error("Missing actual borrowed retrieve method");
    const before = await connected.snapshot(); await expect(escaped()).rejects.toMatchObject({ reason: "closed" }); noMutation(before, await connected.snapshot());
  }, 180_000);

  it.each([{ calls: 1 }, { eventMessages: 1 }])("refuses insufficient root budgets atomically: %j", async limits => {
    const created = await connected.seed("update147-budget"), host = await connected.prepareWrapped(limits), before = await connected.snapshot();
    expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id: idOf(created), labels: labels("budget") }))))).toBe(true);
    noMutation(before, await connected.snapshot());
  }, 180_000);

  it("refuses unknown/managed/reference fields, bad dates and Label overflow before native calls", async () => {
    const created = await connected.seed("update147-malformed"), id = idOf(created), host = await connected.prepare(), update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment");
    try {
      for (const input of [{ id, created_at: stamp }, { id, provider_id: "forged" }, { id, shipping_option_id: connected.option },
        { id, delivery_address_id: "forged" }, { id, packed_at: "invalid" }, { id, labels: labels("overflow", 5) },
        { id, items: [] }, { id, labels: [{ id: "x", created_at: stamp }] }]) {
        const before = await connected.snapshot();
        expect(Result.isFailure(await Effect.runPromise(Effect.result(Reflect.apply(host.run, host, [host.newRequestKey(), input]))))).toBe(true);
        noMutation(before, await connected.snapshot());
      }
      expect(update).not.toHaveBeenCalled();
    } finally { update.mockRestore(); }
  }, 180_000);

  it("refuses a forged native result through the causal receipt owner", async () => {
    const created = await connected.seed("update147-forged-result"), host = await connected.prepare(), original = FulfillmentModuleService.prototype.updateFulfillment;
    const update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const value = await original.call(this, ...args); return { ...value, created_by: "forged147" };
    });
    try {
      const before = await connected.snapshot();
      expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id: idOf(created), created_by: "real147" }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
      noMutation(before, await connected.snapshot());
    } finally { update.mockRestore(); }
  }, 180_000);
});
