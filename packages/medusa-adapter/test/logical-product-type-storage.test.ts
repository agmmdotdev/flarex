import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { productLogicalCreateEventPolicy, productLogicalTypeEventPolicy } from "../src/product-local-events";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/atomicCommerce/events";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxAppRowCurrent } from "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product Type test driver");
const cleanup: Array<() => Promise<void>> = [];

describe("native Product Type on shared logical Product storage", () => {
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
    await Effect.runPromise(product.host.close);
    for (const close of cleanup.reverse()) await close();
  }, 120_000);

  async function typeCommand(operation: "create" | "update" | "delete",
    selectedFixture = fixture, selectedProduct = product) {
    const command = operation === "create" ? selectedProduct.runtime.commands.createTypes
      : operation === "update" ? selectedProduct.runtime.commands.updateTypes : selectedProduct.runtime.commands.deleteTypes;
    const policy = productLogicalTypeEventPolicy(catalog, operation);
    const name = operation === "create" ? catalog.type.createdEvent
      : operation === "update" ? catalog.type.updatedEvent : catalog.type.deletedEvent;
    const revision = createHash("sha256").update(`logical-product-type-${operation}`).digest("hex");
    const contract = defineCommerceEventContract({ name, revision, internal: true, decode: policy.capture });
    const participant = defineAtomicCommerceParticipant("product");
    const root = defineAtomicCommerceCommand(`productType${operation}`, (ctx, input) => ctx.call(participant, command, input));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...selectedFixture.hostInput,
      identityAndAccessPolicy: { profile: `logical-product-type-${operation}` },
      participants: [{ participant, logicalStorage: selectedProduct.hostInput.logicalStorage,
        commands: [command], validateLogical: policy.validateLogical,
        events: { contracts: [contract], select: () => Effect.succeed(contract) } }],
      commands: [root], events: { producerRevision: revision, contracts: [contract],
        subscribers: [{ id: `logical-product-type-${operation}`, revision: "a".repeat(64) }],
        validate: events => events.some(event => !event.internal)
          ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    }));
    return { host, root };
  }

  async function productCreation(selectedFixture = fixture, selectedProduct = product) {
    const command = selectedProduct.runtime.commands.create;
    const policy = productLogicalCreateEventPolicy(catalog);
    const revision = createHash("sha256").update("logical-typed-product-create").digest("hex");
    const contracts = [catalog.product, catalog.option, catalog.value, catalog.variant, catalog.image].map(entity => ({
      name: entity.createdEvent,
      token: defineCommerceEventContract({ name: entity.createdEvent, revision, internal: true, decode: policy.capture }),
    }));
    const tokens = contracts.map(entry => entry.token);
    const participant = defineAtomicCommerceParticipant("product");
    const root = defineAtomicCommerceCommand("typedProductCreate", (ctx, input) => ctx.call(participant, command, input));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...selectedFixture.hostInput,
      identityAndAccessPolicy: { profile: "logical-typed-product-create" },
      participants: [{ participant, logicalStorage: selectedProduct.hostInput.logicalStorage,
        commands: [command], validateLogical: policy.validateLogical,
        events: { contracts: tokens, select: event => {
          const contract = isJsonObject(event) && typeof event.name === "string"
            ? contracts.find(candidate => candidate.name === event.name) : undefined;
          return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract.token);
        } } }],
      commands: [root], events: { producerRevision: revision, contracts: tokens,
        subscribers: [{ id: "logical-typed-product-create", revision: "a".repeat(64) }],
        validate: events => events.some(event => !event.internal)
          ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    }));
    return { host, root };
  }

  const typeReads = (selectedProduct = product) => makeCommerceHost({ ...selectedProduct.hostInput,
    commands: [...selectedProduct.hostInput.commands, selectedProduct.runtime.commands.listTypes,
      selectedProduct.runtime.commands.retrieveType, selectedProduct.runtime.commands.countTypes],
  });

  it("uses native Type service, shared unique/FK enforcement and one publication per command", async () => {
    const reads = await Effect.runPromise(typeReads());
    const created = await typeCommand("create");
    const updated = await typeCommand("update");
    const deleted = await typeCommand("delete");
    const productCreate = await productCreation();
    try {
      const before = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const key = created.host.newRequestKey();
      const types = await Effect.runPromise(created.host.run(key, created.root,
        [{ id: "ptype_blue", value: "Blue" }, { id: "ptype_red", value: "Red" }]));
      expect(types).toMatchObject([{ id: "ptype_blue", value: "Blue" }, { id: "ptype_red", value: "Red" }]);
      const afterCreate = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      expect(afterCreate).toHaveLength(before.length + 2);
      expect(await Effect.runPromise(created.host.run(key, created.root,
        [{ id: "ptype_blue", value: "Blue" }, { id: "ptype_red", value: "Red" }]))).toEqual(types);
      expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterCreate);
      expect(await Effect.runPromise(reads.read(product.runtime.commands.listTypes,
        { filters: { value: "Blue" }, config: { select: ["value"] } })))
        .toEqual([{ id: "ptype_blue", value: "Blue" }]);
      expect(await Effect.runPromise(reads.read(product.runtime.commands.countTypes,
        { filters: {}, config: { take: 1 } }))).toMatchObject([[{ id: expect.any(String) }], 2]);
      expect(await Effect.runPromise(reads.read(product.runtime.commands.retrieveType,
        { id: "ptype_red", config: { select: ["value"] } }))).toMatchObject({ id: "ptype_red", value: "Red" });
      for (const input of [
        { scopeId: "other" }, { table: "product_tag" }, { id: "ignored-id" },
        { filters: { value: ["not-admitted"] } }, { filters: { metadata: {} } },
        { filters: { value: { equals: "not-admitted" } } },
        { config: { select: ["missing"] } }, { config: { relations: ["products"] } },
        { config: { take: 257 } }, { config: { skip: -1 } },
        { config: { order: { value: "ASC" } } },
      ]) {
        await expect(Effect.runPromise(reads.read(product.runtime.commands.listTypes, input)))
          .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      }
      for (const input of [{}, { id: "ptype_red", filters: { value: "ignored" } }]) {
        await expect(Effect.runPromise(reads.read(product.runtime.commands.retrieveType, input)))
          .rejects.toMatchObject({ reason: "invalidInput" });
      }
      await expect(Effect.runPromise(reads.read(product.runtime.commands.retrieveType,
        { id: "ptype_missing" }))).rejects.toMatchObject({ reason: "adapterFailure" });
      const beforeDuplicate = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      await expect(Effect.runPromise(created.host.run(created.host.newRequestKey(), created.root,
        [{ id: "ptype_dup", value: "Blue" }]))).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeDuplicate);
      await Effect.runPromise(updated.host.run(updated.host.newRequestKey(), updated.root,
        { id: "ptype_red", data: { value: "Green" } }));
      expect(await Effect.runPromise(reads.read(product.runtime.commands.retrieveType, { id: "ptype_red" })))
        .toMatchObject({ id: "ptype_red", value: "Green" });
      await Effect.runPromise(productCreate.host.run(productCreate.host.newRequestKey(), productCreate.root,
        { id: "prod_type_blue", title: "Typed", handle: "typed", type_id: "ptype_blue" }));
      const beforeMissing = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      await expect(Effect.runPromise(productCreate.host.run(productCreate.host.newRequestKey(), productCreate.root,
        { id: "prod_type_missing", title: "Missing", handle: "missing", type_id: "ptype_missing" })))
        .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeMissing);
      await Effect.runPromise(deleted.host.run(deleted.host.newRequestKey(), deleted.root, ["ptype_blue"]));
      expect(await Effect.runPromise(reads.read(product.runtime.commands.countTypes,
        { filters: { id: "ptype_blue" } }))).toEqual([[], 0]);
      expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve,
        { id: "prod_type_blue" }))).toMatchObject({ id: "prod_type_blue", type_id: null });
      const events = await fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
      expect(events.map(event => event.envelope.contract)).toEqual(expect.arrayContaining([
        catalog.type.createdEvent, catalog.type.updatedEvent, catalog.type.deletedEvent,
      ]));
    } finally {
      await Effect.runPromise(reads.close);
      await Effect.runPromise(created.host.close);
      await Effect.runPromise(updated.host.close);
      await Effect.runPromise(deleted.host.close);
      await Effect.runPromise(productCreate.host.close);
    }
  }, 180_000);

  it("isolates matching Type identities and rejects a Product reference to another shop", async () => {
    const other = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      resource: fixture.resource, includeProduct: true,
      fixtureIdentity: { deploymentId: "deployment_product_type_shop_b",
        projectId: "project_product_type_shop_b", uuidOffset: 10_000 },
    });
    const otherProduct = await prepareLogicalProductHost(other);
    await Effect.runPromise(otherProduct.host.initialize([]));
    const firstCreate = await typeCommand("create");
    const secondCreate = await typeCommand("create", other, otherProduct);
    const firstReads = await Effect.runPromise(typeReads());
    const secondReads = await Effect.runPromise(typeReads(otherProduct));
    const secondProductCreate = await productCreation(other, otherProduct);
    try {
      expect(other.persistence).toBe(fixture.persistence);
      const firstScope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
      const secondScope = projectScopeIdUuidV1(other.application.authority.scopeId).scopeUuid;
      expect(firstScope).not.toBe(secondScope);
      await Effect.runPromise(firstCreate.host.run(firstCreate.host.newRequestKey(), firstCreate.root,
        [{ id: "ptype_shop_only", value: "Shop only" }, { id: "ptype_shared", value: "Same value" }]));
      const secondBefore = (await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === secondScope);
      expect(await Effect.runPromise(secondReads.read(otherProduct.runtime.commands.countTypes,
        { filters: { id: "ptype_shop_only" } }))).toEqual([[], 0]);
      await expect(Effect.runPromise(secondProductCreate.host.run(secondProductCreate.host.newRequestKey(),
        secondProductCreate.root, { id: "prod_foreign_type", title: "Foreign", type_id: "ptype_shop_only" })))
        .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      expect((await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === secondScope)).toEqual(secondBefore);
      await Effect.runPromise(secondCreate.host.run(secondCreate.host.newRequestKey(), secondCreate.root,
        { id: "ptype_shared", value: "Same value" }));
      expect(await Effect.runPromise(firstReads.read(product.runtime.commands.countTypes,
        { filters: { value: "Same value" } }))).toMatchObject([[{ id: "ptype_shared" }], 1]);
      expect(await Effect.runPromise(secondReads.read(otherProduct.runtime.commands.countTypes,
        { filters: { value: "Same value" } }))).toMatchObject([[{ id: "ptype_shared" }], 1]);
      expect((await fixture.persistence.query<{ name: string }>(
        "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
        .toEqual(fixture.physicalTablesBeforeCandidate);
    } finally {
      await Effect.runPromise(firstCreate.host.close);
      await Effect.runPromise(secondCreate.host.close);
      await Effect.runPromise(firstReads.close);
      await Effect.runPromise(secondReads.close);
      await Effect.runPromise(secondProductCreate.host.close);
      await Effect.runPromise(otherProduct.host.close);
    }
  }, 180_000);
});
