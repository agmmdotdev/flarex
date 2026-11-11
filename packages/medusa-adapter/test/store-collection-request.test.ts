import { Effect, Schema } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { createStoreProductHttpHandler } from "@flarex/medusa-http/store-product";
import { describe, expect, it } from "vitest";
import { makeStoreProductRequestScopeFactory } from "../src/http/store-product-request";
import { prepareProductCollectionCreationWorkflow, prepareProductCollectionDeletionWorkflow } from "../src/workflows/product/collection-workflows";
import { prepareStoreProductRequestFixture } from "./support/store-product-request-fixture";
import { storeProductToken, storeProductLogger } from "./support/store-product-request-catalog";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
const object = Schema.decodeUnknownSync(Schema.JsonObject);
const collectionList = Schema.decodeUnknownSync(Schema.Struct({ collections: Schema.Array(Schema.JsonObject),
  count: Schema.Number, offset: Schema.Number, limit: Schema.Number }));

describe(`native Store Collection HTTP (${driver})`, () => {
  it("preserves defaults, scalar/array filters, order, full counts, locale, missing keys and read-only refusals", async () => {
    const tested = await prepareStoreProductRequestFixture(driver);
    try {
      await tested.fixture.run(Effect.scoped(Effect.gen(function* () {
        const common = { execution: tested.fixture.execution, modules: tested.catalog.product.collectionModules,
          revision: "1".repeat(64), subscribers: [{ id: "store-collection-seed", revision: "2".repeat(64) }] };
        const create = yield* Effect.acquireRelease(prepareProductCollectionCreationWorkflow(common), host => host.close);
        yield* create.run(create.newRequestKey(), { collections: [{ id: "pcol_store_old", title: "Old collection", handle: "old-collection" }] });
        yield* create.run(create.newRequestKey(), { collections: [{ id: "pcol_store_new", title: "New collection", handle: "new-collection" }] });
        yield* create.run(create.newRequestKey(), { collections: [{ id: "pcol_store_deleted", title: "Deleted collection", handle: "deleted-collection" }] });
        const remove = yield* Effect.acquireRelease(prepareProductCollectionDeletionWorkflow({ ...common,
          link: tested.catalog.product.collectionDeletionLink }), host => host.close);
        yield* remove.run(remove.newRequestKey(), { ids: ["pcol_store_deleted"] });
      })));
      const before = await tested.fixture.inventory();
      await tested.use(reads => Effect.gen(function* () {
        const calls: Array<{ query: unknown; options: unknown }> = [];
        const observed = { ...reads, query: { ...reads.query, graph: (query: unknown, options?: unknown) => {
          calls.push({ query, options }); return reads.query.graph(query, options);
        } } };
        const scopes = yield* makeStoreProductRequestScopeFactory({ reads: observed, container: createContainer().register({
          logger: asValue(storeProductLogger), configModule: asValue({ projectConfig: { http: {} } }),
        }) });
        const http = createStoreProductHttpHandler({ storeCors: "https://store.test", ...scopes });
        yield* Effect.promise(async () => {
          const request = async (path: string, status = 200, key: string | undefined = storeProductToken) => {
            const response = await http.handle(new Request(`https://native-store.test${path}`, { headers: {
              ...(key === undefined ? {} : { "x-publishable-api-key": key }), "x-medusa-locale": "my-MM",
            } }));
            const body = object(await response.json());
            expect(response.status, `${path}: ${JSON.stringify(body)}`).toBe(status); return body;
          };
          const defaults = collectionList(await request("/store/collections"));
          expect(defaults).toMatchObject({ count: 2, offset: 0, limit: 10 });
          expect(defaults.collections.map(row => row.id)).toEqual(["pcol_store_new", "pcol_store_old"]);
          for (const row of defaults.collections) {
            expect(Object.keys(row).toSorted()).toEqual(["id", "title", "handle", "created_at", "updated_at"].toSorted());
            expect(row.created_at).toEqual(expect.any(String));
          }
          expect(calls.at(-1)).toMatchObject({ query: { entity: "product_collection", pagination: { take: 10, skip: 0,
            order: { created_at: "DESC" } } }, options: { locale: "my-MM" } });
          const selected = object((await request("/store/collections/pcol_store_old?fields=id,title&locale=en-US")).collection);
          expect(selected).toEqual({ id: "pcol_store_old", title: "Old collection" });
          expect(calls.at(-1)?.options).toEqual({ locale: "en-US" });
          // Pinned FieldParser treats * as a relation modifier, producing the
          // empty relation path .*; retain its explicit unsupported-path refusal.
          await request("/store/collections/pcol_store_old?fields=*", 400);
          expect(calls.at(-1)).toMatchObject({ query: { fields: ["id", "title", "handle", "created_at", "updated_at", ".*"] } });
          expect(collectionList(await request("/store/collections?fields=id&order=id&limit=1&offset=1")))
            .toEqual({ collections: [{ id: "pcol_store_old" }], count: 2, offset: 1, limit: 1 });
          expect(collectionList(await request("/store/collections?fields=id&limit=0")))
            .toEqual({ collections: [], count: 2, offset: 0, limit: 0 });
          expect(collectionList(await request("/store/collections?fields=id&order=created_at&limit=1")))
            .toEqual({ collections: [{ id: "pcol_store_old" }], count: 2, offset: 0, limit: 1 });
          for (const order of ["-title", "-handle", "updated_at"]) {
            expect(collectionList(await request(`/store/collections?fields=id&order=${order}&limit=1`)))
              .toMatchObject({ collections: [{ id: "pcol_store_old" }], count: 2 });
          }
          for (const query of ["id=pcol_store_old", "title=Old%20collection", "handle=old-collection",
            "id[]=pcol_store_old", "title[]=Old%20collection", "handle[]=old-collection"]) {
            expect(collectionList(await request(`/store/collections?fields=id&${query}`)))
              .toMatchObject({ collections: [{ id: "pcol_store_old" }], count: 1 });
          }
          expect(collectionList(await request("/store/collections?fields=id&title[]=Old%20collection&title[]=New%20collection")).count).toBe(2);
          await request("/store/collections/pcol_store_deleted", 404);
          await request("/store/collections/missing", 404);
          await request("/store/collections", 400, "not-a-key");
          const absentKey = await http.handle(new Request("https://native-store.test/store/collections"));
          expect(absentKey.status).toBe(400);
          // Native schemas accept these filters, but this private DAL does not.
          // A 400 is required; no predicate may be silently dropped.
          for (const query of ["q=nonexistent", "created_at[$gt]=2020-01-01", "updated_at[$lt]=2020-01-01",
            "$or[0][title]=nonexistent", "$and[0][title]=nonexistent", "order=metadata", "fields=id,products.id",
            "fields=id,products.*", "fields=id,products.variants.id", "fields=products", "fields=%2Bproducts", "fields=*products",
            "fields=__proto__.polluted", "limit=257", "unknown=ignored"]) {
            await request(`/store/collections?${query}`, 400);
          }
          await request("/store/collections/pcol_store_old?fields=id,products.title", 400);
        });
        const wildcard = yield* reads.query.graph({ entity: "product_collection", fields: ["*"], filters: { id: "pcol_store_old" } });
        expect(wildcard.data[0]).toMatchObject({ id: "pcol_store_old", title: "Old collection" });
        expect(wildcard.data[0]).not.toHaveProperty("products");
        expect(yield* Effect.result(reads.query.graph({ entity: "variant", fields: ["id"] })))
          .toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure" } });
        expect(yield* Effect.result(reads.query.graph({ entity: "product_collection", fields: ["id"],
          pagination: { order: { id: "ASC", title: "DESC" } } })))
          .toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure" } });
      }));
      expect(await tested.fixture.inventory()).toEqual(before);
    } finally { await tested.fixture.close(); }
  });
});
