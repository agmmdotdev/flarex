import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { LinkService } from "@medusajs/link-modules";
import { prepareShippingProfileOptionRaceFixture } from "./support/shipping-profile-option-race-fixture";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { CommerceTransactionError, defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { makeLocalShippingProfileCommands } from "../src/modules/fulfillment/shipping-profile-service";
import { prepareShippingProfileDeletionWorkflow } from "../src/workflows/fulfillment/delete-shipping-profile";
import { prepareLogicalShippingProfileDeletion, shippingProfileDeletionGraph, shippingProfileDeletionSeedTime } from "./support/logical-shipping-profile-deletion-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalShippingProfileDeletion>>, sharedCleanupCount = 0;
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
const eventIds = (events: Awaited<ReturnType<typeof connected.snapshot>>["events"]) => events.flatMap(event => {
  const message = event.envelope.message;
  if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing native ShippingProfile/Link event identity");
  return Schema.decodeUnknownSync(Schema.Array(Schema.String))(Array.isArray(message.data.id) ? message.data.id : [message.data.id]);
});
const oneId = (value: ReturnType<typeof shippingProfileDeletionGraph>) => {
  const id = value.profiles[0]; if (id === undefined) throw new Error("Missing ShippingProfile seed"); return id;
};
const withoutManagedChanges = (row: JsonObject) => { const { updated_at: _updated, deleted_at: _deleted, ...retained } = row; return retained; };

describe("native ShippingProfile deletion with real Query, Link and ShippingOption relation storage", { concurrent: false }, () => {
  beforeAll(async () => {
    connected = await prepareLogicalShippingProfileDeletion(driver, close => cleanup.push(close), Object.values(graph));
    sharedCleanupCount = cleanup.length;
  }, 300_000);
  afterEach(async () => { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("retains mandatory empty Fulfillment and native Link dispatch and refuses invalid raw inputs before callbacks", async () => {
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles"), link = vi.spyOn(Link.prototype, "delete");
    try {
      const before = await connected.snapshot();
      for (const input of [{ ids: "scalar" }, { ids: [""] }, { ids: ["a", "b", "c", "d", "e"] }, { ids: [], extra: true }])
        // @ts-expect-error Exercise the public runtime boundary with malformed native input.
        expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))).toBe(true);
      expect(native).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
      const key = host.newRequestKey(); expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull();
      expect(native).toHaveBeenCalledTimes(1); expect(native.mock.calls[0]?.[0]).toEqual([]); expect(await native.mock.results[0]?.value).toEqual({});
      expect(link).toHaveBeenCalledTimes(1); expect(link.mock.calls[0]?.[0]).toEqual({ fulfillment: { shipping_profile_id: [] } });
      expect(await link.mock.results[0]?.value).toEqual([null, {}]);
      const after = await connected.snapshot(); expect(after.rows).toEqual(before.rows); expect(after.events).toEqual(before.events); expect(after.rowChanges).toEqual(before.rowChanges);
      expect(after.commits).toHaveLength(before.commits.length + 1); expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull();
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
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1); expect(after.rowChanges).toHaveLength(before.rowChanges.length + 4);
      const changes = new Set(after.rowChanges.slice(before.rowChanges.length).map(row => `${row.scopeUuid}:${row.tableId}:${Buffer.from(row.rowId).toString("hex")}`));
      const unaffected = (rows: typeof after.rows) => rows.filter(row => !changes.has(`${row.scopeUuid}:${row.tableId}:${Buffer.from(row.rowId).toString("hex")}`));
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
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [...selected.profiles].reverse() }).pipe(Effect.provideService(ExecutionDiagnostics, {
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
      expect(after.rowChanges).toHaveLength(before.rowChanges.length + 12);
    } finally { profile.mockRestore(); link.mockRestore(); }
  }, 240_000);

  it("preserves native Product-Link error wording, product ID order and precedence over real Option blockers", async () => {
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles"), link = vi.spyOn(Link.prototype, "delete");
    try {
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: [...graph.blockers.profiles].reverse() })));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(failures(result.failure)).toContain("Cannot delete following shipping profiles because they are linked to products: " + graph.blockers.productIds.join(", "));
      expect(native).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); link.mockRestore(); }
  }, 120_000);

  it("hydrates real complete ShippingOptions and refuses one or several active options without parent or child mutation", async () => {
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles"), link = vi.spyOn(Link.prototype, "delete");
    try {
      for (const ids of [[oneId(graph.options)], [...graph.options.profiles].reverse()]) {
        const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids })));
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) expect(failures(result.failure)).toContain(`Cannot delete Shipping Profiles ${ids} with associated Shipping Options. Delete Shipping Options first and try again.`);
        expect(await connected.snapshot()).toEqual(before);
      }
      expect(native).toHaveBeenCalledTimes(2); expect(link).not.toHaveBeenCalled();
    } finally { native.mockRestore(); link.mockRestore(); }
  }, 180_000);

  it("ignores deleted Options and active Options on a previously deleted profile according to native active-root selection", async () => {
    const host = await connected.prepare();
    for (const selected of [graph.deletedOptions, graph.deletedProfile]) {
      const beforeOptions = await connected.read(selected.optionIds);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: selected.profiles }))).toBeNull();
      expect(await connected.read(selected.optionIds)).toEqual(beforeOptions);
    }
    expect((await connected.read(graph.deletedOptions.profiles))[0]?.deleted_at).toEqual(expect.any(String));
    expect((await connected.read(graph.deletedProfile.profiles))[0]?.deleted_at).toBe(shippingProfileDeletionSeedTime);
  }, 180_000);

  it("retains raw duplicate and missing IDs for Link dispatch and skips repeated lifecycle writes", async () => {
    const host = await connected.prepare(), id = oneId(graph.membership), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles"), link = vi.spyOn(Link.prototype, "delete");
    try {
      const ids = ["missing-shipping-profile", id, id]; expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids }))).toBeNull();
      expect(native.mock.calls[0]?.[0]).toEqual(ids); expect(await native.mock.results[0]?.value).toEqual({ shipping_profile_id: [id] });
      expect(link.mock.calls[0]?.[0]).toEqual({ fulfillment: { shipping_profile_id: ids } });
      const before = await connected.snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [id, "missing-shipping-profile"] }))).toBeNull();
      expect(await native.mock.results[1]?.value).toEqual({});
      const after = await connected.snapshot(); expect(after.rows).toEqual(before.rows); expect(after.rowChanges).toEqual(before.rowChanges); expect(after.events).toEqual(before.events);
    } finally { native.mockRestore(); link.mockRestore(); }
  }, 180_000);

  it.each(["optionOverflow", "activeLinkOverflow", "historicalLinkOverflow"] as const)("refuses complete selected cohort overflow at %s without truncation or commit", async key => {
    const before = await connected.snapshot(), host = await connected.prepare(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph[key].profiles })));
    expect(Result.isFailure(result)).toBe(true); if (Result.isFailure(result)) expect(failures(result.failure)).toContain("limitExceeded");
    expect(await connected.snapshot()).toEqual(before);
  }, 180_000);

  it("retains broad raw-ID restoration of previously deleted profiles and historical Links, including repeated and empty inverse calls", async () => {
    const host = await connected.prepareRestore(), selected = graph.oldHistory, beforeRows = await connected.read(identities(selected));
    const native = vi.spyOn(FulfillmentModuleService.prototype, "restoreShippingProfiles"), link = vi.spyOn(Link.prototype, "restore");
    try {
      for (const repeated of [false, true]) {
        const before = await connected.snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [...selected.profiles, "missing-restore-profile"] }))).toBeNull();
        const after = await connected.snapshot(), current = await connected.read(identities(selected));
        expect(current.filter(row => selected.profiles.includes(String(row.id)) || selected.linkIds.includes(String(row.id))).every(row => row.deleted_at === null)).toBe(true);
        for (const row of beforeRows.filter(row => selected.productIds.includes(String(row.id)))) expect(current.find(value => value.id === row.id)).toEqual(row);
        expect(eventIds(after.events.slice(before.events.length))).toEqual([...selected.linkIds, ...selected.profiles]);
        expect(after.rowChanges).toHaveLength(before.rowChanges.length + (repeated ? 0 : 3));
      }
      native.mockClear(); link.mockClear(); const before = await connected.snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [] }))).toBeNull();
      expect(native).not.toHaveBeenCalled(); expect(link).toHaveBeenCalledTimes(1); expect(link.mock.calls[0]?.[0]).toEqual({ fulfillment: { shipping_profile_id: [] } });
      const after = await connected.snapshot(); expect(after.rows).toEqual(before.rows); expect(after.events).toEqual(before.events); expect(after.rowChanges).toEqual(before.rowChanges);
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
      const before = await connected.snapshot(), beforeRows = await connected.read(identities(selected));
      const outcome = await Effect.runPromise(Effect.exit(host.run(host.newRequestKey(), { ids: selected.profiles })));
      expect(redirected).toBe(true); expect(Exit.isFailure(outcome)).toBe(true);
      if (Exit.isFailure(outcome)) expect(failures(outcome.cause)).toContain("receiptMismatch");
      expect(profile).not.toHaveBeenCalled();
      expect(await connected.snapshot()).toEqual(before);
      expect(await connected.read(identities(selected))).toEqual(beforeRows);
    } finally { restore.mockRestore(); profile.mockRestore(); }
  }, 180_000);

  it("retains native active-name collision on broad restore and rolls back already-restored Links", async () => {
    const selected = shippingProfileDeletionGraph("sp-delete-name-collision", 1, { deletedProfiles: true, linksPerProfile: 1, deletedLinks: true });
    const other = await prepareLogicalShippingProfileDeletion(driver, close => cleanup.push(close), [selected], { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "shipping_delete_collision", projectId: "shipping_delete_collision", uuidOffset: 870_000 } });
    const creator = await other.prepareCreateProfile(), restore = await other.prepareRestore(), id = oneId(selected);
    await Effect.runPromise(creator.run(creator.newRequestKey(), [{ id: "sp-delete-reused-name", name: id, type: "default" }]));
    const before = await other.snapshot(), result = await Effect.runPromise(Effect.result(restore.run(restore.newRequestKey(), { ids: [id] })));
    expect(Result.isFailure(result)).toBe(true); expect(await other.snapshot()).toEqual(before);
    expect((await other.read(selected.linkIds))[0]?.deleted_at).toBe(shippingProfileDeletionSeedTime);
  }, 240_000);
  it("rolls back the entire root after late Link failure or a late failure after both retained inverses", async () => {
    const host = await connected.prepare(), original = Link.prototype.delete; let completed = false;
    const link = vi.spyOn(Link.prototype, "delete").mockImplementation(async function (this: Link, ...args) {
      await Reflect.apply(original, this, args); completed = true; throw new Error("Late native ShippingProfile Link failure");
    });
    try {
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.late.profiles })));
      expect(completed).toBe(true); expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
      if (Result.isFailure(result)) expect(failures(result.failure)).toContain("Late native ShippingProfile Link failure");
    } finally { link.mockRestore(); }
    const roundtrip = await connected.prepareRoundtrip(), before = await connected.snapshot();
    expect(Result.isFailure(await Effect.runPromise(Effect.result(roundtrip.run(roundtrip.newRequestKey(), { ids: graph.late.profiles, fail: true }))))).toBe(true);
    expect(await connected.snapshot()).toEqual(before);
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
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.late.profiles })));
      expect(returnedNativeErrors).toBe(true); expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
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
      const before = await connected.snapshot(); expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.forged.profiles }))))).toBe(true);
      expect(completed).toBe(true); expect(await connected.snapshot()).toEqual(before);
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
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: [oneId(graph.options)] })));
      expect(forged).toBe(true); expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
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
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.denied.profiles })));
      expect(caught).toBe(2); expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
      if (escaped === undefined) throw new Error("Missing escaped ShippingProfile callback"); await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(before);
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
  }, 120_000);

  it("rolls back interrupted lifecycle work and revokes the waiting native callback", async () => {
    const host = await connected.prepare(), original = FulfillmentModuleService.prototype.softDeleteShippingProfiles, reached = Deferred.makeUnsafe<void>();
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    try {
      const before = await connected.snapshot();
      await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { ids: graph.cancel.profiles }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      }));
      expect(await connected.snapshot()).toEqual(before); finish?.();
      if (escaped === undefined) throw new Error("Missing cancelled native continuation"); await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(before);
    } finally { finish?.(); native.mockRestore(); }
  }, 180_000);

  it("confines equal profile, child, Link and request identities to the accepted scope", async () => {
    const other = await prepareLogicalShippingProfileDeletion(driver, close => cleanup.push(close), [graph.scope], { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "shipping_profile_delete_b", projectId: "shipping_profile_delete_b", uuidOffset: 880_000 } });
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey(), input = { ids: graph.scope.profiles }, beforeOther = await other.read(identities(graph.scope));
    await Effect.runPromise(left.run(key, input)); expect(await other.read(identities(graph.scope))).toEqual(beforeOther);
    await Effect.runPromise(right.run(key, input)); expect((await other.read(graph.scope.profiles))[0]?.deleted_at).toEqual(expect.any(String));
    const before = await connected.snapshot(); await Effect.runPromise(left.run(key, input)); await Effect.runPromise(right.run(key, input)); expect(await connected.snapshot()).toEqual(before);
  }, 240_000);

  it.skipIf(driver !== "postgres")("observes overlapping native profile deletions and settles one optimistic winner", async () => {
    const left = await connected.prepare(), right = await connected.prepare(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const original = FulfillmentModuleService.prototype.softDeleteShippingProfiles; let arrivals = 0;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); if (++arrivals === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return result;
    });
    try {
      const before = await connected.snapshot(), outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(left.run(left.newRequestKey(), { ids: graph.race.profiles }).pipe(Effect.timeout(45_000)));
        const second = yield* Effect.forkChild(right.run(right.newRequestKey(), { ids: graph.race.profiles }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000), Effect.ensuring(Deferred.succeed(release, undefined)));
        return [yield* Fiber.await(first), yield* Fiber.await(second)];
      })));
      expect(arrivals).toBe(2); expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1); const rejected = outcomes.filter(Exit.isFailure); expect(rejected).toHaveLength(1);
      expect(failures(rejected[0]?.cause)).toContain("writeConflict");
      const after = await connected.snapshot(); expect(after.rowChanges).toHaveLength(before.rowChanges.length + 1); expect(after.commits).toHaveLength(before.commits.length + 1);
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
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.blockers.profiles })));
      expect(queried).toBe(true); expect(Result.isFailure(result)).toBe(true); expect(native).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    } finally { read.mockRestore(); native.mockRestore(); }
  }, 180_000);

  it.skipIf(driver !== "postgres")("invalidates a stale empty Product-Link read after a genuine competing Link insertion commits", async () => {
    const deletion = await connected.prepare(), insertion = await connected.prepareCreateLink(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const original = FulfillmentModuleService.prototype.softDeleteShippingProfiles, created = vi.spyOn(Link.prototype, "create"); let arrived = false;
    const profile = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); arrived = true;
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await Effect.runPromise(Deferred.await(release)); return result;
    });
    try {
      const before = await connected.snapshot(); let inserted: unknown;
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(deletion.run(deletion.newRequestKey(), { ids: graph.linkRace.profiles }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        inserted = yield* insertion.run(insertion.newRequestKey(), { product_id: "sp-delete-competing-product", shipping_profile_id: oneId(graph.linkRace) })
          .pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        return yield* Fiber.await(pending);
      })));
      expect(arrived).toBe(true); expect(Exit.isFailure(outcome)).toBe(true);
      if (Exit.isFailure(outcome)) expect(failures(outcome.cause)).toContain("writeConflict");
      const after = await connected.snapshot(); expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.rowChanges).toHaveLength(before.rowChanges.length + 1);
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
      expect(await connected.read([nativeRow.id])).toEqual([expect.objectContaining(nativeRow)]);
      const repeated = await Effect.runPromise(Effect.result(deletion.run(deletion.newRequestKey(), { ids: graph.linkRace.profiles })));
      expect(Result.isFailure(repeated)).toBe(true);
      if (Result.isFailure(repeated)) expect(failures(repeated.failure)).toContain("Cannot delete following shipping profiles because they are linked to products: sp-delete-competing-product");
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); profile.mockRestore(); created.mockRestore(); }
  }, 180_000);

  it.skipIf(driver !== "postgres")("invalidates the native empty Option guard after a canonical fixture Option insertion commits", async () => {
    const deletion = await connected.prepare(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const insertion = await prepareShippingProfileOptionRaceFixture({ fixture: connected.fixture, logicalStorage: connected.modules.fulfillment.logicalStorage,
      afterStaged: Effect.void, close: close => cleanup.push(close) });
    const option = shippingProfileDeletionGraph("sp-delete-option-race", 1, { optionsPerProfile: 1 }).rows.find(value => value.table === "shipping_option")?.row;
    if (option === undefined) throw new Error("Missing complete canonical Option race row");
    const original = FulfillmentModuleService.prototype.softDeleteShippingProfiles; let arrived = false;
    const profile = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); arrived = true;
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await Effect.runPromise(Deferred.await(release)); return result;
    });
    try {
      const before = await connected.snapshot();
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(deletion.run(deletion.newRequestKey(), { ids: graph.optionRace.profiles }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* insertion.run(insertion.newRequestKey(), option).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        return yield* Fiber.await(pending);
      })));
      expect(arrived).toBe(true); expect(Exit.isFailure(outcome)).toBe(true);
      if (Exit.isFailure(outcome)) expect(failures(outcome.cause)).toContain("writeConflict");
      const after = await connected.snapshot(); expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.rowChanges).toHaveLength(before.rowChanges.length + 1);
      expect(after.events).toEqual(before.events); expect((await connected.read(graph.optionRace.profiles))[0]?.deleted_at).toBeNull();
      expect(await connected.read([Schema.decodeUnknownSync(Schema.String)(option.id)])).toEqual([expect.objectContaining(option)]);
      const repeated = await Effect.runPromise(Effect.result(deletion.run(deletion.newRequestKey(), { ids: graph.optionRace.profiles })));
      expect(Result.isFailure(repeated)).toBe(true);
      if (Result.isFailure(repeated)) expect(failures(repeated.failure)).toContain(`Cannot delete Shipping Profiles ${graph.optionRace.profiles} with associated Shipping Options. Delete Shipping Options first and try again.`);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); profile.mockRestore(); }
  }, 180_000);

  it("restores a previously deleted profile with real active Options without re-running deletion validation", async () => {
    const restore = await connected.prepareRestore(), deletion = await connected.prepare(), selected = graph.deletedProfile;
    const beforeOptions = await connected.read(selected.optionIds);
    expect(await Effect.runPromise(restore.run(restore.newRequestKey(), { ids: selected.profiles }))).toBeNull();
    expect((await connected.read(selected.profiles))[0]?.deleted_at).toBeNull(); expect(await connected.read(selected.optionIds)).toEqual(beforeOptions);
    const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(deletion.run(deletion.newRequestKey(), { ids: selected.profiles })));
    expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
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
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: [oneId(graph.options)] })));
      expect(redirected).toBe(true); expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("recovers a lost true-commit acknowledgement without rerunning native callbacks or events", async () => {
    let lose = true, lost = 0;
    const fixture = connected.fixture;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => {
        if (profile !== "command" || !lose) return Effect.succeed(value);
        lose = false; lost++;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost native ShippingProfile deletion COMMIT acknowledgement") }));
      })));
    const host = await Effect.runPromise(prepareShippingProfileDeletionWorkflow({ ...connected.options, execution: {
      identityAndAccessPolicy: connected.execution.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }),
    } }));
    cleanup.push(() => Effect.runPromise(host.close));
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingProfiles"), link = vi.spyOn(Link.prototype, "delete");
    try {
      const before = await connected.snapshot(), key = host.newRequestKey(), input = { ids: graph.uncertain.profiles };
      expect(await Effect.runPromise(host.run(key, input))).toBeNull(); expect(lost).toBe(1);
      expect(native).toHaveBeenCalledTimes(1); expect(link).toHaveBeenCalledTimes(1);
      const after = await connected.snapshot(); expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.rowChanges).toHaveLength(before.rowChanges.length + 1);
      expect(eventIds(after.events.slice(before.events.length))).toEqual(graph.uncertain.profiles);
      expect(await Effect.runPromise(host.run(key, input))).toBeNull(); expect(await connected.snapshot()).toEqual(after);
      expect(native).toHaveBeenCalledTimes(1); expect(link).toHaveBeenCalledTimes(1);
    } finally { native.mockRestore(); link.mockRestore(); }
  }, 180_000);

});
