import { Effect, Result } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileProductRequestCatalog } from "../src/http/product-request";
import { decodeProductAssociationRemoteQuery, prepareProductRequestReadGraph } from "../src/http/product-request-reads";
import { prepareLocalGraph } from "../src/local-graph/query";
import { planGraphFields } from "../src/local-graph/fields";
import { makePricingCatalogReads } from "../src/modules/pricing/catalog-reads";
import { compileWhere } from "../src/query/predicate";
import { compileProjection } from "../src/query/projection";
import { decodeProductParentRead, decodeProductVariantRead } from "../src/modules/product/service-input";

let catalog: Effect.Success<ReturnType<typeof compileProductRequestCatalog>>;
let product: Effect.Success<ReturnType<typeof prepareProductRequestReadGraph>>;
let variant: Effect.Success<ReturnType<typeof prepareProductRequestReadGraph>>;
let pricing: Effect.Success<ReturnType<typeof makePricingCatalogReads>>;
beforeAll(async () => {
  catalog = await Effect.runPromise(compileProductRequestCatalog({
    scopeUuid: "f0000000-0000-4000-8000-000000000021", epochUuid: "f0000000-0000-4000-8000-000000000022",
  }));
  product = await Effect.runPromise(prepareProductRequestReadGraph(catalog));
  variant = await Effect.runPromise(prepareProductRequestReadGraph(catalog, true));
  pricing = await Effect.runPromise(makePricingCatalogReads());
});
const admit = (entity: string, fields: readonly string[]) => (entity === "variant" ? variant : product).graph.admitProjection(entity, fields);
const producer = (entryPoint: string, filters: Record<string, unknown>, fields: string[]) =>
  remoteQueryObjectFromString({ entryPoint, variables: { filters }, fields });

describe("native batch and association RemoteQuery producers", () => {
  it("admits native Variant parent-array selectors before its selected DAL plan", () => {
    // The frozen HTTP removal witness reaches this exact command envelope:
    // native variants RemoteQuery forwards Product IDs as an array.
    const selected = Result.getOrThrow(decodeProductAssociationRemoteQuery(producer("variants", {
      product_id: ["product_missing_association"],
    }, ["price_set.id"]), admit));
    const command = { filters: selected.args.filters,
      config: { select: ["id"], relations: [], order: { id: "ASC" }, skip: 0, take: 128 } };
    expect(Result.isSuccess(decodeProductVariantRead(command))).toBe(true);
    expect(Result.isFailure(decodeProductParentRead(command))).toBe(true);
    expect(Result.isFailure(decodeProductVariantRead({ ...command, filters: { product_id: Array.from({ length: 5 }, (_, index) => "p_" + index) } }))).toBe(true);
  });

  it("accepts actual batch ID arrays, parent-product variant preselection and native refetch aliases", () => {
    for (const [entry, filters, fields, entity] of [
      ["product", { id: ["p_created", "p_updated"] }, ["id", "title"], "product"],
      ["variant", { id: ["v_created", "v_updated"] }, ["id", "product_id"], "variant"],
      ["variants", { product_id: ["p_one", "p_two"] }, ["price_set.id"], "variant"],
      ["sales_channel", { id: "sc_one" }, ["id", "name", "metadata"], "sales_channel"],
      ["price_lists", { id: "pl_one" }, ["id", "title", "price_list_rules.attribute", "price_list_rules.value"], "price_lists"],
      ["prices", { price_set_id: ["ps_one", "ps_two"], price_list_id: "pl_one" }, ["id"], "prices"],
    ] as const) {
      const selected = Result.getOrThrow(decodeProductAssociationRemoteQuery(producer(entry, filters, [...fields]), admit));
      expect(selected).toEqual({ entity, args: { filters }, fields });
    }
  });

  it("retains duplicate native alias selections and genuine nested Pricing projections", () => {
    const fields = ["id", "id", "price_list_rules.value", "price_list_rules.value", "prices.amount", "prices.price_rules.attribute"];
    const selected = Result.getOrThrow(decodeProductAssociationRemoteQuery(producer("price_lists", { id: "pl_one" }, fields), admit));
    expect(selected.fields).toEqual(fields);
    expect(Result.isFailure(decodeProductAssociationRemoteQuery(producer("price_lists", { id: "pl_one" }, ["prices.missing"]), admit))).toBe(true);
  });

  it("refuses paging, nested arguments and unsupported service capabilities", () => {
    for (const value of [
      remoteQueryObjectFromString({ entryPoint: "product", fields: ["id"], variables: { filters: { id: ["p"] }, take: 1 } }),
      remoteQueryObjectFromString({ entryPoint: "price_lists", fields: ["prices.id"], variables: { filters: { id: "pl" }, "prices": { take: 1 } } }),
      { __value: { prices: { fields: ["id"], isServiceAccess: true, __args: { filters: { price_list_id: "pl", price_set_id: [] } } } } },
    ]) expect(Result.isFailure(decodeProductAssociationRemoteQuery(value, admit))).toBe(true);
  });
});

