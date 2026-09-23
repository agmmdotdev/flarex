import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { defineCommerceCommand } from "../../persistence-postgres/src/commerceTransaction/commands";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/frameworkSchema/privateCanonicalValue";
import { fxAppRowCurrent } from "../../persistence-postgres/src/schema";
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
