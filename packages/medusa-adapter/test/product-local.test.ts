import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Deferred, Effect, Exit, Option } from "effect";
import { makeLocalProductCommands } from "../src/product-service";
import { prepareLocalProductProfile } from "../src/product-profile";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata, productRelations } from "../src/product-runtime-metadata";
import { productLocalEventPolicy } from "../src/product-local-events";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../persistence-postgres/test/commerceHostFixture";
import { commerceInventory, compactCommerceHistory, expireCommerceResult } from "../../persistence-postgres/test/commerceInventory";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../persistence-postgres/test/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { makeLocalCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { defineCommerceCommand, type CommerceCommand, type CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { issueRelationalSession, runRelationalSession, type RelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/relationalTransaction/model";
import { fxSystemCommitRelationalChanges } from "../../persistence-postgres/src/commitPublication/relationalFactsSchema";
import { fxSystemCommits, fxSystemOutbox } from "../../persistence-postgres/src/schema";

const cleanup: Array<() => Promise<void>> = [];
const received: Json[] = [];
let fixture: CommerceHostTestFixture;
let runtime: Effect.Success<ReturnType<typeof makeLocalProductCommands>>;
let listenerFails = false;
let catalog: Effect.Success<ReturnType<typeof productRuntimeMetadata>>;
const run = Effect.runPromise;
const object = (value: Json | undefined): JsonObject => { if (value === undefined || !isJsonObject(value)) throw new Error("Expected object"); return value; };
const array = (value: Json | undefined): readonly Json[] => { if (!Array.isArray(value)) throw new Error("Expected array"); return value; };
// Pinned Product events.spec.ts creation scenario: 12 entities, four variant/value
// pairs. Deterministic fixture text replaces faker; the original service runs.
const nestedProduct = {
  title: "Test Product", images: [{ url: "image-1.jpg" }, { url: "image-2.jpg" }], thumbnail: "image-1.jpg",
  options: [{ title: "size", values: ["small", "medium", "large"] }, { title: "color", values: ["red", "blue"] }],
  variants: [{ title: "Small Red", sku: "small-red", options: { size: "small", color: "red" } },
    { title: "Medium Blue", sku: "medium-blue", options: { size: "medium", color: "blue" } }],
};

describe("local Product service through shared Flarex core", () => {
  beforeAll(async () => {
    runtime = await run(makeLocalProductCommands());
    catalog = await run(captureProductSchema("local-product-policy").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
    if (driver !== "pglite" && driver !== "postgres") throw new Error("Unknown test driver");
    const registerCleanup = (close: () => Promise<void>) => cleanup.push(close);
    const resource = driver === "pglite" ? await createRelationalPGliteFixture({ registerCleanup }) : await (async () => {
      const resource = await createFileScopedPostgresFixture(); registerCleanup(resource.dispose);
      return { persistence: resource.persistence, session: makePostgresRelationalSession(resource.persistence) };
    })();
    const control = driver === "pglite" ? await createMigratedPGlitePersistence(registerCleanup) : resource.persistence;
    fixture = await commerceHostFixture(resource.persistence, resource.session, prepareLocalProductProfile, Object.values(runtime.commands), control,
      descriptor => productLocalEventPolicy(descriptor, catalog, Effect.fn("ProductTest.deliver")(function* (events) {
        // This query can only complete once the command released its SQL session.
        const committed = yield* Effect.promise(() => resource.persistence.drizzle.select().from(fxSystemCommits));
        expect(committed.length).toBeGreaterThan(0);
        if (listenerFails) return yield* Effect.fail(commerceError("adapterFailure"));
        if (events.length === 12) {
          const visible = array(yield* fixture.host.read(runtime.commands.list, { filters: { handle: "test-product" }, config: { relations: productRelations } }));
          const product = object(visible[0]);
          expect(array(product.images)).toHaveLength(2);
          expect(array(product.options).flatMap(option => array(object(option).values))).toHaveLength(5);
          expect(array(product.variants)).toHaveLength(2);
          expect(array(product.variants).flatMap(variant => array(object(variant).options))).toHaveLength(4);
        }
        received.push(...events);
      })));
  }, 120000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("creates the pinned nested graph, releases all 12 messages after commit, and replays without re-emitting", async () => {
    const key = fixture.host.newRequestKey();
    const result = await run(fixture.host.run(key, runtime.commands.create, [nestedProduct]));
    const product = object(array(result)[0]);
    expect(product).toMatchObject({ title: "Test Product", handle: "test-product", thumbnail: "image-1.jpg", status: "draft", is_giftcard: false, discountable: true });
    expect(array(product.images)).toHaveLength(2);
    expect(array(product.options)).toHaveLength(2);
    expect(array(product.options).flatMap(option => array(object(option).values))).toHaveLength(5);
    expect(array(product.variants)).toHaveLength(2);
    for (const variant of array(product.variants)) expect(array(object(variant).options)).toHaveLength(2);
    expect(received).toHaveLength(12);
    const expected = [{ object: "product", rows: [product] }, { object: "product_image", rows: array(product.images) },
      { object: "product_option", rows: array(product.options) }, { object: "product_option_value", rows: array(product.options).flatMap(option => array(object(option).values)) },
      { object: "product_variant", rows: array(product.variants) }];
    for (const group of expected) for (const row of group.rows) expect(received).toContainEqual({
      name: "product." + group.object.replaceAll("_", "-") + ".created", metadata: { source: "product", object: group.object, action: "created" }, data: { id: object(row).id },
    });
    const facts = await fixture.persistence.drizzle.select().from(fxSystemCommitRelationalChanges);
    expect(facts).toHaveLength(16);
    expect(facts.filter(fact => fact.codecVersion === 2)).toHaveLength(4);
    expect((await fixture.persistence.drizzle.select().from(fxSystemCommits))[0]?.relationalChangeCount).toBe(16);
    const outbox = await fixture.persistence.drizzle.select().from(fxSystemOutbox);
    expect(outbox).toHaveLength(1);
    expect(JSON.stringify(outbox, (_, value) => typeof value === "bigint" ? String(value) : value)).not.toContain(".created");
    expect(await run(fixture.host.run(key, runtime.commands.create, [nestedProduct]))).toEqual(result);
    expect(received).toHaveLength(12);
    expect(fixture.takeDeliveries()).toHaveLength(1);
  });

  it("reads populated graphs and bounded projections without emitting", async () => {
    const products = array(await run(fixture.host.read(runtime.commands.list, { filters: { handle: "test-product" }, config: { relations: productRelations } })));
    const product = object(products[0]);
    expect(array(product.variants)).toHaveLength(2);
    expect(array(product.images).map(image => object(image).rank)).toEqual([0, 1]);
    if (typeof product.id !== "string") throw new Error("Missing Product id");
    const result = await run(fixture.host.read(runtime.commands.retrieve, { id: product.id, config: { select: ["title"] } }));
    expect(result).toEqual({ title: "Test Product" });
    expect(received).toHaveLength(12);
  });

  it("refuses invalid variants, duplicate identities and existing associations before publication", async () => {
    const before = await fixture.persistence.drizzle.select().from(fxSystemCommitRelationalChanges);
    for (const input of [
      { title: "Invalid variant", options: [{ title: "size", values: ["small"] }], variants: [{ title: "bad", options: { size: "missing" } }] },
      { title: "Existing association", tags: [{ id: "tag_existing" }] },
      { title: "Duplicate identity", images: [{ id: "img_duplicate", url: "one" }, { id: "img_duplicate", url: "two" }] },
      { title: "Duplicate SKU", variants: [{ title: "one", sku: "same-sku" }, { title: "two", sku: "same-sku" }] },
    ]) expect(Exit.isFailure(await run(Effect.exit(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, input))))).toBe(true);
    expect(await fixture.persistence.drizzle.select().from(fxSystemCommitRelationalChanges)).toEqual(before);
    expect(received).toHaveLength(12);
  });

  it("rolls back late graph failure and rejects unsupported relations and event-bearing ordinary hosts", async () => {
    const before = await fixture.persistence.drizzle.select().from(fxSystemCommitRelationalChanges);
    const failed = await run(Effect.exit(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, {
      title: "Duplicate option rollback", options: [{ title: "size", values: ["small", "small"] }],
    })));
    expect(Exit.isFailure(failed)).toBe(true);
    expect(await fixture.persistence.drizzle.select().from(fxSystemCommitRelationalChanges)).toEqual(before);
    expect(array(await run(fixture.host.read(runtime.commands.list, { filters: { handle: "duplicate-option-rollback" } })))).toHaveLength(0);
    expect(Exit.isFailure(await run(Effect.exit(fixture.host.read(runtime.commands.list, { config: { relations: ["tags"] } }))))).toBe(true);
    expect(Exit.isFailure(await run(Effect.exit(makeCommerceHost(fixture.hostInput))))).toBe(true);
    expect(received).toHaveLength(12);
  });

  it("keeps a committed successful result when a local listener fails", async () => {
    listenerFails = true;
    const key = fixture.host.newRequestKey();
    const args = { title: "Listener failure" };
    try {
      const result = await run(fixture.host.run(key, runtime.commands.create, args));
      expect(object(result).handle).toBe("listener-failure");
      const diagnostics = fixture.takeDeliveries();
      expect(diagnostics).toHaveLength(1);
      const diagnostic = diagnostics[0];
      if (diagnostic === undefined) throw new Error("Missing delivery diagnostic");
      expect(Exit.isFailure(diagnostic.outcome)).toBe(true);
      expect(await run(fixture.host.run(key, runtime.commands.create, args))).toEqual(result);
      expect(fixture.takeDeliveries()).toHaveLength(0);
    } finally { listenerFails = false; }
  });

  const localHost = (extra: readonly CommerceCommand[] = [], session: RelationalSession = fixture.session) => run(makeLocalCommerceHost({ ...fixture.hostInput,
    session, commands: [...Object.values(runtime.commands), ...extra],
  }, productLocalEventPolicy(fixture.descriptor, catalog, Effect.fn("ProductTest.record")((events) => Effect.sync(() => { received.push(...events); })))));

  it("keeps nested framework work in one commit and caught event failures rollback-only", async () => {
    const before = received.length;
    let endedContext: CommerceCommandContext | undefined;
    const nested = defineCommerceCommand("productBorrowedProof", "write", Effect.fn("ProductTest.borrow")(function* (ctx) {
      endedContext = ctx;
      return yield* runtime.withService(ctx, ({ repository, service }) => repository.transaction(async manager => {
        const context = { manager, transactionManager: manager };
        const product = await service.createProducts({ title: "Borrowed Product" }, context);
        expect((await service.retrieveProduct(product.id, {}, context)).handle).toBe("borrowed-product");
        return product;
      }));
    }));
    const bad = defineCommerceCommand("productCaughtEventProof", "write", Effect.fn("ProductTest.badEvent")(function* (ctx) {
      const value = yield* ctx.nested(runtime.commands.create, { title: "Caught event rollback" });
      yield* Effect.result(ctx.captureLocalEvent({ name: "product.product.created", metadata: { source: "product", object: "product", action: "created" }, data: { id: "forged" }, options: { delay: 1 } }));
      return value;
    }));
    const local = await localHost([nested, bad]);
    expect(object(await run(local.host.run(local.host.newRequestKey(), nested, null))).handle).toBe("borrowed-product");
    expect(received).toHaveLength(before + 1);
    if (endedContext === undefined) throw new Error("Missing completed context");
    expect(Exit.isFailure(await run(Effect.exit(endedContext.captureLocalEvent({ name: "late" }))))).toBe(true);
    expect(received).toHaveLength(before + 1);
    expect(Exit.isFailure(await run(Effect.exit(local.host.run(local.host.newRequestKey(), bad, null))))).toBe(true);
    expect(received).toHaveLength(before + 1);
    expect(array(await run(local.host.read(runtime.commands.list, { filters: { handle: "caught-event-rollback" } })))).toHaveLength(0);
    for (const operation of ["subscribe", "unsubscribe"] as const) {
      const caught = defineCommerceCommand("productCaught" + operation, "write", Effect.fn("ProductTest.caughtSynchronousRefusal")(function* (ctx) {
        return yield* runtime.withService(ctx, async ({ service, context, eventBus }) => {
          const product = await service.createProducts({ title: "Caught synchronous " + operation }, context);
          try { eventBus[operation]("product.product.created", async () => {}); } catch { /* Caller deliberately swallows the refusal. */ }
          return product;
        });
      }));
      const rejecting = await localHost([caught]);
      const inventory = await commerceInventory(fixture);
      expect(Exit.isFailure(await run(Effect.exit(rejecting.host.run(rejecting.host.newRequestKey(), caught, null))))).toBe(true);
      expect(await commerceInventory(fixture)).toEqual(inventory);
      expect(received).toHaveLength(before + 1);
    }
  });

  it("rolls back a pending graph and buffered events when the command is cancelled", async () => {
    const reached = await run(Deferred.make<void>());
    const command = defineCommerceCommand("productCancellation", "write", Effect.fn("ProductTest.cancel")(function* (ctx) {
      yield* ctx.nested(runtime.commands.create, { title: "Cancelled Product", images: [{ url: "cancelled.jpg" }] });
      yield* Deferred.succeed(reached, undefined);
      return yield* Effect.never;
    }));
    const local = await localHost([command]);
    const before = await commerceInventory(fixture);
    const eventCount = received.length;
    const controller = new AbortController();
    const pending = Effect.runPromiseExit(local.host.run(local.host.newRequestKey(), command, null), { signal: controller.signal });
    try {
      await Promise.race([run(Deferred.await(reached)), pending.then(exit => { throw new Error("Command settled before cancellation: " + exit._tag); })]);
      controller.abort();
      expect(Exit.isFailure(await pending)).toBe(true);
    } finally { controller.abort(); await pending; }
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(received).toHaveLength(eventCount);
  });

  it("refuses unadmitted tables and valid-looking forged events after pending inserts", async () => {
    const table = defineCommerceCommand("productUnadmittedTable", "write", Effect.fn("ProductTest.unadmittedTable")(function* (ctx) {
      yield* ctx.nested(runtime.commands.create, { title: "Unadmitted table rollback" });
      yield* Effect.result(ctx.table("product_tag"));
      return null;
    }));
    const forged = defineCommerceCommand("productForgedEvent", "write", Effect.fn("ProductTest.forgedEvent")(function* (ctx) {
      yield* ctx.nested(runtime.commands.create, { title: "Forged event rollback" });
      yield* ctx.captureLocalEvent({ name: "product.product.created", metadata: { source: "product", object: "product", action: "created" }, data: { id: "prod_not_written" } });
      return null;
    }));
    const local = await localHost([table, forged]);
    const before = await commerceInventory(fixture);
    const count = received.length;
    for (const command of [table, forged]) expect(Exit.isFailure(await run(Effect.exit(local.host.run(local.host.newRequestKey(), command, null))))).toBe(true);
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(received).toHaveLength(count);
  });

  it("rolls back rows and the local buffer if any durable finalization write fails", async () => {
    const local = await localHost();
    const before = await commerceInventory(fixture);
    const eventCount = received.length;
    for (const table of ["fx_system_commit", "fx_system_commit_relational_change", "fx_system_idempotency", "fx_system_outbox", "fx_system_scope_clock"]) {
      await fixture.persistence.exec("create function fx_test_product_failure() returns trigger language plpgsql as $$ begin raise exception 'Product finalization failure'; end $$");
      try {
        await fixture.persistence.exec(`create trigger fx_test_product_failure before ${table === "fx_system_scope_clock" ? "update" : "insert"} on "${table}" for each row execute function fx_test_product_failure()`);
        expect(Exit.isFailure(await run(Effect.exit(local.host.run(local.host.newRequestKey(), runtime.commands.create, { title: "Finalizer rollback" }))))).toBe(true);
      } finally {
        await fixture.persistence.exec(`drop trigger if exists fx_test_product_failure on "${table}"`);
        await fixture.persistence.exec("drop function fx_test_product_failure()");
      }
    }
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(received).toHaveLength(eventCount);
    expect(array(await run(local.host.read(runtime.commands.list, { filters: { handle: "finalizer-rollback" } })))).toHaveLength(0);
  });

  it("recovers an ambiguous COMMIT result while discarding unauthenticated local events", async () => {
    let loseAcknowledgement = true;
    const session = issueRelationalSession(fixture.persistence.drizzle, work => runRelationalSession(fixture.session, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => {
        if (!loseAcknowledgement) return Effect.succeed(value);
        loseAcknowledgement = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost COMMIT acknowledgement") }));
      }),
    ));
    const local = await localHost([], session);
    const key = local.host.newRequestKey();
    const args = { title: "Acknowledgement recovery" };
    const before = received.length;
    const value = await run(local.host.run(key, runtime.commands.create, args));
    expect(object(value).handle).toBe("acknowledgement-recovery");
    expect(received).toHaveLength(before);
    const dropped = local.takeDeliveries();
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.outcome).toMatchObject({ _tag: "Failure" });
    expect(local.takeDeliveries()).toHaveLength(0);
    const reopened = await localHost();
    expect(await run(reopened.host.run(key, runtime.commands.create, args))).toEqual(value);
    expect(received).toHaveLength(before);
    expect(reopened.takeDeliveries()).toHaveLength(0);
  });

  it("loses only the local buffer when recovery is unavailable, then replays the retained result without messages", async () => {
    let attempts = 0;
    const session = issueRelationalSession(fixture.persistence.drizzle, work => Effect.suspend(() => {
      attempts += 1;
      if (attempts > 1) return Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause: new Error("Recovery unavailable") }));
      return runRelationalSession(fixture.session, work).pipe(
        Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
        Effect.andThen(Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost acknowledgement") }))),
      );
    }));
    const local = await localHost([], session);
    const key = local.host.newRequestKey();
    const input = { title: "Unavailable recovery" };
    const before = received.length;
    expect(Exit.isFailure(await run(Effect.exit(local.host.run(key, runtime.commands.create, input))))).toBe(true);
    expect(attempts).toBe(2);
    expect(received).toHaveLength(before);
    const reopened = await localHost();
    expect(object(await run(reopened.host.run(key, runtime.commands.create, input))).handle).toBe("unavailable-recovery");
    expect(received).toHaveLength(before);
    expect(reopened.takeDeliveries()).toHaveLength(0);
  });

  it("does not release a rolled-back buffer when a competing identical request supplies recovery", async () => {
    const command = defineCommerceCommand("productCompetingRecovery", "write", Effect.fn("ProductTest.competingRecovery")(function* (ctx) {
      yield* ctx.nested(runtime.commands.create, { id: "prod_competing_uncertain", title: "Competing recovery" });
      return { accepted: true };
    }));
    const competitor = await localHost([command]);
    const key = competitor.host.newRequestKey();
    let first = true;
    const session = issueRelationalSession(fixture.persistence.drizzle, work => Effect.gen(function* () {
      if (!first) return yield* runRelationalSession(fixture.session, work).pipe(
        Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))));
      first = false;
      const uncertain = new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Rolled back, acknowledgement lost") });
      // Finalize A, roll it back, then commit B before reporting uncertainty to A.
      // Both use the same IDs/result, so neither proves the buffer's ownership.
      const outcome = yield* Effect.exit(runRelationalSession(fixture.session, tx => work(tx).pipe(Effect.andThen(Effect.fail(uncertain)))).pipe(
        Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      ));
      if (Exit.isSuccess(outcome)) return outcome.value;
      const error = Cause.findErrorOption(outcome.cause);
      if (Option.isNone(error) || error.value !== uncertain) return yield* Effect.failCause(outcome.cause);
      yield* competitor.host.run(key, command, null).pipe(Effect.mapError(cause => new RelationalSessionError({ reason: "resourceFailure", cause })));
      return yield* Effect.fail(uncertain);
    }));
    const local = await localHost([command], session);
    const before = received.length;
    expect(await run(local.host.run(key, command, null))).toEqual({ accepted: true });
    expect(received).toHaveLength(before + 1);
    expect(array(await run(competitor.host.read(runtime.commands.list, { filters: { handle: "competing-recovery" } })))).toHaveLength(1);
    expect(local.takeDeliveries()[0]?.outcome).toMatchObject({ _tag: "Failure" });
  });

  it("serializes concurrent duplicate handles into one graph and one local release", async () => {
    const local = await localHost();
    const before = received.length;
    const input = { title: "Concurrent unique Product" };
    const outcomes = await Promise.all([0, 1].map(() => run(Effect.exit(local.host.run(local.host.newRequestKey(), runtime.commands.create, input)))));
    expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1);
    expect(outcomes.filter(Exit.isFailure)).toHaveLength(1);
    expect(received).toHaveLength(before + 1);
    expect(array(await run(local.host.read(runtime.commands.list, { filters: { handle: "concurrent-unique-product" } })))).toHaveLength(1);
  });

  it("rejects request-key conflicts and preserves rows without recreating events after retained history expires", async () => {
    const local = await localHost();
    const key = local.host.newRequestKey();
    const input = { title: "Retained Product" };
    const original = await run(local.host.run(key, runtime.commands.create, input));
    const afterCreate = await commerceInventory(fixture);
    const eventCount = received.length;
    expect(await run(Effect.result(local.host.run(key, runtime.commands.create, { title: "Conflicting Product" })))).toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
    expect(await commerceInventory(fixture)).toEqual(afterCreate);
    expect(received).toHaveLength(eventCount);
    await run(local.host.run(local.host.newRequestKey(), runtime.commands.create, { title: "Retention fence" }));
    const before = await commerceInventory(fixture);
    const last = before.commits.at(-1);
    if (last === undefined) throw new Error("Missing retained history");
    const compacted = await compactCommerceHistory(fixture);
    expect(compacted.commits).toHaveLength(1);
    expect(compacted.tables).toEqual(before.tables);
    expect(compacted.facts.every(fact => fact.commitSeq === last.commitSeq)).toBe(true);
    expect(await run(local.host.run(key, runtime.commands.create, input))).toEqual(original);
    expect(received).toHaveLength(eventCount + 1);
    await expireCommerceResult(fixture, key);
    expect(await run(Effect.result(local.host.run(key, runtime.commands.create, input)))).toMatchObject({ _tag: "Failure", failure: { reason: "resultUnavailable" } });
    expect(received).toHaveLength(eventCount + 1);
  });
});
