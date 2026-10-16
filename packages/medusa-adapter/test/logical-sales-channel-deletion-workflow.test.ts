import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { SalesChannelModuleService } from "@medusajs/sales-channel/services";
import { StoreModuleService } from "@medusajs/store/services";
import { CommerceTransactionError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxAppRowCurrent, fxSystemCommits, fxSystemCommitAppRowChanges } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { workflowMethodDefinition, type WorkflowMethod } from "../src/workflow/module";
import { prepareLogicalSalesChannelDeletion } from "./support/logical-sales-channel-deletion-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalSalesChannelDeletion>>;
const rows = () => connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
const facts = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitAppRowChanges);
const commits = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommits);
const events = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const snapshot = async () => ({ rows: await rows(), facts: await facts(), commits: await commits(), events: await events() });
function failurePath(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? failurePath(reason.error)
    : reason._tag === "Die" ? failurePath(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...failurePath(value.cause)];
  return value instanceof Error ? [value.message, ...failurePath(value.cause)] : [];
}
const idsIn = (messages: Awaited<ReturnType<typeof events>>) => messages.flatMap(event => {
  const message = event.envelope.message;
  if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing native event identity");
  return Array.isArray(message.data.id) ? message.data.id : [message.data.id];
});
function internalEvent(method: WorkflowMethod | undefined) {
  const definition = method === undefined ? undefined : workflowMethodDefinition(method);
  if (definition === undefined || definition.moduleEvents.length !== 1 || definition.moduleEvents[0] === undefined)
    throw new Error("Missing authentic native lifecycle event contract");
  return definition.moduleEvents[0];
}

