import { createCorePostgresFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { prepareProductRequestFixture, observeProductRequestFixture } from "@flarex/medusa-adapter/internal/system-test/product-request-fixture";
import { Schema } from "effect";
import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { bundleApplicationWorker } from "./support/bundleApplicationWorker";
import { createExecutorApplicationSecretFixture, executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";
import { adminProductDOFixtureTarget } from "./support/adminProductDOFixtureIdentity";

const endpointPath = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = endpointPath === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({
  connectionString: Schema.NonEmptyString, provisioningConnectionString: Schema.NonEmptyString,
}))(JSON.parse(await readFile(endpointPath, "utf8")));
const privateToken = "private-native-admin-product-app-fixture";
const adminCredential = "native-admin-product-identity-fixture";
const path = "/admin/products?fields=id,title,handle,status,options.id,options.title,options.values.id,options.values.value";
const productInput = { title: "Real DO Product", handle: "real-do-product", options: [{ title: "Size", values: ["One"] }] };
const decodeProduct = Schema.decodeUnknownSync(Schema.Struct({ product: Schema.Struct({
  id: Schema.NonEmptyString, title: Schema.String, handle: Schema.String, status: Schema.String,
  options: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String,
    values: Schema.Array(Schema.Struct({ id: Schema.String, value: Schema.String })) })),
}) }));

