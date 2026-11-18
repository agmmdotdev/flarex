import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { LinkService } from "@medusajs/link-modules";
import { prepareCoreShippingProfileOptionRaceFixture } from "./support/shipping-profile-option-race-fixture";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { CommerceTransactionError, commerceError, defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceNativeSource } from "../../persistence-postgres/src/frameworks/atomicCommerce/nativeSelection";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { compileProductLinksCoreDefinition } from "../src/links/product-definition";
import { compileShippingProfileCoreDefinition } from "../src/modules/fulfillment/shipping-profile-schema";
import { makeLocalShippingProfileCommands } from "../src/modules/fulfillment/shipping-profile-service";
import { prepareShippingProfileDeletionWorkflow } from "../src/workflows/fulfillment/delete-shipping-profile";
import { prepareCoreShippingProfileDeletion } from "./support/core-shipping-profile-deletion-fixture";
import { expectCheckoutRollback, expectCheckoutSettlement } from "./support/core-checkout-evidence";
import type { CoreNativeWorkflowSnapshot } from "./support/core-native-workflow-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";
import { shippingProfileDeletionGraph, shippingProfileDeletionSeedTime } from "./support/shipping-profile-seeds";
import { expectWorkflowDefect, expectWorkflowTypedFailures } from "./support/workflow-failure-assertions";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreShippingProfileDeletion>>, sharedCleanupCount = 0;
const graph = {
  maximum: shippingProfileDeletionGraph("sp-delete-maximum", 4, { linksPerProfile: 2, deletedLinks: true }),
  roundtrip: shippingProfileDeletionGraph("sp-delete-roundtrip", 4, { linksPerProfile: 2, deletedLinks: true }),
  blockers: shippingProfileDeletionGraph("sp-delete-blockers", 2, { optionsPerProfile: 1, linksPerProfile: 1 }),
  options: shippingProfileDeletionGraph("sp-delete-options", 2, { optionsPerProfile: 2 }),
  deletedOptions: shippingProfileDeletionGraph("sp-delete-deleted-options", 1, { optionsPerProfile: 2, deletedOptions: true }),
  deletedProfile: shippingProfileDeletionGraph("sp-delete-deleted-profile", 1, { optionsPerProfile: 1, deletedProfiles: true }),
  oldHistory: shippingProfileDeletionGraph("sp-delete-old-history", 1, { deletedProfiles: true, linksPerProfile: 2, deletedLinks: true }),
  inverseProof: shippingProfileDeletionGraph("sp-delete-inverse-proof", 1, { deletedProfiles: true, linksPerProfile: 2, deletedLinks: true }),
  membership: shippingProfileDeletionGraph("sp-delete-membership"),
  optionOverflow: shippingProfileDeletionGraph("sp-delete-option-overflow", 1, { optionsPerProfile: 9 }),
  activeLinkOverflow: shippingProfileDeletionGraph("sp-delete-active-link-overflow", 1, { linksPerProfile: 9 }),
  historicalLinkOverflow: shippingProfileDeletionGraph("sp-delete-historical-link-overflow", 1, { linksPerProfile: 9, deletedLinks: true }),
  late: shippingProfileDeletionGraph("sp-delete-late", 2),
  forged: shippingProfileDeletionGraph("sp-delete-forged", 2),
  denied: shippingProfileDeletionGraph("sp-delete-denied"),
  cancel: shippingProfileDeletionGraph("sp-delete-cancel"),
  scope: shippingProfileDeletionGraph("sp-delete-scope", 1, { optionsPerProfile: 1, deletedOptions: true, linksPerProfile: 1, deletedLinks: true }),
  race: shippingProfileDeletionGraph("sp-delete-race"),
  linkRace: shippingProfileDeletionGraph("sp-delete-link-race"),
  optionRace: shippingProfileDeletionGraph("sp-delete-option-race"),
  uncertain: shippingProfileDeletionGraph("sp-delete-uncertain"),
  neighbor: shippingProfileDeletionGraph("sp-delete-neighbor", 1, { optionsPerProfile: 1 }),
};
const name = (action: "deleted" | "restored") => buildModuleResourceEventName({ prefix: "fulfillment", objectName: "shipping_profile", action });
const identities = (value: ReturnType<typeof shippingProfileDeletionGraph>) => [...value.profiles, ...value.optionIds, ...value.linkIds, ...value.productIds];
function failures(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? failures(reason.error)
    : reason._tag === "Die" ? failures(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...failures(value.cause)];
  return value instanceof Error ? [value.message, ...failures(value.cause)] : [];
}
function expectWriteConflict(outcome: Exit.Exit<unknown, unknown>) {
  expect(expectWorkflowTypedFailures(outcome).map(failure => failure.reason)).toEqual(["writeConflict"]);
}
const eventIds = (events: Awaited<ReturnType<typeof connected.snapshot>>["events"]) => events.flatMap(event => {
  const message = event.envelope.message;
  if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing native ShippingProfile/Link event identity");
  return Schema.decodeUnknownSync(Schema.Array(Schema.String))(Array.isArray(message.data.id) ? message.data.id : [message.data.id]);
});
const oneId = (value: ReturnType<typeof shippingProfileDeletionGraph>) => {
  const id = value.profiles[0]; if (id === undefined) throw new Error("Missing ShippingProfile seed"); return id;
};
const withoutManagedChanges = (row: JsonObject) => { const { updated_at: _updated, deleted_at: _deleted, ...retained } = row; return retained; };

function expectBusinessSettlement(before: CoreNativeWorkflowSnapshot, after: CoreNativeWorkflowSnapshot, key: string, ids: readonly string[]) {
  const timestamp = expectCheckoutSettlement(before, after, key);
  const changes = after.revisions.filter(row => row.timestamp === timestamp);
  expect(changes.map(row => row.value?.id).toSorted()).toEqual([...ids].sort());
  for (const change of changes) {
    expect(change.deleted).toBe(false);
    expect(after.indexes).toContainEqual(expect.objectContaining({ table: change.table, name: "by_id", id: change.id, timestamp }));
  }
  return timestamp;
}

