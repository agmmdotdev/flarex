import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { FulfillmentModuleService, FulfillmentProviderService } from "@medusajs/fulfillment/services";
import { buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { CommerceTransactionError, defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { makeLocalShippingProfileCommands } from "../src/modules/fulfillment/shipping-profile-service";
import { prepareShippingProfileUpdateWorkflow } from "../src/workflows/fulfillment/update-shipping-profiles";
import { prepareLogicalShippingProfileUpdate, shippingProfileUpdateSeed, shippingProfileSeedTime } from "./support/logical-shipping-profile-update-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalShippingProfileUpdate>>, sharedCleanupCount = 0;
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject)), text = Schema.decodeUnknownSync(Schema.String);
const ids = (values: readonly JsonObject[]) => values.map(row => text(row.id));
const maximum = ["sp_update_max_0", "sp_update_max_1", "sp_update_max_2", "sp_update_max_3"];
const seedIds = [...maximum, "sp_update_noop", "sp_update_metadata", "sp_update_inverse_object", "sp_update_inverse_null",
  "sp_update_failure", "sp_update_cancel", "sp_update_scope", "sp_update_race", "sp_update_protected"];
const initial = [...seedIds.map(id => shippingProfileUpdateSeed(id)), shippingProfileUpdateSeed("sp_update_deleted", null, true)];
const updated = buildModuleResourceEventName({ prefix: "fulfillment", objectName: "shipping_profile", action: "updated" });
const withoutUpdated = (row: JsonObject) => { const { updated_at: _updated, ...rest } = row; return rest; };
function failures(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? failures(reason.error)
    : reason._tag === "Die" ? failures(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...failures(value.cause)];
  return value instanceof Error ? [value.message, ...failures(value.cause)] : [];
}
function eventIds(events: Awaited<ReturnType<typeof connected.snapshot>>["events"]) {
  return events.flatMap(event => {
    expect(event.envelope.contract).toBe(updated); expect(event.envelope.internal).toBe(true);
    const message = event.envelope.message;
    if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing native ShippingProfile event data");
    return Schema.decodeUnknownSync(Schema.Array(Schema.String))(Array.isArray(message.data.id) ? message.data.id : [message.data.id]);
  });
}

