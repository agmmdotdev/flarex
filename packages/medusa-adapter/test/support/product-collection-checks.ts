import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { getLogicalProductRunnerFixture, productIntegrationTestRunner, runLogicalProductCommand } from "./logical-product-runner";

const run = Effect.runPromise;

productIntegrationTestRunner({ moduleName: "product", testSuite: () => describe("Product Collection boundary", () => {
  it("rolls back earlier Collection and Product changes when a later upsert member fails", async () => {
    const { currency, product: { runtime } } = getLogicalProductRunnerFixture();
    await run(runLogicalProductCommand(runtime.commands.create,
      { id: "product_rollback", title: "rollback", handle: "rollback" }));
    const before = await logicalCurrencyInventory(currency);
    const input: Json = [{ title: "must-rollback", product_ids: ["product_rollback"] },
      { id: "missing-collection", title: "missing" }];
    expect(await run(Effect.result(runLogicalProductCommand(runtime.commands.upsertCollections, input))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure",
        cause: { message: 'ProductCollection with id "missing-collection" not found' } } });
    expect(await logicalCurrencyInventory(currency)).toEqual(before);
  });

  it("refuses unadmitted inputs without publication or widening ordinary Product queries", async () => {
    const { currency, product: { runtime }, reader } = getLogicalProductRunnerFixture();
    await run(runLogicalProductCommand(runtime.commands.createCollections,
      { id: "collection_refusal", title: "before" }));
    const before = await logicalCurrencyInventory(currency);
    for (const bad of [
      { product_ids: [12] }, { product_ids: "bad" }, { product_ids: Array.from({ length: 257 }, () => "id") },
      { products: [{ id: "product" }] }, { scopeId: "other" }, { created_at: "2000-01-01T00:00:00.000Z" },
    ]) expect(await run(Effect.result(runLogicalProductCommand(runtime.commands.updateCollections,
      { id: "collection_refusal", data: bad })))).toMatchObject({ _tag: "Failure",
        failure: { _tag: "CommerceTransactionError" } });
    for (const bad of [
      { filters: { title: ["bad"] } }, { filters: { handle: { $in: ["bad"] } } }, { scopeId: "other" },
      { config: { select: ["products.missing"], relations: ["products"] } },
      { config: { relations: ["products.collection"] } },
    ]) expect(await run(Effect.result(reader.read(runtime.commands.listCollections, bad))))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    expect(await run(Effect.result(reader.read(runtime.commands.list,
      { filters: { id: { $in: ["product"] } } }))))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    expect(await logicalCurrencyInventory(currency)).toEqual(before);
  });
}) });
