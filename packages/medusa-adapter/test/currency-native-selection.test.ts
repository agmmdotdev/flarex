import { expect, it } from "vitest";
import { Effect, Result } from "effect";
import { currencyFixture } from "./support/fixture";
import { currencyReadPlan } from "../src/modules/currency/repository";
import { projectRows } from "../src/query/projection";
import { serializeCurrency } from "../src/modules/currency/values";
import { captureCommerceInput } from "../src/value/input";
import { isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { currencyStaticResources } from "@medusajs/currency/static-manifest";
import { createQuery, executeRemoteFetchServiceRequest, RemoteQuery } from "@medusajs/modules-sdk/remote-query";
import type { SqlEntityManager } from "@medusajs/deps/mikro-orm/postgresql";

it("matches native Currency identity and requested numeric fields at the DAL boundary", async () => {
  const driver = process.env.MEDUSA_COMPARISON_DRIVER ?? "pglite";
  if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid comparison driver");
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const fixture = yield* currencyFixture(driver);
    if (driver === "postgres") {
      const manager = fixture.repository.getFreshManager<SqlEntityManager>();
      yield* Effect.promise(() => manager.getConnection().execute("UPDATE currency SET rounding = 0.05, raw_rounding = '{\"value\":\"0.050000000000000000000\",\"precision\":20}'::jsonb WHERE code = 'usd'"));
      expect(yield* Effect.promise(() => manager.getConnection().execute("SELECT raw_rounding FROM currency WHERE code = 'usd'")))
        .toEqual([{ raw_rounding: { value: "0.050000000000000000000", precision: 20 } }]);
    }
    const selections = [["name"], ["name", "id"], ["code", "name", "id"], ["id"],
      ["rounding", "id"], ["bogus"], ["bogus", "id"]];
    const comparisons = [];
    for (const select of selections) {
      const native = yield* Effect.promise(() => fixture.service.listCurrencies({ code: ["usd"] }, { select }));
      const serialized = JSON.parse(JSON.stringify(native));
      comparisons.push({ select, serialized });
    }
    const complete = yield* Effect.promise(() => fixture.service.listCurrencies({ code: ["usd"] }));
    const rows = Result.getOrThrow(captureCommerceInput(JSON.parse(JSON.stringify(complete))));
    if (!Array.isArray(rows) || !rows.every(isJsonObject)) throw new Error("Invalid native comparison rows");
    for (const { select, serialized } of comparisons) {
      const plan = Result.getOrThrow(currencyReadPlan({ where: { code: "usd" }, options: { fields: select } }));
      const selected = Result.getOrThrow(projectRows(rows, plan.projection.node));
      expect(yield* serializeCurrency(selected), select.join(",")).toEqual(serialized);
      expect(serialized).toEqual([expect.objectContaining({ code: "usd" })]);
      expect(serialized[0]).not.toHaveProperty("id");
    }
    const rawOnly = yield* Effect.promise(() => fixture.service.listCurrencies({ code: ["usd"] }, { select: ["raw_rounding", "id"] }));
    const rawPlan = Result.getOrThrow(currencyReadPlan({ options: { fields: ["raw_rounding", "id"] } }));
    const storedRaw = { value: driver === "postgres" ? "0.050000000000000000000" : "0", precision: 20 };
    const partial = yield* serializeCurrency(Result.getOrThrow(projectRows([{ code: "usd", raw_rounding: storedRaw }], rawPlan.projection.node)));
    expect(partial).toEqual([{ code: "usd", raw_rounding: storedRaw }]);
    // Mikro's entity getter also serializes an unrequested numeric field. Native
    // Query owns that final response mask; the DAL preserves requested raw data.
    expect(rawOnly).toEqual([expect.objectContaining({ code: "usd", raw_rounding: storedRaw })]);
    const config = currencyStaticResources.joinerConfig;
    if (config === undefined) throw new Error("Missing native Currency joiner configuration");
    const nativeQuery = createQuery({ remoteQuery: new RemoteQuery({ servicesConfig: [config],
      entitiesMap: new Map(), entityRelations: new Map(),
      remoteFetchData: request => executeRemoteFetchServiceRequest({ ...request, service: fixture.service }),
    }) });
    const response = yield* Effect.promise(() => nativeQuery.graph({ entity: "currency", fields: ["code", "raw_rounding"],
      filters: { code: "usd" } }));
    expect(JSON.parse(JSON.stringify(response))).toEqual({ data: partial });
  })));
});
