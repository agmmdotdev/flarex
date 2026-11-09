import { createCorePostgresFixture } from "@flarex/persistence-postgres/internal/system-test/core-persistence-fixture";
import { prepareStoreRequestReadFixture } from "@flarex/medusa-adapter/internal/system-test/store-request-read-fixture";
import { storeRequestReadTarget, storeRequestReadToken, storeRequestReadRevokedToken } from
  "@flarex/medusa-adapter/internal/system-test/store-request-read-catalog";
import { Schema } from "effect";
import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { bundleApplicationWorker } from "./support/bundleApplicationWorker";
import { createExecutorApplicationSecretFixture, executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";

const endpointPath = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = endpointPath === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({
  connectionString: Schema.NonEmptyString, provisioningConnectionString: Schema.NonEmptyString,
}))(JSON.parse(await readFile(endpointPath, "utf8")));
const token = "private-native-store-app-fixture";

describe.runIf(endpoints !== undefined)("native-only private Store reads in the real application DO", () => {
  it("reopens a fully drained admitted database and serves actual PostgreSQL data through Effect HTTP and native routes", async () => {
    if (endpoints === undefined) throw new Error("Native Store app DO requires ordinary PostgreSQL");
    const physical = await createCorePostgresFixture(endpoints);
    let seed: Awaited<ReturnType<typeof prepareStoreRequestReadFixture>> | undefined;
    let runtime: Miniflare | undefined;
    const primary: unknown[] = [];
    try {
      seed = await prepareStoreRequestReadFixture("postgres", { physical: { ...physical, close: async () => {} } });
      await seed.fixture.close();
      const worker = await bundleApplicationWorker(new URL("./storeCurrencyApplicationDO.workerd.worker.ts", import.meta.url));
      const base = executorApplicationProfileFixture();
      const profile = { ...base, ...storeRequestReadTarget, persistenceNamespace: physical.namespace, instanceName: physical.instanceName };
      runtime = new Miniflare({ modules: [{ type: "ESModule", path: "worker.js", contents: worker }],
        compatibilityDate: "2026-06-14", compatibilityFlags: ["nodejs_compat"],
        bindings: { FLAREX_EXECUTOR_TOKEN: token, FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [profile] }),
          FLAREX_APPLICATION_KEYS: await createExecutorApplicationSecretFixture(profile.keyId) },
        hyperdrives: { HYPERDRIVE_CACHE_DISABLED: endpoints.connectionString }, workerLoaders: { LOADER: {} }, r2Buckets: ["ARTIFACTS"],
        durableObjects: { APPLICATIONS: { className: "NativeStoreApplicationFixture", useSQLite: true } },
      });
      const request = (path: string, key = storeRequestReadToken) => {
        if (runtime === undefined) throw new Error("Native Store fixture is closed");
        return runtime.dispatchFetch(`https://native-store.test${path}`, { headers: {
          authorization: `Bearer ${token}`, "x-publishable-api-key": key, origin: "https://store.test",
        } });
      };
      expect((await runtime.dispatchFetch("https://native-store.test/store/currencies")).status).toBe(401);
      const listed = await request("/store/currencies?limit=1&offset=1&fields=code,name");
      expect(listed.status, await listed.clone().text()).toBe(200);
      expect(await listed.json()).toEqual({ currencies: [{ code: "eur", name: "Euro" }], count: 3, offset: 1, limit: 1 });
      expect(listed.headers.get("access-control-allow-origin")).toBe("https://store.test");
      const retrieved = await request("/store/currencies/USD?fields=code,name");
      expect(retrieved.status, await retrieved.clone().text()).toBe(200);
      expect(await retrieved.json()).toEqual({ currency: { code: "usd", name: "United States Dollar" } });
      const sorted = await request("/store/currencies?order=-code&fields=code");
      expect(sorted.status, await sorted.clone().text()).toBe(200);
      expect(await sorted.json()).toEqual({ currencies: [{ code: "usd" }, { code: "eur" }, { code: "chf" }], count: 3, offset: 0, limit: 50 });
      expect((await request("/store/currencies/absent")).status).toBe(404);
      expect((await request("/store/currencies", storeRequestReadRevokedToken)).status).toBe(400);
      expect((await request("/store/currencies", "pk_missing")).status).toBe(400);
      expect((await request("/store/currencies?limit=invalid")).status).toBe(400);
    } catch (cause) { primary.push(cause); throw cause; }
    finally {
      const failures: unknown[] = [];
      if (runtime !== undefined) {
        try {
          const closed = await runtime.dispatchFetch("https://native-store.test/__proof/close", {
            headers: { authorization: `Bearer ${token}` },
          });
          if (!closed.ok) throw new Error(await closed.text());
        } catch (cause) { failures.push(cause); }
        try { await runtime.dispose(); } catch (cause) { failures.push(cause); }
      }
      try { await seed?.fixture.close(); } catch (cause) { failures.push(cause); }
      try { await physical.close(); } catch (cause) { failures.push(cause); }
      if (failures.length > 0) throw new AggregateError([...primary, ...failures], "Native Store app DO cleanup failed");
    }
  }, 180_000);
});
