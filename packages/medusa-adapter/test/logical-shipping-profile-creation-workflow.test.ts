import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { FulfillmentModuleService, FulfillmentProviderService } from "@medusajs/fulfillment/services";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { prepareShippingProfileCreationWorkflow } from "../src/workflows/fulfillment/create-shipping-profiles";
import { shippingProfileCreationResources } from "../src/workflow/policy";
import { prepareLogicalShippingProfileCreation, shippingProfileCreationGraphs as graph } from "./support/logical-shipping-profile-creation-fixture";
import { shippingProfileDeletionGraph, shippingProfileOptionParents } from "./support/logical-shipping-profile-deletion-fixture";
import { prepareShippingProfileOptionRaceFixture } from "./support/shipping-profile-option-race-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalShippingProfileCreation>>, sharedCleanupCount = 0, scopeOrdinal = 0;
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject)), text = Schema.decodeUnknownSync(Schema.String);
const input = (prefix: string) => ({ data: [
  { id: prefix + "-rich", name: prefix + " Native Name ", type: " Raw TYPE ", metadata: { nested: [true, null, { value: "kept" }] } },
  { name: prefix + " generated", type: "default" },
  { id: prefix + "-null", name: prefix + " null", type: "", metadata: null },
  { id: prefix + "-မြန်မာ", name: prefix + " မူရင်း", type: " MiXeD ", metadata: {} },
] });
type Inventory = Awaited<ReturnType<typeof connected.snapshot>>;
function newEvents(before: Inventory, after: Inventory) {
  const identity = (event: Inventory["events"][number]) => JSON.stringify([event.scopeUuid, event.epochUuid, event.commitSeq.toString(), event.eventOrdinal]);
  const previous = new Set(before.events.map(identity));
  const added = after.events.filter(event => !previous.has(identity(event)));
  expect(after.events).toHaveLength(before.events.length + added.length); return added;
}
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error) : reason._tag === "Die" ? reasons(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...reasons(value.cause)];
  return value instanceof Error ? [value.message, ...reasons(value.cause)] : [];
}
function retainedTap() {
  const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
  if (getter === undefined) throw new Error("Missing genuine SDK retained-response getter");
  const values: unknown[] = [];
  const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
    const value: unknown = Reflect.apply(getter, this, []); values.push(structuredClone(value)); return value;
  });
  return { get: () => { if (values.length !== 1) throw new Error("Expected exactly the genuine Profile retained value"); return values[0]; }, restore: () => spy.mockRestore() };
}
async function scenario(name: string, graphs: readonly ReturnType<typeof shippingProfileDeletionGraph>[] = []) {
  const ordinal = ++scopeOrdinal;
  return prepareLogicalShippingProfileCreation(driver, close => cleanup.push(close), graphs, { resource: connected.fixture.resource,
    fixtureIdentity: { deploymentId: "profile-create-" + name + "-" + ordinal, projectId: "profile-create-135", uuidOffset: 1_900_000 + ordinal * 10_000 } });
}

