import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { createWorkflow, WorkflowResponse } from "@medusajs/workflows-sdk";

import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/atomicCommerce/events";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { logicalCommerceBatchResources } from "../../persistence-postgres/src/commerceTransaction/resources";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxAppRowCurrent, fxAppSearchEntryCurrent, fxSystemScopeClocks,
  fxSystemSearchBuildStates } from "../../persistence-postgres/src/schema";
import { prepareLogicalSearchBuild } from "../../persistence-postgres/src/logicalSearchBuild";
import { runEffectTransaction } from "../../persistence-postgres/src/effectTransaction";
import type { FlarexMetadataTransaction } from "../../persistence-postgres/src/metadataTransaction";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product Type test driver");
const capacityCount = process.env.FLAREX_FANOUT_CAPACITY_COUNT === undefined
  ? undefined : Number(process.env.FLAREX_FANOUT_CAPACITY_COUNT);
if (capacityCount !== undefined && (!Number.isInteger(capacityCount) || capacityCount < 32
  || capacityCount > 2016 || capacityCount % 32 !== 0))
  throw new Error("Invalid Type fan-out capacity count");
const fanoutCounts = capacityCount === undefined ? [128, 512, 896] : [capacityCount];
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
    selectedFixture = fixture, selectedProduct = product, rejectReceipt = false,
    afterValidation?: () => Promise<void>, requestCommandMs?: number) {
    const command = operation === "create" ? selectedProduct.runtime.commands.createTypes
      : operation === "update" ? selectedProduct.runtime.commands.updateTypes : selectedProduct.runtime.commands.deleteTypes;
    const policy = selectedProduct.runtime.logicalPolicy;
    const name = operation === "create" ? catalog.type.createdEvent
      : operation === "update" ? catalog.type.updatedEvent : catalog.type.deletedEvent;
    const revision = createHash("sha256").update(`logical-product-type-${operation}`).digest("hex");
    const contract = defineCommerceEventContract({ name, revision, internal: true, decode: policy.capture });
    const participant = defineAtomicCommerceParticipant("product");
    const root = defineAtomicCommerceCommand(`productType${operation}`, (ctx, input) => ctx.call(participant, command, input));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...selectedFixture.hostInput,
      ...(requestCommandMs === undefined ? {} : { requestCommandMs }),
      identityAndAccessPolicy: { profile: `logical-product-type-${operation}` },
      participants: [{ participant, logicalStorage: selectedProduct.hostInput.logicalStorage,
        commands: [command], validateLogicalCall: rejectReceipt || afterValidation !== undefined
          ? (...args) => policy.validateLogicalCall(...args).pipe(Effect.andThen(rejectReceipt
            ? Effect.fail(commerceError("receiptMismatch"))
            : afterValidation === undefined ? Effect.void : Effect.promise(afterValidation)))
          : policy.validateLogicalCall,
        ...(operation === "delete" ? { allowSetNull: true as const,
          logicalResources: logicalCommerceBatchResources } : {}),
        events: { contracts: [contract], select: () => Effect.succeed(contract) } }],
      commands: [root], events: { producerRevision: revision, contracts: [contract],
        subscribers: [{ id: `logical-product-type-${operation}`, revision: "a".repeat(64) }],
        validate: events => events.some(event => !event.internal)
          ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    }));
    return { host, root };
  }

  async function productCreation(selectedFixture = fixture, selectedProduct = product,
    largeRows = false) {
    const command = selectedProduct.runtime.commands.create;
    const policy = selectedProduct.runtime.logicalPolicy;
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
      ...(largeRows ? { requestByteLimit: logicalCommerceBatchResources.commandBytes } : {}),
      participants: [{ participant, logicalStorage: selectedProduct.hostInput.logicalStorage,
        ...(largeRows ? { logicalResources: logicalCommerceBatchResources } : {}),
        commands: [command], validateLogicalCall: policy.validateLogicalCall,
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

  it("forwards a validated logical transition opt-in through workflow composition", async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ product: {
      module: product.runtime.workflow, methods: ["listProductTags"], graph: false,
    } }, false));
    const workflow = createWorkflow("type-transition-composition", () => new WorkflowResponse(null));
    let forwarded = false;
    await expect(Effect.runPromise(prepareAtomicWorkflowHost({
      execution: { identityAndAccessPolicy: {}, prepare: composition => {
        forwarded = composition.participants[0]?.allowSetNull === true;
        return Effect.fail(commerceError("invalidAuthority"));
      } },
      modules: { product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage } },
      workflow: { name: "typeTransitionComposition", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: Schema.Json, output: Schema.Json }, revision: "a".repeat(64),
    }))).rejects.toMatchObject({ reason: "invalidAuthority" });
    expect(forwarded).toBe(true);
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
      const titleEntry = (await fixture.persistence.drizzle.select().from(fxAppSearchEntryCurrent))
        .find(entry => entry.fieldId === "title" && entry.foldedText === "typed");
      expect(titleEntry).toBeDefined();
      const beforeMissing = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const searchBeforeMissing = await fixture.persistence.drizzle.select().from(fxAppSearchEntryCurrent);
      await expect(Effect.runPromise(productCreate.host.run(productCreate.host.newRequestKey(), productCreate.root,
        { id: "prod_type_missing", title: "Missing", handle: "missing", type_id: "ptype_missing" })))
        .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeMissing);
      expect(await fixture.persistence.drizzle.select().from(fxAppSearchEntryCurrent)).toEqual(searchBeforeMissing);
      await Effect.runPromise(deleted.host.run(deleted.host.newRequestKey(), deleted.root, ["ptype_blue"]));
      expect(await Effect.runPromise(reads.read(product.runtime.commands.countTypes,
        { filters: { id: "ptype_blue" } }))).toEqual([[], 0]);
      expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve,
        { id: "prod_type_blue" }))).toMatchObject({ id: "prod_type_blue", type_id: null });
      const detachedTitle = (await fixture.persistence.drizzle.select().from(fxAppSearchEntryCurrent))
        .find(entry => entry.fieldId === "title" && entry.foldedText === "typed");
      if (titleEntry === undefined || detachedTitle === undefined)
        throw new Error("Product title search entry was not maintained");
      expect(detachedTitle.commitSeq).toBeGreaterThan(titleEntry.commitSeq);
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

  it("refuses search readiness for a populated source without complete coverage", async () => {
    const creation = await productCreation();
    try {
      await Effect.runPromise(creation.host.run(creation.host.newRequestKey(), creation.root,
        { id: "prod_search_coverage", title: "Coverage", handle: "coverage" }));
      const saved = await fixture.persistence.drizzle.select().from(fxSystemSearchBuildStates);
      expect(saved.length).toBeGreaterThan(0);
      await fixture.persistence.drizzle.delete(fxSystemSearchBuildStates);
      try {
        const build = await Effect.runPromise(prepareLogicalSearchBuild(
          fixture.control.drizzle, fixture.deploymentId, fixture.schemaVersionId, { kind: "fresh" }));
        const result = await Effect.runPromise(runEffectTransaction(
          work => fixture.persistence.drizzle.transaction(work), "Inspect populated search source",
          (tx: FlarexMetadataTransaction) => build.advanceEmpty(tx, fixture.application.active.basis.authority),
          cause => new Error("Search build inspection failed", { cause })));
        expect(result).toEqual({ status: "not_ready", reason: "populated" });
        expect(await fixture.persistence.drizzle.select().from(fxSystemSearchBuildStates)).toEqual([]);
        await expect(Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve,
          { id: "prod_search_coverage" }))).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      } finally {
        await fixture.persistence.drizzle.insert(fxSystemSearchBuildStates).values(saved);
      }
    } finally {
      await Effect.runPromise(creation.host.close);
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
    const firstProductCreate = await productCreation();
    const secondProductCreate = await productCreation(other, otherProduct);
    const firstDelete = await typeCommand("delete");
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
      await Effect.runPromise(firstProductCreate.host.run(firstProductCreate.host.newRequestKey(),
        firstProductCreate.root, { id: "prod_type_shared", title: "First shop", type_id: "ptype_shared" }));
      await Effect.runPromise(secondProductCreate.host.run(secondProductCreate.host.newRequestKey(),
        secondProductCreate.root, { id: "prod_type_shared", title: "Second shop", type_id: "ptype_shared" }));
      const shopSearch = { filters: { q: "first" }, config: { select: ["id"], withDeleted: true } };
      expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductList, shopSearch)))
        .toEqual([{ id: "prod_type_shared" }]);
      expect(await Effect.runPromise(otherProduct.host.read(otherProduct.runtime.commands.internalProductList, shopSearch)))
        .toEqual([]);
      await Effect.runPromise(firstDelete.host.run(firstDelete.host.newRequestKey(), firstDelete.root, ["ptype_shared"]));
      expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve,
        { id: "prod_type_shared" }))).toMatchObject({ type_id: null });
      expect(await Effect.runPromise(otherProduct.host.read(otherProduct.runtime.commands.internalProductRetrieve,
        { id: "prod_type_shared" }))).toMatchObject({ type_id: "ptype_shared" });
      expect(await Effect.runPromise(secondReads.read(otherProduct.runtime.commands.countTypes,
        { filters: { id: "ptype_shared" } }))).toMatchObject([[{ id: "ptype_shared" }], 1]);
      expect((await fixture.persistence.query<{ name: string }>(
        "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
        .toEqual(fixture.physicalTablesBeforeCandidate);
    } finally {
      await Effect.runPromise(firstCreate.host.close);
      await Effect.runPromise(secondCreate.host.close);
      await Effect.runPromise(firstReads.close);
      await Effect.runPromise(secondReads.close);
      await Effect.runPromise(firstProductCreate.host.close);
      await Effect.runPromise(secondProductCreate.host.close);
      await Effect.runPromise(firstDelete.host.close);
      await Effect.runPromise(otherProduct.host.close);
    }
  }, 180_000);

  it.each(fanoutCounts)("detaches %i Products in one Type delete publication and replays its outcome", async (productCount) => {
    const created = await typeCommand("create");
    const deleted = await typeCommand("delete", fixture, product, false, undefined,
      productCount >= 896 ? 30_000 : undefined);
    const rejected = await typeCommand("delete", fixture, product, true);
    const productCreate = await productCreation();
    const typeId = `ptype_fanout_boundary_${productCount}`;
    try {
      await Effect.runPromise(created.host.run(created.host.newRequestKey(), created.root,
        { id: typeId, value: "Fan-out boundary" }));
      const rowsBeforeProducts = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      for (let batch = 0; batch < productCount / 32; batch++) {
        const rows = Array.from({ length: 32 }, (_, index) => ({
          id: `prod_fanout_${productCount}_${batch * 32 + index}`, title: `Fan-out ${batch * 32 + index}`,
          handle: `prod-fanout-${productCount}-${batch * 32 + index}`, type_id: typeId,
        }));
        expect(await Effect.runPromise(productCreate.host.run(productCreate.host.newRequestKey(), productCreate.root, rows)))
          .toMatchObject(rows);
      }
      expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toHaveLength(rowsBeforeProducts.length + productCount);
      const before = await logicalCurrencyInventory(fixture);
      await expect(Effect.runPromise(rejected.host.run(rejected.host.newRequestKey(), rejected.root, [typeId])))
        .rejects.toMatchObject({ reason: "receiptMismatch" });
      expect(await logicalCurrencyInventory(fixture)).toEqual(before);
      const key = deleted.host.newRequestKey();
      if (productCount === 512 && fixture.observeSql !== undefined) {
        let stagedFactPages = 0;
        fixture.observeSql(text => {
          if (/\bfx_write_scope_publication_rows\b/i.test(text) && ++stagedFactPages === 4)
            throw new Error("Injected failure after four staged fact pages");
        });
        try {
          await expect(Effect.runPromise(deleted.host.run(key, deleted.root, [typeId]))).rejects.toThrow();
        } finally {
          fixture.observeSql(undefined);
        }
        expect(stagedFactPages).toBe(4);
        expect(await logicalCurrencyInventory(fixture)).toEqual(before);
      }
      const deleteStarted = performance.now();
      const outcome = await Effect.runPromise(deleted.host.run(key, deleted.root, [typeId]));
      const deleteMs = Math.round(performance.now() - deleteStarted);
      const after = await logicalCurrencyInventory(fixture);
      expect(after.rows).toHaveLength(before.rows.length);
      expect(after.revisions).toHaveLength(before.revisions.length + productCount + 1);
      expect(after.indexRevisions.length).toBeGreaterThan(before.indexRevisions.length + productCount);
      expect(after.rowChanges).toHaveLength(before.rowChanges.length + productCount + 1);
      expect(after.commits).toHaveLength(before.commits.length + 1);
      expect(after.events).toHaveLength(before.events.length + 1);
      if (capacityCount !== undefined) {
        const scopeUuid = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
        const committed = after.commits.find(commit => commit.scopeUuid === scopeUuid &&
          !before.commits.some(previous => previous.scopeUuid === scopeUuid && previous.commitSeq === commit.commitSeq));
        expect(committed).toBeDefined();
        const revisions = after.revisions.filter(revision => revision.scopeUuid === scopeUuid &&
          revision.commitSeq === committed?.commitSeq);
        process.stdout.write(`Type delete capacity ${JSON.stringify({ driver, productCount, deleteMs,
          rowRevisions: revisions.length,
          indexRevisions: after.indexRevisions.filter(revision => revision.scopeUuid === scopeUuid &&
            revision.commitSeq === committed?.commitSeq).length,
          factRows: after.rowChanges.filter(change => change.scopeUuid === scopeUuid &&
            change.commitSeq === committed?.commitSeq).length,
          finalDocumentBytes: revisions.reduce((total, revision) => total + (revision.valueBytes?.byteLength ?? 0), 0),
        })}\n`);
      }
      const published = after.rowChanges.slice(before.rowChanges.length);
      expect(new Set(published.map(change => change.commitSeq)).size).toBe(1);
      expect(published.map(change => change.changeOrdinal)).toEqual(Array.from({ length: productCount + 1 }, (_, index) => index));
      for (const index of [0, 31, 32, 63, 64, 95, 96, 127, productCount - 1]) {
        expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve,
          { id: `prod_fanout_${productCount}_${index}` }))).toMatchObject({ id: `prod_fanout_${productCount}_${index}`, type_id: null });
      }
      expect(await Effect.runPromise(deleted.host.run(key, deleted.root, [typeId]))).toEqual(outcome);
      expect(await logicalCurrencyInventory(fixture)).toEqual(after);
    } finally {
      await Effect.runPromise(created.host.close);
      await Effect.runPromise(deleted.host.close);
      await Effect.runPromise(rejected.host.close);
      await Effect.runPromise(productCreate.host.close);
    }
  }, 360_000);

  it.skipIf(process.env.FLAREX_FANOUT_OVERFLOW !== "1")(
    "refuses over-budget Type deletion before staging Product changes", async () => {
      const productCount = 2048;
      const typeId = "ptype_over_capacity";
      const created = await typeCommand("create");
      const deleted = await typeCommand("delete", fixture, product, false, undefined, 30_000);
      const productCreate = await productCreation();
      try {
        await Effect.runPromise(created.host.run(created.host.newRequestKey(), created.root,
          { id: typeId, value: "Over capacity" }));
        for (let batch = 0; batch < productCount / 32; batch++) {
          const rows = Array.from({ length: 32 }, (_, index) => ({
            id: `prod_over_capacity_${batch * 32 + index}`,
            title: `Over capacity ${batch * 32 + index}`,
            handle: `prod-over-capacity-${batch * 32 + index}`, type_id: typeId,
          }));
          await Effect.runPromise(productCreate.host.run(productCreate.host.newRequestKey(), productCreate.root, rows));
        }
        const compactInventory = async () => {
          // Counts avoid sorting every historical index revision after 2,048 seeds.
          // A refused delete must add no revision, fact, event or outcome.
          const rows = await fixture.persistence.query<{
            rows: number; revisions: number; indexEntries: number; indexRevisions: number;
            commits: number; facts: number; outcomes: number; wakes: number; events: number;
          }>(`select
            (select count(*)::int from fx_app_row_current) as rows,
            (select count(*)::int from fx_app_row_rev) as revisions,
            (select count(*)::int from fx_app_index_entry_current) as "indexEntries",
            (select count(*)::int from fx_app_index_entry_rev) as "indexRevisions",
            (select count(*)::int from fx_system_commit) as commits,
            (select count(*)::int from fx_system_commit_app_row_change) as facts,
            (select count(*)::int from fx_system_idempotency) as outcomes,
            (select count(*)::int from fx_system_commit_wake) as wakes,
            (select count(*)::int from fx_system_commit_event) as events`);
          return {
            counts: rows.rows[0],
            clocks: await fixture.persistence.drizzle.select().from(fxSystemScopeClocks),
          };
        };
        const before = await compactInventory();
        let stagedFacts = 0;
        fixture.observeSql?.(statement => {
          if (/insert into "fx_system_commit_app_row_change"/i.test(statement)) stagedFacts++;
        });
        try {
          await expect(Effect.runPromise(deleted.host.run(deleted.host.newRequestKey(), deleted.root, [typeId])))
            .rejects.toMatchObject({ reason: "limitExceeded", cause: {
              _tag: "LogicalReferenceCapacityError", resource: "affectedRows", maximum: 2016,
              observedAtLeast: 2017,
            } });
        } finally { fixture.observeSql?.(undefined); }
        expect(stagedFacts).toBe(0);
        expect(await compactInventory()).toEqual(before);
        expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve,
          { id: "prod_over_capacity_2047" }))).toMatchObject({ type_id: typeId });
      } finally {
        await Effect.runPromise(created.host.close);
        await Effect.runPromise(deleted.host.close);
        await Effect.runPromise(productCreate.host.close);
      }
    }, 360_000);

  it("rolls back a Type deletion when referenced Product bytes exceed the core transition budget", async () => {
    const localCleanup: Array<() => Promise<void>> = [];
    try {
      const localFixture = await logicalCurrencyFixture(driver, close => localCleanup.push(close), { includeProduct: true });
      const localProduct = await prepareLogicalProductHost(localFixture);
      try {
        await Effect.runPromise(localProduct.host.initialize([]));
        const closeHosts: Array<() => Promise<void>> = [];
        try {
          const created = await typeCommand("create", localFixture, localProduct);
          closeHosts.push(() => Effect.runPromise(created.host.close));
          const deleted = await typeCommand("delete", localFixture, localProduct, false, undefined, 30_000);
          closeHosts.push(() => Effect.runPromise(deleted.host.close));
          const productCreate = await productCreation(localFixture, localProduct, true);
          closeHosts.push(() => Effect.runPromise(productCreate.host.close));
          const typeId = "ptype_large_reference_bytes";
          await Effect.runPromise(created.host.run(created.host.newRequestKey(), created.root,
            { id: typeId, value: "Large reference bytes" }));
          for (let batch = 0; batch < 16; batch++) {
            const rows = Array.from({ length: 12 }, (_, index) => ({
              id: `prod_large_reference_${batch * 12 + index}`,
              title: `Large reference ${batch * 12 + index}`,
              handle: `large-reference-${batch * 12 + index}`,
              type_id: typeId, metadata: { data: "x".repeat(25_000) },
            }));
            expect(await Effect.runPromise(productCreate.host.run(productCreate.host.newRequestKey(), productCreate.root, rows)))
              .toMatchObject(rows);
          }
          const before = await logicalCurrencyInventory(localFixture);
          let stagedFactPages = 0;
          localFixture.observeSql?.(text => {
            if (/\bfx_write_scope_publication_rows\b/i.test(text)) stagedFactPages++;
          });
          try {
            await expect(Effect.runPromise(deleted.host.run(deleted.host.newRequestKey(), deleted.root, [typeId])))
              .rejects.toMatchObject({ reason: "limitExceeded" });
          } finally { localFixture.observeSql?.(undefined); }
          if (localFixture.observeSql !== undefined) expect(stagedFactPages).toBeGreaterThan(1);
          expect(await logicalCurrencyInventory(localFixture)).toEqual(before);
          expect(await Effect.runPromise(localProduct.host.read(localProduct.runtime.commands.internalProductRetrieve,
            { id: "prod_large_reference_0" }))).toMatchObject({ type_id: typeId });
        } finally { for (const close of closeHosts.reverse()) await close(); }
      } finally { await Effect.runPromise(localProduct.host.close); }
    } finally { for (const close of localCleanup.reverse()) await close(); }
  }, 360_000);

  it("includes a Product reference committed while Type deletion awaits settlement", async () => {
    if (driver !== "postgres") return;
    const typeId = "ptype_concurrent_insert";
    const created = await typeCommand("create");
    const productCreate = await productCreation();
    let signalEntered!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { signalEntered = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const deleted = await typeCommand("delete", fixture, product, false, async () => {
      signalEntered();
      await released;
    });
    try {
      await Effect.runPromise(created.host.run(created.host.newRequestKey(), created.root,
        { id: typeId, value: "Concurrent insert" }));
      await Effect.runPromise(productCreate.host.run(productCreate.host.newRequestKey(), productCreate.root,
        { id: "prod_concurrent_before", title: "Before", type_id: typeId }));
      const before = await logicalCurrencyInventory(fixture);
      const deleting = Effect.runPromise(deleted.host.run(deleted.host.newRequestKey(), deleted.root, [typeId]));
      try {
        await Effect.runPromise(Effect.promise(() => entered).pipe(Effect.timeout(5000)));
        await Effect.runPromise(productCreate.host.run(productCreate.host.newRequestKey(), productCreate.root,
          { id: "prod_concurrent_during", title: "During", type_id: typeId }));
      } finally { release(); }
      await deleting;
      const after = await logicalCurrencyInventory(fixture);
      expect(after.rowChanges).toHaveLength(before.rowChanges.length + 4);
      for (const id of ["prod_concurrent_before", "prod_concurrent_during"]) {
        expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve, { id })))
          .toMatchObject({ id, type_id: null });
      }
    } finally {
      release();
      await Effect.runPromise(created.host.close);
      await Effect.runPromise(productCreate.host.close);
      await Effect.runPromise(deleted.host.close);
    }
  }, 180_000);
});
