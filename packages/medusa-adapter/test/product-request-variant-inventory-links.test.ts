import { Effect, Result, Schema } from "effect";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { Modules } from "@medusajs/utils/modules-sdk/definition";
import { MedusaError } from "@medusajs/utils/common/errors";
import { createAdminProductHttpHandler } from "@flarex/medusa-http/admin-product";
import { describe, expect, it } from "vitest";
import { makeProductRequestScopeFactory } from "../src/http/product-request";
import { prepareProductRequestFixture } from "./support/product-request-fixture";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);
const decodeVariant = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NonEmptyString, product_id: Schema.NonEmptyString,
  inventory_items: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, variant_id: Schema.NonEmptyString,
    inventory_item_id: Schema.NonEmptyString, required_quantity: Schema.Number })) }));
const fields = ["id", "product_id", "inventory_items.id", "inventory_items.variant_id", "inventory_items.inventory_item_id", "inventory_items.required_quantity"];
const link = (variant_id: string, inventory_item_id: string, required_quantity?: number) => ({
  [Modules.PRODUCT]: { variant_id }, [Modules.INVENTORY]: { inventory_item_id },
  ...(required_quantity === undefined ? {} : { data: { required_quantity } }),
});
type NativeEngine = { run(name: string, options: { input: unknown }): Promise<{ result: unknown }> };
type Snapshot = Awaited<ReturnType<Awaited<ReturnType<typeof prepareProductRequestFixture>>["fixture"]["snapshot"]>>;
function expectFailedRootAudit(before: Pick<Snapshot, "outcomes">, after: Pick<Snapshot, "outcomes">) {
  expect(after.outcomes.slice(0, before.outcomes.length)).toEqual(before.outcomes);
  for (const outcome of after.outcomes.slice(before.outcomes.length)) expect(outcome.value).toMatchObject({ kind: "nativeRoot", state: "failed" });
}

