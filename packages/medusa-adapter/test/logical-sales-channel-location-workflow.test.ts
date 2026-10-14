import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import type { LinkWorkflowInput } from "@medusajs/types";
import { linkSalesChannelsToStockLocationWorkflow } from "@medusajs/core-flows/stock-location/link-sales-channels";
import { fxAppRowCurrent, fxSystemCommits } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { makeApplicationAnalysisRepository } from "../../persistence-postgres/src/application/applicationAnalysisRegistration";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeSchemaComposer } from "../src/composition/schema";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { prepareLocalGraph } from "../src/local-graph/query";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { prepareStockLocationSalesChannelsWorkflow, StockLocationSalesChannelsInput } from "../src/workflows/stock-location/sales-channels";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalSalesChannelLocation } from "./support/logical-sales-channel-location-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Sales Channel Location driver");
const cleanup: Array<() => Promise<void>> = [];
let members: Awaited<ReturnType<typeof prepareLogicalSalesChannelLocation>>;
const rows = () => members.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
const events = () => members.fixture.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const commits = () => members.fixture.persistence.drizzle.select().from(fxSystemCommits);
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject));
const run = (input: typeof StockLocationSalesChannelsInput.Type, scope = members) => Effect.runPromise(scope.workflow.run(scope.workflow.newRequestKey(), input));
const read = (filters: JsonObject, withDeleted = false, scope = members) => Effect.runPromise(scope.reader.read(scope.link.list,
  { filters, config: { withDeleted, take: 16 } }).pipe(Effect.flatMap(decodeRows)));
async function seed(prefix: string, channels = 4, scope = members) {
  const result = await Effect.runPromise(scope.seed.run(scope.seed.newRequestKey(), {
    channels: Array.from({ length: channels }, (_, index) => ({ id: prefix + "-channel-" + index, name: prefix + index })),
    locations: [{ id: prefix + "-location", name: prefix }],
  }));
  return { id: result.locations[0]!.id, channels: result.channels.map(channel => channel.id) };
}
function failurePath(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => {
    switch (reason._tag) {
      case "Fail": return failurePath(reason.error);
      case "Die": return failurePath(reason.defect);
      case "Interrupt": return [reason._tag];
    }
  });
  if (!(value instanceof Error)) return [];
  return ["reason" in value && typeof value.reason === "string" ? value.reason : value.message, ...failurePath(value.cause)];
}