describe("Pricing-owned native catalog read plans", () => {
  it("admits the frozen missing-Product preselection through Variant and empty Price DAL plans", async () => {
    const calls: unknown[] = [];
    for (const [entry, filters, fields] of [
      ["variants", { product_id: ["product_missing_association"] }, ["price_set.id"]],
      ["prices", { price_set_id: [], price_list_id: "pl_expanded" }, ["id"]],
    ] as const) {
      const selected = Result.getOrThrow(decodeProductAssociationRemoteQuery(producer(entry, filters, [...fields]), admit));
      const graph = selected.entity === "variant" ? variant : product;
      const output = await Effect.runPromise(graph.graph.bind({ refuse: error => Effect.fail(error), recordFailure: cause => Result.succeed(cause),
        call: (_participant, _command, args) => {
          calls.push(args);
          if (!isJsonObject(args) || !isJsonObject(args.filters ?? null) || !isJsonObject(args.config ?? null))
            return Effect.fail(commerceError("unsupportedProfile"));
          if (entry === "prices") {
            const native: unknown = Reflect.apply(buildQuery, undefined, [args.filters, args.config]);
            return Effect.fromResult(pricing.contracts.compile("Price", native)).pipe(Effect.as([[], 0] satisfies Json));
          }
          const metadata = catalog.runtimes.product.metadata;
          const profile = metadata.relatedReads.get(metadata.variant.table.name);
          if (profile === undefined) return Effect.fail(commerceError("unsupportedProfile"));
          return Effect.fromResult(compileWhere(args.filters, profile.where)).pipe(
            Effect.andThen(Effect.fromResult(compileProjection(metadata.readCatalog, metadata.variant.table.name, ["id"], [], profile.projection))),
            Effect.as([[], 0] satisfies Json));
        },
      }).graph({ entity: selected.entity, fields: selected.fields, filters: selected.args.filters, pagination: { take: 128, skip: 0 } }));
      expect(output).toEqual({ data: [], metadata: { count: 0, take: 128, skip: 0 } });
    }
    expect(calls).toHaveLength(2);
  });

  it("admits the frozen native expanded HTTP witness and compiles its actual graph-forwarded DAL command", async () => {
    const fields = ["id", "title", "prices.id", "prices.id", "prices.amount", "prices.raw_amount", "prices.currency_code", "prices.price_rules.attribute", "prices.price_rules.value"];
    const selected = Result.getOrThrow(decodeProductAssociationRemoteQuery(producer("price_lists", { id: "pl_expanded" }, fields), admit));
    const calls: unknown[] = [];
    const output = await Effect.runPromise(product.graph.bind({ refuse: error => Effect.fail(error), recordFailure: cause => Result.succeed(cause),
      call: (_participant, _command, args) => {
        calls.push(args);
        if (!isJsonObject(args) || !isJsonObject(args.filters ?? null) || !isJsonObject(args.config ?? null))
          return Effect.fail(commerceError("unsupportedProfile"));
        const native: unknown = Reflect.apply(buildQuery, undefined, [args.filters, args.config]);
        return Effect.fromResult(pricing.contracts.compile("PriceList", native)).pipe(Effect.as([[], 0] satisfies Json));
      },
    }).graph({ entity: selected.entity, fields: selected.fields, filters: selected.args.filters, pagination: { take: 128, skip: 0 } }));
    expect(output).toEqual({ data: [], metadata: { count: 0, take: 128, skip: 0 } });
    expect(calls).toHaveLength(1);
  });

  it("uses checked DML native relations and complete scalar row selection before projection", () => {
    const graph = Result.getOrThrow(prepareLocalGraph([{ participant: defineAtomicCommerceParticipant("pricing_catalog_test"), module: pricing.graph }]));
    expect(Result.isSuccess(graph.admitProjection("price_lists", ["id", "prices.amount", "prices.price_rules.value", "price_list_rules.attribute"]))).toBe(true);
    const read = pricing.graph.reads.find(read => read.model === "PriceList");
    if (read === undefined) throw new Error("Missing PriceList native read");
    const fields = Result.getOrThrow(planGraphFields(read, ["id", "price_list_rules.value", "prices.amount", "prices.price_rules.attribute"]));
    const plan = Result.getOrThrow(pricing.contracts.compile("PriceList", buildQuery({ id: "pl_one" }, {
      select: [...fields.select], relations: [...fields.relations], order: { id: "ASC" }, take: 128, skip: 0,
    })));
    expect(plan.paths).toEqual(["price_list_rules", "prices", "prices.price_rules"]);
    expect(plan.query.fields).toEqual(pricing.contracts.list.columns.map(column => column.name));
    expect(plan.withDeleted).toBe(false);
    expect(plan.query.predicate).toMatchObject({ kind: "and", children: [
      { kind: "and", children: [{ kind: "in", column: "id", values: ["pl_one"] }] }, { kind: "isNull", column: "deleted_at" },
    ] });
  });

  it("keeps selected Price sets and List conjunctive, and native active-set membership mandatory", () => {
    const plan = Result.getOrThrow(pricing.contracts.compile("Price", buildQuery({ price_set_id: ["ps_a", "ps_b"], price_list_id: "pl_a" },
      { select: ["id"], relations: [], order: { id: "ASC" }, take: 128, skip: 0 })));
    expect(plan.query.predicate).toMatchObject({ kind: "and", children: [{ kind: "and", children: [
      { kind: "in", column: "price_set_id", values: ["ps_a", "ps_b"] },
      { kind: "in", column: "price_list_id", values: ["pl_a"] },
    ] }, { kind: "isNull", column: "deleted_at" }] });
    expect(plan.relationFilters).toEqual([{ path: "price_set", predicate: { kind: "and", children: [
      { kind: "in", column: "id", values: ["ps_a", "ps_b"] }, { kind: "isNull", column: "deleted_at" },
    ] } }]);
    expect(plan.query.fields).toEqual(pricing.contracts.price.columns.map(column => column.name));
    expect(plan.projection.node.fields).toEqual(new Set(["id"]));
  });

  it("refuses a ninth ID without truncation, arbitrary selectors and mutation-shaped normalized data", () => {
    for (const filters of [{ price_set_id: Array.from({ length: 9 }, (_, index) => "ps_" + index), price_list_id: "pl" },
      { price_set_id: ["ps"], price_list_id: "pl", id: "price" }]) {
      expect(Result.isFailure(pricing.contracts.compile("Price", buildQuery(filters, { select: ["id"], order: { id: "ASC" } })))).toBe(true);
    }
    expect(Result.isFailure(pricing.contracts.compile("PriceList", buildQuery({ id: Array.from({ length: 9 }, (_, index) => "pl_" + index) }, { order: { id: "ASC" } })))).toBe(true);
    expect(Result.isFailure(pricing.contracts.compile("PriceList", { input: [{ id: "pl", title: "changed" }], config: {} }))).toBe(true);
  });
});
