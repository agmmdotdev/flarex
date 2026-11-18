import { Effect, Result } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { captureOrderMetadata } from "../src/modules/order/schema";
import { compileOrderFinanceContracts } from "../src/modules/order/finance-contracts";
import { prepareOrderFinanceQuery, orderFinanceVersionFilters } from "../src/modules/order/finance-query";

describe("native Order financial read planning", () => {
  let contracts: Result.Result.Success<ReturnType<typeof compileOrderFinanceContracts>>;
  let prepared: ReturnType<typeof prepareOrderFinanceQuery>;
  beforeAll(async () => {
    contracts = Result.getOrThrow(compileOrderFinanceContracts((await Effect.runPromise(captureOrderMetadata())).frame));
    prepared = prepareOrderFinanceQuery(contracts.catalog, contracts.entities.map(entity => entity.table));
  });
  const plan = (table: string, filters: object, config: object) =>
    prepared.query(Result.getOrThrow(contracts.entity(table)).table, buildQuery(filters, config));

  it("retains native wrapper detail and loads real item/shipping entities for formatting", () => {
    const value = Result.getOrThrow(plan("order", { id: ["order-one"] }, {
      select: ["id", "version", "items.detail", "shipping_methods.detail", "summary"],
      relations: ["transactions", "credit_lines", "items", "items.tax_lines", "items.adjustments",
        "shipping_methods", "shipping_methods.tax_lines", "shipping_methods.adjustments"],
    }));
    expect(value.paths).toEqual(expect.arrayContaining(["items", "items.item", "items.item.tax_lines", "items.item.adjustments",
      "shipping_methods", "shipping_methods.shipping_method", "shipping_methods.shipping_method.tax_lines", "shipping_methods.shipping_method.adjustments",
      "summary", "credit_lines", "transactions"]));
    const item = value.projection.node.children.find(child => child.name === "items"),
      shipping = value.projection.node.children.find(child => child.name === "shipping_methods");
    expect(item?.node.fields.has("quantity")).toBe(true);
    expect(item?.node.children.find(child => child.name === "item")?.node.fields.has("unit_price")).toBe(true);
    expect(shipping?.node.fields.has("shipping_method_id")).toBe(true);
    expect(shipping?.node.children.find(child => child.name === "shipping_method")?.node.fields.has("amount")).toBe(true);
  });

  it("binds versioned populations to each parent rather than mixing Order versions", () => {
    const filters = Result.getOrThrow(orderFinanceVersionFilters("order", ["items", "summary", "transactions"], [
      { id: "order-one", version: 1 }, { id: "order-two", version: 3 },
    ]));
    expect(filters.map(filter => filter.path)).toEqual(["items", "summary"]);
    expect(filters[0]?.predicate).toEqual({ kind: "or", children: [
      { kind: "and", children: [{ kind: "in", column: "order_id", values: ["order-one"] }, { kind: "numberIn", column: "version", values: [1] }] },
      { kind: "and", children: [{ kind: "in", column: "order_id", values: ["order-two"] }, { kind: "numberIn", column: "version", values: [3] }] },
    ] });
    expect(orderFinanceVersionFilters("order", ["summary"], [{ id: "missing-version" }]))
      .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  });

  it("admits the native preview's direct item and manual shipping tax/adjustment reads", () => {
    for (const table of ["order_line_item", "order_shipping_method"]) {
      const value = Result.getOrThrow(plan(table, { id: ["preview-id"] }, { relations: ["adjustments", "tax_lines"] }));
      expect(value.paths).toEqual(["adjustments", "tax_lines"]);
      expect(value.projection.node.children.map(child => child.name)).toEqual(["adjustments", "tax_lines"]);
      expect(Result.isFailure(plan(table, { id: ["preview-id"] }, { relations: ["order"] }))).toBe(true);
    }
  });

  it("uses native action ordering while refusing unrelated or unknown population paths", () => {
    expect(Result.getOrThrow(plan("order_change", { id: ["change-one"] }, {
      select: ["id", "status", "actions"], relations: ["actions"], order: { actions: { ordering: "ASC" } },
    })).ordering.get("order_change_action")).toBe("ordering");
    expect(Result.isFailure(plan("order", {}, { relations: ["items.order.items"] }))).toBe(true);
    expect(Result.isFailure(plan("order", {}, { select: ["items.detail.unknown"] }))).toBe(true);
    expect(Result.isFailure(plan("order_transaction", { payment_id: "outside-profile" }, {}))).toBe(true);
  });
});