function expectNoBusinessWrite(before: CoreNativeWorkflowSnapshot, after: CoreNativeWorkflowSnapshot, key: string) {
  const outcomes = after.outcomes.slice(before.outcomes.length), [outcome] = outcomes;
  expect(outcomes).toMatchObject([{ value: { kind: "nativeRoot", key, state: "committed" } }]);
  expect(after.rows).toEqual(before.rows);
  expect(after.revisions).toEqual(before.revisions);
  expect(after.indexes).toEqual(before.indexes);
  const published = [...after.events.slice(before.events.length), ...after.families.slice(before.families.length),
    ...after.deliveries.slice(before.deliveries.length)];
  for (const entry of published) expect(entry.timestamp).toBe(outcome?.timestamp);
}

async function expectFailedOutcome(key: string) {
  const { outcomes } = await connected.fixture.inventory();
  expect(outcomes.filter(row => row.value.key === key)).toMatchObject([{ value: { kind: "nativeRoot", key, state: "failed" } }]);
}

describe("native ShippingProfile deletion with real Query, Link and ShippingOption relation storage", { concurrent: false }, () => {
  beforeAll(async () => {
    connected = await prepareCoreShippingProfileDeletion(driver, close => cleanup.push(close), Object.values(graph));
    sharedCleanupCount = cleanup.length;
  }, 300_000);
  afterEach(() => finishOrderFixture([connected.closeCaseHosts, ...cleanup.splice(sharedCleanupCount).reverse()]), 120_000);
  afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);

  it("retains mandatory empty Fulfillment and native Link dispatch and refuses invalid raw inputs before callbacks", async () => {
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles"), link = vi.spyOn(Link.prototype, "delete");
    try {
      for (const input of [{ ids: "scalar" }, { ids: [""] }, { ids: ["a", "b", "c", "d", "e"] }, { ids: [], extra: true }]) {
        const before = await connected.fixture.inventory(), invalid = host.newRequestKey();
        // @ts-expect-error Exercise the public runtime boundary with malformed native input.
        expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(invalid, input))))).toBe(true);
        await expectCheckoutRollback(connected.fixture, before, invalid);
      }
      expect(native).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled();
      const before = await connected.snapshot();
      const key = host.newRequestKey(); expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull();
      expect(native).toHaveBeenCalledTimes(1); expect(native.mock.calls[0]?.[0]).toEqual([]); expect(await native.mock.results[0]?.value).toEqual({});
      expect(link).toHaveBeenCalledTimes(1); expect(link.mock.calls[0]?.[0]).toEqual({ fulfillment: { shipping_profile_id: [] } });
      expect(await link.mock.results[0]?.value).toEqual([null, {}]);
      const after = await connected.snapshot(); expectNoBusinessWrite(before, after, key); expect(after.events).toEqual(before.events);
      expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull();
      expect(await connected.snapshot()).toEqual(after); expect(native).toHaveBeenCalledTimes(1); expect(link).toHaveBeenCalledTimes(1);
    } finally { native.mockRestore(); link.mockRestore(); }
  }, 180_000);

  it("deletes four actual roots with eight selected historical Links and preserves every other family", async () => {
    const selected = graph.maximum, ids = [...selected.profiles].reverse(), host = await connected.prepare(), changed = await connected.prepare("e".repeat(64));
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles"), link = vi.spyOn(Link.prototype, "delete");
    try {
      const original = await connected.read(identities(selected)), neighbors = await connected.read(identities(graph.neighbor)), before = await connected.snapshot();
      const key = host.newRequestKey(); let calls = 0;
      expect(await Effect.runPromise(host.run(key, { ids }).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }), Effect.ensuring(Effect.sync(() => console.info("ShippingProfile deletion full graph calls", calls)))))).toBeNull();
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls);
      expect(native).toHaveBeenCalledTimes(1); expect(native.mock.calls[0]?.[0]).toEqual(ids);
      expect(await native.mock.results[0]?.value).toEqual({ shipping_profile_id: selected.profiles });
      expect(link.mock.calls[0]?.[0]).toEqual({ fulfillment: { shipping_profile_id: ids } });
      const current = await connected.read(identities(selected));
      for (const row of original) {
        const after = current.find(value => value.id === row.id);
        if (selected.profiles.includes(String(row.id))) {
          expect(after?.deleted_at).toEqual(expect.any(String)); expect(after?.updated_at).not.toBe(shippingProfileDeletionSeedTime);
          if (after === undefined) throw new Error("Profile was physically removed"); expect(withoutManagedChanges(after)).toEqual(withoutManagedChanges(row));
        } else expect(after).toEqual(row);
      }
      expect(await connected.read(identities(graph.neighbor))).toEqual(neighbors);
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      expect(emitted.map(event => event.envelope.contract)).toEqual(selected.profiles.map(() => name("deleted")));
      expect(eventIds(emitted)).toEqual(selected.profiles); expect(emitted.every(event => event.envelope.internal)).toBe(true);
      expectBusinessSettlement(before, after, key, selected.profiles);
      const unaffected = (rows: typeof after.rows) => rows.filter(row => !selected.profiles.includes(String(row.value.id)));
      expect(unaffected(after.rows)).toEqual(unaffected(before.rows));
      expect(await Effect.runPromise(host.run(key, { ids }))).toBeNull(); expect(native).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(after);
      await expect(Effect.runPromise(host.run(key, { ids: [...ids].reverse() }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, { ids }))).rejects.toMatchObject({ reason: "requestConflict" }); expect(await connected.snapshot()).toEqual(after);
    } finally { native.mockRestore(); link.mockRestore(); }
  }, 240_000);
  it("runs the complete native root and retained historical Link inverse before the four-profile inverse in one accepting attempt", async () => {
    const selected = graph.roundtrip, host = await connected.prepareRoundtrip(), beforeRows = await connected.read(identities(selected)), before = await connected.snapshot();
    const profile = vi.spyOn(FulfillmentModuleService.prototype, "restoreShippingProfiles"), link = vi.spyOn(Link.prototype, "restore"); let calls = 0;
    try {
      const key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { ids: [...selected.profiles].reverse() }).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }), Effect.ensuring(Effect.sync(() => console.info("ShippingProfile full root plus retained historical inverse calls", calls)))))).toBeNull();
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls);
      expect(link).toHaveBeenCalledTimes(1); expect(profile).toHaveBeenCalledTimes(1);
      expect(link.mock.invocationCallOrder[0]).toBeLessThan(profile.mock.invocationCallOrder[0]!);
      expect(link.mock.calls[0]?.[0]).toEqual({ fulfillment: { shipping_profile_id: [...selected.profiles].reverse() } });
      const current = await connected.read(identities(selected));
      for (const row of beforeRows) {
        const after = current.find(value => value.id === row.id); if (after === undefined) throw new Error("Native inverse removed a row");
        if (selected.productIds.includes(String(row.id))) expect(after).toEqual(row);
        else { expect(after.deleted_at).toBeNull(); expect(withoutManagedChanges(after)).toEqual(withoutManagedChanges(row)); }
      }
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      expect(eventIds(emitted.filter(event => event.envelope.contract === name("deleted")))).toEqual(selected.profiles);
      expect(eventIds(emitted.filter(event => event.envelope.contract === "LinkProductShippingProfile.attached"))).toEqual(selected.linkIds);
      expect(eventIds(emitted.filter(event => event.envelope.contract === name("restored")))).toEqual(selected.profiles);
      expect(emitted.map(event => event.envelope.contract)).toEqual([...selected.profiles.map(() => name("deleted")),
        "LinkProductShippingProfile.attached", ...selected.profiles.map(() => name("restored"))]);
      expect(emitted.find(event => event.envelope.contract === "LinkProductShippingProfile.attached")?.envelope.message)
        .toMatchObject({ data: { id: selected.linkIds } });
      expectBusinessSettlement(before, after, key, [...selected.profiles, ...selected.linkIds]);
    } finally { profile.mockRestore(); link.mockRestore(); }
  }, 240_000);

  it("preserves native Product-Link error wording, product ID order and precedence over real Option blockers", async () => {
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles"), link = vi.spyOn(Link.prototype, "delete");
    try {
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      const result = await Effect.runPromise(Effect.result(host.run(key, { ids: [...graph.blockers.profiles].reverse() })));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(failures(result.failure)).toContain("Cannot delete following shipping profiles because they are linked to products: " + graph.blockers.productIds.join(", "));
      expect(native).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled();
      await expectCheckoutRollback(connected.fixture, before, key);
    } finally { native.mockRestore(); link.mockRestore(); }
  }, 120_000);

  it("hydrates real complete ShippingOptions and refuses one or several active options without parent or child mutation", async () => {
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles"), link = vi.spyOn(Link.prototype, "delete");
    try {
      for (const ids of [[oneId(graph.options)], [...graph.options.profiles].reverse()]) {
        const before = await connected.fixture.inventory(), key = host.newRequestKey(), result = await Effect.runPromise(Effect.result(host.run(key, { ids })));
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) expect(failures(result.failure)).toContain(`Cannot delete Shipping Profiles ${ids} with associated Shipping Options. Delete Shipping Options first and try again.`);
        await expectCheckoutRollback(connected.fixture, before, key);
      }
      expect(native).toHaveBeenCalledTimes(2); expect(link).not.toHaveBeenCalled();
    } finally { native.mockRestore(); link.mockRestore(); }
  }, 180_000);

  it("ignores deleted Options and active Options on a previously deleted profile according to native active-root selection", async () => {
    const host = await connected.prepare();
    for (const selected of [graph.deletedOptions, graph.deletedProfile]) {
      const beforeOptions = await connected.read(selected.optionIds), before = await connected.snapshot(), key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { ids: selected.profiles }))).toBeNull();
      expect(await connected.read(selected.optionIds)).toEqual(beforeOptions);
      const after = await connected.snapshot();
      if (selected === graph.deletedOptions) expectBusinessSettlement(before, after, key, selected.profiles);
      else expectNoBusinessWrite(before, after, key);
    }
    expect((await connected.read(graph.deletedOptions.profiles))[0]?.deleted_at).toEqual(expect.any(String));
    expect((await connected.read(graph.deletedProfile.profiles))[0]?.deleted_at).toBe(shippingProfileDeletionSeedTime);
  }, 180_000);

  it("retains raw duplicate and missing IDs for Link dispatch and skips repeated lifecycle writes", async () => {
    const host = await connected.prepare(), id = oneId(graph.membership), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles"), link = vi.spyOn(Link.prototype, "delete");
    try {
      const ids = ["missing-shipping-profile", id, id], initial = await connected.snapshot(), key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { ids }))).toBeNull();
      expect(native.mock.calls[0]?.[0]).toEqual(ids); expect(await native.mock.results[0]?.value).toEqual({ shipping_profile_id: [id] });
      expect(link.mock.calls[0]?.[0]).toEqual({ fulfillment: { shipping_profile_id: ids } });
      const before = await connected.snapshot(), repeated = host.newRequestKey();
      expectBusinessSettlement(initial, before, key, [id]);
      expect(await Effect.runPromise(host.run(repeated, { ids: [id, "missing-shipping-profile"] }))).toBeNull();
      expect(await native.mock.results[1]?.value).toEqual({});
      const after = await connected.snapshot(); expectNoBusinessWrite(before, after, repeated); expect(after.events).toEqual(before.events);
    } finally { native.mockRestore(); link.mockRestore(); }
  }, 180_000);

  it.each(["optionOverflow", "activeLinkOverflow", "historicalLinkOverflow"] as const)("refuses complete selected cohort overflow at %s without truncation or commit", async cohort => {
    const before = await connected.fixture.inventory(), host = await connected.prepare(), key = host.newRequestKey();
    const result = await Effect.runPromise(Effect.result(host.run(key, { ids: graph[cohort].profiles })));
    expect(Result.isFailure(result)).toBe(true); if (Result.isFailure(result)) expect(failures(result.failure)).toContain("limitExceeded");
    await expectCheckoutRollback(connected.fixture, before, key);
  }, 180_000);

  it("retains broad raw-ID restoration of previously deleted profiles and historical Links, including repeated and empty inverse calls", async () => {
    const host = await connected.prepareRestore(), selected = graph.oldHistory, beforeRows = await connected.read(identities(selected));
    const native = vi.spyOn(FulfillmentModuleService.prototype, "restoreShippingProfiles"), link = vi.spyOn(Link.prototype, "restore");
    try {
      for (const repeated of [false, true]) {
        const before = await connected.snapshot(), key = host.newRequestKey();
        expect(await Effect.runPromise(host.run(key, { ids: [...selected.profiles, "missing-restore-profile"] }))).toBeNull();
        const after = await connected.snapshot(), current = await connected.read(identities(selected));
        expect(current.filter(row => selected.profiles.includes(String(row.id)) || selected.linkIds.includes(String(row.id))).every(row => row.deleted_at === null)).toBe(true);
        for (const row of beforeRows.filter(row => selected.productIds.includes(String(row.id)))) expect(current.find(value => value.id === row.id)).toEqual(row);
        expect(eventIds(after.events.slice(before.events.length))).toEqual([...selected.linkIds, ...selected.profiles]);
        if (repeated) expectNoBusinessWrite(before, after, key);
        else expectBusinessSettlement(before, after, key, [...selected.profiles, ...selected.linkIds]);
      }
      native.mockClear(); link.mockClear(); const before = await connected.snapshot(), key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull();
      expect(native).not.toHaveBeenCalled(); expect(link).toHaveBeenCalledTimes(1); expect(link.mock.calls[0]?.[0]).toEqual({ fulfillment: { shipping_profile_id: [] } });
      const after = await connected.snapshot(); expectNoBusinessWrite(before, after, key); expect(after.events).toEqual(before.events);
    } finally { native.mockRestore(); link.mockRestore(); }
  }, 240_000);

  it.each(["skipRead", "emptySelector", "missingSelector"] as const)("refuses a historical Link inverse that bypasses its selection through %s", async mode => {
    const host = await connected.prepareRestore(), selected = graph.inverseProof, original = LinkService.prototype.restore;
    let redirected = false;
    const profile = vi.spyOn(FulfillmentModuleService.prototype, "restoreShippingProfiles");
    const restore = vi.spyOn(LinkService.prototype, "restore").mockImplementation(async function (this: LinkService<JsonObject>, _data, context) {
      redirected = true;
      if (mode === "skipRead") return [[], {}];
      return original.call(this, [{ shipping_profile_id: mode === "emptySelector" ? [] : ["missing-historical-profile"] }], context);
    });
    try {
      const before = await connected.fixture.inventory(), beforeRows = await connected.read(identities(selected)), key = host.newRequestKey();
      const outcome = await Effect.runPromise(Effect.exit(host.run(key, { ids: selected.profiles })));
      expect(redirected).toBe(true); expect(Exit.isFailure(outcome)).toBe(true);
      if (Exit.isFailure(outcome)) expect(failures(outcome.cause)).toContain("receiptMismatch");
      expect(profile).not.toHaveBeenCalled();
      await expectCheckoutRollback(connected.fixture, before, key);
      expect(await connected.read(identities(selected))).toEqual(beforeRows);
    } finally { restore.mockRestore(); profile.mockRestore(); }
  }, 180_000);

  it("retains native active-name collision on broad restore and rolls back already-restored Links", async () => {
    const selected = shippingProfileDeletionGraph("sp-delete-name-collision", 1, { deletedProfiles: true, linksPerProfile: 1, deletedLinks: true });
    const other = await prepareCoreShippingProfileDeletion(driver, close => cleanup.push(close), [selected], connected.fixture.physical);
    const creator = await other.prepareCreateProfile(), restore = await other.prepareRestore(), id = oneId(selected);
    await Effect.runPromise(creator.run(creator.newRequestKey(), [{ id: "sp-delete-reused-name", name: id, type: "default" }]));
    const before = await other.fixture.inventory(), key = restore.newRequestKey(), result = await Effect.runPromise(Effect.result(restore.run(key, { ids: [id] })));
    expect(Result.isFailure(result)).toBe(true); await expectCheckoutRollback(other.fixture, before, key);
    expect((await other.read(selected.linkIds))[0]?.deleted_at).toBe(shippingProfileDeletionSeedTime);
  }, 240_000);
  it("rolls back the entire root after late Link failure or a late failure after both retained inverses", async () => {
    const host = await connected.prepare(), original = Link.prototype.delete; let completed = false;
    const linkFailure = new Error("Late native ShippingProfile Link failure");
    const link = vi.spyOn(Link.prototype, "delete").mockImplementation(async function (this: Link, ...args) {
      await Reflect.apply(original, this, args); completed = true; throw linkFailure;
    });
    try {
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      const exit = await Effect.runPromiseExit(host.run(key, { ids: graph.late.profiles }));
      expect(completed).toBe(true);
      await expectCheckoutRollback(connected.fixture, before, key);
      expectWorkflowDefect(exit, linkFailure);
    } finally { link.mockRestore(); }
    const inverseFailure = new Error("Late native ShippingProfile inverse failure");
    const roundtrip = await connected.prepareRoundtrip(inverseFailure), before = await connected.fixture.inventory(), key = roundtrip.newRequestKey();
    const exit = await Effect.runPromiseExit(roundtrip.run(key, { ids: graph.late.profiles }));
    await expectCheckoutRollback(connected.fixture, before, key);
    expectWorkflowDefect(exit, inverseFailure);
  }, 240_000);

  it("rejects genuine native Link errors-as-data after the router catches a selected service failure", async () => {
    const host = await connected.prepare(), original = Link.prototype.delete; let returnedNativeErrors = false;
    const link = vi.spyOn(Link.prototype, "delete").mockImplementation(async function (this: Link, ...args) {
      const modules: unknown = Reflect.get(this, "modulesMap"); if (!(modules instanceof Map) || modules.size !== 1) throw new Error("Missing exact selected native Link module");
      const loaded: unknown = modules.values().next().value;
      if (typeof loaded !== "object" || loaded === null) throw new Error("Missing selected native Link service");
      Reflect.set(loaded, "softDelete", async () => { throw new Error("Genuine native selected Link service rejection"); });
      const result = await Reflect.apply(original, this, args); returnedNativeErrors = Array.isArray(result[0]) && result[0].length > 0; return result;
    });
    try {
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      const result = await Effect.runPromise(Effect.result(host.run(key, { ids: graph.late.profiles })));
      expect(returnedNativeErrors).toBe(true); expect(Result.isFailure(result)).toBe(true);
      await expectCheckoutRollback(connected.fixture, before, key);
    } finally { link.mockRestore(); }
  }, 180_000);

  it.each(["map", "event"] as const)("rejects a forged complete native %s after real lifecycle mutation", async mode => {
    const host = await connected.prepare(), original = FulfillmentModuleService.prototype.softDeleteShippingProfiles; let completed = false;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); completed = true;
      if (mode === "map") return { ...result, shipping_profile_id: graph.neighbor.profiles };
      const bus: unknown = Reflect.get(this, "eventBusModuleService_"); if (typeof bus !== "object" || bus === null) throw new Error("Missing native event bus");
      const emit: unknown = Reflect.get(bus, "emit"); if (typeof emit !== "function") throw new Error("Missing native emit");
      await Reflect.apply(emit, bus, [[{ name: name("deleted"), data: { id: oneId(graph.neighbor) },
        metadata: { source: "fulfillment", object: "shipping_profile", action: "deleted" } }], { internal: true }]); return result;
    });
    try {
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(key, { ids: graph.forged.profiles }))))).toBe(true);
      expect(completed).toBe(true); await expectCheckoutRollback(connected.fixture, before, key);
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["emptyOptions", "foreignKey", "optionScalar"] as const)("rejects a forged protected validation read at %s", async mode => {
    const host = await connected.prepare(), original = FulfillmentModuleService.prototype.softDeleteShippingProfiles; let forged = false;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const service: unknown = Reflect.get(this, "shippingProfileService_"); if (typeof service !== "object" || service === null) throw new Error("Missing native internal ShippingProfile service");
      const list: unknown = Reflect.get(service, "list"); if (typeof list !== "function") throw new Error("Missing native internal list");
      Reflect.set(service, "list", async (...readArgs: unknown[]) => {
        const output = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(await Reflect.apply(list, service, readArgs));
        forged = true; return output.map(row => ({ ...row, shipping_options: mode === "emptyOptions" ? [] :
          Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(row.shipping_options).map(option => ({ ...option,
            ...(mode === "foreignKey" ? { shipping_profile_id: oneId(graph.neighbor) } : { name: 12 }) })) }));
      });
      return await Reflect.apply(original, this, args);
    });
    try {
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      const result = await Effect.runPromise(Effect.result(host.run(key, { ids: [oneId(graph.options)] })));
      expect(forged).toBe(true); expect(Result.isFailure(result)).toBe(true);
      await expectCheckoutRollback(connected.fixture, before, key);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("keeps a caught physical-deletion or sibling Option denial fatal and revokes escaped continuations", async () => {
    const host = await connected.prepare(), original = FulfillmentModuleService.prototype.softDeleteShippingProfiles;
    let caught = 0, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      try { await this.deleteShippingProfiles(graph.denied.profiles); } catch { caught++; }
      try { await this.deleteShippingOptions(graph.neighbor.optionIds); } catch { caught++; }
      return result;
    });
    try {
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      const result = await Effect.runPromise(Effect.result(host.run(key, { ids: graph.denied.profiles })));
      expect(caught).toBe(2); expect(Result.isFailure(result)).toBe(true);
      await expectCheckoutRollback(connected.fixture, before, key);
      if (escaped === undefined) throw new Error("Missing escaped ShippingProfile callback");
      await expect(escaped()).rejects.toBeDefined(); await expectCheckoutRollback(connected.fixture, before, key);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("authenticates the selected deletion profile and exact Link resource identities", async () => {
    const creation = await Effect.runPromise(makeLocalShippingProfileCommands());
    const bad = await Effect.runPromise(Effect.result(prepareShippingProfileDeletionWorkflow({ ...connected.options, modules: { ...connected.modules,
      // @ts-expect-error A genuine creation token intentionally has no native lifecycle methods.
      fulfillment: { ...connected.modules.fulfillment, module: creation.workflow } } })));
    expect(bad).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    const copied = await Effect.runPromise(Effect.result(prepareShippingProfileDeletionWorkflow({ ...connected.options, modules: { ...connected.modules,
      fulfillment: { ...connected.modules.fulfillment, module: { ...connected.fulfillment.workflow } } } })));
    expect(copied).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    const link = await Effect.runPromise(Effect.result(prepareShippingProfileDeletionWorkflow({ ...connected.options, link: { ...connected.options.link } })));
    expect(Result.isFailure(link)).toBe(true);
    const before = await connected.fixture.inventory(), prepare = vi.fn(() => Effect.fail(commerceError("unsupportedProfile")));
    const { modules } = connected, execution = { ...connected.options.execution, prepare };
    const fulfillment = connected.fixture.sources.find(source => source.source === modules.fulfillment.nativeStorage);
    const shippingLink = connected.fixture.sources.find(source => source.source === modules.product_shipping_profile_deletion_links.nativeStorage);
    if (fulfillment === undefined || shippingLink === undefined) throw new Error("Missing issued Profile and Link definitions");
    const wrongSlot = Result.getOrThrow(defineAtomicCommerceNativeSource("product_shipping_profile_deletion_links", fulfillment.definition));
    const wrongSource = Result.getOrThrow(defineAtomicCommerceNativeSource("fulfillment", shippingLink.definition));
    for (const nativeStorage of [wrongSlot, wrongSource]) {
      const denied = await Effect.runPromise(Effect.result(prepareShippingProfileDeletionWorkflow({ ...connected.options, execution,
        modules: { ...modules, fulfillment: { ...modules.fulfillment, nativeStorage } },
      })));
      expect(denied).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    }
    const { scopeUuid, epochUuid } = fulfillment.definition.identity;
    const target = { scopeUuid, epochUuid };
    const [scalarProfile, salesLink] = await Effect.runPromise(Effect.all([
      compileShippingProfileCoreDefinition(target), compileProductLinksCoreDefinition(target, { salesChannel: true, shippingProfile: false }),
    ]));
    const missingOptions = Result.getOrThrow(defineAtomicCommerceNativeSource("fulfillment", scalarProfile));
    const missingShippingLink = Result.getOrThrow(defineAtomicCommerceNativeSource("product_shipping_profile_deletion_links", salesLink));
    const results = await Effect.runPromise(Effect.all([
      Effect.result(prepareShippingProfileDeletionWorkflow({ ...connected.options, execution,
        modules: { ...modules, fulfillment: { ...modules.fulfillment, nativeStorage: missingOptions } },
      })),
      Effect.result(prepareShippingProfileDeletionWorkflow({ ...connected.options, execution,
        modules: { ...modules, product_shipping_profile_deletion_links: { ...modules.product_shipping_profile_deletion_links, nativeStorage: missingShippingLink } },
      })),
    ]));
    expect(results).toMatchObject([
      { _tag: "Failure", failure: { reason: "invalidAuthority" } },
      { _tag: "Failure", failure: { reason: "invalidAuthority" } },
    ]);
    expect(prepare).not.toHaveBeenCalled();
    expect(await connected.fixture.inventory()).toEqual(before);
  }, 120_000);

  it("rolls back interrupted lifecycle work and revokes the waiting native callback", async () => {
    const host = await connected.prepare(), original = FulfillmentModuleService.prototype.softDeleteShippingProfiles;
    const reached = Deferred.makeUnsafe<void>(), finished = Deferred.makeUnsafe<void>();
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await wait;
      await Effect.runPromise(Deferred.succeed(finished, undefined)); return result;
    });
    try {
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      const exit = await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(key, { ids: graph.cancel.profiles }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
        return yield* Fiber.await(fiber);
      }));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.hasInterrupts(exit.cause)).toBe(true);
      await expectCheckoutRollback(connected.fixture, before, key);
      finish?.();
      await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000)));
      if (escaped === undefined) throw new Error("Missing cancelled native continuation");
      await expect(escaped()).rejects.toBeDefined(); await expectCheckoutRollback(connected.fixture, before, key);
    } finally { finish?.(); native.mockRestore(); }
  }, 180_000);

  it("confines equal profile, child, Link and request identities to the accepted scope", async () => {
    const other = await prepareCoreShippingProfileDeletion(driver, close => cleanup.push(close), [graph.scope], connected.fixture.physical);
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey(), input = { ids: graph.scope.profiles };
    const before = await connected.snapshot(), beforeOther = await other.snapshot();
    await Effect.runPromise(left.run(key, input)); expect(await other.snapshot()).toEqual(beforeOther);
    await Effect.runPromise(right.run(key, input)); expect((await other.read(graph.scope.profiles))[0]?.deleted_at).toEqual(expect.any(String));
    const after = await connected.snapshot(), afterOther = await other.snapshot();
    expectBusinessSettlement(before, after, key, graph.scope.profiles);
    expectBusinessSettlement(beforeOther, afterOther, key, graph.scope.profiles);
    await Effect.runPromise(left.run(key, input)); await Effect.runPromise(right.run(key, input));
    expect(await connected.snapshot()).toEqual(after); expect(await other.snapshot()).toEqual(afterOther);
  }, 240_000);

  it("observes overlapping native profile deletions and settles one optimistic winner", async () => {
    const left = await connected.prepare(), right = await connected.prepare(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const original = FulfillmentModuleService.prototype.softDeleteShippingProfiles; let arrivals = 0;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); if (++arrivals === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return result;
    });
    try {
      const before = await connected.snapshot(), leftKey = left.newRequestKey(), rightKey = right.newRequestKey(), input = { ids: graph.race.profiles };
      const outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(left.run(leftKey, input).pipe(Effect.timeout(45_000)));
        const second = yield* Effect.forkChild(right.run(rightKey, input).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000), Effect.ensuring(Deferred.succeed(release, undefined)));
        return [yield* Fiber.await(first), yield* Fiber.await(second)] as const;
      })));
      expect(arrivals).toBe(2); expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1);
      const [winner, winnerKey, loserKey, loser] = Exit.isSuccess(outcomes[0])
        ? [left, leftKey, rightKey, outcomes[1]] as const : [right, rightKey, leftKey, outcomes[0]] as const;
      expectWriteConflict(loser);
      const after = await connected.snapshot();
      expectBusinessSettlement(before, after, winnerKey, graph.race.profiles);
      await expectFailedOutcome(loserKey);
      expect(eventIds(after.events.slice(before.events.length))).toEqual(graph.race.profiles);
      expect(await Effect.runPromise(winner.run(winnerKey, input))).toBeNull();
      expect(arrivals).toBe(2);
      expect(await connected.snapshot()).toEqual(after);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 180_000);
  it.each(["order", "count", "membership", "field", "selector"] as const)("rejects a forged native Product-Link Query %s before business callbacks", async mode => {
    const host = await connected.prepare(), original = LinkService.prototype.listAndCount;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles"); let queried = false;
    const read = vi.spyOn(LinkService.prototype, "listAndCount").mockImplementation(async function (this: LinkService<JsonObject>, ...args) {
      const actualArgs = mode === "selector" ? [{ shipping_profile_id: graph.maximum.profiles }, ...args.slice(1)] : args;
      const result: unknown = await Reflect.apply(original, this, actualArgs);
      const [output, count] = Schema.decodeUnknownSync(Schema.Tuple([Schema.Array(Schema.JsonObject), Schema.Number]))(result);
      queried = true;
      if (mode === "order") return [[...output].reverse(), count];
      if (mode === "count") return [[...output], count + 1];
      if (mode === "membership") return [output.map(row => ({ ...row, product_id: "invented-query-product" })), count];
      if (mode === "field") return [output.map(row => ({ ...row, shipping_profile_id: 12 })), count];
      return [[...output], count];
    });
    try {
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      const result = await Effect.runPromise(Effect.result(host.run(key, { ids: graph.blockers.profiles })));
      expect(queried).toBe(true); expect(Result.isFailure(result)).toBe(true); expect(native).not.toHaveBeenCalled();
      await expectCheckoutRollback(connected.fixture, before, key);
    } finally { read.mockRestore(); native.mockRestore(); }
  }, 180_000);

  it("invalidates a stale empty Product-Link read after a genuine competing Link insertion commits", async () => {
    const deletion = await connected.prepare(), insertion = await connected.prepareCreateLink(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const original = FulfillmentModuleService.prototype.softDeleteShippingProfiles, created = vi.spyOn(Link.prototype, "create"); let arrived = false;
    const profile = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); arrived = true;
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await Effect.runPromise(Deferred.await(release)); return result;
    });
    try {
      const before = await connected.snapshot(), deletionKey = deletion.newRequestKey(), insertionKey = insertion.newRequestKey();
      let inserted: unknown;
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(deletion.run(deletionKey, { ids: graph.linkRace.profiles }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        inserted = yield* insertion.run(insertionKey, { product_id: "sp-delete-competing-product", shipping_profile_id: oneId(graph.linkRace) })
          .pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        return yield* Fiber.await(pending);
      })));
      expect(arrived).toBe(true); expectWriteConflict(outcome);
      expect((await connected.read(graph.linkRace.profiles))[0]?.deleted_at).toBeNull();
      // The common native step returns its original grouped definition; the
      // genuine Link.create result independently carries persisted Link IDs.
      expect(inserted).toEqual([{ product: { product_id: "sp-delete-competing-product" },
        fulfillment: { shipping_profile_id: oneId(graph.linkRace) } }]);
      expect(created).toHaveBeenCalledTimes(1);
      const nativeRows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(await created.mock.results[0]?.value);
      expect(nativeRows).toEqual([{ id: expect.any(String), product_id: "sp-delete-competing-product", shipping_profile_id: oneId(graph.linkRace),
        created_at: expect.any(String), updated_at: expect.any(String), deleted_at: null }]);
      const nativeRow = nativeRows[0];
      if (nativeRow === undefined || typeof nativeRow.id !== "string") throw new Error("Missing genuine persisted Link identity");
      const after = await connected.snapshot();
      expectBusinessSettlement(before, after, insertionKey, [nativeRow.id]);
      expect(after.events.slice(before.events.length).map(event => event.envelope.contract)).toEqual(["LinkProductShippingProfile.attached"]);
      expect(eventIds(after.events.slice(before.events.length))).toEqual([nativeRow.id]);
      await expectFailedOutcome(deletionKey);
      expect(await connected.read([nativeRow.id])).toEqual([expect.objectContaining(nativeRow)]);
      const beforeRefusal = await connected.fixture.inventory(), repeatedKey = deletion.newRequestKey();
      const repeated = await Effect.runPromise(Effect.result(deletion.run(repeatedKey, { ids: graph.linkRace.profiles })));
      expect(Result.isFailure(repeated)).toBe(true);
      if (Result.isFailure(repeated)) expect(failures(repeated.failure)).toContain("Cannot delete following shipping profiles because they are linked to products: sp-delete-competing-product");
      await expectCheckoutRollback(connected.fixture, beforeRefusal, repeatedKey);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); profile.mockRestore(); created.mockRestore(); }
  }, 180_000);

  it("invalidates the native empty Option guard after a canonical fixture Option insertion commits", async () => {
    const deletion = await connected.prepare(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const insertion = await prepareCoreShippingProfileOptionRaceFixture({ fixture: connected.fixture,
      afterStaged: Effect.void, close: close => cleanup.push(close) });
    const option = shippingProfileDeletionGraph("sp-delete-option-race", 1, { optionsPerProfile: 1 }).rows.find(value => value.table === "shipping_option")?.row;
    if (option === undefined) throw new Error("Missing complete canonical Option race row");
    const original = FulfillmentModuleService.prototype.softDeleteShippingProfiles; let arrived = false;
    const profile = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); arrived = true;
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await Effect.runPromise(Deferred.await(release)); return result;
    });
    try {
      const before = await connected.snapshot(), deletionKey = deletion.newRequestKey(), insertionKey = insertion.newRequestKey();
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(deletion.run(deletionKey, { ids: graph.optionRace.profiles }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* insertion.run(insertionKey, option).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        return yield* Fiber.await(pending);
      })));
      expect(arrived).toBe(true); expectWriteConflict(outcome);
      const after = await connected.snapshot(), optionId = Schema.decodeUnknownSync(Schema.String)(option.id);
      expectBusinessSettlement(before, after, insertionKey, [optionId]);
      await expectFailedOutcome(deletionKey);
      expect(after.events).toEqual(before.events); expect((await connected.read(graph.optionRace.profiles))[0]?.deleted_at).toBeNull();
      expect(await connected.read([optionId])).toEqual([expect.objectContaining(option)]);
      const beforeRefusal = await connected.fixture.inventory(), repeatedKey = deletion.newRequestKey();
      const repeated = await Effect.runPromise(Effect.result(deletion.run(repeatedKey, { ids: graph.optionRace.profiles })));
      expect(Result.isFailure(repeated)).toBe(true);
      if (Result.isFailure(repeated)) expect(failures(repeated.failure)).toContain(`Cannot delete Shipping Profiles ${graph.optionRace.profiles} with associated Shipping Options. Delete Shipping Options first and try again.`);
      await expectCheckoutRollback(connected.fixture, beforeRefusal, repeatedKey);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); profile.mockRestore(); }
  }, 180_000);

  it("restores a previously deleted profile with real active Options without re-running deletion validation", async () => {
    const restore = await connected.prepareRestore(), deletion = await connected.prepare(), selected = graph.deletedProfile;
    const beforeOptions = await connected.read(selected.optionIds), beforeRestore = await connected.snapshot(), restoreKey = restore.newRequestKey();
    expect(await Effect.runPromise(restore.run(restoreKey, { ids: selected.profiles }))).toBeNull();
    expect((await connected.read(selected.profiles))[0]?.deleted_at).toBeNull(); expect(await connected.read(selected.optionIds)).toEqual(beforeOptions);
    expectBusinessSettlement(beforeRestore, await connected.snapshot(), restoreKey, selected.profiles);
    const before = await connected.fixture.inventory(), key = deletion.newRequestKey();
    const result = await Effect.runPromise(Effect.result(deletion.run(key, { ids: selected.profiles })));
    expect(Result.isFailure(result)).toBe(true); await expectCheckoutRollback(connected.fixture, before, key);
    if (Result.isFailure(result)) expect(failures(result.failure)).toContain(`Cannot delete Shipping Profiles ${selected.profiles} with associated Shipping Options. Delete Shipping Options first and try again.`);
  }, 180_000);

  it.each(["emptySelector", "missingSelector", "skipRead"] as const)("refuses native Option validation bypass through %s", async mode => {
    const host = await connected.prepare(), original = FulfillmentModuleService.prototype.softDeleteShippingProfiles; let redirected = false;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      if (mode === "skipRead") Reflect.set(this, "validateShippingProfileDeletion", async () => { redirected = true; });
      else {
        const service: unknown = Reflect.get(this, "shippingProfileService_"); if (typeof service !== "object" || service === null) throw new Error("Missing internal ShippingProfile service");
        const list: unknown = Reflect.get(service, "list"); if (typeof list !== "function") throw new Error("Missing genuine validation list");
        Reflect.set(service, "list", async (...readArgs: unknown[]) => {
          redirected = true; return await Reflect.apply(list, service, [{ id: mode === "emptySelector" ? [] : ["missing-validation-profile"] }, ...readArgs.slice(1)]);
        });
      }
      return await Reflect.apply(original, this, args);
    });
    try {
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      const result = await Effect.runPromise(Effect.result(host.run(key, { ids: [oneId(graph.options)] })));
      expect(redirected).toBe(true); expect(Result.isFailure(result)).toBe(true);
      await expectCheckoutRollback(connected.fixture, before, key);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("recovers a lost true-commit acknowledgement without rerunning native callbacks or events", async () => {
    const host = await connected.prepare(), fault = connected.fixture.loseNextNativeRootAcknowledgement();
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles"), link = vi.spyOn(Link.prototype, "delete");
    try {
      const before = await connected.snapshot(), key = host.newRequestKey(), input = { ids: graph.uncertain.profiles };
      expect(await Effect.runPromise(host.run(key, input))).toBeNull();
      expect(native).toHaveBeenCalledTimes(1); expect(link).toHaveBeenCalledTimes(1);
      const after = await connected.snapshot(), inventory = await connected.fixture.inventory();
      const timestamp = expectBusinessSettlement(before, after, key, graph.uncertain.profiles);
      expect(fault).toMatchObject({ armed: false, failures: 1, evidence: { timestamp } });
      expect(fault.evidence?.inventory).toEqual(inventory);
      expect(eventIds(after.events.slice(before.events.length))).toEqual(graph.uncertain.profiles);
      await Effect.runPromise(host.close);
      const reopened = await connected.prepare();
      expect(await Effect.runPromise(reopened.run(key, input))).toBeNull();
      expect(await Effect.runPromise(Effect.result(reopened.run(key, { ids: [] })))).toMatchObject({
        _tag: "Failure", failure: { reason: "requestConflict" },
      });
      expect(await connected.fixture.inventory()).toEqual(inventory);
      expect(native).toHaveBeenCalledTimes(1); expect(link).toHaveBeenCalledTimes(1);
    } finally { native.mockRestore(); link.mockRestore(); }
  }, 180_000);

});
