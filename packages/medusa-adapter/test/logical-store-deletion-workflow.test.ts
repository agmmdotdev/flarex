import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { StoreModuleService } from "@medusajs/store/services";
import { buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { CommerceTransactionError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { prepareLogicalStoreDeletion, storeDeletionGraph } from "./support/logical-store-deletion-fixture";
import { makeStoreGuardCommands } from "../src/modules/store/service";
import { prepareStoreDeletionWorkflow } from "../src/workflows/store/delete";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalStoreDeletion>>;
let sharedCleanupCount = 0;
const graph = {
  maximum: storeDeletionGraph("store-delete-maximum", 4, 2, 2),
  membership: storeDeletionGraph("store-delete-membership"),
  history: storeDeletionGraph("store-delete-history", 1, 3, 3, { currencies: 2, locales: 1 }),
  currencyOverflow: storeDeletionGraph("store-delete-currency-overflow", 1, 9, 1, { currencies: 8 }),
  localeOverflow: storeDeletionGraph("store-delete-locale-overflow", 1, 1, 9, { locales: 8 }),
  late: storeDeletionGraph("store-delete-late", 2),
  malformed: storeDeletionGraph("store-delete-malformed"),
  denied: storeDeletionGraph("store-delete-denied"),
  restore: storeDeletionGraph("store-delete-restore", 4, 2, 2, { currencies: 1, locales: 1 }),
  scope: storeDeletionGraph("store-delete-scope"),
  neighbor: storeDeletionGraph("store-delete-neighbor"),
  competing: storeDeletionGraph("store-delete-competing"),
};
const identities = (value: ReturnType<typeof storeDeletionGraph>) => [...value.stores, ...value.currencies, ...value.locales];
const name = (objectName: "store" | "store_currency" | "store_locale", action: "deleted" | "restored") =>
  buildModuleResourceEventName({ prefix: "store", objectName, action });
function failurePath(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? failurePath(reason.error)
    : reason._tag === "Die" ? failurePath(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...failurePath(value.cause)];
  return value instanceof Error ? [value.message, ...failurePath(value.cause)] : [];
}
const idsIn = (events: Awaited<ReturnType<typeof connected.snapshot>>["events"]) => events.flatMap(event => {
  const message = event.envelope.message;
  if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing native Store event identity");
  return Array.isArray(message.data.id) ? message.data.id : [message.data.id];
});

describe("native Store deletion on shared logical storage", { concurrent: false }, () => {
  beforeAll(async () => {
    connected = await prepareLogicalStoreDeletion(driver, close => cleanup.push(close), Object.values(graph).flatMap(value => value.rows));
    sharedCleanupCount = cleanup.length;
  }, 240_000);
  afterEach(async () => { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("retains both native empty calls and refuses malformed raw IDs before callbacks", async () => {
    const host = await connected.prepare(), store = vi.spyOn(StoreModuleService.prototype, "softDeleteStores"), link = vi.spyOn(Link.prototype, "delete");
    try {
      const before = await connected.snapshot();
      for (const input of [{ ids: "scalar" }, { ids: [""] }, { ids: ["a", "b", "c", "d", "e"] }, { ids: [], extra: true }])
        // @ts-expect-error Deliberately exercise rejected public boundary input.
        expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))).toBe(true);
      expect(store).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
      const key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull();
      expect(store).toHaveBeenCalledTimes(1); expect(store.mock.calls[0]?.[0]).toEqual([]);
      expect(await store.mock.results[0]?.value).toEqual({});
      expect(link).toHaveBeenCalledTimes(1); expect(link.mock.calls[0]?.[0]).toEqual({ store: { store_id: [] } });
      expect(await link.mock.results[0]?.value).toEqual([null, {}]);
      const after = await connected.snapshot();
      expect(after.rows).toEqual(before.rows); expect(after.rowChanges).toEqual(before.rowChanges); expect(after.events).toEqual(before.events);
      expect(after.commits).toHaveLength(before.commits.length + 1);
      expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull(); expect(await connected.snapshot()).toEqual(after);
      expect(store).toHaveBeenCalledTimes(1); expect(link).toHaveBeenCalledTimes(1);
    } finally { store.mockRestore(); link.mockRestore(); }
  }, 120_000);

  it("cascades four Stores and eight rows per child family, with exact maps/events, protected neighbors and replay", async () => {
    const selected = graph.maximum, ids = [...selected.stores].reverse();
    const host = await connected.prepare(), changed = await connected.prepare("e".repeat(64));
    const store = vi.spyOn(StoreModuleService.prototype, "softDeleteStores"), link = vi.spyOn(Link.prototype, "delete");
    const original = await connected.read(identities(selected)), neighbor = await connected.read(identities(graph.neighbor));
    try {
      const before = await connected.snapshot(), key = host.newRequestKey(); let calls = 0;
      expect(await Effect.runPromise(host.run(key, { ids }).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }), Effect.ensuring(Effect.sync(() => console.info("Store deletion maximum calls", calls)))))).toBeNull();
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64);
      expect(store).toHaveBeenCalledTimes(1); expect(store.mock.calls[0]?.[0]).toEqual(ids);
      expect(await store.mock.results[0]?.value).toEqual({ store_id: selected.stores,
        store_currency_id: selected.currencies, store_locale_id: selected.locales });
      // The native Store step discards its complete module map and forwards
      // raw requested IDs to genuine Link dispatch.
      expect(link.mock.calls[0]?.[0]).toEqual({ store: { store_id: ids } });
      expect(await connected.read(identities(selected), false)).toEqual([]);
      const remaining = await connected.read(identities(selected));
      for (const row of original) expect(remaining.find(value => value.id === row.id)).toEqual({ ...row,
        deleted_at: expect.any(String), updated_at: expect.any(String) });
      expect(await connected.read(identities(graph.neighbor))).toEqual(neighbor);
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      for (const [object, expected] of [["store", selected.stores], ["store_currency", selected.currencies], ["store_locale", selected.locales]] as const)
        expect(idsIn(emitted.filter(event => event.envelope.contract === name(object, "deleted")))).toEqual(expected);
      expect(emitted).toHaveLength(20); expect(emitted.every(event => event.envelope.internal)).toBe(true);
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect(after.rowChanges).toHaveLength(before.rowChanges.length + 20); expect(after.commits).toHaveLength(before.commits.length + 1);
      const changes = new Set(after.rowChanges.slice(before.rowChanges.length).map(row => `${row.scopeUuid}:${row.tableId}:${Buffer.from(row.rowId).toString("hex")}`));
      const protectedPointers = (rows: typeof after.rows) => rows.filter(row => !changes.has(`${row.scopeUuid}:${row.tableId}:${Buffer.from(row.rowId).toString("hex")}`));
      expect(protectedPointers(after.rows)).toEqual(protectedPointers(before.rows));
      expect(await Effect.runPromise(host.run(key, { ids }))).toBeNull(); expect(store).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(host.run(key, { ids: [...ids].reverse() }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, { ids }))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await connected.snapshot()).toEqual(after);
    } finally { store.mockRestore(); link.mockRestore(); }
  }, 180_000);

  it("preserves raw duplicate/missing membership for Link dispatch while module lifecycle uses actual live roots", async () => {
    const selected = graph.membership, id = selected.stores[0];
    if (id === undefined) throw new Error("Missing Store membership seed");
    const host = await connected.prepare(), store = vi.spyOn(StoreModuleService.prototype, "softDeleteStores"), link = vi.spyOn(Link.prototype, "delete");
    try {
      const before = await connected.snapshot(), ids = ["missing-native-store", id, id];
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids }))).toBeNull();
      expect(await store.mock.results[0]?.value).toEqual({ store_id: [id], store_currency_id: selected.currencies, store_locale_id: selected.locales });
      expect(link.mock.calls[0]?.[0]).toEqual({ store: { store_id: ids } });
      const after = await connected.snapshot(); expect(after.rowChanges).toHaveLength(before.rowChanges.length + 3);
      expect(idsIn(after.events.slice(before.events.length))).toEqual(identities(selected));
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [id, "missing-native-store"] }))).toBeNull();
      expect(await store.mock.results[1]?.value).toEqual({});
      expect(link.mock.calls[1]?.[0]).toEqual({ store: { store_id: [id, "missing-native-store"] } });
      const repeated = await connected.snapshot();
      expect(repeated.rows).toEqual(after.rows); expect(repeated.rowChanges).toEqual(after.rowChanges); expect(repeated.events).toEqual(after.events);
    } finally { store.mockRestore(); link.mockRestore(); }
  }, 120_000);

  it("updates complete predeleted child history and emits native deleted events for every selected descendant", async () => {
    const selected = graph.history, beforeRows = await connected.read(identities(selected)), host = await connected.prepare();
    const before = await connected.snapshot();
    expect(beforeRows.filter(row => typeof row.deleted_at === "string")).toHaveLength(3);
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: selected.stores }))).toBeNull();
    const after = await connected.snapshot(), remaining = await connected.read(identities(selected));
    for (const row of beforeRows) expect(remaining.find(value => value.id === row.id)).toEqual({ ...row,
      deleted_at: expect.any(String), updated_at: expect.any(String) });
    expect(remaining.every(row => row.deleted_at !== "2026-10-17T00:00:00.000Z")).toBe(true);
    expect(after.rowChanges).toHaveLength(before.rowChanges.length + 7);
    const emitted = after.events.slice(before.events.length);
    expect(idsIn(emitted)).toEqual(identities(selected));
    expect(emitted.map(event => event.envelope.contract)).toEqual([
      name("store", "deleted"), ...selected.currencies.map(() => name("store_currency", "deleted")),
      ...selected.locales.map(() => name("store_locale", "deleted")),
    ]);
  }, 120_000);

  it.each(["currencyOverflow", "localeOverflow"] as const)("refuses ninth historical descendant in %s even when only one is live", async key => {
    const selected = graph[key], host = await connected.prepare(), before = await connected.snapshot();
    const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: selected.stores })));
    if (Result.isSuccess(result)) throw new Error("Historical Store closure overflow committed");
    expect(failurePath(result.failure)).toContain("limitExceeded"); expect(await connected.snapshot()).toEqual(before);
    expect(await connected.read(identities(selected))).toHaveLength(11);
  }, 120_000);

  it("rolls back both child families, complete history, facts, events and outcomes after late native Link failure", async () => {
    const host = await connected.prepare(), original = Link.prototype.delete; let completed = false;
    const link = vi.spyOn(Link.prototype, "delete").mockImplementation(async function (this: Link, ...args) {
      await Reflect.apply(original, this, args); completed = true; throw new Error("Late native Store Link failure");
    });
    try {
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.late.stores })));
      if (Result.isSuccess(result)) throw new Error("Late Store Link failure committed");
      expect(completed).toBe(true); expect(failurePath(result.failure)).toContain("Late native Store Link failure");
      expect(await connected.snapshot()).toEqual(before);
    } finally { link.mockRestore(); }
  }, 120_000);

  it("authenticates every complete native output field even though the native Store step discards that output", async () => {
    const host = await connected.prepare(), original = StoreModuleService.prototype.softDeleteStores;
    for (const field of ["store_id", "store_currency_id", "store_locale_id", "invented_alias"] as const) {
      const store = vi.spyOn(StoreModuleService.prototype, "softDeleteStores").mockImplementation(async function (this: StoreModuleService, ...args) {
        const result = await Reflect.apply(original, this, args); return { ...result, [field]: ["invented-native-identity"] };
      });
      try {
        const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.malformed.stores })));
        expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
      } finally { store.mockRestore(); }
    }
  }, 120_000);

  it("poisons a caught sibling hard delete and revokes the captured Store callback", async () => {
    const host = await connected.prepare(), original = StoreModuleService.prototype.softDeleteStores;
    let caught = false, escaped: (() => Promise<unknown>) | undefined;
    const store = vi.spyOn(StoreModuleService.prototype, "softDeleteStores").mockImplementation(async function (this: StoreModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      try { await this.deleteStores(graph.denied.stores); } catch { caught = true; }
      return result;
    });
    try {
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.denied.stores })));
      expect(caught).toBe(true); expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
      if (escaped === undefined) throw new Error("Native Store callback was not captured");
      await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(before);
    } finally { store.mockRestore(); }
  }, 120_000);

  it("explicitly invokes genuine retained inverses against deleted/active roots and children, including truthy empty Link groups", async () => {
    const selected = graph.restore, host = await connected.prepare(), restore = await connected.prepareRestore();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [...selected.stores].reverse() }))).toBeNull();
    const originalRestore = Link.prototype.restore;
    const store = vi.spyOn(StoreModuleService.prototype, "restoreStores"), link = vi.spyOn(Link.prototype, "restore");
    try {
      let restoredBeforeFailure = false;
      const lateError = new Error("Late native Store Link restore failure");
      link.mockImplementationOnce(async function (this: Link, ...args) {
        await Reflect.apply(originalRestore, this, args);
        restoredBeforeFailure = true;
        throw lateError;
      });
      const beforeFailure = await connected.snapshot();
      const failed = await Effect.runPromiseExit(restore.run(restore.newRequestKey(), { ids: selected.stores }));
      expect(Exit.isFailure(failed)).toBe(true); expect(restoredBeforeFailure).toBe(true);
      if (Exit.isFailure(failed)) {
        expect(failurePath(failed.cause)).toContain("rollbackOnly");
        expect(failurePath(failed.cause)).toContain(lateError.message);
        expect(failed.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === lateError)).toBe(true);
      }
      expect(await connected.snapshot()).toEqual(beforeFailure);
      for (const alreadyActive of [false, true]) {
        const before = await connected.snapshot(), ids = [...selected.stores].reverse(); let calls = 0;
        expect(await Effect.runPromise(restore.run(restore.newRequestKey(), { ids }).pipe(Effect.provideService(ExecutionDiagnostics, {
          observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
        }), Effect.ensuring(Effect.sync(() => console.info("Store deletion retained inverse calls", alreadyActive, calls)))))).toBeNull();
        expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64);
        expect(store.mock.lastCall?.[0]).toEqual(ids); expect(link.mock.lastCall?.[0]).toEqual({ store: { store_id: ids } });
        expect(await connected.read(identities(selected), false)).toHaveLength(20);
        const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
        expect(idsIn(emitted)).toEqual(identities(selected));
        for (const [object, ids] of [["store", selected.stores], ["store_currency", selected.currencies], ["store_locale", selected.locales]] as const)
          expect(idsIn(emitted.filter(event => event.envelope.contract === name(object, "restored")))).toEqual(ids);
        expect(emitted.every(event => event.envelope.internal)).toBe(true);
        expect(after.rowChanges).toHaveLength(before.rowChanges.length + (alreadyActive ? 0 : 20));
      }
      store.mockClear(); link.mockClear(); const before = await connected.snapshot();
      expect(await Effect.runPromise(restore.run(restore.newRequestKey(), { ids: [] }))).toBeNull();
      expect(store).not.toHaveBeenCalled(); expect(link).toHaveBeenCalledTimes(1);
      expect(link.mock.calls[0]?.[0]).toEqual({ store: { store_id: [] } });
      const after = await connected.snapshot();
      expect(after.rows).toEqual(before.rows); expect(after.rowChanges).toEqual(before.rowChanges); expect(after.events).toEqual(before.events);
    } finally { store.mockRestore(); link.mockRestore(); }
  }, 180_000);

  it.skipIf(driver !== "postgres")("rejects one of two genuine Store deletions that reach the same pending cascade before settlement", async () => {
    const selected = graph.competing, left = await connected.prepare(), right = await connected.prepare();
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const original = StoreModuleService.prototype.softDeleteStores;
    let arrived = 0;
    const native = vi.spyOn(StoreModuleService.prototype, "softDeleteStores").mockImplementation(async function (this: StoreModuleService, ...args) {
      const result = await Reflect.apply(original, this, args);
      arrived++;
      if (arrived === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release));
      return result;
    });
    try {
      const before = await connected.snapshot();
      const outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(left.run(left.newRequestKey(), { ids: selected.stores }).pipe(Effect.timeout(45_000)));
        const second = yield* Effect.forkChild(right.run(right.newRequestKey(), { ids: selected.stores }).pipe(Effect.timeout(45_000)));
        // Both genuine methods have already selected and changed the same
        // roots and both child families. Neither root has settled yet.
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000), Effect.ensuring(Deferred.succeed(release, undefined)));
        return [yield* Fiber.await(first), yield* Fiber.await(second)];
      })));
      const successes = outcomes.filter(Exit.isSuccess), failures = outcomes.filter(Exit.isFailure);
      console.info("Competing native Store deletion outcomes", outcomes.map(outcome => Exit.isSuccess(outcome)
        ? { success: outcome.value } : { failures: failurePath(outcome.cause) }));
      expect(arrived).toBe(2); expect(native).toHaveBeenCalledTimes(2);
      expect(successes).toHaveLength(1); expect(successes[0]?.value).toBeNull();
      expect(failures).toHaveLength(1); expect(failurePath(failures[0]?.cause)).toContain("writeConflict");
      for (const result of native.mock.results) expect(await result.value).toEqual({ store_id: selected.stores,
        store_currency_id: selected.currencies, store_locale_id: selected.locales });
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      expect(after.commits).toHaveLength(before.commits.length + 1);
      expect(after.rowChanges).toHaveLength(before.rowChanges.length + 3);
      expect(after.revisions).toHaveLength(before.revisions.length + 3);
      expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
      expect(emitted).toHaveLength(3); expect(idsIn(emitted)).toEqual(identities(selected));
      expect(emitted.map(event => event.envelope.contract)).toEqual([
        name("store", "deleted"), name("store_currency", "deleted"), name("store_locale", "deleted"),
      ]);
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect(await connected.read(identities(selected), false)).toEqual([]);
      expect(await connected.read(identities(selected))).toHaveLength(3);
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
      native.mockRestore();
    }
  }, 120_000);


  it("retains the real read-only Store guard after native module registration and refuses its use as a deletion profile", async () => {
    const guard = await Effect.runPromise(makeStoreGuardCommands());
    const native = vi.spyOn(StoreModuleService.prototype, "softDeleteStores");
    try {
      const before = await connected.snapshot();
      const invalid = await Effect.runPromise(Effect.result(prepareStoreDeletionWorkflow({ ...connected.options,
        modules: { store: { ...connected.options.modules.store,
          // @ts-expect-error The authentic read-only Store profile has different methods.
          module: guard.workflow,
        } } })));
      expect(invalid).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
      expect(native).not.toHaveBeenCalled();
      const active = await connected.read(Object.values(graph).flatMap(value => value.stores), false);
      expect(await connected.readDefaultChannelGuard()).toEqual(active.map(() => ({ default_sales_channel_id: "protected-channel" })));
      expect(active.length).toBeGreaterThan(0); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  });

  it("isolates identical Store/child identities and request keys in a second genuine scope", async () => {
    const other = await prepareLogicalStoreDeletion(driver, close => cleanup.push(close), graph.scope.rows, {
      resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "store_delete_shop_b", projectId: "store_delete_shop_b", uuidOffset: 210_000 },
    });
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey();
    const neighbor = await other.read(identities(graph.scope));
    expect(await Effect.runPromise(left.run(key, { ids: graph.scope.stores }))).toBeNull();
    expect(await other.read(identities(graph.scope))).toEqual(neighbor);
    expect(await Effect.runPromise(right.run(key, { ids: graph.scope.stores }))).toBeNull();
    expect(await connected.read(identities(graph.scope), false)).toEqual([]); expect(await other.read(identities(graph.scope), false)).toEqual([]);
    const committed = await connected.snapshot();
    expect(await Effect.runPromise(left.run(key, { ids: graph.scope.stores }))).toBeNull();
    expect(await Effect.runPromise(right.run(key, { ids: graph.scope.stores }))).toBeNull();
    expect(await connected.snapshot()).toEqual(committed);
  }, 240_000);
});