describe("native Sales Channel deletion on shared logical storage", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalSalesChannelDeletion(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("retains all empty-input native dependencies and refuses malformed inputs before callbacks", async () => {
    const host = await connected.prepare();
    const store = vi.spyOn(StoreModuleService.prototype, "listStores"), sales = vi.spyOn(SalesChannelModuleService.prototype, "softDeleteSalesChannels"),
      link = vi.spyOn(Link.prototype, "delete");
    try {
      const before = await snapshot();
      for (const input of [{ ids: "scalar" }, { ids: [""] }, { ids: ["a", "b", "c", "d", "e"] }, { ids: [], extra: true }])
        // @ts-expect-error Deliberately exercise inputs rejected by the typed workflow API.
        expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input)))).toMatchObject({ _tag: "Failure" });
      expect(store).not.toHaveBeenCalled(); expect(sales).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled();
      expect(await snapshot()).toEqual(before);
      const key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull();
      expect(store).toHaveBeenCalledTimes(1); expect(store.mock.calls[0]?.[0]).toEqual({ default_sales_channel_id: [] });
      // MedusaService adds its default order to this same config object after
      // the spy records it. The pure composer witness checks the entry config.
      expect(store.mock.calls[0]?.[1]).toEqual({ select: ["default_sales_channel_id"], order: { id: "ASC" } });
      expect(sales).toHaveBeenCalledTimes(1); expect(sales.mock.calls[0]?.[0]).toEqual([]);
      expect(link).toHaveBeenCalledTimes(1); expect(link.mock.calls[0]?.[0]).toEqual({ sales_channel: { sales_channel_id: [] } });
      expect(await rows()).toEqual(before.rows); expect(await facts()).toEqual(before.facts); expect(await events()).toEqual(before.events);
      expect((await commits()).length - before.commits.length).toBe(1);
      const committed = await snapshot();
      expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull();
      expect(store).toHaveBeenCalledTimes(1); expect(sales).toHaveBeenCalledTimes(1); expect(link).toHaveBeenCalledTimes(1);
      expect(await snapshot()).toEqual(committed);
    } finally { store.mockRestore(); sales.mockRestore(); link.mockRestore(); }
  }, 120_000);

  it("soft-deletes four Channels and eight pivots in each family with requested-order events, one publication and replay", async () => {
    const graph = await connected.seed("delete-maximum", 4, 2, 2), ids = [...graph.channels].reverse();
    const host = await connected.prepare(), changed = await connected.prepare("e".repeat(64));
    const native = vi.spyOn(SalesChannelModuleService.prototype, "softDeleteSalesChannels");
    const productRows = await connected.readProducts(graph.products), locationRows = await connected.readLocations(graph.locations);
    try {
      const before = await snapshot(), key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { ids }))).toBeNull();
      expect(native).toHaveBeenCalledTimes(1); expect(native.mock.calls[0]?.[0]).toEqual(ids);
      expect(await connected.readChannels(ids)).toEqual([]);
      expect(await connected.readProductLinks(ids)).toEqual([]); expect(await connected.readLocationLinks(ids)).toEqual([]);
      const channels = await connected.readChannels(ids, true), productLinks = await connected.readProductLinks(ids, true),
        locationLinks = await connected.readLocationLinks(ids, true);
      expect(channels).toHaveLength(4); expect(productLinks).toHaveLength(8); expect(locationLinks).toHaveLength(8);
      for (const row of [...channels, ...productLinks, ...locationLinks]) expect(row.deleted_at).toEqual(expect.any(String));
      expect(productLinks.map(row => row.id).sort()).toEqual([...graph.productLinks].sort());
      expect(locationLinks.map(row => row.id).sort()).toEqual([...graph.locationLinks].sort());
      expect(await connected.readProducts(graph.products)).toEqual(productRows);
      expect(await connected.readLocations(graph.locations)).toEqual(locationRows);
      const emitted = (await events()).slice(before.events.length);
      expect(idsIn(emitted.filter(event => event.envelope.contract === "sales-channel.deleted"))).toEqual(ids);
      expect(idsIn(emitted.filter(event => event.envelope.contract === "sales_channel.sales-channel.deleted"))).toEqual([...ids].sort());
      const productDetached = internalEvent(connected.links.nativeServices.sales.softDeleteMethod),
        locationDetached = internalEvent(connected.links.nativeServices.location.softDeleteMethod);
      expect(idsIn(emitted.filter(event => event.envelope.contract === productDetached)).sort()).toEqual([...graph.productLinks].sort());
      expect(idsIn(emitted.filter(event => event.envelope.contract === locationDetached)).sort()).toEqual([...graph.locationLinks].sort());
      // Native Link events aggregate selected pivot IDs per family; Sales
      // Channel module and workflow events remain one message per ID.
      expect(emitted.filter(event => event.envelope.contract === productDetached)).toHaveLength(1);
      expect(emitted.filter(event => event.envelope.contract === locationDetached)).toHaveLength(1);
      expect(emitted).toHaveLength(10); expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect((await commits()).length - before.commits.length).toBe(1);
      expect((await facts()).length - before.facts.length).toBe(20);
      const committed = await snapshot();
      expect(await Effect.runPromise(host.run(key, { ids }))).toBeNull(); expect(native).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(host.run(key, { ids: [...ids].reverse() }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, { ids }))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await snapshot()).toEqual(committed);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("preserves missing, repeated and already-deleted requested IDs without duplicate lifecycle writes", async () => {
    const graph = await connected.seed("delete-membership"), id = graph.channels[0];
    if (id === undefined) throw new Error("Missing Channel seed");
    const host = await connected.prepare(), ids = ["missing-native-channel", id, id];
    const before = await snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids }))).toBeNull();
    const emitted = (await events()).slice(before.events.length);
    expect(idsIn(emitted.filter(event => event.envelope.contract === "sales-channel.deleted"))).toEqual(ids);
    expect(idsIn(emitted.filter(event => event.envelope.contract === "sales_channel.sales-channel.deleted"))).toEqual([id]);
    expect((await facts()).length - before.facts.length).toBe(3);
    const deleted = await snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [id] }))).toBeNull();
    expect(await rows()).toEqual(deleted.rows); expect(await facts()).toEqual(deleted.facts);
    const repeated = (await events()).slice(deleted.events.length);
    expect(repeated.map(event => event.envelope.contract)).toEqual(["sales-channel.deleted"]);
    expect(idsIn(repeated)).toEqual([id]);
    const missing = await snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: ["entirely-missing-native-channel"] }))).toBeNull();
    expect(await rows()).toEqual(missing.rows); expect(await facts()).toEqual(missing.facts);
    expect(idsIn((await events()).slice(missing.events.length))).toEqual(["entirely-missing-native-channel"]);
  }, 120_000);

  it("runs the real Store guard with every matching Store before any native mutation", async () => {
    const prefix = "delete-default-guard", ids = [prefix + "-channel-0", prefix + "-channel-1"] as const;
    const guarded = await prepareLogicalSalesChannelDeletion(driver, close => cleanup.push(close), {
      resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "sales_channel_delete_guard", projectId: "sales_channel_delete_guard", uuidOffset: 160_000 },
      stores: [{ id: "guard-store-a", defaultSalesChannelId: ids[0] }, { id: "guard-store-b", defaultSalesChannelId: ids[1] },
        { id: "guard-store-c", defaultSalesChannelId: ids[0] }],
    });
    await guarded.seed(prefix, 2);
    const host = await guarded.prepare();
    const store = vi.spyOn(StoreModuleService.prototype, "listStores"), sales = vi.spyOn(SalesChannelModuleService.prototype, "softDeleteSalesChannels"),
      link = vi.spyOn(Link.prototype, "delete");
    try {
      const before = await snapshot();
      for (const [requested, expected] of [
        [[ids[0]], [ids[0], ids[0]]],
        [[...ids].reverse(), [ids[0], ids[1], ids[0]]],
      ] as const) {
        const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: requested })));
        if (Result.isSuccess(result)) throw new Error("Native Store default-channel guard was bypassed");
        expect(failurePath(result.failure)).toContain("Cannot delete default sales channels: " + expected.join(", "));
      }
      expect(store).toHaveBeenCalledTimes(2); expect(sales).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled();
      expect(await guarded.readChannels(ids)).toHaveLength(2);
      expect(await guarded.readProductLinks(ids)).toHaveLength(2); expect(await guarded.readLocationLinks(ids)).toHaveLength(2);
      expect(await snapshot()).toEqual(before);
    } finally { store.mockRestore(); sales.mockRestore(); link.mockRestore(); }
  }, 240_000);

  it.each(["product", "location"] as const)("refuses a ninth affected %s pivot and rolls back all earlier pending lifecycle work", async family => {
    const graph = await connected.seed("delete-overflow-" + family, 1, family === "product" ? 9 : 1, family === "location" ? 9 : 1);
    const host = await connected.prepare(), before = await snapshot();
    const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.channels })));
    if (Result.isSuccess(result)) throw new Error("Native Link closure overflow unexpectedly committed");
    expect(failurePath(result.failure)).toContain("limitExceeded"); expect(await snapshot()).toEqual(before);
    expect(await connected.readChannels(graph.channels)).toHaveLength(1);
    expect(await connected.readProductLinks(graph.channels)).toHaveLength(family === "product" ? 9 : 1);
    expect(await connected.readLocationLinks(graph.channels)).toHaveLength(family === "location" ? 9 : 1);
  }, 180_000);

  it("rolls back Channels, both Link families, facts and events when native Link completion throws late", async () => {
    const graph = await connected.seed("delete-late", 2, 2, 2), host = await connected.prepare();
    const original = Link.prototype.delete; let completed = false;
    const native = vi.spyOn(Link.prototype, "delete").mockImplementation(async function (this: Link, ...args) {
      await Reflect.apply(original, this, args); completed = true;
      throw new Error("Late native Sales Channel Link deletion failure");
    });
    try {
      const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.channels })));
      if (Result.isSuccess(result)) throw new Error("Late native Link failure unexpectedly committed");
      expect(completed).toBe(true); expect(native).toHaveBeenCalledTimes(1);
      expect(failurePath(result.failure)).toContain("Late native Sales Channel Link deletion failure");
      expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 120_000);

  it("executes retained native compensators against deleted and already-active Channels and both Link families", async () => {
    const graph = await connected.seed("delete-restore", 2), ids = [...graph.channels].reverse();
    const endpointProducts = await connected.readProducts(graph.products), endpointLocations = await connected.readLocations(graph.locations);
    const deletion = await connected.prepare(), restore = await connected.prepareRestore();
    expect(await Effect.runPromise(deletion.run(deletion.newRequestKey(), { ids }))).toBeNull();
    expect(await connected.readChannels(ids)).toEqual([]);
    expect(await connected.readProductLinks(ids)).toEqual([]); expect(await connected.readLocationLinks(ids)).toEqual([]);
    const nativeChannels = vi.spyOn(SalesChannelModuleService.prototype, "restoreSalesChannels"), nativeLinks = vi.spyOn(Link.prototype, "restore");
    const productAttached = internalEvent(connected.links.nativeServices.sales.restoreMethod),
      locationAttached = internalEvent(connected.links.nativeServices.location.restoreMethod);
    try {
      const before = await snapshot(), key = restore.newRequestKey();
      expect(await Effect.runPromise(restore.run(key, { ids }))).toBeNull();
      expect(nativeChannels).toHaveBeenCalledTimes(1); expect(nativeChannels.mock.calls[0]?.[0]).toEqual(ids);
      expect(nativeLinks).toHaveBeenCalledTimes(1); expect(nativeLinks.mock.calls[0]?.[0]).toEqual({ sales_channel: { sales_channel_id: ids } });
      const channels = await connected.readChannels(ids), productLinks = await connected.readProductLinks(ids),
        locationLinks = await connected.readLocationLinks(ids);
      expect(channels.map(row => row.id).sort()).toEqual([...ids].sort());
      expect(productLinks.map(row => row.id).sort()).toEqual([...graph.productLinks].sort());
      expect(locationLinks.map(row => row.id).sort()).toEqual([...graph.locationLinks].sort());
      for (const row of [...channels, ...productLinks, ...locationLinks]) expect(row.deleted_at).toBeNull();
      expect(await connected.readProducts(graph.products)).toEqual(endpointProducts);
      expect(await connected.readLocations(graph.locations)).toEqual(endpointLocations);
      const emitted = (await events()).slice(before.events.length);
      expect(emitted.every(event => event.envelope.internal)).toBe(true); expect(emitted).toHaveLength(4);
      expect(idsIn(emitted.filter(event => event.envelope.contract === "sales_channel.sales-channel.restored"))).toEqual([...ids].sort());
      expect(idsIn(emitted.filter(event => event.envelope.contract === productAttached)).sort()).toEqual([...graph.productLinks].sort());
      expect(idsIn(emitted.filter(event => event.envelope.contract === locationAttached)).sort()).toEqual([...graph.locationLinks].sort());
      expect((await facts()).length - before.facts.length).toBe(6); expect((await commits()).length - before.commits.length).toBe(1);

      const active = await snapshot();
      expect(await Effect.runPromise(restore.run(restore.newRequestKey(), { ids }))).toBeNull();
      expect(await rows()).toEqual(active.rows); expect(await facts()).toEqual(active.facts);
      const activeEvents = (await events()).slice(active.events.length);
      expect(activeEvents.every(event => event.envelope.internal)).toBe(true); expect(activeEvents).toHaveLength(4);
      expect(idsIn(activeEvents.filter(event => event.envelope.contract === "sales_channel.sales-channel.restored"))).toEqual([...ids].sort());
      expect(idsIn(activeEvents.filter(event => event.envelope.contract === productAttached)).sort()).toEqual([...graph.productLinks].sort());
      expect(idsIn(activeEvents.filter(event => event.envelope.contract === locationAttached)).sort()).toEqual([...graph.locationLinks].sort());
      expect(nativeChannels).toHaveBeenCalledTimes(2); expect(nativeLinks).toHaveBeenCalledTimes(2);
      const committed = await snapshot();
      expect(await Effect.runPromise(restore.run(key, { ids }))).toBeNull(); expect(await snapshot()).toEqual(committed);
      expect(nativeChannels).toHaveBeenCalledTimes(2); expect(nativeLinks).toHaveBeenCalledTimes(2);

      nativeChannels.mockClear(); nativeLinks.mockClear();
      const empty = await snapshot();
      expect(await Effect.runPromise(restore.run(restore.newRequestKey(), { ids: [] }))).toBeNull();
      expect(nativeChannels).not.toHaveBeenCalled(); expect(nativeLinks).toHaveBeenCalledTimes(1);
      expect(nativeLinks.mock.calls[0]?.[0]).toEqual({ sales_channel: { sales_channel_id: [] } });
      expect(await rows()).toEqual(empty.rows); expect(await facts()).toEqual(empty.facts); expect(await events()).toEqual(empty.events);
    } finally { nativeChannels.mockRestore(); nativeLinks.mockRestore(); }
  }, 180_000);

  it("isolates identical endpoint identities and request keys across two genuine scopes", async () => {
    const other = await prepareLogicalSalesChannelDeletion(driver, close => cleanup.push(close), {
      resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "sales_channel_delete_shop_b", projectId: "sales_channel_delete_shop_b", uuidOffset: 180_000 },
    });
    const first = await connected.seed("delete-shared"), second = await other.seed("delete-shared");
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey();
    expect(second).toEqual(first);
    expect(await Effect.runPromise(left.run(key, { ids: first.channels }))).toBeNull();
    expect(await other.readChannels(second.channels)).toHaveLength(1);
    expect(await other.readProductLinks(second.channels)).toHaveLength(1); expect(await other.readLocationLinks(second.channels)).toHaveLength(1);
    expect(await Effect.runPromise(right.run(key, { ids: second.channels }))).toBeNull();
    expect(await connected.readChannels(first.channels)).toEqual([]); expect(await other.readChannels(second.channels)).toEqual([]);
    const committed = await snapshot();
    expect(await Effect.runPromise(left.run(key, { ids: first.channels }))).toBeNull();
    expect(await Effect.runPromise(right.run(key, { ids: second.channels }))).toBeNull();
    expect(await snapshot()).toEqual(committed);
  }, 240_000);
});
