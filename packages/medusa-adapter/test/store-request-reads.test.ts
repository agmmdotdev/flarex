import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { createStoreCurrencyHttpHandler } from "@flarex/medusa-http";
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeStoreRequestScopeFactory } from "../src/http/store-request-scope";
import { prepareStoreRequestReadFixture } from "./support/store-request-read-fixture";
import { storeRequestReadToken as token, storeRequestReadRevokedToken as revoked, storeRequestReadSecretToken as secret } from "./support/store-request-read-catalog";
const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
const fields = ["code", "name", "symbol", "symbol_native", "decimal_digits", "rounding"];
const graphQuery = (token: string) => ({ entity: "api_key", fields: ["id", "token", "revoked_at", "sales_channels_link.sales_channel_id"], filters: { token, type: "publishable" } });
const query = (filters: JsonObject, take?: number, skip?: number, selected = fields) => remoteQueryObjectFromString({ entryPoint: "currency", fields: selected,
  variables: { filters, ...(take === undefined ? {} : { take }), ...(skip === undefined ? {} : { skip }) } });
const connected = () => prepareStoreRequestReadFixture(driver);
describe(`Core Store request reads (${driver})`, () => {
  it("reads native Currency pages, case normalization, exact projection, ILIKE search, logical filters and missing retrieval without writes", async () => {
    const tested = await connected();
    try {
      const before = await tested.fixture.snapshot();
      await tested.use(reads => Effect.gen(function* () {
        expect(yield* reads.remoteQuery(query({}, 1, 1))).toEqual({ rows: [{ code: "eur", name: "Euro", symbol: "€", symbol_native: "€", decimal_digits: 2, rounding: 0,
          raw_rounding: { value: "0", precision: 20 } }],
          metadata: { count: 3, skip: 1, take: 1 } });
        expect(yield* reads.remoteQuery(query({ code: "USD" }, undefined, undefined, ["code", "name"]))).toEqual([{ code: "usd", name: "United States Dollar" }]);
        expect(yield* reads.remoteQuery(query({ code: "USD" }, undefined, undefined, ["name", "id"]))).toEqual([{ code: "usd", name: "United States Dollar" }]);
        expect(yield* reads.remoteQuery(query({ code: "USD" }, undefined, undefined, ["id"]))).toEqual([{ code: "usd" }]);
        expect(yield* reads.remoteQuery(query({ code: "CHF" }, undefined, undefined, ["raw_rounding", "id"])))
          .toEqual([{ code: "chf", rounding: 0.05, raw_rounding: { value: "0.05", precision: 20 } }]);
        expect(yield* reads.remoteQuery(query({ code: "absent" }))).toEqual([]);
        expect(yield* reads.remoteQuery(query({ q: "FRANÇAIS" }, 50, 0, ["code"]))).toEqual({ rows: [{ code: "chf" }], metadata: { count: 1, skip: 0, take: 50 } });
        expect(yield* reads.remoteQuery(query({ $or: [{ code: "USD" }, { code: ["EUR"] }] }, 50, 0, ["code"]))).toEqual({ rows: [{ code: "eur" }, { code: "usd" }],
          metadata: { count: 2, skip: 0, take: 50 } });
      }));
      expect(await tested.fixture.snapshot()).toEqual(before);
    } finally { await tested.fixture.close(); }
  });

  it("looks up exact publishable tokens, retains revocation and live links, rejects secret keys and unsafe fields", async () => {
    const tested = await connected();
    try {
      await tested.use(reads => Effect.gen(function* () {
        expect(yield* reads.query.graph(graphQuery(token), { cache: { enable: true } })).toEqual({ data: [{ id: "apk_active", token, revoked_at: null,
          sales_channels_link: [{ sales_channel_id: "sc_active" }] }] });
        expect(yield* reads.query.graph(graphQuery(revoked))).toEqual({ data: [{ id: "apk_revoked", token: revoked, revoked_at: "2020-01-01T00:00:00.000Z", sales_channels_link: [] }] });
        expect(yield* reads.query.graph(graphQuery(secret))).toEqual({ data: [] });
        expect(yield* reads.query.graph(graphQuery("missing"))).toEqual({ data: [] });
        const unsafe = yield* Effect.exit(reads.remoteQuery(query({}, 1, 0, ["__proto__.polluted"])));
        expect(Exit.isFailure(unsafe)).toBe(true);
        if (Exit.isFailure(unsafe)) expect(unsafe.cause.reasons.flatMap(reason => Cause.isFailReason(reason) ? [reason.error] : []))
          .toEqual([expect.objectContaining({ reason: "unsupportedProfile" })]);
      }));
    } finally { await tested.fixture.close(); }
  });

  it("serves actual native HTTP routes and middleware from Core reads, including key rejection, absence and malformed queries", async () => {
    const tested = await connected();
    try {
      const before = await tested.fixture.snapshot();
      await tested.use(reads => Effect.gen(function* () {
        const container = createContainer().register({
          logger: asValue({ error() {}, info() {} }), configModule: asValue({ projectConfig: { http: {} } }),
        });
        const scopes = yield* makeStoreRequestScopeFactory({ reads, container });
        const http = createStoreCurrencyHttpHandler({ storeCors: "https://store.test", createRequestScope: scopes.createRequestScope });
        yield* Effect.promise(async () => {
        const request = (path: string, selected: string | undefined = token) => http.handle(new Request(`https://medusa.test${path}`,
          { headers: selected === undefined ? {} : { "x-publishable-api-key": selected } }));
        const list = await request("/store/currencies?limit=1&offset=1");
        expect(list.status).toBe(200);
        expect(await list.json()).toEqual({ currencies: [{ code: "eur", name: "Euro", symbol: "€", symbol_native: "€", decimal_digits: 2, rounding: 0,
          raw_rounding: { value: "0", precision: 20 } }],
          count: 3, offset: 1, limit: 1 });
        const retrieve = await request("/store/currencies/USD");
        expect(retrieve.status).toBe(200);
        expect(await retrieve.json()).toMatchObject({ currency: { code: "usd", name: "United States Dollar" } });
        const emptyPage = await request("/store/currencies?limit=0&offset=1");
        expect(emptyPage.status).toBe(200);
        expect(await emptyPage.json()).toEqual({ currencies: [], count: 3, offset: 1, limit: 0 });
        expect((await request("/store/currencies/absent")).status).toBe(404);
        expect((await http.handle(new Request("https://medusa.test/store/currencies"))).status).toBe(400);
        expect((await request("/store/currencies", "missing")).status).toBe(400);
        expect((await request("/store/currencies", revoked)).status).toBe(400);
        expect((await request("/store/currencies", secret)).status).toBe(400);
        expect((await request("/store/currencies?unknown=yes")).status).toBe(400);
        const selected = await request("/store/currencies?fields=code,name&code=USD");
        expect(selected.status).toBe(200);
        expect(await selected.json()).toEqual({ currencies: [{ code: "usd", name: "United States Dollar" }], count: 1, offset: 0, limit: 50 });
        const identityOnly = await request("/store/currencies/USD?fields=id");
        expect(identityOnly.status).toBe(200);
        expect(await identityOnly.json()).toEqual({ currency: { code: "usd" } });
        const unknownFields = await request("/store/currencies/USD?fields=bogus");
        expect(unknownFields.status).toBe(200);
        expect(await unknownFields.json()).toEqual({ currency: { code: "usd" } });
        // The native Currency route forwards pagination only; its separately
        // prepared withDeleted flag is not a RemoteQuery variable.
        const deleted = await request("/store/currencies?with_deleted=true&fields=code");
        expect(deleted.status).toBe(200);
        expect(await deleted.json()).toEqual({ currencies: [{ code: "chf" }, { code: "eur" }, { code: "usd" }], count: 3, offset: 0, limit: 50 });
        const byName = await request("/store/currencies?fields=code,name&order=name&limit=2");
        expect(byName.status).toBe(200);
        expect(await byName.json()).toEqual({ currencies: [{ code: "eur", name: "Euro" }, { code: "chf", name: "Français Franc" }], count: 3, offset: 0, limit: 2 });
        const descending = await request("/store/currencies?fields=code,name&order=-name&limit=1&offset=1");
        expect(descending.status).toBe(200);
        expect(await descending.json()).toEqual({ currencies: [{ code: "chf", name: "Français Franc" }], count: 3, offset: 1, limit: 1 });
        // Native Zod accepts negative values; native PostgreSQL/ORM then fails
        // LIMIT/OFFSET and native error handling returns a generic 500.
        const negative = await request("/store/currencies?limit=-1");
        expect(negative.status).toBe(500);
        expect(await negative.json()).toEqual({ code: "unknown_error", type: "unknown_error", message: "An unknown error occurred." });
        expect((await request("/store/currencies?offset=-1")).status).toBe(500);
        expect((await request("/store/currencies?fields=__proto__.polluted")).status).toBe(400);
        expect({}).not.toHaveProperty("polluted");
        });
      }));
      expect(await tested.fixture.snapshot()).toEqual(before);
    } finally { await tested.fixture.close(); }
  });
});
