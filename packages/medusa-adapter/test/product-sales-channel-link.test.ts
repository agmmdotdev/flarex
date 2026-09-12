import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Deferred, Effect, Option } from "effect";
import { prepareLocalProductSalesChannelLink } from "../src/product-sales-channel-link-service";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../persistence-postgres/test/commerceHostFixture";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../persistence-postgres/test/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";
import { commerceInventory } from "../../persistence-postgres/test/commerceInventory";
import { makeLocalSalesChannelCommands } from "../src/sales-channel-service";
import { makeLocalProductCommands } from "../src/product-service";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productModuleEventPolicy } from "../src/product-local-events";
import { prepareLocalGraph } from "../src/local-graph/query";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { registerLocalCommerceProfile, requireCommerceProfile } from "@flarex/persistence-postgres/internal/commerce-profile";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../persistence-postgres/src/frameworkSchema/binding/host";
import { makeCommerceBinding } from "@flarex/persistence-postgres/internal/commerce";
import { readAdmittedDataBinding } from "../../persistence-postgres/src/frameworkSchema/binding/selection";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineCommerceEventContract } from "../../persistence-postgres/src/atomicCommerce/events";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { buildModuleResourceEventName, Modules } from "@medusajs/framework/utils/portable";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeLocalCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/relationalTransaction/model";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Link test driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: CommerceHostTestFixture;
let link: Effect.Success<ReturnType<typeof prepareLocalProductSalesChannelLink>>;
const pair = (product: string, channel: string, id?: string) => ({
  product: { product_id: product }, sales_channel: { sales_channel_id: channel }, ...(id === undefined ? {} : { data: { id } }),
});
beforeAll(async () => {
  link = await runEffect(prepareLocalProductSalesChannelLink());
  const registerCleanup = (close: () => Promise<void>) => cleanup.push(close);
  const resource = driver === "pglite" ? await createRelationalPGliteFixture({ registerCleanup }) : await (async () => {
    const database = await createFileScopedPostgresFixture();
    registerCleanup(database.dispose);
    return { persistence: database.persistence, session: makePostgresRelationalSession(database.persistence) };
  })();
  const control = driver === "pglite" ? await createMigratedPGlitePersistence(registerCleanup) : resource.persistence;
  fixture = await commerceHostFixture(resource.persistence, resource.session, link.prepareProfile,
    link.commands, control, descriptor => link.eventPolicy(descriptor, () => Effect.void));
}, 120000);
afterAll(async () => {
  const failures: unknown[] = [];
  for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
  if (failures.length) throw new AggregateError(failures, "Link fixture cleanup failed");
}, 120000);

