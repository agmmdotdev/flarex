import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Option } from "effect";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareLocalSalesChannelProfile } from "../src/sales-channel-schema";
import { makeLocalSalesChannelCommands } from "../src/sales-channel-service";
import { makeLocalProductCommands } from "../src/product-service";
import { isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../persistence-postgres/test/commerceHostFixture";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../persistence-postgres/test/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { registerLocalCommerceProfile } from "../../persistence-postgres/src/commerceTransaction/profile";
import { makeLocalCommerceHost, type LocalCommerceEventPolicy } from "../../persistence-postgres/src/commerceTransaction/host";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../persistence-postgres/src/frameworkSchema/binding/host";
import { makeCommerceBinding } from "@flarex/persistence-postgres/internal/commerce";
import { readAdmittedDataBinding } from "../../persistence-postgres/src/frameworkSchema/binding/selection";
import { runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Sales Channel test driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: CommerceHostTestFixture;
let sales: Effect.Success<ReturnType<typeof makeLocalSalesChannelCommands>>;
const salesRead = defineCommerceCommand("salesChannelFoundationRead", "read", Effect.fn(function* (ctx) {
  const store = yield* ctx.table("sales_channel");
  return [...yield* store.find(ctx.manager, { fields: ["id"], take: 1, order: { column: "id", direction: "asc" } })];
}));
const productRead = defineCommerceCommand("productFoundationRead", "read", Effect.fn(function* (ctx) {
  const store = yield* ctx.table("product");
  return [...yield* store.find(ctx.manager, { fields: ["id"], take: 1, order: { column: "id", direction: "asc" } })];
}));
// Read-only characterization. Any write/event is a test contract violation.
const readOnlyEvents: LocalCommerceEventPolicy = {
  capture: () => Effect.fail(commerceError("unadmittedEvent")),
  validate: (events, rows) => events.length || rows.length ? Effect.fail(commerceError("receiptMismatch")) : Effect.void,
  deliver: events => events.length ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void,
};

beforeAll(async () => {
  sales = await Effect.runPromise(makeLocalSalesChannelCommands());
  const registerCleanup = (close: () => Promise<void>) => cleanup.push(close);
  const resource = driver === "pglite" ? await createRelationalPGliteFixture({ registerCleanup }) : await (async () => {
    const database = await createFileScopedPostgresFixture();
    registerCleanup(database.dispose);
    return { persistence: database.persistence, session: makePostgresRelationalSession(database.persistence) };
  })();
  const control = driver === "pglite" ? await createMigratedPGlitePersistence(registerCleanup) : resource.persistence;
  fixture = await commerceHostFixture(resource.persistence, resource.session, prepareLocalSalesChannelProfile,
    [salesRead, ...sales.commands], control, descriptor => sales.eventPolicy(descriptor, () => Effect.void));
}, 120000);
afterAll(async () => {
  const failures: unknown[] = [];
  for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
  if (failures.length) throw new AggregateError(failures, "Sales Channel fixture cleanup failed");
}, 120000);

describe("configured endpoint binding", () => {
  it("installs both endpoint schemas and reads the admitted Sales Channel profile", async () => {
    expect(fixture.descriptor.layout.frame.tables).toHaveLength(14);
    expect(fixture.descriptor.tables.map(table => table.tableId)).toEqual(["sales_channel"]);
    expect(await Effect.runPromise(fixture.host.read(salesRead, {}))).toEqual([]);
  });

  it("refuses unbound Product access, then authorizes both confined profiles explicitly", async () => {
    const nativeProduct = await Effect.runPromise(makeLocalProductCommands());
    const descriptor = fixture.descriptor;
    const capabilities = descriptor.layout.frame.tables.filter(table => table.identity.tableId !== "sales_channel").map(table => {
      const key = table.keys.find(key => key.kind === "primary") ?? table.keys.find(key => key.kind === "unique");
      if (key === undefined) throw new Error("Missing native Product table key");
      return { tableId: table.identity.tableId, keyId: key.identity.keyId };
    });
    const profile = await Effect.runPromise(registerLocalCommerceProfile(descriptor.artifact, descriptor.layout,
      "medusa.product.foundation", capabilities));
    const product = await Effect.runPromise(makeLocalCommerceHost({ ...fixture.hostInput, profile,
      commands: [productRead, nativeProduct.commands.list] }, readOnlyEvents));
    expect(await runEffectFailure(product.host.read(productRead, {}))).toMatchObject({ reason: "unsupportedProfile" });
    const bindings = await Effect.runPromise(makeDataBindingHost({ ...fixture.bindingsInput,
      commerceProfiles: [fixture.prepared.profile, profile] }));
    const binding = await Effect.runPromise(makeCommerceBinding(fixture.availability, [fixture.prepared.profile, profile]));
    const candidate = await Effect.runPromise(bindings.prepare({ ...fixture.candidate.frame, commerce: [binding] }));
    expect(await runEffectFailure(product.host.read(productRead, {}))).toMatchObject({ reason: "unsupportedProfile" });
    const current = await Effect.runPromise(fixture.bindings.withCurrent(readAdmittedDataBinding));
    await Effect.runPromise(bindings.activate(dataBindingActivationRequest(fixture.candidate.frame.application.scopeId,
      fixture.candidate.frame.application.storageGeneration, "product-and-sales-channel", candidate.sha256, current.head)));
    expect(await Effect.runPromise(product.host.read(productRead, {}))).toEqual([]);
    expect(await Effect.runPromise(product.host.read(nativeProduct.commands.list, {}))).toEqual([]);
    expect(await Effect.runPromise(fixture.host.read(salesRead, {}))).toEqual([]);
  });

  it("runs native Sales Channel writes and reads through the confined profile", async () => {
    const run = Effect.runPromise;
    const created = await run(fixture.host.run(fixture.host.newRequestKey(), sales.create, [
      { id: "channel-1", name: "Channel 1" }, { id: "channel-2", name: "Channel 2", is_disabled: true },
    ]));
    expect(created).toMatchObject([{ id: "channel-1", name: "Channel 1", is_disabled: false }, { id: "channel-2", is_disabled: true }]);
    expect(await run(fixture.host.read(sales.count, { config: { skip: 1, take: 1, select: ["id", "name"] } }))).toEqual([[{ id: "channel-2", name: "Channel 2" }], 2]);
    expect(await run(fixture.host.run(fixture.host.newRequestKey(), sales.update, { id: "channel-1", data: { name: "Updated" } }))).toMatchObject({ id: "channel-1", name: "Updated" });
    await run(fixture.host.run(fixture.host.newRequestKey(), sales.delete, ["channel-2"]));
    expect(await run(fixture.host.read(sales.list, { filters: { id: ["channel-2"] } }))).toEqual([]);
    expect(fixture.takeDeliveries()).toHaveLength(3);
  });

  it("rolls native writes back when event admission refuses the mutation", async () => {
    const policy = sales.eventPolicy(fixture.descriptor, () => Effect.void);
    const rejected = await Effect.runPromise(makeLocalCommerceHost(fixture.hostInput, { ...policy,
      capture: input => policy.capture(input).pipe(Effect.flatMap(() => Effect.fail(commerceError("unadmittedEvent")))),
    }));
    const failure = await runEffectFailure(rejected.host.run(rejected.host.newRequestKey(), sales.create,
      { id: "event-refused-channel", name: "Must roll back" }));
    expect(failure).toMatchObject({ reason: "rollbackOnly" });
    expect(await Effect.runPromise(fixture.host.read(sales.list, { filters: { id: "event-refused-channel" } }))).toEqual([]);
    expect(rejected.takeDeliveries()).toEqual([]);
  });

  it("preserves scalar defaults, nullable fields and native metadata merging", async () => {
    const run = Effect.runPromise;
    const created = await run(fixture.host.run(fixture.host.newRequestKey(), sales.create, { name: "Defaults" }));
    expect(created).toMatchObject({ id: expect.stringMatching(/^sc_/), name: "Defaults", description: null,
      metadata: null, is_disabled: false, deleted_at: null });
    if (!isJsonObject(created) || typeof created.id !== "string") throw new Error("Expected native scalar result");
    await run(fixture.host.run(fixture.host.newRequestKey(), sales.update, { id: created.id, data: { metadata: { keep: 1, remove: "old" } } }));
    const updated = await run(fixture.host.run(fixture.host.newRequestKey(), sales.update, { id: created.id,
      data: { description: null, metadata: { remove: "", added: 2, retainedNull: null } } }));
    expect(updated).toMatchObject({ description: null });
    expect(isJsonObject(updated) ? updated.metadata : undefined).toEqual({ keep: 1, added: 2, retainedNull: null });
    fixture.takeDeliveries();
  });

  it("requires complete, nonduplicated event evidence for exactly the written rows", async () => {
    const policy = sales.eventPolicy(fixture.descriptor, () => Effect.void);
    const forged = { name: buildModuleResourceEventName({ prefix: Modules.SALES_CHANNEL, objectName: "sales_channel", action: "created" }),
      metadata: { source: Modules.SALES_CHANNEL, object: "sales_channel", action: "created" }, data: { id: "not-written" } };
    expect(await Effect.runPromise(policy.capture(forged))).toEqual(forged);
    const substitutions: Array<(events: readonly Json[]) => readonly Json[]> = [
      () => [],
      events => [...events, ...events],
      () => [forged],
    ];
    for (const substitute of substitutions) {
      const local = await Effect.runPromise(makeLocalCommerceHost(fixture.hostInput, { ...policy,
        validate: (events, rows, command, lifecycle) => policy.validate(substitute(events), rows, command, lifecycle),
      }));
      expect(await runEffectFailure(local.host.run(local.host.newRequestKey(), sales.create,
        { id: "mismatched-evidence", name: "Must roll back" }))).toMatchObject({ reason: "receiptMismatch" });
      expect(await Effect.runPromise(fixture.host.read(sales.list, { filters: { id: "mismatched-evidence" } }))).toEqual([]);
      expect(local.takeDeliveries()).toEqual([]);
    }
  });

  it("preserves empty native batches and request replay without duplicate delivery", async () => {
    const run = Effect.runPromise;
    expect(await run(fixture.host.run(fixture.host.newRequestKey(), sales.create, []))).toEqual([]);
    expect(await run(fixture.host.run(fixture.host.newRequestKey(), sales.delete, []))).toBeNull();
    expect(fixture.takeDeliveries()).toEqual([]);
    const key = fixture.host.newRequestKey();
    const input = { id: "replayed-channel", name: "Replay" };
    const first = await run(fixture.host.run(key, sales.create, input));
    expect(fixture.takeDeliveries()).toHaveLength(1);
    expect(await run(fixture.host.run(key, sales.create, input))).toEqual(first);
    expect(fixture.takeDeliveries()).toEqual([]);
    expect(await runEffectFailure(fixture.host.run(key, sales.create, { ...input, name: "Different" }))).toBeDefined();
  });

  it("refuses managed fields, malformed values and unsupported query capabilities before publication", async () => {
    for (const input of [
      { id: "bad-channel", name: "Bad", created_at: "2026-01-01" },
      { id: "bad-channel", name: "Bad", deleted_at: null },
      { id: "bad-channel", name: "Bad", is_disabled: "false" },
      { id: "bad-channel", name: "Bad", products: [] },
      { id: "bad-channel", name: null },
    ]) {
      expect(await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), sales.create, input))).toBeDefined();
    }
    for (const config of [{ relations: ["products"] }, { select: ["not_a_field"] }, { cache: true }, { take: -1 }, { order: { name: "ASC" } }]) {
      expect(await runEffectFailure(fixture.host.read(sales.list, { filters: { id: "absent" }, config }))).toBeDefined();
    }
    expect(await Effect.runPromise(fixture.host.read(sales.list, { filters: { id: "bad-channel" } }))).toEqual([]);
    expect(fixture.takeDeliveries()).toEqual([]);
  });

  it("does not let an update replace the selected identity or write managed lifecycle fields", async () => {
    for (const data of [{ id: "replayed-channel", name: "Hijacked" }, { updated_at: "2026-01-01" }, { deleted_at: null }]) {
      expect(await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), sales.update, { id: "channel-1", data }))).toBeDefined();
    }
    expect(await Effect.runPromise(fixture.host.read(sales.retrieve, { id: "channel-1" }))).toMatchObject({ name: "Updated" });
    expect(await Effect.runPromise(fixture.host.read(sales.retrieve, { id: "replayed-channel" }))).toMatchObject({ name: "Replay" });
    expect(fixture.takeDeliveries()).toEqual([]);
  });

  it("revokes borrowed native services when their command ends", async () => {
    let escaped = Option.none<Parameters<Parameters<typeof sales.withService>[1]>[0]>();
    const borrow = defineCommerceCommand("salesChannelBorrow", "read", ctx => sales.withService(ctx, async scope => {
      escaped = Option.some(scope);
      return [];
    }));
    const local = await Effect.runPromise(makeLocalCommerceHost({ ...fixture.hostInput, commands: [borrow] },
      sales.eventPolicy(fixture.descriptor, () => Effect.void)));
    await Effect.runPromise(local.host.read(borrow, null));
    const scope = Option.getOrThrow(escaped);
    await expect(scope.service.listSalesChannels({}, {}, scope.context)).rejects.toBeDefined();
    await expect(scope.service.createSalesChannels({ name: "Escaped" }, scope.context)).rejects.toBeDefined();
    expect(await Effect.runPromise(fixture.host.read(sales.list, { filters: { name: "Escaped" } }))).toEqual([]);
    expect(local.takeDeliveries()).toEqual([]);
  });

  it("preserves skip-only native reads without inventing a page limit", async () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({ id: `window-${String(index).padStart(2, "0")}`, name: "Window" }));
    await Effect.runPromise(fixture.host.run(fixture.host.newRequestKey(), sales.create, rows));
    const expected = rows.map(({ id }) => ({ id }));
    expect(await Effect.runPromise(fixture.host.read(sales.list,
      { filters: { name: "Window" }, config: { select: ["id"], skip: 0 } }))).toEqual(expected);
    expect(await Effect.runPromise(fixture.host.read(sales.count,
      { filters: { name: "Window" }, config: { select: ["id"], skip: 1 } }))).toEqual([expected.slice(1), 20]);
    expect(await Effect.runPromise(fixture.host.read(sales.count,
      { filters: { name: "Window" }, config: { select: ["id"], skip: 20 } }))).toEqual([[], 20]);
    expect(await Effect.runPromise(fixture.host.read(sales.list,
      { filters: { name: "Window" }, config: { select: ["id"], skip: 1, order: { id: "DESC" } } }))).toEqual([...expected].reverse().slice(1));
    await Effect.runPromise(fixture.host.run(fixture.host.newRequestKey(), sales.delete, rows.map(row => row.id)));
    expect(fixture.takeDeliveries()).toHaveLength(2);
  });
});
