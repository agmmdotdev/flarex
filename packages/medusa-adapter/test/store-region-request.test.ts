import { Effect, Schema } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { createStoreProductHttpHandler } from "@flarex/medusa-http/store-product";
import { describe, expect, it } from "vitest";
import { makeStoreProductRequestScopeFactory } from "../src/http/store-product-request";
import { prepareStoreProductRequestFixture } from "./support/store-product-request-fixture";
import { storeProductToken, storeProductLogger } from "./support/store-product-request-catalog";
import { storeRequestReadRevokedToken, storeRequestReadSecretToken } from "./support/store-request-read-catalog";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
const object = Schema.decodeUnknownSync(Schema.JsonObject);
const objects = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const list = Schema.decodeUnknownSync(Schema.Struct({ regions: Schema.Array(Schema.JsonObject),
  count: Schema.Number, offset: Schema.Number, limit: Schema.Number }));

describe(`native Store Region HTTP (${driver})`, () => {
  it("serves native Region defaults, owned Countries, exact projections, filters and full page counts without durable writes", async () => {
    const tested = await prepareStoreProductRequestFixture(driver);
    try {
      const before = await tested.fixture.inventory();
      await tested.use(reads => Effect.gen(function* () {
        const scopes = yield* makeStoreProductRequestScopeFactory({ reads, container: createContainer().register({
          logger: asValue(storeProductLogger), configModule: asValue({ projectConfig: { http: {} } }),
        }) });
        const http = createStoreProductHttpHandler({ storeCors: "https://store.test", ...scopes });
        yield* Effect.promise(async () => {
          const request = async (path: string, status = 200, key: string | null = storeProductToken) => {
            const response = await http.handle(new Request(`https://native-store.test${path}`, { headers: {
              ...(key === null ? {} : { "x-publishable-api-key": key }), origin: "https://store.test",
            } }));
            const body = object(await response.json());
            expect(response.status, `${path}: ${JSON.stringify(body)}`).toBe(status);
            expect(response.headers.get("access-control-allow-origin")).toBe("https://store.test");
            return body;
          };
          const defaults = list(await request("/store/regions"));
          // The pinned validator's limit=50 default precedes query-config's 20.
          expect(defaults).toMatchObject({ count: 9, offset: 0, limit: 50 });
          expect(defaults.regions.map(row => row.id).toSorted()).toEqual([
            "reg_store_eur", "reg_store_inclusive", "reg_store_manual", "reg_store_us",
            "reg_store_z_extra_1", "reg_store_z_extra_2", "reg_store_z_extra_3", "reg_store_z_extra_4", "reg_store_z_extra_5",
          ]);
          for (const row of defaults.regions) {
            expect(Object.keys(row).toSorted()).toEqual(["id", "name", "currency_code", "created_at", "updated_at", "deleted_at", "metadata", "countries"].toSorted());
            expect(row).toMatchObject({ created_at: expect.any(String), updated_at: expect.any(String), metadata: null, deleted_at: null });
            const countries = objects(row.countries);
            expect(countries.map(country => country.iso_2).toSorted()).toEqual(row.id === "reg_store_us" ? ["ca", "us"] : row.id === "reg_store_eur" ? ["gb"] : []);
            for (const country of countries) expect(country.region_id).toBe(row.id);
          }
          const us = defaults.regions.find(row => row.id === "reg_store_us");
          expect(await request("/store/regions/reg_store_us")).toEqual({ region: us });
          expect(await request("/store/regions/reg_store_us?fields=id,name,countries.iso_2,countries.display_name"))
            .toEqual({ region: { id: "reg_store_us", name: "US automatic", countries: [
              { iso_2: "ca", display_name: "Canada" }, { iso_2: "us", display_name: "United States" },
            ] } });
          expect(await request("/store/regions/reg_store_us?fields=id,name"))
            .toEqual({ region: { id: "reg_store_us", name: "US automatic" } });
          expect(await request("/store/regions/reg_store_us?fields=id,countries.id"))
            .toEqual({ region: { id: "reg_store_us", countries: [{ iso_2: "ca" }, { iso_2: "us" }] } });
          expect(list(await request("/store/regions?fields=id,countries.id&currency_code=usd&order=name&limit=1")))
            .toEqual({ regions: [{ id: "reg_store_us", countries: [{ iso_2: "ca" }, { iso_2: "us" }] }], count: 3, offset: 0, limit: 1 });
          expect(list(await request("/store/regions?fields=id&order=id&limit=1&offset=1")))
            .toEqual({ regions: [{ id: "reg_store_inclusive" }], count: 9, offset: 1, limit: 1 });
          expect(list(await request("/store/regions?fields=id&limit=0")))
            .toEqual({ regions: [], count: 9, offset: 0, limit: 0 });
          for (const query of ["id=reg_store_us", "id[]=reg_store_us", "name=US%20automatic", "name[]=US%20automatic"])
            expect(list(await request(`/store/regions?fields=id&${query}`)))
              .toEqual({ regions: [{ id: "reg_store_us" }], count: 1, offset: 0, limit: 50 });
          for (const query of ["currency_code=eur", "currency_code[]=eur"])
            expect(list(await request(`/store/regions?fields=id&${query}`)))
              .toEqual({ regions: [{ id: "reg_store_eur" }], count: 1, offset: 0, limit: 50 });
          expect(list(await request("/store/regions?fields=id&currency_code=usd&order=id&limit=1&offset=1")))
            .toEqual({ regions: [{ id: "reg_store_manual" }], count: 3, offset: 1, limit: 1 });
          const selectedIds = "id[]=reg_store_manual&id[]=reg_store_us&id[]=reg_store_eur&id[]=reg_store_inclusive";
          for (const order of ["", "&order=id"])
            expect(list(await request(`/store/regions?fields=id&${selectedIds}&offset=1&limit=2${order}`)))
              .toEqual({ regions: [{ id: "reg_store_manual" }, { id: "reg_store_inclusive" }], count: 4, offset: 1, limit: 2 });
          expect(list(await request(`/store/regions?fields=id&${selectedIds}&order=-id`)))
            .toEqual({ regions: [{ id: "reg_store_us" }, { id: "reg_store_manual" }, { id: "reg_store_inclusive" }, { id: "reg_store_eur" }], count: 4, offset: 0, limit: 50 });
          expect(list(await request(`/store/regions?fields=id&${selectedIds}&order=name`)))
            .toEqual({ regions: [{ id: "reg_store_eur" }, { id: "reg_store_us" }, { id: "reg_store_inclusive" }, { id: "reg_store_manual" }], count: 4, offset: 0, limit: 50 });
          expect(list(await request("/store/regions?fields=id&q=aUtOmAtIc")))
            .toEqual({ regions: [{ id: "reg_store_us" }], count: 1, offset: 0, limit: 50 });
          expect(list(await request("/store/regions?fields=id&q=UsD&order=id")))
            .toEqual({ regions: [{ id: "reg_store_inclusive" }, { id: "reg_store_manual" }, { id: "reg_store_us" }], count: 3, offset: 0, limit: 50 });
          expect(list(await request("/store/regions?fields=id&$or[0][id]=reg_store_us&$or[1][id]=reg_store_eur&order=id")))
            .toEqual({ regions: [{ id: "reg_store_us" }, { id: "reg_store_eur" }], count: 2, offset: 0, limit: 50 });
          expect(list(await request("/store/regions?fields=id&$and[0][currency_code]=usd&$and[1][name]=US%20manual")))
            .toEqual({ regions: [{ id: "reg_store_manual" }], count: 1, offset: 0, limit: 50 });
          expect(list(await request("/store/regions?fields=id&q=Us&$and[0][currency_code]=usd&$or[0][name]=US%20automatic&$or[1][id]=reg_store_manual&order=name&offset=1&limit=1")))
            .toEqual({ regions: [{ id: "reg_store_manual" }], count: 2, offset: 1, limit: 1 });
          expect(list(await request("/store/regions?fields=id&order=name&limit=2&offset=1")))
            .toEqual({ regions: [{ id: "reg_store_us" }, { id: "reg_store_inclusive" }], count: 9, offset: 1, limit: 2 });
          for (const query of ["q=no-such-region", "$and[0][currency_code]=eur&$and[1][name]=US%20automatic"])
            expect(list(await request(`/store/regions?fields=id&${query}`)))
              .toEqual({ regions: [], count: 0, offset: 0, limit: 50 });
          expect(list(await request("/store/regions?fields=id&id=missing")))
            .toEqual({ regions: [], count: 0, offset: 0, limit: 50 });
          expect(await request("/store/regions/missing", 404))
            .toMatchObject({ type: "not_found", message: "Region with id: missing was not found" });
          for (const path of ["/store/regions", "/store/regions/reg_store_us"])
            for (const key of [null, "pk_missing", storeRequestReadRevokedToken, storeRequestReadSecretToken]) await request(path, 400, key);
          for (const query of ["limit=invalid", "limit=257", "fields=secret", "fields=countries.region.name",
            "fields=__proto__.polluted", "order=secret", "name[$eq]=US%20automatic", "unknown=ignored"])
            await request(`/store/regions?${query}`, 400);
        });
      }));
      expect(await tested.fixture.inventory()).toEqual(before);
    } finally { await tested.fixture.close(); }
  });
});
