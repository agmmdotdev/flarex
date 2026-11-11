import { Cause, Effect, Exit, Schema, Scope } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { createAdminProductHttpHandler } from "@flarex/medusa-http/admin-product";
import { makePreparedHostRuntime, PreparedHostRuntimeError } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string";
import { coreNativeRelationalRow } from "../../persistence-postgres/src/core/nativeRelationalQuery";
import { describe, expect, it } from "vitest";
import { makeProductRequestOperations, makeProductRequestScopeFactory, type ProductRequestOperations } from "../src/http/product-request";
import { prepareProductRequestFixture } from "./support/product-request-fixture";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
const decodeEnvelope = Schema.decodeUnknownSync(Schema.JsonObject);
const decodeId = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString }));
const productGraphFields = ["id", "title", "collection_id", "collection.id", "categories.id", "variants.id", "variants.sku",
  "variants.price_set.id", "variants.price_set.prices.*", "variants.inventory_items.*", "variants.inventory_items.inventory.*"];

const makeHttp = Effect.fn("CategoryCollectionTest.makeHttp")(function* (operations: ProductRequestOperations) {
  const scopes = yield* makeProductRequestScopeFactory({ operations,
    container: createContainer().register({ logger: asValue({ error() {}, info() {} }) }) });
  const handler = createAdminProductHttpHandler({ adminCors: "https://admin.example", ...scopes,
    resolveAdminPrincipal: () => ({ actor_id: "taxonomy-admin", actor_type: "user", auth_identity_id: "taxonomy-auth", app_metadata: {}, user_metadata: {} }),
    evaluateAdminPolicies: () => true, admitProductRefetchFields: operations.admitProductRefetchFields,
    admitVariantRefetchFields: operations.admitVariantRefetchFields, admitSalesChannelRefetchFields: operations.admitSalesChannelRefetchFields, admitPriceListRefetchFields: operations.admitPriceListRefetchFields, admitCatalogRefetchFields: operations.admitCatalogRefetchFields });
  return Effect.fn("CategoryCollectionTest.request")(function* (path: string, method = "GET", body?: unknown, status = 200) {
    const response = yield* Effect.promise(() => handler.handle(new Request("https://private.test" + path, {
      method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })));
    const json = decodeEnvelope(yield* Effect.promise(() => response.json()));
    expect(response.status, method + " " + path + ": " + JSON.stringify(json)).toBe(status);
    return json;
  });
});

