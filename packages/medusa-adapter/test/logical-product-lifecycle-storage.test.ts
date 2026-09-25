import { withWorkflowPolicy } from "./support/workflow-policy-fixture";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { isJsonObject } from "flarex-protocol/json";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { createStep, createWorkflow, WorkflowResponse } from "@medusajs/workflows-sdk";
import { batchVariantImagesWorkflow } from "@medusajs/core-flows/product/batch-variant-images";
import { Modules, CommonEvents } from "@medusajs/framework/utils/portable";
import { productCallReceipts } from "../src/product-local-events";
import { prepareProductCreateWorkflow } from "../src/product-create-workflow";
import { prepareProductTagWorkflow } from "../src/product-tag-workflow";
import { prepareVariantImagesWorkflow, variantImagesWorkflowEvents } from "../src/product-variant-images-workflow";
import { VariantImagesWorkflowInput } from "../src/product-variant-workflow-input";
import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { currencyWorkflowModule } from "../src/currency-service";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/relationalTransaction/model";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/atomicCommerce/events";
import { defineCommerceCommand } from "../../persistence-postgres/src/commerceTransaction/commands";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxAppRowCurrent, fxAppRowRevisions, fxSystemCommits, fxSystemIdempotency } from "../../persistence-postgres/src/schema";
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

async function createHost(selectedCurrency = currency, selectedProduct = product) {
  return Effect.runPromise(prepareProductCreateWorkflow({
    execution: { identityAndAccessPolicy: selectedCurrency.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...selectedCurrency.hostInput, ...composition }) },
    modules: { product: { module: selectedProduct.runtime.workflow, logicalStorage: selectedProduct.hostInput.logicalStorage } },
    revision: createHash("sha256").update("logical-product-lifecycle-create").digest("hex"),
    subscribers: [{ id: "logical-product-lifecycle", revision: "a".repeat(64) }],
  }));
}

async function variantImagesHost(selectedCurrency = currency, selectedProduct = product,
  moduleEvents = selectedProduct.runtime.logicalPolicy, session = selectedCurrency.session) {
  return Effect.runPromise(prepareVariantImagesWorkflow({
    execution: { identityAndAccessPolicy: selectedCurrency.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...selectedCurrency.hostInput, session, ...composition }) },
    modules: { product: { module: withWorkflowPolicy(selectedProduct.runtime.workflow, policy => ({ ...policy, ...moduleEvents })), logicalStorage: selectedProduct.hostInput.logicalStorage } },
    revision: createHash("sha256").update("logical-product-variant-images").digest("hex"),
    subscribers: [{ id: "logical-product-variant-images", revision: "a".repeat(64) }],
  }));
}

async function categoryHost() {
  const policy = product.runtime.logicalPolicy;
  const participant = defineAtomicCommerceParticipant("product");
  const root = defineAtomicCommerceCommand("productCategoryCreateRoot", (ctx, input) =>
    ctx.call(participant, product.runtime.commands.createCategories, input));
  const revision = createHash("sha256").update("logical-product-category-create").digest("hex");
  const contract = defineCommerceEventContract({ name: catalog.category.createdEvent, revision,
    internal: true, decode: policy.capture });
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...currency.hostInput,
    identityAndAccessPolicy: { profile: "logical-product-category-create" },
    participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
      commands: [product.runtime.commands.createCategories], validateLogicalCall: policy.validateLogicalCall,
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
    modules: { product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage },
    currency: { module: Result.getOrThrow(currencyWorkflowModule), logicalStorage: currency.hostInput.logicalStorage } },
    revision: createHash("sha256").update("logical-product-membership-tag").digest("hex"),
    subscribers: [{ id: "logical-product-membership", revision: "a".repeat(64) }],
  }));
}

