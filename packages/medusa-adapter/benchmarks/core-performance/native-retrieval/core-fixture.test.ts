import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { prepareRetrievalCoreFixture, retrievalCoreMetadataEvidence } from "./core-fixture";
import { nativeRetrievalMetadataVariants, nativeRetrievalRelevantDemand } from "./fixtures";
import { createCoreProductFixture } from "../../../test/support/core-product-fixture";
import { makeCoreSchemaBundle } from "../../../../persistence-postgres/src/core/schemaBundle";
import { compileProductCoreDefinition } from "../../../src/modules/product/schema";
import { coreProductFixtureTarget } from "../../../test/support/core-product-fixture";

describe("current Core Product retrieval construction", () => {
  it.each(nativeRetrievalMetadataVariants)("compiles actual $axis=$count metadata through Core", async scale => {
    await Effect.runPromise(Effect.gen(function* () {
      const options = yield* prepareRetrievalCoreFixture(scale);
      const original = yield* compileProductCoreDefinition(coreProductFixtureTarget);
      const definition = options.definition ?? original;
      const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }, ...(options.sources ?? [])] });
      const base = retrievalCoreMetadataEvidence(yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition: original }] })).counts;
      const actual = retrievalCoreMetadataEvidence(bundle, scale);
      expect(actual.scale).toEqual(scale);
      if (scale.axis === "tables" || scale.axis === "otherSourceDefinitions")
        expect(actual.counts.tables - base.tables).toBe(scale.count);
      if (scale.axis === "indexes") expect(actual.counts.indexes - base.indexes).toBe(scale.count);
      if (scale.axis === "relations") expect(actual.counts.relations - base.relations).toBe(scale.count);
      expect(actual.counts.sources - base.sources).toBe(scale.axis === "otherSourceDefinitions" ? 1 : 0);
      for (const originalTable of original.source.definition.kind === "relational" ? original.source.definition.schema.tables : []) {
        if (definition.source.definition.kind !== "relational") throw new Error("Missing Product relational source");
        expect(definition.source.definition.schema.tables.find(table => table.identity.tableId === originalTable.identity.tableId))
          .toEqual(originalTable);
      }
    }));
  });

  it.each(nativeRetrievalMetadataVariants.filter(scale => scale.count === 100))(
    "installs $axis=$count and reads through the current Product host", async scale => {
      const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
      if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid retrieval construction driver");
      const product = await createCoreProductFixture(driver, await Effect.runPromise(prepareRetrievalCoreFixture(scale)));
      try {
        const demand = nativeRetrievalRelevantDemand(1, "scalar");
        await product.run(product.host.run(product.host.newRequestKey(), product.runtime.commands.createCollections, demand.collections));
        await product.run(product.host.run(product.host.newRequestKey(), product.runtime.commands.create, demand.products));
        const reader = await product.run(product.openReadHost());
        try {
          expect(await product.run(reader.read(product.runtime.commands.list, { filters: demand.filters,
            config: { select: [...(demand.config.select ?? [])], relations: [], take: 1, order: { id: "ASC" } } })))
            .toEqual(demand.expected);
        } finally { await product.run(reader.close); }
      } finally { await product.close(); }
    });

  it("preserves complete 1/10/100-row DTOs, missing errors and a recreated read host", async () => {
    const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
    if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid retrieval construction driver");
    const product = await createCoreProductFixture(driver);
    try {
      const reader = await product.run(product.openReadHost());
      const seed = nativeRetrievalRelevantDemand(100, "scalar");
      await product.run(product.host.run(product.host.newRequestKey(), product.runtime.commands.createCollections, seed.collections));
      await product.run(product.host.run(product.host.newRequestKey(), product.runtime.commands.create, seed.products));
      for (const count of [1, 10, 100] as const) for (const name of ["scalar", "collection"] as const) {
        const demand = nativeRetrievalRelevantDemand(count, name);
        const input = { filters: demand.filters, config: { select: [...(demand.config.select ?? [])],
          relations: [...(demand.config.relations ?? [])], order: { id: "ASC" }, take: count } };
        expect(await product.run(reader.read(product.runtime.commands.list, input))).toEqual(demand.expected);
        expect(demand.expected).toHaveLength(count);
        if (count === 1) for (const expected of demand.expected)
          expect(await product.run(reader.read(product.runtime.commands.retrieve, { id: expected.id,
            config: { select: input.config.select, relations: input.config.relations } }))).toEqual(expected);
        const recreated = await product.run(product.openReadHost());
        try {
          expect(await product.run(recreated.read(product.runtime.commands.list, input))).toEqual(demand.expected);
          if (count === 1) for (const expected of demand.expected)
            expect(await product.run(recreated.read(product.runtime.commands.retrieve, { id: expected.id,
              config: { select: input.config.select, relations: input.config.relations } }))).toEqual(expected);
        }
        finally { await product.run(recreated.close); }
      }
      await expect(product.run(reader.read(product.runtime.commands.retrieve, { id: "prod_native_missing",
        config: { select: ["id", "title", "handle", "status", "discountable", "is_giftcard"], relations: [] } })))
        .rejects.toMatchObject({ reason: "adapterFailure", cause: { type: "not_found",
          message: "Product with id: prod_native_missing was not found" } });
      await product.run(reader.close);
    } finally { await product.close(); }
  });
});
