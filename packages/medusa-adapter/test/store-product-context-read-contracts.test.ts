import { Effect, Result } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import type { Logger } from "@medusajs/framework/types";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { commerceCommandIdentity, type CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/frameworks/commerceTransaction/context";
import { compileStoreProductContextReadCatalog, decodeStoreProductContextQuery, type StoreProductContextReadCatalog } from "../src/http/store-product-context-reads";
import { captureCustomerMetadata } from "../src/modules/customer/schema";
import { decodeCustomerStoreProductRead, prepareCustomerStoreProductRead } from "../src/modules/customer/store-product-read";
import { projectRows } from "../src/query/projection";
import { resolveCommerceRelationFilter } from "../src/query/relation-filter";
import type { CommerceRelationRows } from "../src/query/relations";
import { captureCommerceInput } from "../src/value/input";
import { makeCommercePromiseOwner } from "../src/module/promise-owner";
import { mockRelationalRead } from "./mock-relational-read";
import type { SchemaTable } from "../src/schema/model";

const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: message => message,
  progress() {}, error() {}, failure() {}, success: () => ({}), silly() {}, debug() {}, verbose() {}, http() {}, info() {}, warn() {}, log() {} };
const receipt = { stepId: "initial", datasetSha256: "a".repeat(64), expectedRowCount: 0 };
const unusedStoreOperation = () => Effect.fail(commerceError("unsupportedProfile"));
const completeFixtureRow = (table: SchemaTable, id: string, references: JsonObject = {}): JsonObject =>
  Object.fromEntries(table.columns.map(column => [column.name, references[column.name] ?? (column.name === "id" ? id :
    column.nullable ? null : column.type === "json" ? {} : column.type === "boolean" ? false : "value")]));

