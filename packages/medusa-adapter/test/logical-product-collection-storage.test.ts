import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { Modules, CommonEvents } from "@medusajs/framework/utils/portable";
import { productCallReceipts } from "../src/product-local-events";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceDerivedIdEventContract, defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Collection test driver");
const cleanup: Array<() => Promise<void>> = [];

describe("native Collection service on shared logical Product storage", () => {
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

  async function command(operation: "createCollection" | "updateCollection" | "upsertCollection" | "deleteCollection" | "createProduct",
    selectedFixture = fixture, selectedProduct = product, rejectReceipt = false, pendingRead = false,
    replacement = operation === "updateCollection" || operation === "upsertCollection", afterValidation?: () => Promise<void>,
    derivedAdmission: "static" | "generic" | "missingPolicy" = "static") {
    const native = operation === "createCollection" ? selectedProduct.runtime.commands.createCollections
      : operation === "updateCollection" ? selectedProduct.runtime.commands.updateCollections
        : operation === "upsertCollection" ? selectedProduct.runtime.commands.upsertCollections
      : operation === "deleteCollection" ? selectedProduct.runtime.commands.deleteCollections
        : selectedProduct.runtime.commands.create;
    const policy = selectedProduct.runtime.logicalPolicy;
    const afterReceipt = rejectReceipt ? Effect.fail(commerceError("receiptMismatch"))
      : afterValidation === undefined ? Effect.void : Effect.promise(afterValidation);
    const eventNames = operation === "createCollection" ? [catalog.collection.createdEvent, catalog.product.updatedEvent]
      : operation === "updateCollection" ? [catalog.collection.updatedEvent, catalog.product.updatedEvent]
        : operation === "upsertCollection" ? [catalog.collection.createdEvent, catalog.collection.updatedEvent, catalog.product.updatedEvent]
          : operation === "deleteCollection" ? [catalog.collection.deletedEvent] : [catalog.product.createdEvent];
    const revision = createHash("sha256").update(`logical-product-${operation}`).digest("hex");
    const productUpdatedMetadata = { source: Modules.PRODUCT,
      object: catalog.product.eventObject, action: CommonEvents.UPDATED };
    const namedContracts = eventNames.map(name => ({ name,
      token: replacement && derivedAdmission !== "generic" && name === catalog.product.updatedEvent
        ? Result.getOrThrow(defineCommerceDerivedIdEventContract({ name, revision,
          internal: true, metadata: productUpdatedMetadata }))
        : defineCommerceEventContract({ name, revision, internal: true, decode: policy.capture }) }));
    const productUpdatedContract = namedContracts.find(entry => entry.name === catalog.product.updatedEvent);
    if (replacement && productUpdatedContract === undefined) throw new Error("Missing Product update event contract");
    const contracts = namedContracts.map(entry => entry.token);
    const participant = defineAtomicCommerceParticipant("product");
    const root = defineAtomicCommerceCommand(`native${operation}${pendingRead ? "PendingRead" : ""}`, (ctx, input) =>
      pendingRead ? Effect.gen(function* () {
        if (!isJsonObject(input)) return yield* Effect.fail(commerceError("invalidInput"));
        const written = yield* ctx.call(participant, native, input);
        const id = typeof input.id === "string" ? input.id : isJsonObject(written) ? written.id : undefined;
        if (typeof id !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
        const read = yield* ctx.call(participant, selectedProduct.runtime.commands.retrieveCollection,
          { id, config: { select: ["title", "products.id"], relations: ["products"] } });
        return { written, read };
      }) : ctx.call(participant, native, input));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...selectedFixture.hostInput,
      identityAndAccessPolicy: { profile: `logical-product-${operation}` },
      participants: [{ participant, logicalStorage: selectedProduct.hostInput.logicalStorage,
        commands: pendingRead ? [native, selectedProduct.runtime.commands.retrieveCollection] : [native],
        validateLogicalCall: (...args) => policy.validateLogicalCall(...args).pipe(Effect.andThen(afterReceipt)),
        ...(operation === "deleteCollection" ? { allowSetNull: true as const } : {}),
        ...(replacement && productUpdatedContract !== undefined ? { allowReferenceReplacement: true as const,
          derivedIdEvent: { contract: productUpdatedContract.token } } : {}),
        events: { contracts, select: event => {
          const contract = isJsonObject(event) && typeof event.name === "string"
            ? namedContracts.find(candidate => candidate.name === event.name)?.token : undefined;
          return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract);
        } } }],
      commands: [root], ...(replacement ? { requestEventLimit: 256 } : {}),
      events: { producerRevision: revision, contracts,
        subscribers: [{ id: `logical-product-${operation}`, revision: "a".repeat(64) }],
        ...(replacement && derivedAdmission !== "missingPolicy"
          ? { derivedIdValidation: "capturedOnly" as const } : {}),
        validate: events => events.some(event => !event.internal)
          ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    }));
    return { host, root };
  }

  it("runs native scalar create, update and mixed upsert with shared reads and exact events", async () => {
    const created = await command("createCollection");
    const updated = await command("updateCollection");
    const upserted = await command("upsertCollection");
    const rejectedUpsert = await command("upsertCollection", fixture, product, true);
    const reads = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [...product.hostInput.commands, product.runtime.commands.retrieveCollection,
        product.runtime.commands.listCollections, product.runtime.commands.countCollections],
    }));
    try {
      const before = await logicalCurrencyInventory(fixture);
      const first = { id: "pcol_scalar_a", title: "First", handle: "scalar-first" };
      const key = created.host.newRequestKey();
      expect(await Effect.runPromise(created.host.run(key, created.root, first))).toMatchObject(first);
      const afterCreate = await logicalCurrencyInventory(fixture);
      expect(afterCreate.rows).toHaveLength(before.rows.length + 1);
      expect(afterCreate.rowChanges).toHaveLength(before.rowChanges.length + 1);
      expect(afterCreate.events.slice(before.events.length).map(event => event.envelope.contract))
        .toEqual([catalog.collection.createdEvent]);
      expect(await Effect.runPromise(created.host.run(key, created.root, first))).toMatchObject(first);
      expect(await logicalCurrencyInventory(fixture)).toEqual(afterCreate);

      expect(await Effect.runPromise(updated.host.run(updated.host.newRequestKey(), updated.root,
        { id: first.id, data: { title: "Updated" } }))).toMatchObject({ id: first.id, title: "Updated" });
      expect(await Effect.runPromise(reads.read(product.runtime.commands.retrieveCollection,
        { id: first.id }))).toMatchObject({ id: first.id, title: "Updated" });
      expect(await Effect.runPromise(reads.read(product.runtime.commands.listCollections,
        { filters: { handle: first.handle }, config: { take: 1 } })))
        .toMatchObject([{ id: first.id, title: "Updated" }]);

      const beforeUpsert = await logicalCurrencyInventory(fixture);
      const mixed = [{ id: first.id, title: "Upserted" }, { title: "Second", handle: "scalar-second" }];
      const upsertKey = upserted.host.newRequestKey();
      const result = await Effect.runPromise(upserted.host.run(upsertKey, upserted.root, mixed));
      expect(result).toHaveLength(2);
      const afterUpsert = await logicalCurrencyInventory(fixture);
      expect(afterUpsert.rows).toHaveLength(beforeUpsert.rows.length + 1);
      expect(afterUpsert.rowChanges).toHaveLength(beforeUpsert.rowChanges.length + 2);
      expect(new Set(afterUpsert.rowChanges.slice(beforeUpsert.rowChanges.length).map(change => change.commitSeq)).size).toBe(1);
      expect(afterUpsert.events.slice(beforeUpsert.events.length).map(event => event.envelope.contract).sort())
        .toEqual([catalog.collection.createdEvent, catalog.collection.updatedEvent].sort());
      expect(await Effect.runPromise(upserted.host.run(upsertKey, upserted.root, mixed))).toEqual(result);
      expect(await logicalCurrencyInventory(fixture)).toEqual(afterUpsert);
      expect(await Effect.runPromise(reads.read(product.runtime.commands.countCollections,
        { filters: {}, config: { take: 1, skip: 1 } })))
        .toMatchObject([[{ id: expect.any(String) }], 2]);
      expect(await Effect.runPromise(reads.read(product.runtime.commands.retrieveCollection,
        { id: first.id }))).toMatchObject({ id: first.id, title: "Upserted" });
      expect(await Effect.runPromise(reads.read(product.runtime.commands.listCollections,
        { filters: { handle: "scalar-second" }, config: { take: 1 } })))
        .toMatchObject([{ title: "Second" }]);

      const beforeRefusals = await logicalCurrencyInventory(fixture);
      await expect(Effect.runPromise(rejectedUpsert.host.run(rejectedUpsert.host.newRequestKey(), rejectedUpsert.root,
        [{ id: first.id, title: "Must not publish" }]))).rejects.toMatchObject({ reason: "receiptMismatch" });
      expect(await Effect.runPromise(Effect.result(upserted.host.run(upserted.host.newRequestKey(), upserted.root,
        [{ title: "Must roll back" }, { id: "pcol_scalar_missing", title: "Missing" }]))))
        .toMatchObject({ _tag: "Failure" });
      expect(await Effect.runPromise(Effect.result(created.host.run(created.host.newRequestKey(), created.root,
        { title: "Duplicate", handle: first.handle })))).toMatchObject({ _tag: "Failure" });
      expect(await logicalCurrencyInventory(fixture)).toEqual(beforeRefusals);
    } finally {
      await Effect.runPromise(reads.close);
      await Effect.runPromise(created.host.close);
      await Effect.runPromise(updated.host.close);
      await Effect.runPromise(upserted.host.close);
      await Effect.runPromise(rejectedUpsert.host.close);
    }
  }, 180_000);

  it("runs explicit Collection membership changes through the native service", async () => {
    const createCollection = await command("createCollection");
    const updateCollection = await command("updateCollection");
    const upsertCollection = await command("upsertCollection");
    const createProduct = await command("createProduct");
    try {
      await Effect.runPromise(createProduct.host.run(createProduct.host.newRequestKey(), createProduct.root,
        { id: "prod_collection_scalar_member", title: "Member" }));
      await Effect.runPromise(createCollection.host.run(createCollection.host.newRequestKey(), createCollection.root,
        { id: "pcol_scalar_existing", title: "Existing" }));
      const before = await logicalCurrencyInventory(fixture);
      for (const [host, root, input] of [
        [createCollection.host, createCollection.root,
          { id: "pcol_scalar_empty", title: "Empty", product_ids: [] }],
        [updateCollection.host, updateCollection.root,
          { id: "pcol_scalar_existing", data: { product_ids: [] } }],
        [upsertCollection.host, upsertCollection.root,
          [{ id: "pcol_scalar_existing", product_ids: [] }]],
      ] as const) {
        await Effect.runPromise(host.run(host.newRequestKey(), root, input));
      }
      const beforeMembership = await logicalCurrencyInventory(fixture);
      const result = await Effect.runPromise(createCollection.host.run(createCollection.host.newRequestKey(), createCollection.root,
        { id: "pcol_scalar_membership", title: "Membership", product_ids: ["prod_collection_scalar_member"] }));
      expect(result).toMatchObject({ id: "pcol_scalar_membership" });
      const after = await logicalCurrencyInventory(fixture);
      expect(after.rowChanges).toHaveLength(beforeMembership.rowChanges.length + 2);
      expect(new Set(after.rowChanges.slice(beforeMembership.rowChanges.length).map(change => change.commitSeq)).size).toBe(1);
      expect(after.events.slice(beforeMembership.events.length).map(event => event.envelope.contract).sort())
        .toEqual([catalog.collection.createdEvent, catalog.product.updatedEvent].sort());
      expect(after.rowChanges.length).toBeGreaterThan(before.rowChanges.length);
      expect(await logicalCurrencyInventory(fixture)).toEqual(after);
    } finally {
      await Effect.runPromise(createCollection.host.close);
      await Effect.runPromise(updateCollection.host.close);
      await Effect.runPromise(upsertCollection.host.close);
      await Effect.runPromise(createProduct.host.close);
    }
  }, 120_000);

  it("binds generated Collection IDs and mixed upsert memberships to native results", async () => {
    const create = await command("createCollection", fixture, product, false, true);
    const createMany = await command("createCollection");
    const rejected = await command("createCollection", fixture, product, true);
    const upsert = await command("upsertCollection");
    const createProduct = await command("createProduct");
    const reads = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [...product.hostInput.commands, product.runtime.commands.retrieveCollection],
    }));
    const member = "prod_generated_collection_member", otherMember = "prod_generated_collection_other";
    try {
      await Effect.runPromise(createProduct.host.run(createProduct.host.newRequestKey(), createProduct.root,
        [{ id: member, title: "Generated member" }, { id: otherMember, title: "Other generated member" }]));
      const before = await logicalCurrencyInventory(fixture);
      const input = { title: "Generated Collection", handle: "generated-collection", product_ids: [member] };
      await expect(Effect.runPromise(rejected.host.run(rejected.host.newRequestKey(), rejected.root, input)))
        .rejects.toMatchObject({ reason: "receiptMismatch" });
      expect(await logicalCurrencyInventory(fixture)).toEqual(before);

      const key = create.host.newRequestKey();
      const value = await Effect.runPromise(create.host.run(key, create.root, input));
      if (!isJsonObject(value) || value.written === undefined || !isJsonObject(value.written) || typeof value.written.id !== "string")
        throw new Error("Missing generated Collection ID");
      const firstId = value.written.id;
      expect(value.read).toMatchObject({ id: firstId, products: [{ id: member }] });
      const afterCreate = await logicalCurrencyInventory(fixture);
      expect(afterCreate.rowChanges).toHaveLength(before.rowChanges.length + 2);
      expect(afterCreate.events.slice(before.events.length).map(event => event.envelope.contract).sort())
        .toEqual([catalog.collection.createdEvent, catalog.product.updatedEvent].sort());
      expect(await Effect.runPromise(create.host.run(key, create.root, input))).toEqual(value);
      expect(await logicalCurrencyInventory(fixture)).toEqual(afterCreate);

      const mixed = [{ title: "Generated in upsert", handle: "generated-upsert", product_ids: [member] },
        { id: firstId, product_ids: [] }];
      const upserted = await Effect.runPromise(upsert.host.run(upsert.host.newRequestKey(), upsert.root, mixed));
      if (!Array.isArray(upserted) || upserted.length !== 2) throw new Error("Missing mixed-upsert results");
      const second = upserted[0];
      if (second === undefined || !isJsonObject(second) || typeof second.id !== "string")
        throw new Error("Missing mixed-upsert Collection ID");
      const secondId = second.id;
      expect(upserted[1]).toMatchObject({ id: firstId });
      expect(await Effect.runPromise(reads.read(product.runtime.commands.retrieveCollection,
        { id: secondId, config: { select: ["id", "products.id"], relations: ["products"] } })))
        .toMatchObject({ id: secondId, products: [{ id: member }] });
      expect(await Effect.runPromise(reads.read(product.runtime.commands.retrieveCollection,
        { id: firstId, config: { select: ["id", "products.id"], relations: ["products"] } })))
        .toMatchObject({ id: firstId, products: [] });
      const afterUpsert = await logicalCurrencyInventory(fixture);
      expect(afterUpsert.commits).toHaveLength(afterCreate.commits.length + 1);
      expect(afterUpsert.events.slice(afterCreate.events.length).map(event => event.envelope.contract).sort())
        .toEqual([catalog.collection.createdEvent, catalog.collection.updatedEvent, catalog.product.updatedEvent].sort());

      const pair = await Effect.runPromise(createMany.host.run(createMany.host.newRequestKey(), createMany.root,
        [{ title: "Generated pair A", handle: "generated-pair-a", product_ids: [member] },
          { title: "Generated pair B", handle: "generated-pair-b", product_ids: [otherMember] }]));
      const firstPair = Array.isArray(pair) ? pair[0] : undefined;
      const secondPair = Array.isArray(pair) ? pair[1] : undefined;
      if (!Array.isArray(pair) || pair.length !== 2 || firstPair === undefined || secondPair === undefined ||
        !isJsonObject(firstPair) || !isJsonObject(secondPair))
        throw new Error("Missing generated Collection pair");
      const firstPairId = firstPair.id, secondPairId = secondPair.id;
      if (typeof firstPairId !== "string" || typeof secondPairId !== "string" || firstPairId === secondPairId)
        throw new Error("Invalid generated Collection pair");
      for (const { id, productId } of [{ id: firstPairId, productId: member }, { id: secondPairId, productId: otherMember }])
        expect(await Effect.runPromise(reads.read(product.runtime.commands.retrieveCollection,
          { id, config: { select: ["id", "products.id"], relations: ["products"] } })))
          .toMatchObject({ id, products: [{ id: productId }] });
    } finally {
      await Effect.runPromise(create.host.close);
      await Effect.runPromise(createMany.host.close);
      await Effect.runPromise(rejected.host.close);
      await Effect.runPromise(upsert.host.close);
      await Effect.runPromise(createProduct.host.close);
      await Effect.runPromise(reads.close);
    }
  }, 180_000);

  it("replaces, moves and clears 20 native Collection members in shared logical storage", async () => {
    const created = await command("createCollection");
    const pendingCreated = await command("createCollection", fixture, product, false, true);
    const updated = await command("updateCollection", fixture, product, false, false, true);
    const upserted = await command("upsertCollection");
    const rejected = await command("updateCollection", fixture, product, true);
    const createProduct = await command("createProduct");
    const reads = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [...product.hostInput.commands, product.runtime.commands.retrieveCollection],
    }));
    const ids = Array.from({ length: 20 }, (_, index) => `prod_membership_${index.toString().padStart(2, "0")}`);
    const all = "pcol_membership_all", other = "pcol_membership_other";
    try {
      await Effect.runPromise(createProduct.host.run(createProduct.host.newRequestKey(), createProduct.root,
        ids.map(id => ({ id, title: id, handle: id.replaceAll("_", "-") }))));
      const before = await logicalCurrencyInventory(fixture);
      const input = { id: all, title: "All", product_ids: ids };
      const snapshot = structuredClone(input);
      const key = pendingCreated.host.newRequestKey();
      const result = await Effect.runPromise(pendingCreated.host.run(key, pendingCreated.root, input));
      expect(result).toMatchObject({ written: { id: all }, read: { id: all, products: ids.map(id => ({ id })) } });
      expect(input).toEqual(snapshot);
      const afterCreate = await logicalCurrencyInventory(fixture);
      expect(afterCreate.rowChanges).toHaveLength(before.rowChanges.length + 21);
      expect(afterCreate.events.slice(before.events.length).filter(event => event.envelope.contract === catalog.product.updatedEvent))
        .toHaveLength(20);
      expect(new Set(afterCreate.rowChanges.slice(before.rowChanges.length).map(change => change.commitSeq)).size).toBe(1);
      expect(await Effect.runPromise(pendingCreated.host.run(key, pendingCreated.root, input))).toEqual(result);
      expect(await logicalCurrencyInventory(fixture)).toEqual(afterCreate);
      expect(await Effect.runPromise(reads.read(product.runtime.commands.retrieveCollection,
        { id: all, config: { select: ["title", "products.id"], relations: ["products"] } })))
        .toMatchObject({ id: all, products: ids.map(id => ({ id })) });

      await Effect.runPromise(updated.host.run(updated.host.newRequestKey(), updated.root,
        { id: all, data: { title: "Renamed" } }));
      const kept = ids[19];
      if (kept === undefined) throw new Error("Missing last-page Product");
      const beforeReplace = await logicalCurrencyInventory(fixture);
      await Effect.runPromise(updated.host.run(updated.host.newRequestKey(), updated.root,
        { id: all, data: { product_ids: [kept] } }));
      const afterReplace = await logicalCurrencyInventory(fixture);
      expect(afterReplace.rowChanges).toHaveLength(beforeReplace.rowChanges.length + 21);
      expect(afterReplace.events.slice(beforeReplace.events.length).filter(event => event.envelope.contract === catalog.product.updatedEvent))
        .toHaveLength(20);
      for (const id of ids) expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve, { id })))
        .toMatchObject({ id, collection_id: id === kept ? all : null });

      await Effect.runPromise(created.host.run(created.host.newRequestKey(), created.root,
        { id: other, title: "Other" }));
      await Effect.runPromise(updated.host.run(updated.host.newRequestKey(), updated.root,
        { id: other, data: { product_ids: [kept, kept] } }));
      expect(await Effect.runPromise(reads.read(product.runtime.commands.retrieveCollection,
        { id: all, config: { select: ["title", "products.id"], relations: ["products"] } })))
        .toEqual({ id: all, title: "Renamed", products: [] });
      const beforeClear = await logicalCurrencyInventory(fixture);
      await Effect.runPromise(updated.host.run(updated.host.newRequestKey(), updated.root,
        { id: other, data: { product_ids: [] } }));
      const afterClear = await logicalCurrencyInventory(fixture);
      expect(afterClear.rowChanges).toHaveLength(beforeClear.rowChanges.length + 2);
      expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve, { id: kept })))
        .toMatchObject({ collection_id: null });

      const first = ids[0], second = ids[1];
      if (first === undefined || second === undefined) throw new Error("Missing membership Product");
      const beforeUpsert = await logicalCurrencyInventory(fixture);
      await Effect.runPromise(upserted.host.run(upserted.host.newRequestKey(), upserted.root,
        [{ id: all, product_ids: [first] }]));
      const afterUpsert = await logicalCurrencyInventory(fixture);
      expect(afterUpsert.rowChanges).toHaveLength(beforeUpsert.rowChanges.length + 2);
      expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve, { id: first })))
        .toMatchObject({ collection_id: all });
      const beforeRejection = await logicalCurrencyInventory(fixture);
      await expect(Effect.runPromise(rejected.host.run(rejected.host.newRequestKey(), rejected.root,
        { id: all, data: { product_ids: [second] } }))).rejects.toMatchObject({ reason: "receiptMismatch" });
      expect(await logicalCurrencyInventory(fixture)).toEqual(beforeRejection);
    } finally {
      await Effect.runPromise(reads.close);
      await Effect.runPromise(created.host.close);
      await Effect.runPromise(pendingCreated.host.close);
      await Effect.runPromise(updated.host.close);
      await Effect.runPromise(upserted.host.close);
      await Effect.runPromise(rejected.host.close);
      await Effect.runPromise(createProduct.host.close);
    }
  }, 240_000);

  it("keeps colliding Collection and Product membership inside each shop", async () => {
    const other = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      resource: fixture.resource, includeProduct: true,
      fixtureIdentity: { deploymentId: "deployment_collection_membership_shop_b",
        projectId: "project_collection_membership_shop_b", uuidOffset: 18_000 },
    });
    const otherProduct = await prepareLogicalProductHost(other);
    await Effect.runPromise(otherProduct.host.initialize([]));
    const firstCreate = await command("createCollection");
    const secondCreate = await command("createCollection", other, otherProduct);
    const firstUpdate = await command("updateCollection", fixture, product, false, false, true);
    const firstProduct = await command("createProduct");
    const secondProduct = await command("createProduct", other, otherProduct);
    const reads = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [...product.hostInput.commands, product.runtime.commands.countCollections] }));
    const id = "pcol_membership_shared", member = "prod_membership_shared";
    const foreignOnly = "prod_membership_foreign_only";
    try {
      await Effect.runPromise(firstProduct.host.run(firstProduct.host.newRequestKey(), firstProduct.root,
        { id: member, title: "First shop" }));
      await Effect.runPromise(secondProduct.host.run(secondProduct.host.newRequestKey(), secondProduct.root,
        { id: member, title: "Second shop" }));
      await Effect.runPromise(secondProduct.host.run(secondProduct.host.newRequestKey(), secondProduct.root,
        { id: foreignOnly, title: "Second shop only" }));
      await Effect.runPromise(firstCreate.host.run(firstCreate.host.newRequestKey(), firstCreate.root,
        { id, title: "First", product_ids: [member] }));
      await Effect.runPromise(secondCreate.host.run(secondCreate.host.newRequestKey(), secondCreate.root,
        { id, title: "Second", product_ids: [member] }));
      expect(await Effect.runPromise(reads.read(product.runtime.commands.countCollections,
        { filters: { id }, config: { take: 1, select: ["title", "products.title"], relations: ["products"] } })))
        .toEqual([[{ id, title: "First", products: [{ id: member, title: "First shop", collection_id: id }] }], 1]);
      const beforeForeignOnly = await logicalCurrencyInventory(fixture);
      await expect(Effect.runPromise(firstCreate.host.run(firstCreate.host.newRequestKey(), firstCreate.root,
        { title: "Wrong shop", product_ids: [foreignOnly] }))).rejects.toMatchObject({ reason: "adapterFailure" });
      expect(await logicalCurrencyInventory(fixture)).toEqual(beforeForeignOnly);
      await Effect.runPromise(firstUpdate.host.run(firstUpdate.host.newRequestKey(), firstUpdate.root,
        { id, data: { product_ids: [foreignOnly] } }));
      expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve, { id: member })))
        .toMatchObject({ title: "First shop", collection_id: null });
      expect(await Effect.runPromise(otherProduct.host.read(otherProduct.runtime.commands.internalProductRetrieve, { id: member })))
        .toMatchObject({ title: "Second shop", collection_id: id });
      expect(await Effect.runPromise(otherProduct.host.read(otherProduct.runtime.commands.internalProductRetrieve, { id: foreignOnly })))
        .toMatchObject({ title: "Second shop only", collection_id: null });
      const firstAuto = await Effect.runPromise(firstCreate.host.run(firstCreate.host.newRequestKey(), firstCreate.root,
        { title: "Auto", handle: "shared-auto-membership", product_ids: [member] }));
      const secondAuto = await Effect.runPromise(secondCreate.host.run(secondCreate.host.newRequestKey(), secondCreate.root,
        { title: "Auto", handle: "shared-auto-membership", product_ids: [member] }));
      if (!isJsonObject(firstAuto) || typeof firstAuto.id !== "string" ||
        !isJsonObject(secondAuto) || typeof secondAuto.id !== "string")
        throw new Error("Missing shop-local generated Collection IDs");
      expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve, { id: member })))
        .toMatchObject({ collection_id: firstAuto.id });
      expect(await Effect.runPromise(otherProduct.host.read(otherProduct.runtime.commands.internalProductRetrieve, { id: member })))
        .toMatchObject({ collection_id: secondAuto.id });
      await Effect.runPromise(firstUpdate.host.run(firstUpdate.host.newRequestKey(), firstUpdate.root,
        { id: firstAuto.id, data: { product_ids: [] } }));
      expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve, { id: member })))
        .toMatchObject({ collection_id: null });
      expect(await Effect.runPromise(otherProduct.host.read(otherProduct.runtime.commands.internalProductRetrieve, { id: member })))
        .toMatchObject({ collection_id: secondAuto.id });
    } finally {
      await Effect.runPromise(reads.close);
      await Effect.runPromise(firstCreate.host.close);
      await Effect.runPromise(secondCreate.host.close);
      await Effect.runPromise(firstUpdate.host.close);
      await Effect.runPromise(firstProduct.host.close);
      await Effect.runPromise(secondProduct.host.close);
      await Effect.runPromise(otherProduct.host.close);
    }
  }, 180_000);

  it("requires a static derived-ID contract and explicit captured-event validation", async () => {
    await expect(command("updateCollection", fixture, product, false, false, true,
      undefined, "generic")).rejects.toMatchObject({ reason: "invalidAuthority" });
    await expect(command("updateCollection", fixture, product, false, false, true,
      undefined, "missingPolicy")).rejects.toMatchObject({ reason: "invalidAuthority" });
  });

  it("replaces 129 members through one core-selected Collection settlement", async () => {
    const created = await command("createCollection");
    const createProduct = await command("createProduct");
    const updated = await command("updateCollection", fixture, product, false, false, true);
    const id = "pcol_membership_read_bound";
    const other = "pcol_membership_read_bound_other";
    const moved = "prod_membership_bound_moved";
    const desired = [moved, "prod_membership_bound_0", "prod_membership_bound_missing"];
    try {
      await Effect.runPromise(created.host.run(created.host.newRequestKey(), created.root,
        { id, title: "Bounded Collection" }));
      await Effect.runPromise(created.host.run(created.host.newRequestKey(), created.root,
        { id: other, title: "Other Collection" }));
      for (let batch = 0; batch < 5; batch++) {
        const rows = Array.from({ length: Math.min(32, 129 - batch * 32) }, (_, index) => {
          const number = batch * 32 + index;
          return { id: `prod_membership_bound_${number}`, title: `Bound ${number}`,
            handle: `membership-bound-${number}`, collection_id: id };
        });
        await Effect.runPromise(createProduct.host.run(createProduct.host.newRequestKey(), createProduct.root, rows));
      }
      await Effect.runPromise(createProduct.host.run(createProduct.host.newRequestKey(), createProduct.root,
        [{ id: moved, title: "Moved", handle: "membership-bound-moved", collection_id: other }]));
      const before = await logicalCurrencyInventory(fixture);
      const key = updated.host.newRequestKey();
      if (fixture.observeSql !== undefined) {
        let stagedFactPages = 0;
        fixture.observeSql(text => {
          if (/insert into "fx_system_commit_app_row_change"/i.test(text) && ++stagedFactPages === 3)
            throw new Error("Injected Collection replacement failure after three fact pages");
        });
        try {
          await expect(Effect.runPromise(updated.host.run(key, updated.root,
            { id, data: { product_ids: desired } }))).rejects.toThrow();
        } finally {
          fixture.observeSql(undefined);
        }
        expect(stagedFactPages).toBe(3);
        expect(await logicalCurrencyInventory(fixture)).toEqual(before);
      } else if (driver === "postgres") {
        // A statement trigger counts fact-page inserts inside the ordinary-role
        // publication transaction and fails only after earlier pages wrote.
        await fixture.persistence.query(`create function flarex_test_fail_collection_fact_page()
          returns trigger language plpgsql as $$
          declare seen integer;
          begin
            seen := coalesce(nullif(current_setting('flarex.test_collection_fact_pages', true), '')::integer, 0) + 1;
            if seen = 3 then raise exception 'injected third Collection fact page'; end if;
            perform set_config('flarex.test_collection_fact_pages', seen::text, true);
            return null;
          end $$`);
        await fixture.persistence.query(`create trigger flarex_test_fail_collection_fact_page
          after insert on fx_system_commit_app_row_change for each statement
          execute function flarex_test_fail_collection_fact_page()`);
        try {
          let failed: unknown;
          try {
            await Effect.runPromise(updated.host.run(key, updated.root,
              { id, data: { product_ids: desired } }));
          } catch (cause) { failed = cause; }
          const messages: string[] = [];
          let cause = failed;
          for (let depth = 0; depth < 12 && cause !== null && typeof cause === "object"; depth++) {
            if ("message" in cause && typeof cause.message === "string") messages.push(cause.message);
            cause = "cause" in cause ? cause.cause : null;
          }
          expect(messages.join(" | ")).toContain("injected third Collection fact page");
        } finally {
          await fixture.persistence.query("drop trigger flarex_test_fail_collection_fact_page on fx_system_commit_app_row_change");
          await fixture.persistence.query("drop function flarex_test_fail_collection_fact_page()");
        }
        expect(await logicalCurrencyInventory(fixture)).toEqual(before);
      }
      expect(await Effect.runPromise(updated.host.run(key, updated.root,
        { id, data: { product_ids: desired } }))).toMatchObject({ id });
      const after = await logicalCurrencyInventory(fixture);
      expect(after.rowChanges).toHaveLength(before.rowChanges.length + 131);
      const published = after.events.slice(before.events.length);
      expect(published[0]?.envelope.contract).toBe(catalog.collection.updatedEvent);
      const productEvents = published.filter(event => event.envelope.contract === catalog.product.updatedEvent);
      expect(productEvents).toHaveLength(130);
      const updatedIds = productEvents.map(event => {
        const message = event.envelope.message;
        return isJsonObject(message) && message.data !== undefined && isJsonObject(message.data)
          ? message.data.id : null;
      });
      expect(updatedIds).toEqual([...Array.from({ length: 128 }, (_, index) =>
        `prod_membership_bound_${index + 1}`).toSorted(),
        "prod_membership_bound_0", moved]);
      expect(new Set(after.rowChanges.slice(before.rowChanges.length).map(change => change.commitSeq)).size).toBe(1);
      expect(await Effect.runPromise(updated.host.run(key, updated.root,
        { id, data: { product_ids: desired } }))).toMatchObject({ id });
      expect(await logicalCurrencyInventory(fixture)).toEqual(after);
      expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve,
        { id: "prod_membership_bound_0" }))).toMatchObject({ collection_id: id });
      expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve,
        { id: moved }))).toMatchObject({ collection_id: id });
      expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve,
        { id: "prod_membership_bound_128" }))).toMatchObject({ collection_id: null });
    } finally {
      await Effect.runPromise(created.host.close);
      await Effect.runPromise(createProduct.host.close);
      await Effect.runPromise(updated.host.close);
    }
  }, 240_000);

  it("includes a Product reference committed before Collection replacement settlement", async () => {
    if (driver !== "postgres") return;
    const id = "pcol_concurrent_replacement";
    const created = await command("createCollection");
    const createProduct = await command("createProduct");
    let signalEntered!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { signalEntered = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const updated = await command("updateCollection", fixture, product, false, false, true, async () => {
      signalEntered();
      await released;
    });
    try {
      await Effect.runPromise(created.host.run(created.host.newRequestKey(), created.root,
        { id, title: "Concurrent replacement" }));
      await Effect.runPromise(createProduct.host.run(createProduct.host.newRequestKey(), createProduct.root,
        { id: "prod_replacement_before", title: "Before", collection_id: id }));
      const before = await logicalCurrencyInventory(fixture);
      const replacing = Effect.runPromise(updated.host.run(updated.host.newRequestKey(), updated.root,
        { id, data: { product_ids: [] } }));
      try {
        await Effect.runPromise(Effect.promise(() => entered).pipe(Effect.timeout(5000)));
        await Effect.runPromise(createProduct.host.run(createProduct.host.newRequestKey(), createProduct.root,
          { id: "prod_replacement_during", title: "During", collection_id: id }));
      } finally { release(); }
      await replacing;
      const after = await logicalCurrencyInventory(fixture);
      expect(after.rowChanges).toHaveLength(before.rowChanges.length + 4);
      expect(after.events.slice(before.events.length).filter(event =>
        event.envelope.contract === catalog.product.updatedEvent)).toHaveLength(2);
      for (const member of ["prod_replacement_before", "prod_replacement_during"])
        expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve,
          { id: member }))).toMatchObject({ id: member, collection_id: null });
    } finally {
      release();
      await Effect.runPromise(created.host.close);
      await Effect.runPromise(createProduct.host.close);
      await Effect.runPromise(updated.host.close);
    }
  }, 180_000);

  it("rejects an unaccounted lifecycle observation in a Collection update receipt", async () => {
    const policy = productCallReceipts(catalog);
    expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({
      commandName: "productupdatecollection", mode: "write", input: { id: "pcol_receipt", data: { title: "After" } },
      result: { id: "pcol_receipt" }, events: [], fromAttempt: 0, toAttempt: 0,
      fromLifecycle: 0, toLifecycle: 1,
    }, { mutations: [], lifecycle: [{ table: catalog.collection.table.name, key: { id: "pcol_receipt" }, operation: "softDelete",
      beforeDeletedAt: null, afterDeletedAt: "2025-01-01T00:00:00.000Z", attemptOrdinal: null,
      rowAtOperation: null }], observedRows: [], setNull: [], referenceReplacements: [] }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

  it("rejects a Product field change unrelated to Collection membership", async () => {
    const policy = productCallReceipts(catalog);
    const createdCollection = { id: "pcol_receipt", title: "Collection", deleted_at: null };
    const beforeProduct = { id: "prod_receipt", title: "Original", collection_id: null, deleted_at: null };
    const attachedProduct = { ...beforeProduct, collection_id: createdCollection.id };
    const attempts = [
      { ordinal: 0, table: catalog.collection.table.name, operation: "insert" as const,
        before: null, after: createdCollection },
      { ordinal: 1, table: catalog.product.table.name, operation: "patch" as const,
        before: beforeProduct, after: attachedProduct },
    ];
    const call = { commandName: "productupsertcollection", mode: "write" as const,
      input: [{ title: "Collection", product_ids: ["prod_receipt"] }],
      result: [{ ...createdCollection, products: [attachedProduct] }],
      events: [
        { name: catalog.collection.createdEvent, metadata: { source: Modules.PRODUCT,
          object: catalog.collection.eventObject, action: CommonEvents.CREATED }, data: { id: "pcol_receipt" } },
        { name: catalog.product.updatedEvent, metadata: { source: Modules.PRODUCT,
          object: catalog.product.eventObject, action: CommonEvents.UPDATED }, data: { id: "prod_receipt" } },
      ], fromAttempt: 0, toAttempt: 2, fromLifecycle: 0, toLifecycle: 0 };
    const activity = { mutations: attempts, lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, { ...activity,
      mutations: attempts.map(mutation => mutation.table === catalog.product.table.name
        ? { ...mutation, after: { ...mutation.after, title: "Changed" } } : mutation),
    }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

  it("requires a sealed replacement receipt even for an empty desired membership", async () => {
    const policy = productCallReceipts(catalog);
    const before = { id: "pcol_missing_intent", title: "Collection", deleted_at: null };
    for (const productIds of [[], ["prod_requested"]]) {
      expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({
        commandName: "productupdatecollection", mode: "write",
        input: { id: before.id, data: { product_ids: productIds } }, result: { id: before.id },
        events: [{ name: catalog.collection.updatedEvent, metadata: { source: Modules.PRODUCT,
          object: catalog.collection.eventObject, action: CommonEvents.UPDATED }, data: { id: before.id } }],
        fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0,
      }, { mutations: [{ ordinal: 0, table: catalog.collection.table.name, operation: "patch",
        before, after: { ...before, updated_at: "2026-01-01T00:00:00.000Z" } }],
      lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    }
  });

  it.each(["productCreatecollection", "productupsertcollection"])(
    "binds scalar generated results to stored identities for %s", async commandName => {
      const policy = productCallReceipts(catalog);
      const id = "pcol_scalar_receipt";
      const call = { commandName, mode: "write" as const, input: { title: "Scalar" },
        result: { id, title: "Scalar", deleted_at: null, products: [] },
        events: [{ name: catalog.collection.createdEvent, metadata: { source: Modules.PRODUCT,
          object: catalog.collection.eventObject, action: CommonEvents.CREATED }, data: { id } }],
        fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 };
      const activity = { mutations: [{ ordinal: 0, table: catalog.collection.table.name,
        operation: "insert" as const, before: null, after: { id, title: "Scalar", deleted_at: null } }],
      lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] };
      await Effect.runPromise(policy.validateLogicalCall(call, activity));
      expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(
        { ...call, result: { ...call.result, id: "pcol_forged_result" } }, activity))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
      expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(
        { ...call, input: { title: "Unwritten" } }, activity))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    });

  it("binds a Collection update receipt to the requested root", async () => {
    const policy = productCallReceipts(catalog);
    const before = { id: "pcol_wrong_root", title: "Before", deleted_at: null };
    expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({
      commandName: "productupdatecollection", mode: "write",
      input: { id: "pcol_requested", data: { title: "After" } }, result: { id: "pcol_requested" },
      events: [{ name: catalog.collection.updatedEvent,
        metadata: { source: Modules.PRODUCT, object: catalog.collection.eventObject, action: CommonEvents.UPDATED },
        data: { id: "pcol_wrong_root" } }],
      fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0,
    }, { mutations: [{ ordinal: 0, table: catalog.collection.table.name, operation: "patch",
      before, after: { ...before, title: "After" } }], lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

  it.each([false, true])("authenticates the full returned Collection row with replacement=%s", async replacement => {
    const policy = productCallReceipts(catalog);
    const before = { id: "pcol_result", title: "Before", deleted_at: null };
    const after = { ...before, title: "After" };
    const call = { commandName: "productupdatecollection", mode: "write" as const,
      input: { id: before.id, data: { title: "After", ...(replacement ? { product_ids: [] } : {}) } },
      result: { ...after, products: [] }, events: [{ name: catalog.collection.updatedEvent, metadata: { source: Modules.PRODUCT,
        object: catalog.collection.eventObject, action: CommonEvents.UPDATED }, data: { id: before.id } }],
      fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 };
    const activity = { mutations: [{ ordinal: 0, table: catalog.collection.table.name,
      operation: "patch" as const, before, after }], lifecycle: [], observedRows: [], setNull: [],
    referenceReplacements: replacement ? [{ sourceTable: catalog.product.table.name, sourceColumn: "collection_id",
      targetTable: catalog.collection.table.name, targetColumn: "id", targetKey: before.id, desiredKeys: [] }] : [] };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    for (const result of [{ ...call.result, title: "Forged" }, { id: before.id },
      { ...call.result, products: [{ id: "unrequested" }] }]) {
      expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ ...call, result }, activity))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    }
    expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ ...call,
      input: { ...call.input, data: { ...call.input.data, title: "Unwritten" } } }, activity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    const metadataBefore = { ...before, metadata: { retained: true, removed: "old", changed: "old" } };
    for (const [requested, expected] of [
      [{ removed: "", changed: "new" }, { retained: true, changed: "new" }],
      [{}, {}], [null, null],
    ] as const) {
      const metadataAfter = { ...after, metadata: expected };
      const metadataCall = { ...call, input: { ...call.input,
        data: { ...call.input.data, metadata: requested } }, result: { ...metadataAfter, products: [] } };
      const metadataActivity = { ...activity, mutations: [{ ordinal: 0, table: catalog.collection.table.name,
        operation: "patch" as const, before: metadataBefore, after: metadataAfter }] };
      await Effect.runPromise(policy.validateLogicalCall(metadataCall, metadataActivity));
      const forged = { ...metadataAfter, metadata: { changed: "forged" } };
      expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ ...metadataCall,
        result: { ...forged, products: [] } }, { ...metadataActivity, mutations: [{
          ordinal: 0, table: catalog.collection.table.name,
          operation: "patch", before: metadataBefore, after: forged,
        }] })))).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    }
  });

  it("rejects a generated-ID membership receipt with a mismatched native result", async () => {
    const policy = productCallReceipts(catalog);
    const id = "pcol_generated_receipt", member = "prod_generated_receipt";
    const beforeProduct = { id: member, title: "Member", collection_id: null, deleted_at: null };
    const mutations = [{ ordinal: 0, table: catalog.collection.table.name, operation: "insert" as const,
      before: null, after: { id, title: "Created", deleted_at: null } },
    { ordinal: 1, table: catalog.product.table.name, operation: "patch" as const,
      before: beforeProduct, after: { ...beforeProduct, collection_id: id } }];
    const events = [
      { name: catalog.collection.createdEvent,
        metadata: { source: Modules.PRODUCT, object: catalog.collection.eventObject, action: CommonEvents.CREATED }, data: { id } },
      { name: catalog.product.updatedEvent,
        metadata: { source: Modules.PRODUCT, object: catalog.product.eventObject, action: CommonEvents.UPDATED }, data: { id: member } },
    ];
    const call = { commandName: "productCreatecollection", mode: "write" as const,
      input: { title: "Created", product_ids: [member] },
      result: { id, title: "Created", deleted_at: null, products: [{ ...beforeProduct, collection_id: id }] }, events,
      fromAttempt: 0, toAttempt: 2, fromLifecycle: 0, toLifecycle: 0 };
    await Effect.runPromise(policy.validateLogicalCall(call, { mutations: mutations, lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] }));
    expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ ...call, result: { id: "pcol_wrong_result" } }, { mutations: mutations, lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ ...call, events: events.slice(0, 1), toAttempt: 1 }, { mutations: mutations.slice(0, 1), lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

  it("binds generated Collection result order and mixed upsert root kinds to row facts", async () => {
    const policy = productCallReceipts(catalog);
    const roots = ["pcol_generated_first", "pcol_generated_second"] as const;
    const mutations = roots.map((id, ordinal) => ({ ordinal, table: catalog.collection.table.name,
      operation: "insert" as const, before: null,
      after: { id, title: ordinal === 0 ? "First" : "Second", deleted_at: null } }));
    const events = roots.map(id => ({ name: catalog.collection.createdEvent,
      metadata: { source: Modules.PRODUCT, object: catalog.collection.eventObject, action: CommonEvents.CREATED },
      data: { id } }));
    const firstEvent = events[0];
    const firstMutation = mutations[0];
    if (firstEvent === undefined || firstMutation === undefined)
      throw new Error("missing generated Collection receipt");
    const call = { commandName: "productCreatecollection", mode: "write" as const,
      input: [{ title: "First", product_ids: [] }, { title: "Second", product_ids: [] }],
      result: mutations.map(mutation => ({ ...mutation.after, products: [] })), events,
      fromAttempt: 0, toAttempt: 2, fromLifecycle: 0, toLifecycle: 0 };
    await Effect.runPromise(policy.validateLogicalCall(call, { mutations: mutations, lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] }));
    const secondMutation = mutations[1];
    if (secondMutation === undefined) throw new Error("missing second generated Collection receipt");
    await Effect.runPromise(policy.validateLogicalCall(call, { mutations: [
      { ...secondMutation, ordinal: 0 }, { ...firstMutation, ordinal: 1 },
    ], lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] }));
    expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ ...call, result: [...call.result].reverse() }, { mutations: mutations, lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

    const mixed = productCallReceipts(catalog);
    const explicitId = "pcol_explicit_update";
    const mixedCall = { ...call, commandName: "productupsertcollection",
      input: [{ title: "First", product_ids: [] }, { id: explicitId, title: "Updated" }],
      result: [{ ...firstMutation.after, products: [] }, { id: explicitId, title: "Updated", deleted_at: null, products: [] }],
      events: [firstEvent, { name: catalog.collection.updatedEvent,
        metadata: { source: Modules.PRODUCT, object: catalog.collection.eventObject, action: CommonEvents.UPDATED },
        data: { id: explicitId } }] };
    const before = { id: explicitId, title: "Before", deleted_at: null };
    const valid = [firstMutation, { ordinal: 1, table: catalog.collection.table.name,
      operation: "patch" as const, before, after: { ...before, title: "Updated" } }];
    await Effect.runPromise(mixed.validateLogicalCall(mixedCall, { mutations: valid, lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] }));
    const forged = [{ ordinal: 0, table: catalog.collection.table.name,
      operation: "patch" as const,
      before: { id: roots[0], title: "Before", deleted_at: null }, after: firstMutation.after },
    { ordinal: 1, table: catalog.collection.table.name, operation: "insert" as const,
      before: null, after: { id: explicitId, title: "Updated", deleted_at: null } }];
    const forgedEvents = [{ ...firstEvent, name: catalog.collection.updatedEvent,
      metadata: { ...firstEvent.metadata, action: CommonEvents.UPDATED } },
    { name: catalog.collection.createdEvent,
      metadata: { source: Modules.PRODUCT, object: catalog.collection.eventObject, action: CommonEvents.CREATED },
      data: { id: explicitId } }];
    expect(await Effect.runPromise(Effect.result(mixed.validateLogicalCall({ ...mixedCall, events: forgedEvents }, { mutations: forged, lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

  it("detaches 160 Products with one root event, replay, rollback and shop isolation", async () => {
    const other = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      resource: fixture.resource, includeProduct: true,
      fixtureIdentity: { deploymentId: "deployment_collection_delete_shop_b",
        projectId: "project_collection_delete_shop_b", uuidOffset: 15_000 },
    });
    const otherProduct = await prepareLogicalProductHost(other);
    await Effect.runPromise(otherProduct.host.initialize([]));
    const create = await command("createCollection");
    const createOther = await command("createCollection", other, otherProduct);
    const createProduct = await command("createProduct");
    const createOtherProduct = await command("createProduct", other, otherProduct);
    const deleted = await command("deleteCollection");
    const rejected = await command("deleteCollection", fixture, product, true);
    const collectionId = "pcol_shared_detach";
    try {
      await Effect.runPromise(create.host.run(create.host.newRequestKey(), create.root,
        { id: collectionId, title: "First Collection" }));
      await Effect.runPromise(createOther.host.run(createOther.host.newRequestKey(), createOther.root,
        { id: collectionId, title: "Second Collection" }));
      await Effect.runPromise(createOtherProduct.host.run(createOtherProduct.host.newRequestKey(), createOtherProduct.root,
        { id: "prod_collection_shop_b", title: "Other shop", collection_id: collectionId }));
      for (let batch = 0; batch < 5; batch++) {
        const rows = Array.from({ length: 32 }, (_, index) => ({
          id: `prod_collection_fanout_${batch * 32 + index}`,
          title: `Collection fan-out ${batch * 32 + index}`,
          handle: `collection-fanout-${batch * 32 + index}`, collection_id: collectionId,
        }));
        expect(await Effect.runPromise(createProduct.host.run(createProduct.host.newRequestKey(), createProduct.root, rows)))
          .toMatchObject(rows);
      }
      const before = await logicalCurrencyInventory(fixture);
      await expect(Effect.runPromise(rejected.host.run(rejected.host.newRequestKey(), rejected.root, [collectionId])))
        .rejects.toMatchObject({ reason: "receiptMismatch" });
      expect(await logicalCurrencyInventory(fixture)).toEqual(before);
      const key = deleted.host.newRequestKey();
      const result = await Effect.runPromise(deleted.host.run(key, deleted.root, [collectionId]));
      const after = await logicalCurrencyInventory(fixture);
      expect(after.rows).toHaveLength(before.rows.length);
      expect(after.revisions).toHaveLength(before.revisions.length + 161);
      expect(after.indexRevisions.length).toBeGreaterThan(before.indexRevisions.length + 160);
      expect(after.rowChanges).toHaveLength(before.rowChanges.length + 161);
      expect(after.commits).toHaveLength(before.commits.length + 1);
      expect(after.events.slice(before.events.length).map(event => event.envelope.contract))
        .toEqual([catalog.collection.deletedEvent]);
      expect(new Set(after.rowChanges.slice(before.rowChanges.length).map(change => change.commitSeq)).size).toBe(1);
      for (const index of [0, 31, 32, 63, 64, 95, 96, 127, 128, 159]) {
        expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve,
          { id: `prod_collection_fanout_${index}` })))
          .toMatchObject({ id: `prod_collection_fanout_${index}`, collection_id: null });
      }
      expect(await Effect.runPromise(otherProduct.host.read(otherProduct.runtime.commands.internalProductRetrieve,
        { id: "prod_collection_shop_b" }))).toMatchObject({ collection_id: collectionId });
      expect(await Effect.runPromise(deleted.host.run(key, deleted.root, [collectionId]))).toEqual(result);
      expect(await logicalCurrencyInventory(fixture)).toEqual(after);
    } finally {
      await Effect.runPromise(create.host.close);
      await Effect.runPromise(createOther.host.close);
      await Effect.runPromise(createProduct.host.close);
      await Effect.runPromise(createOtherProduct.host.close);
      await Effect.runPromise(deleted.host.close);
      await Effect.runPromise(rejected.host.close);
      await Effect.runPromise(otherProduct.host.close);
    }
  }, 240_000);

  it("binds Collection delete facts to requested IDs and its null result", async () => {
    const policy = productCallReceipts(catalog);
    const id = "pcol_delete_receipt";
    const call = { commandName: "productDeletecollection", mode: "write" as const,
      input: [id, "pcol_missing"], result: null,
      events: [{ name: catalog.collection.deletedEvent, metadata: { source: Modules.PRODUCT,
        object: catalog.collection.eventObject, action: CommonEvents.DELETED }, data: { id } }],
      fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 };
    const activity = { mutations: [{ ordinal: 0, table: catalog.collection.table.name,
      operation: "delete" as const, before: { id, deleted_at: null }, after: null }],
    lifecycle: [], observedRows: [], referenceReplacements: [],
    setNull: [{ sourceTable: catalog.product.table.name, sourceColumn: "collection_id",
      targetTable: catalog.collection.table.name, targetColumn: "id", targetKey: id }] };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    for (const forged of [{ ...call, input: ["pcol_other"] }, { ...call, result: { id } }]) {
      expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(forged, activity))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    }
  });

  it("authenticates populated internal Product results against observed relation rows", async () => {
    const policy = productCallReceipts(catalog);
    const before = { id: "prod_receipt", title: "Before", deleted_at: null };
    const after = { ...before, title: "After" };
    const option = { id: "opt_receipt", product_id: before.id, title: "Size", deleted_at: null };
    const call = { commandName: "productInternalProductupdate", mode: "write" as const,
      input: [{ id: before.id, title: "After" }], result: [{ ...after, options: [option] }], events: [],
      fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 };
    const activity = { mutations: [{ ordinal: 0, table: catalog.product.table.name,
      operation: "patch" as const, before, after }], lifecycle: [],
    observedRows: [{ table: catalog.option.table.name, row: option }], setNull: [], referenceReplacements: [] };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    for (const result of [{ ...after, options: [{ ...option, title: "Forged" }] },
      { ...after, options: [{ ...option, product_id: "prod_other" }] }, { ...after, options: [] }]) {
      expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ ...call, result: [result] }, activity))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    }
  });

  it("binds direct Tag and Value update DTOs to their requested row changes", async () => {
    const policy = productCallReceipts(catalog);
    for (const entity of [catalog.tag, catalog.value]) {
      const commandName = entity === catalog.tag ? "productupdatetag" : "productupdatevalue";
      const before = { id: "row_receipt", value: "Old", deleted_at: null };
      const after = { ...before, value: "New" };
      const call = { commandName, mode: "write" as const, input: { id: before.id, data: { value: "New" } },
        result: after, events: [{ name: entity.updatedEvent, metadata: { source: Modules.PRODUCT,
          object: entity.eventObject, action: CommonEvents.UPDATED }, data: { id: before.id } }],
        fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 };
      const activity = { mutations: [{ ordinal: 0, table: entity.table.name,
        operation: "patch" as const, before, after }], lifecycle: [], observedRows: [],
      setNull: [], referenceReplacements: [] };
      await Effect.runPromise(policy.validateLogicalCall(call, activity));
      for (const forged of [{ ...call, result: { ...after, value: "Forged" } },
        { ...call, input: { id: before.id, data: { value: "Other" } } }]) {
        expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(forged, activity))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
      }
    }
  });

  it("rejects forged Tag upsert and Variant update result fields", async () => {
    const policy = productCallReceipts(catalog);
    const tagBefore = { id: "tag_receipt", value: "Old", deleted_at: null, metadata: { source: "old" } };
    const tagAfter = { ...tagBefore, value: "New" };
    const tagCall = { commandName: "productupserttag", mode: "write" as const,
      input: [{ id: tagBefore.id, value: "New" }], result: [tagAfter],
      events: [{ name: catalog.tag.updatedEvent, metadata: { source: Modules.PRODUCT,
        object: catalog.tag.eventObject, action: CommonEvents.UPDATED }, data: { id: tagBefore.id } }],
      fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 };
    const tagActivity = { mutations: [{ ordinal: 0, table: catalog.tag.table.name,
      operation: "patch" as const, before: tagBefore, after: tagAfter }], lifecycle: [],
    observedRows: [], setNull: [], referenceReplacements: [] };
    await Effect.runPromise(policy.validateLogicalCall(tagCall, tagActivity));
    expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ ...tagCall,
      result: [{ ...tagAfter, metadata: { source: "forged" } }] }, tagActivity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

    const variantBefore = { id: "variant_receipt", product_id: "prod_receipt", title: "Old", deleted_at: null };
    const variantAfter = { ...variantBefore, title: "New" };
    const variantCall = { commandName: "productupdatevariant", mode: "write" as const,
      input: { id: variantBefore.id, data: { title: "New" } }, result: variantAfter,
      events: [{ name: catalog.variant.updatedEvent, metadata: { source: Modules.PRODUCT,
        object: catalog.variant.eventObject, action: CommonEvents.UPDATED }, data: { id: variantBefore.id } }],
      fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 };
    const variantActivity = { mutations: [{ ordinal: 0, table: catalog.variant.table.name,
      operation: "patch" as const, before: variantBefore, after: variantAfter }], lifecycle: [],
    observedRows: [], setNull: [], referenceReplacements: [] };
    await Effect.runPromise(policy.validateLogicalCall(variantCall, variantActivity));
    expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ ...variantCall,
      result: { ...variantAfter, title: "Forged" } }, variantActivity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

  it("seals two Collection references in one native delete", async () => {
    const create = await command("createCollection");
    const createProduct = await command("createProduct");
    const deleted = await command("deleteCollection");
    const ids = ["pcol_multi_a", "pcol_multi_b"];
    try {
      for (const [index, id] of ids.entries()) {
        await Effect.runPromise(create.host.run(create.host.newRequestKey(), create.root,
          { id, title: `Multiple Collection ${index}` }));
        await Effect.runPromise(createProduct.host.run(createProduct.host.newRequestKey(), createProduct.root,
          { id: `prod_multi_${index}`, title: `Multiple Product ${index}`, collection_id: id }));
      }
      const before = await logicalCurrencyInventory(fixture);
      await Effect.runPromise(deleted.host.run(deleted.host.newRequestKey(), deleted.root, ids));
      const after = await logicalCurrencyInventory(fixture);
      expect(after.revisions).toHaveLength(before.revisions.length + 4);
      expect(after.rowChanges).toHaveLength(before.rowChanges.length + 4);
      expect(new Set(after.rowChanges.slice(before.rowChanges.length).map(change => change.commitSeq)).size).toBe(1);
      for (const index of [0, 1]) {
        expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve,
          { id: `prod_multi_${index}` }))).toMatchObject({ collection_id: null });
      }
    } finally {
      await Effect.runPromise(create.host.close);
      await Effect.runPromise(createProduct.host.close);
      await Effect.runPromise(deleted.host.close);
    }
  }, 120_000);
});
