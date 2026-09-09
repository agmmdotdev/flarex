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
import { fxSystemCommits, fxSystemOutbox, fxSystemScopeClocks } from "../../persistence-postgres/src/schema";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";

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
    const nested = object(await run(fixture.host.read(runtime.commands.retrieve, {
      id: product.id, config: { select: ["title"], relations: ["variants.options", "variants.options"] },
    })));
    expect(Object.keys(nested).sort()).toEqual(["title", "variants"]);
    expect(nested.variants).toEqual(product.variants);
    for (const variant of array(nested.variants)) {
      const selected = object(variant);
      const values = array(selected.options).map(value => object(value).value).sort();
      expect(values).toEqual(selected.sku === "small-red" ? ["red", "small"] : ["blue", "medium"]);
    }
    const counted = array(await run(fixture.host.read(runtime.commands.count, {
      filters: { handle: "test-product" }, config: { take: 0, relations: ["variants.options"] },
    })));
    expect(counted).toEqual([[], 1]);
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
    expect(Exit.isFailure(await run(Effect.exit(fixture.host.read(runtime.commands.list, { config: { relations: ["variants.inventory_items"] } }))))).toBe(true);
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
      yield* Effect.result(ctx.table("product_unadmitted"));
      return null;
    }));
    const forged = defineCommerceCommand("productForgedEvent", "write", Effect.fn("ProductTest.forgedEvent")(function* (ctx) {
      yield* ctx.nested(runtime.commands.create, { title: "Forged event rollback" });
      yield* ctx.captureLocalEvent({ name: "product.product.created", metadata: { source: "product", object: "product", action: "created" }, data: { id: "prod_not_written" } });
      return null;
    }));
    const category = defineCommerceCommand("productUnauthenticatedCategory", "write", Effect.fn("ProductTest.unauthenticatedCategory")(function* (ctx) {
      const store = yield* ctx.table(catalog.category.table.name);
      yield* store.write(ctx.manager, "insert", [{ id: "pcat_refused", name: "Unadmitted", handle: "unadmitted", mpath: "pcat_refused" }]);
      return null;
    }));
    const local = await localHost([table, forged, category]);
    const before = await commerceInventory(fixture);
    const count = received.length;
    for (const command of [table, forged]) expect(Exit.isFailure(await run(Effect.exit(local.host.run(local.host.newRequestKey(), command, null))))).toBe(true);
    expect(await run(Effect.result(local.host.run(local.host.newRequestKey(), category, null))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
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

  it("preserves related identities, exact creation events, explicit ranks and nested projections", async () => {
    const write = (command: CommerceCommand, input: Json) => run(fixture.host.run(fixture.host.newRequestKey(), command, input));
    const tag = object(await write(runtime.commands.createTags, { value: "related-tag" }));
    const type = object(await write(runtime.commands.createTypes, { value: "related-type" }));
    const collection = object(await write(runtime.commands.createCollections, { id: "pcol_related", title: "Related Collection" }));
    if (typeof tag.id !== "string" || typeof type.id !== "string" || typeof collection.id !== "string") throw new Error("Missing related identity");
    expect(collection).toMatchObject({ id: "pcol_related", handle: "related-collection" });
    const before = received.length;
    const key = fixture.host.newRequestKey();
    const input = { title: "Related Product", tag_ids: [tag.id], type_id: type.id, collection_id: collection.id };
    const product = object(await run(fixture.host.run(key, runtime.commands.create, input)));
    if (typeof product.id !== "string") throw new Error("Missing Product identity");
    expect(product.tags).toEqual([tag]);
    // Collection creation populates its products; this Product relation does not.
    const { products: collectionProducts, ...collectionFields } = collection;
    expect(collectionProducts).toEqual([]);
    expect(product.collection).toEqual(collectionFields);
    expect(product.type).toEqual(type);
    expect(product.categories).toEqual([]);
    expect(received.slice(before)).toEqual([{ name: "product.product.created", metadata: { source: "product", object: "product", action: "created" }, data: { id: product.id } }]);
    expect(await run(fixture.host.run(key, runtime.commands.create, input))).toEqual(product);
    expect(received).toHaveLength(before + 1);
    await write(runtime.commands.createImages, [ { product_id: product.id, url: "later", rank: 2 }, { product_id: product.id, url: "first", rank: 0 } ]);
    const selected = object(await run(fixture.host.read(runtime.commands.retrieve, { id: product.id,
      config: { select: ["title", "collection.title", "type.value"], relations: ["collection", "type", "images"] },
    })));
    expect(selected.collection).toEqual({ title: "Related Collection" });
    expect(selected.type).toEqual({ value: "related-type" });
    expect(Object.keys(selected).sort()).toEqual(["collection", "images", "title", "type"]);
    expect(array(selected.images).map(row => object(row).rank)).toEqual([0, 2]);
    expect(received.filter(event => object(event).name === "product.product-collection.created" && object(object(event).data).id === collection.id)).toHaveLength(1);
  });

  it("rolls back related batches and refuses replacement, category writes and missing associations", async () => {
    const before = await commerceInventory(fixture);
    const eventCount = received.length;
    const failures: readonly [CommerceCommand, Json][] = [
      [runtime.commands.createCollections, { id: "pcol_related", title: "Overwrite" }],
      [runtime.commands.createCollections, { title: "Reassignment", product_ids: ["prod_missing"] }],
      [runtime.commands.createTags, [{ id: "ptag_rollback", value: "batch-one" }, { id: "ptag_rollback", value: "batch-two" }]],
      [runtime.commands.createImages, [{ product_id: "prod_missing", url: "orphan" }]],
      [runtime.commands.create, { title: "Missing association", tag_ids: ["ptag_missing"] }],
      [runtime.commands.create, { title: "Missing collection", collection_id: "pcol_missing" }],
      [runtime.commands.create, { title: "Missing type", type_id: "ptyp_missing" }],
      [runtime.commands.create, { title: "Category writes blocked", category_ids: ["pcat_missing"] }],
    ];
    for (const [command, input] of failures) expect(Exit.isFailure(await run(Effect.exit(fixture.host.run(fixture.host.newRequestKey(), command, input))))).toBe(true);
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(received).toHaveLength(eventCount);
  });

  it("correlates relation filters before paging and counting and validates empty-result projections", async () => {
    const products = array(await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, [
      { id: "prod_filter_a", title: "Filter A", options: [{ title: "size", values: ["slice-small", "slice-large"] }],
        variants: [{ title: "Small", options: { size: "slice-small" } }, { title: "Large", options: { size: "slice-large" } }] },
      { id: "prod_filter_b", title: "Filter B", options: [{ title: "size", values: ["slice-small"] }, { title: "region", values: ["only-b"] }],
        variants: [{ title: "Small", options: { size: "slice-small", region: "only-b" } }] },
    ])));
    const optionId = object(array(object(products[0]).options)[0]).id;
    if (typeof optionId !== "string") throw new Error("Missing option identity");
    const matching = { variants: { options: { value: "slice-small" } } };
    const counted = array(await run(fixture.host.read(runtime.commands.count, { filters: matching, config: { skip: 1, take: 1 } })));
    expect(counted[1]).toBe(2);
    expect(array(counted[0]).map(row => object(row).id)).toEqual(["prod_filter_b"]);
    const correlated = array(await run(fixture.host.read(runtime.commands.list, { filters: { variants: { options: { option_id: optionId, value: "slice-small" } } } })));
    expect(correlated.map(row => object(row).id)).toEqual(["prod_filter_a"]);
    expect(await run(fixture.host.read(runtime.commands.list, { filters: { variants: { options: { option_id: optionId, value: "only-b" } } } }))).toEqual([]);
    expect(object(products[0]).collection).toBeNull();
    const deduplicated = array(await run(fixture.host.read(runtime.commands.count, {
      filters: { variants: { options: { option_id: optionId } } },
    })));
    expect(deduplicated[1]).toBe(1);
    expect(array(deduplicated[0])).toHaveLength(1);
    const missing = { categories: { id: ["pcat_missing"] } };
    expect(await run(fixture.host.read(runtime.commands.list, { filters: missing, config: { select: ["title", "collection.title"], relations: ["collection"] } }))).toEqual([]);
    expect(await run(Effect.result(fixture.host.read(runtime.commands.list, { filters: missing,
      config: { select: ["collection.secret"], relations: ["collection"] },
    })))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });

  it("updates complete multi-ID sets with managed timestamps, metadata merging and replay", async () => {
    const created = array(await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createTags,
      Array.from({ length: 16 }, (_, index) => ({ id: "ptag_update_" + index, value: "update-before-" + index, metadata: { keep: "yes", remove: "old" } })))));
    const before = await commerceInventory(fixture);
    const events = received.length;
    const request = fixture.host.newRequestKey();
    const input = created.map((value, index) => {
      const id = object(value).id;
      if (typeof id !== "string") throw new Error("Missing created tag");
      return { id, value: "update-after-" + index, metadata: { remove: "", added: true } };
    });
    const result = array(await run(fixture.host.run(request, runtime.commands.upsertTags, input)));
    expect(result).toHaveLength(16);
    for (const row of result) {
      const changed = object(row);
      const original = created.map(object).find(value => value.id === changed.id);
      expect(changed.created_at).toEqual(original?.created_at);
      expect(changed.updated_at).not.toEqual(original?.updated_at);
      expect(changed.metadata).toEqual({ keep: "yes", added: true });
    }
    const after = await commerceInventory(fixture);
    expect(after.facts.slice(before.facts.length).map(fact => fact.operation)).toEqual(Array.from({ length: 16 }, () => "update"));
    expect(received.slice(events).map(event => object(event).name)).toEqual(Array.from({ length: 16 }, () => "product.product-tag.updated"));
    expect(after.tables[catalog.type.table.name]).toEqual(before.tables[catalog.type.table.name]);
    expect(await run(fixture.host.run(request, runtime.commands.upsertTags, input))).toEqual(result);
    expect(await commerceInventory(fixture)).toEqual(after);
    expect(received).toHaveLength(events + 16);
    const id = object(result[0]).id;
    if (typeof id !== "string") throw new Error("Missing updated tag");
    const empty = object(await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.updateTags, { id, data: {} })));
    expect(empty.value).toEqual(object(result[0]).value);
    expect(received).toHaveLength(events + 17);
    expect((await commerceInventory(fixture)).facts.at(-1)?.operation).toBe("update");
  });

  it("rolls back mixed creates and updates when a later ID is missing and refuses identity/lifecycle writes", async () => {
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createTypes, { id: "ptyp_update_atomic", value: "before-atomic" }));
    const before = await commerceInventory(fixture);
    const events = received.length;
    const missing = await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.upsertTypes,
      [{ value: "must-roll-back" }, { id: "ptyp_update_atomic", value: "also-roll-back" }, { id: "ptyp_absent", value: "missing" }])));
    expect(missing).toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure", cause: { message: expect.stringContaining("ptyp_absent") } } });
    for (const data of [{ id: "ptyp_moved" }, { created_at: "2026-01-01T00:00:00.000Z" }, { updated_at: "2026-01-01T00:00:00.000Z" }, { deleted_at: null }, { products: [] }]) {
      expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.updateTypes, { id: "ptyp_update_atomic", data }))))
        .toMatchObject({ _tag: "Failure" });
    }
    expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.upsertTypes,
      [{ id: "ptyp_update_atomic", value: "first" }, { id: "ptyp_update_atomic", value: "last" }])))).toMatchObject({ _tag: "Failure" });
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(received).toHaveLength(events);
  });

  it("keeps core table update admission narrow and authenticates operation-specific events", async () => {
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createTags, { id: "ptag_event_update", value: "event-before" }));
    const clock = (await fixture.persistence.drizzle.select().from(fxSystemScopeClocks))[0];
    if (clock === undefined) throw new Error("Missing scope clock");
    const alienUuid = "c7aab926-7cdb-4c8b-a5f4-e520b695083e";
    await fixture.persistence.drizzle.insert(fxSystemScopeClocks).values({
      scopeId: ScopeIdSchema.make("scope_" + alienUuid), storageGeneration: clock.storageGeneration, epoch: clock.epoch,
    });
    const physical = fixture.descriptor.layout.frame.tables.find(table => table.identity.tableId === catalog.tag.table.name);
    const idColumn = physical?.columns.find(column => column.identity.columnId === "id");
    const valueColumn = physical?.columns.find(column => column.identity.columnId === "value");
    if (physical === undefined || idColumn === undefined || valueColumn === undefined) throw new Error("Missing tag layout");
    // Deliberate wrong-scope fixture: identifiers come from the compiled layout.
    const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
    await fixture.persistence.query(`insert into ${quote(fixture.descriptor.layout.frame.targetNamespace.schemaName)}.${quote(physical.name)}
      ("scope_uuid", ${quote(idColumn.name)}, ${quote(valueColumn.name)}) values ($1::uuid, $2, $3)`, [alienUuid, "ptag_other_scope", "foreign-value"]);
    const before = await commerceInventory(fixture);
    const events = received.length;
    const raw = defineCommerceCommand("productRawUpdateProof", "write", Effect.fn("ProductTest.rawUpdate")(function* (ctx, input) {
      const args = object(input);
      if (typeof args.table !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
      const store = yield* ctx.table(args.table);
      const rows = args.rows;
      if (args.mode === "delete") return yield* store.delete(ctx.manager, rows);
      const written = yield* store.write(ctx.manager, args.mode === "insert" ? "insert" : args.mode === "upsert" ? "upsert" : "update", rows);
      if (args.message !== undefined) {
        yield* ctx.captureLocalEvent(args.message);
        if (args.duplicate === true) yield* ctx.captureLocalEvent(args.message);
      }
      return [...written];
    }));
    const local = await localHost([raw]);
    const message = { name: "product.product-tag.created", metadata: { source: "product", object: "product_tag", action: "created" }, data: { id: "ptag_event_update" } };
    const updated = { ...message, name: "product.product-tag.updated", metadata: { ...message.metadata, action: "updated" } };
    const rows = [{ id: "ptag_event_update", value: "event-after" }];
    for (const input of [
      { table: catalog.tag.table.name, rows, message },
      { table: catalog.tag.table.name, rows },
      { table: catalog.tag.table.name, rows, message: updated, duplicate: true },
      { table: catalog.tag.table.name, rows, message: { ...updated, name: "product.product-tag.restored", metadata: { ...updated.metadata, action: "restored" } } },
      { table: catalog.tag.table.name, rows: [{ id: "ptag_missing_scoped", value: "absent" }], message: updated },
      // Different column groups force a real first write before the missing
      // update or duplicate insert fails in the later group.
      { table: catalog.tag.table.name, rows: [{ id: "ptag_event_update", value: "first-group" }, { id: "ptag_missing_group", metadata: { later: true } }], message: updated },
      { table: catalog.tag.table.name, mode: "insert", rows: [{ id: "ptag_first_group", value: "first-group" }, { id: "ptag_event_update", value: "duplicate", metadata: { later: true } }], message },
      { table: catalog.tag.table.name, rows: [{ id: "ptag_other_scope", value: "must-not-change" }], message: { ...updated, data: { id: "ptag_other_scope" } } },
      { table: catalog.tag.table.name, rows: [{ id: "ptag_event_update", created_at: "2026-01-01T00:00:00.000Z" }], message: updated },
      { table: catalog.tag.table.name, rows: [{ id: "ptag_event_update", updated_at: "2026-01-01T00:00:00.000Z" }], message: updated },
      { table: catalog.tag.table.name, rows: [{ id: "ptag_event_update", deleted_at: null }], message: updated },
      { table: catalog.tag.table.name, rows, mode: "upsert" },
      { table: catalog.tag.table.name, rows: ["ptag_event_update"], mode: "delete" },
      { table: catalog.collection.table.name, rows: [{ id: "pcol_not_admitted", title: "no" }] },
    ]) expect(await run(Effect.result(local.host.run(local.host.newRequestKey(), raw, input)))).toMatchObject({ _tag: "Failure" });
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(received).toHaveLength(events);
    const repeated = defineCommerceCommand("productRepeatedUpdateProof", "write", Effect.fn("ProductTest.repeatedUpdate")(function* (ctx) {
      yield* ctx.nested(runtime.commands.updateTags, { id: "ptag_event_update", data: { value: "touch-one" } });
      return yield* ctx.nested(runtime.commands.updateTags, { id: "ptag_event_update", data: { value: "touch-two" } });
    }));
    const repeatedHost = await localHost([repeated]);
    expect(await run(Effect.result(repeatedHost.host.run(repeatedHost.host.newRequestKey(), repeated, {})))).toMatchObject({ _tag: "Failure" });
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(received).toHaveLength(events);
  });

  it("recovers an ambiguous update commit without delivering or replaying the local event", async () => {
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createTypes, { id: "ptyp_uncertain_update", value: "uncertain-before" }));
    let loseAcknowledgement = true;
    const session = issueRelationalSession(fixture.persistence.drizzle, work => runRelationalSession(fixture.session, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => {
        if (!loseAcknowledgement) return Effect.succeed(value);
        loseAcknowledgement = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost update COMMIT acknowledgement") }));
      }),
    ));
    const local = await localHost([], session);
    const key = local.host.newRequestKey();
    const input = { id: "ptyp_uncertain_update", data: { value: "uncertain-after" } };
    const events = received.length;
    const result = await run(local.host.run(key, runtime.commands.updateTypes, input));
    expect(object(result).value).toBe("uncertain-after");
    expect(received).toHaveLength(events);
    expect(local.takeDeliveries()).toMatchObject([{ outcome: { _tag: "Failure" } }]);
    const reopened = await localHost();
    expect(await run(reopened.host.run(key, runtime.commands.updateTypes, input))).toEqual(result);
    expect(received).toHaveLength(events);
    expect(reopened.takeDeliveries()).toHaveLength(0);
  });

  it("loads every existing tag beyond the ordinary 15-row page without recreating tags", async () => {
    const tags = array(await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createTags,
      Array.from({ length: 16 }, (_, index) => ({ id: "ptag_many_" + index, value: "many-tag-" + index })))));
    const ids = tags.map(value => {
      const id = object(value).id;
      if (typeof id !== "string") throw new Error("Missing tag identity");
      return id;
    });
    const before = received.length;
    const product = object(await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create,
      { title: "Many existing tags", tag_ids: ids })));
    if (typeof product.id !== "string") throw new Error("Missing Product identity");
    expect(array(product.tags).map(value => object(value).id).sort()).toEqual([...ids].sort());
    expect(received).toHaveLength(before + 1);
    expect(object(received.at(-1)).name).toBe("product.product.created");
    const read = object(await run(fixture.host.read(runtime.commands.retrieve, { id: product.id, config: { relations: ["tags"] } })));
    expect(read.tags).toEqual(product.tags);
  });

  it("creates real category root paths and sibling ranks while authenticating batch IDs", async () => {
    const eventCount = received.length;
    const created = array(await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCategories, [
      { id: "pcat_root_a", name: "Root A" }, { id: "pcat_root_b", name: "Root B" },
    ])));
    expect(created.map(value => object(value).mpath)).toEqual(["pcat_root_a", "pcat_root_b"]);
    const rank = object(created[0]).rank;
    expect(typeof rank).toBe("number");
    if (typeof rank !== "number") throw new Error("Missing category rank");
    expect(object(created[1]).rank).toBe(rank + 1);
    expect(received.slice(eventCount)).toEqual([{ name: "product.product-category.created",
      metadata: { source: "product", object: "product_category", action: "created" }, data: { id: ["pcat_root_a", "pcat_root_b"] } }]);
    const before = await commerceInventory(fixture);
    for (const data of [{ mpath: "forged" }]) {
      expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.updateCategories, { id: "pcat_root_a", data }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    }
    expect(await commerceInventory(fixture)).toEqual(before);
    const forgedBatch = defineCommerceCommand("productForgedCategoryBatch", "write", Effect.fn("ProductTest.forgedCategoryBatch")(function* (ctx, ids) {
      const store = yield* ctx.table(catalog.category.table.name);
      yield* store.write(ctx.manager, "insert", [
        { id: "pcat_batch_a", name: "Batch A", handle: "batch-a", mpath: "pcat_batch_a" },
        { id: "pcat_batch_b", name: "Batch B", handle: "batch-b", mpath: "pcat_batch_b" },
      ]);
      yield* ctx.captureLocalEvent({ name: "product.product-category.created",
        metadata: { source: "product", object: "product_category", action: "created" }, data: { id: ids } });
      return null;
    }));
    const host = await localHost([forgedBatch]);
    for (const ids of [["pcat_batch_a", "pcat_batch_a"], ["pcat_batch_a", "pcat_unwritten"], ["pcat_batch_a"]]) {
      expect(await run(Effect.result(host.host.run(host.host.newRequestKey(), forgedBatch, ids))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
      expect(await commerceInventory(fixture)).toEqual(before);
    }
    expect(received).toHaveLength(eventCount + 1);
  });

  it("preserves retained option identities and rejects foreign children before normalization", async () => {
    const products = array(await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, [
      { id: "prod_owner_a", title: "Owner A", options: [{ title: "size", values: ["small", "large"] }] },
      { id: "prod_owner_b", title: "Owner B", options: [{ title: "size", values: ["small", "large"] }] },
    ])));
    const owned = object(array(object(products[0]).options)[0]);
    const foreign = object(array(object(products[1]).options)[0]);
    if (typeof owned.id !== "string" || typeof foreign.id !== "string") throw new Error("Missing option identities");
    const before = await commerceInventory(fixture);
    const events = received.length;
    for (const data of [{ options: [{ id: foreign.id, title: "size", values: ["small"] }] }, { updated_at: "2000-01-01T00:00:00.000Z" }]) {
      expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.update, { id: "prod_owner_a", data }))))
        .toMatchObject({ _tag: "Failure" });
    }
    expect(await commerceInventory(fixture)).toEqual(before);
    const updated = object(await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.update, {
      id: "prod_owner_a", data: { title: "Owner A updated", options: [{ id: owned.id, title: "size", values: ["small", "large"] }] },
    })));
    expect(array(updated.options)).toEqual([owned]);
    const after = await commerceInventory(fixture);
    expect(after.facts.length - before.facts.length).toBe(1);
    expect(received.slice(events)).toEqual([{ name: "product.product.updated", metadata: { source: "product", object: "product", action: "updated" }, data: { id: "prod_owner_a" } }]);
  });

  it("rejects parent removal with cascade dependents and malformed declared keys before publication", async () => {
    const product = object(await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, {
      id: "prod_cascade_guard", title: "Cascade guard", options: [{ title: "size", values: ["small"] }],
    })));
    const option = object(array(product.options)[0]);
    if (typeof option.id !== "string") throw new Error("Missing option");
    const remove = defineCommerceCommand("productCascadeGuardProof", "write", Effect.fn("ProductTest.cascadeGuard")(function* (ctx, input) {
      const store = yield* ctx.table(catalog.option.table.name);
      return yield* store.delete(ctx.manager, input);
    }));
    const host = await localHost([remove]);
    const before = await commerceInventory(fixture);
    const events = received.length;
    expect(await run(Effect.result(host.host.run(host.host.newRequestKey(), remove, [{ id: option.id }]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    for (const input of [[option.id], [{ id: option.id, title: "extra" }], [{ id: option.id }, { id: option.id }]]) {
      expect(await run(Effect.result(host.host.run(host.host.newRequestKey(), remove, input))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    }
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(received).toHaveLength(events);
  });

  it("authenticates assignment silence by command and preserves referenced images", async () => {
    const product = object(await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, {
      id: "prod_assignment_guard", title: "Assignment guard", images: [{ url: "assigned-image" }], variants: [{ title: "Assigned variant" }],
    })));
    const image = object(array(product.images)[0]), variant = object(array(product.variants)[0]);
    if (typeof image.id !== "string" || typeof variant.id !== "string") throw new Error("Missing assignment endpoints");
    const input = [{ variant_id: variant.id, image_id: image.id }];
    const forge = defineCommerceCommand("productAssignmentSilenceProof", "write", Effect.fn("ProductTest.assignmentSilence")(function* (ctx) {
      const store = yield* ctx.table(catalog.assignment.table.name);
      return yield* store.write(ctx.manager, "insert", [{ id: "pvpi_forged", ...input[0] }]);
    }));
    const remove = defineCommerceCommand("productAssignedImageRemovalProof", "write", Effect.fn("ProductTest.assignedRemoval")(function* (ctx) {
      const store = yield* ctx.table(catalog.image.table.name);
      return yield* store.delete(ctx.manager, [{ id: image.id }]);
    }));
    const host = await localHost([forge, remove]);
    const before = await commerceInventory(fixture);
    const events = received.length;
    expect(await run(Effect.result(host.host.run(host.host.newRequestKey(), forge, {}))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unadmittedEvent" } });
    expect(await commerceInventory(fixture)).toEqual(before);
    const assigned = array(await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.addImageToVariant, input)));
    expect(assigned).toHaveLength(1);
    expect(received).toHaveLength(events);
    const after = await commerceInventory(fixture);
    expect(after.facts.length - before.facts.length).toBe(1);
    // The actual assignment DML uses NO ACTION, so its native FK refuses the
    // removal; cascade relationships exercise the explicit core guard above.
    expect(fixture.descriptor.layout.frame.foreignKeys.find(key => key.kind === "foreignKey"
      && key.sourceTable.tableId === catalog.assignment.table.name && key.targetTable.tableId === catalog.image.table.name))
      .toMatchObject({ onDelete: "noAction" });
    expect(await run(Effect.result(host.host.run(host.host.newRequestKey(), remove, {}))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "statementFailure" } });
    expect(await commerceInventory(fixture)).toEqual(after);
  });

  it("rolls back mixed graph insert/update/removal and discards its buffered events after a late failure", async () => {
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, {
      id: "prod_mixed_rollback", title: "Mixed rollback", images: [{ url: "original-image" }],
    }));
    const fail = defineCommerceCommand("productMixedRollbackProof", "write", Effect.fn("ProductTest.mixedRollback")(function* (ctx) {
      yield* ctx.nested(runtime.commands.update, { id: "prod_mixed_rollback", data: { title: "must roll back", images: [{ url: "replacement-image" }] } });
      return yield* ctx.refuse(commerceError("invalidInput"));
    }));
    const host = await localHost([fail]);
    const before = await commerceInventory(fixture);
    const events = received.length;
    expect(await run(Effect.result(host.host.run(host.host.newRequestKey(), fail, {}))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(received).toHaveLength(events);
    expect(host.takeDeliveries()).toEqual([]);
  });
  it("authenticates complete lifecycle facts, preserves shared rows and pivots, and replays without redelivery", async () => {
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createTags, { id: "ptag_lifecycle", value: "Lifecycle shared" }));
    const product = object(await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, {
      id: "prod_lifecycle", title: "Lifecycle graph", tag_ids: ["ptag_lifecycle"],
      options: [{ title: "Size", values: ["Small", "Large"] }],
      variants: [{ title: "Small", options: { Size: "Small" } }], images: [{ url: "lifecycle-one" }, { url: "lifecycle-two" }],
    })));
    if (typeof product.id !== "string") throw new Error("Missing lifecycle Product ID");
    const before = await commerceInventory(fixture);
    const eventStart = received.length;
    const key = fixture.host.newRequestKey();
    const result = await run(fixture.host.run(key, runtime.commands.softDelete, [product.id]));
    const deleted = await commerceInventory(fixture);
    expect(deleted.facts.slice(before.facts.length)).toHaveLength(7);
    expect(deleted.facts.slice(before.facts.length).every(fact => fact.operation === "update")).toBe(true);
    expect(received.slice(eventStart)).toHaveLength(7);
    expect(received.slice(eventStart).every(event => object(object(event).metadata).action === "deleted")).toBe(true);
    expect(deleted.tables[catalog.tag.table.name]).toEqual(before.tables[catalog.tag.table.name]);
    for (const pivot of catalog.writablePivots) expect(deleted.tables[pivot.name]).toEqual(before.tables[pivot.name]);
    expect(await run(fixture.host.run(key, runtime.commands.softDelete, [product.id]))).toEqual(result);
    expect(received).toHaveLength(eventStart + 7);
    expect(array(await run(fixture.host.read(runtime.commands.list, { filters: { id: product.id } })))).toHaveLength(0);
    const visible = object(array(await run(fixture.host.read(runtime.commands.list, { filters: { id: product.id }, config: { withDeleted: true, relations: ["options.values", "variants.options", "images", "tags"] } })))[0]);
    expect(visible.deleted_at).toEqual(expect.any(String));
    expect(array(visible.options).flatMap(option => array(object(option).values)).every(value => typeof object(value).deleted_at === "string")).toBe(true);
    expect(array(visible.tags)).toMatchObject([{ id: "ptag_lifecycle", deleted_at: null }]);
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.softDelete, [product.id]));
    expect((await commerceInventory(fixture)).facts).toEqual(deleted.facts);
    expect(received).toHaveLength(eventStart + 7);
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.restore, [product.id]));
    expect(received.slice(eventStart + 7)).toHaveLength(7);
    expect(received.slice(eventStart + 7).every(event => object(object(event).metadata).action === "restored")).toBe(true);
    const restored = object(await run(fixture.host.read(runtime.commands.retrieve, { id: product.id, config: { relations: ["options.values", "variants.options", "images"] } })));
    expect(restored.deleted_at).toBeNull();
    expect(array(restored.images).map(image => object(image).id)).toEqual(array(product.images).map(image => object(image).id));
    // The pinned restore selection includes active roots and dispatches restored
    // events again; this is authenticated operation behavior, not a no-op claim.
    const activeStart = received.length;
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.restore, [product.id]));
    expect(received.slice(activeStart)).toHaveLength(7);
    expect(received.slice(activeStart).every(event => object(object(event).metadata).action === "restored")).toBe(true);
  });

  it("rolls back the complete restore on an active uniqueness conflict and rejects foreign or arbitrary lifecycle authority", async () => {
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, { id: "prod_restore_conflict", title: "Restore conflict", images: [{ url: "conflict-image" }] }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.softDelete, ["prod_restore_conflict"]));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, { id: "prod_restore_active", title: "Restore conflict" }));
    const before = await commerceInventory(fixture);
    const events = received.length;
    expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.restore, ["prod_restore_conflict"])))).toMatchObject({ _tag: "Failure" });
    expect(await commerceInventory(fixture)).toEqual(before);
    const raw = defineCommerceCommand("productLifecycleAuthorityProof", "write", Effect.fn("ProductTest.lifecycleAuthority")(function* (ctx, input) {
      const value = object(input);
      const store = yield* ctx.table(typeof value.table === "string" ? value.table : catalog.product.table.name);
      return yield* store.lifecycle(ctx.manager, "softDelete", value.keys);
    }));
    const local = await localHost([raw]);
    for (const input of [
      { keys: [{ id: "prod_restore_active", deleted_at: null }] },
      { keys: [{ id: "prod_restore_active" }, { id: "prod_restore_active" }] },
      { keys: [{ id: "prod_restore_active" }, { id: "prod_missing_lifecycle" }] },
      { table: catalog.tag.table.name, keys: [{ id: "ptag_other_scope" }] },
      // Even real core lifecycle writes cannot masquerade as an ordinary event
      // command. The final policy binds observations to the selected root command.
      { keys: [{ id: "prod_restore_active" }] },
    ]) {
      expect(await run(Effect.result(local.host.run(local.host.newRequestKey(), raw, input)))).toMatchObject({ _tag: "Failure" });
      expect(await commerceInventory(fixture)).toEqual(before);
    }
    expect(received).toHaveLength(events);
  });

  it("rolls back a pending lifecycle cascade on cancellation and a late failure", async () => {
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, { id: "prod_lifecycle_rollback", title: "Lifecycle rollback", images: [{ url: "rollback-image" }] }));
    const reached = await run(Deferred.make<void>());
    const command = defineCommerceCommand("productLifecycleRollbackProof", "write", Effect.fn("ProductTest.lifecycleRollback")(function* (ctx, wait) {
      yield* ctx.nested(runtime.commands.softDelete, ["prod_lifecycle_rollback"]);
      if (wait === false) return yield* ctx.refuse(commerceError("invalidInput"));
      yield* Deferred.succeed(reached, undefined);
      return yield* Effect.never;
    }));
    const local = await localHost([command]);
    const before = await commerceInventory(fixture);
    const events = received.length;
    expect(await run(Effect.result(local.host.run(local.host.newRequestKey(), command, false)))).toMatchObject({ _tag: "Failure" });
    const controller = new AbortController();
    const pending = Effect.runPromiseExit(local.host.run(local.host.newRequestKey(), command, true), { signal: controller.signal });
    try {
      await Promise.race([run(Deferred.await(reached)), pending.then(exit => { throw new Error("Lifecycle settled before cancellation: " + exit._tag); })]);
      controller.abort(); expect(Exit.isFailure(await pending)).toBe(true);
    } finally { controller.abort(); await pending; }
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(received).toHaveLength(events);
  });

  it("physically removes all owned entity and pivot rows while emitting only the original root event", async () => {
    const product = object(await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, {
      id: "prod_lifecycle_delete", title: "Lifecycle physical delete", tag_ids: ["ptag_lifecycle"],
      options: [{ title: "Size", values: ["Small"] }], variants: [{ title: "Small", options: { Size: "Small" } }], images: [{ url: "delete-image" }],
    })));
    if (typeof product.id !== "string") throw new Error("Missing deleted Product ID");
    const before = await commerceInventory(fixture);
    const events = received.length;
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.delete, [product.id]));
    const after = await commerceInventory(fixture);
    expect(after.facts.slice(before.facts.length)).toHaveLength(7);
    expect(after.facts.slice(before.facts.length).every(fact => fact.operation === "delete")).toBe(true);
    expect(received.slice(events)).toMatchObject([{ metadata: { object: "product", action: "deleted" }, data: { id: product.id } }]);
    expect(after.tables[catalog.tag.table.name]).toEqual(before.tables[catalog.tag.table.name]);
    expect(array(await run(fixture.host.read(runtime.commands.list, { filters: { id: product.id }, config: { withDeleted: true } })))).toHaveLength(0);
  });
  it("detaches referenced types and collections with complete Product facts and root-only events", async () => {
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createTypes, { id: "ptyp_detach", value: "Detach type" }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCollections, { id: "pcol_detach", title: "Detach collection" }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, {
      id: "prod_detach", title: "Detached references", type_id: "ptyp_detach", collection_id: "pcol_detach",
    }));
    for (const [command, id, column] of [
      [runtime.commands.deleteTypes, "ptyp_detach", "type_id"],
      [runtime.commands.deleteCollections, "pcol_detach", "collection_id"],
    ] as const) {
      const before = await commerceInventory(fixture); const events = received.length;
      await run(fixture.host.run(fixture.host.newRequestKey(), command, [id]));
      const after = await commerceInventory(fixture);
      expect(after.tables[catalog.product.table.name]?.find(row => row.id === "prod_detach")).toMatchObject({ [column]: null, deleted_at: null });
      expect(after.facts.slice(before.facts.length).map(row => row.operation).sort()).toEqual(["delete", "update"]);
      expect(received.slice(events)).toMatchObject([{ metadata: { action: "deleted" }, data: { id } }]);
      expect(received.slice(events)).toHaveLength(1);
    }
  });
  it("reranks remaining category roots and retains explicit assignment FK refusal during physical deletion", async () => {
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCategories, [{ id: "pcat_delete_first", name: "Delete first" }, { id: "pcat_delete_second", name: "Delete second" }]));
    const beforeCategory = await commerceInventory(fixture);
    const second = beforeCategory.tables[catalog.category.table.name]?.find(row => row.id === "pcat_delete_second");
    if (typeof second?.rank !== "number") throw new Error("Missing category rank");
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.deleteCategories, ["pcat_delete_first"]));
    const afterCategory = await commerceInventory(fixture);
    expect(afterCategory.tables[catalog.category.table.name]?.find(row => row.id === "pcat_delete_second")).toMatchObject({ rank: second.rank - 1 });
    expect(afterCategory.facts.slice(beforeCategory.facts.length).map(row => row.operation).sort()).toEqual(["delete", "update"]);
    const product = object(await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, {
      id: "prod_assignment_lifecycle", title: "Assigned lifecycle", options: [{ title: "Size", values: ["One"] }],
      variants: [{ title: "One", options: { Size: "One" } }], images: [{ url: "assigned-lifecycle" }],
    })));
    const variant = object(array(product.variants)[0]); const image = object(array(product.images)[0]);
    if (typeof product.id !== "string" || typeof variant.id !== "string" || typeof image.id !== "string") throw new Error("Missing assigned Product IDs");
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.addImageToVariant, [{ variant_id: variant.id, image_id: image.id }]));
    const before = await commerceInventory(fixture); const events = received.length;
    expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.delete, [product.id])))).toMatchObject({ _tag: "Failure" });
    expect(await commerceInventory(fixture)).toEqual(before); expect(received).toHaveLength(events);
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.softDelete, [product.id]));
    const hidden = await commerceInventory(fixture);
    expect(hidden.tables[catalog.assignment.table.name]).toEqual(before.tables[catalog.assignment.table.name]);
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.restore, [product.id]));
    expect((await commerceInventory(fixture)).tables[catalog.assignment.table.name]).toEqual(before.tables[catalog.assignment.table.name]);
  });
});
