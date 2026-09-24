import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { productLogicalCreateEventPolicy, productLogicalOptionEventPolicy } from "../src/product-local-events";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/atomicCommerce/events";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxAppRowCurrent, fxAppRowRevisions } from "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product Option test driver");
const cleanup: Array<() => Promise<void>> = [];
const hosts: Array<() => Promise<void>> = [];

describe("native Product Option on shared logical Product storage", () => {
  let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
  let product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
  let catalog: Effect.Success<ReturnType<typeof productRuntimeMetadata>>;
  beforeAll(async () => {
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeProduct: true });
    product = await prepareLogicalProductHost(fixture);
    await Effect.runPromise(product.host.initialize([]));
    catalog = await Effect.runPromise(captureProductSchema("atomic-commerce")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
  }, 180_000);
  afterAll(async () => {
    for (const close of hosts.reverse()) await close();
    if (product !== undefined) await Effect.runPromise(product.host.close);
    for (const close of cleanup.reverse()) await close();
  }, 120_000);

  async function optionCommand(operation: "create" | "update" | "upsert" | "delete",
    selectedFixture = fixture, selectedProduct = product, failAfterValidation = false) {
    const command = operation === "create" ? selectedProduct.runtime.commands.createOptions
      : operation === "update" ? selectedProduct.runtime.commands.updateOptions
      : operation === "upsert" ? selectedProduct.runtime.commands.upsertOptions
      : selectedProduct.runtime.commands.deleteOptions;
    const policy = productLogicalOptionEventPolicy(catalog, operation);
    const profile = `logical-product-option-${operation}${failAfterValidation ? "-late-failure" : ""}`;
    const revision = createHash("sha256").update(profile).digest("hex");
    const contracts = [catalog.option, catalog.value].flatMap(entity => [entity.createdEvent, entity.updatedEvent, entity.deletedEvent])
      .map(name => ({ name, token: defineCommerceEventContract({ name, revision, internal: true, decode: policy.capture }) }));
    const tokens = contracts.map(entry => entry.token);
    const participant = defineAtomicCommerceParticipant("product");
    const root = defineAtomicCommerceCommand(`productOption${operation}`, (ctx, input) => ctx.call(participant, command, input));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...selectedFixture.hostInput,
      identityAndAccessPolicy: { profile },
      participants: [{ participant, logicalStorage: selectedProduct.hostInput.logicalStorage,
        commands: [command], validateLogical: failAfterValidation
          ? (...args: Parameters<typeof policy.validateLogical>) => policy.validateLogical(...args)
            .pipe(Effect.flatMap(() => Effect.fail(commerceError("receiptMismatch")))) : policy.validateLogical,
        events: { contracts: tokens, select: event => {
          const token = isJsonObject(event) && typeof event.name === "string"
            ? contracts.find(entry => entry.name === event.name)?.token : undefined;
          return token === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(token);
        } } }],
      commands: [root], events: { producerRevision: revision, contracts: tokens,
        subscribers: [{ id: profile, revision: "a".repeat(64) }],
        validate: events => events.some(event => !event.internal)
          ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    }));
    hosts.push(() => Effect.runPromise(host.close));
    return { host, root };
  }

  async function productCreation(selectedFixture = fixture, selectedProduct = product) {
    const command = selectedProduct.runtime.commands.create;
    const policy = productLogicalCreateEventPolicy(catalog);
    const revision = createHash("sha256").update("logical-option-product-create").digest("hex");
    const contracts = [catalog.product, catalog.option, catalog.value, catalog.variant, catalog.image]
      .map(entity => ({ name: entity.createdEvent,
        token: defineCommerceEventContract({ name: entity.createdEvent, revision, internal: true, decode: policy.capture }) }));
    const tokens = contracts.map(entry => entry.token);
    const participant = defineAtomicCommerceParticipant("product");
    const root = defineAtomicCommerceCommand("optionProductCreate", (ctx, input) => ctx.call(participant, command, input));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...selectedFixture.hostInput,
      identityAndAccessPolicy: { profile: "logical-option-product-create" },
      participants: [{ participant, logicalStorage: selectedProduct.hostInput.logicalStorage,
        commands: [command], validateLogical: policy.validateLogical,
        events: { contracts: tokens, select: event => {
          const token = isJsonObject(event) && typeof event.name === "string"
            ? contracts.find(entry => entry.name === event.name)?.token : undefined;
          return token === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(token);
        } } }],
      commands: [root], events: { producerRevision: revision, contracts: tokens,
        subscribers: [{ id: "logical-option-product-create", revision: "a".repeat(64) }],
        validate: events => events.some(event => !event.internal)
          ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    }));
    hosts.push(() => Effect.runPromise(host.close));
    return { host, root };
  }

  async function optionReads(selectedProduct = product) {
    const host = await Effect.runPromise(makeCommerceHost({ ...selectedProduct.hostInput,
      commands: [...selectedProduct.hostInput.commands, selectedProduct.runtime.commands.listOptions,
        selectedProduct.runtime.commands.retrieveOption, selectedProduct.runtime.commands.countOptions],
    }));
    hosts.push(() => Effect.runPromise(host.close));
    return host;
  }

  it("uses native Option/Value commands, exact events, shared constraints and atomic rollback", async () => {
    const createProduct = await productCreation();
    const create = await optionCommand("create");
    const update = await optionCommand("update");
    const upsert = await optionCommand("upsert");
    const remove = await optionCommand("delete");
    const reads = await optionReads();
    await Effect.runPromise(createProduct.host.run(createProduct.host.newRequestKey(), createProduct.root,
      { id: "opt_product_one", title: "First", handle: "opt-product-one" }));
    await Effect.runPromise(createProduct.host.run(createProduct.host.newRequestKey(), createProduct.root,
      { id: "opt_product_two", title: "Second", handle: "opt-product-two" }));
    const before = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
    const key = create.host.newRequestKey();
    const created = await Effect.runPromise(create.host.run(key, create.root, [
      { id: "opt_size_one", title: "Size", product_id: "opt_product_one", values: ["Small", "Large"] },
      { id: "opt_size_two", title: "Size", product_id: "opt_product_two", values: [] },
    ]));
    expect(created).toMatchObject([{ id: "opt_size_one", title: "Size" }, { id: "opt_size_two", title: "Size" }]);
    const afterCreate = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
    expect(afterCreate).toHaveLength(before.length + 4);
    expect(await Effect.runPromise(create.host.run(create.host.newRequestKey(), create.root, []))).toEqual([]);
    expect(await Effect.runPromise(upsert.host.run(upsert.host.newRequestKey(), upsert.root, []))).toEqual([]);
    expect(await Effect.runPromise(remove.host.run(remove.host.newRequestKey(), remove.root, ["missing-option"]))).toBeNull();
    expect(await Effect.runPromise(remove.host.run(remove.host.newRequestKey(), remove.root, []))).toBeNull();
    expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterCreate);
    expect(await Effect.runPromise(create.host.run(key, create.root, [
      { id: "opt_size_one", title: "Size", product_id: "opt_product_one", values: ["Small", "Large"] },
      { id: "opt_size_two", title: "Size", product_id: "opt_product_two", values: [] },
    ]))).toEqual(created);
    expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterCreate);
    expect(await Effect.runPromise(reads.read(product.runtime.commands.countOptions,
      { filters: { product_id: "opt_product_one", title: "Size" },
        config: { select: ["title", "product.title"], relations: ["product"] } })))
      .toMatchObject([[{ id: "opt_size_one", product: { title: "First" } }], 1]);
    expect(await Effect.runPromise(reads.read(product.runtime.commands.retrieveOption,
      { id: "opt_size_one", config: { relations: ["values"] } })))
      .toMatchObject({ id: "opt_size_one", values: expect.arrayContaining([
        expect.objectContaining({ value: "Small" }), expect.objectContaining({ value: "Large" }),
      ]) });
    for (const input of [
      { scopeId: "other" }, { id: "ignored" }, { filters: { title: ["wrong"] } },
      { filters: { product_id: ["opt_product_one"] } },
      { config: { select: ["product.title"] } },
      { config: { select: ["product.missing"], relations: ["product"] } },
      { config: { relations: ["product.tags"] } },
      { config: { relations: ["values.variants"] } },
      { config: { take: 257 } }, { config: { order: { title: "ASC" } } },
    ]) await expect(Effect.runPromise(reads.read(product.runtime.commands.listOptions, input)))
      .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    for (const input of [
      { title: "Bad", product_id: "opt_product_one", scopeId: "other" },
      { title: "Bad", product_id: "opt_product_one", values: [12] },
      { title: "Bad", product_id: "opt_product_one", values: [{ id: "foreign-value", value: "Bad" }] },
    ]) await expect(Effect.runPromise(create.host.run(create.host.newRequestKey(), create.root, input)))
      .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    await expect(Effect.runPromise(update.host.run(update.host.newRequestKey(), update.root,
      { id: "opt_size_one", data: { values: [{ id: "foreign-value", value: "Bad" }] } })))
      .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    await expect(Effect.runPromise(upsert.host.run(upsert.host.newRequestKey(), upsert.root,
      [{ id: "opt_size_one", values: [{ id: "foreign-value", value: "Bad" }] }])))
      .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    await expect(Effect.runPromise(remove.host.run(remove.host.newRequestKey(), remove.root, { selector: {} })))
      .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterCreate);
    await expect(Effect.runPromise(create.host.run(create.host.newRequestKey(), create.root,
      [{ id: "opt_duplicate", title: "Size", product_id: "opt_product_one" }])))
      .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    await expect(Effect.runPromise(create.host.run(create.host.newRequestKey(), create.root,
      [{ id: "opt_foreign", title: "Wrong", product_id: "missing_product" }])))
      .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterCreate);
    await Effect.runPromise(update.host.run(update.host.newRequestKey(), update.root,
      { id: "opt_size_one", data: { title: "Dimensions" } }));
    expect(await Effect.runPromise(reads.read(product.runtime.commands.retrieveOption, { id: "opt_size_one" })))
      .toMatchObject({ title: "Dimensions" });
    const beforeFailedUpsert = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
    await expect(Effect.runPromise(upsert.host.run(upsert.host.newRequestKey(), upsert.root,
      [{ title: "Temporary", product_id: "opt_product_one", values: ["One"] },
        { id: "missing-option", title: "Missing" }]))).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeFailedUpsert);
    const upserted = await Effect.runPromise(upsert.host.run(upsert.host.newRequestKey(), upsert.root,
      [{ id: "opt_size_one", title: "Dimensions", values: ["Small", "Medium"] },
        { title: "Material", product_id: "opt_product_one", values: ["Cotton"] }]));
    expect(upserted).toMatchObject([{ title: "Material" }, { id: "opt_size_one" }]);
    expect(await Effect.runPromise(reads.read(product.runtime.commands.countOptions,
      { filters: { product_id: "opt_product_one" } }))).toMatchObject([[{}, {}], 2]);
    const beforeDeleteCurrent = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
    const beforeDeleteRevisions = await fixture.persistence.drizzle.select().from(fxAppRowRevisions);
    await Effect.runPromise(remove.host.run(remove.host.newRequestKey(), remove.root, ["opt_size_one"]));
    expect(await Effect.runPromise(reads.read(product.runtime.commands.countOptions,
      { filters: { id: "opt_size_one" } }))).toEqual([[], 0]);
    expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toHaveLength(beforeDeleteCurrent.length);
    expect(await fixture.persistence.drizzle.select().from(fxAppRowRevisions)).toHaveLength(beforeDeleteRevisions.length + 3);
    const events = await fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
    expect(events.map(event => event.envelope.contract)).toEqual(expect.arrayContaining([
      catalog.option.createdEvent, catalog.value.createdEvent, catalog.option.updatedEvent, catalog.option.deletedEvent,
    ]));

    const graph = await Effect.runPromise(createProduct.host.run(createProduct.host.newRequestKey(), createProduct.root,
      { id: "opt_graph_product", title: "Graph", handle: "opt-graph-product",
        options: [{ title: "Flavor", values: ["Vanilla"] }],
        variants: [{ id: "opt_graph_variant", title: "Vanilla", options: { Flavor: "Vanilla" } }] }));
    if (!isJsonObject(graph) || !Array.isArray(graph.options)) throw new Error("Missing native Option graph");
    const graphOption = graph.options.find(value => isJsonObject(value) && value.title === "Flavor");
    if (!isJsonObject(graphOption) || typeof graphOption.id !== "string") throw new Error("Missing graph Option ID");
    const beforeGraphRows = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
    const beforeGraphRevisions = await fixture.persistence.drizzle.select().from(fxAppRowRevisions);
    const beforeGraphEvents = await fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
    const lateFailure = await optionCommand("delete", fixture, product, true);
    await expect(Effect.runPromise(lateFailure.host.run(lateFailure.host.newRequestKey(), lateFailure.root,
      [graphOption.id]))).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeGraphRows);
    expect(await fixture.persistence.drizzle.select().from(fxAppRowRevisions)).toEqual(beforeGraphRevisions);
    expect(await fixture.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeGraphEvents);
    const graphKey = remove.host.newRequestKey();
    await Effect.runPromise(remove.host.run(graphKey, remove.root, [graphOption.id]));
    const afterGraphRevisions = await fixture.persistence.drizzle.select().from(fxAppRowRevisions);
    expect(afterGraphRevisions).toHaveLength(beforeGraphRevisions.length + 3);
    expect(afterGraphRevisions.filter(row => row.isTombstone)).toHaveLength(
      beforeGraphRevisions.filter(row => row.isTombstone).length + 3);
    expect((await fixture.persistence.drizzle.select().from(fxSystemCommitEvents))
      .slice(beforeGraphEvents.length).map(event => event.envelope.contract)).toEqual([catalog.option.deletedEvent]);
    expect(await Effect.runPromise(remove.host.run(graphKey, remove.root, [graphOption.id]))).toBeNull();
    expect(await Effect.runPromise(reads.read(product.runtime.commands.countOptions,
      { filters: { id: graphOption.id } }))).toEqual([[], 0]);
  }, 180_000);

  it("confines Option identities, uniqueness and Product references to each shop", async () => {
    const other = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      resource: fixture.resource, includeProduct: true,
      fixtureIdentity: { deploymentId: "deployment_product_option_shop_b",
        projectId: "project_product_option_shop_b", uuidOffset: 11_000 },
    });
    const otherProduct = await prepareLogicalProductHost(other);
    hosts.push(() => Effect.runPromise(otherProduct.host.close));
    await Effect.runPromise(otherProduct.host.initialize([]));
    const firstProduct = await productCreation();
    const secondProduct = await productCreation(other, otherProduct);
    const firstCreate = await optionCommand("create");
    const secondCreate = await optionCommand("create", other, otherProduct);
    const secondReads = await optionReads(otherProduct);
    const firstScope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
    const secondScope = projectScopeIdUuidV1(other.application.authority.scopeId).scopeUuid;
    expect(firstScope).not.toBe(secondScope);
    await Effect.runPromise(firstProduct.host.run(firstProduct.host.newRequestKey(), firstProduct.root,
      { id: "opt_shared_product", title: "First shop", handle: "first-shop" }));
    await Effect.runPromise(firstCreate.host.run(firstCreate.host.newRequestKey(), firstCreate.root,
      [{ id: "opt_shared", title: "Size", product_id: "opt_shared_product" }]));
    const beforeForeign = (await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
      .filter(row => row.scopeUuid === secondScope);
    await expect(Effect.runPromise(secondCreate.host.run(secondCreate.host.newRequestKey(), secondCreate.root,
      [{ id: "opt_foreign_product", title: "Size", product_id: "opt_shared_product" }])))
      .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    expect((await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
      .filter(row => row.scopeUuid === secondScope)).toEqual(beforeForeign);
    await Effect.runPromise(secondProduct.host.run(secondProduct.host.newRequestKey(), secondProduct.root,
      { id: "opt_shared_product", title: "Second shop", handle: "second-shop" }));
    await Effect.runPromise(secondCreate.host.run(secondCreate.host.newRequestKey(), secondCreate.root,
      [{ id: "opt_shared", title: "Size", product_id: "opt_shared_product" }]));
    expect(await Effect.runPromise(secondReads.read(otherProduct.runtime.commands.countOptions,
      { filters: { id: "opt_shared" } }))).toMatchObject([[{ id: "opt_shared" }], 1]);
    expect((await fixture.persistence.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
      .toEqual(fixture.physicalTablesBeforeCandidate);
  }, 180_000);
});
