import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { PricingModuleService } from "@medusajs/pricing/services";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { stockLocationDeletionResources, stockLocationDeletionCommandMs } from "../src/workflow/policy";
import { fulfillmentSetDeletionGraph } from "./support/logical-fulfillment-set-deletion-fixture";
import { StockLocationModuleService } from "@medusajs/stock-location/services";
import { Link } from "@medusajs/modules-sdk/link";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { CommerceTransactionError, commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxAppRowCurrent, fxSystemCommits, fxSystemCommitAppRowChanges, fxSystemIdempotency } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { workflowMethodDefinition, workflowModuleDefinition } from "../src/workflow/module";
import { prepareAtomicWorkflowHost, type AtomicWorkflowHostComposition } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { prepareStockLocationDeletionWorkflow, StockLocationDeletionInput } from "../src/workflows/stock-location/delete";
import { prepareLogicalStockLocationDeletion } from "./support/logical-stock-location-deletion-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = []; let sharedCleanupCount = 0;
let connected: Awaited<ReturnType<typeof prepareLogicalStockLocationDeletion>>;
const rows = () => connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId);
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
  if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing lifecycle event identity");
  return Array.isArray(message.data.id) ? message.data.id : [message.data.id];
});
const deleted = "stock_location.stock-location.deleted", restored = "stock.stock-location.restored";
function linkEvent(kind: "softDeleteMethod" | "restoreMethod") {
  const method = connected.links.nativeServices.location[kind];
  const definition = method === undefined ? undefined : workflowMethodDefinition(method);
  const name = definition?.moduleEvents[0];
  if (name === undefined || definition?.moduleEvents.length !== 1) throw new Error("Missing authenticated Link event");
  return name;
}
let installedOrdinal = 0;
async function installedScenario(name: string, graphs: readonly ReturnType<typeof fulfillmentSetDeletionGraph>[]) {
  const ordinal = ++installedOrdinal;
  return prepareLogicalStockLocationDeletion(driver, close => cleanup.push(close), { resource: connected.fixture.resource,
    fixtureIdentity: { deploymentId: "stock-installed-" + name + "-" + ordinal, projectId: "stock-installed-137", uuidOffset: 2_500_000 + ordinal * 10_000 } }, graphs);
}
function stockRetainedTap() {
  const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
  if (getter === undefined) throw new Error("Missing native retained response getter");
  const values: unknown[] = [];
  const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
    const value: unknown = Reflect.apply(getter, this, []);
    if (value !== null) values.push(structuredClone(value));
    return value;
  });
  return { get: () => {
    if (values.length !== 2) throw new Error("Expected genuine Stock Location and Link retained inputs");
    return { stock: values[0], link: values[1] };
  }, close: () => spy.mockRestore() };
}