describe(`native Product Variant Inventory Link request operations (${driver})`, () => {
  it("runs all four facades with genuine link identities, atomic parent refusal and the combined eight-link boundary", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      await tested.use(operations => Effect.gen(function* () {
        const created = [];
        for (const [index, name] of ["Selected", "Foreign"].entries()) created.push((yield* operations.runWorkflow("create-products", { products: [{
          title: name, handle: "request-inventory-links-" + name.toLowerCase(), options: [{ title: "Size", values: index === 0 ? ["A", "B", "C", "D"] : ["A"] }],
          variants: (index === 0 ? ["A", "B", "C", "D"] : ["A"]).map(size => ({ title: name + size,
            sku: "request-inventory-links-" + name + size, options: { Size: size }, prices: [{ amount: 100 + index, currency_code: "usd" }] })),
        }] })).result[0]);
        const selectedId = created[0]?.id, foreignId = created[1]?.id;
        if (selectedId === undefined || foreignId === undefined) return yield* Effect.die(new Error("Native seed omitted Product IDs"));
        const variants = (yield* operations.query.graph({ entity: "variant", fields, filters: { product_id: selectedId } })).data.map(row => decodeVariant(row));
        const foreign = decodeVariant((yield* operations.query.graph({ entity: "variant", fields, filters: { product_id: foreignId } })).data[0]);
        const first = variants[0], item = foreign.inventory_items[0];
        if (first === undefined || item === undefined || variants.length !== 4) return yield* Effect.die(new Error("Native seed omitted its linked Variants"));
        const own = first.inventory_items[0];
        if (own === undefined) return yield* Effect.die(new Error("Native seed omitted selected Inventory link"));
        const scopes = yield* makeProductRequestScopeFactory({ operations, container: createContainer() });
        const engine = scopes.createRequestScope().resolve<NativeEngine>(Modules.WORKFLOW_ENGINE);
        const run = Effect.fn("VariantInventoryProof.run")((name: string, input: unknown) => Effect.tryPromise({
          try: () => engine.run(name, { input }), catch: error => error,
        }));
        const sources = [];
        for (const name of ["product", "pricing", "inventory"] as const) sources.push({ name, rows: yield* Effect.promise(() => tested.fixture.readRows(name)) });
        const foreignBefore = yield* operations.query.graph({ entity: "variant", fields: ["*", "price_set.prices.*", "inventory_items.*", "inventory_items.inventory.*"], filters: { id: foreign.id } });
        const create = link(first.id, item.inventory_item_id, 3);
        expect(yield* run("create-product-variant-inventory-links", { product_id: selectedId, links: [create] })).toEqual({ result: [create] });
        const selected = () => operations.query.graph({ entity: "variant", fields, filters: { id: first.id } }).pipe(Effect.map(value => decodeVariant(value.data[0])));
        const added = (yield* selected()).inventory_items.find(row => row.inventory_item_id === item.inventory_item_id);
        expect(added).toMatchObject({ id: expect.any(String), variant_id: first.id, required_quantity: 3 });
        const update = link(first.id, item.inventory_item_id, 7);
        expect(yield* run("update-product-variant-inventory-links", { product_id: selectedId, links: [update] })).toEqual({ result: [update] });
        const updatedLinks = (yield* selected()).inventory_items.filter(row => row.inventory_item_id === item.inventory_item_id);
        // Native create/upsert keys the endpoint pair and generates the ordinary scalar ID when omitted.
        expect(updatedLinks).toEqual([{ id: expect.any(String), variant_id: first.id, inventory_item_id: item.inventory_item_id, required_quantity: 7 }]);
        expect(updatedLinks[0]?.id).not.toBe(added?.id);
        const dismiss = link(first.id, item.inventory_item_id);
        expect(yield* run("dismiss-product-variant-inventory-links", { product_id: selectedId, links: [dismiss] })).toEqual({ result: [dismiss] });
        expect((yield* selected()).inventory_items).toEqual([own]);
        for (const name of ["create", "update", "dismiss"] as const) {
          const before = yield* Effect.promise(() => tested.fixture.snapshot());
          const quantity = name === "dismiss" ? undefined : 2;
          const failure = yield* Effect.result(run(`${name}-product-variant-inventory-links`, { product_id: selectedId,
            links: [link(first.id, name === "create" ? item.inventory_item_id : own.inventory_item_id, quantity),
              link(foreign.id, own.inventory_item_id, quantity)] }));
          expect(Result.isFailure(failure)).toBe(true);
          if (Result.isFailure(failure)) expect(failure.failure).toMatchObject({ type: MedusaError.Types.NOT_FOUND,
            message: expect.stringContaining("Could not find all Product Variants for Product") });
          const { outcomes: _previous, ...businessBefore } = before;
          const after = yield* Effect.promise(() => tested.fixture.snapshot());
          const { outcomes: _current, ...businessAfter } = after;
          expectFailedRootAudit(before, after);
          // A failed native root may retain its audit outcome; it must publish no business history or events.
          expect(businessAfter).toEqual(businessBefore);
        }
        for (const arm of ["create", "update", "delete"] as const) {
          const before = yield* Effect.promise(() => tested.fixture.snapshot());
          const quantity = arm === "delete" ? undefined : 2;
          const failure = yield* Effect.result(run("batch-product-variant-inventory-links", { product_id: selectedId,
            create: [], update: [], delete: [],
            [arm]: [link(first.id, arm === "create" ? item.inventory_item_id : own.inventory_item_id, quantity),
              link(foreign.id, own.inventory_item_id, quantity)] }));
          expect(Result.isFailure(failure)).toBe(true);
          if (Result.isFailure(failure)) expect(failure.failure).toMatchObject({ type: MedusaError.Types.NOT_FOUND,
            message: expect.stringContaining("Could not find all Product Variants for Product") });
          const { outcomes: _previous, ...businessBefore } = before;
          const after = yield* Effect.promise(() => tested.fixture.snapshot());
          const { outcomes: _current, ...businessAfter } = after;
          expectFailedRootAudit(before, after);
          expect(businessAfter).toEqual(businessBefore);
        }
        const missing = yield* Effect.result(run("update-product-variant-inventory-links", { product_id: selectedId,
          links: [link(first.id, item.inventory_item_id, 2)] }));
        expect(Result.isFailure(missing)).toBe(true);
        if (Result.isFailure(missing)) expect(missing.failure).toMatchObject({ type: MedusaError.Types.NOT_FOUND });
        expect(yield* run("batch-product-variant-inventory-links", {
          product_id: "missing-product", create: [], update: [], delete: [],
        })).toEqual({ result: { created: [], updated: [], deleted: [] } });
        yield* run("create-product-variant-inventory-links", { product_id: selectedId, links: [link(first.id, item.inventory_item_id, 2)] });
        const creates = variants.slice(1).map(variant => link(variant.id, item.inventory_item_id, 2));
        const updates = variants.map(variant => link(variant.id, variant.inventory_items[0]?.inventory_item_id ?? "missing", 4));
        const deletes = [link(first.id, item.inventory_item_id)];
        expect(yield* run("batch-product-variant-inventory-links", { product_id: selectedId, create: creates, update: updates, delete: deletes }))
          .toEqual({ result: { created: creates, updated: updates, deleted: deletes } });
        const beforeInvalid = yield* Effect.promise(() => tested.fixture.snapshot());
        for (const invalid of [0.5, 2_147_483_648, "2", null]) {
          expect(Result.isFailure(yield* Effect.result(run("update-product-variant-inventory-links", { product_id: selectedId,
            links: [link(first.id, own.inventory_item_id, 1), { ...link(first.id, item.inventory_item_id), data: { required_quantity: invalid } }] })))).toBe(true);
        }
        expect(Result.isFailure(yield* Effect.result(run("batch-product-variant-inventory-links", { product_id: selectedId,
          create: creates, update: updates, delete: [...deletes, link(first.id, own.inventory_item_id)] })))).toBe(true);
        expect(Result.isFailure(yield* Effect.result(run("batch-product-variant-inventory-links", { product_id: selectedId })))).toBe(true);
        expect(yield* Effect.promise(() => tested.fixture.snapshot())).toEqual(beforeInvalid);
        for (const source of sources) expect(yield* Effect.promise(() => tested.fixture.readRows(source.name))).toEqual(source.rows);
        expect(yield* operations.query.graph({ entity: "variant", fields: ["*", "price_set.prices.*", "inventory_items.*", "inventory_items.inventory.*"], filters: { id: foreign.id } })).toEqual(foreignBefore);
      }));
    } finally { await tested.fixture.close(); }
  }, 300_000);

  it("executes five native HTTP methods with native delete identity, global product/prices projection and preclaim projection refusal", async () => {
    let phase = "fixture preparation";
    let fixture: Awaited<ReturnType<typeof prepareProductRequestFixture>>["fixture"] | undefined;
    const primary: unknown[] = [];
    try {
      const tested = await prepareProductRequestFixture(driver);
      fixture = tested.fixture;
      await tested.use(operations => Effect.gen(function* () {
        phase = "seed: native Product creation";
        const created = yield* operations.runWorkflow("create-products", { products: ["Selected", "Other"].map((name, index) => ({
          title: name, handle: "request-links-http-" + name.toLowerCase(), options: [{ title: "Size", values: ["One"] }],
          variants: [{ title: name + " One", sku: "request-links-http-" + name, options: { Size: "One" }, prices: [{ amount: 500 + index, currency_code: "usd" }] }],
        })) });
        const firstId = created.result[0]?.id, otherId = created.result[1]?.id;
        if (firstId === undefined || otherId === undefined) return yield* Effect.die(new Error("Missing native HTTP Product IDs"));
        const read = Effect.fn("VariantInventoryProof.read")(function* (id: string) {
          phase = "graph: Variant inventory links";
          return decodeVariant((yield* operations.query.graph({ entity: "variant", fields, filters: { product_id: id } })).data[0]);
        });
        const first = yield* read(firstId), other = yield* read(otherId), item = other.inventory_items[0];
        if (item === undefined) return yield* Effect.die(new Error("Missing native HTTP Inventory Item"));
        phase = "HTTP scope preparation";
        const scopes = yield* makeProductRequestScopeFactory({ operations, container: createContainer().register({ logger: asValue({ error() {}, info() {} }) }) });
        const http = createAdminProductHttpHandler({ ...scopes, adminCors: "https://admin.test",
          resolveAdminPrincipal: () => ({ actor_id: "admin", actor_type: "user", auth_identity_id: "auth", app_metadata: {}, user_metadata: {} }),
          evaluateAdminPolicies: () => true, admitProductRefetchFields: operations.admitProductRefetchFields,
          admitSalesChannelRefetchFields: operations.admitSalesChannelRefetchFields, admitPriceListRefetchFields: operations.admitPriceListRefetchFields, admitCatalogRefetchFields: operations.admitCatalogRefetchFields, admitVariantRefetchFields: operations.admitVariantRefetchFields });
        const request = Effect.fn("VariantInventoryProof.http")(function* (path: string, method = "GET", body?: unknown, status = 200) {
          phase = `${method} ${path}`;
          const response = yield* Effect.promise(() => http.handle(new Request("https://private.test" + path, { method,
            headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })));
          const json = decodeObject(yield* Effect.promise(() => response.json()));
          expect(response.status, JSON.stringify(json)).toBe(status);
          return json;
        });
        const list = yield* request("/admin/product-variants?order=id&limit=1&offset=1");
        expect(list).toMatchObject({ count: 2, offset: 1, limit: 1, variants: [expect.objectContaining({ product: expect.objectContaining({ id: expect.any(String) }),
          prices: [expect.objectContaining({ amount: expect.any(Number), variant_id: expect.any(String), price_set_id: expect.any(String) })] })] });
        expect(yield* request(`/admin/product-variants?id=${first.id}&fields=id,product.id,prices.amount`)).toEqual({ variants: [{ id: first.id,
          product: { id: firstId }, prices: [{ amount: 500, title: "", raw_amount: { value: 500 }, currency_code: "", min_quantity: null,
            max_quantity: null, price_set_id: "", variant_id: first.id, deleted_at: null, rules: {} }] }], count: 1, offset: 0, limit: 50 });
        expect(yield* request(`/admin/product-variants?id=${first.id}&fields=id,manage_inventory,inventory_quantity`)).toEqual({ variants: [{ id: first.id,
          manage_inventory: true, inventory_quantity: 0 }], count: 1, offset: 0, limit: 50 });
        const base = `/admin/products/${firstId}/variants/${first.id}/inventory-items`;
        const query = "?fields=" + fields.join(",");
        phase = "graph: preclaim snapshot";
        const beforeInvalid = yield* Effect.promise(() => tested.fixture.snapshot());
        for (const suffix of ["?fields=unsupported_field", "?fields=inventory_items.unsupported_field", "?fields=__proto__.x"]) {
          yield* request(base + suffix, "POST", { inventory_item_id: item.inventory_item_id, required_quantity: 2 }, 400);
          yield* request(base + "/" + item.inventory_item_id + suffix, "POST", { required_quantity: 2 }, 400);
          yield* request(base + "/" + item.inventory_item_id + suffix, "DELETE", undefined, 400);
        }
        yield* request(base + query, "POST", { inventory_item_id: item.inventory_item_id, required_quantity: 0.5 }, 400);
        phase = "graph: post-refusal snapshot";
        expect(yield* Effect.promise(() => tested.fixture.snapshot())).toEqual(beforeInvalid);
        const added = decodeVariant((yield* request(base + query, "POST", { inventory_item_id: item.inventory_item_id, required_quantity: 2 })).variant);
        const addedLink = added.inventory_items.find(row => row.inventory_item_id === item.inventory_item_id);
        expect(addedLink).toMatchObject({ required_quantity: 2 });
        const updated = decodeVariant((yield* request(base + "/" + item.inventory_item_id + query, "POST", { required_quantity: 9 })).variant);
        const updatedLinks = updated.inventory_items.filter(row => row.inventory_item_id === item.inventory_item_id);
        expect(updatedLinks).toEqual([{ id: expect.any(String), variant_id: first.id, inventory_item_id: item.inventory_item_id, required_quantity: 9 }]);
        expect(updatedLinks[0]?.id).not.toBe(addedLink?.id);
        const deleted = yield* request(base + "/" + item.inventory_item_id + query, "DELETE");
        expect(deleted).toEqual({ id: link(first.id, item.inventory_item_id), object: "variant-inventory-item-link", deleted: true, parent: first });
        yield* request(base + "/" + item.inventory_item_id + query, "POST", { required_quantity: 9 }, 404);
        expect(yield* request(`/admin/products/${firstId}/variants/inventory-items/batch`, "POST", {})).toEqual({ created: [], updated: [], deleted: [] });
        const batch = { variant_id: first.id, inventory_item_id: item.inventory_item_id, required_quantity: 6 };
        expect(yield* request(`/admin/products/${firstId}/variants/inventory-items/batch`, "POST", { create: [batch] }))
          .toEqual({ created: [link(first.id, item.inventory_item_id, 6)], updated: [], deleted: [] });
        yield* request(base + "/" + item.inventory_item_id + query, "DELETE");
        phase = "graph: existing Variant Price identity";
        const priced = Schema.decodeUnknownSync(Schema.Struct({ price_set: Schema.Struct({ prices: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString })) }) }))(
          (yield* operations.query.graph({ entity: "variant", fields: ["price_set.prices.id"], filters: { id: first.id } })).data[0]);
        const priceId = priced.price_set.prices[0]?.id;
        if (priceId === undefined) return yield* Effect.die(new Error("Native alias witness omitted its existing Price ID"));
        const aliasQuery = "?fields=id,prices.id,price_set.prices.id";
        const aliasVariant = { id: first.id, prices: [{ id: priceId, amount: 0, title: "", raw_amount: { value: 0 }, currency_code: "",
          min_quantity: null, max_quantity: null, price_set_id: "", variant_id: first.id, deleted_at: null, rules: {} }] };
        // Both valid aliases lower to the same native RemoteQuery node field.
        expect(yield* request(base + aliasQuery, "POST", { inventory_item_id: item.inventory_item_id, required_quantity: 11 }))
          .toEqual({ variant: aliasVariant });
        expect((yield* read(firstId)).inventory_items.filter(row => row.inventory_item_id === item.inventory_item_id))
          .toEqual([expect.objectContaining({ required_quantity: 11 })]);
        expect(yield* request(base + "/" + item.inventory_item_id + aliasQuery, "POST", { required_quantity: 12 }))
          .toEqual({ variant: aliasVariant });
        expect((yield* read(firstId)).inventory_items.filter(row => row.inventory_item_id === item.inventory_item_id))
          .toEqual([expect.objectContaining({ required_quantity: 12 })]);
        expect(yield* request(base + "/" + item.inventory_item_id + aliasQuery, "DELETE"))
          .toEqual({ id: link(first.id, item.inventory_item_id), object: "variant-inventory-item-link", deleted: true, parent: aliasVariant });
        expect((yield* read(firstId)).inventory_items.filter(row => row.inventory_item_id === item.inventory_item_id)).toEqual([]);
        expect((yield* read(otherId))).toEqual(other);
      }));
    } catch (cause) {
      primary.push(cause);
      // Test-boundary diagnostics contain only the phase and admitted HTTP path.
      // Rethrow the original failure, retaining its complete Effect/foreign cause.
      console.error("Native Variant Inventory Link HTTP proof failed", { driver, phase });
      throw cause;
    } finally {
      try { await fixture?.close(); }
      catch (cause) { throw new AggregateError([...primary, cause], "Variant Inventory Link HTTP proof cleanup failed"); }
    }
  }, 300_000);

  it("keeps foreign tenant Variant, Inventory and Link identities outside a second instance sharing the same physical tables", async () => {
    const first = await prepareProductRequestFixture(driver);
    let second: Awaited<ReturnType<typeof prepareProductRequestFixture>> | undefined;
    try {
      const identity = await first.use(operations => Effect.gen(function* () {
        const product = (yield* operations.runWorkflow("create-products", { products: [{ title: "Tenant A", handle: "tenant-a-links",
          options: [{ title: "Size", values: ["One"] }], variants: [{ title: "Tenant A One", sku: "TENANT-A-LINKS", options: { Size: "One" },
            prices: [{ amount: 901, currency_code: "usd" }] }] }] })).result[0];
        if (product === undefined) return yield* Effect.die(new Error("Native tenant seed omitted Product"));
        return decodeVariant((yield* operations.query.graph({ entity: "variant", fields, filters: { product_id: product.id } })).data[0]);
      }));
      const item = identity.inventory_items[0];
      if (item === undefined) throw new Error("Native tenant seed omitted Inventory Link");
      const beforeFirst = await first.fixture.snapshot();
      const physical = first.fixture.physical;
      const secondInstance = "variant-inventory-tenant-b";
      second = await prepareProductRequestFixture(driver, { target: { scopeUuid: "f1000000-0000-4000-8000-000000000001",
        epochUuid: "f1000000-0000-4000-8000-000000000002" }, physical: { ...physical,
        persistence: await physical.reopen(secondInstance), instanceName: secondInstance,
        reopen: (instanceName = secondInstance) => physical.reopen(instanceName), close: async () => {},
      } });
      const other = second;
      expect(other.fixture.physical.namespace).toBe(physical.namespace);
      expect(other.fixture.physical.instanceName).not.toBe(physical.instanceName);
      // Both actual commerce graphs coexist in the same installed five tables.
      // Core persistence owns instance_name routing; each instance admits its own target bundle.
      const secondIdentity = await other.use(operations => Effect.gen(function* () {
        const product = (yield* operations.runWorkflow("create-products", { products: [{ title: "Tenant B", handle: "tenant-b-links",
          options: [{ title: "Size", values: ["One"] }], variants: [{ title: "Tenant B One", sku: "TENANT-B-LINKS", options: { Size: "One" },
            prices: [{ amount: 902, currency_code: "usd" }] }] }] })).result[0];
        if (product === undefined) return yield* Effect.die(new Error("Native second tenant seed omitted Product"));
        return decodeVariant((yield* operations.query.graph({ entity: "variant", fields, filters: { product_id: product.id } })).data[0]);
      }));
      const beforeSecond = await other.fixture.snapshot();
      await other.use(operations => Effect.gen(function* () {
        expect((yield* operations.query.graph({ entity: "variant", fields, filters: { id: secondIdentity.id } })).data.map(row => decodeVariant(row))).toEqual([secondIdentity]);
        expect((yield* operations.query.graph({ entity: "variant", fields, filters: { id: identity.id } })).data).toEqual([]);
        expect((yield* operations.query.graph({ entity: "product_variant_inventory_items", fields: ["id", "variant_id", "inventory_item_id"],
          filters: { variant_id: [identity.id] } })).data).toEqual([]);
        const scopes = yield* makeProductRequestScopeFactory({ operations, container: createContainer() });
        const engine = scopes.createRequestScope().resolve<NativeEngine>(Modules.WORKFLOW_ENGINE);
        for (const name of ["create", "update", "dismiss"] as const) {
          const result = yield* Effect.result(Effect.tryPromise({ try: () => engine.run(`${name}-product-variant-inventory-links`, {
            input: { product_id: identity.product_id, links: [link(identity.id, item.inventory_item_id, name === "dismiss" ? undefined : 2)] },
          }), catch: error => error }));
          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) expect(result.failure).toMatchObject({ type: MedusaError.Types.NOT_FOUND,
            message: expect.stringContaining("Could not find all Product Variants for Product") });
        }
        for (const arm of ["create", "update", "delete"] as const) {
          const result = yield* Effect.result(Effect.tryPromise({ try: () => engine.run("batch-product-variant-inventory-links", {
            input: { product_id: identity.product_id, create: [], update: [], delete: [],
              [arm]: [link(identity.id, item.inventory_item_id, arm === "delete" ? undefined : 2)] },
          }), catch: error => error }));
          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) expect(result.failure).toMatchObject({ type: MedusaError.Types.NOT_FOUND,
            message: expect.stringContaining("Could not find all Product Variants for Product") });
        }
      }));
      const { outcomes: _before, ...beforeBusiness } = beforeSecond;
      const afterSecond = await other.fixture.snapshot();
      const { outcomes: _after, ...afterBusiness } = afterSecond;
      expectFailedRootAudit(beforeSecond, afterSecond);
      expect(afterBusiness).toEqual(beforeBusiness);
      expect(await first.fixture.snapshot()).toEqual(beforeFirst);
    } finally {
      const failures: unknown[] = [];
      // Borrowed tenant B drains before the sole physical owner closes its database/pool.
      for (const fixture of [second?.fixture, first.fixture]) {
        try { await fixture?.close(); } catch (cause) { failures.push(cause); }
      }
      if (failures.length > 0) throw new AggregateError(failures, "Tenant Link proof cleanup failed");
    }
  }, 300_000);
});
