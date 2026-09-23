import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { isJsonObject } from "flarex-protocol/json";
import { Modules, CommonEvents } from "@medusajs/framework/utils/portable";
import { productLogicalCreateEventPolicy, productLogicalDeleteEventPolicy,
  productLogicalLifecycleEventPolicy } from "../src/product-local-events";
import { prepareProductCreateWorkflow } from "../src/product-create-workflow";
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

async function lifecycleHost(operation: "softDelete" | "restore" | "delete",
  forged: "event" | "unowned" | false = false, lateRefuse = false) {
  const policy = operation === "delete" ? productLogicalDeleteEventPolicy(catalog)
    : productLogicalLifecycleEventPolicy(catalog, operation);
  const participant = defineAtomicCommerceParticipant("product");
  const commandName = operation === "delete" ? "productDeleteproduct" : operation === "restore" ? "productRestore" : "productSoftDelete";
  const command = forged === "unowned" ? defineCommerceCommand(commandName, "write", Effect.fn("ProductTest.unownedDelete")(function* (ctx) {
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
});
