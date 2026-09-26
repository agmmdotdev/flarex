import { afterAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/frameworkSchema/privateCanonicalValue";
import { defineCommerceCommand, makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { commerceError } from "../../persistence-postgres/src/commerceTransaction/model";
import { defaultCommerceResources } from "../../persistence-postgres/src/commerceTransaction/resources";
import { fxAppJsonEntryCurrent, fxAppRowCurrent } from "../../persistence-postgres/src/schema";
import { selectLogicalJsonSearchDefinition } from "../../persistence-postgres/src/logicalDocuments/searchEntries";
import { compileFullPricingDefinition } from "../src/pricing-schema";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Pricing JSON test driver");
const cleanup: Array<() => Promise<void>> = [];

describe("native Pricing JSON containment on shared logical storage", () => {
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("maintains and queries the pinned PriceListRule value index in one shared row family", async () => {
    const full = await Effect.runPromise(compileFullPricingDefinition());
    const source = await Effect.runPromise(captureLogicalSchemaSource({
      key: "medusa.pricing.full", owner: "medusa", writeProfile: "medusa.pricing.full",
      evidence: full.provenance, definition: { kind: "relational", schema: full.schema },
      bindings: full.schema.tables.map(table => ({ kind: "definition" as const,
        localName: table.identity.tableId,
        table: { namespace: "medusa" as const,
          logicalName: `${full.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
    }));
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close),
      { additionalSources: [source] });
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({
      format: "flarex.initialization-dataset", version: 1, rows: [],
    }, 1_048_576, { invalidInput: () => new Error("Invalid Pricing dataset"),
      hashFailure: cause => new Error("Pricing dataset hash", { cause }) }));
    const write = defineCommerceCommand("jsonPricingCreate", "write", ctx => Effect.gen(function* () {
      const lists = yield* ctx.table("price_list");
      yield* lists.write(ctx.manager, "insert", [
        { id: "plist_json", title: "JSON rules", description: "JSON containment",
          status: "active", type: "sale", rules_count: 1 },
        { id: "plist_other", title: "Other rules", description: "JSON containment",
          status: "active", type: "sale", rules_count: 1 },
      ]);
      const rules = yield* ctx.table("price_list_rule");
      yield* rules.write(ctx.manager, "insert", [
        { id: "prule_us", price_list_id: "plist_json", attribute: "region", value: ["us", "eu"] },
        { id: "prule_apac", price_list_id: "plist_other", attribute: "region", value: ["apac"] },
      ]);
      const pending = yield* rules.find(ctx.manager, { fields: ["id"],
        predicate: { kind: "and", children: [
          { kind: "isNull", column: "deleted_at" },
          { kind: "jsonContains", column: "value", value: "us" },
        ] }, order: { column: "id", direction: "asc" } });
      if (pending.length !== 1 || pending[0]?.id !== "prule_us")
        return yield* ctx.refuse(commerceError("storedCorruption"));
      return null;
    }));
    const read = defineCommerceCommand("jsonPricingRead", "read", (ctx, value) => Effect.gen(function* () {
      const rules = yield* ctx.table("price_list_rule");
      return yield* rules.find(ctx.manager, { fields: ["id", "attribute", "value"],
        predicate: { kind: "and", children: [
          { kind: "isNull", column: "deleted_at" },
          { kind: "jsonContains", column: "value", value },
        ] }, order: { column: "id", direction: "asc" } });
    }));
    const readByList = defineCommerceCommand("jsonPricingReadByList", "read", (ctx, value) => Effect.gen(function* () {
      const rules = yield* ctx.table("price_list_rule");
      return yield* rules.find(ctx.manager, { fields: ["id", "price_list_id"],
        predicate: { kind: "and", children: [
          { kind: "isNull", column: "deleted_at" },
          { kind: "in", column: "price_list_id", values: [value] },
          { kind: "jsonContains", column: "value", value: [] },
        ] }, order: { column: "id", direction: "asc" } });
    }));
    const update = defineCommerceCommand("jsonPricingUpdate", "write", (ctx, value) => Effect.gen(function* () {
      const rules = yield* ctx.table("price_list_rule");
      yield* rules.write(ctx.manager, "update", [{ id: "prule_us", value }]);
      return null;
    }));
    const softDelete = defineCommerceCommand("jsonPricingSoftDelete", "write", ctx => Effect.gen(function* () {
      const rules = yield* ctx.table("price_list_rule");
      yield* rules.lifecycle(ctx.manager, "softDelete", ["prule_us"]);
      return null;
    }));
    const restore = defineCommerceCommand("jsonPricingRestore", "write", ctx => Effect.gen(function* () {
      const rules = yield* ctx.table("price_list_rule");
      yield* rules.lifecycle(ctx.manager, "restore", ["prule_us"]);
      return null;
    }));
    const hardDelete = defineCommerceCommand("jsonPricingHardDelete", "write", ctx => Effect.gen(function* () {
      const rules = yield* ctx.table("price_list_rule");
      yield* rules.delete(ctx.manager, ["prule_us"]);
      return null;
    }));
    const reject = defineCommerceCommand("jsonPricingReject", "write", ctx => Effect.gen(function* () {
      const rules = yield* ctx.table("price_list_rule");
      yield* rules.write(ctx.manager, "update", [{ id: "prule_us", value: ["rollback"] }]);
      return yield* ctx.refuse(commerceError("invalidInput"));
    }));
    const host = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput,
      identityAndAccessPolicy: { profile: "logical-pricing-json-index" },
      logicalStorage: { ...fixture.hostInput.logicalStorage,
        source: { sourceKey: source.key, writeProfile: source.writeProfile,
          schema: full.schema, evidence: full.provenance },
        initialization: { stepId: "pricing-full-empty", datasetSha256: dataset.sha256Hex,
          expectedRowCount: 0 },
      }, commands: [write, read, readByList, update, softDelete, restore, hardDelete, reject],
    }));
    try {
      await Effect.runPromise(host.initialize([]));
      const beforeTables = fixture.physicalTablesBeforeCandidate;
      const beforeRows = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const key = host.newRequestKey();
      await Effect.runPromise(host.run(key, write, null));
      expect(await Effect.runPromise(host.read(read, "us")))
        .toMatchObject([{ id: "prule_us", value: ["us", "eu"] }]);
      expect(await Effect.runPromise(host.read(read, ["us"])))
        .toMatchObject([{ id: "prule_us", value: ["us", "eu"] }]);
      expect(await Effect.runPromise(host.read(read, "apac")))
        .toMatchObject([{ id: "prule_apac", value: ["apac"] }]);
      expect(await Effect.runPromise(host.read(read, "missing"))).toEqual([]);
      const initialEntries = await fixture.persistence.drizzle.select().from(fxAppJsonEntryCurrent);
      expect(initialEntries).toHaveLength(2);
      const first = initialEntries[0];
      if (first === undefined) throw new Error("Missing PriceListRule JSON entry");
      const partial = { kind: "jsonContainment" as const, tableId: first.tableId,
        logicalIndexId: first.logicalIndexId, sourceSha256: first.sourceSha256,
        columns: ["value"], nullPredicateField: "deleted_at" };
      const unconditional = { ...partial, nullPredicateField: null };
      expect(selectLogicalJsonSearchDefinition([partial, unconditional], first.tableId,
        "value", new Set())).toBe(unconditional);
      expect(selectLogicalJsonSearchDefinition([partial, unconditional], first.tableId,
        "value", new Set(["deleted_at"]))).toBe(partial);
      const afterCreate = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      expect(afterCreate).toHaveLength(beforeRows.length + 4);
      const narrowHost = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput,
        identityAndAccessPolicy: { profile: "logical-pricing-json-index" },
        logicalResources: { ...defaultCommerceResources, catalogRows: 1,
          queryRows: 1, writeBatchRows: 1 },
        logicalStorage: { ...fixture.hostInput.logicalStorage,
          source: { sourceKey: source.key, writeProfile: source.writeProfile,
            schema: full.schema, evidence: full.provenance },
          initialization: { stepId: "pricing-full-empty", datasetSha256: dataset.sha256Hex,
            expectedRowCount: 0 },
        }, commands: [readByList],
      }));
      try {
        expect(await Effect.runPromise(narrowHost.read(readByList, "plist_json")))
          .toMatchObject([{ id: "prule_us", price_list_id: "plist_json" }]);
      } finally { await Effect.runPromise(narrowHost.close); }
      await Effect.runPromise(host.run(key, write, null));
      expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterCreate);
      await Effect.runPromise(host.run(host.newRequestKey(), update, ["eu"]));
      expect(await Effect.runPromise(host.read(read, "us"))).toEqual([]);
      expect(await Effect.runPromise(host.read(read, "eu")))
        .toMatchObject([{ id: "prule_us", value: ["eu"] }]);
      await Effect.runPromise(host.run(host.newRequestKey(), softDelete, null));
      expect(await Effect.runPromise(host.read(read, "eu"))).toEqual([]);
      await Effect.runPromise(host.run(host.newRequestKey(), restore, null));
      expect(await Effect.runPromise(host.read(read, "eu"))).toHaveLength(1);
      const beforeFailure = await fixture.persistence.drizzle.select().from(fxAppJsonEntryCurrent);
      await expect(Effect.runPromise(host.run(host.newRequestKey(), reject, null)))
        .rejects.toMatchObject({ reason: "invalidInput" });
      expect(await fixture.persistence.drizzle.select().from(fxAppJsonEntryCurrent)).toEqual(beforeFailure);
      expect(await Effect.runPromise(host.read(read, "rollback"))).toEqual([]);
      expect((await fixture.persistence.query<{ name: string }>(
        "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
        .toEqual(beforeTables);
      await fixture.persistence.exec("drop index fx_app_json_entry_current_lookup_gin");
      await expect(Effect.runPromise(host.read(read, "eu")))
        .rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      await fixture.persistence.exec(`create index fx_app_json_entry_current_lookup_gin
        on fx_app_json_entry_current using gin (scope_uuid public.uuid_ops,
          logical_index_id public.int4_ops, value_json jsonb_path_ops)`);
      expect(await Effect.runPromise(host.read(read, "eu"))).toHaveLength(1);
      await Effect.runPromise(host.run(host.newRequestKey(), hardDelete, null));
      expect(await Effect.runPromise(host.read(read, "eu"))).toEqual([]);
      expect(await fixture.persistence.drizzle.select().from(fxAppJsonEntryCurrent)).toHaveLength(1);
      const other = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
        resource: fixture.resource, additionalSources: [source],
        fixtureIdentity: { deploymentId: "deployment_pricing_json_shop_b",
          projectId: "project_pricing_json_shop_b", uuidOffset: 10_000 },
      });
      const otherHost = await Effect.runPromise(makeCommerceHost({ ...other.hostInput,
        identityAndAccessPolicy: { profile: "logical-pricing-json-index" },
        logicalStorage: { ...other.hostInput.logicalStorage,
          source: { sourceKey: source.key, writeProfile: source.writeProfile,
            schema: full.schema, evidence: full.provenance },
          initialization: { stepId: "pricing-full-empty", datasetSha256: dataset.sha256Hex,
            expectedRowCount: 0 },
        }, commands: [write, read],
      }));
      try {
        await Effect.runPromise(otherHost.initialize([]));
        await Effect.runPromise(otherHost.run(otherHost.newRequestKey(), write, null));
        expect(await Effect.runPromise(otherHost.read(read, "us")))
          .toMatchObject([{ id: "prule_us", value: ["us", "eu"] }]);
        expect(await Effect.runPromise(host.read(read, "us"))).toEqual([]);
        expect(await fixture.persistence.drizzle.select().from(fxAppJsonEntryCurrent)).toHaveLength(3);
      } finally { await Effect.runPromise(otherHost.close); }
    } finally { await Effect.runPromise(host.close); }
  }, 180_000);
});