describe(`native Category and Collection HTTP on Core (${driver})`, () => {
  it("runs Category CRUD with native default trees, projection masking, ranks, metadata and missing distinctions", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      await tested.use(operations => Effect.gen(function* () {
        const request = yield* makeHttp(operations);
        const path = "/admin/product-categories";
        const root = decodeId((yield* request(path, "POST", { name: "Root", handle: "http-root", description: "Native root",
          is_active: true, is_internal: false, metadata: { keep: "old", remove: "old" } })).product_category);
        const childResponse = yield* request(path, "POST", { name: "Child", handle: "http-child", parent_category_id: root.id,
          rank: 0, is_active: true });
        const child = decodeId(childResponse.product_category);
        expect(childResponse.product_category).toMatchObject({ name: "Child", parent_category_id: root.id, rank: 0 });
        const leafResponse = yield* request(path, "POST", { name: "Leaf", parent_category_id: child.id });
        const leaf = decodeId(leafResponse.product_category);
        expect(leafResponse.product_category).toMatchObject({ handle: "leaf", description: "", rank: 0,
          is_active: false, is_internal: false, metadata: null, parent_category_id: child.id });
        expect(yield* request(path + "/" + root.id)).toMatchObject({ product_category: { id: root.id, name: "Root", description: "Native root",
          parent_category: null, category_children: [{ id: child.id, category_children: [{ id: leaf.id, category_children: [] }] }] } });
        expect(yield* request(path + "/" + leaf.id)).toMatchObject({ product_category: { id: leaf.id,
          parent_category: { id: child.id, parent_category: { id: root.id, parent_category: null } }, category_children: [] } });
        expect(yield* request(path + "/" + child.id + "?fields=parent_category_id"))
          .toEqual({ product_category: { id: child.id, parent_category_id: root.id } });
        expect(yield* request(path + "/" + child.id + "?fields=id&include_ancestors_tree=true&include_descendants_tree=true"))
          .toEqual({ product_category: { id: child.id } });
        expect(yield* request(path + "/" + child.id + "?fields=id,parent_category.*,category_children.*&include_ancestors_tree=true&include_descendants_tree=true"))
          .toMatchObject({ product_category: { id: child.id, parent_category: { id: root.id }, category_children: [{ id: leaf.id }] } });
        expect(yield* request(path + "?fields=id&order=id&limit=1&offset=1"))
          .toMatchObject({ product_categories: [expect.objectContaining({ id: expect.any(String) })], count: 3, offset: 1, limit: 1 });
        const ids = [root.id, child.id, leaf.id].sort();
        expect(yield* request(path + "?fields=id&order=id")).toEqual({ product_categories: ids.map(id => ({ id })), count: 3, offset: 0, limit: 50 });
        expect(yield* request(path + "?fields=id&id[]=" + child.id + "&id[]=" + leaf.id + "&order=id"))
          .toEqual({ product_categories: [child.id, leaf.id].sort().map(id => ({ id })), count: 2, offset: 0, limit: 50 });
        expect(yield* request(path + "?fields=id,parent_category_id&parent_category_id[]=" + root.id))
          .toEqual({ product_categories: [{ id: child.id, parent_category_id: root.id }], count: 1, offset: 0, limit: 50 });
        expect(yield* request(path + "/" + leaf.id + "?fields=id,parent_category_id,rank", "POST", { parent_category_id: root.id, rank: 100 }))
          .toEqual({ product_category: { id: leaf.id, parent_category_id: root.id, rank: 1 } });
        expect(yield* request(path + "/" + leaf.id + "?fields=id,parent_category_id,rank", "POST", { rank: 0 }))
          .toEqual({ product_category: { id: leaf.id, parent_category_id: root.id, rank: 0 } });
        const ranked = yield* request(path + "?fields=id,rank&order=-rank");
        expect(ranked).toEqual({ product_categories: [{ id: child.id, rank: 1 }, expect.objectContaining({ rank: 0 }), expect.objectContaining({ rank: 0 })],
          count: 3, offset: 0, limit: 50 });
        expect(ranked.product_categories).toEqual(expect.arrayContaining([{ id: root.id, rank: 0 }, { id: leaf.id, rank: 0 }]));
        expect(yield* request(path + "/" + root.id + "?fields=id,name,metadata", "POST", { name: "Renamed", metadata: { fresh: true } }))
          .toEqual({ product_category: { id: root.id, name: "Renamed", metadata: { fresh: true } } });
        expect(yield* request(path + "/" + root.id + "?fields=id,metadata", "POST", {}))
          .toEqual({ product_category: { id: root.id, metadata: { fresh: true } } });
        expect(yield* request(path + "/" + root.id + "?fields=id,metadata", "POST", { metadata: {} }))
          .toEqual({ product_category: { id: root.id, metadata: {} } });
        expect(yield* request(path + "/" + root.id + "?fields=id,metadata", "POST", { metadata: null }))
          .toEqual({ product_category: { id: root.id, metadata: null } });
        yield* request(path + "/missing", "GET", undefined, 404);
        expect(yield* request(path + "/missing", "POST", { name: "No native existence pre-read" })).toEqual({});
        for (const id of [leaf.id, child.id, root.id]) {
          expect(yield* request(path + "/" + id, "DELETE")).toEqual({ id, object: "product_category", deleted: true });
        }
        expect(yield* request(path)).toEqual({ product_categories: [], count: 0, offset: 0, limit: 50 });
        // The native soft-delete service requires a real row; this differs from
        // Collection's successful missing delete and from Category missing GET.
        yield* request(path + "/missing", "DELETE", undefined, 404);
      }));
    } finally { await tested.fixture.close(); }
  }, 300_000);

  it("runs Collection CRUD and both membership routes while preserving real Product, Price and Inventory graphs", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      await tested.use(operations => Effect.gen(function* () {
        const request = yield* makeHttp(operations);
        const categoryPath = "/admin/product-categories", collectionPath = "/admin/collections";
        const category = decodeId((yield* request(categoryPath, "POST", { name: "Selected", handle: "membership-selected" })).product_category);
        const otherCategory = decodeId((yield* request(categoryPath, "POST", { name: "Other", handle: "membership-other" })).product_category);
        const collection = decodeId((yield* request(collectionPath, "POST", { title: "Selected", handle: "membership-selected",
          metadata: { keep: "yes", drop: "old" }, additional_data: { source: "native-http" } })).collection);
        const otherCollectionResponse = yield* request(collectionPath, "POST", { title: "Other" });
        const otherCollection = decodeId(otherCollectionResponse.collection);
        expect(otherCollectionResponse.collection).toMatchObject({ title: "Other", handle: "other", metadata: null });
        expect(yield* request(collectionPath)).toMatchObject({ collections: [expect.any(Object), expect.any(Object)], count: 2, offset: 0, limit: 10 });
        expect(yield* request(collectionPath + "/" + collection.id)).toMatchObject({ collection: { id: collection.id, title: "Selected" } });
        expect(yield* request(collectionPath + "?fields=id&order=id&limit=1&offset=1"))
          .toEqual({ collections: [{ id: [collection.id, otherCollection.id].sort()[1] }], count: 2, offset: 1, limit: 1 });
        expect(yield* request(collectionPath + "/" + collection.id + "?fields=id,title,metadata", "POST",
          { title: "Changed", metadata: { drop: "", nested: { fresh: true } }, additional_data: { update: true } }))
          .toEqual({ collection: { id: collection.id, title: "Changed", metadata: { keep: "yes", nested: { fresh: true } } } });
        expect(yield* request(collectionPath + "/" + collection.id + "?fields=id,metadata", "POST", { metadata: {} }))
          .toEqual({ collection: { id: collection.id, metadata: {} } });
        expect(yield* request(collectionPath + "/" + collection.id + "?fields=id,metadata", "POST", { metadata: null }))
          .toEqual({ collection: { id: collection.id, metadata: null } });
        expect(yield* request(collectionPath + "/missing")).toEqual({});
        yield* request(collectionPath + "/missing", "POST", { title: "Missing" }, 404);

        const created = yield* operations.runWorkflow("create-products", { products: ["Selected", "Unrelated"].map(title => ({
          title, handle: "taxonomy-http-" + title.toLowerCase(), options: [{ title: "Size", values: ["One"] }],
          variants: [{ title: "Managed", sku: "taxonomy-http-" + title.toLowerCase(), options: { Size: "One" },
            prices: [{ amount: 2300, currency_code: "usd" }] }],
        })) });
        const selectedId = created.result[0]?.id, unrelatedId = created.result[1]?.id;
        if (selectedId === undefined || unrelatedId === undefined) return yield* Effect.die(new Error("Native Product creation omitted IDs"));
        const graph = (id: string) => operations.query.graph({ entity: "product", fields: productGraphFields, filters: { id } });
        const before = (yield* graph(selectedId)).data[0], unrelated = (yield* graph(unrelatedId)).data;
        expect(before).toMatchObject({ id: selectedId, variants: [{ price_set: { prices: [expect.objectContaining({ amount: 2300 })] },
          inventory_items: [expect.objectContaining({ inventory: expect.objectContaining({ id: expect.any(String) }) })] }] });
        yield* request(categoryPath + "/" + otherCategory.id + "/products", "POST", { add: [selectedId] });
        yield* request(categoryPath + "/" + category.id + "/products", "POST", { add: [selectedId] });
        expect((yield* graph(selectedId)).data[0]).toMatchObject({ categories: expect.arrayContaining([{ id: category.id }, { id: otherCategory.id }]) });
        yield* request(categoryPath + "/" + category.id + "/products", "POST", { add: [selectedId], remove: [selectedId] });
        expect((yield* graph(selectedId)).data[0]).toMatchObject({ categories: [{ id: otherCategory.id }] });
        yield* request(categoryPath + "/" + category.id + "/products", "POST", { add: [selectedId] });
        yield* request(collectionPath + "/" + otherCollection.id + "/products?fields=id,products.id", "POST", { add: [selectedId] });
        expect((yield* graph(selectedId)).data[0]).toMatchObject({ collection_id: otherCollection.id, collection: { id: otherCollection.id } });
        yield* request(collectionPath + "/" + collection.id + "/products?fields=id,products.id", "POST", { remove: [selectedId] });
        expect((yield* graph(selectedId)).data[0]).toMatchObject({ collection_id: otherCollection.id });
        expect(yield* request(collectionPath + "/" + collection.id + "/products?fields=id,products.id,products.title", "POST", { add: [selectedId] }))
          .toEqual({ collection: { id: collection.id, products: [{ id: selectedId, title: "Selected" }] } });
        expect(yield* operations.remoteQuery(remoteQueryObjectFromString({ entryPoint: "product_collection", fields: ["id", "products.*"],
          variables: { filters: { id: collection.id } } })))
          .toEqual([expect.objectContaining({ id: collection.id, products: [expect.objectContaining({ id: selectedId, title: "Selected" })] })]);
        expect(yield* request(collectionPath + "/" + otherCollection.id + "?fields=id,products.id"))
          .toEqual({ collection: { id: otherCollection.id, products: [] } });
        yield* request(collectionPath + "/" + collection.id + "/products?fields=id,products.id", "POST", { remove: [selectedId] });
        expect((yield* graph(selectedId)).data[0]).toMatchObject({ collection_id: null, collection: null });
        yield* request(collectionPath + "/" + collection.id + "/products?fields=id,products.id", "POST", { add: [selectedId] });

        const product = tested.catalog.productRuntime.metadata;
        const categoryRelation = product.queryRelations.get(product.product.table.name)?.get("categories");
        if (categoryRelation?.join.type !== "manyToMany") return yield* Effect.die(new Error("Missing actual Category pivot metadata"));
        const localNames = new Set([product.product.table.name, categoryRelation.join.pivotTable]);
        const tableNames = new Set(tested.catalog.productSource.definition.tables.filter(table => localNames.has(table.localName ?? table.name)).map(table => table.name));
        expect(tableNames.size).toBe(2);
        const references = yield* Effect.promise(() => tested.fixture.inventory());
        const beforeDelete = (yield* graph(selectedId)).data[0];
        expect(yield* request(categoryPath + "/" + category.id, "DELETE")).toEqual({ id: category.id, object: "product_category", deleted: true });
        expect(yield* request(collectionPath + "/" + collection.id, "DELETE")).toEqual({ id: collection.id, object: "collection", deleted: true });
        const after = yield* Effect.promise(() => tested.fixture.inventory());
        expect(after.rows.filter(row => tableNames.has(row.table))).toEqual(references.rows.filter(row => tableNames.has(row.table)));
        expect((yield* graph(selectedId)).data[0]).toEqual({ ...beforeDelete, collection: null, categories: [{ id: otherCategory.id }] });
        expect((yield* graph(unrelatedId)).data).toEqual(unrelated);
        expect((yield* graph(selectedId)).data[0]?.variants).toEqual(before?.variants);
        expect(yield* request(collectionPath + "/missing", "DELETE")).toEqual({ id: "missing", object: "collection", deleted: true });
      }));
    } finally { await tested.fixture.close(); }
  }, 300_000);

  it("refuses every mutation's unsupported refetch before claims or writes and preserves the entire durable snapshot", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      await tested.use(operations => Effect.gen(function* () {
        const request = yield* makeHttp(operations);
        const category = decodeId((yield* request("/admin/product-categories", "POST", { name: "Protected", handle: "protected-category" })).product_category);
        const collection = decodeId((yield* request("/admin/collections", "POST", { title: "Protected", handle: "protected-collection" })).collection);
        const products = yield* operations.runWorkflow("create-products", { products: [{ title: "Protected", handle: "protected-product",
          options: [{ title: "Size", values: ["One"] }], variants: [{ title: "Protected One", sku: "protected-product-one", options: { Size: "One" },
            prices: [{ amount: 1000, currency_code: "usd" }] }] }] });
        const productId = products.result[0]?.id;
        if (productId === undefined) return yield* Effect.die(new Error("Missing native protected Product"));
        const before = yield* Effect.promise(() => tested.fixture.snapshot());
        for (const [path, id, create, update] of [
          ["/admin/product-categories", category.id, { name: "Must not create" }, { name: "Must not update" }],
          ["/admin/collections", collection.id, { title: "Must not create" }, { title: "Must not update" }],
        ] as const) {
          for (const [suffix, body] of [["", create], ["/" + id, update], ["/" + id + "/products", { add: [productId] }]] as const)
            yield* request(path + suffix + "?fields=id,unadmitted", "POST", body, 400);
          for (const query of ["q=unsupported", "order=-created_at", "$and[0][id]=missing"])
            yield* request(path + "?" + query, "GET", undefined, 400);
          yield* request(path, "POST", { ...create, additional_data: { unsupported: true } , metadata: [] }, 400);
          yield* request(path + "/" + id + "/products", "POST", { add: [1] }, 400);
        }
        yield* request("/admin/product-categories", "POST", { name: "Fractional rank", rank: 0.5 }, 400);
        yield* request("/admin/product-categories/" + category.id, "POST", { rank: 0.5 }, 400);
        yield* request("/admin/product-categories", "POST", { name: "Unsafe rank", rank: 1e100 }, 400);
        yield* request("/admin/product-categories/" + category.id, "POST", { rank: 1e100 }, 400);
        yield* request("/admin/product-categories", "POST", { name: "Unsupported additional data", additional_data: { custom: true } }, 400);
        yield* request("/admin/product-categories/" + category.id, "POST", { additional_data: { custom: true } }, 400);
        yield* request("/admin/product-categories", "POST", { name: "Unsupported additional data", additional_data: [] }, 400);
        yield* request("/admin/collections", "POST", { title: "Unsupported additional data", additional_data: [] }, 400);
        expect(yield* Effect.promise(() => tested.fixture.snapshot())).toEqual(before);
      }));
    } finally { await tested.fixture.close(); }
  }, 300_000);

  it("creates native HTTP Product association references with genuine pivots and rolls back invalid associations", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      await tested.use(operations => Effect.gen(function* () {
        const request = yield* makeHttp(operations);
        const type = decodeId((yield* request("/admin/product-types", "POST", { value: "Reference type" })).product_type);
        const tag = decodeId((yield* request("/admin/product-tags", "POST", { value: "Reference tag" })).product_tag);
        const parent = decodeId((yield* request("/admin/product-categories", "POST", { name: "Reference parent", handle: "reference-parent" })).product_category);
        const category = decodeId((yield* request("/admin/product-categories", "POST", { name: "Reference category", handle: "reference-category",
          parent_category_id: parent.id })).product_category);
        const collection = decodeId((yield* request("/admin/collections", "POST", { title: "Reference collection", handle: "reference-collection" })).collection);
        const body = { title: "Native HTTP references", handle: "native-http-references", type_id: type.id, collection_id: collection.id,
          tags: [{ id: tag.id }], categories: [{ id: category.id }], metadata: { source: "native-http", nested: { retained: true } },
          options: [{ title: "Size", values: ["One"] }], variants: [{ title: "Managed reference variant", sku: "native-http-references-one",
            options: { Size: "One" }, prices: [{ amount: 3456, currency_code: "usd" }] }] };
        const responseFields = ["id", "title", "type_id", "collection_id", "type.id", "collection.id", "tags.id", "categories.id",
          "variants.id", "variants.prices.*", "variants.inventory_items.*", "variants.inventory_items.inventory.*"];
        const created = yield* request("/admin/products?fields=" + responseFields.join(","), "POST", body);
        const product = decodeId(created.product);
        expect(created.product).toMatchObject({ id: product.id, title: body.title, type_id: type.id, collection_id: collection.id,
          type: { id: type.id }, collection: { id: collection.id }, tags: [{ id: tag.id }], categories: [{ id: category.id }],
          variants: [{ prices: [{ amount: 3456, currency_code: "usd" }], inventory_items: [{ required_quantity: 1,
            inventory: { sku: "native-http-references-one" } }] }] });
        const graphFields = [...productGraphFields, "type_id", "type.id", "tags.id"];
        const graph = yield* operations.query.graph({ entity: "product", fields: graphFields, filters: { id: product.id } });
        expect(graph.data).toEqual([expect.objectContaining({ id: product.id, type_id: type.id, collection_id: collection.id,
          type: { id: type.id }, collection: { id: collection.id }, tags: [{ id: tag.id }], categories: [{ id: category.id }],
          variants: [expect.objectContaining({ price_set: expect.objectContaining({ id: expect.any(String),
            prices: [expect.objectContaining({ amount: 3456, currency_code: "usd" })] }),
            inventory_items: [expect.objectContaining({ required_quantity: 1, inventory: expect.objectContaining({ sku: "native-http-references-one" }) })] })] })]);
        const metadata = tested.catalog.productRuntime.metadata;
        const inventory = yield* Effect.promise(() => tested.fixture.inventory());
        for (const [name, target] of [["tags", tag.id], ["categories", category.id]] as const) {
          const relation = metadata.queryRelations.get(metadata.product.table.name)?.get(name);
          if (relation?.join.type !== "manyToMany") return yield* Effect.die(new Error("Missing native Product " + name + " pivot"));
          const join = relation.join;
          const table = tested.catalog.productSource.definition.tables.find(candidate => candidate.localName === join.pivotTable);
          const sourceColumn = join.sourceColumns[0], targetColumn = join.targetColumns[0];
          if (table === undefined || sourceColumn === undefined || targetColumn === undefined)
            return yield* Effect.die(new Error("Missing actual Product pivot metadata"));
          const rows = yield* Effect.forEach(inventory.rows.filter(row => row.table === table.name), row => Effect.fromResult(coreNativeRelationalRow(row.value)));
          expect(rows).toEqual([expect.objectContaining({ [sourceColumn]: product.id, [targetColumn]: target })]);
        }

        expect(yield* request("/admin/product-categories/" + category.id + "?fields=id,products.title,products.metadata"))
          .toEqual({ product_category: { id: category.id, products: [{ title: body.title, metadata: body.metadata }] } });
        expect(yield* request("/admin/product-categories/" + category.id + "?fields=id,parent_category_id,products.title,products.metadata"))
          .toEqual({ product_category: { id: category.id, parent_category_id: parent.id, products: [{ title: body.title }] } });
        expect(yield* request("/admin/product-categories/" + category.id + "?fields=id,name,parent_category.name"))
          .toEqual({ product_category: { id: category.id, name: "Reference category", parent_category: { name: "Reference parent" } } });
        expect(yield* request("/admin/product-categories/" + parent.id + "?fields=id,name,category_children.name"))
          .toEqual({ product_category: { id: parent.id, name: "Reference parent", category_children: [{ name: "Reference category" }] } });

        const beforeMissing = yield* Effect.promise(() => tested.fixture.snapshot());
        expect(yield* request("/admin/products?fields=id", "POST", { ...body, handle: "native-http-missing-tag",
          tags: [{ id: "ptag_missing_http_reference" }], variants: [{ ...body.variants[0], sku: "native-http-missing-tag-one" }] }, 400))
          .toMatchObject({ type: "invalid_data", message: "Tag with id ptag_missing_http_reference not found. Please create the tag before associating it with the product." });
        const { outcomes: _beforeOutcomes, ...beforeBusiness } = beforeMissing;
        const { outcomes: _afterOutcomes, ...afterBusiness } = yield* Effect.promise(() => tested.fixture.snapshot());
        expect(afterBusiness).toEqual(beforeBusiness);

        const beforeRefusal = yield* Effect.promise(() => tested.fixture.snapshot());
        for (const invalid of [
          { tags: [{ id: 1 }] }, { categories: [{ id: 1 }] }, { tags: [{ id: "" }] }, { categories: [{ id: "" }] },
          { tags: Array.from({ length: 5 }, () => ({ id: tag.id })) },
          { categories: Array.from({ length: 5 }, () => ({ id: category.id })) },
        ]) yield* request("/admin/products?fields=id", "POST", { ...body, ...invalid }, 400);
        expect(yield* Effect.promise(() => tested.fixture.snapshot())).toEqual(beforeRefusal);

        const privateForm = yield* operations.runWorkflow("create-products", { products: [{ title: "Private IDs remain supported", handle: "private-reference-ids",
          tag_ids: [tag.id], category_ids: [category.id], options: [{ title: "Size", values: ["One"] }] }] });
        const privateId = privateForm.result[0]?.id;
        if (privateId === undefined) return yield* Effect.die(new Error("Missing native private-form Product"));
        expect((yield* operations.query.graph({ entity: "product", fields: ["id", "tags.id", "categories.id"], filters: { id: privateId } })).data)
          .toEqual([{ id: privateId, tags: [{ id: tag.id }], categories: [{ id: category.id }] }]);
        expect((yield* operations.query.graph({ entity: "product", fields: graphFields, filters: { id: product.id } })).data).toEqual(graph.data);
      }));
    } finally { await tested.fixture.close(); }
  }, 300_000);

  it("enforces the actual 41-host composition and releases all leases for reuse at the same byte budget", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      await tested.fixture.run(tested.fixture.useGeneration(generation => Effect.scoped(Effect.gen(function* () {
        const input = { database: generation.database, catalog: tested.catalog,
          identityAndAccessPolicy: { profile: "native-admin-product-request" }, revision: "d".repeat(64),
          subscribers: [{ id: "native-admin-product-request", revision: "e".repeat(64) }] };
        const tooSmall = yield* makePreparedHostRuntime({ maximumHosts: 40, maximumPreparedBytes: 8 * 1024 * 1024 });
        const refused = yield* Effect.exit(Effect.scoped(makeProductRequestOperations({ ...input, hostRuntime: tooSmall })));
        if (Exit.isSuccess(refused)) return yield* Effect.die(new Error("The actual composition unexpectedly fit in 40 hosts"));
        const failures = refused.cause.reasons.flatMap(reason => Cause.isFailReason(reason) ? [reason.error] : []);
        expect(failures).toEqual([expect.objectContaining({ cause: expect.any(PreparedHostRuntimeError) })]);
        expect(failures.some(error => error.cause instanceof PreparedHostRuntimeError && error.cause.reason === "capacityExceeded")).toBe(true);

        const runtime = yield* makePreparedHostRuntime({ maximumHosts: 41, maximumPreparedBytes: 8 * 1024 * 1024 });
        const created = yield* Effect.scoped(Effect.gen(function* () {
          const operations = yield* makeProductRequestOperations({ ...input, hostRuntime: runtime });
          const request = yield* makeHttp(operations);
          const category = decodeId((yield* request("/admin/product-categories", "POST", { name: "Lease category", handle: "lease-category" })).product_category);
          const collection = decodeId((yield* request("/admin/collections", "POST", { title: "Lease collection", handle: "lease-collection" })).collection);
          yield* operations.close;
          return { category, collection };
        }));
        // Scope closure cannot free a different runtime: this second complete
        // bootstrap borrows the identical 41-host owner after explicit close.
        yield* Effect.scoped(Effect.gen(function* () {
          const operations = yield* makeProductRequestOperations({ ...input, hostRuntime: runtime });
          const request = yield* makeHttp(operations);
          expect(yield* request("/admin/product-categories/" + created.category.id + "?fields=id"))
            .toEqual({ product_category: created.category });
          expect(yield* request("/admin/collections/" + created.collection.id + "?fields=id"))
            .toEqual({ collection: created.collection });
          yield* operations.close;
        }));
      }))));
    } finally { await tested.fixture.close(); }
  }, 300_000);
});
