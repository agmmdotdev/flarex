import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { FulfillmentModuleService, FulfillmentProviderService } from "@medusajs/fulfillment/services";
import { CommerceTransactionError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { defineAtomicCommerceNativeSource } from "../../persistence-postgres/src/frameworks/atomicCommerce/nativeSelection";
import { compileShippingProfileCoreDefinition } from "../src/modules/fulfillment/shipping-profile-schema";
import { prepareShippingProfileCreationWorkflow } from "../src/workflows/fulfillment/create-shipping-profiles";
import { prepareCoreShippingProfileCreation, shippingProfileCreationGraphs as graph } from "./support/core-shipping-profile-creation-fixture";
import { expectCheckoutRollback, expectCheckoutSettlement } from "./support/core-checkout-evidence";
import { finishOrderFixture } from "./support/core-order-fixture";
import { shippingProfileDeletionGraph, shippingProfileOptionParents } from "./support/shipping-profile-seeds";
import { prepareCoreShippingProfileOptionRaceFixture } from "./support/shipping-profile-option-race-fixture";
import { expectWorkflowDefect, expectWorkflowTypedFailures } from "./support/workflow-failure-assertions";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreShippingProfileCreation>>, sharedCleanupCount = 0;
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject)), text = Schema.decodeUnknownSync(Schema.String);
const input = (prefix: string) => ({ data: [
  { id: prefix + "-rich", name: prefix + " Native Name ", type: " Raw TYPE ", metadata: { nested: [true, null, { value: "kept" }] } },
  { name: prefix + " generated", type: "default" },
  { id: prefix + "-null", name: prefix + " null", type: "", metadata: null },
  { id: prefix + "-မြန်မာ", name: prefix + " မူရင်း", type: " MiXeD ", metadata: {} },
] });
type Inventory = Awaited<ReturnType<typeof connected.snapshot>>;
const newEvents = (before: Inventory, after: Inventory) => after.events.slice(before.events.length);
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
const scenario = (graphs: readonly ReturnType<typeof shippingProfileDeletionGraph>[] = []) =>
  prepareCoreShippingProfileCreation(driver, close => cleanup.push(close), graphs, connected.fixture.physical);