describe("Store Product context read contracts (no database)", () => {
  let catalog: StoreProductContextReadCatalog;
  let prepared: Result.Result.Success<ReturnType<typeof prepareCustomerStoreProductRead>>;
  beforeAll(async () => {
    [catalog, prepared] = await Effect.runPromise(Effect.gen(function* () {
      const metadata = yield* captureCustomerMetadata();
      return [yield* compileStoreProductContextReadCatalog({ scopeUuid: "e0000000-0000-4000-8000-000000000001",
        epochUuid: "e0000000-0000-4000-8000-000000000002" }, { store: receipt, region: receipt, cart: receipt,
        customer: receipt, salesChannelLocation: receipt, tax: receipt }, logger),
      yield* Effect.fromResult(prepareCustomerStoreProductRead(metadata.frame))] as const;
    }));
  });

  it("prepares six genuine read sources and retains the Link endpoint key", () => {
    expect(Object.keys(catalog.sources)).toEqual(["store", "region", "cart", "customer", "salesChannelLocation", "tax"]);
    expect(catalog.members).toHaveLength(6);
    expect(Object.values(catalog.sources).map(source => source.commands.map(command => commerceCommandIdentity(command))))
      .toEqual([
        [{ name: "storeCountForCartContext", mode: "read" }], [{ name: "regionCountForCart", mode: "read" }],
        [{ name: "cartCountForCheckout", mode: "read" }], [{ name: "customerGroupsCountForStoreProduct", mode: "read" }],
        [{ name: "linkCount", mode: "read" }], [{ name: "taxGetItemTaxLines", mode: "read" }],
      ]);
    expect(catalog.sources.salesChannelLocation.graph.reads[0]?.table.primaryKeys).toEqual(["sales_channel_id", "stock_location_id"]);
    expect(catalog.sources.tax.graph.reads).toEqual([]);
    expect(catalog.sources.customer.definition.tables).toHaveLength(4);
    expect(catalog.sources.cart.definition.tables).toHaveLength(12);
  });

  it("accepts exactly the native empty Store filter and refuses arbitrary filter or root keys", () => {
    const query = { entity: "store", fields: ["id", "default_region_id"] };
    expect(Result.isSuccess(decodeStoreProductContextQuery(query))).toBe(true);
    expect(Result.isSuccess(decodeStoreProductContextQuery({ ...query, filters: {} }))).toBe(true);
    expect(Result.isFailure(decodeStoreProductContextQuery({ ...query, filters: { id: "store_other" } }))).toBe(true);
    expect(Result.isFailure(decodeStoreProductContextQuery({ ...query, filters: { customer_id: "cus_other" } }))).toBe(true);
    expect(Result.isFailure(decodeStoreProductContextQuery({ ...query, extra: true }))).toBe(true);
  });

  it.each([
    { entity: "cart", fields: ["region_id", "shipping_address.*"], filters: { id: "cart_other_customer" } },
    { entity: "store", fields: ["id", "default_region_id"], filters: {} },
    { entity: "region", fields: ["id", "currency_code"], filters: { id: "reg_one" } },
    { entity: "region", fields: ["automatic_taxes"], filters: { id: "reg_one" } },
    { entity: "customer_group", fields: ["id"], filters: { customers: { id: "cus_verified" } } },
    { entity: "sales_channel_locations", fields: ["stock_location_id"], filters: { sales_channel_id: "sc_one" } },
  ])("prepares the native $entity producer without adding a Cart ownership filter", async query => {
    const calls: JsonObject[] = [];
    const graph = catalog.graph.bind({ refuse: error => Effect.fail(error), recordFailure: Result.succeed,
      call: (_participant, _command, args) => {
        if (!isJsonObject(args)) return Effect.fail(commerceError("unsupportedProfile"));
        calls.push(args); return Effect.succeed([[], 0]);
      } });
    const result = await Effect.runPromise(graph.graph({ ...query, pagination: { take: query.entity === "sales_channel_locations" ? 256 : 4, skip: 0 } }));
    expect(result.data).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.filters).toEqual(query.filters);
    if (query.entity === "sales_channel_locations") expect(calls[0]?.config).toMatchObject({ order: { sales_channel_id: "ASC" } });
    if (query.entity === "cart") expect(calls[0]?.config).toMatchObject({ relations: ["shipping_address"] });
  });

  it("uses checked reverse Group membership metadata and complete pre-page counts", async () => {
    const input = { filters: { customers: { id: "cus_verified" } }, config: { select: ["id"], take: 1 } };
    const decoded = await Effect.runPromise(Effect.fromResult(decodeCustomerStoreProductRead(input)));
    const native = buildQuery(decoded.filters, { select: ["id"], take: 1, order: { id: "ASC" } });
    const plan = await Effect.runPromise(Effect.fromResult(prepared.query(native)));
    expect(plan.relationFilters).toEqual([{ path: "customers", predicate: { kind: "and", children: [
      { kind: "and", children: [{ kind: "in", column: "id", values: ["cus_verified"] }] }, { kind: "isNull", column: "deleted_at" },
    ] } }]);
    const groups = [{ id: "cg_one", name: "hidden" }, { id: "cg_two", name: "hidden too" }];
    if (plan.window.kind !== "catalog") throw new Error("Expected complete membership catalog");
    const selected = plan.window.select(groups);
    expect(selected.count).toBe(2);
    expect(await Effect.runPromise(Effect.fromResult(projectRows(selected.rows, plan.projection.node)))).toEqual([{ id: "cg_one" }]);
    const calls: unknown[] = [];
    const readRows: CommerceRelationRows = (table, predicate) => {
      calls.push({ table, predicate });
      return table === prepared.customer.name ? Effect.succeed([{ id: "cus_verified" }])
        : table === prepared.pivot.name ? Effect.succeed([{ id: "cusgc_one", customer_id: "cus_verified", customer_group_id: "cg_one" }])
        : Effect.fail(commerceError("unsupportedProfile"));
    };
    const membership = await Effect.runPromise(resolveCommerceRelationFilter(readRows, prepared.group.name, "customers",
      plan.relationFilters[0]!.predicate, prepared.catalog.relations));
    expect(membership).toEqual({ kind: "in", column: "id", values: ["cg_one"] });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ table: "customer_group_customer", predicate: { kind: "in", column: "customer_id", values: ["cus_verified"] } });
  });

  it.each([
    {}, { filters: {} }, { filters: { customers: { id: ["cus_verified"] } } },
    { filters: { customers: { id: "cus_verified" }, id: "cg_one" } },
    { filters: { customers: { id: "cus_verified" } }, config: { select: ["name"] } },
    { filters: { customers: { id: "cus_verified" } }, config: { relations: ["customers"] } },
  ])("refuses broader Customer selectors and fields: %j", input => {
    expect(Result.isFailure(decodeCustomerStoreProductRead(input))).toBe(true);
  });

  it("validates every complete DML row before Group projection and rejects deleted selections or foreign tables", () => {
    const row: JsonObject = Object.fromEntries(prepared.group.columns.map(column => [column.name,
      column.nullable ? null : column.type === "json" ? {} : column.type === "boolean" ? false : "value"]));
    expect(Result.isSuccess(prepared.admitSelection(prepared.group.name, [row]))).toBe(true);
    expect(Result.isFailure(prepared.admitSelection(prepared.group.name, [{ ...row, name: 42 }]))).toBe(true);
    expect(Result.isFailure(prepared.admitSelection(prepared.group.name, [{ ...row, deleted_at: "2020-01-01T00:00:00.000Z" }]))).toBe(true);
    expect(Result.isFailure(prepared.admitSelection("customer_address", [row]))).toBe(true);
    expect(Result.isFailure(prepared.admitSelection(prepared.group.name, Array.from({ length: 5 }, () => row)))).toBe(true);
    expect(Result.isFailure(captureCommerceInput(Object.defineProperty({}, "filters", { enumerable: true,
      get() { throw new Error("Descriptor must not run"); } })))).toBe(true);
  });

  it("returns detached mutable Customer Group DTOs from the actual issuer-checked DAL serializer", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(reason => commerceError(reason), commerceLimits,
        {}, {}, "customer-store-product-serializer", "read"), value => value.close);
      const owner = yield* Effect.acquireRelease(makeCommercePromiseOwner(), value => value.close);
      const sourceRows = new Map([
        [prepared.customer.name, [completeFixtureRow(prepared.customer, "cus_verified")]],
        [prepared.pivot.name, [completeFixtureRow(prepared.pivot, "cusgc_owned", { customer_id: "cus_verified", customer_group_id: "cg_owned" })]],
        [prepared.group.name, [completeFixtureRow(prepared.group, "cg_owned")]],
      ]);
      const evidence = new Map<string, readonly JsonObject[]>();
      for (const [table, rows] of sourceRows) {
        const captured = yield* Effect.fromResult(captureCommerceInput(rows));
        if (!Array.isArray(captured)) return yield* Effect.die(new Error("Expected complete fixture rows"));
        const selected: JsonObject[] = [];
        for (const row of captured) {
          if (!isJsonObject(row)) return yield* Effect.die(new Error("Expected captured fixture row"));
          selected.push(row);
        }
        evidence.set(table, selected);
      }
      const selections: string[] = [];
      const stores = new Map<string, CommerceCommandContext["store"]>();
      for (const [table, rows] of evidence) stores.set(table, {
        prepareRead(query) { return mockRelationalRead(this, query); }, findPage: unusedStoreOperation, aggregate: unusedStoreOperation,
        find: () => { selections.push(table); return Effect.succeed(rows); }, count: unusedStoreOperation,
        write: unusedStoreOperation, delete: unusedStoreOperation, lifecycle: unusedStoreOperation,
      });
      const groupStore = stores.get(prepared.group.name);
      if (groupStore === undefined) return yield* Effect.die(new Error("Missing Group store"));
      const context = makeCommerceCommandContext(lifetime, { resources: defaultCommerceResources, store: groupStore,
        table: (_manager, table) => {
          const store = stores.get(table);
          return store === undefined ? Effect.fail(commerceError("unsupportedProfile")) : Effect.succeed(store);
        } }, "customer-store-product-serializer", lifetime.context, unusedStoreOperation, unusedStoreOperation);
      const bound = prepared.bind(context, owner);
      const [rows, count] = yield* owner.invoke(() => bound.repository.findAndCount(buildQuery({ customers: { id: "cus_verified" } },
        { select: ["id"], take: 4, order: { id: "ASC" } }), { transactionManager: context.manager }));
      expect(count).toBe(1);
      const serialized = yield* owner.invoke(() => bound.repository.serialize<Array<{ id: string; customer_groups?: string[] }>>(rows));
      expect(serialized).toEqual([{ id: "cg_owned" }]);
      expect(Object.isFrozen(serialized)).toBe(false);
      expect(Object.isFrozen(serialized[0])).toBe(false);
      const first = serialized[0];
      if (first === undefined) return yield* Effect.die(new Error("Expected issued Group DTO"));
      first.customer_groups = ["native-hydration"];
      serialized.push({ id: "native-only" });
      expect(rows).toEqual([{ id: "cg_owned" }]);
      expect(yield* owner.invoke(() => bound.repository.serialize<JsonObject[]>(rows))).toEqual([{ id: "cg_owned" }]);
      expect(evidence.get(prepared.group.name)?.[0]?.id).toBe("cg_owned");
      expect(Object.isFrozen(evidence.get(prepared.group.name)?.[0])).toBe(true);
      expect(selections).toEqual([prepared.customer.name, prepared.pivot.name, prepared.group.name]);
      yield* owner.invoke(async () => {
        await expect(bound.repository.serialize(structuredClone(rows))).rejects.toMatchObject({ reason: "storedCorruption" });
      });
    })));
  });
});