describe("native Sales Channel and Stock Location links", () => {
  beforeAll(async () => {
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      includeSalesChannel: true, includeStockLocation: true, includeSalesChannelLocationLink: true,
    });
    members = await prepareLogicalSalesChannelLocation(fixture, close => cleanup.push(close));
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("runs the maximum add/remove graph with native events, one publication and replay", async () => {
    const input = await seed("maximum", 8);
    await run({ id: input.id, add: input.channels.slice(0, 4) });
    const nativeCreate = vi.spyOn(Link.prototype, "create"), nativeDismiss = vi.spyOn(Link.prototype, "dismiss");
    try {
      const beforeEvents = await events(), beforeCommits = await commits();
      const key = members.workflow.newRequestKey(), request = { id: input.id, add: input.channels.slice(4), remove: input.channels.slice(0, 4) };
      expect(await Effect.runPromise(members.workflow.run(key, request))).toBeNull();
      expect(nativeCreate).toHaveBeenCalledTimes(1); expect(nativeDismiss).toHaveBeenCalledTimes(1);
      expect(nativeCreate.mock.invocationCallOrder[0]).toBeLessThan(nativeDismiss.mock.invocationCallOrder[0]!);
      expect((await read({ stock_location_id: input.id })).map(row => row.sales_channel_id)).toEqual(input.channels.slice(4));
      const emitted = (await events()).slice(beforeEvents.length);
      expect(emitted.map(event => event.envelope.contract)).toEqual(["LinkSalesChannelStockLocation.attached", "LinkSalesChannelStockLocation.detached"]);
      expect(await commits()).toHaveLength(beforeCommits.length + 1);
      const stableRows = await rows(), stableEvents = await events();
      expect(await Effect.runPromise(members.workflow.run(key, request))).toBeNull();
      expect(nativeCreate).toHaveBeenCalledTimes(1); expect(nativeDismiss).toHaveBeenCalledTimes(1);
      expect(await rows()).toEqual(stableRows); expect(await events()).toEqual(stableEvents);
    } finally { nativeCreate.mockRestore(); nativeDismiss.mockRestore(); }
  });

  it("preserves omitted and empty arrays without resolving native Link methods", async () => {
    const create = vi.spyOn(Link.prototype, "create"), dismiss = vi.spyOn(Link.prototype, "dismiss");
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      for (const input of [{ id: "empty" }, { id: "empty", add: [] }, { id: "empty", remove: [] }, { id: "empty", add: [], remove: [] }])
        expect(await run(input)).toBeNull();
      expect(create).not.toHaveBeenCalled(); expect(dismiss).not.toHaveBeenCalled();
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { create.mockRestore(); dismiss.mockRestore(); }
  });

  it("retains many-to-many reads in both directions and complete composite ordering", async () => {
    const first = await seed("directions"), second = await seed("directions-second", 0);
    await run({ id: first.id, add: first.channels.slice(0, 2) });
    await run({ id: second.id, add: first.channels.slice(0, 2) });
    expect((await read({ stock_location_id: first.id })).map(row => row.sales_channel_id)).toEqual(first.channels.slice(0, 2));
    const reverse = await read({ sales_channel_id: first.channels[0]! });
    expect(reverse).toHaveLength(2);
    expect(reverse.map(row => row.stock_location_id)).toEqual(expect.arrayContaining([first.id, second.id]));
    const ordered = await read({ sales_channel_id: first.channels.slice(0, 2) });
    expect(ordered.map(row => row.sales_channel_id)).toEqual([first.channels[0], first.channels[0], first.channels[1], first.channels[1]]);
    const counts = await Effect.runPromise(members.reader.read(members.link.count,
      { filters: { sales_channel_id: first.channels.slice(0, 2) }, config: { take: 2, skip: 1, select: ["id"] } }));
    expect(counts).toMatchObject([[expect.objectContaining({ id: expect.any(String) }), expect.objectContaining({ id: expect.any(String) })], 4]);
    expect(counts).toEqual([ordered.slice(1, 3).map(row => ({ id: row.id,
      sales_channel_id: row.sales_channel_id, stock_location_id: row.stock_location_id })), 4]);
  });

  it("preserves overlap, repeated attach, soft deletion, reattach and unmatched dismiss", async () => {
    const input = await seed("cycle", 1), channel = input.channels[0]!;
    await run({ id: input.id, add: [channel] });
    const original = (await read({ stock_location_id: input.id }))[0]!;
    await run({ id: input.id, add: [channel] });
    const replacement = (await read({ stock_location_id: input.id }))[0]!;
    expect(replacement.id).not.toBe(original.id);
    const before = await events();
    await run({ id: input.id, add: [channel], remove: [channel] });
    expect(await read({ stock_location_id: input.id })).toEqual([]);
    const inactive = await read({ sales_channel_id: channel, stock_location_id: input.id }, true);
    expect(inactive).toMatchObject([{ deleted_at: expect.any(String) }]);
    const emitted = (await events()).slice(before.length).map(event => event.envelope.message);
    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toMatchObject({ data: { id: inactive[0]!.id } });
    expect(emitted[1]).toMatchObject({ data: { id: inactive[0]!.id } });
    const afterDismiss = await events();
    await run({ id: input.id, remove: [channel, "unmatched"] });
    expect(await events()).toEqual(afterDismiss);
    await run({ id: input.id, add: [channel] });
    const active = await read({ stock_location_id: input.id });
    expect(active).toMatchObject([{ deleted_at: null }]); expect(active[0]!.id).not.toBe(inactive[0]!.id);
  });

  it("retains native unknown-endpoint behavior without declaring endpoint liveness", async () => {
    expect(await run({ id: "unknown-location", add: ["unknown-channel"] })).toBeNull();
    expect(await read({ stock_location_id: "unknown-location" })).toMatchObject([{ sales_channel_id: "unknown-channel" }]);
    await run({ id: "unknown-location", remove: ["unknown-channel"] });
    expect(await read({ stock_location_id: "unknown-location" })).toEqual([]);
  });

  it("delegates duplicates unchanged and refuses duplicate creation atomically", async () => {
    const input = await seed("duplicates", 1), channel = input.channels[0]!;
    const create = vi.spyOn(Link.prototype, "create"), dismiss = vi.spyOn(Link.prototype, "dismiss");
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      await expect(run({ id: input.id, add: [channel, channel] })).rejects.toBeDefined();
      expect(create.mock.calls[0]?.[0]).toHaveLength(2);
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      await run({ id: input.id, add: [channel] });
      await run({ id: input.id, remove: [channel, channel] });
      expect(dismiss.mock.calls[0]?.[0]).toHaveLength(2);
      expect(await read({ stock_location_id: input.id })).toEqual([]);
    } finally { create.mockRestore(); dismiss.mockRestore(); }
  });

  it("refuses malformed, oversized and managed-field inputs before native calls", async () => {
    const native = vi.spyOn(Link.prototype, "create"), dismiss = vi.spyOn(Link.prototype, "dismiss");
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      for (const input of [{ id: "" }, { id: "bounded", add: Array(5).fill("channel") }, { id: "bounded", remove: Array(5).fill("channel") },
        { id: "bounded", data: { id: "forged" } }]) {
        await expect(Effect.runPromise(members.workflow.run(members.workflow.newRequestKey(), input))
          .catch(error => { throw failurePath(error); }), JSON.stringify(input)).rejects.toContain("invalidInput");
      }
      expect(native).not.toHaveBeenCalled(); expect(dismiss).not.toHaveBeenCalled(); expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { native.mockRestore(); dismiss.mockRestore(); }
  });

  it("authenticates module tokens before inspecting getters or preparing execution", async () => {
    const getter = vi.fn(() => members.link.workflow.methods);
    const forged = Object.defineProperty({ ...members.link.workflow }, "methods", { get: getter, enumerable: true });
    const prepare = vi.fn(() => Effect.die("Unexpected execution preparation"));
    const link = { ...members.options.link, module: forged };
    await expect(Effect.runPromise(prepareStockLocationSalesChannelsWorkflow({ ...members.options,
      execution: { identityAndAccessPolicy: {}, prepare }, link }))).rejects.toMatchObject({ reason: "unsupportedProfile" });
    expect(getter).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  });

  it("requires both endpoint sources and retains native aliases with a separate event entity", async () => {
    expect(members.fixture.productDefinition).toBeUndefined(); expect(members.fixture.pricingDefinition).toBeUndefined();
    expect((await members.fixture.persistence.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
      .toEqual(members.fixture.physicalTablesBeforeCandidate);
    const repository = makeApplicationAnalysisRepository(members.fixture.persistence.drizzle);
    for (const medusaModules of [["salesChannelLocationLink"], ["salesChannelLocationLink", "salesChannel"], ["salesChannelLocationLink", "stockLocation"]] as const) {
      const compose = makeSchemaComposer({ deploymentId: members.fixture.deploymentId, authority: members.fixture.application.authority,
        applicationAnalyses: repository, medusaModules });
      await expect(Effect.runPromise(compose({}))).rejects.toMatchObject({ reason: "missingModuleDependency" });
    }
    const participant = defineAtomicCommerceParticipant("link");
    const graph = await Effect.runPromise(Effect.fromResult(prepareLocalGraph([{ participant, module: members.link.graph }])));
    expect(graph.entities).toEqual(["sales_channel_location", "sales_channel_locations"]);
    const readPending = defineAtomicCommerceCommand("nativeLocationLinkAliases", ctx => graph.bind(ctx).graph({
      entity: "sales_channel_locations", fields: ["id", "sales_channel_id", "stock_location_id"], filters: { stock_location_id: "maximum-location" }, pagination: { take: 4 } }));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...members.fixture.hostInput, commands: [readPending],
      participants: [{ participant, logicalStorage: members.linkInput.logicalStorage, commands: [members.link.count] }] }));
    try { expect(await Effect.runPromise(host.run(host.newRequestKey(), readPending, null))).toMatchObject({ data: expect.any(Array), metadata: { count: 4, take: 4, skip: 0 } }); }
    finally { await Effect.runPromise(host.close); }
  });

  it("restores pre-existing Link state after failure following association and dismissal", async () => {
    const input = await seed("late", 1), channel = input.channels[0]!;
    await run({ id: input.id, add: [channel] });
    const original = Link.prototype.dismiss;
    const native = vi.spyOn(Link.prototype, "dismiss").mockImplementation(async function (this: Link, ...args) {
      await Reflect.apply(original, this, args); throw new Error("late location link failure");
    });
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      await expect(run({ id: input.id, add: [channel], remove: [channel] }).catch(error => { throw failurePath(error); })).rejects.toContain("late location link failure");
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      expect(native).toHaveBeenCalledTimes(1);
    } finally { native.mockRestore(); }
  });

  it("latches caught resource refusal and revokes escaped methods", async () => {
    let escaped: ((input: unknown) => Promise<unknown>) | undefined;
    const capture = createStep("capture-location-link", async (_input: unknown, { container }) => {
      escaped = container.resolve<{ create: (input: unknown) => Promise<unknown> }>("link").create;
      try { await escaped([{ sales_channel: { sales_channel_id: "caught" }, stock_location: { stock_location_id: "caught" }, data: { id: "forged" } }]); } catch {}
      return new StepResponse(void 0);
    });
    const flow = createWorkflow("caught-location-link-refusal", (input: WorkflowData<LinkWorkflowInput>) => {
      linkSalesChannelsToStockLocationWorkflow.runAsStep({ input }); capture(null); return new WorkflowResponse(void 0);
    });
    const resources = await Effect.runPromise(Effect.fromResult(prepareWorkflowResources({ link: { module: members.link.workflow, methods: ["create", "dismiss"], graph: false } }, true)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...members.options, modules: { link: members.options.link },
      workflow: { name: "caughtLocationLink", resources, prepared: await Effect.runPromise(Effect.fromResult(flow.prepare())),
        input: StockLocationSalesChannelsInput, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), { id: "caught", add: ["caught"] }))).rejects.toBeDefined();
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      if (escaped === undefined) throw new Error("Missing escaped Link method");
      await expect(escaped([])).rejects.toMatchObject({ reason: "closed" });
    } finally { await Effect.runPromise(host.close); }
  });

  it("cancels after pending native writes and ignores late completion", async () => {
    const reached = await Effect.runPromise(Deferred.make<void>());
    let finish: (() => void) | undefined;
    const original = Link.prototype.create;
    const native = vi.spyOn(Link.prototype, "create").mockImplementation(async function (this: Link, ...args) {
      const result = await Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined));
      await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(members.workflow.run(members.workflow.newRequestKey(), { id: "cancel", add: ["cancel"] }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      }));
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      finish?.(); expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { finish?.(); native.mockRestore(); }
  }, 120_000);

  it("recovers a lost acknowledgement without repeating native linking and binds replay identity", async () => {
    let lose = true;
    const fixture = members.fixture;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost Link COMMIT acknowledgement") })); }),
    ));
    const host = await Effect.runPromise(prepareStockLocationSalesChannelsWorkflow({ ...members.options, execution: {
      identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy, prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }) } }));
    const changed = await Effect.runPromise(prepareStockLocationSalesChannelsWorkflow({ ...members.options, revision: "a".repeat(64) }));
    const native = vi.spyOn(Link.prototype, "create");
    try {
      const key = host.newRequestKey(), input = { id: "uncertain", add: ["uncertain"] };
      expect(await Effect.runPromise(host.run(key, input))).toBeNull(); expect(lose).toBe(false); expect(native).toHaveBeenCalledTimes(1);
      const stableRows = await rows(), stableEvents = await events();
      expect(await Effect.runPromise(host.run(key, input))).toBeNull(); expect(native).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await rows()).toEqual(stableRows); expect(await events()).toEqual(stableEvents);
    } finally { native.mockRestore(); await Effect.runPromise(host.close); await Effect.runPromise(changed.close); }
  });

  it.skipIf(driver !== "postgres")("retains default competing callbacks and rejects a stale same-pair root", async () => {
    const reached = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>());
    const original = Link.prototype.create;
    let count = 0;
    const native = vi.spyOn(Link.prototype, "create").mockImplementation(async function (this: Link, ...args) {
      const result = await Reflect.apply(original, this, args);
      if (++count === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return result;
    });
    try {
      const results = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(Effect.exit(members.workflow.run(members.workflow.newRequestKey(), { id: "competing", add: ["competing"] })));
        const second = yield* Effect.forkChild(Effect.exit(members.workflow.run(members.workflow.newRequestKey(), { id: "competing", add: ["competing"] })));
        yield* Deferred.await(reached).pipe(Effect.timeout(10_000)); yield* Deferred.succeed(release, undefined);
        return [yield* Fiber.join(first), yield* Fiber.join(second)];
      })));
      expect(results.filter(result => result._tag === "Success")).toHaveLength(1);
      expect(results.flatMap(result => result._tag === "Failure" ? failurePath(result.cause) : [])).toContain("writeConflict");
      expect(await read({ stock_location_id: "competing" })).toHaveLength(1);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  });

  it("confines matching endpoint IDs and request keys to each shop", async () => {
    const otherFixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      includeSalesChannel: true, includeStockLocation: true, includeSalesChannelLocationLink: true, resource: members.fixture.resource,
      fixtureIdentity: { deploymentId: "sales_channel_location_shop_b", projectId: "sales_channel_location_shop_b", uuidOffset: 23_000 },
    });
    const other = await prepareLogicalSalesChannelLocation(otherFixture, close => cleanup.push(close));
    const left = await seed("scoped", 1), right = await seed("scoped", 1, other);
    expect(left).toEqual(right);
    const key = members.workflow.newRequestKey(), request = { id: left.id, add: left.channels };
    expect(await Effect.runPromise(members.workflow.run(key, request))).toBeNull();
    expect(await read({ stock_location_id: left.id }, false, other)).toEqual([]);
    expect(await Effect.runPromise(other.workflow.run(key, request))).toBeNull();
    await run({ id: left.id, remove: left.channels });
    expect(await read({ stock_location_id: left.id })).toEqual([]);
    expect(await read({ stock_location_id: left.id }, false, other)).toHaveLength(1);
  }, 180_000);
});
