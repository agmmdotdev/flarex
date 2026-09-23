import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/frameworkSchema/privateCanonicalValue";
import { makeLocalProductCommands } from "../src/product-service";
import { fxAppRowCurrent } from "../../persistence-postgres/src/schema";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";

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
    const definition = fixture.productDefinition;
    if (definition === undefined) throw new Error("Missing Product source");
    const runtime = await Effect.runPromise(makeLocalProductCommands());
    const seed = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset",
      version: 1, rows: [] }, 1_048_576, { invalidInput: () => new Error("Invalid Product seed"),
        hashFailure: cause => new Error("Product seed hash", { cause }) }));
    const { hostInput } = fixture;
    const productHostInput = { ...hostInput,
      identityAndAccessPolicy: { profile: "logical-product-internal-test" },
      logicalStorage: { ...hostInput.logicalStorage,
        source: { sourceKey: "medusa.product", writeProfile: "medusa.product",
          schema: definition.schema, evidence: definition.provenance },
        initialization: { stepId: "product-empty", datasetSha256: seed.sha256Hex,
          expectedRowCount: 0 },
      },
      commands: [runtime.commands.internalProductCreate, runtime.commands.internalProductRetrieve,
        runtime.commands.internalProductList, runtime.commands.internalProductUpdate,
        runtime.commands.internalProductSoftDelete, runtime.commands.internalProductRestore],
    };
    const host = await Effect.runPromise(makeCommerceHost(productHostInput));
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
});
