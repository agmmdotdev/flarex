import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { productLogicalCreateEventPolicy } from "../src/product-local-events";
import { prepareProductCreateWorkflow } from "../src/product-create-workflow";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { fxAppRowCurrent } from "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product test driver");
const cleanup: Array<() => Promise<void>> = [];
let currency: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;

async function prepareCreationHost() {
  const catalog = await Effect.runPromise(captureProductSchema("atomic-commerce")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
  const host = await Effect.runPromise(prepareProductCreateWorkflow({
    execution: { identityAndAccessPolicy: currency.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...currency.hostInput, ...composition }) },
    modules: { product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage,
      moduleEvents: productLogicalCreateEventPolicy(catalog) } },
    revision: createHash("sha256").update("logical-product-create-workflow").digest("hex"),
    subscribers: [{ id: "logical-product-create", revision: "a".repeat(64) }],
  }));
  return { catalog, host };
}

describe("native Product creation on shared logical storage", () => {
  beforeAll(async () => {
    currency = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeProduct: true });
    product = await prepareLogicalProductHost(currency);
    await Effect.runPromise(product.host.initialize([]));
    await Effect.runPromise(product.host.close);
  }, 180_000);
  afterAll(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
    if (failures.length > 0) throw new AggregateError(failures, "Logical Product fixture cleanup failed");
  }, 120_000);

  it("runs the native creation step, reads pending Products and publishes matched module events once", async () => {
    const { host } = await prepareCreationHost();
    try {
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      // Reverse ID order so the graph reader's ID ordering cannot replace the
      // native createProductsStep result order.
      const input = { products: [{ id: "prod_logical_beta", title: "Logical Beta" },
        { id: "prod_logical_alpha", title: "Logical Alpha" }] };
      const key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, input))).toMatchObject({ products: input.products });
      const afterRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const afterEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      expect(afterRows).toHaveLength(beforeRows.length + 2);
      expect(afterEvents.slice(beforeEvents.length).map(event => event.envelope.contract))
        .toEqual(["product.product.created", "product.product.created"]);
      expect(await Effect.runPromise(host.run(key, input))).toMatchObject({ products: input.products });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
      await expect(Effect.runPromise(host.run(host.newRequestKey(), { products: [
        { id: "prod_logical_conflict", title: "Logical Alpha" },
      ] }))).rejects.toMatchObject({ reason: "rollbackOnly" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
      expect((await currency.persistence.query<{ name: string }>(
        "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
        .toEqual(currency.physicalTablesBeforeCandidate);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("creates an owned Product graph with authenticated entity events and one pivot", async () => {
    const { catalog, host } = await prepareCreationHost();
    try {
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      const input = { products: [{ id: "prod_logical_graph", title: "Logical Graph",
        images: [{ id: "img_logical_graph", url: "logical-graph.png" }],
        options: [{ title: "Size", values: ["Small", "Large"] }],
        variants: [{ id: "pvar_logical_graph", title: "Small", sku: "logical-graph-small", options: { Size: "Small" } }],
      }] };
      const key = host.newRequestKey();
      const created = await Effect.runPromise(host.run(key, input));
      expect(created).toMatchObject({ products: [{ id: input.products[0]?.id, title: input.products[0]?.title,
        images: [{ id: "img_logical_graph", url: "logical-graph.png" }],
        options: [{ title: "Size", values: expect.arrayContaining([
          expect.objectContaining({ value: "Small" }), expect.objectContaining({ value: "Large" }),
        ]) }],
        variants: [{ id: "pvar_logical_graph", options: [{ value: "Small" }] }],
      }] });
      const afterRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const afterEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      expect(afterRows).toHaveLength(beforeRows.length + 7);
      expect(afterEvents.slice(beforeEvents.length).map(event => event.envelope.contract).sort()).toEqual([
        catalog.product.createdEvent, catalog.image.createdEvent, catalog.option.createdEvent,
        catalog.value.createdEvent, catalog.value.createdEvent, catalog.variant.createdEvent,
      ].sort());
      expect(await Effect.runPromise(host.run(key, input))).toEqual(created);
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
      await expect(Effect.runPromise(host.run(host.newRequestKey(), { products: [{
        id: "prod_logical_graph_conflict", title: "Logical Graph Conflict",
        options: [{ title: "Size", values: ["Small"] }],
        variants: [{ title: "Small", sku: "logical-graph-small", options: { Size: "Small" } }],
      }] }))).rejects.toMatchObject({ reason: "rollbackOnly" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);
});
