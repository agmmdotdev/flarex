import { Effect, Schema } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { createStoreProductHttpHandler } from "@flarex/medusa-http/store-product";
import { describe, expect, it } from "vitest";
import { makeStoreProductRequestScopeFactory } from "../src/http/store-product-request";
import { prepareProductRequestReadGraph } from "../src/http/product-request-reads";
import { prepareProductTagWorkflow } from "../src/workflows/product/tag";
import { prepareProductTypeCreationWorkflow } from "../src/workflows/product/type";
import { prepareProductCategoryCreationWorkflow } from "../src/workflows/product/category-workflows";
import { prepareProductCreationWorkflow } from "../src/workflows/product/creation";
import { prepareSalesChannelCreationWorkflow } from "../src/workflows/sales-channel/create";
import { prepareStoreProductRequestFixture } from "./support/store-product-request-fixture";
import { storeProductToken, storeProductLogger } from "./support/store-product-request-catalog";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
const object = Schema.decodeUnknownSync(Schema.JsonObject);
const objects = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));

describe(`native Store taxonomy HTTP (${driver})`, () => {
  it("serves native Tag/Type products and public Category trees with complete counts and read-only refusals", async () => {
    const tested = await prepareStoreProductRequestFixture(driver);
    try {
      const seeded = await tested.fixture.run(Effect.scoped(Effect.gen(function* () {
        const common = { execution: tested.fixture.execution, revision: "3".repeat(64),
          subscribers: [{ id: "store-taxonomy-seed", revision: "4".repeat(64) }] };
        const types = yield* Effect.acquireRelease(prepareProductTypeCreationWorkflow({ ...common,
          modules: tested.catalog.product.typeModules }), host => host.close);
        const createdTypes = yield* types.run(types.newRequestKey(), { product_types: [{ value: "Linked Type" }, { value: "Empty Type" }] });
        const tags = yield* Effect.acquireRelease(prepareProductTagWorkflow({ ...common,
          modules: { product: tested.catalog.product.modules.product } }), host => host.close);
        const createdTags = yield* tags.run(tags.newRequestKey(), { product_tags: [{ value: "Linked Tag" }, { value: "Empty Tag" }] });
        const type = createdTypes[0], tag = createdTags[0];
        if (type === undefined || tag === undefined) return yield* Effect.die(new Error("Missing native taxonomy fixture identities"));
        const categories = yield* Effect.acquireRelease(prepareProductCategoryCreationWorkflow({ ...common,
          modules: tested.catalog.product.categoryModules }), host => host.close);
        yield* categories.run(categories.newRequestKey(), { product_categories: [
          { id: "pcat_store_root", name: "Public Root", handle: "store-root", is_active: true },
        ] });
        yield* categories.run(categories.newRequestKey(), { product_categories: [
          { id: "pcat_store_child", name: "Public Child", handle: "store-child", parent_category_id: "pcat_store_root", is_active: true },
          { id: "pcat_store_internal", name: "Internal Child", parent_category_id: "pcat_store_root", is_active: true, is_internal: true },
          { id: "pcat_store_inactive", name: "Inactive Child", parent_category_id: "pcat_store_root", is_active: false },
        ] });
        const channels = yield* Effect.acquireRelease(prepareSalesChannelCreationWorkflow({ ...common,
          modules: { sales_channel: tested.catalog.product.modules.sales_channel } }), host => host.close);
        yield* channels.run(channels.newRequestKey(), { salesChannelsData: [{ id: "sc_active", name: "Key channel" }, { id: "sc_other", name: "Other channel" }] });
        const products = yield* Effect.acquireRelease(prepareProductCreationWorkflow({ ...common,
          modules: tested.catalog.product.modules, link: tested.catalog.product.link }), host => host.close);
        const productInputs = [
          { id: "prod_taxonomy_published", title: "Published foreign channel", handle: "taxonomy-published", status: "published",
            type_id: type.id, tag_ids: [tag.id], category_ids: ["pcat_store_root"], sales_channels: [{ id: "sc_other" }],
            options: [{ title: "Size", values: ["One"] }], variants: [{ title: "One", manage_inventory: false, options: { Size: "One" } }] },
          { id: "prod_taxonomy_draft", title: "Draft unassigned", handle: "taxonomy-draft", status: "draft",
            type_id: type.id, tag_ids: [tag.id], category_ids: ["pcat_store_root"],
            options: [{ title: "Size", values: ["One"] }], variants: [{ title: "One", manage_inventory: false, options: { Size: "One" } }] },
        ];
        yield* products.run(products.newRequestKey(), { products: productInputs });
        return { typeId: type.id, tagId: tag.id };
      })));
      const before = await tested.fixture.inventory();
      await tested.use(reads => Effect.gen(function* () {
        const calls: Array<{ query: unknown; options: unknown }> = [];
        const observed = { ...reads, query: { ...reads.query, graph: (query: unknown, options?: unknown) => {
          calls.push({ query, options });
          return reads.query.graph(query, options);
        } } };
        const scopes = yield* makeStoreProductRequestScopeFactory({ reads: observed, container: createContainer().register({
          logger: asValue(storeProductLogger), configModule: asValue({ projectConfig: { http: {} } }),
        }) });
        const http = createStoreProductHttpHandler({ storeCors: "https://store.test", ...scopes });
        yield* Effect.promise(async () => {
          const request = async (path: string, expectedStatus = 200, key = storeProductToken) => {
            const response = await http.handle(new Request(`https://native-store.test${path}`, {
              headers: { "x-publishable-api-key": key, "x-medusa-locale": "my-MM" },
            }));
            const body = object(await response.json());
            expect(response.status, `${path}: ${JSON.stringify(body)}`).toBe(expectedStatus);
            return body;
          };
          for (const [family, entity, id, value] of [
            ["product-tags", "product_tag", seeded.tagId, "Linked Tag"],
            ["product-types", "product_type", seeded.typeId, "Linked Type"],
          ] as const) {
            const path = `/store/${family}`, plural = `${entity}s`;
            const defaults = await request(path);
            expect(defaults).toMatchObject({ count: 2, offset: 0, limit: 50 });
            const row = objects(defaults[plural]).find(row => row.id === id);
            if (row === undefined) throw new Error("Missing native Store taxonomy row");
            expect(Object.keys(row).toSorted()).toEqual(["id", "value", "created_at", "updated_at", "metadata", "products"].toSorted());
            expect(row).toMatchObject({ id, value, metadata: null });
            // These pinned routes impose no Product publication/channel filter.
            expect(objects(row.products).map(product => ({ id: product.id, status: product.status })).toSorted((a, b) => String(a.id).localeCompare(String(b.id))))
              .toEqual([{ id: "prod_taxonomy_draft", status: "draft" }, { id: "prod_taxonomy_published", status: "published" }]);
            expect(calls.at(-1)).toMatchObject({ query: { entity, fields: expect.arrayContaining(["products.*"]) }, options: { locale: "my-MM" } });
            expect(object((await request(`${path}/${id}`))[entity])).toEqual(row);
            expect(await request(`${path}?fields=id&value=${encodeURIComponent(value)}`)).toEqual({ [plural]: [{ id }], count: 1, offset: 0, limit: 50 });
            expect(await request(`${path}?fields=id&id[]=${id}`)).toEqual({ [plural]: [{ id }], count: 1, offset: 0, limit: 50 });
            expect(await request(`${path}?fields=id&limit=0`)).toEqual({ [plural]: [], count: 2, offset: 0, limit: 0 });
            const selected = objects((await request(`${path}?fields=id&order=id&limit=1&offset=1`))[plural]);
            expect(selected).toHaveLength(1);
            expect((await request(`${path}?fields=id&order=id&limit=1&offset=1`)).count).toBe(2);
            expect(object((await request(`${path}/${id}?fields=id,products.id,products.status`))[entity]))
              .toMatchObject({ id, products: expect.arrayContaining([{ id: "prod_taxonomy_draft", status: "draft" }]) });
            await request(`${path}/missing`, 404);
            for (const query of ["q=not-found", "value[]=not-found", "order=-created_at", "created_at[$gt]=2020-01-01",
              "$or[0][id]=missing", "fields=products.variants.id", "fields=secret", "limit=257"])
              await request(`${path}?${query}`, 400);
            await request(path, 400, "invalid");
          }
          const path = "/store/product-categories";
          const defaults = await request(path);
          expect(defaults).toMatchObject({ count: 2, offset: 0, limit: 50 });
          const categories = objects(defaults.product_categories);
          expect(categories.map(row => row.id).toSorted()).toEqual(["pcat_store_child", "pcat_store_root"]);
          const root = categories.find(row => row.id === "pcat_store_root"), child = categories.find(row => row.id === "pcat_store_child");
          if (root === undefined || child === undefined) throw new Error("Missing native public Category tree");
          expect(objects(root.category_children).map(row => row.id)).toEqual(["pcat_store_child"]);
          expect(root.parent_category).toBeNull();
          expect(object(child.parent_category).id).toBe("pcat_store_root");
          expect(calls.at(-1)).toMatchObject({ query: { entity: "product_category", filters: { is_active: true, is_internal: false } }, options: { locale: "my-MM" } });
          expect(object((await request(`${path}/pcat_store_root`)).product_category)).toEqual(root);
          expect(await request(`${path}?fields=id&parent_category_id=pcat_store_root`))
            .toEqual({ product_categories: [{ id: "pcat_store_child" }], count: 1, offset: 0, limit: 50 });
          expect(await request(`${path}?fields=id&name=Public%20Child`))
            .toEqual({ product_categories: [{ id: "pcat_store_child" }], count: 1, offset: 0, limit: 50 });
          expect(await request(`${path}?fields=id&handle=store-root`))
            .toEqual({ product_categories: [{ id: "pcat_store_root" }], count: 1, offset: 0, limit: 50 });
          expect(await request(`${path}?fields=id&limit=1&offset=1&order=id`))
            .toEqual({ product_categories: [{ id: "pcat_store_root" }], count: 2, offset: 1, limit: 1 });
          expect(await request(`${path}?fields=id&limit=0`)).toEqual({ product_categories: [], count: 2, offset: 0, limit: 0 });
          expect(object((await request(`${path}/pcat_store_child?fields=id,name,parent_category.name&include_ancestors_tree=true`)).product_category))
            .toEqual({ id: "pcat_store_child", name: "Public Child", parent_category: { name: "Public Root" } });
          expect(objects(object((await request(`${path}/pcat_store_root?fields=id,products.id,products.status`)).product_category).products))
            .toEqual(expect.arrayContaining([{ id: "prod_taxonomy_draft", status: "draft" }, { id: "prod_taxonomy_published", status: "published" }]));
          // The pinned Category detail route tests the array itself for absence.
          for (const id of ["missing", "pcat_store_internal", "pcat_store_inactive"]) expect(await request(`${path}/${id}`)).toEqual({});
          for (const query of ["q=not-found", "name[]=not-found", "description=not-found", "order=name", "created_at[$gt]=2020-01-01",
            "$and[0][id]=missing", "fields=category_children.category_children.id", "limit=257"])
            await request(`${path}?${query}`, 400);
          expect((await http.handle(new Request(`https://native-store.test${path}`))).status).toBe(400);
        });
        const admin = yield* prepareProductRequestReadGraph(tested.catalog.product);
        expect(admin.graph.admitProjection("product_type", ["products.id"])._tag).toBe("Failure");
      }));
      expect(await tested.fixture.inventory()).toEqual(before);
    } finally { await tested.fixture.close(); }
  });
});