describe("genuine ShippingProfile creation and physical retained inverse", { concurrent: false }, () => {
  beforeAll(async () => {
    connected = await prepareCoreShippingProfileCreation(driver, close => cleanup.push(close));
    sharedCleanupCount = cleanup.length;
  }, 240_000);
  afterEach(() => finishOrderFixture([...cleanup.splice(sharedCleanupCount).reverse(), connected.closeCaseHosts]), 120_000);
  afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);

  it("preserves native interleaved supplied-ID aliases, final metadata and one entity/event per identity", async () => {
    const local = await scenario(), host = await local.prepare(), before = await local.snapshot(), key = host.newRequestKey();
    const value = { data: [
      { id: "sp-identity-a", name: "first", type: "default", metadata: null },
      { id: "sp-identity-b", name: "second", type: "default" },
      { id: "sp-identity-a", name: "ignored", type: "ignored", metadata: { filled: true } },
    ] }, original = structuredClone(value);
    const output = rows(await Effect.runPromise(host.run(key, value)));
    expect(value).toEqual(original); expect(output.map(row => row.id)).toEqual(["sp-identity-a", "sp-identity-b", "sp-identity-a"]);
    expect(output[2]).toEqual(output[0]); expect(output[0]).toMatchObject({ name: "first", type: "default", metadata: { filled: true }, shipping_options: [] });
    expect(await local.read(["sp-identity-a", "sp-identity-b"])).toHaveLength(2);
    const after = await local.snapshot(), timestamp = expectCheckoutSettlement(before, after, key);
    const events = newEvents(before, after);
    expect(events).toHaveLength(2);
    expect(after.revisions.filter(revision => revision.timestamp === timestamp).map(revision => revision.value?.id).sort())
      .toEqual(["sp-identity-a", "sp-identity-b"]);
    const inverse = await local.prepareInverse();
    const inverseKey = inverse.newRequestKey();
    await Effect.runPromise(inverse.run(inverseKey, output.map(row => text(row.id))));
    const undone = await local.snapshot(), inverseTimestamp = expectCheckoutSettlement(after, undone, inverseKey);
    expect(undone.revisions.filter(revision => revision.timestamp === inverseTimestamp)).toMatchObject([
      { previous: timestamp, deleted: true, value: null }, { previous: timestamp, deleted: true, value: null },
    ]);
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
      expect(calls).toBeGreaterThan(0);
      expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls); expect(output.map(row => row.name)).toEqual(value.data.map(row => row.name));
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
      const timestamp = expectCheckoutSettlement(before, after, key);
      const created = after.revisions.filter(revision => revision.timestamp === timestamp);
      expect(created).toHaveLength(4);
      for (const entry of created) {
        expect(entry).toMatchObject({ previous: null, deleted: false });
        expect(after.indexes).toContainEqual(expect.objectContaining({ table: entry.table, id: entry.id, name: "by_id", timestamp }));
      }
      expect(await connected.read(ids)).toEqual(output.map(({ shipping_options: _options, ...row }) => row).sort((a, b) => text(a.id).localeCompare(text(b.id))));
      expect(await Effect.runPromise(host.run(key, value))).toEqual(output); expect(native).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(host.run(key, { data: [] }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, value))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await connected.snapshot()).toEqual(after);
    } finally { native.mockRestore(); provider.mockRestore(); }
  }, 240_000);

  it("executes the genuine retained physical inverse and publishes only tombstones for the four Profile identities", async () => {
    const tap = retainedTap(), native = vi.spyOn(FulfillmentModuleService.prototype, "deleteShippingProfiles"),
      create = vi.spyOn(FulfillmentModuleService.prototype, "createShippingProfiles");
    try {
      const host = await connected.prepareRoundtrip(tap.get), before = await connected.snapshot(), key = host.newRequestKey(), value = input("sp-create-roundtrip"); let calls = 0;
      const output = rows(await Effect.runPromise(host.run(key, value).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }))));
      expect(calls).toBeGreaterThan(0);
      expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls); expect(output).toHaveLength(4);
      const ids = output.map(row => text(row.id)); expect(tap.get()).toEqual(ids); expect(native.mock.calls.map(call => call[0])).toEqual([ids]);
      expect(await connected.read(ids)).toEqual([]);
      const after = await connected.snapshot(), emitted = newEvents(before, after);
      const timestamp = expectCheckoutSettlement(before, after, key);
      const profileTable = connected.definition.tables.find(table => table.localName === "shipping_profile");
      if (profileTable === undefined) throw new Error("Missing issued ShippingProfile table");
      const tombstones = after.revisions.filter(revision => revision.timestamp === timestamp);
      expect(tombstones).toHaveLength(4);
      expect(new Set(tombstones.map(revision => revision.id)).size).toBe(4);
      for (const revision of tombstones)
        expect(revision).toMatchObject({ table: profileTable.name, previous: null, deleted: true, value: null });
      expect(after.rows).toEqual(before.rows); expect(after.indexes).toEqual(before.indexes);
      expect(emitted.map(event => event.envelope.contract)).toEqual([...ids.map(() => "fulfillment.shipping-profile.created"), ...ids.map(() => "fulfillment.shipping-profile.deleted")]);
      expect(emitted.length).toBeLessThanOrEqual(defaultCommerceResources.eventMessages);
      expect(await Effect.runPromise(host.run(key, value))).toEqual(output);
      expect(create).toHaveBeenCalledTimes(1); expect(native).toHaveBeenCalledTimes(1); expect(tap.get()).toEqual(ids);
      expect(await connected.snapshot()).toEqual(after);
      const recreate = await connected.prepare();
      const [original] = value.data;
      if (original === undefined) throw new Error("Missing supplied native Profile identity");
      expect(rows(await Effect.runPromise(recreate.run(recreate.newRequestKey(), { data: [original] }))))
        .toMatchObject([{ id: original.id, name: original.name }]);
    } finally { tap.restore(); native.mockRestore(); create.mockRestore(); }
  }, 240_000);

  it("retains empty native creation resolution and skips absent/empty retained inverse resolution", async () => {
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingProfiles"), remove = vi.spyOn(FulfillmentModuleService.prototype, "deleteShippingProfiles");
    try {
      const host = await connected.prepare(), before = await connected.snapshot(), createKey = host.newRequestKey();
      expect(await Effect.runPromise(host.run(createKey, { data: [] }))).toEqual([]); expect(native.mock.calls.map(call => call[0])).toEqual([[]]);
      const absent = await connected.prepareAbsentInverse(), inverseKey = absent.newRequestKey();
      expect(await Effect.runPromise(absent.run(inverseKey, null))).toBeNull();
      expect(remove).not.toHaveBeenCalled(); const after = await connected.snapshot();
      expect(after.outcomes.slice(before.outcomes.length)).toMatchObject([
        { value: { key: createKey, kind: "nativeRoot", state: "committed" } },
        { value: { key: inverseKey, kind: "nativeRoot", state: "committed" } },
      ]);
      expect({ ...after, outcomes: before.outcomes }).toEqual(before);
    } finally { native.mockRestore(); remove.mockRestore(); }
  }, 180_000);

  it("preserves ordinary insert semantics for active/historical IDs and active-name conflicts with atomic prefix rollback", async () => {
    const host = await connected.prepare();
    for (const id of [graph.existing.profiles[0]!, graph.historyProfile.profiles[0]!]) {
      const before = await connected.fixture.inventory(), key = host.newRequestKey(), value = { data: [{ id: "prefix-" + id, name: "prefix-" + id, type: "default" },
        { id, name: "second-" + id, type: "default" }] };
      const result = await Effect.runPromise(Effect.result(host.run(key, value)));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(reasons(result.failure)).toContain("invalidInput");
      await expectCheckoutRollback(connected.fixture, before, key);
    }
    const before = await connected.fixture.inventory(), activeName = graph.existing.profiles[0]!, key = host.newRequestKey();
    const result = await Effect.runPromise(Effect.result(host.run(key, { data: [
      { id: "sp-create-name-prefix", name: "name-prefix", type: "default" }, { id: "sp-create-name-conflict", name: activeName, type: "default" },
    ] })));
    expect(Result.isFailure(result)).toBe(true);
    await expectCheckoutRollback(connected.fixture, before, key);
    if (Result.isFailure(result)) expect(reasons(result.failure)).toContain("invalidInput");
    const reused = rows(await Effect.runPromise(host.run(host.newRequestKey(), { data: [{ id: "sp-create-reuse-historical-name", name: graph.historyProfile.profiles[0]!, type: "default" }] })));
    expect(reused).toMatchObject([{ id: "sp-create-reuse-historical-name", deleted_at: null }]);
  }, 240_000);

  it("rejects managed/relationship fields and malformed first fields before entering native creation", async () => {
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingProfiles");
    try {
      for (const invalid of [{ data: Array(5).fill({ name: "Too many", type: "default" }) },
        ...["created_at", "updated_at", "deleted_at", "shipping_options", "foreign"].map(field => ({ data: [{ name: "Invalid", type: "default", [field]: null }] })),
        { data: [{ type: "default", metadata: [] }] }, { data: [{ name: null, type: 1 }] }, { data: [], extra: true }]) {
        const before = await connected.fixture.inventory(), key = host.newRequestKey();
        await expect(Effect.runPromise(host.run(key, invalid))).rejects.toMatchObject({ reason: "invalidInput" });
        await expectCheckoutRollback(connected.fixture, before, key);
      }
      expect(native).not.toHaveBeenCalled();
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["historyOption", "historyProfile"] as const)("physically detaches %s references while preserving every other Option field and timestamp", async name => {
    const selected = graph[name], protectedIds = [...shippingProfileOptionParents.map(value => text(value.row.id)), ...graph.existing.profiles, ...graph.blocked.profiles, ...graph.blocked.optionIds];
    const host = await connected.prepareInverse(), beforeOptions = await connected.read(selected.optionIds), protectedRows = await connected.read(protectedIds),
      before = await connected.snapshot(), key = host.newRequestKey();
    expect(await Effect.runPromise(host.run(key, selected.profiles))).toBeNull(); expect(await connected.read(selected.profiles)).toEqual([]);
    expect(await connected.read(selected.optionIds)).toEqual(beforeOptions.map(row => ({ ...row, shipping_profile_id: null })));
    const after = await connected.snapshot(), emitted = newEvents(before, after);
    expect(emitted.map(event => event.envelope.contract)).toEqual(["fulfillment.shipping-profile.deleted"]);
    const timestamp = expectCheckoutSettlement(before, after, key);
    const revisions = after.revisions.filter(revision => revision.timestamp === timestamp);
    expect(revisions).toHaveLength(1 + selected.optionIds.length);
    const profile = before.revisions.find(row => row.value !== null && selected.profiles.includes(text(row.value.id)));
    if (profile === undefined) throw new Error("Missing seeded Profile before physical deletion");
    expect(revisions.find(revision => revision.table === profile.table && revision.id === profile.id))
      .toMatchObject({ previous: profile.timestamp, deleted: true, value: null });
    expect(after.indexes.some(index => index.table === profile.table && index.id === profile.id)).toBe(false);
    for (const option of before.revisions.filter(row => row.value !== null && selected.optionIds.includes(text(row.value.id)))) {
      const detached = revisions.find(revision => revision.table === option.table && revision.id === option.id);
      expect(detached).toMatchObject({ previous: option.timestamp, deleted: false, value: { shipping_profile_id: null } });
    }
    expect(await connected.read(protectedIds)).toEqual(protectedRows);
  }, 180_000);

  it("retains genuine active Profile plus active Option business refusal without any detach publication", async () => {
    const host = await connected.prepareInverse(), native = vi.spyOn(FulfillmentModuleService.prototype, "deleteShippingProfiles");
    try {
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      const result = await Effect.runPromise(Effect.result(host.run(key, graph.blocked.profiles)));
      expect(native).toHaveBeenCalledTimes(1); expect(Result.isFailure(result)).toBe(true);
      await expectCheckoutRollback(connected.fixture, before, key);
      if (Result.isFailure(result)) expect(reasons(result.failure)).toContain("Cannot delete Shipping Profiles " + graph.blocked.profiles + " with associated Shipping Options. Delete Shipping Options first and try again.");
    } finally { native.mockRestore(); }
  }, 180_000);

  it("executes four physical Profile inverses across eight mixed-history Options under one settlement", async () => {
    const active = shippingProfileDeletionGraph("sp-create-mixed-active", 2, { optionsPerProfile: 2, deletedOptions: true });
    const historical = shippingProfileDeletionGraph("sp-create-mixed-history", 2, { optionsPerProfile: 2, deletedProfiles: true });
    const protectedGraph = shippingProfileDeletionGraph("sp-create-mixed-protected", 1, { optionsPerProfile: 1 });
    const fixture = await scenario([active, historical, protectedGraph]), host = await fixture.prepareInverse(),
      ids = [...active.profiles, ...historical.profiles], optionIds = [...active.optionIds, ...historical.optionIds];
    const protectedIds = [...shippingProfileOptionParents.map(value => text(value.row.id)), ...protectedGraph.profiles, ...protectedGraph.optionIds];
    const beforeOptions = await fixture.read(optionIds), protectedRows = await fixture.read(protectedIds), before = await fixture.snapshot(),
      key = host.newRequestKey();
    let calls = 0;
    expect(await Effect.runPromise(host.run(key, ids).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    })))).toBeNull();
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls); expect(await fixture.read(ids)).toEqual([]);
    expect(await fixture.read(optionIds)).toEqual(beforeOptions.map(row => ({ ...row, shipping_profile_id: null })));
    const after = await fixture.snapshot(); expect(newEvents(before, after).map(event => event.envelope.contract)).toEqual(ids.map(() => "fulfillment.shipping-profile.deleted"));
    const timestamp = expectCheckoutSettlement(before, after, key);
    const revisions = after.revisions.filter(revision => revision.timestamp === timestamp);
    expect(revisions).toHaveLength(12);
    expect(revisions.filter(revision => revision.deleted)).toHaveLength(4);
    expect(await fixture.read(protectedIds)).toEqual(protectedRows);
  }, 240_000);

  it("detaches 128 historical Options from one active Profile under one settlement", async () => {
    const selected = shippingProfileDeletionGraph("sp-create-historical-cohort", 1, { optionsPerProfile: 128, deletedOptions: true });
    const local = await scenario([selected]), host = await local.prepareInverse(), key = host.newRequestKey();
    const before = await local.snapshot(), beforeOptions = await local.read(selected.optionIds);
    const [profile] = await local.read(selected.profiles);
    if (profile === undefined) throw new Error("Missing seeded active Profile");
    expect(profile).toMatchObject({ id: selected.profiles[0], deleted_at: null });
    expect(beforeOptions).toHaveLength(128);
    expect(beforeOptions.every(option => typeof option.deleted_at === "string" && option.shipping_profile_id === profile.id)).toBe(true);

    let calls = 0;
    const outcome = await Effect.runPromiseExit(host.run(key, selected.profiles).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    })));
    if (Exit.isFailure(outcome)) throw new Error(Cause.pretty(outcome.cause), { cause: outcome.cause });
    expect(outcome.value).toBeNull();
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls);
    expect(await local.read(selected.profiles)).toEqual([]);
    expect(await local.read(selected.optionIds)).toEqual(beforeOptions.map(option => ({ ...option, shipping_profile_id: null })));

    const after = await local.snapshot(), timestamp = expectCheckoutSettlement(before, after, key);
    const revisions = after.revisions.filter(revision => revision.timestamp === timestamp);
    const original = before.revisions.find(revision => revision.value?.id === profile.id);
    if (original === undefined) throw new Error("Missing original active Profile revision");
    expect(revisions.filter(revision => revision.deleted)).toMatchObject([
      { table: original.table, id: original.id, previous: original.timestamp, deleted: true, value: null },
    ]);
    expect(after.indexes.some(index => index.table === original.table && index.id === original.id)).toBe(false);
    const detached = revisions.filter(revision => !revision.deleted);
    expect(detached).toHaveLength(128);
    const originalOptions = before.revisions.filter(revision => typeof revision.value?.id === "string" && selected.optionIds.includes(revision.value.id));
    const detachedById = new Map(detached.map(revision => [revision.id, revision]));
    expect(originalOptions).toHaveLength(128);
    for (const option of originalOptions) {
      const revision = detachedById.get(option.id);
      expect(revision?.table).toBe(option.table);
      expect(revision?.previous).toBe(option.timestamp);
      expect(revision?.value?.shipping_profile_id).toBeNull();
      expect(revision?.value?.updated_at).toBe(option.value?.updated_at);
      expect(revision?.value?.deleted_at).toBe(option.value?.deleted_at);
    }
    const events = newEvents(before, after);
    expect(events.map(event => event.envelope.contract)).toEqual(["fulfillment.shipping-profile.deleted"]);
    expect(events[0]?.envelope.message).toMatchObject({ data: { id: profile.id } });
    expect(events.length).toBeLessThanOrEqual(defaultCommerceResources.eventMessages);
  }, 240_000);

  it("keeps missing and raw duplicate physical requests bounded to actual deleted identities", async () => {
    const selected = shippingProfileDeletionGraph("sp-create-duplicates"), fixture = await scenario([selected]), host = await fixture.prepareInverse();
    const before = await fixture.snapshot(), deleteKey = host.newRequestKey();
    expect(await Effect.runPromise(host.run(deleteKey, ["missing", ...selected.profiles, ...selected.profiles, "မရှိ"]))).toBeNull();
    expect(await fixture.read(selected.profiles)).toEqual([]);
    const after = await fixture.snapshot(), timestamp = expectCheckoutSettlement(before, after, deleteKey);
    expect(newEvents(before, after)).toHaveLength(1);
    expect(after.revisions.filter(revision => revision.timestamp === timestamp)).toMatchObject([{ deleted: true, value: null }]);
    const missKey = host.newRequestKey();
    expect(await Effect.runPromise(host.run(missKey, ["missing"]))).toBeNull();
    const missing = await fixture.snapshot();
    expect(missing.outcomes.slice(after.outcomes.length)).toMatchObject([{ value: { key: missKey, kind: "nativeRoot", state: "committed" } }]);
    expect({ ...missing, outcomes: after.outcomes }).toEqual(after);
  }, 180_000);

  it("rolls back a late failure after the genuine retained physical callback", async () => {
    const tap = retainedTap();
    try {
      const failure = new Error("Late genuine Profile retained inverse failure");
      const host = await connected.prepareRoundtrip(tap.get, failure), before = await connected.fixture.inventory(), key = host.newRequestKey();
      const outcome = await Effect.runPromiseExit(host.run(key, input("sp-create-late")));
      expectWorkflowDefect(outcome, failure);
      await expectCheckoutRollback(connected.fixture, before, key);
    } finally { tap.restore(); }
    const selected = shippingProfileDeletionGraph("sp-create-late-detach", 1, { optionsPerProfile: 2, deletedOptions: true }), fixture = await scenario([selected]);
    const failure = new Error("Late genuine Profile physical inverse failure");
    const host = await fixture.prepareInverse(failure), before = await fixture.fixture.inventory(), key = host.newRequestKey();
    const outcome = await Effect.runPromiseExit(host.run(key, selected.profiles));
    expectWorkflowDefect(outcome, failure);
    await expectCheckoutRollback(fixture.fixture, before, key);
  }, 240_000);

  it("cancels after real physical deletion and detach planning without publishing or retaining usable native handles", async () => {
    const selected = shippingProfileDeletionGraph("sp-create-cancel-detach", 1, { optionsPerProfile: 2, deletedOptions: true });
    const fixture = await scenario([selected]), host = await fixture.prepareInverse(), key = host.newRequestKey();
    const reached = Deferred.makeUnsafe<void>(), finished = Deferred.makeUnsafe<void>(), original = FulfillmentModuleService.prototype.deleteShippingProfiles;
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const native = vi.spyOn(FulfillmentModuleService.prototype, "deleteShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await wait;
      await Effect.runPromise(Deferred.succeed(finished, undefined)); return output;
    });
    try {
      const before = await fixture.fixture.inventory(), outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(key, selected.profiles));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(pending); return yield* Fiber.await(pending);
      })));
      expect(native).toHaveBeenCalledTimes(1); expect(Exit.isFailure(outcome)).toBe(true);
      expect(Exit.isFailure(outcome) && Cause.hasInterrupts(outcome.cause)).toBe(true);
      await expectCheckoutRollback(fixture.fixture, before, key);
      if (escaped === undefined) throw new Error("Missing actual pending native Profile handle");
      await expect(escaped()).rejects.toBeDefined();
      finish?.(); await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000)));
      await expectCheckoutRollback(fixture.fixture, before, key);
    } finally { finish?.(); native.mockRestore(); }
  }, 180_000);

  it("rolls back genuine staged creation when a trusted host lowers the request event allowance", async () => {
    // Lower only the root event allowance, preserving the admitted inverse profile.
    const execution = { ...connected.execution,
      prepare: (composition: Parameters<typeof connected.execution.prepare>[0]) => {
        expect(composition.participants.map(participant => participant.logicalResources)).toEqual([defaultCommerceResources]);
        return connected.execution.prepare({ ...composition, requestEventLimit: 1 });
      } };
    const host = await Effect.runPromise(prepareShippingProfileCreationWorkflow({ ...connected.options, execution }));
    cleanup.push(() => Effect.runPromise(host.close));
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingProfiles"); let completedChanges = 0;
    try {
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      const outcome = await Effect.runPromise(Effect.result(host.run(key, input("sp-create-event-budget")).pipe(
        Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => work.pipe(Effect.tap(() => Effect.sync(() => {
          if (name === "NativeCommerce.writeRows/shipping_profile/insert") completedChanges++;
        }))) }),
      )));
      expect(native).toHaveBeenCalledTimes(1); expect(completedChanges).toBeGreaterThan(0);
      expect(Result.isFailure(outcome)).toBe(true); if (Result.isFailure(outcome)) expect(reasons(outcome.failure)).toContain("limitExceeded");
      await expectCheckoutRollback(connected.fixture, before, key);
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
      const host = await connected.prepare(), before = await connected.fixture.inventory(), key = host.newRequestKey();
      const outcome = await Effect.runPromise(Effect.result(host.run(key, input("sp-create-forged-" + mode))));
      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) expect(reasons(outcome.failure)).toContain("receiptMismatch");
      expect(native).toHaveBeenCalledTimes(1);
      await expectCheckoutRollback(connected.fixture, before, key);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("refuses forged workflow module identity and resource overrides during admission", async () => {
    const before = await connected.fixture.inventory();
    const prepare = vi.fn(connected.execution.prepare), execution = { ...connected.execution, prepare };
    const wrongSlot = Result.getOrThrow(defineAtomicCommerceNativeSource("foreign", connected.definition));
    const { scopeUuid, epochUuid } = connected.definition.identity;
    const scalar = await Effect.runPromise(compileShippingProfileCoreDefinition({ scopeUuid, epochUuid }));
    const missingOptions = Result.getOrThrow(defineAtomicCommerceNativeSource("fulfillment", scalar));
    for (const fulfillment of [{ ...connected.installed, module: { ...connected.fulfillment.workflow } },
      { ...connected.installed, nativeStorage: wrongSlot }, { ...connected.installed, nativeStorage: missingOptions },
      { ...connected.installed, nativeStorage: { ...connected.installed.nativeStorage } }]) {
      const rejected = await Effect.runPromise(Effect.result(prepareShippingProfileCreationWorkflow({ ...connected.options, execution, fulfillment })));
      expect(rejected).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    }
    const override = { ...connected.installed, logicalResources: { ...defaultCommerceResources, calls: 128 } };
    const rejected = await Effect.runPromise(Effect.result(prepareShippingProfileCreationWorkflow({
      ...connected.options, execution,
      // @ts-expect-error Deliberately verify that a foreign policy override is refused at runtime.
      fulfillment: override,
    })));
    expect(rejected).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(prepare).not.toHaveBeenCalled();
    expect(await connected.fixture.inventory()).toEqual(before);
  });

  it("settles one native creation with a concurrent global active Profile name", async () => {
    const fixture = await scenario(), left = await fixture.prepare(), right = await fixture.prepare(),
      reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const leftKey = left.newRequestKey(), rightKey = right.newRequestKey();
    const original = FulfillmentModuleService.prototype.createShippingProfiles; let arrivals = 0;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); if (++arrivals === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return output;
    });
    try {
      const before = await fixture.snapshot(), outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(left.run(leftKey, { data: [{ id: "sp-create-name-race-a", name: "Shared Name", type: "default" }] }).pipe(Effect.timeout(45_000)));
        const second = yield* Effect.forkChild(right.run(rightKey, { data: [{ id: "sp-create-name-race-b", name: "Shared Name", type: "default" }] }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000), Effect.ensuring(Deferred.succeed(release, undefined)));
        return [yield* Fiber.await(first), yield* Fiber.await(second)] as const;
      })));
      expect(arrivals).toBe(2); expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1); expect(outcomes.filter(Exit.isFailure)).toHaveLength(1);
      const [first, second] = outcomes, failure = Exit.isFailure(first) ? first : second;
      if (Exit.isSuccess(failure)) throw new Error("Both competing Profile creations settled");
      expect(expectWorkflowTypedFailures(failure).map(error => error.reason), Cause.pretty(failure.cause)).toEqual(["writeConflict"]);
      const [committedKey, refusedKey] = Exit.isSuccess(first) ? [leftKey, rightKey] : [rightKey, leftKey];
      expect(await fixture.read(["sp-create-name-race-a", "sp-create-name-race-b"])).toHaveLength(1);
      const after = await fixture.snapshot(), timestamp = expectCheckoutSettlement(before, after, committedKey);
      expect(after.revisions.filter(revision => revision.timestamp === timestamp)).toHaveLength(1);
      expect(newEvents(before, after)).toHaveLength(1);
      expect((await fixture.fixture.inventory()).outcomes.filter(record => record.value.key === refusedKey))
        .toMatchObject([{ value: { key: refusedKey, kind: "nativeRoot", state: "failed" } }]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);

  it("invalidates native empty Option validation when a canonical reference insertion commits", async () => {
    const fixture = await scenario([graph.race]), inverse = await fixture.prepareInverse(),
      reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const insertion = await prepareCoreShippingProfileOptionRaceFixture({ fixture: fixture.fixture,
      afterStaged: Effect.void, close: close => cleanup.push(close) });
    const inverseKey = inverse.newRequestKey(), insertionKey = insertion.newRequestKey();
    const option = shippingProfileDeletionGraph("sp-create-race", 1, { optionsPerProfile: 1 }).rows.find(value => value.table === "shipping_option")?.row;
    if (option === undefined) throw new Error("Missing canonical native Option reference");
    const original = FulfillmentModuleService.prototype.deleteShippingProfiles; let arrived = false;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "deleteShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); arrived = true; await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return output;
    });
    try {
      const before = await fixture.snapshot(), outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(inverse.run(inverseKey, graph.race.profiles).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* insertion.run(insertionKey, option).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        return yield* Fiber.await(pending);
      })));
      expect(arrived).toBe(true);
      if (Exit.isSuccess(outcome)) throw new Error("Physical inverse settled with a concurrent Option reference");
      expect(expectWorkflowTypedFailures(outcome).map(error => error.reason), Cause.pretty(outcome.cause)).toEqual(["writeConflict"]);
      const after = await fixture.snapshot(), timestamp = expectCheckoutSettlement(before, after, insertionKey);
      expect(after.revisions.filter(revision => revision.timestamp === timestamp)).toMatchObject([
        { previous: null, deleted: false, value: { id: option.id } },
      ]);
      expect(newEvents(before, after)).toEqual([]);
      expect((await fixture.fixture.inventory()).outcomes.filter(record => record.value.key === inverseKey))
        .toMatchObject([{ value: { key: inverseKey, kind: "nativeRoot", state: "failed" } }]);
      expect(await fixture.read(graph.race.profiles)).toHaveLength(1); expect(await fixture.read([text(option.id)])).toEqual([option]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);
});
