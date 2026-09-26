import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { defineCommerceCommand } from "../../persistence-postgres/src/commerceTransaction/commands";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/frameworkSchema/privateCanonicalValue";
import { fxAppRowCurrent, fxAppSearchEntryCurrent } from "../../persistence-postgres/src/schema";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product test driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;

describe("native internal Product service on shared logical storage", () => {
  beforeAll(async () => {
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeProduct: true });
  }, 180_000);
  afterAll(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
    if (failures.length > 0) throw new AggregateError(failures, "Logical Product fixture cleanup failed");
  }, 120_000);

  it("selects the complete Product source for native create, read and one committed replay", async () => {
    const { runtime, hostInput: productHostInput, host } = await prepareLogicalProductHost(fixture);
    try {
      const ambiguousRows = [{ id: "not-a-table-discriminated-seed" }];
      const ambiguousSeed = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset",
        version: 1, rows: ambiguousRows }, 1_048_576, { invalidInput: () => new Error("Invalid Product seed"),
          hashFailure: cause => new Error("Product seed hash", { cause }) }));
      const ambiguous = await Effect.runPromise(makeCommerceHost({ ...productHostInput,
        logicalStorage: { ...productHostInput.logicalStorage,
          initialization: { stepId: "product-ambiguous", datasetSha256: ambiguousSeed.sha256Hex, expectedRowCount: 1 } },
      }));
      try {
        await expect(Effect.runPromise(ambiguous.initialize(ambiguousRows)))
          .rejects.toMatchObject({ reason: "unsupportedProfile" });
      } finally { await Effect.runPromise(ambiguous.close); }
      await Effect.runPromise(host.initialize([]));
      const input = { id: "logical-product", title: "Logical Product", handle: "logical-product" };
      const key = host.newRequestKey();
      const created = await Effect.runPromise(host.run(key, runtime.commands.internalProductCreate, input));
      expect(created).toMatchObject(input);
      expect(await Effect.runPromise(host.run(key, runtime.commands.internalProductCreate, input))).toEqual(created);
      const beforeRefusal = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      await expect(Effect.runPromise(host.run(host.newRequestKey(), runtime.commands.internalProductCreate,
        { id: "duplicate-handle", title: "Duplicate", handle: input.handle })))
        .rejects.toMatchObject({ reason: "rollbackOnly" });
      expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRefusal);
      expect(await Effect.runPromise(host.read(runtime.commands.internalProductRetrieve,
        { id: input.id, config: { select: ["id", "title", "handle"] } }))).toMatchObject(input);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), runtime.commands.internalProductUpdate,
        { id: input.id, title: "Updated Product" }))).toMatchObject({ id: input.id, title: "Updated Product" });
      expect(await Effect.runPromise(host.read(runtime.commands.internalProductList,
        { filters: { id: input.id }, config: { select: ["id", "title"] } })))
        .toEqual([{ id: input.id, title: "Updated Product" }]);
      expect((await fixture.persistence.query<{ name: string }>(
        "select tablename as name from pg_tables where schemaname = current_schema() order by tablename"))
        .rows).toEqual(fixture.physicalTablesBeforeCandidate);
      const second = await Effect.runPromise(makeCommerceHost({ ...productHostInput,
        logicalStorage: { ...productHostInput.logicalStorage,
          initialization: { ...productHostInput.logicalStorage.initialization, stepId: "product-empty-second" } },
      }));
      try {
        await expect(Effect.runPromise(second.initialize([]))).rejects.toMatchObject({ reason: "seedMismatch" });
      } finally { await Effect.runPromise(second.close); }
      await Effect.runPromise(host.run(host.newRequestKey(), runtime.commands.internalProductSoftDelete, input.id));
      expect(await Effect.runPromise(host.read(runtime.commands.internalProductList,
        { filters: { id: input.id }, config: { select: ["id"] } }))).toEqual([]);
      await Effect.runPromise(host.run(host.newRequestKey(), runtime.commands.internalProductRestore, input.id));
      expect(await Effect.runPromise(host.read(runtime.commands.internalProductList,
        { filters: { id: input.id }, config: { select: ["id", "title"] } })))
        .toEqual([{ id: input.id, title: "Updated Product" }]);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("finds deleted Products through the shared indexed text search", async () => {
    const { runtime, hostInput, host: base } = await prepareLogicalProductHost(fixture);
    await Effect.runPromise(base.close);
    const host = await Effect.runPromise(makeCommerceHost({ ...hostInput,
      commands: [...hostInput.commands, runtime.commands.list, runtime.commands.count] }));
    try {
      await Effect.runPromise(host.initialize([]));
      for (const input of [
        { id: "search_active", title: "Needle", handle: "search-active" },
        { id: "search_deleted", title: "NEEDLE", handle: "search-deleted" },
        { id: "search_backslash", title: "Back\\slash", handle: "search-backslash" },
      ]) await Effect.runPromise(host.run(host.newRequestKey(), runtime.commands.internalProductCreate, input));
      await Effect.runPromise(host.run(host.newRequestKey(), runtime.commands.internalProductSoftDelete, "search_deleted"));
      const search = (q: string, withDeleted = true) => host.read(runtime.commands.internalProductList,
        { filters: { q }, config: { select: ["id"], withDeleted } });
      expect(await Effect.runPromise(search("needle"))).toEqual([{ id: "search_active" }, { id: "search_deleted" }]);
      expect(await Effect.runPromise(host.read(runtime.commands.count,
        { filters: { q: "needle" }, config: { select: ["id"], withDeleted: true } })))
        .toMatchObject([[{ id: "search_active" }, { id: "search_deleted" }], 2]);
      expect(await Effect.runPromise(search("needle", false))).toEqual([{ id: "search_active" }]);
      expect(await Effect.runPromise(search("nee%le"))).toEqual([{ id: "search_active" }, { id: "search_deleted" }]);
      expect(await Effect.runPromise(search("nee_le"))).toEqual([{ id: "search_active" }, { id: "search_deleted" }]);
      expect(await Effect.runPromise(search("back\\sl"))).toEqual([{ id: "search_backslash" }]);
      await Effect.runPromise(host.run(host.newRequestKey(), runtime.commands.internalProductUpdate,
        { id: "search_active", title: "Haystack" }));
      expect(await Effect.runPromise(search("needle"))).toEqual([{ id: "search_deleted" }]);
      await Effect.runPromise(host.run(host.newRequestKey(), runtime.commands.internalProductRestore, "search_deleted"));
      expect(await Effect.runPromise(search("needle", false))).toEqual([{ id: "search_deleted" }]);
      expect(await Effect.runPromise(search("n", false))).toEqual([{ id: "search_deleted" }]);
      await expect(Effect.runPromise(search("n"))).rejects.toMatchObject({ reason: "rollbackOnly" });
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("includes a same-command Product in indexed search before publication", async () => {
    const { runtime, hostInput, host: base } = await prepareLogicalProductHost(fixture);
    await Effect.runPromise(base.close);
    const createAndSearch = defineCommerceCommand("logicalProductCreateAndSearch", "write", Effect.fn(function* (ctx) {
      yield* ctx.nested(runtime.commands.internalProductCreate,
        { id: "search_pending", title: "Pendingneedle", handle: "search-pending" });
      const table = yield* ctx.table("product");
      return yield* table.find(ctx.manager, { fields: ["id"], take: 10,
        order: { column: "id", direction: "asc" },
        predicate: { kind: "textLikeAscii", column: "title", pattern: "%pendingneedle%" } });
    }));
    const host = await Effect.runPromise(makeCommerceHost({ ...hostInput,
      commands: [...hostInput.commands, createAndSearch] }));
    try {
      await Effect.runPromise(host.initialize([]));
      expect(await Effect.runPromise(host.run(host.newRequestKey(), createAndSearch, {})))
        .toEqual([{ id: "search_pending" }]);
      expect(await Effect.runPromise(host.read(runtime.commands.internalProductList,
        { filters: { q: "pendingneedle" }, config: { select: ["id"], withDeleted: true } })))
        .toEqual([{ id: "search_pending" }]);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("rolls back the Product revision when search maintenance fails late", async () => {
    const { runtime, host } = await prepareLogicalProductHost(fixture);
    try {
      await Effect.runPromise(host.initialize([]));
      await Effect.runPromise(host.run(host.newRequestKey(), runtime.commands.internalProductCreate,
        { id: "search_rollback", title: "Before", handle: "search-rollback" }));
      const beforeRows = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeSearch = await fixture.persistence.drizzle.select().from(fxAppSearchEntryCurrent);
      await fixture.persistence.exec(`create function fx_search_rollback_fail() returns trigger language plpgsql as $$
        begin raise exception 'injected search maintenance failure'; end $$`);
      await fixture.persistence.exec(`create trigger fx_search_rollback_fail after insert on fx_app_search_entry_current
        for each row execute function fx_search_rollback_fail()`);
      try {
        await expect(Effect.runPromise(host.run(host.newRequestKey(), runtime.commands.internalProductUpdate,
          { id: "search_rollback", title: "After" }))).rejects.toThrow();
        expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
        expect(await fixture.persistence.drizzle.select().from(fxAppSearchEntryCurrent)).toEqual(beforeSearch);
      } finally {
        await fixture.persistence.exec("drop trigger fx_search_rollback_fail on fx_app_search_entry_current");
        await fixture.persistence.exec("drop function fx_search_rollback_fail()");
      }
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("selects beyond unrelated rows and refuses an incomplete matching set", async () => {
    const { runtime, host } = await prepareLogicalProductHost(fixture);
    try {
      await Effect.runPromise(host.initialize([]));
      const create = async (prefix: string, count: number, title: (index: number) => string) => {
        for (let start = 0; start < count; start += 32) {
          const rows = Array.from({ length: Math.min(32, count - start) }, (_, offset) => {
            const index = start + offset;
            return { id: `${prefix}_${index}`, title: title(index), handle: `${prefix}-${index}` };
          });
          await Effect.runPromise(host.run(host.newRequestKey(), runtime.commands.internalProductCreate, rows));
        }
      };
      await create("search_unrelated", 129, index => `Unrelated ${index}`);
      await create("search_target", 1, () => "Findable needle");
      const input = (q: string) => ({ filters: { q }, config: { select: ["id"], withDeleted: true } });
      expect(await Effect.runPromise(host.read(runtime.commands.internalProductList, input("findable"))))
        .toEqual([{ id: "search_target_0" }]);
      expect(await Effect.runPromise(host.read(runtime.commands.internalProductList,
        { filters: { q: "findable" }, config: { select: ["id"] } })))
        .toEqual([{ id: "search_target_0" }]);
      await create("search_overflow", 129, () => "Overflowtoken");
      await expect(Effect.runPromise(host.read(runtime.commands.internalProductList, input("overflowtoken"))))
        .rejects.toMatchObject({ reason: "rollbackOnly" });
    } finally { await Effect.runPromise(host.close); }
  }, 240_000);

  it("refuses search serving when the shared physical GIN path is absent", async () => {
    const { runtime, host } = await prepareLogicalProductHost(fixture);
    try {
      await Effect.runPromise(host.initialize([]));
      await fixture.persistence.exec("drop index fx_app_search_entry_current_lookup_gin");
      try {
        await expect(Effect.runPromise(host.read(runtime.commands.internalProductList,
          { filters: { q: "needle" }, config: { select: ["id"], withDeleted: true } })))
          .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      } finally {
        await fixture.persistence.exec(`create index fx_app_search_entry_current_lookup_gin
          on fx_app_search_entry_current using gin (scope_uuid public.uuid_ops,
            logical_index_id public.int4_ops, folded_text public.gin_trgm_ops)`);
      }
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("refuses a same-name GIN index without the scope and definition keys", async () => {
    const { runtime, host } = await prepareLogicalProductHost(fixture);
    try {
      await Effect.runPromise(host.initialize([]));
      await fixture.persistence.exec("drop index fx_app_search_entry_current_lookup_gin");
      await fixture.persistence.exec(`create index fx_app_search_entry_current_lookup_gin
        on fx_app_search_entry_current using gin (folded_text public.gin_trgm_ops)`);
      try {
        await expect(Effect.runPromise(host.read(runtime.commands.internalProductList,
          { filters: { q: "needle" }, config: { select: ["id"] } })))
          .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      } finally {
        await fixture.persistence.exec("drop index fx_app_search_entry_current_lookup_gin");
        await fixture.persistence.exec(`create index fx_app_search_entry_current_lookup_gin
          on fx_app_search_entry_current using gin (scope_uuid public.uuid_ops,
            logical_index_id public.int4_ops, folded_text public.gin_trgm_ops)`);
      }
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("cascades one Product image without reading unrelated image rows", async () => {
    const { runtime, hostInput, host: base } = await prepareLogicalProductHost(fixture);
    await Effect.runPromise(base.close);
    const seedImages = defineCommerceCommand("logicalProductSeedImages", "write", Effect.fn("ProductTest.seedImages")(function* (ctx, rows: unknown) {
      const store = yield* ctx.table("image");
      return yield* store.write(ctx.manager, "insert", rows);
    }));
    const readImage = defineCommerceCommand("logicalProductReadImage", "read", Effect.fn("ProductTest.readImage")(function* (ctx, id) {
      if (typeof id !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
      const store = yield* ctx.table("image");
      return yield* store.find(ctx.manager, { take: 1, order: { column: "id", direction: "asc" },
        predicate: { kind: "in", column: "id", values: [id] } });
    }));
    const host = await Effect.runPromise(makeCommerceHost({ ...hostInput,
      commands: [...hostInput.commands, seedImages, readImage],
    }));
    try {
      await Effect.runPromise(host.initialize([]));
      for (const id of ["prod_selected", "prod_unrelated"]) await Effect.runPromise(host.run(host.newRequestKey(),
        runtime.commands.internalProductCreate, { id, title: id, handle: id }));
      for (let start = 0; start < 130; start += 20) {
        const rows = Array.from({ length: Math.min(20, 130 - start) }, (_, offset) => {
          const index = start + offset;
          return { id: `img_unrelated_${index}`, url: `unrelated-${index}`, product_id: "prod_unrelated" };
        });
        await Effect.runPromise(host.run(host.newRequestKey(), seedImages, rows));
      }
      await Effect.runPromise(host.run(host.newRequestKey(), seedImages,
        [{ id: "img_selected", url: "selected", product_id: "prod_selected" }]));
      await Effect.runPromise(host.run(host.newRequestKey(), runtime.commands.internalProductSoftDelete, "prod_selected"));
      expect(await Effect.runPromise(host.read(readImage, "img_selected"))).toMatchObject([{ id: "img_selected", deleted_at: expect.any(String) }]);
      expect(await Effect.runPromise(host.read(readImage, "img_unrelated_129"))).toMatchObject([{ id: "img_unrelated_129", deleted_at: null }]);
      await Effect.runPromise(host.run(host.newRequestKey(), runtime.commands.internalProductRestore, "prod_selected"));
      expect(await Effect.runPromise(host.read(readImage, "img_selected"))).toMatchObject([{ id: "img_selected", deleted_at: null }]);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);
});