describe("native stored Product Sales Channel Link", () => {
  it("installs fifteen tables but grants this profile only the declared endpoint-pair key", () => {
    expect(fixture.descriptor.layout.frame.tables).toHaveLength(15);
    expect(fixture.descriptor.tables.map(table => table.tableId)).toEqual(["product_sales_channel"]);
    const table = fixture.descriptor.layout.frame.tables.find(table => table.identity.tableId === "product_sales_channel");
    expect(table?.keys.filter(key => key.kind === "primary").map(key => key.columns.slice(1).map(name => table.columns.find(column => column.name === name)?.identity.columnId)))
      .toEqual([["product_id", "sales_channel_id"]]);
  });

  it("attaches through native Link, replaces ID on repeat, and preserves caller input and replay", async () => {
    const input = pair("p1", "s1", "prodsc-first");
    const beforeInput = structuredClone(input);
    const key = fixture.host.newRequestKey();
    const before = await commerceInventory(fixture);
    const first = await runEffect(fixture.host.run(key, link.create, input));
    expect(first).toMatchObject([{ id: "prodsc-first", product_id: "p1", sales_channel_id: "s1", deleted_at: null }]);
    expect(input).toEqual(beforeInput);
    const committed = await commerceInventory(fixture);
    expect(committed.commits.length - before.commits.length).toBe(1);
    expect(await runEffect(fixture.host.run(key, link.create, input))).toEqual(first);
    expect(await commerceInventory(fixture)).toEqual(committed);
    const replacement = await runEffect(fixture.host.run(fixture.host.newRequestKey(), link.create, pair("p1", "s1", "prodsc-second")));
    expect(replacement).toMatchObject([{ id: "prodsc-second" }]);
    expect(await runEffect(fixture.host.read(link.count, {}))).toMatchObject([[{ id: "prodsc-second" }], 1]);
  });

  it("keeps duplicate non-key IDs and both components in stable paged reads", async () => {
    await runEffect(fixture.host.run(fixture.host.newRequestKey(), link.create, [
      pair("window", "c", "prodsc-shared"), pair("window", "a", "prodsc-shared"), pair("window", "b", "prodsc-shared"),
    ]));
    expect(await runEffect(fixture.host.read(link.count, {
      filters: { product_id: "window" }, config: { select: ["id"], take: 1, skip: 1 },
    }))).toEqual([[{ id: "prodsc-shared", product_id: "window", sales_channel_id: "b" }], 3]);
    expect(await runEffect(fixture.host.read(link.links, pair("window", "b")))).toEqual([pair("window", "b")]);
  });

  it("executes native-shaped text inequality inside Link existence and paged count queries", async () => {
    await expect(runEffect(fixture.host.run(fixture.host.newRequestKey(), link.create, [
      pair("neq-product", "neq-a"), pair("neq-product", "neq-b"), pair("neq-product", "neq-c"),
    ]))).resolves.toHaveLength(3);
    const filters = { product_id: "neq-product", sales_channel_id: { $ne: "neq-a" } };
    await expect(runEffect(fixture.host.read(link.count, {
      filters, config: { select: ["product_id", "sales_channel_id"], skip: 1, take: 1 },
    }))).resolves.toEqual([[{ product_id: "neq-product", sales_channel_id: "neq-c" }], 2]);
    await expect(runEffect(fixture.host.read(link.list, {
      filters, config: { select: ["product_id", "sales_channel_id"], take: 1 },
    }))).resolves.toEqual([{ product_id: "neq-product", sales_channel_id: "neq-b" }]);
    for (const value of [null, 1, [], { $in: ["a"] }]) {
      expect(await runEffectFailure(fixture.host.read(link.count, { filters: { sales_channel_id: { $ne: value } } })))
        .toMatchObject({ reason: "invalidInput" });
    }
  });

  it("dismisses only the selected tuple and restores by one endpoint, including a no-write repeated restore", async () => {
    expect(await runEffect(fixture.host.run(fixture.host.newRequestKey(), link.dismiss, pair("window", "b"))))
      .toMatchObject([{ id: "prodsc-shared", product_id: "window", sales_channel_id: "b" }]);
    expect(await runEffect(fixture.host.read(link.count, { filters: { product_id: "window" } }))).toMatchObject([expect.any(Array), 2]);
    const restored = await runEffect(fixture.host.run(fixture.host.newRequestKey(), link.restore, { sales_channel: { sales_channel_id: "b" } }));
    expect(restored).toEqual({ ProductProductSalesChannelSalesChannelLink: { product_id: ["window"], sales_channel_id: ["b"] } });
    const before = await commerceInventory(fixture);
    expect(await runEffect(fixture.host.run(fixture.host.newRequestKey(), link.restore, { sales_channel: { sales_channel_id: "b" } }))).toEqual(restored);
    const after = await commerceInventory(fixture);
    expect(after.facts).toEqual(before.facts);
    expect(after.commits.length - before.commits.length).toBe(1);
  });

  it("preserves empty endpoint lifecycle results and repeated deletion", async () => {
    for (const command of [link.delete, link.restore]) {
      const before = await commerceInventory(fixture);
      expect(await runEffect(fixture.host.run(fixture.host.newRequestKey(), command,
        { product: { product_id: "absent-endpoint" } }))).toEqual({});
      expect((await commerceInventory(fixture)).facts).toEqual(before.facts);
    }
    await runEffect(fixture.host.run(fixture.host.newRequestKey(), link.create, pair("endpoint-lifecycle", "channel")));
    expect(await runEffect(fixture.host.run(fixture.host.newRequestKey(), link.delete,
      { product: { product_id: "endpoint-lifecycle" } }))).toEqual({
      ProductProductSalesChannelSalesChannelLink: { product_id: ["endpoint-lifecycle"], sales_channel_id: ["channel"] },
    });
    const deleted = await commerceInventory(fixture);
    expect(await runEffect(fixture.host.run(fixture.host.newRequestKey(), link.delete,
      { product: { product_id: "endpoint-lifecycle" } }))).toEqual({});
    expect((await commerceInventory(fixture)).facts).toEqual(deleted.facts);
  });

  it("refuses a duplicate batch, oversized input and unsupported traversal before committing any work", async () => {
    const before = await commerceInventory(fixture);
    expect(await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), link.create, [pair("duplicate", "s"), pair("duplicate", "s")]))).toBeDefined();
    expect(await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), link.create,
      Array.from({ length: 257 }, (_, index) => pair("bounded-" + index, "s"))))).toBeDefined();
    expect(await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), link.delete, {
      product: { product_id: "window" }, sales_channel: { sales_channel_id: "b" },
    }))).toBeDefined();
    expect(await commerceInventory(fixture)).toEqual(before);
  });

  it("rolls back late native failure, caught invalid managers, cancellation, and a forged native event ID", async () => {
    const before = await commerceInventory(fixture);
    const policy = link.eventPolicy(fixture.descriptor, () => Effect.void);
    const late = defineCommerceCommand("linkCreate", "write", ctx => link.withService(ctx, async scope => {
      await scope.link.create(pair("late", "channel"), scope.context);
      throw new Error("Late native consumer failure");
    }));
    const caught = defineCommerceCommand("linkCreate", "write", ctx => link.withService(ctx, async scope => {
      await scope.link.create(pair("caught", "channel"), scope.context);
      const outcome = await scope.link.restore({ product: { product_id: "caught" } }, { manager: {}, transactionManager: {} });
      expect(outcome[0]).not.toBeNull();
      await scope.cascade(outcome).catch(() => undefined);
      return [];
    }));
    const cancelled = defineCommerceCommand("linkCreate", "write", ctx => link.withService(ctx,
      scope => scope.link.create(pair("cancelled", "channel"), scope.context)).pipe(Effect.andThen(Effect.interrupt)));
    for (const command of [late, caught, cancelled]) {
      const local = await runEffect(makeLocalCommerceHost({ ...fixture.hostInput, commands: [command] }, policy));
      await expect(runEffect(local.host.run(local.host.newRequestKey(), command, null))).rejects.toBeDefined();
      expect(local.takeDeliveries()).toEqual([]);
      expect(await commerceInventory(fixture)).toEqual(before);
    }
    const forged = await runEffect(makeLocalCommerceHost(fixture.hostInput, { ...policy,
      capture: input => policy.capture(input).pipe(Effect.map(message => {
        if (!isJsonObject(message)) throw new Error("Expected captured native envelope");
        return { ...message, data: { id: "not-the-stored-link" } };
      })),
    }));
    expect(await runEffectFailure(forged.host.run(forged.host.newRequestKey(), link.create, pair("forged", "channel"))))
      .toMatchObject({ reason: "receiptMismatch" });
    expect(await commerceInventory(fixture)).toEqual(before);
  });

  it("refuses escaped storage operations and hides router registration while preserving native empty no-ops", async () => {
    let escaped = Option.none<Parameters<Parameters<typeof link.withService>[1]>[0]>();
    const borrow = defineCommerceCommand("linkBorrow", "read", ctx => link.withService(ctx, async scope => {
      escaped = Option.some(scope);
      expect(Object.keys(scope.link).sort()).toEqual(["create", "delete", "dismiss", "list", "restore"]);
      return [];
    }));
    const local = await runEffect(makeLocalCommerceHost({ ...fixture.hostInput, commands: [borrow] }, link.eventPolicy(fixture.descriptor, () => Effect.void)));
    await runEffect(local.host.read(borrow, null));
    const scope = Option.getOrThrow(escaped);
    const before = await commerceInventory(fixture);
    await expect(scope.link.create([], scope.context)).resolves.toEqual([]);
    await expect(scope.link.dismiss([], scope.context)).resolves.toEqual([]);
    await expect(scope.link.list([], { asLinkDefinition: true }, scope.context)).resolves.toEqual([]);
    expect(await commerceInventory(fixture)).toEqual(before);
    await expect(scope.service.list({}, {}, scope.context)).rejects.toBeDefined();
    await expect(scope.link.create(pair("escaped", "channel"), scope.context)).rejects.toBeDefined();
    expect(await runEffect(fixture.host.read(link.list, { filters: { product_id: "escaped" } }))).toEqual([]);
  });

  it("recovers an uncertain commit without repeating native attach identity generation", async () => {
    let lose = true;
    const session = issueRelationalSession(fixture.persistence.drizzle, work => runRelationalSession(fixture.session, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => {
        if (!lose) return Effect.succeed(value);
        lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost Link COMMIT acknowledgement") }));
      }),
    ));
    const local = await runEffect(makeLocalCommerceHost({ ...fixture.hostInput, session }, link.eventPolicy(fixture.descriptor, () => Effect.void)));
    const before = await commerceInventory(fixture);
    const key = local.host.newRequestKey();
    const result = await runEffect(local.host.run(key, link.create, pair("uncertain", "channel")));
    const after = await commerceInventory(fixture);
    expect(after.commits.length - before.commits.length).toBe(1);
    expect(await runEffect(local.host.run(key, link.create, pair("uncertain", "channel")))).toEqual(result);
    expect(await commerceInventory(fixture)).toEqual(after);
  });

  it.skipIf(driver !== "postgres")("observes a real lock wait between two native attaches of the same pair", async () => {
    const entered = await runEffect(Deferred.make<void>());
    const release = await runEffect(Deferred.make<void>());
    const held = defineCommerceCommand("linkCreate", "write", Effect.fn(function* (ctx) {
      const value = yield* link.withService(ctx, scope => scope.link.create(pair("interleaved", "channel", "prodsc-held"), scope.context));
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(release);
      return value;
    }));
    const local = await runEffect(makeLocalCommerceHost({ ...fixture.hostInput, commands: [held] }, link.eventPolicy(fixture.descriptor, () => Effect.void)));
    const before = await commerceInventory(fixture);
    const first = runEffect(local.host.run(local.host.newRequestKey(), held, null));
    const firstObserved = first.then(value => ({ value }), error => ({ error }));
    await runEffect(Deferred.await(entered).pipe(Effect.timeout(10000)));
    const second = runEffect(fixture.host.run(fixture.host.newRequestKey(), link.create, pair("interleaved", "channel", "prodsc-waiter")));
    const secondObserved = second.then(value => ({ value }), error => ({ error }));
    try {
      let waiting = false;
      for (let poll = 0; poll < 25; poll++) {
        const observed = await fixture.persistence.query<{ waiting: boolean }>(
          "select exists(select 1 from pg_stat_activity where usename=current_user and pid<>pg_backend_pid() and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0) as waiting");
        if (observed.rows[0]?.waiting) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally {
      await runEffect(Deferred.succeed(release, undefined));
      await Promise.all([firstObserved, secondObserved]);
    }
    await expect(first).resolves.toMatchObject([{ id: "prodsc-held" }]);
    await expect(second).resolves.toMatchObject([{ id: "prodsc-waiter" }]);
    const after = await commerceInventory(fixture);
    expect(after.facts.slice(before.facts.length).map(fact => fact.operation)).toEqual(["insert", "update"]);
    expect(await runEffect(fixture.host.read(link.list, { filters: { product_id: "interleaved" } }))).toMatchObject([{ id: "prodsc-waiter" }]);
  });

  it("creates both endpoints and attaches in one atomic root, reads pending graph state, publishes once, and replays", async () => {
    const product = await runEffect(makeLocalProductCommands());
    const sales = await runEffect(makeLocalSalesChannelCommands());
    const descriptor = fixture.descriptor;
    const productTables = descriptor.layout.frame.tables.filter(table => !["sales_channel", "product_sales_channel"].includes(table.identity.tableId));
    const productProfile = await runEffect(registerLocalCommerceProfile(descriptor.artifact, descriptor.layout, "medusa.product.link-foundation",
      productTables.map(table => {
        const key = table.keys.find(key => key.kind === "primary") ?? table.keys.find(key => key.kind === "unique");
        if (key === undefined) throw new Error("Missing Product key");
        return { tableId: table.identity.tableId, keyId: key.identity.keyId };
      })));
    const salesTable = descriptor.layout.frame.tables.find(table => table.identity.tableId === "sales_channel");
    const salesKey = salesTable?.keys.find(key => key.kind === "primary");
    if (salesKey === undefined) throw new Error("Missing Sales Channel key");
    const salesProfile = await runEffect(registerLocalCommerceProfile(descriptor.artifact, descriptor.layout, "medusa.sales-channel.link-foundation",
      [{ tableId: "sales_channel", keyId: salesKey.identity.keyId }]));
    const profiles = [fixture.prepared.profile, productProfile, salesProfile];
    const bindings = await runEffect(makeDataBindingHost({ ...fixture.bindingsInput, commerceProfiles: profiles }));
    const binding = await runEffect(makeCommerceBinding(fixture.availability, profiles));
    const candidate = await runEffect(bindings.prepare({ ...fixture.candidate.frame, commerce: [binding] }));
    const current = await runEffect(fixture.bindings.withCurrent(readAdmittedDataBinding));
    await runEffect(bindings.activate(dataBindingActivationRequest(fixture.candidate.frame.application.scopeId,
      fixture.candidate.frame.application.storageGeneration, "stored-link-foundation", candidate.sha256, current.head)));
    const productMetadata = await runEffect(captureProductSchema("link-foundation").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const productPolicy = productModuleEventPolicy(await runEffect(requireCommerceProfile(productProfile)), productMetadata);
    const salesPolicy = sales.eventPolicy(await runEffect(requireCommerceProfile(salesProfile)), () => Effect.void);
    const linkPolicy = link.eventPolicy(descriptor, () => Effect.void);
    const contract = (name: string, capture: typeof linkPolicy.capture) => defineCommerceEventContract({
      name, internal: true, revision: "a".repeat(64), decode: Effect.fn(function* (value) {
        const message = yield* capture(value);
        if (!isJsonObject(message) || message.name !== name) return yield* Effect.fail(commerceError("unadmittedEvent"));
        return message;
      }),
    });
    const productCreated = contract(productMetadata.product.createdEvent, productPolicy.capture);
    const salesCreated = contract(buildModuleResourceEventName({ prefix: Modules.SALES_CHANNEL, objectName: "sales_channel", action: "created" }), salesPolicy.capture);
    const attached = contract("LinkProductSalesChannel.attached", linkPolicy.capture);
    const productParticipant = defineAtomicCommerceParticipant("product");
    const salesParticipant = defineAtomicCommerceParticipant("sales-channel");
    const linkParticipant = defineAtomicCommerceParticipant("product-sales-channel");
    const graph = await runEffect(Effect.fromResult(prepareLocalGraph([{ participant: linkParticipant, module: link.graph }])));
    const create = defineAtomicCommerceCommand("productChannelLink", Effect.fn(function* (ctx, suffix) {
      if (typeof suffix !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
      yield* ctx.call(productParticipant, product.commands.create, { id: "prod-" + suffix, title: "Linked product", handle: suffix });
      if (suffix === "wrong-participant") {
        yield* ctx.call(productParticipant, link.create, pair("prod-" + suffix, "foreign-channel"));
      }
      yield* ctx.call(salesParticipant, sales.create, { id: "sc-" + suffix, name: "Linked channel" });
      // Two attaches of one pair prove earlier non-key event IDs remain valid
      // even though the final stored row already carries a replacement ID.
      yield* ctx.call(linkParticipant, link.create, pair("prod-" + suffix, "sc-" + suffix, "prodsc-old-" + suffix));
      yield* ctx.call(linkParticipant, link.create, pair("prod-" + suffix, "sc-" + suffix, "prodsc-new-" + suffix));
      const result = yield* graph.bind(ctx).graph({ entity: "product_sales_channels", fields: ["id", "product_id", "sales_channel_id"],
        filters: { product_id: "prod-" + suffix }, pagination: { take: 1 } });
      if (suffix === "rollback") yield* ctx.refuse(commerceError("invalidInput"));
      return result;
    }));
    const contracts = [productCreated, salesCreated, attached];
    const atomic = await runEffect(makeAtomicCommerceHost({ ...fixture.hostInput, commands: [create], participants: [
      { participant: productParticipant, profile: productProfile, installation: fixture.installation,
        commands: [product.commands.create], validate: productPolicy.validate, events: { contracts: [productCreated], select: () => Effect.succeed(productCreated) } },
      { participant: salesParticipant, profile: salesProfile, installation: fixture.installation,
        commands: [sales.create], validate: salesPolicy.validate, events: { contracts: [salesCreated], select: () => Effect.succeed(salesCreated) } },
      { participant: linkParticipant, profile: fixture.prepared.profile, installation: fixture.installation,
        commands: link.commands, validate: linkPolicy.validate, events: { contracts: [attached], select: () => Effect.succeed(attached) } },
    ], events: { producerRevision: "a".repeat(64), contracts, subscribers: [{ id: "stored-link", revision: "a".repeat(64) }], validate: () => Effect.void } }));
    const before = await commerceInventory(fixture);
    const key = atomic.newRequestKey();
    const result = await runEffect(atomic.run(key, create, "atomic"));
    expect(result).toEqual({ data: [{ id: "prodsc-new-atomic", product_id: "prod-atomic", sales_channel_id: "sc-atomic" }],
      metadata: { count: 1, skip: 0, take: 1 } });
    const after = await commerceInventory(fixture);
    expect(after.commits.length - before.commits.length).toBe(1);
    const facts = after.facts.slice(before.facts.length);
    expect(facts.map(fact => fact.tableId).sort()).toEqual(["product", "product_sales_channel", "product_sales_channel", "sales_channel"]);
    expect(facts.filter(fact => fact.tableId === "product_sales_channel").map(fact => fact.operation)).toEqual(["insert", "update"]);
    const events = await fixture.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.eventOrdinal);
    expect(events.map(row => row.envelope.message)).toMatchObject([
      { data: { id: "prod-atomic" } }, { data: { id: "sc-atomic" } },
      { data: { id: "prodsc-old-atomic" } }, { data: { id: "prodsc-new-atomic" } },
    ]);
    expect(await runEffect(atomic.run(key, create, "atomic"))).toEqual(result);
    expect(await commerceInventory(fixture)).toEqual(after);
    expect(await runEffectFailure(atomic.run(atomic.newRequestKey(), create, "wrong-participant"))).toBeDefined();
    expect(await commerceInventory(fixture)).toEqual(after);
    expect(await runEffectFailure(atomic.run(atomic.newRequestKey(), create, "rollback"))).toBeDefined();
    expect(await commerceInventory(fixture)).toEqual(after);
    expect(await fixture.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.eventOrdinal)).toEqual(events);
  });
});
