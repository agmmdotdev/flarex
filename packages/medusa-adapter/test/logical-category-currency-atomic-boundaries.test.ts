import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { currencyCommands } from "../src/currency-service";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productLogicalCallEventPolicy, productLogicalCreateEventPolicy, productLogicalTypeEventPolicy } from "../src/product-local-events";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant, getAtomicCommerceCommand,
  type AtomicCommerceContext } from "../../persistence-postgres/src/atomicCommerce/commands";
import { makeAtomicCommerceHost, type AtomicCommerceHostInput } from
  "../../persistence-postgres/src/atomicCommerce/host";
import { defineCommerceCommand, type CommerceCommandContext } from
  "../../persistence-postgres/src/commerceTransaction/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/atomicCommerce/events";
import { commerceError, type CommerceTransactionError } from
  "../../persistence-postgres/src/commerceTransaction/model";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";
import { logicalCategoryCurrencyFixture, logicalCategoryCurrencyInventory } from "./support/logical-category-currency-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? process.env.MEDUSA_COMPARISON_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Medusa comparison driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: Awaited<ReturnType<typeof logicalCategoryCurrencyFixture>>;
const required = <Value>(value: Value | undefined): Value => {
  if (value === undefined) throw new Error("Missing mixed command definition");
  return value;
};
const args = (prefix: string) => ({ categoryPrefix: prefix, currency: {
  code: "zzz", name: prefix, symbol: "T", symbol_native: "T", decimal_digits: 2, rounding: 0,
} });
const inventory = () => logicalCategoryCurrencyInventory(fixture);
const selected = async (input: AtomicCommerceHostInput<unknown>) => {
  const host = await runEffect(makeAtomicCommerceHost(input));
  cleanup.push(() => runEffect(host.close));
  return host;
};
const withCommand = (name: string,
  run: (context: AtomicCommerceContext, value: Json) => Effect.Effect<Json, CommerceTransactionError>) => {
  const command = defineAtomicCommerceCommand(name, run);
  return { command, host: () => selected({ ...fixture.input, commands: [command] }) };
};