describe("native Stock Location deletion on shared logical storage", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalStockLocationDeletion(driver, close => cleanup.push(close)); sharedCleanupCount = cleanup.length; }, 180_000);
  afterEach(async () => { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("selects mixed publication only for authenticated Shipping Pricing and its retained probes", async () => {
    expect(workflowModuleDefinition(connected.options.modules.pricing.module)?.source.profile).toBe("pricing-shipping-options");
    expect(Object.entries(connected.options.modules).filter(([, binding]) => binding.logicalPublication === "mixed").map(([name]) => name)).toEqual(["pricing"]);
    const captured: AtomicWorkflowHostComposition[] = [];
    const outcome = await Effect.runPromise(Effect.result(prepareStockLocationDeletionWorkflow({ ...connected.options,
      modules: { ...connected.options.modules,
        stock_location: { ...connected.options.modules.stock_location, logicalPublication: "mixed" },
        providerLinks: { ...connected.options.modules.providerLinks, logicalPublication: "mixed" } },
      execution: { ...connected.execution, prepare: composition => {
        captured.push(composition); return Effect.fail(commerceError("invalidAuthority"));
      } },
    })));
    expect(Result.isFailure(outcome)).toBe(true); expect(captured).toHaveLength(1);
    expect(captured[0]?.participants).toHaveLength(7);
    expect(captured[0]?.requestCommandMs).toBe(stockLocationDeletionCommandMs);
    expect(captured[0]?.participants.filter(member => member.logicalPublication === "mixed").map(member =>
      Schema.decodeUnknownSync(Schema.Struct({ sourceKey: Schema.String }))(member.logicalStorage?.source).sourceKey)).toEqual(["medusa.pricing"]);
  });

  it("retains real empty module/Link calls and rejects malformed input before callbacks", async () => {
    const host = await connected.prepare(), stock = vi.spyOn(StockLocationModuleService.prototype, "softDeleteStockLocations"), link = vi.spyOn(Link.prototype, "delete");
    try {
      const before = await snapshot();
      for (const input of [{ ids: "scalar" }, { ids: [""] }, { ids: ["a", "b", "c", "d", "e"] }, { ids: [], extra: true }])
        // @ts-expect-error Deliberately invalid public boundary inputs.
        expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))).toBe(true);
      expect(stock).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
      const key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull();
      expect(stock).toHaveBeenCalledTimes(1); expect(stock.mock.calls[0]?.[0]).toEqual([]);
      expect(await stock.mock.results[0]?.value).toEqual({});
      expect(link).toHaveBeenCalledTimes(1); expect(link.mock.calls[0]?.[0]).toEqual({ stock_location: {} });
      expect(await link.mock.results[0]?.value).toEqual([null, {}]);
      expect(await rows()).toEqual(before.rows); expect(await facts()).toEqual(before.facts); expect(await events()).toEqual(before.events);
      expect((await commits()).length - before.commits.length).toBe(1);
      const committed = await snapshot();
      expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull(); expect(await snapshot()).toEqual(committed);
      expect(stock).toHaveBeenCalledTimes(1); expect(link).toHaveBeenCalledTimes(1);
    } finally { stock.mockRestore(); link.mockRestore(); }
  }, 120_000);

  it("deletes four Locations and eight pivots while retaining Addresses, Channels, stock, reservations and Store default", async () => {
    const graph = await connected.seed("stock-delete-maximum", 4, 2), first = graph.locations[0];
    if (first === undefined) throw new Error("Missing maximum seed");
    expect(await connected.seedProtectedInventory(first)).toMatchObject([{ location_id: first, quantity: 2 }]);
    const host = await connected.prepare(), changed = await connected.prepare("e".repeat(64)), ids = [...graph.locations].reverse();
    const stock = vi.spyOn(StockLocationModuleService.prototype, "softDeleteStockLocations"), link = vi.spyOn(Link.prototype, "delete");
    const addresses = await connected.readAddresses(graph.locations.map(id => id + "-address")), channels = await connected.readChannels(graph.channels);
    const original = await connected.readLocations(graph.locations), pivots = await connected.readLinks(graph.locations);
    try {
      const before = await snapshot(), key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { ids }))).toBeNull();
      expect(await connected.readLocations(ids)).toEqual([]); expect(await connected.readLinks(ids)).toEqual([]);
      const actual = [...ids].sort();
      expect(await stock.mock.results[0]?.value).toEqual({ stock_location_id: actual, location_id: actual });
      expect(link.mock.calls[0]?.[0]).toEqual({ stock_location: { stock_location_id: actual, location_id: actual } });
      const remaining = await connected.readLocations(ids, true), removedPivots = await connected.readLinks(ids, true);
      expect(remaining).toHaveLength(4); expect(removedPivots).toHaveLength(8);
      expect(remaining.map(row => row.id)).toEqual(ids);
      for (const row of original) expect(remaining.find(value => value.id === row.id))
        .toEqual({ ...row, deleted_at: expect.any(String), updated_at: expect.any(String) });
      expect(removedPivots.map(row => row.id).sort()).toEqual(pivots.map(row => row.id).sort());
      expect(removedPivots.every(row => typeof row.deleted_at === "string")).toBe(true);
      expect(await connected.readAddresses(graph.locations.map(id => id + "-address"))).toEqual(addresses);
      expect(await connected.readChannels(graph.channels)).toEqual(channels);
      const emitted = (await events()).slice(before.events.length), changedFacts = (await facts()).slice(before.facts.length);
      expect(emitted.map(event => event.envelope.contract)).toEqual([...actual.map(() => deleted), linkEvent("softDeleteMethod")]);
      expect(idsIn(emitted.filter(event => event.envelope.contract === deleted))).toEqual(actual);
      expect(idsIn(emitted.filter(event => event.envelope.contract === linkEvent("softDeleteMethod"))).sort()).toEqual(pivots.map(row => row.id).sort());
      expect(emitted.every(event => event.envelope.internal)).toBe(true); expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect(changedFacts).toHaveLength(12); expect((await commits()).length - before.commits.length).toBe(1);
      // All other installed rows, including the seeded Inventory item, level,
      // reservation and Store default, retain their exact committed pointers.
      const changedRows = new Set(changedFacts.map(fact => `${fact.tableId}:${Buffer.from(fact.rowId).toString("hex")}`));
      const protectedRows = before.rows.filter(row => !changedRows.has(`${row.tableId}:${Buffer.from(row.rowId).toString("hex")}`));
      const current = await rows();
      expect(current).toHaveLength(before.rows.length);
      expect(current.filter(row => !changedRows.has(`${row.tableId}:${Buffer.from(row.rowId).toString("hex")}`))).toEqual(protectedRows);
      const committed = await snapshot();
      expect(await Effect.runPromise(host.run(key, { ids }))).toBeNull(); expect(stock).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(host.run(key, { ids: [...ids].reverse() }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, { ids }))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await snapshot()).toEqual(committed);
    } finally { stock.mockRestore(); link.mockRestore(); }
  }, 180_000);

  it("uses actual membership and leaves new pivots on an already-deleted Location when it is requested again", async () => {
    const graph = await connected.seed("stock-delete-membership"), id = graph.locations[0];
    if (id === undefined) throw new Error("Missing membership seed");
    const host = await connected.prepare(), link = vi.spyOn(Link.prototype, "delete");
    try {
      const before = await snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: ["missing-native-location", id, id] }))).toBeNull();
      expect(link.mock.calls[0]?.[0]).toEqual({ stock_location: { stock_location_id: [id], location_id: [id] } });
      expect((await facts()).length - before.facts.length).toBe(2);
      const other = await connected.seed("stock-delete-later-channel", 0, 1);
      await connected.attach(id, other.channels);
      expect(await connected.readLinks([id])).toHaveLength(1);
      const deletedState = await snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [id, "missing-native-location"] }))).toBeNull();
      expect(link.mock.calls[1]?.[0]).toEqual({ stock_location: {} });
      expect(await connected.readLinks([id])).toHaveLength(1);
      expect(await rows()).toEqual(deletedState.rows); expect(await facts()).toEqual(deletedState.facts); expect(await events()).toEqual(deletedState.events);
      expect((await commits()).length - deletedState.commits.length).toBe(1);
    } finally { link.mockRestore(); }
  }, 120_000);

  it("keeps native Link errors as data but rolls back the root after a ninth-pivot refusal", async () => {
    const graph = await connected.seed("stock-delete-overflow", 1, 9), host = await connected.prepare();
    const original = Link.prototype.delete; let tuple: unknown;
    const native = vi.spyOn(Link.prototype, "delete").mockImplementation(async function (this: Link, ...args) {
      const result = await Reflect.apply(original, this, args); tuple = result; return result;
    });
    try {
      const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.locations })));
      if (Result.isSuccess(result)) throw new Error("Ninth pivot was admitted");
      expect(failurePath(result.failure)).toContain("limitExceeded");
      expect(tuple).toEqual([expect.any(Array), expect.any(Object)]);
      expect(await snapshot()).toEqual(before);
      expect(await connected.readLocations(graph.locations)).toHaveLength(1); expect(await connected.readLinks(graph.locations)).toHaveLength(9);
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["uncaught", "caught"] as const)("refuses %s nonempty native cascade errors after real writes without a durable prefix", async mode => {
    const graph = await connected.seed("stock-delete-native-cascade-error-" + mode);
    const serviceName = connected.links.nativeServices.location.routing.__joinerConfig.serviceName;
    if (serviceName === undefined) throw new Error("Missing genuine Link service identity");
    let caught: unknown, continued = false;
    const resources = Result.getOrThrow(prepareWorkflowResources({
      stock_location: { module: connected.options.modules.stock_location.module,
        methods: ["softDeleteStockLocations", "restoreStockLocations"], graph: false },
      location_fulfillment_set_links: { module: connected.options.modules.location_fulfillment_set_links.module,
        methods: ["softDelete", "restore"], graph: false, expose: false },
      fulfillment: { module: connected.options.modules.fulfillment.module,
        methods: ["softDeleteFulfillmentSets", "restoreFulfillmentSets"], graph: false, expose: false },
      sales_channel_location_links: { module: connected.options.modules.sales_channel_location_links.module,
        methods: ["softDelete", "restore"], graph: false, expose: false },
      providerLinks: { module: connected.options.modules.providerLinks.module, methods: ["softDelete", "restore"], graph: false, expose: false },
      priceSetLinks: { module: connected.options.modules.priceSetLinks.module, methods: ["softDelete", "restore"], graph: false, expose: false },
      pricing: { module: connected.options.modules.pricing.module, methods: ["softDeletePriceSets", "restorePriceSets"], graph: false, expose: false },
    }, true, { link: connected.links.resource }));
    const call = createStep("catch-native-stock-location-cascade-error", resources.callback(async (
      input: typeof StockLocationDeletionInput.Type, context,
    ) => {
      const identities = await context.resources.stock_location.softDeleteStockLocations([...input.ids]);
      const endpoint = {
        ...(identities.stock_location_id === undefined ? {} : { stock_location_id: [...identities.stock_location_id] }),
        ...(identities.location_id === undefined ? {} : { location_id: [...identities.location_id] }),
      };
      try { await context.resources.link.delete({ stock_location: endpoint }); } catch (error) { caught = error; }
      continued = true;
      return new StepResponse(null);
    }));
    const workflow = createWorkflow("caught-native-stock-location-cascade-error", (input: WorkflowData<typeof StockLocationDeletionInput.Type>) =>
      new WorkflowResponse(call(input)));
    const host = mode === "uncaught" ? await connected.prepare() : await Effect.runPromise(prepareAtomicWorkflowHost({
      execution: connected.execution, modules: connected.options.modules, operationScheduling: "queued",
      requestCallLimit: stockLocationDeletionResources.calls, requestEventLimit: stockLocationDeletionResources.eventMessages,
      requestByteLimit: stockLocationDeletionResources.commandBytes, requestCommandMs: stockLocationDeletionCommandMs,
      revision: "a".repeat(64), subscribers: connected.options.subscribers,
      workflow: { name: "caughtNativeStockLocationCascadeError", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: StockLocationDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents },
    }));
    if (mode === "caught") cleanup.push(() => Effect.runPromise(host.close));
    const original = Link.prototype.delete;
    let completed = false, tuple: Awaited<ReturnType<Link["delete"]>> | undefined;
    const native = vi.spyOn(Link.prototype, "delete").mockImplementation(async function (this: Link, ...args) {
      const result = await Reflect.apply(original, this, args);
      const reported = { serviceName,
        method: "softDelete", args: args[0], error: { name: "Error", message: "Native cascade refused after genuine partial work" } };
      tuple = [[reported], result[1]]; completed = true; return tuple;
    });
    try {
      const before = await snapshot(), outcomes = await connected.fixture.persistence.drizzle.select().from(fxSystemIdempotency);
      const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.locations })));
      expect(completed).toBe(true); expect(tuple?.[0]).toHaveLength(1);
      expect(Object.keys(tuple?.[1] ?? {})).not.toHaveLength(0);
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure", cause: tuple } });
      if (mode === "caught") {
        expect(caught).toMatchObject({ reason: "adapterFailure", cause: tuple });
        expect(continued).toBe(true);
      }
      expect(await snapshot()).toEqual(before);
      expect(await connected.fixture.persistence.drizzle.select().from(fxSystemIdempotency)).toEqual(outcomes);
      expect(await connected.readLocations(graph.locations)).toHaveLength(1);
      expect(await connected.readLinks(graph.locations)).toHaveLength(1);
    } finally { native.mockRestore(); }
  }, 120_000);

  it("deletes the live pivot within eight identities while retaining nine already-deleted pivots", async () => {
    const graph = await connected.seed("stock-delete-history", 1, 9), id = graph.locations[0];
    if (id === undefined) throw new Error("Missing history Location");
    await connected.detach(id, graph.channels);
    const history = await connected.readLinks([id], true);
    expect(history).toHaveLength(9); expect(history.every(row => typeof row.deleted_at === "string")).toBe(true);
    const added = await connected.seed("stock-delete-history-live", 0, 1); await connected.attach(id, added.channels);
    const active = await connected.readLinks([id]); expect(active).toHaveLength(1);
    const host = await connected.prepare(undefined, 8), before = await snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [id] }))).toBeNull();
    expect(await connected.readLinks([id])).toEqual([]);
    const after = await connected.readLinks([id], true);
    expect(after).toHaveLength(10);
    for (const row of history) expect(after.find(value => value.id === row.id)).toEqual(row);
    expect((await facts()).length - before.facts.length).toBe(2);
    const emitted = (await events()).slice(before.events.length);
    expect(emitted.map(event => event.envelope.contract)).toEqual([deleted, linkEvent("softDeleteMethod")]);
    expect(idsIn(emitted)).toEqual([id, active[0]?.id]);
  }, 180_000);

  it("rolls back after late Link failure and after malformed complete native alias results", async () => {
    const graph = await connected.seed("stock-delete-late", 2), host = await connected.prepare();
    const original = Link.prototype.delete; let completed = false;
    const link = vi.spyOn(Link.prototype, "delete").mockImplementation(async function (this: Link, ...args) {
      await Reflect.apply(original, this, args); completed = true; throw new Error("Late native Stock Location Link failure");
    });
    try {
      const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.locations })));
      if (Result.isSuccess(result)) throw new Error("Late Link failure committed");
      expect(completed).toBe(true); expect(failurePath(result.failure)).toContain("Late native Stock Location Link failure");
      expect(await snapshot()).toEqual(before);
    } finally { link.mockRestore(); }
    const originalStock = StockLocationModuleService.prototype.softDeleteStockLocations;
    const stock = vi.spyOn(StockLocationModuleService.prototype, "softDeleteStockLocations").mockImplementation(async function (this: StockLocationModuleService, ...args) {
      const result = await Reflect.apply(originalStock, this, args); return { ...result, location_id: ["invented-native-alias"] };
    });
    try {
      const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.locations })));
      expect(Result.isFailure(result)).toBe(true); expect(await snapshot()).toEqual(before);
    } finally { stock.mockRestore(); }
  }, 120_000);

  it("poisons caught sibling mutations and revokes a captured native callback after completion", async () => {
    const graph = await connected.seed("stock-delete-poison"), host = await connected.prepare();
    const original = StockLocationModuleService.prototype.softDeleteStockLocations;
    let caught = false, escaped: (() => Promise<unknown>) | undefined;
    const stock = vi.spyOn(StockLocationModuleService.prototype, "softDeleteStockLocations").mockImplementation(async function (this: StockLocationModuleService, ...args) {
      const result = await Reflect.apply(original, this, args);
      escaped = () => Reflect.apply(original, this, args);
      try { await this.deleteStockLocations(graph.locations); } catch { caught = true; }
      return result;
    });
    try {
      const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.locations })));
      expect(caught).toBe(true); expect(Result.isFailure(result)).toBe(true); expect(await snapshot()).toEqual(before);
      if (escaped === undefined) throw new Error("Native callback was not captured");
      await expect(escaped()).rejects.toBeDefined(); expect(await snapshot()).toEqual(before);
    } finally { stock.mockRestore(); }
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: graph.locations }))).toBeNull();
  }, 120_000);

  it("executes native retained compensators, including active restore events and truthy empty Link maps", async () => {
    const graph = await connected.seed("stock-delete-restore", 2), host = await connected.prepare(), restore = await connected.prepareRestore();
    const addresses = await connected.readAddresses(graph.locations.map(id => id + "-address"));
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: graph.locations }))).toBeNull();
    const stock = vi.spyOn(StockLocationModuleService.prototype, "restoreStockLocations"), link = vi.spyOn(Link.prototype, "restore");
    try {
      for (const alreadyActive of [false, true]) {
        const before = await snapshot();
        expect(await Effect.runPromise(restore.run(restore.newRequestKey(), { ids: graph.locations }))).toBeNull();
        expect(await connected.readLocations(graph.locations)).toHaveLength(2); expect(await connected.readLinks(graph.locations)).toHaveLength(2);
        expect(await connected.readAddresses(graph.locations.map(id => id + "-address"))).toEqual(addresses);
        const emitted = (await events()).slice(before.events.length);
        expect(emitted.map(event => event.envelope.contract)).toEqual([restored, restored, linkEvent("restoreMethod")]);
        expect(emitted.every(event => event.envelope.internal)).toBe(true);
        expect((await facts()).length - before.facts.length).toBe(alreadyActive ? 0 : 4);
      }
      stock.mockClear(); link.mockClear(); const before = await snapshot();
      expect(await Effect.runPromise(restore.run(restore.newRequestKey(), { ids: [] }))).toBeNull();
      expect(stock).not.toHaveBeenCalled(); expect(link).toHaveBeenCalledTimes(1); expect(link.mock.calls[0]?.[0]).toEqual({ stock_location: {} });
      expect(await rows()).toEqual(before.rows); expect(await facts()).toEqual(before.facts); expect(await events()).toEqual(before.events);
    } finally { stock.mockRestore(); link.mockRestore(); }
  }, 180_000);

  it("rolls back native work on cancellation and refuses the revoked continuation", async () => {
    const graph = await connected.seed("stock-delete-cancel"), host = await connected.prepare(), reached = await Effect.runPromise(Deferred.make<void>());
    const original = StockLocationModuleService.prototype.softDeleteStockLocations;
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const stock = vi.spyOn(StockLocationModuleService.prototype, "softDeleteStockLocations").mockImplementation(async function (this: StockLocationModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined));
      await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    try {
      const before = await snapshot();
      await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { ids: graph.locations }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      }));
      expect(await snapshot()).toEqual(before); finish?.();
      if (escaped === undefined) throw new Error("Missing revoked native continuation");
      await expect(escaped()).rejects.toBeDefined(); expect(await snapshot()).toEqual(before);
    } finally { finish?.(); stock.mockRestore(); }
  }, 120_000);

  it("refuses mismatched module identities before preparing the native root", async () => {
    const before = await snapshot();
    const result = await Effect.runPromise(Effect.result(prepareStockLocationDeletionWorkflow({ ...connected.options,
      modules: { ...connected.options.modules,
        // @ts-expect-error Deliberately forge a structurally wrong installed module at the runtime authority boundary.
        stock_location: { ...connected.options.modules.stock_location, module: connected.links.location.workflow } },
    })));
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    expect(await snapshot()).toEqual(before);
  });

  it.each([false, true])("preserves the full installed forest and actual retained Stock/Link inverse (history=%s)", async history => {
    const prefix = "stock-full-" + history, graph = fulfillmentSetDeletionGraph(prefix, { sets: 4, zones: 4, geos: 16, options: 8, rules: 16,
      links: 4, ...(history ? { history: { zones: 2, geos: 8, options: 4, rules: 8 } } : {}) });
    const fixture = await installedScenario("full-" + history, [graph]);
    const seeded = await fixture.seed(prefix, 4, 2), original = await fixture.readFulfillment(graph.allIds), addresses = await fixture.readAddresses(seeded.locations.map(id => id + "-address"));
    const tap = stockRetainedTap(), remove = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteFulfillmentSets"),
      restore = vi.spyOn(FulfillmentModuleService.prototype, "restoreFulfillmentSets"), link = vi.spyOn(Link.prototype, "restore");
    try {
      const host = await fixture.prepareRoundtrip(tap.get), before = await fixture.snapshot(); let calls = 0;
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: seeded.locations }).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }), Effect.ensuring(Effect.sync(() => process.stdout.write("StockLocation installed full forest retained inverse "
        + JSON.stringify({ history, boundedRequestEnter: calls }) + "\n")))))).toBeNull();
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(stockLocationDeletionResources.calls);
      expect(tap.get()).toEqual({ stock: seeded.locations, link: { stock_location: { stock_location_id: seeded.locations, location_id: seeded.locations } } });
      expect(remove).toHaveBeenCalledTimes(1); expect(restore).toHaveBeenCalledTimes(1);
      expect(remove.mock.calls[0]?.[0]).toEqual({ id: graph.ids });
      expect(remove.mock.calls[0]?.[1]?.returnLinkableKeys).toContain("fulfillment_address_id");
      expect(restore.mock.calls[0]?.[0]).toEqual({ id: graph.ids });
      expect(await link.mock.results[0]?.value).toMatchObject([null, { fulfillment: { fulfillment_set_id: graph.ids } }]);
      const current = await fixture.readFulfillment(graph.allIds);
      expect(current).toHaveLength(48); expect(current.every(row => row.deleted_at === null)).toBe(true);
      const stable = (row: typeof original[number]) => { const { deleted_at: _deleted, updated_at: _updated, ...rest } = row; return rest; };
      expect(current.map(stable)).toEqual(original.map(stable));
      expect(await fixture.readAddresses(seeded.locations.map(id => id + "-address"))).toEqual(addresses);
      expect(await fixture.readLocations(seeded.locations)).toHaveLength(4); expect(await fixture.readLinks(seeded.locations)).toHaveLength(8);
      expect(await fixture.readSetLinks(seeded.locations)).toHaveLength(4);
      const after = await fixture.snapshot(), eventKey = (event: typeof after.events[number]) => `${event.scopeUuid}:${event.epochUuid}:${event.commitSeq}:${event.eventOrdinal}`;
      const old = new Set(before.events.map(eventKey)), emitted = after.events.filter(event => !old.has(eventKey(event)));
      // Native descendant UPDATE uses only the reached FK predicate, including
      // historical rows. All four Set roots are active in both seed cohorts.
      const fulfillmentDeleted = emitted.filter(event => event.envelope.contract.startsWith("fulfillment.") && event.envelope.contract.endsWith(".deleted"));
      const fulfillmentRestored = emitted.filter(event => event.envelope.contract.startsWith("fulfillment.") && event.envelope.contract.endsWith(".restored"));
      expect(fulfillmentDeleted).toHaveLength(48); expect(fulfillmentRestored).toHaveLength(48);
      expect(idsIn(fulfillmentDeleted).sort()).toEqual([...graph.allIds].sort());
      expect(idsIn(fulfillmentRestored).sort()).toEqual([...graph.allIds].sort());
      expect(emitted).toHaveLength(108); expect(emitted.every(event => event.envelope.internal)).toBe(true);
      expect(emitted.filter(event => event.envelope.contract === restored)).toHaveLength(4);
      expect(after.commits).toHaveLength(before.commits.length + 1);
    } finally { tap.close(); remove.mockRestore(); restore.mockRestore(); link.mockRestore(); }
  }, 300_000);

  it("refuses fifth reached Sets and ninth historical locfs rows without any durable prefix", async () => {
    for (const [name, sets, links] of [["fifth-set", 5, 5], ["ninth-history", 4, 9]] as const) {
      const graph = fulfillmentSetDeletionGraph("stock-overflow-" + name, { sets, zones: 0, links, historicalLinks: links });
      graph.links.forEach((row, index) => { row.row.stock_location_id = "stock-overflow-" + name + "-location-" + Math.floor(index / sets); });
      const fixture = await installedScenario(name, [graph]), seeded = await fixture.seed("stock-overflow-" + name, 4, 0), host = await fixture.prepare();
      const before = await fixture.snapshot(), outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: seeded.locations })));
      expect(Result.isFailure(outcome)).toBe(true);
      if (Result.isFailure(outcome)) expect(failurePath(outcome.failure)).toContain("limitExceeded");
      expect(await fixture.snapshot()).toEqual(before);
      expect(await fixture.readSetLinks(seeded.locations, true)).toHaveLength(links);
    }
  }, 300_000);

  it.each([false, true])("runs the full 48-row Fulfillment and 72-row Pricing closure with genuine retained inverses (history=%s)", async historical => {
    const prefix = "stock-shipping-" + historical, graph = fulfillmentSetDeletionGraph(prefix, {
      sets: 4, zones: 4, geos: 16, options: 8, rules: 16, links: 4, shipping: { historical },
    });
    const shipping = graph.shipping;
    if (shipping === undefined) throw new Error("Missing complete Shipping deletion closure");
    const fixture = await installedScenario("shipping-" + historical, [graph]), seeded = await fixture.seed(prefix, 4, 2), tap = stockRetainedTap();
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePriceSets"), restore = vi.spyOn(PricingModuleService.prototype, "restorePriceSets");
    const stable = (row: Record<string, unknown>) => { const { updated_at: _updated, deleted_at: _deleted, ...rest } = row; return rest; };
    try {
      const host = await fixture.prepareRoundtrip(tap.get), before = await fixture.snapshot(), original = await fixture.readFulfillment(shipping.allIds),
        protectedProviders = await fixture.readFulfillment(shipping.providers), key = host.newRequestKey(); let calls = 0;
      expect(await Effect.runPromise(host.run(key, { ids: seeded.locations }).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }), Effect.ensuring(Effect.sync(() => process.stdout.write("StockLocation 48 Fulfillment +72 Pricing retained inverse request completed "
        + JSON.stringify({ historical, boundedRequestEnter: calls }) + "\n")))))).toBeNull();
      expect(remove).toHaveBeenCalledTimes(1); expect(restore).toHaveBeenCalledTimes(1);
      expect(restore.mock.calls[0]?.[0]).toEqual({ id: expect.arrayContaining(shipping.priceSetIds) });
      expect(await fixture.readProviderLinks(seeded.locations)).toHaveLength(8);
      expect(await fixture.readPriceSetLinks(graph.optionIds)).toHaveLength(8);
      const current = await fixture.readFulfillment(shipping.allIds);
      expect(current).toHaveLength(88); expect(current.every(row => row.deleted_at === null)).toBe(true);
      expect(current.map(stable)).toEqual(original.map(stable));
      expect((await fixture.readFulfillment(graph.allIds)).every(row => row.deleted_at === null)).toBe(true);
      expect(await fixture.readFulfillment(shipping.providers)).toEqual(protectedProviders);
      const after = await fixture.snapshot(), eventKey = (event: typeof after.events[number]) => `${event.scopeUuid}:${event.epochUuid}:${event.commitSeq}:${event.eventOrdinal}`;
      const old = new Set(before.events.map(eventKey)), emitted = after.events.filter(event => !old.has(eventKey(event)));
      expect(emitted.filter(event => event.envelope.contract.startsWith("pricing.") && event.envelope.contract.endsWith(".restored"))).toHaveLength(72);
      process.stdout.write("StockLocation 48 Fulfillment +72 Pricing +8 locfp +8 SOPS retained inverse "
        + JSON.stringify({ historical, calls, eventMessages: emitted.length }) + "\n");
      expect(calls).toBeLessThanOrEqual(stockLocationDeletionResources.calls);
      expect(emitted.length).toBeLessThanOrEqual(stockLocationDeletionResources.eventMessages);
      expect(after.commits).toHaveLength(before.commits.length + 1);
      expect(await Effect.runPromise(host.run(key, { ids: seeded.locations }))).toBeNull(); expect(await fixture.snapshot()).toEqual(after);
      const again = await fixture.prepareRestore();
      expect(await Effect.runPromise(again.run(again.newRequestKey(), { ids: seeded.locations }))).toBeNull();
      expect((await fixture.readFulfillment(shipping.allIds)).map(stable)).toEqual(original.map(stable));
    } finally { tap.close(); remove.mockRestore(); restore.mockRestore(); }
  }, 300_000);

  it("rolls back full installed Link, Fulfillment and Pricing work after a retained inverse failure", async () => {
    const prefix = "stock-installed-late", graph = fulfillmentSetDeletionGraph(prefix, { geos: 1, options: 1, rules: 1, links: 1, shipping: {} });
    const fixture = await installedScenario("late", [graph]), seeded = await fixture.seed(prefix), tap = stockRetainedTap();
    try {
      const host = await fixture.prepareRoundtrip(tap.get, true), before = await fixture.snapshot();
      const outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: seeded.locations })));
      expect(Result.isFailure(outcome)).toBe(true); if (Result.isFailure(outcome)) expect(failurePath(outcome.failure)).toContain("Late installed Stock Location retained inverse failure");
      expect(await fixture.snapshot()).toEqual(before);
    } finally { tap.close(); }
  }, 180_000);

  it("cancels after all installed participants stage and revokes the native Link continuation", async () => {
    const prefix = "stock-installed-cancel", graph = fulfillmentSetDeletionGraph(prefix, { geos: 1, options: 1, rules: 1, links: 1, shipping: {} });
    const fixture = await installedScenario("cancel", [graph]), seeded = await fixture.seed(prefix), host = await fixture.prepare();
    const reached = Deferred.makeUnsafe<void>(), finished = Deferred.makeUnsafe<void>(), original = Link.prototype.delete;
    let finish: (() => void) | undefined;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const pricingOriginal = PricingModuleService.prototype.softDeletePriceSets;
    let escapedPricing: (() => Promise<unknown>) | undefined;
    const pricing = vi.spyOn(PricingModuleService.prototype, "softDeletePriceSets").mockImplementation(async function (this: PricingModuleService, ...args) {
      const result = await Reflect.apply(pricingOriginal, this, args); escapedPricing = () => Reflect.apply(pricingOriginal, this, args); return result;
    });
    const link = vi.spyOn(Link.prototype, "delete").mockImplementation(async function (this: Link, ...args) {
      const result = await Reflect.apply(original, this, args);
      expect(result[0]).toBeNull(); expect(result[1].fulfillment).toEqual({ fulfillment_set_id: graph.ids });
      expect(pricing).toHaveBeenCalledTimes(1);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await wait;
      await Effect.runPromise(Deferred.succeed(finished, undefined)); return result;
    });
    try {
      const before = await fixture.snapshot();
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(host.newRequestKey(), { ids: seeded.locations }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(pending); return yield* Fiber.await(pending);
      })));
      expect(Exit.isFailure(outcome)).toBe(true); if (Exit.isFailure(outcome)) expect(failurePath(outcome.cause)).toContain("Interrupt");
      expect(await fixture.snapshot()).toEqual(before); finish?.();
      await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000))); expect(await fixture.snapshot()).toEqual(before);
      if (escapedPricing === undefined) throw new Error("Missing revoked native Pricing continuation");
      await expect(escapedPricing()).rejects.toBeDefined(); expect(await fixture.snapshot()).toEqual(before);
    } finally { finish?.(); link.mockRestore(); pricing.mockRestore(); }
  }, 180_000);

  it("isolates the same installed Pricing and Provider Link identities and request key across scopes", async () => {
    const prefix = "stock-shipping-scope", graph = fulfillmentSetDeletionGraph(prefix, { options: 1, rules: 1, links: 1, shipping: {} });
    const shipping = graph.shipping;
    if (shipping === undefined) throw new Error("Missing scoped Shipping closure");
    const left = await installedScenario("shipping-scope-a", [graph]), right = await installedScenario("shipping-scope-b", [graph]);
    const first = await left.seed(prefix), second = await right.seed(prefix);
    const leftHost = await left.prepare(), rightHost = await right.prepare(), key = leftHost.newRequestKey();
    const before = await right.readFulfillment(shipping.allIds);
    expect(await Effect.runPromise(leftHost.run(key, { ids: first.locations }))).toBeNull();
    expect((await left.readFulfillment(shipping.allIds)).every(row => typeof row.deleted_at === "string")).toBe(true);
    expect(await right.readFulfillment(shipping.allIds)).toEqual(before);
    expect(await Effect.runPromise(rightHost.run(key, { ids: second.locations }))).toBeNull();
    expect((await right.readFulfillment(shipping.allIds)).every(row => typeof row.deleted_at === "string")).toBe(true);
    const after = await left.snapshot();
    expect(await Effect.runPromise(leftHost.run(key, { ids: first.locations }))).toBeNull();
    expect(await Effect.runPromise(rightHost.run(key, { ids: second.locations }))).toBeNull(); expect(await left.snapshot()).toEqual(after);
  }, 300_000);

  it.skipIf(driver !== "postgres")("settles one competing complete installed Stock Location deletion", async () => {
    const prefix = "stock-installed-race", graph = fulfillmentSetDeletionGraph(prefix, { geos: 1, links: 1 });
    const fixture = await installedScenario("race", [graph]), seeded = await fixture.seed(prefix), left = await fixture.prepare(), right = await fixture.prepare();
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), original = Link.prototype.delete; let arrivals = 0;
    const link = vi.spyOn(Link.prototype, "delete").mockImplementation(async function (this: Link, ...args) {
      const result = await Reflect.apply(original, this, args);
      if (++arrivals === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return result;
    });
    try {
      const before = await fixture.snapshot(), outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(left.run(left.newRequestKey(), { ids: seeded.locations }).pipe(Effect.timeout(45_000)));
        const second = yield* Effect.forkChild(right.run(right.newRequestKey(), { ids: seeded.locations }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000), Effect.ensuring(Deferred.succeed(release, undefined)));
        return [yield* Fiber.await(first), yield* Fiber.await(second)];
      })));
      expect(arrivals).toBe(2); expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1); expect(outcomes.filter(Exit.isFailure)).toHaveLength(1);
      const failed = outcomes.find(Exit.isFailure); if (failed !== undefined && Exit.isFailure(failed)) expect(failurePath(failed.cause)).toContain("writeConflict");
      expect((await fixture.snapshot()).commits).toHaveLength(before.commits.length + 1);
      expect(await fixture.readLocations(seeded.locations)).toEqual([]); expect(await fixture.readSetLinks(seeded.locations)).toEqual([]);
      expect((await fixture.readFulfillment(graph.allIds)).every(row => typeof row.deleted_at === "string")).toBe(true);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); link.mockRestore(); }
  }, 240_000);

  it("isolates identical Locations, Links and request keys across two genuine scopes", async () => {
    const other = await prepareLogicalStockLocationDeletion(driver, close => cleanup.push(close), { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "stock_location_delete_shop_b", projectId: "stock_location_delete_shop_b", uuidOffset: 190_000 } });
    const first = await connected.seed("stock-delete-scope"), second = await other.seed("stock-delete-scope");
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey();
    expect(second).toEqual(first);
    expect(await Effect.runPromise(left.run(key, { ids: first.locations }))).toBeNull();
    expect(await other.readLocations(second.locations)).toHaveLength(1); expect(await other.readLinks(second.locations)).toHaveLength(1);
    expect(await Effect.runPromise(right.run(key, { ids: second.locations }))).toBeNull();
    expect(await connected.readLocations(first.locations)).toEqual([]); expect(await other.readLocations(second.locations)).toEqual([]);
    const committed = await snapshot();
    expect(await Effect.runPromise(left.run(key, { ids: first.locations }))).toBeNull();
    expect(await Effect.runPromise(right.run(key, { ids: second.locations }))).toBeNull(); expect(await snapshot()).toEqual(committed);
  }, 240_000);
});
