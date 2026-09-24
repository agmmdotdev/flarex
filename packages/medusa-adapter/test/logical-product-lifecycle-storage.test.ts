import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { isJsonObject } from "flarex-protocol/json";
import { Modules, CommonEvents } from "@medusajs/framework/utils/portable";
import { productLogicalCategoryCreateEventPolicy, productLogicalCreateEventPolicy,
  productLogicalDeleteEventPolicy, productLogicalTagEventPolicy,
  productLogicalLifecycleEventPolicy, productLogicalUpdateEventPolicy } from "../src/product-local-events";
import { prepareProductCreateWorkflow } from "../src/product-create-workflow";
import { prepareProductTagWorkflow } from "../src/product-tag-workflow";
import { currencyWorkflowModule } from "../src/currency-service";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/atomicCommerce/events";
import { defineCommerceCommand } from "../../persistence-postgres/src/commerceTransaction/commands";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxAppRowCurrent, fxAppRowRevisions } from "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product test driver");
const cleanup: Array<() => Promise<void>> = [];
let currency: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
let catalog: Effect.Success<ReturnType<typeof productRuntimeMetadata>>;
const committedEvents = () => currency.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const rowIdentity = (row: { scopeUuid: string; tableId: number; rowId: Uint8Array }) =>
  `${row.scopeUuid}:${row.tableId}:${Buffer.from(row.rowId).toString("hex")}`;

async function createHost() {
  return Effect.runPromise(prepareProductCreateWorkflow({
    execution: { identityAndAccessPolicy: currency.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...currency.hostInput, ...composition }) },
    modules: { product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage,
      moduleEvents: productLogicalCreateEventPolicy(catalog) } },
    revision: createHash("sha256").update("logical-product-lifecycle-create").digest("hex"),
    subscribers: [{ id: "logical-product-lifecycle", revision: "a".repeat(64) }],
  }));
}

async function categoryHost() {
  const policy = productLogicalCategoryCreateEventPolicy(catalog);
  const participant = defineAtomicCommerceParticipant("product");
  const root = defineAtomicCommerceCommand("productCategoryCreateRoot", (ctx, input) =>
    ctx.call(participant, product.runtime.commands.createCategories, input));
  const revision = createHash("sha256").update("logical-product-category-create").digest("hex");
  const contract = defineCommerceEventContract({ name: catalog.category.createdEvent, revision,
    internal: true, decode: policy.capture });
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...currency.hostInput,
    identityAndAccessPolicy: { profile: "logical-product-category-create" },
    participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
      commands: [product.runtime.commands.createCategories], validateLogical: policy.validateLogical,
      events: { contracts: [contract], select: (message: Json) => isJsonObject(message) &&
        message.name === catalog.category.createdEvent ? Effect.succeed(contract) : Effect.fail(commerceError("unadmittedEvent")) } }],
    commands: [root], events: { producerRevision: revision, contracts: [contract],
      subscribers: [{ id: "logical-product-membership", revision: "a".repeat(64) }],
      validate: events => events.some(event => !event.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  return { host, root };
}

async function tagHost() {
  return Effect.runPromise(prepareProductTagWorkflow({
    execution: { identityAndAccessPolicy: currency.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...currency.hostInput, ...composition }) },
    modules: { product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage,
      moduleEvents: productLogicalTagEventPolicy(catalog, "created") },
    currency: { module: Result.getOrThrow(currencyWorkflowModule), logicalStorage: currency.hostInput.logicalStorage } },
    revision: createHash("sha256").update("logical-product-membership-tag").digest("hex"),
    subscribers: [{ id: "logical-product-membership", revision: "a".repeat(64) }],
  }));
}

