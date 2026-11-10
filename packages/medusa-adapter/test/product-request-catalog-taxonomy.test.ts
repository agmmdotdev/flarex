import { Effect, Schema } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { createAdminProductHttpHandler } from "@flarex/medusa-http/admin-product";
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string";
import { describe, expect, it } from "vitest";
import { makeProductRequestScopeFactory } from "../src/http/product-request";
import { prepareProductRequestFixture } from "./support/product-request-fixture";
import { coreNativeRelationalRow } from "../../persistence-postgres/src/core/nativeRelationalQuery";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
const decodeEntity = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString, value: Schema.String,
  metadata: Schema.NullOr(Schema.JsonObject) }));
const decodeEnvelope = Schema.decodeUnknownSync(Schema.JsonObject);

describe(`native catalog HTTP on Core (${driver})`, () => {
  it("runs ten methods and native metadata updates while retaining Product references and commerce links on deletion", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      await tested.use(operations => Effect.gen(function* () {
        const scope = yield* makeProductRequestScopeFactory({ operations, container: createContainer().register({ logger: asValue({ error() {}, info() {} }) }) });
        const handler = createAdminProductHttpHandler({ adminCors: "https://admin.example", ...scope,
          resolveAdminPrincipal: () => ({ actor_id: "catalog-admin", actor_type: "user", auth_identity_id: "catalog-auth", app_metadata: {}, user_metadata: {} }),
          evaluateAdminPolicies: () => true, admitProductRefetchFields: operations.admitProductRefetchFields,
          admitVariantRefetchFields: operations.admitVariantRefetchFields, admitCatalogRefetchFields: operations.admitCatalogRefetchFields });
        const request = Effect.fn("CatalogHttp.request")(function* (path: string, method = "GET", body?: unknown) {
          const response = yield* Effect.promise(() => handler.handle(new Request("https://private.test" + path, {
            method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })));
          const json = decodeEnvelope(yield* Effect.promise(() => response.json()));
          expect(response.status, method + " " + path + ": " + JSON.stringify(json)).toBe(200);
          return json;
        });
        const type = decodeEntity((yield* request("/admin/product-types", "POST", { value: "HTTP type", metadata: { keep: "yes", drop: "old" } })).product_type);
        const tag = decodeEntity((yield* request("/admin/product-tags", "POST", { value: "HTTP tag", metadata: { keep: "yes", drop: "old" } })).product_tag);
        expect(yield* operations.remoteQuery(remoteQueryObjectFromString({ entryPoint: "product_type", fields: ["*"],
          variables: { filters: { id: type.id } } }))).toEqual([expect.objectContaining(type)]);
        const product = (yield* operations.runWorkflow("create-products", { products: [{ title: "Catalog references", handle: "catalog-http-references",
          type_id: type.id, tag_ids: [tag.id], options: [{ title: "Size", values: ["One"] }], variants: [{ title: "Managed", sku: "catalog-http-managed",
            options: { Size: "One" }, prices: [{ amount: 2300, currency_code: "usd" }] }] }] })).result[0];
        if (product === undefined) return yield* Effect.die(new Error("Missing native Product"));
        const metadata = tested.catalog.productRuntime.metadata;
        const relation = metadata.queryRelations.get(metadata.product.table.name)?.get("tags");
        if (relation?.join.type !== "manyToMany") return yield* Effect.die(new Error("Missing native Tag pivot metadata"));
        const tagPivotTable = relation.join.pivotTable;
        const readTable = Effect.fn("CatalogHttp.readActualTable")(function* (localName: string) {
          const table = tested.catalog.productSource.definition.tables.find(candidate => candidate.localName === localName);
          if (table === undefined) return yield* Effect.die(new Error("Missing native catalog table: " + localName));
          const inventory = yield* Effect.promise(() => tested.fixture.inventory());
          return yield* Effect.forEach(inventory.rows.filter(entry => entry.table === table.name), entry => Effect.fromResult(coreNativeRelationalRow(entry.value)));
        });
        const productRows = yield* readTable(metadata.product.table.name);
        const pivotRows = yield* readTable(tagPivotTable);
        const graphQuery = { entity: "product", filters: { id: product.id }, fields: ["id", "type.id", "tags.id", "variants.id",
          "variants.price_set.prices.*", "variants.inventory_items.*", "variants.inventory_items.inventory.*"] };
        const beforeGraph = yield* operations.query.graph(graphQuery);
        expect(beforeGraph.data[0]).toMatchObject({ id: product.id, type: { id: type.id }, tags: [{ id: tag.id }] });
        for (const [family, entity, row, limit] of [["product-types", "product_type", type, 10], ["product-tags", "product_tag", tag, 20]] as const) {
          const path = "/admin/" + family, plural = entity + "s";
          expect(yield* request(path)).toMatchObject({ [plural]: [row], count: 1, offset: 0, limit });
          expect(yield* request(path + "/" + row.id)).toMatchObject({ [entity]: row });
          const changed = decodeEntity((yield* request(path + "/" + row.id, "POST", { metadata: { drop: "", nested: { fresh: true } } }))[entity]);
          expect(changed).toEqual({ id: row.id, value: row.value, metadata: { keep: "yes", nested: { fresh: true } } });
          expect(decodeEntity((yield* request(path + "/" + row.id, "POST", {}))[entity])).toEqual(changed);
          expect(decodeEntity((yield* request(path + "/" + row.id, "POST", { metadata: {} }))[entity]).metadata).toEqual({});
          expect(decodeEntity((yield* request(path + "/" + row.id + "?fields=id,value,metadata", "POST", { metadata: null }))[entity]).metadata).toBeNull();
          expect(yield* request(path + "?limit=1&offset=1&order=id")).toEqual({ [plural]: [], count: 1, offset: 1, limit: 1 });
          expect(yield* request(path + "/missing")).toEqual({});
          for (const id of [row.id, row.id, "missing"]) expect(yield* request(path + "/" + id, "DELETE")).toEqual({ id, object: entity, deleted: true });
          expect(yield* request(path)).toEqual({ [plural]: [], count: 0, offset: 0, limit });
        }
        expect(yield* readTable(metadata.product.table.name)).toEqual(productRows);
        expect(yield* readTable(tagPivotTable)).toEqual(pivotRows);
        expect((yield* operations.query.graph(graphQuery)).data[0]).toEqual({ ...beforeGraph.data[0], type: null, tags: [] });
      }));
      const after = await tested.fixture.snapshot();
      for (const contract of ["product-type.created", "product-tag.created", "product-type.updated", "product-tag.updated", "product-type.deleted", "product-tag.deleted"])
        expect(after.events.some(event => event.envelope.contract === contract)).toBe(true);
    } finally { await tested.fixture.close(); }
  }, 300_000);

  it("refuses unsupported refetch projections, filters and malformed input without durable changes", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      const before = await tested.fixture.snapshot();
      await tested.use(operations => Effect.gen(function* () {
        const scope = yield* makeProductRequestScopeFactory({ operations, container: createContainer().register({ logger: asValue({ error() {}, info() {} }) }) });
        const handler = createAdminProductHttpHandler({ adminCors: "https://admin.example", ...scope,
          resolveAdminPrincipal: () => ({ actor_id: "catalog-admin", actor_type: "user", auth_identity_id: "catalog-auth", app_metadata: {}, user_metadata: {} }),
          evaluateAdminPolicies: () => true, admitProductRefetchFields: operations.admitProductRefetchFields,
          admitVariantRefetchFields: operations.admitVariantRefetchFields, admitCatalogRefetchFields: operations.admitCatalogRefetchFields });
        for (const family of ["product-types", "product-tags"]) for (const [path, method, body, status] of [
          ["?fields=id,unadmitted", "POST", { value: "Must not create" }, 400],
          ["?fields=*", "POST", { value: "Unsupported native empty relation star" }, 400],
          ["/missing?fields=id,unadmitted", "POST", { value: "Must not update" }, 400],
          ["/missing", "POST", { metadata: {} }, 404], ["?q=unsupported", "GET", undefined, 400],
          ["?order=-created_at", "GET", undefined, 400], ["", "POST", { value: "invalid metadata", metadata: [] }, 400],
        ] as const) {
          const response = yield* Effect.promise(() => handler.handle(new Request("https://private.test/admin/" + family + path, {
            method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })));
          expect(response.status, yield* Effect.promise(() => response.text())).toBe(status);
        }
      }));
      expect(await tested.fixture.snapshot()).toEqual(before);
    } finally { await tested.fixture.close(); }
  }, 300_000);
});