describe.runIf(endpoints !== undefined)("native-ready private Admin Product in the real application DO", () => {
  it("rejects unauthorized/invalid requests without Product writes and independently reads the committed native workflow result after close", async () => {
    if (endpoints === undefined) throw new Error("Admin Product app DO requires ordinary PostgreSQL");
    const physical = await createCorePostgresFixture(endpoints);
    let seed: Awaited<ReturnType<typeof prepareProductRequestFixture>> | undefined;
    let runtime: Miniflare | undefined;
    const primary: unknown[] = [];
    const stop = async () => {
      const current = runtime;
      runtime = undefined;
      if (current === undefined) return;
      const failures: unknown[] = [];
      try {
        const closed = await current.dispatchFetch("https://native-admin.test/__proof/close", {
          headers: { authorization: `Bearer ${privateToken}` },
        });
        if (!closed.ok) throw new Error(await closed.text());
      } catch (cause) { failures.push(cause); }
      try { await current.dispose(); } catch (cause) { failures.push(cause); }
      if (failures.length > 0) throw new AggregateError(failures, "Admin Product DO cleanup failed");
    };
    try {
      seed = await prepareProductRequestFixture("postgres", { target: adminProductDOFixtureTarget,
        physical: { ...physical, close: async () => {} } });
      await seed.fixture.close();
      const initial = await observeProductRequestFixture({ physical, catalog: seed.catalog });
      expect(initial.products).toEqual([]);
      const worker = await bundleApplicationWorker(new URL("./adminProductApplicationDO.workerd.worker.ts", import.meta.url));
      const base = executorApplicationProfileFixture();
      const profile = { ...base, ...adminProductDOFixtureTarget, persistenceNamespace: physical.namespace, instanceName: physical.instanceName };
      const keys = await createExecutorApplicationSecretFixture(profile.keyId);
      const start = () => {
        if (runtime !== undefined) throw new Error("Previous Product DO owner has not drained");
        runtime = new Miniflare({ modules: [{ type: "ESModule", path: "worker.js", contents: worker }],
          compatibilityDate: "2026-06-14", compatibilityFlags: ["nodejs_compat"],
          bindings: { FLAREX_EXECUTOR_TOKEN: privateToken, ADMIN_PRODUCT_CREDENTIAL: adminCredential,
            FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [profile] }), FLAREX_APPLICATION_KEYS: keys },
          hyperdrives: { HYPERDRIVE_CACHE_DISABLED: endpoints.connectionString }, workerLoaders: { LOADER: {} }, r2Buckets: ["ARTIFACTS"],
          durableObjects: { APPLICATIONS: { className: "NativeAdminProductApplicationFixture", useSQLite: true } },
        });
      };
      const request = (input: unknown, options: Readonly<{ private?: boolean; admin?: string; path?: string }> = { private: true, admin: adminCredential }) => {
        if (runtime === undefined) throw new Error("Native Product DO is closed");
        return runtime.dispatchFetch(`https://native-admin.test${options.path ?? path}`, { method: "POST",
          headers: { "content-type": "application/json", origin: "https://admin.test",
            ...(options.private === true ? { authorization: `Bearer ${privateToken}` } : {}),
            ...(options.admin === undefined ? {} : { "x-admin-fixture-token": options.admin }) }, body: JSON.stringify(input) });
      };
      start();
      expect((await request(productInput, { admin: adminCredential })).status).toBe(401);
      expect((await request(productInput, { private: true })).status).toBe(401);
      expect((await request(productInput, { private: true, admin: "invalid-admin" })).status).toBe(401);
      expect((await request(productInput, { private: true, admin: `${adminCredential}-without-policy` })).status).toBe(403);
      expect((await request({ title: 42 })).status).toBe(400);
      expect((await request(productInput, { private: true, admin: adminCredential, path: "/admin/products" })).status).toBe(400);
      expect((await request(productInput, { private: true, admin: adminCredential, path: "/admin/products?fields=unsupported_field" })).status).toBe(400);
      const unsupported = await request({ ...productInput, variants: Array.from({ length: 5 }, (_, index) => ({
        title: `Variant ${index}`, options: { Size: "One" }, prices: [],
      })) });
      expect(unsupported.status, await unsupported.clone().text()).toBe(400);
      expect(await unsupported.json()).toMatchObject({ type: "invalid_data", message: expect.stringContaining("private supported profile") });
      await stop();
      const refused = await observeProductRequestFixture({ physical, catalog: seed.catalog });
      expect(refused).toEqual(initial);

      start();
      const workflowFailure = await request({ title: "Invalid workflow Product", handle: "no-product-options" });
      expect(workflowFailure.status, await workflowFailure.clone().text()).toBe(400);
      expect(await workflowFailure.json()).toMatchObject({ type: "invalid_data",
        message: "Product options are not provided for: [Invalid workflow Product]." });
      await stop();
      const failed = await observeProductRequestFixture({ physical, catalog: seed.catalog });
      expect(failed.products).toEqual(initial.products);
      expect(failed.options).toEqual(initial.options);
      expect(failed.optionValues).toEqual(initial.optionValues);

      start();
      const created = await request(productInput);
      expect(created.status, await created.clone().text()).toBe(200);
      expect(created.headers.get("access-control-allow-origin")).toBe("https://admin.test");
      const product = decodeProduct(await created.json()).product;
      expect(product).toMatchObject({ title: productInput.title, handle: productInput.handle,
        options: [{ title: "Size", values: [{ value: "One" }] }] });
      expect(product.id).toMatch(/^prod_/);
      await stop();
      // The HTTP owner is completely closed before an independent Core observer
      // opens the persisted database. This cannot read a workflow/HTTP cache.
      const persisted = await observeProductRequestFixture({ physical, catalog: seed.catalog });
      expect(persisted.products).toHaveLength(1);
      expect(persisted.products[0]).toMatchObject({ id: product.id, title: productInput.title, handle: productInput.handle });
      expect(persisted.options).toHaveLength(1);
      expect(persisted.options[0]).toMatchObject({ id: product.options[0]?.id, product_id: product.id, title: "Size" });
      expect(persisted.optionValues).toHaveLength(1);
      expect(persisted.optionValues[0]).toMatchObject({ id: product.options[0]?.values[0]?.id, value: "One", option_id: persisted.options[0]?.id });
    } catch (cause) { primary.push(cause); throw cause; }
    finally {
      const failures: unknown[] = [];
      try { await stop(); } catch (cause) { failures.push(cause); }
      try { await seed?.fixture.close(); } catch (cause) { failures.push(cause); }
      try { await physical.close(); } catch (cause) { failures.push(cause); }
      if (failures.length > 0) throw new AggregateError([...primary, ...failures], "Admin Product proof cleanup failed");
    }
  }, 240_000);
});