describe("genuine ShippingProfile update workflow on shared logical storage", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalShippingProfileUpdate(driver, close => cleanup.push(close), initial); sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("updates the complete four-profile maximum with native metadata, complete DTOs/events and unchanged default limits", async () => {
    const host = await connected.prepare(), key = host.newRequestKey(), protectedBefore = await connected.read(["sp_update_protected", "sp_update_deleted"]);
    const input = { selector: { id: [...maximum].reverse() }, update: { type: " Mixed TYPE ", metadata: { changed: true, remove: "", nested: { replacement: true } } } };
    const originalInput = structuredClone(input), before = await connected.snapshot(); let calls = 0;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "updateShippingProfiles"), provider = vi.spyOn(FulfillmentProviderService.prototype, "getFulfillmentOptions");
    try {
      const output = rows(await Effect.runPromise(host.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }), Effect.ensuring(Effect.sync(() => console.info("ShippingProfile update maximum BoundedRequest.enter", calls))))));
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls);
      expect(ids(output)).toEqual(input.selector.id);
      for (const row of output) {
        expect(row).toMatchObject({ type: " Mixed TYPE ", name: " Original " + row.id + " ",
          metadata: { retained: true, changed: true, nested: { replacement: true } }, created_at: shippingProfileSeedTime, deleted_at: null });
        expect(row.updated_at).not.toBe(shippingProfileSeedTime);
        expect(Object.keys(row).sort()).toEqual(["id", "name", "type", "metadata", "created_at", "updated_at", "deleted_at"].sort());
      }
      expect(await connected.read(maximum)).toEqual([...output].sort((a, b) => text(a.id).localeCompare(text(b.id))));
      expect(await connected.read(["sp_update_protected", "sp_update_deleted"])).toEqual(protectedBefore); expect(input).toEqual(originalInput);
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      expect(eventIds(emitted)).toEqual(input.selector.id); expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect(after.rowChanges).toHaveLength(before.rowChanges.length + 4); expect(after.commits).toHaveLength(before.commits.length + 1);
      expect(native).toHaveBeenCalledTimes(1); expect(provider).not.toHaveBeenCalled();
      expect(await Effect.runPromise(host.run(key, input))).toEqual(output); expect(await connected.snapshot()).toEqual(after);
      await expect(Effect.runPromise(host.run(key, { selector: { id: [] }, update: {} }))).rejects.toMatchObject({ reason: "requestConflict" });
      const changed = await connected.prepare("8".repeat(64)); await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(native).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(after);
    } finally { native.mockRestore(); provider.mockRestore(); }
  }, 240_000);

  it("executes the full four-profile forward and genuine scalar inverse within one accepting root", async () => {
    const host = await connected.prepareRoundtrip(), beforeRows = await connected.read(maximum), before = await connected.snapshot(); let calls = 0;
    const inverse = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingProfiles");
    try {
      const result = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Array(Schema.JsonObject), preimages: Schema.Array(Schema.JsonObject) }))(
        await Effect.runPromise(host.run(host.newRequestKey(), { input: { selector: { id: [...maximum] }, update: { type: "Inverse temporary TYPE" } } }).pipe(
          Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)) }),
          Effect.ensuring(Effect.sync(() => console.info("ShippingProfile maximum forward plus native inverse BoundedRequest.enter", calls))),
        )));
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls);
      expect(result.output).toHaveLength(4); expect(result.output.every(row => row.type === "Inverse temporary TYPE")).toBe(true);
      expect(result.preimages).toEqual(beforeRows.map(row => ({ id: row.id, type: row.type })));
      expect((await connected.read(maximum)).map(withoutUpdated)).toEqual(beforeRows.map(withoutUpdated)); expect(inverse).toHaveBeenCalledTimes(1);
      const after = await connected.snapshot(); expect(eventIds(after.events.slice(before.events.length))).toEqual([...maximum, ...maximum]);
      expect(after.rowChanges).toHaveLength(before.rowChanges.length + 4);
    } finally { inverse.mockRestore(); }
  }, 240_000);

  it("preserves no-op timestamps and empty callbacks while same-value nonempty patches still update and emit", async () => {
    const host = await connected.prepare(), id = "sp_update_noop", [original] = await connected.read([id]);
    if (original === undefined) throw new Error("Missing no-op profile");
    const before = await connected.snapshot(), native = vi.spyOn(FulfillmentModuleService.prototype, "updateShippingProfiles");
    try {
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id }, update: {} }))).toEqual([original]);
      for (const selected of [[], ["sp_update_missing"], ["sp_update_deleted"]])
        expect(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: selected }, update: { type: "Ignored" } }))).toEqual([]);
      const noop = await connected.snapshot(); expect(noop.rows).toEqual(before.rows); expect(noop.revisions).toEqual(before.revisions);
      expect(noop.rowChanges).toEqual(before.rowChanges); expect(noop.events).toEqual(before.events); expect(native).toHaveBeenCalledTimes(4);
      const output = rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id }, update: { type: "Original TYPE" } })));
      expect(output.map(withoutUpdated)).toEqual([withoutUpdated(original)]); expect(output[0]?.updated_at).not.toBe(original.updated_at);
      const after = await connected.snapshot(); expect(eventIds(after.events.slice(noop.events.length))).toEqual([id]);
      expect(after.rowChanges).toHaveLength(noop.rowChanges.length + 1);
      const absent = await connected.prepareAbsentInverse(), inverse = vi.spyOn(FulfillmentModuleService.prototype, "upsertShippingProfiles");
      try { expect(await Effect.runPromise(absent.run(absent.newRequestKey(), null))).toBeNull(); expect(inverse).not.toHaveBeenCalled(); }
      finally { inverse.mockRestore(); }
    } finally { native.mockRestore(); }
  }, 240_000);

  it("retains raw missing/duplicate selector semantics and does not trim name/type strings", async () => {
    const host = await connected.prepare(), selection = [maximum[1]!, maximum[0]!, maximum[1]!, "sp_update_missing"];
    const output = rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: selection }, update: { type: " Raw Case TYPE " } })));
    expect(ids(output)).toEqual(selection.slice(0, 2)); expect(output.every(row => row.type === " Raw Case TYPE ")).toBe(true);
    const named = rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: "sp_update_noop" }, update: { name: " Spaced Case Name " } })));
    expect(named[0]?.name).toBe(" Spaced Case Name ");
    const empty = rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: "sp_update_noop" }, update: { name: "", type: "" } })));
    expect(empty[0]).toMatchObject({ name: "", type: "" });
  }, 180_000);

  it("preserves native metadata merge, empty-string deletion, empty-object clearing and null clearing", async () => {
    const host = await connected.prepare(), id = "sp_update_metadata";
    const merged = rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id }, update: { metadata: { remove: "", new_key: 1, nested: { new: true } } } })));
    expect(merged[0]?.metadata).toEqual({ retained: true, new_key: 1, nested: { new: true } });
    expect(rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id }, update: { metadata: {} } })))[0]?.metadata).toEqual({});
    expect(rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id }, update: { metadata: null } })))[0]?.metadata).toBeNull();
  }, 180_000);

  it("keeps native projected metadata inverse caveats and restores a captured metadata value through the genuine null-patch inverse", async () => {
    const host = await connected.prepare(), probe = await connected.prepareRoundtrip();
    for (const [id, prior] of [["sp_update_inverse_object", { previous: true }], ["sp_update_inverse_null", null]] as const) {
      await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id }, update: { metadata: null } }));
      if (prior !== null) await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id }, update: { metadata: prior } }));
      const before = await connected.snapshot();
      const result = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Array(Schema.JsonObject), preimages: Schema.Array(Schema.JsonObject) }))(
        await Effect.runPromise(probe.run(probe.newRequestKey(), { input: { selector: { id }, update: { metadata: { added: true } } } })));
      expect(result.preimages).toEqual([{ id }]);
      expect((await connected.read([id]))[0]?.metadata).toEqual({ ...prior, added: true });
      expect(eventIds((await connected.snapshot()).events.slice(before.events.length))).toEqual([id]);
    }
    const id = "sp_update_inverse_object", [prior] = await connected.read([id]);
    if (prior === undefined) throw new Error("Missing inverse metadata profile");
    const result = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Array(Schema.JsonObject), preimages: Schema.Array(Schema.JsonObject) }))(
      await Effect.runPromise(probe.run(probe.newRequestKey(), { input: { selector: { id }, update: { metadata: null } } })));
    expect(result.output[0]?.metadata).toBeNull(); expect(result.preimages).toEqual([{ id, metadata: prior.metadata }]);
    expect((await connected.read([id]))[0]?.metadata).toEqual(prior.metadata);
    const empty = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Array(Schema.JsonObject), preimages: Schema.Array(Schema.JsonObject) }))(
      await Effect.runPromise(probe.run(probe.newRequestKey(), { input: { selector: { id }, update: { metadata: {} } } })));
    expect(empty.preimages).toEqual([{ id }]); expect((await connected.read([id]))[0]?.metadata).toEqual({});
  }, 240_000);

  it("rolls back a shared-name collision and a late failure after the genuine forward/inverse", async () => {
    const host = await connected.prepare(), before = await connected.snapshot();
    const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: { id: maximum.slice(0, 2) }, update: { name: "One active name cannot belong to two profiles" } })));
    expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
    const probe = await connected.prepareRoundtrip(), failed = await Effect.runPromise(Effect.result(probe.run(probe.newRequestKey(), {
      fail: true, input: { selector: { id: "sp_update_failure" }, update: { type: "Temporary before rollback", metadata: { pending: true } } },
    })));
    expect(Result.isFailure(failed)).toBe(true); if (Result.isFailure(failed)) expect(failures(failed.failure)).toContain("Late native ShippingProfile inverse failure");
    expect(await connected.snapshot()).toEqual(before);
  }, 240_000);

  it.each(["order", "membership", "scalar", "event"] as const)("refuses a forged native %s after real updates ran", async mode => {
    const host = await connected.prepare(), original = FulfillmentModuleService.prototype.updateShippingProfiles; let forged = false;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "updateShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await original.call(this, ...args);
      if (!Array.isArray(result) || result.length !== 2) throw new Error("Missing genuine two-profile result");
      const first: unknown = result[0]; if (typeof first !== "object" || first === null) throw new Error("Missing complete native profile");
      if (mode === "order") result.reverse();
      else if (mode === "membership") Reflect.set(first, "id", "sp_update_protected");
      else if (mode === "scalar") Reflect.set(first, "type", "Forged output without matching mutation");
      else {
        const bus: unknown = Reflect.get(this, "eventBusModuleService_");
        if (typeof bus !== "object" || bus === null) throw new Error("Missing genuine native bus");
        const emit: unknown = Reflect.get(bus, "emit"); if (typeof emit !== "function") throw new Error("Missing genuine native emitter");
        await Reflect.apply(emit, bus, [[{ name: updated, data: { id: "sp_update_protected" },
          metadata: { source: "fulfillment", object: "shipping_profile", action: "updated" } }], { internal: true }]);
      }
      forged = true; return result;
    });
    try {
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), {
        selector: { id: maximum.slice(0, 2) }, update: { type: "Genuine staged profile value" },
      })));
      expect(forged).toBe(true); expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("keeps caught sibling denial fatal and rejects the escaped native continuation", async () => {
    const host = await connected.prepare(), original = FulfillmentModuleService.prototype.updateShippingProfiles;
    let caught = false, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "updateShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await original.call(this, ...args); escaped = () => original.call(this, ...args);
      try { await this.createShippingProfiles({ name: "Denied sibling creation", type: "default" }); } catch { caught = true; } return result;
    });
    try {
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: { id: "sp_update_failure" }, update: { type: "Poisoned" } })));
      expect(caught).toBe(true); expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
      if (escaped === undefined) throw new Error("Missing retained native continuation"); await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("authenticates the installed update profile and rejects managed writes before native work", async () => {
    const creation = await Effect.runPromise(makeLocalShippingProfileCommands());
    const invalid = await Effect.runPromise(Effect.result(prepareShippingProfileUpdateWorkflow({ ...connected.options, fulfillment: {
      ...connected.installed,
      // @ts-expect-error Authentic creation profile intentionally lacks native update methods.
      module: creation.workflow,
    } })));
    expect(invalid).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    const forged = await Effect.runPromise(Effect.result(prepareShippingProfileUpdateWorkflow({ ...connected.options, fulfillment: {
      ...connected.installed, module: { ...connected.fulfillment.workflow },
    } })));
    expect(forged).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "updateShippingProfiles");
    try {
      const before = await connected.snapshot();
      for (const input of [
        { selector: {}, update: {} }, { selector: { id: [...maximum, "fifth"] }, update: {} },
        { selector: { id: "sp_update_failure" }, update: { created_at: shippingProfileSeedTime } },
        { selector: { id: "sp_update_failure" }, update: { shipping_options: [] } },
      ]) {
        // @ts-expect-error Deliberately exercise malformed public input at its runtime decoder.
        expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))).toBe(true);
      }
      expect(native).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("rolls back cancelled native work and revokes the callback that was still awaiting completion", async () => {
    const host = await connected.prepare(), original = FulfillmentModuleService.prototype.updateShippingProfiles, reached = Deferred.makeUnsafe<void>();
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "updateShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await original.call(this, ...args); escaped = () => original.call(this, ...args);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    try {
      const before = await connected.snapshot();
      await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { selector: { id: "sp_update_cancel" }, update: { type: "Cancelled profile" } }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      }));
      expect(await connected.snapshot()).toEqual(before); finish?.();
      if (escaped === undefined) throw new Error("Missing revoked native callback"); await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(before);
    } finally { finish?.(); native.mockRestore(); }
  }, 180_000);

  it("confines equal profile IDs and request keys to their accepted scope", async () => {
    const id = "sp_update_scope", other = await prepareLogicalShippingProfileUpdate(driver, close => cleanup.push(close), [shippingProfileUpdateSeed(id)], {
      resource: connected.fixture.resource, fixtureIdentity: { deploymentId: "shipping_profile_update_b", projectId: "shipping_profile_update_b", uuidOffset: 760_000 },
    });
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey(), beforeOther = await other.read([id]);
    const input = { selector: { id }, update: { type: "Scoped profile type" } };
    await Effect.runPromise(left.run(key, input)); expect(await other.read([id])).toEqual(beforeOther);
    await Effect.runPromise(right.run(key, input)); expect((await other.read([id]))[0]?.type).toBe("Scoped profile type");
    const settled = await connected.snapshot(); await Effect.runPromise(left.run(key, input)); await Effect.runPromise(right.run(key, input)); expect(await connected.snapshot()).toEqual(settled);
  }, 240_000);

  it.skipIf(driver !== "postgres")("observes two overlapping optimistic native updates and settles one winner without lost state", async () => {
    const left = await connected.prepare(), right = await connected.prepare(), id = "sp_update_race";
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), original = FulfillmentModuleService.prototype.updateShippingProfiles; let arrivals = 0;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "updateShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await original.call(this, ...args); arrivals++; if (arrivals === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return result;
    });
    try {
      const before = await connected.snapshot();
      const outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(left.run(left.newRequestKey(), { selector: { id }, update: { type: "Optimistic first" } }).pipe(Effect.timeout(45_000)));
        const second = yield* Effect.forkChild(right.run(right.newRequestKey(), { selector: { id }, update: { type: "Optimistic second" } }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000), Effect.ensuring(Deferred.succeed(release, undefined)));
        return [yield* Fiber.await(first), yield* Fiber.await(second)];
      })));
      const winners = outcomes.filter(Exit.isSuccess), rejected = outcomes.filter(Exit.isFailure);
      expect(arrivals).toBe(2); expect(winners).toHaveLength(1); expect(rejected).toHaveLength(1); expect(failures(rejected[0]?.cause)).toContain("writeConflict");
      const winner = rows(winners[0]?.value); expect(await connected.read([id])).toEqual(winner);
      const after = await connected.snapshot(); expect(after.commits).toHaveLength(before.commits.length + 1);
      expect(after.rowChanges).toHaveLength(before.rowChanges.length + 1); expect(eventIds(after.events.slice(before.events.length))).toEqual([id]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 180_000);
});