async function updateHost(forged: "image" | "variant" | "value" | false = false,
  pendingRelation?: "images" | "variants" | "options.values", foreignOptionId?: string) {
  const policy = productLogicalUpdateEventPolicy(catalog);
  const participant = defineAtomicCommerceParticipant("product");
  const command = forged ? defineCommerceCommand("productUpdate", "write", Effect.fn("ProductTest.forgedChildUpdate")(function* (ctx) {
    const rootId = forged === "image" ? "prod_logical_image_update"
      : forged === "variant" ? "prod_logical_variant_update" : "prod_logical_option_update";
    const foreignId = forged === "image" ? "prod_logical_image_foreign"
      : forged === "variant" ? "prod_logical_variant_foreign" : foreignOptionId;
    if (foreignId === undefined) return yield* ctx.refuse(commerceError("invalidInput"));
    const child = forged === "image" ? catalog.image : forged === "variant" ? catalog.variant : catalog.value;
    const childId = forged === "image" ? "img_logical_update_extra"
      : forged === "variant" ? "pvar_logical_update_extra" : "pval_logical_update_extra";
    yield* (yield* ctx.table(catalog.product.table.name)).write(ctx.manager, "update",
      [{ id: rootId, title: "Forged root title" }]);
    yield* (yield* ctx.table(child.table.name)).write(ctx.manager, "insert",
      [forged === "image" ? { id: childId, [catalog.foreignKeys.image]: foreignId, url: "extra.png", rank: 1 }
        : forged === "variant" ? { id: childId, [catalog.foreignKeys.variant]: foreignId, title: "Extra variant" }
          : { id: childId, [catalog.foreignKeys.value]: foreignId, value: "Extra value" }]);
    yield* ctx.captureLocalEvent({ name: catalog.product.updatedEvent,
      metadata: { source: Modules.PRODUCT, object: catalog.product.eventObject, action: CommonEvents.UPDATED },
      data: { id: rootId } });
    yield* ctx.captureLocalEvent({ name: child.createdEvent,
      metadata: { source: Modules.PRODUCT, object: child.eventObject, action: CommonEvents.CREATED },
      data: { id: childId } });
    return null;
  })) : product.runtime.commands.update;
  const root = defineAtomicCommerceCommand("productUpdateRoot", (ctx, input) =>
    Effect.gen(function* () {
      const updated = yield* ctx.call(participant, command, input);
      if (pendingRelation === undefined) return updated;
      if (!isJsonObject(input) || typeof input.id !== "string")
        return yield* Effect.fail(commerceError("invalidInput"));
      const pending = yield* ctx.call(participant, product.runtime.commands.list,
        { filters: { id: input.id }, config: { relations: [pendingRelation] } });
      return { updated, pending };
    }));
  const revision = createHash("sha256").update("logical-product-update").digest("hex");
  const contracts = new Map([
    catalog.product.updatedEvent, catalog.image.createdEvent,
    catalog.image.updatedEvent, catalog.image.deletedEvent,
    catalog.variant.createdEvent, catalog.variant.updatedEvent, catalog.variant.deletedEvent,
    catalog.option.createdEvent, catalog.option.updatedEvent, catalog.option.deletedEvent,
    catalog.value.createdEvent, catalog.value.updatedEvent, catalog.value.deletedEvent,
  ].map(name => [name, defineCommerceEventContract({ name, revision,
    internal: true, decode: policy.capture })] as const));
  const selected = { contracts: [...contracts.values()], select: (message: Json) => {
    const contract = isJsonObject(message) && typeof message.name === "string" ? contracts.get(message.name) : undefined;
    return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract);
  } };
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...currency.hostInput,
    identityAndAccessPolicy: { profile: "logical-product-update" },
    participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
      commands: pendingRelation === undefined ? [command] : [command, product.runtime.commands.list], validateLogical: policy.validateLogical,
      events: selected }],
    commands: [root], events: { producerRevision: revision, contracts: selected.contracts,
      subscribers: [{ id: "logical-product-update", revision: "a".repeat(64) }],
      validate: events => events.some(event => !event.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  return { host, root };
}

async function lifecycleHost(operation: "softDelete" | "restore" | "delete",
  forged: "event" | "unowned" | "membership" | false = false, lateRefuse = false) {
  const policy = operation === "delete" ? productLogicalDeleteEventPolicy(catalog)
    : productLogicalLifecycleEventPolicy(catalog, operation);
  const participant = defineAtomicCommerceParticipant("product");
  const commandName = operation === "delete" ? "productDeleteproduct" : operation === "restore" ? "productRestore" : "productSoftDelete";
  const membership = catalog.queryRelations.get(catalog.product.table.name)?.get("tags");
  const join = membership?.join;
  if (forged === "membership" && (join?.type !== "manyToMany" ||
    join.sourceColumns.length !== 1 || join.targetColumns.length !== 1))
    throw new Error("Missing Product tag membership declaration");
  const command = forged === "membership" && join?.type === "manyToMany"
    ? defineCommerceCommand(commandName, "write", Effect.fn("ProductTest.unownedMembershipDelete")(function* (ctx) {
      const source = join.sourceColumns[0], target = join.targetColumns[0];
      if (source === undefined || target === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      yield* (yield* ctx.table(join.pivotTable)).delete(ctx.manager,
        [{ [source]: "prod_logical_membership", [target]: "ptag_logical_membership" }]);
      yield* ctx.captureLocalEvent({ name: catalog.product.deletedEvent,
        metadata: { source: Modules.PRODUCT, object: catalog.product.eventObject, action: CommonEvents.DELETED },
        data: { id: "prod_logical_membership" } });
      return null;
    })) : forged === "unowned" ? defineCommerceCommand(commandName, "write", Effect.fn("ProductTest.unownedDelete")(function* (ctx) {
    yield* (yield* ctx.table(catalog.image.table.name)).delete(ctx.manager, [{ id: "img_logical_delete_rollback" }]);
    yield* ctx.captureLocalEvent({ name: catalog.product.deletedEvent,
      metadata: { source: Modules.PRODUCT, object: catalog.product.eventObject, action: CommonEvents.DELETED },
      data: { id: "prod_logical_delete_rollback" } });
    return null;
  })) : forged === "event" ? defineCommerceCommand(commandName, "write", ctx =>
    ctx.captureLocalEvent({ name: operation === "restore" ? catalog.product.restoredEvent : catalog.product.deletedEvent,
      metadata: { source: Modules.PRODUCT, object: catalog.product.eventObject,
        action: operation === "restore" ? CommonEvents.RESTORED : CommonEvents.DELETED },
      data: { id: "prod_logical_lifecycle" } }).pipe(Effect.as(null)))
    : operation === "delete" ? product.runtime.commands.delete : operation === "restore"
      ? product.runtime.commands.restore : product.runtime.commands.softDelete;
  const root = defineAtomicCommerceCommand(forged ? "productLifecycleForgery" : lateRefuse ? "productDeleteLateRefusal"
    : operation === "restore" ? "productRestoreRoot" : operation === "delete" ? "productDeleteRoot" : "productSoftDeleteRoot",
  (ctx, ids) => ctx.call(participant, command, ids).pipe(Effect.flatMap(result =>
    lateRefuse ? ctx.refuse(commerceError("invalidInput")) : Effect.succeed(result))));
  const entities = operation === "delete" ? [catalog.product]
    : [catalog.product, catalog.option, catalog.value, catalog.variant, catalog.image];
  const revision = createHash("sha256").update("logical-product-lifecycle-" + operation).digest("hex");
  const contracts = new Map(entities.map(entity => {
    const name = operation === "restore" ? entity.restoredEvent : entity.deletedEvent;
    return [name, defineCommerceEventContract({ name, revision, internal: true, decode: policy.capture })] as const;
  }));
  const selected = { contracts: [...contracts.values()], select: (message: Json) => {
    const contract = isJsonObject(message) && typeof message.name === "string" ? contracts.get(message.name) : undefined;
    return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract);
  } };
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...currency.hostInput,
    identityAndAccessPolicy: { profile: "logical-product-lifecycle", operation, forged, lateRefuse },
    participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
      commands: [command], validateLogical: policy.validateLogical, events: selected }],
    commands: [root], events: { producerRevision: revision, contracts: [...contracts.values()],
      subscribers: [{ id: "logical-product-lifecycle", revision: "a".repeat(64) }],
      validate: events => events.some(event => !event.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  return { host, root };
}

describe("native Product lifecycle on shared logical storage", () => {
  beforeAll(async () => {
    currency = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeProduct: true });
    product = await prepareLogicalProductHost(currency);
    catalog = await Effect.runPromise(captureProductSchema("atomic-commerce")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    await Effect.runPromise(product.host.initialize([]));
    await Effect.runPromise(product.host.close);
  }, 180_000);
  afterAll(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
    if (failures.length > 0) throw new AggregateError(failures, "Logical Product fixture cleanup failed");
  }, 120_000);

  it("publishes owned lifecycle events, replays, authenticates active restore, and rolls back a handle conflict", async () => {
    const create = await createHost();
    const remove = await lifecycleHost("softDelete");
    const restore = await lifecycleHost("restore");
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [...product.hostInput.commands, product.runtime.commands.list, product.runtime.commands.retrieve],
    }));
    const expected = [catalog.product, catalog.option, catalog.value, catalog.variant, catalog.image];
    const deletedNames = expected.map(entity => entity.deletedEvent).sort();
    const restoredNames = expected.map(entity => entity.restoredEvent).sort();
    try {
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: "prod_logical_lifecycle", title: "Logical Lifecycle",
        images: [{ id: "img_logical_lifecycle", url: "lifecycle.png" }],
        options: [{ title: "Size", values: ["Small"] }],
        variants: [{ id: "pvar_logical_lifecycle", title: "Small", options: { Size: "Small" } }],
      }] }));
      const beforeDelete = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await committedEvents();
      const deleteKey = remove.host.newRequestKey();
      const deleted = await Effect.runPromise(remove.host.run(deleteKey, remove.root, ["prod_logical_lifecycle"]));
      const afterDelete = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const deleteEvents = await committedEvents();
      expect(afterDelete).not.toEqual(beforeDelete);
      expect(deleteEvents.slice(beforeEvents.length).map(event => event.envelope.contract).sort()).toEqual(deletedNames);
      expect(await Effect.runPromise(read.read(product.runtime.commands.list,
        { filters: { id: "prod_logical_lifecycle" } }))).toEqual([]);
      expect(await Effect.runPromise(read.read(product.runtime.commands.list, {
        filters: { id: "prod_logical_lifecycle" },
        config: { withDeleted: true, relations: ["images", "options.values", "variants.options"] },
      }))).toMatchObject([{ deleted_at: expect.any(String), images: [{ deleted_at: expect.any(String) }],
        options: [{ deleted_at: expect.any(String), values: [{ deleted_at: expect.any(String) }] }],
        variants: [{ deleted_at: expect.any(String) }] }]);
      expect(await Effect.runPromise(remove.host.run(deleteKey, remove.root, ["prod_logical_lifecycle"]))).toEqual(deleted);
      expect(await committedEvents()).toEqual(deleteEvents);
      const restoreKey = restore.host.newRequestKey();
      const restored = await Effect.runPromise(restore.host.run(restoreKey, restore.root, ["prod_logical_lifecycle"]));
      const afterRestore = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const restoreEvents = await committedEvents();
      expect(restoreEvents.slice(deleteEvents.length).map(event => event.envelope.contract).sort()).toEqual(restoredNames);
      expect(await Effect.runPromise(read.read(product.runtime.commands.retrieve, {
        id: "prod_logical_lifecycle", config: { relations: ["images", "options.values", "variants.options"] },
      }))).toMatchObject({ deleted_at: null, images: [{ deleted_at: null }],
        options: [{ deleted_at: null, values: [{ deleted_at: null }] }], variants: [{ deleted_at: null }] });
      expect(await Effect.runPromise(restore.host.run(restoreKey, restore.root, ["prod_logical_lifecycle"]))).toEqual(restored);
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRestore);
      const activeEventsStart = restoreEvents.length;
      await Effect.runPromise(restore.host.run(restore.host.newRequestKey(), restore.root, ["prod_logical_lifecycle"]));
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRestore);
      const activeEvents = await committedEvents();
      expect(activeEvents.slice(activeEventsStart).map(event => event.envelope.contract).sort()).toEqual(restoredNames);
      await Effect.runPromise(remove.host.run(remove.host.newRequestKey(), remove.root, ["prod_logical_lifecycle"]));
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: "prod_logical_lifecycle_conflict", title: "Logical Lifecycle",
      }] }));
      const conflictRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const conflictEvents = await committedEvents();
      await expect(Effect.runPromise(restore.host.run(restore.host.newRequestKey(), restore.root,
        ["prod_logical_lifecycle"]))).rejects.toMatchObject({ reason: "rollbackOnly" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(conflictRows);
      expect(await committedEvents()).toEqual(conflictEvents);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(remove.host.close);
      await Effect.runPromise(restore.host.close);
      await Effect.runPromise(read.close);
    }
  }, 120_000);

  it("refuses a restored module event without a storage-owned observation", async () => {
    const forged = await lifecycleHost("restore", "event");
    try {
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await committedEvents();
      await expect(Effect.runPromise(forged.host.run(forged.host.newRequestKey(), forged.root,
        ["prod_logical_lifecycle"]))).rejects.toMatchObject({ reason: "receiptMismatch" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await committedEvents()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(forged.host.close); }
  }, 120_000);

  it("removes the native owned graph and pivot with one root event, replay, and rollback", async () => {
    const create = await createHost();
    const remove = await lifecycleHost("delete");
    const late = await lifecycleHost("delete", false, true);
    const forged = await lifecycleHost("delete", "event");
    const unowned = await lifecycleHost("delete", "unowned");
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [...product.hostInput.commands, product.runtime.commands.list],
    }));
    try {
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: "prod_logical_hard_delete", title: "Hard Delete Graph",
        images: [{ id: "img_logical_hard_delete", url: "hard-delete.png" }],
        options: [{ title: "Size", values: ["Small"] }],
        variants: [{ id: "pvar_logical_hard_delete", title: "Small", options: { Size: "Small" } }],
      }] }));
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await committedEvents();
      const key = remove.host.newRequestKey();
      const result = await Effect.runPromise(remove.host.run(key, remove.root, ["prod_logical_hard_delete"]));
      const afterRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const afterEvents = await committedEvents();
      expect(afterRows).toHaveLength(beforeRows.length);
      const beforeVersions = new Map(beforeRows.map(row => [rowIdentity(row), row.commitSeq]));
      const deletedPointers = afterRows.filter(row => beforeVersions.get(rowIdentity(row)) !== row.commitSeq);
      expect(deletedPointers).toHaveLength(6);
      const revisions = await currency.persistence.drizzle.select().from(fxAppRowRevisions);
      for (const pointer of deletedPointers) expect(revisions.find(row => rowIdentity(row) === rowIdentity(pointer) &&
        row.commitSeq === pointer.commitSeq)?.isTombstone).toBe(true);
      expect(afterEvents.slice(beforeEvents.length).map(event => event.envelope.contract))
        .toEqual([catalog.product.deletedEvent]);
      expect(await Effect.runPromise(read.read(product.runtime.commands.list, {
        filters: { id: "prod_logical_hard_delete" }, config: { withDeleted: true },
      }))).toEqual([]);
      expect(await Effect.runPromise(remove.host.run(key, remove.root, ["prod_logical_hard_delete"]))).toEqual(result);
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await committedEvents()).toEqual(afterEvents);
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: "prod_logical_delete_rollback", title: "Hard Delete Rollback",
        images: [{ id: "img_logical_delete_rollback", url: "rollback.png" }],
      }] }));
      const rollbackRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const rollbackEvents = await committedEvents();
      await expect(Effect.runPromise(late.host.run(late.host.newRequestKey(), late.root,
        ["prod_logical_delete_rollback"]))).rejects.toMatchObject({ reason: "invalidInput" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(rollbackRows);
      expect(await committedEvents()).toEqual(rollbackEvents);
      await expect(Effect.runPromise(forged.host.run(forged.host.newRequestKey(), forged.root,
        ["prod_logical_delete_rollback"]))).rejects.toMatchObject({ reason: "receiptMismatch" });
      await expect(Effect.runPromise(unowned.host.run(unowned.host.newRequestKey(), unowned.root,
        ["prod_logical_delete_rollback"]))).rejects.toMatchObject({ reason: "receiptMismatch" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(rollbackRows);
      expect(await committedEvents()).toEqual(rollbackEvents);
      expect((await currency.persistence.query<{ name: string }>(
        "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
        .toEqual(currency.physicalTablesBeforeCandidate);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(remove.host.close);
      await Effect.runPromise(late.host.close);
      await Effect.runPromise(forged.host.close);
      await Effect.runPromise(unowned.host.close);
      await Effect.runPromise(read.close);
    }
  }, 120_000);

  it("creates existing tag/category memberships and deletes only their Product pivots", async () => {
    const tags = await tagHost();
    const categories = await categoryHost();
    const create = await createHost();
    const remove = await lifecycleHost("delete");
    const forged = await lifecycleHost("delete", "membership");
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [...product.hostInput.commands, product.runtime.commands.list,
        product.runtime.commands.listTags, product.runtime.commands.listCategories],
    }));
    try {
      await Effect.runPromise(tags.run(tags.newRequestKey(), {
        product_tags: [{ id: "ptag_logical_membership", value: "Logical Membership" }],
      }));
      await Effect.runPromise(categories.host.run(categories.host.newRequestKey(), categories.root,
        [{ id: "pcat_logical_membership", name: "Logical Membership" }]));
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await committedEvents();
      const refusalReasons: string[] = [];
      for (const [id, tagIds, categoryIds] of [
        ["prod_missing_tag_membership", ["ptag_missing_membership"], ["pcat_logical_membership"]],
        ["prod_missing_category_membership", ["ptag_logical_membership"], ["pcat_missing_membership"]],
        ["prod_duplicate_tag_membership", ["ptag_logical_membership", "ptag_logical_membership"], ["pcat_logical_membership"]],
      ] as const) {
        const outcome = await Effect.runPromise(Effect.result(create.run(create.newRequestKey(), { products: [{
          id, title: id, tag_ids: [...tagIds], category_ids: [...categoryIds],
        }] })));
        if (Result.isSuccess(outcome)) throw new Error("Accepted an invalid Product membership: " + id);
        refusalReasons.push(outcome.failure.reason);
      }
      expect(refusalReasons).toEqual(["rollbackOnly", "invalidInput", "rollbackOnly"]);
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await committedEvents()).toEqual(beforeEvents);
      const input = { products: [{ id: "prod_logical_membership", title: "Membership Product",
        tag_ids: ["ptag_logical_membership"], category_ids: ["pcat_logical_membership"] }] };
      const createKey = create.newRequestKey();
      const created = await Effect.runPromise(create.run(createKey, input));
      expect(created).toMatchObject({ products: [{ id: "prod_logical_membership",
        tags: [{ id: "ptag_logical_membership" }], categories: [{ id: "pcat_logical_membership" }] }] });
      const afterCreate = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      expect(afterCreate).toHaveLength(beforeRows.length + 3);
      const createdEvents = await committedEvents();
      expect(createdEvents.slice(beforeEvents.length).map(event => event.envelope.contract))
        .toEqual([catalog.product.createdEvent]);
      expect(await Effect.runPromise(read.read(product.runtime.commands.list, {
        filters: { id: "prod_logical_membership" }, config: { relations: ["tags", "categories"] },
      }))).toMatchObject([{ tags: [{ id: "ptag_logical_membership" }],
        categories: [{ id: "pcat_logical_membership" }] }]);
      expect(await Effect.runPromise(create.run(createKey, input))).toEqual(created);
      await expect(Effect.runPromise(forged.host.run(forged.host.newRequestKey(), forged.root,
        ["prod_logical_membership"]))).rejects.toMatchObject({ reason: "receiptMismatch" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterCreate);
      expect(await committedEvents()).toEqual(createdEvents);
      const deleteKey = remove.host.newRequestKey();
      await Effect.runPromise(remove.host.run(deleteKey, remove.root, ["prod_logical_membership"]));
      const afterDelete = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      expect(afterDelete).toHaveLength(afterCreate.length);
      const prior = new Map(afterCreate.map(row => [rowIdentity(row), row.commitSeq]));
      const changed = afterDelete.filter(row => prior.get(rowIdentity(row)) !== row.commitSeq);
      expect(changed).toHaveLength(3);
      const revisions = await currency.persistence.drizzle.select().from(fxAppRowRevisions);
      for (const pointer of changed) expect(revisions.find(row => rowIdentity(row) === rowIdentity(pointer) &&
        row.commitSeq === pointer.commitSeq)?.isTombstone).toBe(true);
      expect((await committedEvents()).slice(beforeEvents.length).map(event => event.envelope.contract))
        .toEqual([catalog.product.createdEvent, catalog.product.deletedEvent]);
      expect(await Effect.runPromise(read.read(product.runtime.commands.list, {
        filters: { id: "prod_logical_membership" }, config: { withDeleted: true },
      }))).toEqual([]);
      expect(await Effect.runPromise(read.read(product.runtime.commands.listTags, {
        filters: { id: "ptag_logical_membership" },
      }))).toMatchObject([{ id: "ptag_logical_membership" }]);
      expect(await Effect.runPromise(read.read(product.runtime.commands.listCategories, {
        filters: { id: "pcat_logical_membership" },
      }))).toMatchObject({ payload: [{ id: "pcat_logical_membership" }] });
      await Effect.runPromise(remove.host.run(deleteKey, remove.root, ["prod_logical_membership"]));
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterDelete);
      expect((await currency.persistence.query<{ name: string }>(
        "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
        .toEqual(currency.physicalTablesBeforeCandidate);
    } finally {
      await Effect.runPromise(tags.close);
      await Effect.runPromise(categories.host.close);
      await Effect.runPromise(create.close);
      await Effect.runPromise(remove.host.close);
      await Effect.runPromise(forged.host.close);
      await Effect.runPromise(read.close);
    }
  }, 120_000);

  it("updates one Product and its memberships beyond unrelated shared rows", async () => {
    const tags = await tagHost();
    const categories = await categoryHost();
    const create = await createHost();
    const update = await updateHost();
    const tagRelation = catalog.queryRelations.get(catalog.product.table.name)?.get("tags");
    if (tagRelation?.join.type !== "manyToMany") throw new Error("Missing Product tag pivot");
    const tagPivot = tagRelation.join;
    const productColumn = tagPivot.sourceColumns[0], tagColumn = tagPivot.targetColumns[0];
    if (productColumn === undefined || tagColumn === undefined) throw new Error("Missing Product tag columns");
    const seed = defineCommerceCommand("logicalProductUpdateSeed", "write", Effect.fn("ProductTest.seedUnrelatedGraph")(function* (ctx, input) {
      if (typeof input !== "number" || !Number.isInteger(input) || input < 0 || input >= 260 || input % 20 !== 0)
        return yield* ctx.refuse(commerceError("invalidInput"));
      const start = input;
      const products = Array.from({ length: 20 }, (_, index) => ({
        id: `prod_logical_update_unrelated_${start + index}`, title: "Unrelated Product",
        handle: `logical-update-unrelated-${start + index}`,
      }));
      yield* (yield* ctx.table(catalog.product.table.name)).write(ctx.manager, "insert", products);
      yield* (yield* ctx.table(tagPivot.pivotTable)).write(ctx.manager, "insert", products.map(row => ({
        [productColumn]: row.id, [tagColumn]: "ptag_logical_update_old",
      })));
      return null;
    }));
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [...product.hostInput.commands, product.runtime.commands.list,
        product.runtime.commands.listTags, product.runtime.commands.listCategories, seed],
    }));
    try {
      await Effect.runPromise(tags.run(tags.newRequestKey(), { product_tags: [
        { id: "ptag_logical_update_old", value: "Old update tag" },
        { id: "ptag_logical_update_new", value: "New update tag" },
      ] }));
      await Effect.runPromise(categories.host.run(categories.host.newRequestKey(), categories.root, [
        { id: "pcat_logical_update_old", name: "Old update category" },
        { id: "pcat_logical_update_new", name: "New update category" },
      ]));
      const created = await Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: "prod_logical_selected_update", title: "Before update",
        tag_ids: ["ptag_logical_update_old"], category_ids: ["pcat_logical_update_old"],
      }, { id: "prod_logical_foreign_update", title: "Foreign update",
        options: [{ title: "Size", values: ["Small"] }],
      }] }));
      const foreignProduct = isJsonObject(created) && Array.isArray(created.products) ? created.products[1] : undefined;
      const foreignOption = isJsonObject(foreignProduct) && Array.isArray(foreignProduct.options)
        ? foreignProduct.options[0] : undefined;
      if (!isJsonObject(foreignOption) || typeof foreignOption.id !== "string")
        throw new Error("Missing foreign Product option");
      for (let start = 0; start < 260; start += 20)
        await Effect.runPromise(read.run(read.newRequestKey(), seed, start));
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await committedEvents();
      const beforeTargets = [
        await Effect.runPromise(read.read(product.runtime.commands.listTags,
          { filters: { id: ["ptag_logical_update_old", "ptag_logical_update_new"] } })),
        await Effect.runPromise(read.read(product.runtime.commands.listCategories,
          { filters: { id: ["pcat_logical_update_old", "pcat_logical_update_new"] } })),
      ];
      const input = { id: "prod_logical_selected_update", data: { title: "After update",
        tag_ids: ["ptag_logical_update_new"], category_ids: ["pcat_logical_update_new"] } };
      const key = update.host.newRequestKey();
      const result = await Effect.runPromise(update.host.run(key, update.root, input));
      expect(result).toMatchObject({ id: input.id, title: "After update",
        tags: [{ id: "ptag_logical_update_new" }], categories: [{ id: "pcat_logical_update_new" }] });
      const afterRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const afterEvents = await committedEvents();
      expect(afterRows).toHaveLength(beforeRows.length + 2);
      expect(afterEvents.slice(beforeEvents.length).map(event => event.envelope.contract))
        .toEqual([catalog.product.updatedEvent]);
      expect(await Effect.runPromise(read.read(product.runtime.commands.list, {
        filters: { id: input.id }, config: { relations: ["tags", "categories"] },
      }))).toMatchObject([{ id: input.id, title: "After update",
        tags: [{ id: "ptag_logical_update_new" }], categories: [{ id: "pcat_logical_update_new" }] }]);
      expect([
        await Effect.runPromise(read.read(product.runtime.commands.listTags,
          { filters: { id: ["ptag_logical_update_old", "ptag_logical_update_new"] } })),
        await Effect.runPromise(read.read(product.runtime.commands.listCategories,
          { filters: { id: ["pcat_logical_update_old", "pcat_logical_update_new"] } })),
      ]).toEqual(beforeTargets);
      expect(await Effect.runPromise(update.host.run(key, update.root, input))).toEqual(result);
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await committedEvents()).toEqual(afterEvents);
      await expect(Effect.runPromise(update.host.run(update.host.newRequestKey(), update.root, {
        id: input.id, data: { tag_ids: ["ptag_logical_update_missing"] },
      }))).rejects.toMatchObject({ reason: "adapterFailure" });
      await expect(Effect.runPromise(update.host.run(update.host.newRequestKey(), update.root, {
        id: input.id, data: { options: [{ id: foreignOption.id, title: "Size", values: ["Small"] }] },
      }))).rejects.toMatchObject({ reason: "invalidInput" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await committedEvents()).toEqual(afterEvents);
      expect((await currency.persistence.query<{ name: string }>(
        "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
        .toEqual(currency.physicalTablesBeforeCandidate);
    } finally {
      await Effect.runPromise(tags.close);
      await Effect.runPromise(categories.host.close);
      await Effect.runPromise(create.close);
      await Effect.runPromise(update.host.close);
      await Effect.runPromise(read.close);
    }
  }, 180_000);

  it("replaces native Product images with ranked events and one settlement", async () => {
    const create = await createHost();
    const update = await updateHost();
    const pendingUpdate = await updateHost(false, "images");
    const forged = await updateHost("image");
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [...product.hostInput.commands, product.runtime.commands.list],
    }));
    try {
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: "prod_logical_image_update", title: "Image update",
        images: [{ id: "img_logical_update_a", url: "a.png" },
          { id: "img_logical_update_b", url: "b.png" }],
      }, { id: "prod_logical_image_foreign", title: "Foreign image",
        images: [{ id: "img_logical_update_foreign", url: "foreign.png" }],
      }] }));
      const beforeEvents = await committedEvents();
      const reorder = { id: "prod_logical_image_update", data: { images: [
        { id: "img_logical_update_b", url: "b.png" },
        { id: "img_logical_update_a", url: "a.png" },
      ] } };
      const reorderKey = pendingUpdate.host.newRequestKey();
      const reordered = await Effect.runPromise(pendingUpdate.host.run(reorderKey, pendingUpdate.root, reorder));
      expect(reordered).toMatchObject({ updated: { id: reorder.id, images: [
        { id: "img_logical_update_b", rank: 0 }, { id: "img_logical_update_a", rank: 1 },
      ] }, pending: [{ images: [
        { id: "img_logical_update_b", rank: 0 }, { id: "img_logical_update_a", rank: 1 },
      ] }] });
      expect((await committedEvents()).slice(beforeEvents.length).map(event => event.envelope.contract).sort())
        .toEqual([catalog.product.updatedEvent, catalog.image.updatedEvent, catalog.image.updatedEvent].sort());
      expect(await Effect.runPromise(pendingUpdate.host.run(reorderKey, pendingUpdate.root, reorder))).toEqual(reordered);
      expect(await Effect.runPromise(read.read(product.runtime.commands.list, {
        filters: { id: reorder.id }, config: { relations: ["images"] },
      }))).toMatchObject([{ images: [
        { id: "img_logical_update_b", rank: 0 }, { id: "img_logical_update_a", rank: 1 },
      ] }]);
      const replace = { id: reorder.id, data: { images: [
        { id: "img_logical_update_b", url: "b.png" }, { id: "img_logical_update_new", url: "new.png" },
      ] } };
      const replaced = await Effect.runPromise(update.host.run(update.host.newRequestKey(), update.root, replace));
      expect(replaced).toMatchObject({ images: [
        { id: "img_logical_update_b", rank: 0 }, { id: "img_logical_update_new", rank: 1 },
      ] });
      const afterReplace = await committedEvents();
      expect(afterReplace.slice(beforeEvents.length + 3).map(event => event.envelope.contract).sort())
        .toEqual([catalog.product.updatedEvent, catalog.image.createdEvent, catalog.image.deletedEvent].sort());
      const cleared = await Effect.runPromise(update.host.run(update.host.newRequestKey(), update.root,
        { id: reorder.id, data: { images: [] } }));
      expect(cleared).toMatchObject({ images: [] });
      expect((await committedEvents()).slice(afterReplace.length).map(event => event.envelope.contract).sort())
        .toEqual([catalog.product.updatedEvent, catalog.image.deletedEvent, catalog.image.deletedEvent].sort());
      expect(await Effect.runPromise(read.read(product.runtime.commands.list, {
        filters: { id: reorder.id }, config: { relations: ["images"] },
      }))).toMatchObject([{ images: [] }]);
      const stableRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const stableEvents = await committedEvents();
      await expect(Effect.runPromise(update.host.run(update.host.newRequestKey(), update.root, {
        id: reorder.id, data: { images: [{ id: "img_logical_update_foreign", url: "foreign.png" }] },
      }))).rejects.toMatchObject({ reason: "invalidInput" });
      await expect(Effect.runPromise(forged.host.run(forged.host.newRequestKey(), forged.root, null)))
        .rejects.toMatchObject({ reason: "receiptMismatch" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(stableRows);
      expect(await committedEvents()).toEqual(stableEvents);
      expect(await Effect.runPromise(read.read(product.runtime.commands.list, {
        filters: { id: "prod_logical_image_foreign" }, config: { relations: ["images"] },
      }))).toMatchObject([{ images: [{ id: "img_logical_update_foreign", url: "foreign.png" }] }]);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(update.host.close);
      await Effect.runPromise(pendingUpdate.host.close);
      await Effect.runPromise(forged.host.close);
      await Effect.runPromise(read.close);
    }
  }, 180_000);

  it("replaces direct Product variants with owned events and unique identifiers", async () => {
    const create = await createHost();
    const update = await updateHost(false, "variants");
    const forged = await updateHost("variant");
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [...product.hostInput.commands, product.runtime.commands.list, product.runtime.commands.listVariants],
    }));
    const productId = "prod_logical_variant_update";
    const foreignId = "prod_logical_variant_foreign";
    try {
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: productId, title: "Variant update",
        variants: [{ id: "pvar_logical_update_keep", title: "Keep", sku: "logical-sku-keep", options: {} },
          { id: "pvar_logical_update_remove", title: "Remove", sku: "logical-sku-remove", options: {} }],
      }, { id: foreignId, title: "Foreign variant",
        variants: [{ id: "pvar_logical_update_foreign", title: "Foreign", sku: "logical-sku-foreign", options: {} }],
      }] }));
      const beforeEvents = await committedEvents();
      const replacement = { id: productId, data: { variants: [
        { id: "pvar_logical_update_keep", title: "Retained", sku: "logical-sku-retained" },
        { id: "pvar_logical_update_new", title: "New", sku: "logical-sku-new" },
      ] } };
      const key = update.host.newRequestKey();
      const result = await Effect.runPromise(update.host.run(key, update.root, replacement));
      expect(result).toMatchObject({ updated: { variants: expect.arrayContaining([
        expect.objectContaining({ id: "pvar_logical_update_keep", title: "Retained", sku: "logical-sku-retained" }),
        expect.objectContaining({ id: "pvar_logical_update_new", title: "New", sku: "logical-sku-new" }),
      ]) }, pending: [{ variants: expect.arrayContaining([
        expect.objectContaining({ id: "pvar_logical_update_keep", title: "Retained" }),
        expect.objectContaining({ id: "pvar_logical_update_new", title: "New" }),
      ]) }] });
      expect((await committedEvents()).slice(beforeEvents.length).map(event => event.envelope.contract).sort())
        .toEqual([catalog.product.updatedEvent, catalog.variant.updatedEvent,
          catalog.variant.createdEvent, catalog.variant.deletedEvent].sort());
      expect(await Effect.runPromise(update.host.run(key, update.root, replacement))).toEqual(result);
      expect(await Effect.runPromise(read.read(product.runtime.commands.list,
        { filters: { id: productId }, config: { relations: ["variants"] } })))
        .toMatchObject([{ variants: expect.arrayContaining([
          expect.objectContaining({ id: "pvar_logical_update_keep", title: "Retained" }),
          expect.objectContaining({ id: "pvar_logical_update_new", title: "New" }),
        ]) }]);
      expect(await Effect.runPromise(read.read(product.runtime.commands.listVariants,
        { filters: { id: "pvar_logical_update_remove" } }))).toEqual([]);
      const stableRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const stableEvents = await committedEvents();
      await expect(Effect.runPromise(update.host.run(update.host.newRequestKey(), update.root, {
        id: productId, data: { variants: [{ id: "pvar_logical_update_foreign", title: "Stolen" }] },
      }))).rejects.toMatchObject({ reason: "invalidInput" });
      await expect(Effect.runPromise(update.host.run(update.host.newRequestKey(), update.root, {
        id: productId, data: { variants: [{ id: "pvar_logical_update_keep", sku: "logical-sku-foreign" },
          { id: "pvar_logical_update_new" }] },
      }))).rejects.toMatchObject({ reason: "rollbackOnly" });
      await expect(Effect.runPromise(forged.host.run(forged.host.newRequestKey(), forged.root, null)))
        .rejects.toMatchObject({ reason: "receiptMismatch" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(stableRows);
      expect(await committedEvents()).toEqual(stableEvents);
      expect(await Effect.runPromise(read.read(product.runtime.commands.list,
        { filters: { id: foreignId }, config: { relations: ["variants"] } })))
        .toMatchObject([{ variants: [{ id: "pvar_logical_update_foreign", sku: "logical-sku-foreign" }] }]);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(update.host.close);
      await Effect.runPromise(forged.host.close);
      await Effect.runPromise(read.close);
    }
  }, 180_000);

  it("replaces Product option values using authenticated unchanged Option ancestry", async () => {
    const create = await createHost();
    const update = await updateHost(false, "options.values");
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [...product.hostInput.commands, product.runtime.commands.list],
    }));
    let forged: Awaited<ReturnType<typeof updateHost>> | undefined;
    const productId = "prod_logical_option_update";
    try {
      const created = await Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: productId, title: "Option update",
        options: [{ title: "Size", values: ["Small", "Large"] }],
      }, { id: "prod_logical_option_foreign", title: "Foreign option",
        options: [{ title: "Size", values: ["XL"] }],
      }] }));
      if (!isJsonObject(created) || !Array.isArray(created.products)) throw new Error("Missing created Product graph");
      const optionFor = (position: number) => {
        const productRow = created.products[position];
        if (productRow === undefined || !isJsonObject(productRow) || !Array.isArray(productRow.options) ||
          productRow.options[0] === undefined || !isJsonObject(productRow.options[0]) ||
          typeof productRow.options[0].id !== "string")
          throw new Error("Missing created Product Option");
        return productRow.options[0].id;
      };
      const ownedOptionId = optionFor(0), foreignOptionId = optionFor(1);
      forged = await updateHost("value", undefined, foreignOptionId);
      const beforeEvents = await committedEvents();
      const replacement = { id: productId, data: { options: [{
        id: ownedOptionId, title: "Size", values: ["Small", "Medium"],
      }] } };
      const key = update.host.newRequestKey();
      const result = await Effect.runPromise(update.host.run(key, update.root, replacement));
      expect(result).toMatchObject({ updated: { options: [{ id: ownedOptionId,
        values: expect.arrayContaining([
          expect.objectContaining({ value: "Small" }), expect.objectContaining({ value: "Medium" }),
        ]) }] }, pending: [{ options: [{ id: ownedOptionId,
        values: expect.arrayContaining([
          expect.objectContaining({ value: "Small" }), expect.objectContaining({ value: "Medium" }),
        ]) }] }] });
      expect((await committedEvents()).slice(beforeEvents.length).map(event => event.envelope.contract).sort())
        .toEqual([catalog.product.updatedEvent,
          catalog.value.createdEvent, catalog.value.deletedEvent].sort());
      expect(await Effect.runPromise(update.host.run(key, update.root, replacement))).toEqual(result);
      expect(await Effect.runPromise(read.read(product.runtime.commands.list, {
        filters: { id: productId }, config: { relations: ["options.values"] },
      }))).toMatchObject([{ options: [{ id: ownedOptionId,
        values: expect.arrayContaining([
          expect.objectContaining({ value: "Small" }), expect.objectContaining({ value: "Medium" }),
        ]) }] }]);
      const afterValueEvents = await committedEvents();
      const replaceOption = { id: productId, data: { options: [{ title: "Color", values: ["Red"] }] } };
      const optionKey = update.host.newRequestKey();
      const replaced = await Effect.runPromise(update.host.run(optionKey, update.root, replaceOption));
      expect(replaced).toMatchObject({ updated: { options: [{ title: "Color",
        values: [{ value: "Red" }] }] }, pending: [{ options: [{ title: "Color",
        values: [{ value: "Red" }] }] }] });
      expect((await committedEvents()).slice(afterValueEvents.length).map(event => event.envelope.contract).sort())
        .toEqual([catalog.product.updatedEvent, catalog.option.createdEvent, catalog.option.deletedEvent,
          catalog.value.createdEvent, catalog.value.deletedEvent, catalog.value.deletedEvent].sort());
      expect(await Effect.runPromise(update.host.run(optionKey, update.root, replaceOption))).toEqual(replaced);
      expect(await Effect.runPromise(read.read(product.runtime.commands.list, {
        filters: { id: productId }, config: { relations: ["options.values"] },
      }))).toMatchObject([{ options: [{ title: "Color", values: [{ value: "Red" }] }] }]);
      const stableRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const stableEvents = await committedEvents();
      await expect(Effect.runPromise(update.host.run(update.host.newRequestKey(), update.root, {
        id: productId, data: { options: [{ id: foreignOptionId, title: "Size", values: ["XL"] }] },
      }))).rejects.toMatchObject({ reason: "invalidInput" });
      await expect(Effect.runPromise(forged.host.run(forged.host.newRequestKey(), forged.root, null)))
        .rejects.toMatchObject({ reason: "receiptMismatch" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(stableRows);
      expect(await committedEvents()).toEqual(stableEvents);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(update.host.close);
      if (forged !== undefined) await Effect.runPromise(forged.host.close);
      await Effect.runPromise(read.close);
    }
  }, 180_000);
});