async function updateHost(forged: "image" | "variant" | "value" | "pivot" | "pivotVariant" | false = false,
  pendingRelation?: "images" | "variants" | "options.values" | "variants.options",
  foreignTargetId?: string, ownedValueId?: string) {
  const policy = product.runtime.logicalPolicy;
  const participant = defineAtomicCommerceParticipant("product");
  const command = forged ? defineCommerceCommand("productUpdate", "write", Effect.fn("ProductTest.forgedChildUpdate")(function* (ctx) {
    const rootId = forged === "image" ? "prod_logical_image_update"
      : forged === "variant" ? "prod_logical_variant_update"
        : forged === "pivot" || forged === "pivotVariant" ? "prod_logical_link_update" : "prod_logical_option_update";
    const foreignId = forged === "image" ? "prod_logical_image_foreign"
      : forged === "variant" ? "prod_logical_variant_foreign" : foreignTargetId;
    if (foreignId === undefined) return yield* ctx.refuse(commerceError("invalidInput"));
    if (forged === "pivot" || forged === "pivotVariant") {
      const variantId = forged === "pivot" ? "pvar_logical_link_update" : foreignId;
      const valueId = forged === "pivot" ? foreignId : ownedValueId;
      if (valueId === undefined) return yield* ctx.refuse(commerceError("invalidInput"));
      yield* (yield* ctx.table(catalog.product.table.name)).write(ctx.manager, "update",
        [{ id: rootId, title: "Forged root title" }]);
      yield* (yield* ctx.table(catalog.pivot.table.name)).write(ctx.manager, "insert", [{
        [catalog.pivot.variantColumn]: variantId, [catalog.pivot.valueColumn]: valueId,
      }]);
      yield* ctx.captureLocalEvent({ name: catalog.product.updatedEvent,
        metadata: { source: Modules.PRODUCT, object: catalog.product.eventObject, action: CommonEvents.UPDATED },
        data: { id: rootId } });
      return null;
    }
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
      commands: pendingRelation === undefined ? [command] : [command, product.runtime.commands.list], validateLogicalCall: policy.validateLogicalCall,
      events: selected }],
    commands: [root], events: { producerRevision: revision, contracts: selected.contracts,
      subscribers: [{ id: "logical-product-update", revision: "a".repeat(64) }],
      validate: events => events.some(event => !event.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  return { host, root };
}

async function lifecycleHost(operation: "softDelete" | "restore" | "delete",
  forged: "event" | "unowned" | "membership" | false = false, lateRefuse = false) {
  const policy = product.runtime.logicalPolicy;
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
      commands: [command], validateLogicalCall: policy.validateLogicalCall, events: selected }],
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

  it("runs native Variant image assignment, thumbnail and replay over logical Product storage", async () => {
    const create = await createHost();
    const images = await variantImagesHost();
    const assignments = defineCommerceCommand("productAssignmentRead", "read", ctx =>
      Effect.gen(function* () {
        const store = yield* ctx.table(catalog.assignment.table.name);
        return yield* store.find(ctx.manager, { take: 20, order: { column: "id", direction: "asc" } });
      }));
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [assignments, product.runtime.commands.listVariants],
    }));
    const selected = (value: Json) => {
      if (!Array.isArray(value) || !value.every(isJsonObject)) throw new Error("Invalid assignment rows");
      return value.filter(row => row.variant_id === "pvar_logical_images").map(row => row.image_id);
    };
    try {
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: "prod_logical_images", title: "Logical Images",
        images: [{ id: "img_logical_images_old", url: "old-url" },
          { id: "img_logical_images_new", url: "new-url" },
          { id: "img_logical_images_general", url: "general-url" }],
        variants: [{ id: "pvar_logical_images", title: "Image variant", thumbnail: "old-url", options: {} }],
      }] }));
      await Effect.runPromise(images.run(images.newRequestKey(), {
        variant_id: "pvar_logical_images", add: ["img_logical_images_old"],
      }));
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await committedEvents();
      const key = images.newRequestKey();
      const input = { variant_id: "pvar_logical_images", add: ["img_logical_images_new"],
        remove: ["img_logical_images_old"] };
      const result = await Effect.runPromise(images.run(key, input));
      expect(result).toEqual({ added: ["img_logical_images_new"], removed: ["img_logical_images_old"] });
      const afterRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      expect(afterRows).not.toEqual(beforeRows);
      expect(selected(await Effect.runPromise(read.read(assignments, null)))).toEqual(["img_logical_images_new"]);
      expect(await Effect.runPromise(read.read(product.runtime.commands.listVariants, {
        filters: { id: "pvar_logical_images" }, config: { relations: ["images"] },
      }))).toMatchObject([{ thumbnail: null, images: expect.arrayContaining([
        expect.objectContaining({ id: "img_logical_images_old" }),
        expect.objectContaining({ id: "img_logical_images_new" }),
        expect.objectContaining({ id: "img_logical_images_general" }),
      ]) }]);
      const afterEvents = await committedEvents();
      expect(afterEvents.slice(beforeEvents.length).map(event => event.envelope)).toMatchObject([{
        contract: catalog.variant.updatedEvent, internal: true, group: key,
        message: { data: { id: "pvar_logical_images" } },
      }]);
      expect(await Effect.runPromise(images.run(key, input))).toEqual(result);
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await committedEvents()).toEqual(afterEvents);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(images.close);
      await Effect.runPromise(read.close);
    }
  }, 120_000);

  it("confines colliding native Variant-image IDs to each shop on one shared target", async () => {
    const otherCurrency = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      includeProduct: true, resource: currency.resource,
      fixtureIdentity: { deploymentId: "deployment_product_images_shop_b",
        projectId: "project_product_images_shop_b", uuidOffset: 1_000 },
    });
    const otherProduct = await prepareLogicalProductHost(otherCurrency);
    await Effect.runPromise(otherProduct.host.initialize([]));
    await Effect.runPromise(otherProduct.host.close);
    const firstCreate = await createHost();
    const secondCreate = await createHost(otherCurrency, otherProduct);
    const firstImages = await variantImagesHost();
    const secondImages = await variantImagesHost(otherCurrency, otherProduct);
    const assignmentRead = defineCommerceCommand("productSharedAssignmentRead", "read", ctx =>
      Effect.gen(function* () {
        const store = yield* ctx.table(catalog.assignment.table.name);
        return yield* store.find(ctx.manager, { take: 20, order: { column: "id", direction: "asc" } });
      }));
    const firstRead = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [assignmentRead, product.runtime.commands.retrieve],
    }));
    const secondRead = await Effect.runPromise(makeCommerceHost({ ...otherProduct.hostInput,
      commands: [assignmentRead, otherProduct.runtime.commands.retrieve],
    }));
    try {
      expect(otherCurrency.persistence).toBe(currency.persistence);
      const firstScope = projectScopeIdUuidV1(currency.application.authority.scopeId).scopeUuid;
      const secondScope = projectScopeIdUuidV1(otherCurrency.application.authority.scopeId).scopeUuid;
      expect(firstScope).not.toBe(secondScope);
      const seed = (name: string) => ({ products: [{ id: "shared-image-product", title: `${name} Product`,
        images: [{ id: "shared-image-old", url: `${name}-old-url` },
          { id: "shared-image-new", url: `${name}-new-url` },
          ...(name === "first" ? [{ id: "first-only-image", url: "first-only-url" }] : [])],
        variants: [{ id: "shared-image-variant", title: "Shared variant", thumbnail: `${name}-old-url`, options: {} }],
      }] });
      await Effect.runPromise(firstCreate.run(firstCreate.newRequestKey(), seed("first")));
      await Effect.runPromise(secondCreate.run(secondCreate.newRequestKey(), seed("second")));
      for (const host of [firstImages, secondImages]) await Effect.runPromise(host.run(host.newRequestKey(), {
        variant_id: "shared-image-variant", add: ["shared-image-old"],
      }));
      const secondRowsBefore = (await currency.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === secondScope);
      const secondEventsBefore = (await committedEvents()).filter(row => row.scopeUuid === secondScope);
      const secondCommitsBefore = (await currency.persistence.drizzle.select().from(fxSystemCommits))
        .filter(row => row.scopeUuid === secondScope);
      const secondOutcomesBefore = (await currency.persistence.drizzle.select().from(fxSystemIdempotency))
        .filter(row => row.scopeUuid === secondScope);
      expect(await Effect.runPromise(firstImages.run(firstImages.newRequestKey(), {
        variant_id: "shared-image-variant", add: ["shared-image-new"], remove: ["shared-image-old"],
      }))).toEqual({ added: ["shared-image-new"], removed: ["shared-image-old"] });
      expect((await currency.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === secondScope)).toEqual(secondRowsBefore);
      expect((await committedEvents()).filter(row => row.scopeUuid === secondScope)).toEqual(secondEventsBefore);
      expect((await currency.persistence.drizzle.select().from(fxSystemCommits))
        .filter(row => row.scopeUuid === secondScope)).toEqual(secondCommitsBefore);
      expect((await currency.persistence.drizzle.select().from(fxSystemIdempotency))
        .filter(row => row.scopeUuid === secondScope)).toEqual(secondOutcomesBefore);
      await expect(Effect.runPromise(secondImages.run(secondImages.newRequestKey(), {
        variant_id: "shared-image-variant", add: ["first-only-image"],
      }))).rejects.toMatchObject({ reason: "invalidInput" });
      const secondVariant = await Effect.runPromise(secondRead.read(otherProduct.runtime.commands.retrieve, {
        id: "shared-image-product", config: { relations: ["variants.images"] },
      }));
      expect(secondVariant).toMatchObject({ variants: [{ thumbnail: "second-old-url" }] });
      const firstAssignments = await Effect.runPromise(firstRead.read(assignmentRead, null));
      const secondAssignments = await Effect.runPromise(secondRead.read(assignmentRead, null));
      if (!Array.isArray(firstAssignments) || !firstAssignments.every(isJsonObject) ||
        !Array.isArray(secondAssignments) || !secondAssignments.every(isJsonObject))
        throw new Error("Invalid scoped assignment rows");
      expect(firstAssignments.filter(row => row.variant_id === "shared-image-variant")
        .map(row => row.image_id)).toEqual(["shared-image-new"]);
      expect(secondAssignments.filter(row => row.variant_id === "shared-image-variant")
        .map(row => row.image_id)).toEqual(["shared-image-old"]);
    } finally {
      await Effect.runPromise(firstCreate.close);
      await Effect.runPromise(secondCreate.close);
      await Effect.runPromise(firstImages.close);
      await Effect.runPromise(secondImages.close);
      await Effect.runPromise(firstRead.close);
      await Effect.runPromise(secondRead.close);
    }
  }, 180_000);

  it("preserves duplicate, same-scope cross-Product, empty call and nonmatching thumbnail behavior", async () => {
    const create = await createHost();
    const images = await variantImagesHost();
    const assignments = defineCommerceCommand("productAssignmentRead", "read", ctx =>
      Effect.gen(function* () {
        const store = yield* ctx.table(catalog.assignment.table.name);
        return yield* store.find(ctx.manager, { take: 20, order: { column: "id", direction: "asc" } });
      }));
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [assignments, product.runtime.commands.listVariants],
    }));
    try {
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: "prod_logical_images_repeat", title: "Logical Repeated Images",
        images: [{ id: "img_logical_images_repeat", url: "repeat-url" }],
        variants: [{ id: "pvar_logical_images_repeat", title: "Repeat variant", thumbnail: "other-url", options: {} }],
      }, {
        id: "prod_logical_images_neighbor", title: "Neighbor Images",
        images: [{ id: "img_logical_images_neighbor", url: "neighbor-url" }],
      }] }));
      const beforeEvents = await committedEvents();
      for (let repeat = 0; repeat < 2; repeat++) {
        expect(await Effect.runPromise(images.run(images.newRequestKey(), {
          variant_id: "pvar_logical_images_repeat", add: ["img_logical_images_repeat"],
        }))).toEqual({ added: ["img_logical_images_repeat"], removed: [] });
      }
      const rows = await Effect.runPromise(read.read(assignments, null));
      if (!Array.isArray(rows) || !rows.every(isJsonObject)) throw new Error("Invalid assignment rows");
      expect(rows.filter(row => row.variant_id === "pvar_logical_images_repeat" &&
        row.image_id === "img_logical_images_repeat")).toHaveLength(2);
      // The pinned service permits same-scope endpoints from different Products.
      expect(await Effect.runPromise(images.run(images.newRequestKey(), {
        variant_id: "pvar_logical_images_repeat", add: ["img_logical_images_neighbor"],
      }))).toEqual({ added: ["img_logical_images_neighbor"], removed: [] });
      const beforeRefusal = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      await expect(Effect.runPromise(images.run(images.newRequestKey(), {
        variant_id: "pvar_logical_images_repeat", add: ["missing-image"],
      }))).rejects.toMatchObject({ reason: "invalidInput" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRefusal);
      expect(await Effect.runPromise(images.run(images.newRequestKey(), {
        variant_id: "pvar_logical_images_repeat", remove: ["missing-image"],
      }))).toEqual({ added: [], removed: ["missing-image"] });
      expect(await Effect.runPromise(images.run(images.newRequestKey(), {
        variant_id: "missing-variant",
      }))).toEqual({ added: [], removed: [] });
      expect(await Effect.runPromise(read.read(product.runtime.commands.listVariants, {
        filters: { id: "pvar_logical_images_repeat" }, config: { relations: [] },
      }))).toMatchObject([{ thumbnail: "other-url" }]);
      expect(await committedEvents()).toEqual(beforeEvents);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(images.close);
      await Effect.runPromise(read.close);
    }
  }, 120_000);

  it("uses requested image URLs without an assignment and refuses malformed native selections", async () => {
    const create = await createHost();
    const images = await variantImagesHost();
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [product.runtime.commands.listVariants],
    }));
    try {
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: "prod_logical_image_requests", title: "Requested Image URLs",
        images: [{ id: "img_logical_image_general", url: "general-url" },
          { id: "img_logical_image_other", url: "other-url" }],
        variants: [{ id: "pvar_logical_image_requests", title: "Requested variant",
          thumbnail: "general-url", options: {} },
          { id: "pvar_logical_image_null", title: "Null thumbnail", thumbnail: null, options: {} }],
      }] }));
      const beforeEvents = await committedEvents();
      expect(await Effect.runPromise(images.run(images.newRequestKey(), {
        variant_id: "pvar_logical_image_requests", remove: ["img_logical_image_general", "missing-image"],
      }))).toEqual({ added: [], removed: ["img_logical_image_general", "missing-image"] });
      expect(await Effect.runPromise(read.read(product.runtime.commands.listVariants, {
        filters: { id: "pvar_logical_image_requests" }, config: { relations: [] },
      }))).toMatchObject([{ thumbnail: null }]);
      const afterEvents = await committedEvents();
      expect(afterEvents.slice(beforeEvents.length).map(row => row.envelope.contract))
        .toEqual([catalog.variant.updatedEvent]);
      expect(await Effect.runPromise(images.run(images.newRequestKey(), {
        variant_id: "pvar_logical_image_requests", remove: ["missing-image"],
      }))).toEqual({ added: [], removed: ["missing-image"] });
      expect(await Effect.runPromise(images.run(images.newRequestKey(), {
        variant_id: "pvar_logical_image_null", remove: ["img_logical_image_other"],
      }))).toEqual({ added: [], removed: ["img_logical_image_other"] });
      expect(await committedEvents()).toEqual(afterEvents);
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      for (const input of [
        { variant_id: "pvar_logical_image_requests", add: ["img_logical_image_other", "img_logical_image_other"] },
        { variant_id: "pvar_logical_image_requests", add: ["img_logical_image_other"], remove: ["img_logical_image_other"] },
        { variant_id: "pvar_logical_image_requests", add: ["missing-image"] },
        { variant_id: "missing-variant", add: ["img_logical_image_other"] },
        { variant_id: "", add: [] },
        { variant_id: "pvar_logical_image_requests", add: ["img_logical_image_other"], extra: true },
      ]) {
        await expect(Effect.runPromise(images.run(images.newRequestKey(), input)))
          .rejects.toBeDefined();
        expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
        expect(await committedEvents()).toEqual(afterEvents);
      }
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(images.close);
      await Effect.runPromise(read.close);
    }
  }, 120_000);

  it("rolls back native Variant-image writes when output decoding or caught graph use fails", async () => {
    const create = await createHost();
    const images = await variantImagesHost();
    const resources = Result.getOrThrow(prepareWorkflowResources({ product: { module: product.runtime.workflow,
      methods: ["addImageToVariant", "removeImageFromVariant", "listProductVariants", "updateProductVariants"], graph: true,
    } }, true));
    const invalid = await Effect.runPromise(prepareAtomicWorkflowHost({
      execution: { identityAndAccessPolicy: currency.hostInput.identityAndAccessPolicy,
        prepare: composition => makeAtomicCommerceHost({ ...currency.hostInput, ...composition }) },
      modules: { product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage } },
      revision: createHash("sha256").update("logical-product-variant-images-invalid-output").digest("hex"),
      subscribers: [{ id: "logical-product-variant-images", revision: "a".repeat(64) }],
      workflow: { name: "invalidVariantImagesOutput", resources,
        prepared: Result.getOrThrow(batchVariantImagesWorkflow.prepare()),
        input: VariantImagesWorkflowInput, output: Schema.Null, events: variantImagesWorkflowEvents },
    }));
    try {
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: "prod_logical_image_rollback", title: "Rollback Images",
        images: [{ id: "img_logical_image_rollback_old", url: "rollback-old" },
          { id: "img_logical_image_rollback_new", url: "rollback-new" }],
        variants: [{ id: "pvar_logical_image_rollback", title: "Rollback variant",
          thumbnail: "rollback-old", options: {} }],
      }] }));
      await Effect.runPromise(images.run(images.newRequestKey(), {
        variant_id: "pvar_logical_image_rollback", add: ["img_logical_image_rollback_old"],
      }));
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await committedEvents();
      await expect(Effect.runPromise(invalid.run(invalid.newRequestKey(), {
        variant_id: "pvar_logical_image_rollback", add: ["img_logical_image_rollback_new"],
        remove: ["img_logical_image_rollback_old"],
      }))).rejects.toMatchObject({ reason: "storedCorruption" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await committedEvents()).toEqual(beforeEvents);
      const caughtResources = Result.getOrThrow(prepareWorkflowResources({ product: { module: product.runtime.workflow,
        methods: ["addImageToVariant"], graph: true,
      } }, false));
      const call = createStep("caught-extra-variant-graph-arguments", caughtResources.callback(async (_: unknown, context) => {
        await context.resources.product.addImageToVariant([{
          variant_id: "pvar_logical_image_rollback", image_id: "img_logical_image_rollback_new",
        }]);
        await Reflect.apply(context.resources.query.graph, undefined,
          [{ entity: "variant", fields: ["id"], pagination: { take: 1 } }, {}]).catch(() => undefined);
        return null;
      }));
      const flow = createWorkflow("caught-extra-variant-graph", () => new WorkflowResponse(call(undefined)));
      const caught = await Effect.runPromise(prepareAtomicWorkflowHost({
        execution: { identityAndAccessPolicy: currency.hostInput.identityAndAccessPolicy,
          prepare: composition => makeAtomicCommerceHost({ ...currency.hostInput, ...composition }) },
        modules: { product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage } },
        revision: createHash("sha256").update("logical-product-variant-images-caught-graph").digest("hex"),
        workflow: { name: "caughtVariantGraph", resources: caughtResources,
          prepared: Result.getOrThrow(flow.prepare()), input: Schema.Null, output: Schema.Null },
      }));
      try {
        const exit = await Effect.runPromise(Effect.exit(caught.run(caught.newRequestKey(), null)));
        if (!Exit.isFailure(exit)) throw new Error("Expected sticky graph refusal");
        expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) &&
          reason.error.reason === "unsupportedProfile")).toBe(true);
        expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
        expect(await committedEvents()).toEqual(beforeEvents);
      } finally { await Effect.runPromise(caught.close); }
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(images.close);
      await Effect.runPromise(invalid.close);
    }
  }, 120_000);

  it("drains cancelled Variant-image writes and recovers an uncertain commit without repeating validation", async () => {
    const create = await createHost();
    const images = await variantImagesHost();
    const reached = await Effect.runPromise(Deferred.make<void>());
    const policy = product.runtime.logicalPolicy;
    const cancelled = await variantImagesHost(currency, product, { ...policy,
      validateLogicalCall: (...args) => policy.validateLogicalCall(...args).pipe(
        Effect.andThen(args[0].mode === "write" && args[1].mutations.length > 0
          ? Deferred.succeed(reached, undefined).pipe(Effect.andThen(Effect.never)) : Effect.void)),
    });
    try {
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: "prod_logical_images_recovery", title: "Recover Variant Images",
        images: [{ id: "img_logical_recovery_old", url: "recovery-old" },
          { id: "img_logical_recovery_new", url: "recovery-new" }],
        variants: [{ id: "pvar_logical_images_recovery", title: "Recovery variant",
          thumbnail: "recovery-old", options: {} }],
      }] }));
      await Effect.runPromise(images.run(images.newRequestKey(), {
        variant_id: "pvar_logical_images_recovery", add: ["img_logical_recovery_old"],
      }));
      const input = { variant_id: "pvar_logical_images_recovery",
        add: ["img_logical_recovery_new"], remove: ["img_logical_recovery_old"] };
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await committedEvents();
      const beforeCommits = await currency.persistence.drizzle.select().from(fxSystemCommits);
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(cancelled.run(cancelled.newRequestKey(), input));
        yield* Deferred.await(reached).pipe(Effect.timeout(5000));
        yield* Fiber.interrupt(fiber);
      })));
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await committedEvents()).toEqual(beforeEvents);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommits)).toEqual(beforeCommits);
      let loseAcknowledgement = true;
      let validations = 0;
      const session = issueRelationalSession(currency.persistence.drizzle, (profile, work) =>
        runRelationalSession(currency.session, profile, work).pipe(
          Effect.catchTag("RelationalTransactionError", cause =>
            Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
          Effect.flatMap(value => {
            if (!loseAcknowledgement) return Effect.succeed(value);
            loseAcknowledgement = false;
            return Effect.fail(new RelationalSessionError({
              reason: "decisionUncertain", cause: "lost logical Variant-image acknowledgement",
            }));
          }),
        ));
      const recovering = await variantImagesHost(currency, product, { ...policy,
        validateLogicalCall: (...args) => policy.validateLogicalCall(...args).pipe(
          Effect.tap(() => Effect.sync(() => { validations++; }))),
      }, session);
      try {
        const key = recovering.newRequestKey();
        const result = { added: ["img_logical_recovery_new"], removed: ["img_logical_recovery_old"] };
        expect(await Effect.runPromise(recovering.run(key, input))).toEqual(result);
        const afterRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
        const afterEvents = await committedEvents();
        const afterCommits = await currency.persistence.drizzle.select().from(fxSystemCommits);
        expect(validations).toBe(6);
        expect(afterCommits).toHaveLength(beforeCommits.length + 1);
        expect(afterEvents).toHaveLength(beforeEvents.length + 1);
        expect(await Effect.runPromise(recovering.run(key, input))).toEqual(result);
        expect(validations).toBe(6);
        expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
        expect(await committedEvents()).toEqual(afterEvents);
        expect(await currency.persistence.drizzle.select().from(fxSystemCommits)).toEqual(afterCommits);
      } finally { await Effect.runPromise(recovering.close); }
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(images.close);
      await Effect.runPromise(cancelled.close);
    }
  }, 120_000);

  it.skipIf(driver !== "postgres")("isolates pending Variant-image writes and settles duplicate request keys once", async () => {
    const create = await createHost();
    const images = await variantImagesHost();
    try {
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: "prod_logical_images_concurrent", title: "Concurrent Variant Images",
        images: [{ id: "img_logical_concurrent_old", url: "concurrent-old" },
          { id: "img_logical_concurrent_new", url: "concurrent-new" }],
        variants: [{ id: "pvar_logical_images_concurrent", title: "Concurrent variant",
          thumbnail: "concurrent-old", options: {} }],
      }] }));
      await Effect.runPromise(images.run(images.newRequestKey(), {
        variant_id: "pvar_logical_images_concurrent", add: ["img_logical_concurrent_old"],
      }));
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await committedEvents();
      const beforeCommits = await currency.persistence.drizzle.select().from(fxSystemCommits);
      let observed = false;
      const policy = product.runtime.logicalPolicy;
      const concurrent = await variantImagesHost(currency, product, { ...policy,
        validateLogicalCall: (...args) => policy.validateLogicalCall(...args).pipe(Effect.andThen(Effect.promise(async () => {
          observed = true;
          expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
          expect(await committedEvents()).toEqual(beforeEvents);
        }))),
      });
      try {
        const key = concurrent.newRequestKey();
        const input = { variant_id: "pvar_logical_images_concurrent",
          add: ["img_logical_concurrent_new"], remove: ["img_logical_concurrent_old"] };
        const result = { added: ["img_logical_concurrent_new"], removed: ["img_logical_concurrent_old"] };
        expect(await Promise.all([Effect.runPromise(concurrent.run(key, input)),
          Effect.runPromise(concurrent.run(key, input))])).toEqual([result, result]);
        expect(observed).toBe(true);
        expect(await currency.persistence.drizzle.select().from(fxSystemCommits))
          .toHaveLength(beforeCommits.length + 1);
        expect(await committedEvents()).toHaveLength(beforeEvents.length + 1);
      } finally { await Effect.runPromise(concurrent.close); }
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(images.close);
    }
  }, 120_000);

  it("rolls back an extra silent assignment outside the native call result", async () => {
    const create = await createHost();
    const policy = product.runtime.logicalPolicy;
    const participant = defineAtomicCommerceParticipant("product");
    const command = defineCommerceCommand("productCreateassignment", "write", ctx =>
      Effect.gen(function* () {
        const store = yield* ctx.table(catalog.assignment.table.name);
        yield* store.write(ctx.manager, "insert", [
          { id: "pvpi_logical_forged_one", variant_id: "pvar_logical_images_forged", image_id: "img_logical_images_forged" },
          { id: "pvpi_logical_forged_two", variant_id: "pvar_logical_images_forged", image_id: "img_logical_images_forged" },
        ]);
        return [{ id: "pvpi_logical_forged_one" }];
      }));
    const root = defineAtomicCommerceCommand("productAssignmentForgery", (ctx, input) =>
      ctx.call(participant, command, input));
    const revision = createHash("sha256").update("logical-product-variant-images-forgery").digest("hex");
    const contract = defineCommerceEventContract({ name: catalog.variant.updatedEvent, revision,
      internal: true, decode: policy.capture });
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...currency.hostInput,
      identityAndAccessPolicy: { profile: "logical-product-variant-images-forgery" },
      participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
        commands: [command], validateLogicalCall: policy.validateLogicalCall,
        events: { contracts: [contract], select: () => Effect.succeed(contract) } }],
      commands: [root], events: { producerRevision: revision, contracts: [contract],
        subscribers: [{ id: "logical-product-variant-images-forgery", revision: "a".repeat(64) }],
        validate: () => Effect.void },
    }));
    const unrelated = defineCommerceCommand("productUpdateVariantsBySelector", "write", ctx =>
      Effect.gen(function* () {
        yield* (yield* ctx.table(catalog.variant.table.name)).write(ctx.manager, "update", [{
          id: "pvar_logical_images_forged", title: "Unrequested title", thumbnail: null,
        }]);
        yield* ctx.captureLocalEvent({ name: catalog.variant.updatedEvent,
          metadata: { source: Modules.PRODUCT, object: catalog.variant.eventObject, action: CommonEvents.UPDATED },
          data: { id: "pvar_logical_images_forged" } });
        return [];
      }));
    const unrelatedRoot = defineAtomicCommerceCommand("productVariantThumbnailForgery", (ctx, input) =>
      ctx.call(participant, unrelated, input));
    const unrelatedHost = await Effect.runPromise(makeAtomicCommerceHost({ ...currency.hostInput,
      identityAndAccessPolicy: { profile: "logical-product-variant-thumbnail-forgery" },
      participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
        commands: [unrelated], validateLogicalCall: policy.validateLogicalCall,
        events: { contracts: [contract], select: () => Effect.succeed(contract) } }],
      commands: [unrelatedRoot], events: { producerRevision: revision, contracts: [contract],
        subscribers: [{ id: "logical-product-variant-thumbnail-forgery", revision: "a".repeat(64) }],
        validate: () => Effect.void },
    }));
    try {
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: "prod_logical_images_forged", title: "Forged Images",
        images: [{ id: "img_logical_images_forged", url: "forged-url" }],
        variants: [{ id: "pvar_logical_images_forged", title: "Forged variant", options: {} }],
      }] }));
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await committedEvents();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), root,
        [{ variant_id: "pvar_logical_images_forged", image_id: "img_logical_images_forged" }])))
        .rejects.toMatchObject({ reason: "invalidAuthority" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await committedEvents()).toEqual(beforeEvents);
      await expect(Effect.runPromise(unrelatedHost.run(unrelatedHost.newRequestKey(), unrelatedRoot, {
        selector: { id: "pvar_logical_images_forged" }, update: { thumbnail: null },
      }))).rejects.toMatchObject({ reason: "invalidAuthority" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await committedEvents()).toEqual(beforeEvents);
      await expect(Effect.runPromise(productCallReceipts(catalog).validateLogicalCall({
        commandName: "productCreateassignment", mode: "write", input: [], result: [],
        events: [{ name: catalog.variant.updatedEvent,
          metadata: { source: Modules.PRODUCT, object: catalog.variant.eventObject, action: CommonEvents.UPDATED },
          data: { id: "pvar_logical_images_forged" } }], fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0,
      }, { mutations: [], lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] }))).rejects.toMatchObject({ reason: "receiptMismatch" });
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(host.close);
      await Effect.runPromise(unrelatedHost.close);
    }
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
        ["prod_logical_lifecycle"]))).rejects.toMatchObject({ reason: "invalidAuthority" });
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
        ["prod_logical_delete_rollback"]))).rejects.toMatchObject({ reason: "invalidAuthority" });
      await expect(Effect.runPromise(unowned.host.run(unowned.host.newRequestKey(), unowned.root,
        ["prod_logical_delete_rollback"]))).rejects.toMatchObject({ reason: "invalidAuthority" });
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
        ["prod_logical_membership"]))).rejects.toMatchObject({ reason: "invalidAuthority" });
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
        .rejects.toMatchObject({ reason: "invalidAuthority" });
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
        .rejects.toMatchObject({ reason: "invalidAuthority" });
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
        .rejects.toMatchObject({ reason: "invalidAuthority" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(stableRows);
      expect(await committedEvents()).toEqual(stableEvents);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(update.host.close);
      if (forged !== undefined) await Effect.runPromise(forged.host.close);
      await Effect.runPromise(read.close);
    }
  }, 180_000);

  it("moves a Product Variant link between Values of an unchanged Option", async () => {
    const create = await createHost();
    const update = await updateHost(false, "variants.options");
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [...product.hostInput.commands, product.runtime.commands.list],
    }));
    let forged: Awaited<ReturnType<typeof updateHost>> | undefined;
    let forgedVariant: Awaited<ReturnType<typeof updateHost>> | undefined;
    const productId = "prod_logical_link_update";
    const variantId = "pvar_logical_link_update";
    try {
      const created = await Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: productId, title: "Linked product",
        options: [{ title: "Size", values: ["Small", "Large"] }],
        variants: [{ id: variantId, title: "Linked variant", options: { Size: "Small" } }],
      }, { id: "prod_logical_link_foreign", title: "Foreign linked product",
        options: [{ title: "Size", values: ["XL"] }],
        variants: [{ id: "pvar_logical_link_foreign", title: "Foreign variant", options: { Size: "XL" } }],
      }] }));
      const owned = isJsonObject(created) && Array.isArray(created.products) ? created.products[0] : undefined;
      const ownedOption = isJsonObject(owned) && Array.isArray(owned.options) ? owned.options[0] : undefined;
      if (!isJsonObject(ownedOption) || typeof ownedOption.id !== "string")
        throw new Error("Missing owned Product Option");
      const ownedLarge = Array.isArray(ownedOption.values) ? ownedOption.values.find(value =>
        isJsonObject(value) && value.value === "Large") : undefined;
      if (!isJsonObject(ownedLarge) || typeof ownedLarge.id !== "string")
        throw new Error("Missing owned Product OptionValue");
      const foreign = isJsonObject(created) && Array.isArray(created.products) ? created.products[1] : undefined;
      const foreignOption = isJsonObject(foreign) && Array.isArray(foreign.options) ? foreign.options[0] : undefined;
      const foreignValue = isJsonObject(foreignOption) && Array.isArray(foreignOption.values)
        ? foreignOption.values[0] : undefined;
      if (!isJsonObject(foreignValue) || typeof foreignValue.id !== "string")
        throw new Error("Missing foreign Product OptionValue");
      forged = await updateHost("pivot", undefined, foreignValue.id);
      forgedVariant = await updateHost("pivotVariant", undefined, "pvar_logical_link_foreign", ownedLarge.id);
      const beforeEvents = await committedEvents();
      const replacement = { id: productId, data: { variants: [{
        id: variantId, title: "Linked variant", options: { Size: "Large" },
      }] } };
      const key = update.host.newRequestKey();
      const result = await Effect.runPromise(update.host.run(key, update.root, replacement));
      expect(result).toMatchObject({ updated: { variants: [{ id: variantId }] },
        pending: [{ variants: [{ id: variantId,
          options: [expect.objectContaining({ value: "Large" })] }] }] });
      expect((await committedEvents()).slice(beforeEvents.length).map(event => event.envelope.contract).sort())
        .toEqual([catalog.product.updatedEvent]);
      expect(await Effect.runPromise(update.host.run(key, update.root, replacement))).toEqual(result);
      expect(await Effect.runPromise(read.read(product.runtime.commands.list, {
        filters: { id: productId }, config: { relations: ["variants.options"] },
      }))).toMatchObject([{ variants: [{ id: variantId,
        options: [expect.objectContaining({ value: "Large" })] }] }]);
      const afterMoveEvents = await committedEvents();
      const replaceValue = { id: productId, data: {
        options: [{ id: ownedOption.id, title: "Size", values: ["Large", "Medium"] }],
        variants: [{ id: variantId, title: "Linked variant", options: { Size: "Medium" } }],
      } };
      const valueKey = update.host.newRequestKey();
      const replaced = await Effect.runPromise(update.host.run(valueKey, update.root, replaceValue));
      expect(replaced).toMatchObject({ pending: [{ variants: [{ id: variantId,
        options: [expect.objectContaining({ value: "Medium" })] }] }] });
      expect((await committedEvents()).slice(afterMoveEvents.length).map(event => event.envelope.contract).sort())
        .toEqual([catalog.product.updatedEvent, catalog.value.createdEvent, catalog.value.deletedEvent].sort());
      expect(await Effect.runPromise(update.host.run(valueKey, update.root, replaceValue))).toEqual(replaced);
      expect(await Effect.runPromise(read.read(product.runtime.commands.list, {
        filters: { id: productId }, config: { relations: ["variants.options"] },
      }))).toMatchObject([{ variants: [{ id: variantId,
        options: [expect.objectContaining({ value: "Medium" })] }] }]);
      const stableRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const stableEvents = await committedEvents();
      await expect(Effect.runPromise(update.host.run(update.host.newRequestKey(), update.root, {
        id: productId, data: { variants: [{ id: variantId, title: "Linked variant", options: { Size: "XL" } }] },
      }))).rejects.toMatchObject({ reason: "adapterFailure" });
      await expect(Effect.runPromise(forged.host.run(forged.host.newRequestKey(), forged.root, null)))
        .rejects.toMatchObject({ reason: "invalidAuthority" });
      await expect(Effect.runPromise(forgedVariant.host.run(forgedVariant.host.newRequestKey(), forgedVariant.root, null)))
        .rejects.toMatchObject({ reason: "invalidAuthority" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(stableRows);
      expect(await committedEvents()).toEqual(stableEvents);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(update.host.close);
      if (forged !== undefined) await Effect.runPromise(forged.host.close);
      if (forgedVariant !== undefined) await Effect.runPromise(forgedVariant.host.close);
      await Effect.runPromise(read.close);
    }
  }, 180_000);
});
