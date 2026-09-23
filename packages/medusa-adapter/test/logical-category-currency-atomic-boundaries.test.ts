import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import type { Json } from "flarex-protocol/json";
import { isJsonObject } from "flarex-protocol/json";
import { currencyCommands } from "../src/currency-service";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productLocalEventPolicy } from "../src/product-local-events";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant, getAtomicCommerceCommand,
  type AtomicCommerceContext } from "../../persistence-postgres/src/atomicCommerce/commands";
import { makeAtomicCommerceHost, type AtomicCommerceHostInput } from
  "../../persistence-postgres/src/atomicCommerce/host";
import { defineCommerceCommand, type CommerceCommandContext } from
  "../../persistence-postgres/src/commerceTransaction/commands";
import { makeLocalCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { commerceError, type CommerceTransactionError } from
  "../../persistence-postgres/src/commerceTransaction/model";
import { commercePhysicalRows } from "../../persistence-postgres/test/commerceInventory";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";
import { commerceBindings } from "../../persistence-postgres/src/frameworkSchema/binding/model";
import { makeDataBindingHost } from "../../persistence-postgres/src/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../persistence-postgres/src/frameworkSchema/binding/selection";
import { captureBindingValue, isDataBindingSetFrame } from
  "../../persistence-postgres/src/frameworkSchema/binding/canonical";
import { logicalCategoryCurrencyFixture } from "./support/logical-category-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";

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
const inventory = async () => ({ logical: await logicalCurrencyInventory(fixture.currency),
  product: await commercePhysicalRows(fixture.currency.persistence, fixture.product.descriptor.layout.frame) });
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
    const fixtures: Array<readonly [typeof proof.graphFixtures.create, Json]> = [
      [proof.graphFixtures.tags, { id: "graph-tag", value: "Graph tag" }],
      [proof.graphFixtures.types, { id: "graph-type", value: "Graph type" }],
      [proof.graphFixtures.collections, { id: "graph-collection", title: "Graph collection", handle: "graph-collection" }],
      [proof.graphFixtures.create, { title: "Graph shirt", handle: "graph-shirt", type_id: "graph-type", collection_id: "graph-collection",
        tags: [{ id: "graph-tag" }], images: [{ url: "graph.png" }], options: [{ title: "Size", values: ["S"] }],
        variants: [{ title: "Graph small", options: { Size: "S" } }] }],
    ];
    const catalog = await runEffect(captureProductSchema("atomic-commerce")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const base = currency.hostInput;
    const setup = await runEffect(makeLocalCommerceHost({ hostRuntime: base.hostRuntime,
      database: base.database, session: currency.session, target: base.target, deploymentId: currency.deploymentId,
      authority: base.authority, application: base.application, identityAndAccessPolicy: base.identityAndAccessPolicy,
      commands: fixtures.map(([command]) => command), profile: product.profile, installation: fixture.installation,
    }, productLocalEventPolicy(product.descriptor, catalog, () => Effect.void)));
    cleanup.push(() => runEffect(setup.host.close));
    await runEffect(Effect.gen(function* () {
      for (const [command, value] of fixtures) yield* setup.host.run(setup.host.newRequestKey(), command, value);
    }));
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

  it("authenticates participant definitions, binding coverage and cross-member tables", async () => {
    const { currency, product, proof, input, bindings } = fixture;
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
    const missingPolicy = input.participants.map(member => {
      const { validate: _validate, ...withoutPolicy } = member;
      return member.participant === proof.productParticipant ? withoutPolicy : member;
    });
    expect(await runEffectFailure(makeAtomicCommerceHost({ ...input, participants: missingPolicy })))
      .toMatchObject({ reason: "unsupportedProfile" });
    const current = await runEffect(bindings.withCurrent(readAdmittedDataBinding));
    const commerce = commerceBindings(current.frame);
    expect(commerce).toHaveLength(1);
    expect(await runEffectFailure(captureBindingValue({ ...current.frame, commerce: [commerce[0], commerce[0]] }, isDataBindingSetFrame)))
      .toMatchObject({ reason: "invalidInput" });
    const incomplete = await runEffect(makeDataBindingHost({ database: currency.persistence.drizzle,
      target: currency.bindingTarget, deploymentId: currency.deploymentId, authority: currency.hostInput.authority,
      application: currency.hostInput.application, commerceProfiles: [], logicalStorage: {
        controlDb: currency.control.drizzle, schemaVersionId: currency.schemaVersionId,
        unique: currency.hostInput.logicalStorage.unique,
      } }));
    expect(await runEffectFailure(incomplete.prepare(current.frame))).toMatchObject({ reason: "unsupportedProfile" });
    const foreignTable = required(product.descriptor.tables[0]).tableId;
    const probe = defineCommerceCommand("mixedForeignTable", "read", ctx => ctx.table(foreignTable).pipe(Effect.as(null)));
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

  it("captures an explicit root call limit and intersects participant ceilings", async () => {
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
    // Opening an admitted but unused logical participant is one bounded
    // request operation in addition to the root and four checkpoints.
    const selectedInput = { ...input, commands: [probe], requestCallLimit: 6 };
    const selectedHost = await selected(selectedInput);
    selectedInput.requestCallLimit = 1;
    expect(await runEffect(selectedHost.run(selectedHost.newRequestKey(), probe, null))).toBeNull();
    const smaller = await selected({ ...input, commands: [probe], requestCallLimit: 5 });
    const larger = await selected({ ...input, commands: [probe], requestCallLimit: 4096 });
    const shaped = await selected({ ...input, commands: [probe],
      identityAndAccessPolicy: { policy: input.identityAndAccessPolicy, requestCallLimit: 4 } });
    const shapedKey = shaped.newRequestKey();
    expect(await runEffect(shaped.run(shapedKey, probe, null))).toBeNull();
    const before = await inventory();
    expect(await runEffectFailure(smaller.run(shapedKey, probe, null))).toMatchObject({ reason: "requestConflict" });
    expect(await runEffectFailure(smaller.run(smaller.newRequestKey(), probe, null))).toMatchObject({ reason: "limitExceeded" });
    for (const host of [defaultHost, larger])
      expect(await runEffectFailure(host.run(host.newRequestKey(), probe, "overflow"))).toMatchObject({ reason: "limitExceeded" });
    for (const requestCallLimit of [null, "256", 0, -1, 1.5, NaN, Infinity, 4097]) {
      // @ts-expect-error malformed trusted configuration still requires runtime validation
      expect(await runEffectFailure(makeAtomicCommerceHost({ ...input, commands: [probe], requestCallLimit })))
        .toMatchObject({ reason: "unsupportedProfile" });
    }
    expect(await inventory()).toEqual(before);
  }, 120_000);

  it("retains the physical statement budget beside bounded logical Currency work", async () => {
    const { input, proof } = fixture;
    const before = await inventory();
    const completed = { currency: 0, product: 0 };
    const probe = (name: "currency" | "product", table: string, column: string, iterations: number) =>
      defineCommerceCommand(`mixed${name}StatementProbe`, "read", Effect.fn("MixedAtomic.statementProbe")(function* (ctx) {
        const store = yield* ctx.table(table);
        for (let index = 0; index < iterations; index++) {
          expect(yield* store.find(ctx.manager, { take: 0, order: { column, direction: "asc" } })).toEqual([]);
          completed[name]++;
        }
        return null;
      }));
    const currencyProbe = probe("currency", "currency", "code", 1);
    const productProbe = probe("product", "product_category", "id", 33);
    const command = defineAtomicCommerceCommand("mixedStatementBudget", Effect.fn("MixedAtomic.statementBudget")(function* (ctx) {
      yield* ctx.call(proof.productParticipant, required(proof.productCommands[0]),
        [{ id: "statement-budget-parent", name: "Statement budget", handle: "statement-budget-parent" }]);
      yield* ctx.call(proof.currencyParticipant, required(proof.currencyCommands[0]), args("statement-budget").currency);
      yield* ctx.call(proof.currencyParticipant, currencyProbe, null);
      yield* Effect.result(ctx.call(proof.productParticipant, productProbe, null));
      return null;
    }));
    const host = await selected({ ...input, commands: [command], participants: input.participants.map(member => ({
      ...member, commands: [...member.commands, member.participant === proof.currencyParticipant ? currencyProbe : productProbe],
    })) });
    const exit = await runEffect(Effect.exit(host.run(host.newRequestKey(), command, null)));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error))
      .toContainEqual(expect.objectContaining({ reason: "limitExceeded", cause: expect.objectContaining({ boundary: "statements", attempted: 65 }) }));
    expect(completed.currency).toBeGreaterThan(0);
    expect(completed.product).toBeGreaterThan(0);
    expect(completed.currency + completed.product).toBeLessThan(64);
    expect(await inventory()).toEqual(before);
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
