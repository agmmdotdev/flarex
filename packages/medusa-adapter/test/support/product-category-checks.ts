import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from
  "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { decodeCategoryProjection } from "../../src/modules/product/category-projection";
import { productCallReceipts } from "../../src/modules/product/events/call-receipts";
import { captureProductSchema } from "../../src/modules/product/schema";
import { productRuntimeMetadata } from "../../src/modules/product/runtime-metadata";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { prepareLogicalProductHost } from "./logical-product-fixture";
import { getLogicalProductRunnerFixture, productIntegrationTestRunner, runLogicalProductCommand } from
  "./logical-product-runner";

const run = Effect.runPromise;
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const decoded = (value: Parameters<typeof decodeCategoryProjection>[0]) =>
  run(Effect.fromResult(decodeCategoryProjection(value)));

productIntegrationTestRunner({ moduleName: "product", testSuite: () => describe("Product Category boundary", () => {
  it("isolates inverse products and tree reads from colliding foreign scope rows", async () => {
    const { currency, product, reader } = getLogicalProductRunnerFixture();
    const { runtime } = product;
    await run(runLogicalProductCommand(runtime.commands.create,
      { id: "product_owned", title: "local", handle: "local" }));
    await run(runLogicalProductCommand(runtime.commands.createCategories,
      { id: "root", name: "local root", products: [{ id: "product_owned" }] }));
    await run(runLogicalProductCommand(runtime.commands.createCategories,
      { id: "child", name: "local child", parent_category_id: "root" }));

    const cleanup: Array<() => Promise<void>> = [];
    try {
      const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
      if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Category test driver");
      const other = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
        resource: currency.resource, includeProduct: true,
        fixtureIdentity: { deploymentId: "deployment_category_boundary_shop_b",
          projectId: "project_category_boundary_shop_b", uuidOffset: 24_000 },
      });
      const foreign = await prepareLogicalProductHost(other);
      cleanup.push(() => run(foreign.host.close));
      await run(foreign.host.initialize([]));
      const participant = defineAtomicCommerceParticipant("product");
      const productRoot = defineAtomicCommerceCommand("foreignCategoryProduct", (ctx, input) =>
        ctx.call(participant, foreign.runtime.commands.internalProductCreate, input));
      const categoryRoot = defineAtomicCommerceCommand("foreignCategoryCreate", (ctx, input) =>
        ctx.call(participant, foreign.runtime.commands.createCategories, input));
      const revision = createHash("sha256").update("foreign-category-boundary").digest("hex");
      const catalog = await run(captureProductSchema("foreign-category-boundary")
        .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
      const names = [catalog.category.createdEvent, catalog.category.updatedEvent];
      const contracts = names.map(name => defineCommerceEventContract({ name, revision,
        internal: true, decode: foreign.runtime.logicalPolicy.capture }));
      const byName = new Map(names.map((name, index) => [name, contracts[index]]));
      const foreignWriter = await run(makeAtomicCommerceHost({ ...other.hostInput,
        identityAndAccessPolicy: { profile: "foreign-category-boundary" },
        participants: [{ participant, logicalStorage: foreign.hostInput.logicalStorage,
          commands: [foreign.runtime.commands.internalProductCreate, foreign.runtime.commands.createCategories],
          validateLogicalCall: foreign.runtime.logicalPolicy.validateLogicalCall,
          events: { contracts, select: message => {
            const contract = isJsonObject(message) && typeof message.name === "string"
              ? byName.get(message.name) : undefined;
            return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract);
          } } }],
        commands: [productRoot, categoryRoot],
        events: { producerRevision: revision, contracts,
          subscribers: [{ id: "foreign-category-boundary", revision }],
          validate: events => events.some(event => !event.internal)
            ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
      }));
      cleanup.push(() => run(foreignWriter.close));
      const foreignReader = await run(makeCommerceHost({ ...foreign.hostInput,
        commands: [foreign.runtime.commands.countCategories, foreign.runtime.commands.internalCategoryCount] }));
      cleanup.push(() => run(foreignReader.close));
      await run(foreignWriter.run(foreignWriter.newRequestKey(), productRoot,
        { id: "product_owned", title: "foreign", handle: "foreign" }));
      await run(foreignWriter.run(foreignWriter.newRequestKey(), categoryRoot,
        { id: "root", name: "foreign root", products: [{ id: "product_owned" }] }));
      await run(foreignWriter.run(foreignWriter.newRequestKey(), categoryRoot,
        { id: "child", name: "foreign child", parent_category_id: "root" }));
      await run(foreignWriter.run(foreignWriter.newRequestKey(), categoryRoot,
        { id: "foreign_only", name: "foreign only", parent_category_id: "root" }));
      const query = { filters: { id: "root", include_descendants_tree: true },
        config: { relations: ["products"], select: ["id", "name", "products.title"], take: 1 } };
      expect(await decoded(await run(reader.read(runtime.commands.countCategories, query))))
        .toMatchObject([[{ id: "root", name: "local root",
          products: [{ id: "product_owned", title: "local" }],
          category_children: [{ id: "child", name: "local child", category_children: [] }] }], 1]);
      expect(await decoded(await run(foreignReader.read(foreign.runtime.commands.countCategories, query))))
        .toMatchObject([[{ id: "root", name: "foreign root",
          products: [{ id: "product_owned", title: "foreign" }],
          category_children: expect.arrayContaining([
            expect.objectContaining({ id: "child", name: "foreign child" }),
            expect.objectContaining({ id: "foreign_only", name: "foreign only" }),
          ]) }], 1]);
      const internal = { filters: { parent_category_id: ["root"] },
        config: { relations: ["parent_category"] } };
      expect(await decoded(await run(reader.read(runtime.commands.internalCategoryCount, internal))))
        .toMatchObject([[{ id: "child", name: "local child",
          parent_category: { id: "root", name: "local root" } }], 1]);
      const before = await logicalCurrencyInventory(currency);
      await expect(run(runLogicalProductCommand(runtime.commands.updateCategories,
        { id: "child", data: { parent_category_id: "foreign_only" } })))
        .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      expect(await logicalCurrencyInventory(currency)).toEqual(before);
      await run(runLogicalProductCommand(runtime.commands.deleteCategories, "child"));
      expect(await decoded(await run(reader.read(runtime.commands.internalCategoryCount, internal))))
        .toEqual([[], 0]);
      expect(await decoded(await run(foreignReader.read(foreign.runtime.commands.internalCategoryCount, internal))))
        .toMatchObject([[{ id: "child", name: "foreign child" },
          { id: "foreign_only", name: "foreign only" }], 2]);
    } finally {
      for (const close of cleanup.reverse()) await close();
    }
  }, 180_000);

  it("rolls back a native tree move after a late materialization failure and replays", async () => {
    const { currency, product: { runtime }, reader, writer } =
      getLogicalProductRunnerFixture();
    for (const category of [{ id: "old", name: "old" }, { id: "new", name: "new" },
      { id: "moving", name: "moving", parent_category_id: "old" },
      { id: "leaf", name: "leaf", parent_category_id: "moving" },
      { id: "sibling", name: "sibling", parent_category_id: "old" }])
      await run(runLogicalProductCommand(runtime.commands.createCategories, category));
    const input = { id: "moving", data: { parent_category_id: "new", rank: 0 } };
    const before = await logicalCurrencyInventory(currency);
    const schema = (await currency.persistence.query<{ schema: string }>(
      "select current_schema() as schema")).rows[0]?.schema;
    if (schema === undefined) throw new Error("Missing Category test schema");
    const functionName = quote(schema) + "." + quote("fx_category_move_fail");
    const tableName = quote(schema) + "." + quote("fx_app_row_current");
    const sequenceName = quote(schema) + "." + quote("fx_category_move_attempts");
    const sequenceLiteral = sequenceName.replaceAll("'", "''");
    await currency.persistence.exec(`create sequence ${sequenceName}`);
    await currency.persistence.exec(`create function ${functionName}() returns trigger language plpgsql as $$
      begin if nextval('${sequenceLiteral}') >= 2 then
        raise exception 'injected Category materialization failure';
      end if; return new; end $$`);
    let triggerCreated = false;
    try {
      await currency.persistence.exec(`create trigger fx_category_move_fail before update on ${tableName}
        for each row execute function ${functionName}()`);
      triggerCreated = true;
      await expect(run(runLogicalProductCommand(runtime.commands.updateCategories, input)))
        .rejects.toMatchObject({ reason: "statementFailure" });
      expect((await currency.persistence.query<{ last_value: number; is_called: boolean }>(
        `select last_value::integer as last_value, is_called from ${sequenceName}`)).rows)
        .toEqual([{ last_value: 2, is_called: true }]);
      expect(await logicalCurrencyInventory(currency)).toEqual(before);
    } finally {
      if (triggerCreated) await currency.persistence.exec(`drop trigger fx_category_move_fail on ${tableName}`);
      await currency.persistence.exec(`drop function ${functionName}()`);
      await currency.persistence.exec(`drop sequence ${sequenceName}`);
    }
    const key = writer.newRequestKey();
    const result = await run(runLogicalProductCommand(runtime.commands.updateCategories, input, key));
    const after = await logicalCurrencyInventory(currency);
    expect(await decoded(await run(reader.read(runtime.commands.countCategories,
      { filters: { id: ["moving", "leaf", "sibling"] } }))))
      .toMatchObject([expect.arrayContaining([
        expect.objectContaining({ id: "moving", parent_category_id: "new", mpath: "new.moving", rank: 0 }),
        expect.objectContaining({ id: "leaf", parent_category_id: "moving", mpath: "new.moving.leaf" }),
        expect.objectContaining({ id: "sibling", rank: 0 }),
      ]), 3]);
    expect(after.rowChanges.length - before.rowChanges.length).toBe(3);
    expect(after.events.length - before.events.length).toBe(3);
    expect(await run(runLogicalProductCommand(runtime.commands.updateCategories, input, key))).toEqual(result);
    expect(await logicalCurrencyInventory(currency)).toEqual(after);
  }, 180_000);

  it("preserves the Product while deleting leaf membership and closing sibling ranks", async () => {
    const { currency, product: { runtime }, reader, writer } = getLogicalProductRunnerFixture();
    await run(runLogicalProductCommand(runtime.commands.create,
      { id: "product", title: "product", handle: "product" }));
    await run(runLogicalProductCommand(runtime.commands.createCategories, { id: "root", name: "root" }));
    await run(runLogicalProductCommand(runtime.commands.createCategories,
      { id: "leaf", name: "leaf", parent_category_id: "root", products: [{ id: "product" }] }));
    await run(runLogicalProductCommand(runtime.commands.createCategories,
      { id: "sibling", name: "sibling", parent_category_id: "root" }));
    const before = await logicalCurrencyInventory(currency);
    const key = writer.newRequestKey();
    const result = await run(runLogicalProductCommand(runtime.commands.deleteCategories, "leaf", key));
    const after = await logicalCurrencyInventory(currency);
    expect(await run(reader.read(runtime.commands.retrieve, { id: "product" })))
      .toMatchObject({ id: "product", title: "product" });
    expect(await decoded(await run(reader.read(runtime.commands.countCategories,
      { filters: {}, config: { relations: ["products"] } }))))
      .toMatchObject([expect.arrayContaining([
        expect.objectContaining({ id: "root" }),
        expect.objectContaining({ id: "sibling", rank: 0 }),
      ]), 2]);
    expect(after.rowChanges.length - before.rowChanges.length).toBe(3);
    expect(after.revisions.filter(row => row.isTombstone).length -
      before.revisions.filter(row => row.isTombstone).length).toBe(2);
    expect(after.events.length - before.events.length).toBe(2);
    expect(await run(runLogicalProductCommand(runtime.commands.deleteCategories, "leaf", key))).toEqual(result);
    expect(await logicalCurrencyInventory(currency)).toEqual(after);
  }, 180_000);

  it("records final rank facts and authenticated batch events on replay", async () => {
    const { currency, product, product: { runtime }, reader, writer } = getLogicalProductRunnerFixture();
    await run(runLogicalProductCommand(runtime.commands.createCategories,
      { id: "existing", name: "existing" }));
    const before = await logicalCurrencyInventory(currency);
    const input = [{ id: "first", name: "first", rank: 0 }, { id: "second", name: "second", rank: 0 }];
    const catalog = await run(captureProductSchema("category-batch-receipt")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const revision = createHash("sha256").update("category-batch-receipt").digest("hex");
    const names = [catalog.category.createdEvent, catalog.category.updatedEvent];
    const contracts = names.map(name => defineCommerceEventContract({
      name, revision, internal: true, decode: runtime.logicalPolicy.capture,
    }));
    const byName = new Map(names.map((name, index) => [name, contracts[index]]));
    for (const damage of ["missing", "duplicate", "wrongCommand"] as const) {
      let observed: { call: Parameters<typeof runtime.logicalPolicy.validateLogicalCall>[0];
        activity: Parameters<typeof runtime.logicalPolicy.validateLogicalCall>[1] } | undefined;
      const participant = defineAtomicCommerceParticipant("product");
      const root = defineAtomicCommerceCommand("categoryBatchForgedReceipt", (ctx, selected) =>
        ctx.call(participant, runtime.commands.createCategories, selected));
      const forged = await run(makeAtomicCommerceHost({ ...currency.hostInput,
        identityAndAccessPolicy: { profile: `category-batch-forged-${damage}` },
        participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
          commands: [runtime.commands.createCategories],
          validateLogicalCall: (call, activity, command) => {
            observed = { call, activity };
            return runtime.logicalPolicy.validateLogicalCall(
              damage === "missing" ? { ...call, events: call.events.slice(1) }
                : damage === "duplicate" ? { ...call, events: [...call.events, ...call.events] }
                  : { ...call, commandName: "productOtherCommand" }, activity, command);
          },
          events: { contracts, select: message => {
            const contract = isJsonObject(message) && typeof message.name === "string"
              ? byName.get(message.name) : undefined;
            return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract);
          } } }],
        commands: [root], events: { producerRevision: revision, contracts,
          subscribers: [{ id: "category-batch-forged-receipt", revision }],
          validate: events => events.some(event => !event.internal)
            ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
      }));
      try {
        await expect(run(forged.run(forged.newRequestKey(), root, input)))
          .rejects.toMatchObject({ reason: damage === "wrongCommand" ? "invalidAuthority" : "receiptMismatch" });
        if (damage === "wrongCommand") {
          if (observed === undefined) throw new Error("Missing native Category call observation");
          await expect(run(productCallReceipts(catalog).validateLogicalCall(
            { ...observed.call, commandName: "productOtherCommand" }, observed.activity)))
            .rejects.toMatchObject({ reason: "receiptMismatch" });
        }
        expect(await logicalCurrencyInventory(currency)).toEqual(before);
      } finally {
        await run(forged.close);
      }
    }
    const key = writer.newRequestKey();
    const result = await run(runLogicalProductCommand(runtime.commands.createCategories, input, key));
    const after = await logicalCurrencyInventory(currency);
    expect(await decoded(await run(reader.read(runtime.commands.countCategories, { filters: {} }))))
      .toMatchObject([expect.arrayContaining([
        expect.objectContaining({ id: "existing", rank: 2 }),
        expect.objectContaining({ id: "first", rank: 1 }),
        expect.objectContaining({ id: "second", rank: 0 }),
      ]), 3]);
    expect(after.rowChanges.length - before.rowChanges.length).toBe(3);
    expect(after.events.slice(before.events.length)).toHaveLength(3);
    expect(await run(runLogicalProductCommand(runtime.commands.createCategories, input, key))).toEqual(result);
    expect(await logicalCurrencyInventory(currency)).toEqual(after);
  }, 180_000);

  it("refuses cycles, forged paths, invalid ranks and foreign inputs without publication", async () => {
    const { currency, product: { runtime } } = getLogicalProductRunnerFixture();
    for (const category of [{ id: "root", name: "root" }, { id: "other", name: "other" },
      { id: "child", name: "child", parent_category_id: "root" }])
      await run(runLogicalProductCommand(runtime.commands.createCategories, category));
    const before = await logicalCurrencyInventory(currency);
    for (const input of [{ id: "root", data: { parent_category_id: "child" } },
      { id: "root", data: { parent_category_id: "root" } },
      { id: "child", data: { mpath: "forged" } }, { id: "child", data: { rank: -1 } },
      { id: "child", data: { scopeId: "foreign" } }])
      await expect(run(runLogicalProductCommand(runtime.commands.updateCategories, input)))
        .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    await expect(run(runLogicalProductCommand(runtime.commands.upsertCategories, [
      { id: "root", parent_category_id: "other" }, { id: "other", parent_category_id: "root" },
    ]))).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    for (const input of [{ id: "ambiguous.id", name: "bad" }, { id: "__root__", name: "bad" },
      { name: "bad", parent_category_id: "__root__" },
      { name: "bad", products: [{ id: "missing" }] }])
      await expect(run(runLogicalProductCommand(runtime.commands.createCategories, input)))
        .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
    expect(await logicalCurrencyInventory(currency)).toEqual(before);
  }, 180_000);
}) });