describe("genuine ShippingProfile creation and physical retained inverse", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalShippingProfileCreation(driver, close => cleanup.push(close)); sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("preserves native interleaved supplied-ID aliases, final metadata and one entity/event per identity", async () => {
    const local = await scenario("identity-alias"), host = await local.prepare(), before = await local.snapshot();
    const value = { data: [
      { id: "sp-identity-a", name: "first", type: "default", metadata: null },
      { id: "sp-identity-b", name: "second", type: "default" },
      { id: "sp-identity-a", name: "ignored", type: "ignored", metadata: { filled: true } },
    ] }, original = structuredClone(value);
    const output = rows(await Effect.runPromise(host.run(host.newRequestKey(), value)));
    expect(value).toEqual(original); expect(output.map(row => row.id)).toEqual(["sp-identity-a", "sp-identity-b", "sp-identity-a"]);
    expect(output[2]).toEqual(output[0]); expect(output[0]).toMatchObject({ name: "first", type: "default", metadata: { filled: true }, shipping_options: [] });
    expect(await local.read(["sp-identity-a", "sp-identity-b"])).toHaveLength(2);
    const events = newEvents(before, await local.snapshot()); expect(events).toHaveLength(2);
    const inverse = await local.prepareInverse();
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), output.map(row => text(row.id))));
    expect(await local.read(["sp-identity-a", "sp-identity-b"])).toEqual([]);
    expect(events.map(event => event.envelope.message)).toEqual(["sp-identity-a", "sp-identity-b"].map(id => expect.objectContaining({ data: { id } })));
  }, 240_000);

  it("creates the complete four-Profile native result, preserves metadata/defaults and replays exactly once", async () => {
    const value = input("sp-create-full"), original = structuredClone(value), host = await connected.prepare(), changed = await connected.prepare("e".repeat(64));
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingProfiles"), provider = vi.spyOn(FulfillmentProviderService.prototype, "getFulfillmentOptions");
    try {
      const before = await connected.snapshot(), key = host.newRequestKey(); let calls = 0;
      const output = rows(await Effect.runPromise(host.run(key, value).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }))));
      console.info("ShippingProfile complete creation BoundedRequest.enter", calls);
      expect(calls).toBeLessThanOrEqual(shippingProfileCreationResources.calls); expect(output.map(row => row.name)).toEqual(value.data.map(row => row.name));
      expect(output[0]).toMatchObject(value.data[0]!); expect(output[1]).toMatchObject({ id: expect.stringMatching(/^sp_/), metadata: null });
      expect(output[2]).toMatchObject({ type: "", metadata: null }); expect(output[3]).toMatchObject({ id: "sp-create-full-မြန်မာ", metadata: {} });
      for (const row of output) {
        expect(Object.keys(row).sort()).toEqual(["id", "name", "type", "metadata", "created_at", "updated_at", "deleted_at", "shipping_options"].sort());
        expect(row).toMatchObject({ shipping_options: [], created_at: expect.any(String), updated_at: expect.any(String), deleted_at: null });
        expect(row.created_at).toBe(row.updated_at);
      }
      expect(value).toEqual(original); expect(native).toHaveBeenCalledTimes(1); expect(provider).not.toHaveBeenCalled();
      const after = await connected.snapshot(), emitted = newEvents(before, after), ids = output.map(row => text(row.id));
      expect(emitted.map(event => event.envelope.contract)).toEqual(ids.map(() => "fulfillment.shipping-profile.created"));
      expect(emitted.map(event => event.envelope.internal)).toEqual(ids.map(() => true));
      expect(emitted.map(event => event.envelope.message)).toEqual(ids.map(id => expect.objectContaining({ data: { id } })));
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect(after.commits.length - before.commits.length).toBe(1); expect(after.rowChanges.length - before.rowChanges.length).toBe(4);
      expect(await connected.read(ids)).toEqual(output.map(({ shipping_options: _options, ...row }) => row).sort((a, b) => text(a.id).localeCompare(text(b.id))));
      expect(await Effect.runPromise(host.run(key, value))).toEqual(output); expect(native).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(host.run(key, { data: [] }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, value))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await connected.snapshot()).toEqual(after);
    } finally { native.mockRestore(); provider.mockRestore(); }
  }, 240_000);

  it("executes complete genuine root plus actual StepResponse retained physical inverse without a fabricated tombstone", async () => {
    const tap = retainedTap(), native = vi.spyOn(FulfillmentModuleService.prototype, "deleteShippingProfiles"),
      create = vi.spyOn(FulfillmentModuleService.prototype, "createShippingProfiles");
    try {
      const host = await connected.prepareRoundtrip(tap.get), before = await connected.snapshot(), key = host.newRequestKey(), value = input("sp-create-roundtrip"); let calls = 0;
      const output = rows(await Effect.runPromise(host.run(key, value).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }), Effect.ensuring(Effect.sync(() => console.info("ShippingProfile complete root plus actual retained inverse BoundedRequest.enter", calls))))));
      expect(calls).toBeLessThanOrEqual(shippingProfileCreationResources.calls); expect(output).toHaveLength(4);
      const ids = output.map(row => text(row.id)); expect(tap.get()).toEqual(ids); expect(native.mock.calls.map(call => call[0])).toEqual([ids]);
      expect(await connected.read(ids)).toEqual([]);
      const after = await connected.snapshot(), emitted = newEvents(before, after);
      expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.rowChanges).toEqual(before.rowChanges);
      expect(emitted.map(event => event.envelope.contract)).toEqual([...ids.map(() => "fulfillment.shipping-profile.created"), ...ids.map(() => "fulfillment.shipping-profile.deleted")]);
      expect(emitted.length).toBeLessThanOrEqual(shippingProfileCreationResources.eventMessages);
      expect(after.commits.length - before.commits.length).toBe(1);
      expect(await Effect.runPromise(host.run(key, value))).toEqual(output);
      expect(create).toHaveBeenCalledTimes(1); expect(native).toHaveBeenCalledTimes(1); expect(tap.get()).toEqual(ids);
      expect(await connected.snapshot()).toEqual(after);
    } finally { tap.restore(); native.mockRestore(); create.mockRestore(); }
  }, 240_000);

  it("retains empty native creation resolution and skips absent/empty retained inverse resolution", async () => {
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingProfiles"), remove = vi.spyOn(FulfillmentModuleService.prototype, "deleteShippingProfiles");
    try {
      const host = await connected.prepare(), before = await connected.snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { data: [] }))).toEqual([]); expect(native.mock.calls.map(call => call[0])).toEqual([[]]);
      const absent = await connected.prepareAbsentInverse(); expect(await Effect.runPromise(absent.run(absent.newRequestKey(), null))).toBeNull();
      expect(remove).not.toHaveBeenCalled(); const after = await connected.snapshot();
      expect(after.rows).toEqual(before.rows); expect(after.events).toEqual(before.events); expect(after.revisions).toEqual(before.revisions);
    } finally { native.mockRestore(); remove.mockRestore(); }
  }, 180_000);

  it("preserves ordinary insert semantics for active/historical IDs and active-name conflicts with atomic prefix rollback", async () => {
    const host = await connected.prepare();
    for (const id of [graph.existing.profiles[0]!, graph.historyProfile.profiles[0]!]) {
      const before = await connected.snapshot(), value = { data: [{ id: "prefix-" + id, name: "prefix-" + id, type: "default" },
        { id, name: "second-" + id, type: "default" }] };
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), value))))).toBe(true); expect(await connected.snapshot()).toEqual(before);
    }
    const before = await connected.snapshot(), activeName = graph.existing.profiles[0]!;
    const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { data: [
      { id: "sp-create-name-prefix", name: "name-prefix", type: "default" }, { id: "sp-create-name-conflict", name: activeName, type: "default" },
    ] })));
    expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
    if (Result.isFailure(result)) expect(reasons(result.failure)).toContain("invalidInput");
    const reused = rows(await Effect.runPromise(host.run(host.newRequestKey(), { data: [{ id: "sp-create-reuse-historical-name", name: graph.historyProfile.profiles[0]!, type: "default" }] })));
    expect(reused).toMatchObject([{ id: "sp-create-reuse-historical-name", deleted_at: null }]);
  }, 240_000);

  it("rejects managed/relationship fields and malformed first fields before entering native creation", async () => {
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingProfiles");
    try {
      const before = await connected.snapshot();
      for (const invalid of [{ data: Array(5).fill({ name: "Too many", type: "default" }) },
        ...["created_at", "updated_at", "deleted_at", "shipping_options", "foreign"].map(field => ({ data: [{ name: "Invalid", type: "default", [field]: null }] })),
        { data: [{ type: "default", metadata: [] }] }, { data: [{ name: null, type: 1 }] }, { data: [], extra: true }])
        await expect(Effect.runPromise(host.run(host.newRequestKey(), invalid))).rejects.toMatchObject({ reason: "invalidInput" });
      expect(native).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["historyOption", "historyProfile"] as const)("physically detaches %s references while preserving every other Option field and timestamp", async name => {
    const selected = graph[name], protectedIds = [...shippingProfileOptionParents.map(value => text(value.row.id)), ...graph.existing.profiles, ...graph.blocked.profiles, ...graph.blocked.optionIds];
    const host = await connected.prepareInverse(), beforeOptions = await connected.read(selected.optionIds), protectedRows = await connected.read(protectedIds), before = await connected.snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), selected.profiles))).toBeNull(); expect(await connected.read(selected.profiles)).toEqual([]);
    expect(await connected.read(selected.optionIds)).toEqual(beforeOptions.map(row => ({ ...row, shipping_profile_id: null })));
    const after = await connected.snapshot(), emitted = newEvents(before, after);
    expect(emitted.map(event => event.envelope.contract)).toEqual(["fulfillment.shipping-profile.deleted"]);
    expect(after.rowChanges.length - before.rowChanges.length).toBe(1 + selected.optionIds.length);
    expect(await connected.read(protectedIds)).toEqual(protectedRows);
  }, 180_000);

  it("retains genuine active Profile plus active Option business refusal without any detach publication", async () => {
    const host = await connected.prepareInverse(), native = vi.spyOn(FulfillmentModuleService.prototype, "deleteShippingProfiles");
    try {
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), graph.blocked.profiles)));
      expect(native).toHaveBeenCalledTimes(1); expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
      if (Result.isFailure(result)) expect(reasons(result.failure)).toContain("Cannot delete Shipping Profiles " + graph.blocked.profiles + " with associated Shipping Options. Delete Shipping Options first and try again.");
    } finally { native.mockRestore(); }
  }, 180_000);

  it("executes four physical Profile inverses across eight mixed-history Options under one settlement", async () => {
    const active = shippingProfileDeletionGraph("sp-create-mixed-active", 2, { optionsPerProfile: 2, deletedOptions: true });
    const historical = shippingProfileDeletionGraph("sp-create-mixed-history", 2, { optionsPerProfile: 2, deletedProfiles: true });
    const protectedGraph = shippingProfileDeletionGraph("sp-create-mixed-protected", 1, { optionsPerProfile: 1 });
    const fixture = await scenario("mixed", [active, historical, protectedGraph]), host = await fixture.prepareInverse(), ids = [...active.profiles, ...historical.profiles], optionIds = [...active.optionIds, ...historical.optionIds];
    const protectedIds = [...shippingProfileOptionParents.map(value => text(value.row.id)), ...protectedGraph.profiles, ...protectedGraph.optionIds];
    const beforeOptions = await fixture.read(optionIds), protectedRows = await fixture.read(protectedIds), before = await fixture.snapshot(); let calls = 0;
    expect(await Effect.runPromise(host.run(host.newRequestKey(), ids).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    }), Effect.ensuring(Effect.sync(() => console.info("ShippingProfile four physical inverse roots and eight mixed-history Options BoundedRequest.enter", calls)))))).toBeNull();
    expect(calls).toBeLessThanOrEqual(shippingProfileCreationResources.calls); expect(await fixture.read(ids)).toEqual([]);
    expect(await fixture.read(optionIds)).toEqual(beforeOptions.map(row => ({ ...row, shipping_profile_id: null })));
    const after = await fixture.snapshot(); expect(newEvents(before, after).map(event => event.envelope.contract)).toEqual(ids.map(() => "fulfillment.shipping-profile.deleted"));
    expect(after.rowChanges.length - before.rowChanges.length).toBe(12); expect(after.commits.length - before.commits.length).toBe(1);
    expect(await fixture.read(protectedIds)).toEqual(protectedRows);
  }, 240_000);

  it("keeps missing and raw duplicate physical requests bounded to actual deleted identities", async () => {
    const selected = shippingProfileDeletionGraph("sp-create-duplicates"), fixture = await scenario("duplicates", [selected]), host = await fixture.prepareInverse();
    const before = await fixture.snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), ["missing", ...selected.profiles, ...selected.profiles, "မရှိ"]))).toBeNull();
    expect(await fixture.read(selected.profiles)).toEqual([]); expect(newEvents(before, await fixture.snapshot())).toHaveLength(1);
    const after = await fixture.snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), ["missing"]))).toBeNull();
    const missing = await fixture.snapshot(); expect(newEvents(after, missing)).toEqual([]); expect(missing.rows).toEqual(after.rows);
  }, 180_000);

  it("rolls back a late failure after the genuine retained physical callback", async () => {
    const tap = retainedTap();
    try {
      const host = await connected.prepareRoundtrip(tap.get, true), before = await connected.snapshot();
      const outcome = await Effect.runPromiseExit(host.run(host.newRequestKey(), input("sp-create-late")));
      if (Exit.isSuccess(outcome)) throw new Error("Late genuine Profile retained inverse failure committed");
      expect(outcome.cause.reasons.filter(reason => Cause.isDieReason(reason) && reason.defect instanceof Error &&
        reason.defect.message === "Late genuine Profile retained inverse failure")).toHaveLength(1);
      expect(reasons(outcome.cause)).toContain("rollbackOnly");
      expect(await connected.snapshot()).toEqual(before);
    } finally { tap.restore(); }
    const selected = shippingProfileDeletionGraph("sp-create-late-detach", 1, { optionsPerProfile: 2, deletedOptions: true }), fixture = await scenario("late-detach", [selected]);
    const host = await fixture.prepareInverse(true), before = await fixture.snapshot();
    expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), selected.profiles))))).toBe(true);
    expect(await fixture.snapshot()).toEqual(before);
  }, 240_000);

  it("cancels after real physical deletion and detach planning without publishing or retaining usable native handles", async () => {
    const selected = shippingProfileDeletionGraph("sp-create-cancel-detach", 1, { optionsPerProfile: 2, deletedOptions: true });
    const fixture = await scenario("cancel-detach", [selected]), host = await fixture.prepareInverse();
    const reached = Deferred.makeUnsafe<void>(), finished = Deferred.makeUnsafe<void>(), original = FulfillmentModuleService.prototype.deleteShippingProfiles;
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const native = vi.spyOn(FulfillmentModuleService.prototype, "deleteShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await wait;
      await Effect.runPromise(Deferred.succeed(finished, undefined)); return output;
    });
    try {
      const before = await fixture.snapshot(), outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(host.newRequestKey(), selected.profiles));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(pending); return yield* Fiber.await(pending);
      })));
      expect(native).toHaveBeenCalledTimes(1); expect(Exit.isFailure(outcome)).toBe(true);
      if (Exit.isFailure(outcome)) expect(reasons(outcome.cause)).toContain("Interrupt");
      expect(await fixture.snapshot()).toEqual(before);
      if (escaped === undefined) throw new Error("Missing actual pending native Profile handle");
      await expect(escaped()).rejects.toBeDefined();
      finish?.(); await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000)));
      expect(await fixture.snapshot()).toEqual(before);
    } finally { finish?.(); native.mockRestore(); }
  }, 180_000);

  it("rolls back genuine staged creation when a trusted host lowers the request event allowance", async () => {
    // This uses the existing trusted host owner to lower its own allowance.
    // The named workflow and participant resource profile remain unchanged.
    const execution = { ...connected.execution,
      prepare: (composition: Parameters<typeof connected.execution.prepare>[0]) => connected.execution.prepare({ ...composition, requestEventLimit: 1 }) };
    const host = await Effect.runPromise(prepareShippingProfileCreationWorkflow({ ...connected.options, execution }));
    cleanup.push(() => Effect.runPromise(host.close));
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingProfiles"); let completedChanges = 0;
    try {
      const before = await connected.snapshot(), outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input("sp-create-event-budget")).pipe(
        Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => work.pipe(Effect.tap(() => Effect.sync(() => {
          if (name === "LogicalDocuments.relationalChange") completedChanges++;
        }))) }),
      )));
      expect(native).toHaveBeenCalledTimes(1); expect(completedChanges).toBeGreaterThan(0);
      expect(Result.isFailure(outcome)).toBe(true); if (Result.isFailure(outcome)) expect(reasons(outcome.failure)).toContain("limitExceeded");
      expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["scalar", "relation", "order"] as const)("refuses forged complete native %s creation results after actual inserts", async mode => {
    const original = FulfillmentModuleService.prototype.createShippingProfiles;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args);
      if (!Array.isArray(output) || output.length !== 4) throw new Error("Missing genuine four-Profile result");
      if (mode === "order") output.reverse();
      else { const row: unknown = output[0]; if (row === null || typeof row !== "object") throw new Error("Missing genuine Profile row");
        Reflect.set(row, mode === "scalar" ? "type" : "shipping_options", mode === "scalar" ? "forged" : [{ id: "invented" }]); }
      return output;
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input("sp-create-forged-" + mode)))))).toBe(true);
      expect(native).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("refuses forged workflow module identity and resource overrides during admission", async () => {
    const before = await connected.snapshot();
    for (const fulfillment of [{ ...connected.installed, module: { ...connected.fulfillment.workflow } },
      { ...connected.installed, logicalResources: { ...shippingProfileCreationResources, calls: 128 } }])
      expect(Result.isFailure(await Effect.runPromise(Effect.result(prepareShippingProfileCreationWorkflow({ ...connected.options, fulfillment }))))).toBe(true);
    expect(await connected.snapshot()).toEqual(before);
  });

  it.skipIf(driver !== "postgres")("settles one native creation with a concurrent global active Profile name", async () => {
    const fixture = await scenario("name-race"), left = await fixture.prepare(), right = await fixture.prepare(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const original = FulfillmentModuleService.prototype.createShippingProfiles; let arrivals = 0;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); if (++arrivals === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return output;
    });
    try {
      const before = await fixture.snapshot(), outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(left.run(left.newRequestKey(), { data: [{ id: "sp-create-name-race-a", name: "Shared Name", type: "default" }] }).pipe(Effect.timeout(45_000)));
        const second = yield* Effect.forkChild(right.run(right.newRequestKey(), { data: [{ id: "sp-create-name-race-b", name: "Shared Name", type: "default" }] }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000), Effect.ensuring(Deferred.succeed(release, undefined)));
        return [yield* Fiber.await(first), yield* Fiber.await(second)];
      })));
      expect(arrivals).toBe(2); expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1); expect(outcomes.filter(Exit.isFailure)).toHaveLength(1);
      expect(await fixture.read(["sp-create-name-race-a", "sp-create-name-race-b"])).toHaveLength(1);
      const after = await fixture.snapshot(); expect(after.commits.length - before.commits.length).toBe(1); expect(newEvents(before, after)).toHaveLength(1);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);

  it.skipIf(driver !== "postgres")("invalidates native empty Option validation when a canonical reference insertion commits", async () => {
    const fixture = await scenario("reference-race", [graph.race]), inverse = await fixture.prepareInverse(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const insertion = await prepareShippingProfileOptionRaceFixture({ fixture: fixture.fixture, logicalStorage: fixture.installed.logicalStorage,
      afterStaged: Effect.void, close: close => cleanup.push(close) });
    const option = shippingProfileDeletionGraph("sp-create-race", 1, { optionsPerProfile: 1 }).rows.find(value => value.table === "shipping_option")?.row;
    if (option === undefined) throw new Error("Missing canonical native Option reference");
    const original = FulfillmentModuleService.prototype.deleteShippingProfiles; let arrived = false;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "deleteShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); arrived = true; await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return output;
    });
    try {
      const before = await fixture.snapshot(), outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(inverse.run(inverse.newRequestKey(), graph.race.profiles).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* insertion.run(insertion.newRequestKey(), option).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        return yield* Fiber.await(pending);
      })));
      expect(arrived).toBe(true); expect(Exit.isFailure(outcome)).toBe(true); if (Exit.isFailure(outcome)) expect(reasons(outcome.cause)).toContain("writeConflict");
      const after = await fixture.snapshot(); expect(after.commits.length - before.commits.length).toBe(1); expect(newEvents(before, after)).toEqual([]);
      expect(await fixture.read(graph.race.profiles)).toHaveLength(1); expect(await fixture.read([text(option.id)])).toEqual([option]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);
});