describe("mixed Category/Currency atomic boundaries on logical Currency", () => {
  beforeAll(async () => { fixture = await logicalCategoryCurrencyFixture(driver, close => cleanup.push(close)); }, 150_000);
  afterAll(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
    if (failures.length > 0) throw new AggregateError(failures, "Mixed atomic boundary cleanup failed");
  }, 120_000);

  it("orders equal Category ranks by identity before applying the page window", async () => {
    const { proof } = fixture;
    const test = withCommand("mixedGraphPage", Effect.fn("MixedAtomic.graphPage")(function* (ctx) {
      yield* ctx.call(proof.productParticipant, required(proof.productCommands[0]), [
        { id: "graph-page-parent-z", name: "Parent Z", handle: "graph-page-parent-z" },
        { id: "graph-page-parent-a", name: "Parent A", handle: "graph-page-parent-a" },
        { id: "graph-page-z", name: "Child Z", handle: "graph-page-z", parent_category_id: "graph-page-parent-z" },
        { id: "graph-page-a", name: "Child A", handle: "graph-page-a", parent_category_id: "graph-page-parent-a" },
      ]);
      const graph = proof.graph.bind(ctx);
      const request = { entity: "product_category", fields: ["id", "rank"], filters: { id: ["graph-page-z", "graph-page-a"] } };
      const ordered = yield* graph.graph({ ...request, pagination: { take: 2, order: { rank: "ASC" } } });
      const page = yield* graph.graph({ ...request, pagination: { skip: 1, take: 1, order: { rank: "ASC" } } });
      return { ordered, page };
    }));
    const host = await test.host();
    expect(await runEffect(host.run(host.newRequestKey(), test.command, null))).toEqual({
      ordered: { data: [{ id: "graph-page-a", rank: 0 }, { id: "graph-page-z", rank: 0 }], metadata: { count: 2, skip: 0, take: 2 } },
      page: { data: [{ id: "graph-page-z", rank: 0 }], metadata: { count: 2, skip: 1, take: 1 } },
    });
  }, 120_000);

  it("reads populated Product module roots and nested projections through actual services", async () => {
    const { currency, product, proof, input } = fixture;
    const catalog = await runEffect(captureProductSchema("atomic-commerce")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const fixtures = [
      { command: product.runtime.commands.createTags, value: { id: "graph-tag", value: "Graph tag" },
        policy: productLogicalCallEventPolicy(catalog), entities: [catalog.tag] },
      { command: product.runtime.commands.createTypes, value: { id: "graph-type", value: "Graph type" },
        policy: productLogicalTypeEventPolicy(catalog, "create"), entities: [catalog.type] },
      { command: product.runtime.commands.createCollections,
        value: { id: "graph-collection", title: "Graph collection", handle: "graph-collection" },
        policy: productLogicalCallEventPolicy(catalog), entities: [catalog.collection] },
      { command: product.runtime.commands.create,
        value: { title: "Graph shirt", handle: "graph-shirt", type_id: "graph-type", collection_id: "graph-collection",
          tags: [{ id: "graph-tag" }], images: [{ url: "graph.png" }], options: [{ title: "Size", values: ["S"] }],
          variants: [{ title: "Graph small", options: { Size: "S" } }] },
        policy: productLogicalCreateEventPolicy(catalog),
        entities: [catalog.product, catalog.image, catalog.option, catalog.value, catalog.variant] },
    ];
    for (const [index, fixtureRow] of fixtures.entries()) {
      const revision = createHash("sha256").update(`logical-mixed-graph-${index}`).digest("hex");
      const named = fixtureRow.entities.map(entity => ({ name: entity.createdEvent,
        contract: defineCommerceEventContract({ name: entity.createdEvent, revision, internal: true,
          decode: fixtureRow.policy.capture }) }));
      const contracts = named.map(entry => entry.contract);
      const root = defineAtomicCommerceCommand(`mixedGraphSetup${index}`, (ctx, value) =>
        ctx.call(proof.productParticipant, fixtureRow.command, value));
      const setup = await selected({ ...currency.hostInput, commands: [root],
        participants: [{ participant: proof.productParticipant, logicalStorage: product.hostInput.logicalStorage,
          commands: [fixtureRow.command], ...("validateLogicalCall" in fixtureRow.policy ? { validateLogicalCall: fixtureRow.policy.validateLogicalCall }
            : { validateLogical: fixtureRow.policy.validateLogical }),
          events: { contracts, select: event => {
            const contract = isJsonObject(event) && typeof event.name === "string"
              ? named.find(entry => entry.name === event.name)?.contract : undefined;
            return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract);
          } } }],
        events: { producerRevision: revision, contracts,
          subscribers: [{ id: `mixed-graph-${index}`, revision: "a".repeat(64) }],
          validate: events => events.some(event => !event.internal)
            ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
      });
      await runEffect(setup.run(setup.newRequestKey(), root, fixtureRow.value));
    }
    const graph = defineAtomicCommerceCommand("mixedGraphRead", (ctx, value) => proof.graph.bind(ctx).graph(value));
    const host = await selected({ ...input, commands: [graph] });
    const before = await inventory();
    const cases = [
      { entity: "product", fields: ["title", "options.values.value", "variants.title", "tags.value", "type.value", "collection.title", "images.url"],
        filters: { handle: "graph-shirt" }, expected: { title: "Graph shirt", options: [{ values: [{ value: "S" }] }], variants: [{ title: "Graph small" }],
          tags: [{ value: "Graph tag" }], type: { value: "Graph type" }, collection: { title: "Graph collection" }, images: [{ url: "graph.png" }] } },
      { entity: "product_type", fields: ["value"], filters: { id: "graph-type" }, expected: { value: "Graph type" } },
      { entity: "product_tag", fields: ["value", "products.title"], filters: { id: "graph-tag" }, expected: { value: "Graph tag", products: [{ title: "Graph shirt" }] } },
      { entity: "product_collection", fields: ["title", "products.title"], filters: { id: "graph-collection" }, expected: { title: "Graph collection", products: [{ title: "Graph shirt" }] } },
      { entity: "product_option", fields: ["title", "values.value", "product.title"], filters: { title: "Size" }, expected: { title: "Size", values: [{ value: "S" }], product: { title: "Graph shirt" } } },
      { entity: "variant", fields: ["title", "options.value", "product.images.url"], filters: { title: "Graph small" }, expected: { title: "Graph small", options: [{ value: "S" }], product: { images: [{ url: "graph.png" }] } } },
    ];
    for (const { entity, fields, filters, expected } of cases) {
      const result = await runEffect(host.run(host.newRequestKey(), graph, { entity, fields, filters, pagination: { take: 2 } }));
      expect(result).toEqual({ data: [expected], metadata: { count: 1, skip: 0, take: 2 } });
      const wildcard = await runEffect(host.run(host.newRequestKey(), graph, { entity, fields: ["*"], filters, pagination: { take: 2 } }));
      expect(wildcard).toMatchObject({ data: [expect.any(Object)], metadata: { count: 1, skip: 0, take: 2 } });
      if (!isJsonObject(wildcard) || !Array.isArray(wildcard.data) || !isJsonObject(wildcard.data[0])) throw new Error("Expected graph rows");
      expect(Object.keys(wildcard.data[0]).length).toBeGreaterThan(1);
      expect(wildcard.data[0]).not.toHaveProperty("products");
    }
    expect(await runEffect(host.run(host.newRequestKey(), graph, {
      entity: "product", fields: ["title"], filters: { handle: "graph-shirt" }, pagination: { take: 0 },
    }))).toEqual({ data: [], metadata: { count: 1, skip: 0, take: 0 } });
    const after = await inventory();
    expect(after.logical.physicalFacts).toEqual(before.logical.physicalFacts);
    expect(after.logical.rowChanges).toEqual(before.logical.rowChanges);
    expect(after.logical.commits.slice(before.logical.commits.length).every(commit => commit.relationalChangeCount === 0)).toBe(true);
  }, 120_000);

  it("authenticates participant definitions and cross-source table access", async () => {
    const { currency, proof, input } = fixture;
    const before = await inventory();
    const currencyRead = required(proof.currencyCommands[1]);
    const alien = defineAtomicCommerceParticipant("currency");
    const foreign = withCommand("mixedForeignParticipant", ctx => ctx.call(alien, currencyRead, { code: "usd" }));
    const foreignHost = await foreign.host();
    expect(await runEffectFailure(foreignHost.run(foreignHost.newRequestKey(), foreign.command, null)))
      .toMatchObject({ reason: "invalidAuthority" });
    const first = required(input.participants[0]);
    expect(await runEffectFailure(makeAtomicCommerceHost({ ...input, participants: [first, first] })))
      .toMatchObject({ reason: "invalidAuthority" });
    const physicalTables = (await currency.persistence.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows;
    expect(physicalTables).toEqual(currency.physicalTablesBeforeCandidate);
    const probe = defineCommerceCommand("mixedForeignTable", "read", ctx => ctx.table("product_category").pipe(Effect.as(null)));
    const table = withCommand("mixedWrongMemberTable", ctx => ctx.call(proof.currencyParticipant, probe, null));
    const tableHost = await selected({ ...input, commands: [table.command],
      participants: input.participants.map(member => member.participant === proof.currencyParticipant
        ? { ...member, commands: [...member.commands, probe] } : member) });
    expect(await runEffectFailure(tableHost.run(tableHost.newRequestKey(), table.command, null)))
      .toMatchObject({ reason: "invalidAuthority" });
    expect(await inventory()).toEqual(before);
  }, 120_000);

  it("shares aggregate call and byte budgets and revokes borrowed contexts", async () => {
    const { proof, input } = fixture;
    const before = await inventory();
    let capturedContext: CommerceCommandContext | undefined;
    const probe = defineCommerceCommand("mixedCaptureContext", "read", ctx =>
      Effect.sync(() => { capturedContext = ctx; return null; }));
    const command = defineAtomicCommerceCommand("mixedSharedBudget", Effect.fn("MixedAtomic.sharedBudget")(function* (ctx, value) {
      if (value === "bytes") {
        for (let index = 0; index < 12; index++) yield* ctx.call(index % 2 ? proof.productParticipant : proof.currencyParticipant, probe, "x".repeat(100_000));
      } else {
        for (let index = 0; index < 65; index++) yield* ctx.call(index % 2 ? proof.productParticipant : proof.currencyParticipant, probe, null);
      }
      return null;
    }));
    const host = await selected({ ...input, commands: [command],
      participants: input.participants.map(member => ({ ...member, commands: [...member.commands, probe] })) });
    for (const value of ["calls", "bytes"]) {
      expect(await runEffectFailure(host.run(host.newRequestKey(), command, value))).toMatchObject({ reason: "limitExceeded" });
      if (capturedContext === undefined) throw new Error("Probe never borrowed a context");
      expect(await runEffectFailure(capturedContext.store.count(capturedContext.manager,
        { order: { column: "code", direction: "asc" } }))).toMatchObject({ reason: "invalidAuthority" });
    }
    expect(await inventory()).toEqual(before);
  }, 120_000);

  it("captures an explicit root call limit and charges both logical participants", async () => {
    const { input } = fixture;
    const probe = defineAtomicCommerceCommand("mixedCallLimit", Effect.fn("MixedAtomic.callLimit")(function* (ctx, value) {
      const count = value === "overflow" ? 64 : 4;
      for (let index = 0; index < count; index++) yield* ctx.checkpoint;
      return null;
    }));
    const defaultHost = await selected({ ...input, commands: [probe] });
    const key = defaultHost.newRequestKey();
    expect(await runEffect(defaultHost.run(key, probe, null))).toBeNull();
    const exact = await selected({ ...input, commands: [probe], requestCallLimit: 64 });
    expect(await runEffectFailure(exact.run(key, probe, null))).toMatchObject({ reason: "requestConflict" });
    // Both logical participants must be opened before the root can settle.
    const selectedInput = { ...input, commands: [probe], requestCallLimit: 7 };
    const selectedHost = await selected(selectedInput);
    selectedInput.requestCallLimit = 1;
    expect(await runEffect(selectedHost.run(selectedHost.newRequestKey(), probe, null))).toBeNull();
    const smaller = await selected({ ...input, commands: [probe], requestCallLimit: 6 });
    const larger = await selected({ ...input, commands: [probe], requestCallLimit: 4096 });
    const shaped = await selected({ ...input, commands: [probe],
      identityAndAccessPolicy: { policy: input.identityAndAccessPolicy, requestCallLimit: 4 } });
    const shapedKey = shaped.newRequestKey();
    expect(await runEffect(shaped.run(shapedKey, probe, null))).toBeNull();
    const before = await inventory();
    expect(await runEffectFailure(smaller.run(shapedKey, probe, null))).toMatchObject({ reason: "requestConflict" });
    expect(await runEffectFailure(smaller.run(smaller.newRequestKey(), probe, null))).toMatchObject({ reason: "limitExceeded" });
    expect(await runEffectFailure(defaultHost.run(defaultHost.newRequestKey(), probe, "overflow")))
      .toMatchObject({ reason: "limitExceeded" });
    expect(await runEffect(larger.run(larger.newRequestKey(), probe, "overflow"))).toBeNull();
    const afterSuccessful = await inventory();
    expect(afterSuccessful.logical.commits).toHaveLength(before.logical.commits.length + 1);
    expect(afterSuccessful.logical.rowChanges).toEqual(before.logical.rowChanges);
    expect(afterSuccessful.categories).toEqual(before.categories);
    for (const requestCallLimit of [null, "256", 0, -1, 1.5, NaN, Infinity, 4097]) {
      // @ts-expect-error malformed trusted configuration still requires runtime validation
      expect(await runEffectFailure(makeAtomicCommerceHost({ ...input, commands: [probe], requestCallLimit })))
        .toMatchObject({ reason: "unsupportedProfile" });
    }
    expect(await inventory()).toEqual(afterSuccessful);
  }, 120_000);

  it("refuses overlapping calls and cancels after Product and Currency both write", async () => {
    const { proof, input } = fixture;
    const before = await inventory();
    const reached = await runEffect(Deferred.make<void>());
    const probe = defineCommerceCommand("mixedPendingRead", "read", () =>
      Deferred.succeed(reached, undefined).pipe(Effect.andThen(Effect.never)));
    const parallel = defineAtomicCommerceCommand("mixedOverlap", Effect.fn("MixedAtomic.overlap")(function* (ctx) {
      return yield* Effect.scoped(Effect.gen(function* () {
        yield* Effect.forkScoped(ctx.call(proof.currencyParticipant, probe, null));
        yield* Deferred.await(reached);
        return yield* ctx.call(proof.productParticipant, required(proof.productCommands[1]), { id: "missing" });
      }));
    }));
    const concurrent = await selected({ ...input, commands: [parallel],
      participants: input.participants.map(member => ({ ...member, commands: [...member.commands, probe] })) });
    expect(await runEffectFailure(concurrent.run(concurrent.newRequestKey(), parallel, null)))
      .toMatchObject({ reason: "overlappingOperation" });
    const written = await runEffect(Deferred.make<void>());
    const original = getAtomicCommerceCommand(proof.command);
    if (original === undefined) throw new Error("Missing Category/Currency command");
    const waiting = withCommand("mixedCancelAfterWrites", Effect.fn("MixedAtomic.cancelAfterWrites")(function* (ctx, value) {
      yield* original.run(ctx, value);
      yield* Deferred.succeed(written, undefined);
      return yield* Effect.never;
    }));
    const cancel = await waiting.host();
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const fiber = yield* Effect.forkScoped(cancel.run(cancel.newRequestKey(), waiting.command, args("cancel")));
      yield* Deferred.await(written).pipe(Effect.timeout(5_000));
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons.length).toBeGreaterThan(0);
        expect(exit.cause.reasons.every(Cause.isInterruptReason)).toBe(true);
      }
    })));
    expect(await inventory()).toEqual(before);
  }, 120_000);
});
