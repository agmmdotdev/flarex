import { Effect, Result } from "effect";
import { beforeAll, expect, it } from "vitest";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { makeStoreOrderReadCommands } from "../src/modules/order/store-read-service";
import { makeOrderCheckoutCommands } from "../src/modules/order/finance-service";
import { makeFulfillmentStoreOrderReadCommands } from "../src/modules/fulfillment/store-order-read-service";
import { prepareOrderFulfillmentLinkRead } from "../src/links/order-fulfillment-service";
import { workflowModuleDefinition } from "../src/workflow/module";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { prepareLocalGraph } from "../src/local-graph/query";
import { makeLocalProductCommands } from "../src/modules/product/service";
import { prepareIdReadRepository } from "../src/repository/id-read";
import { ScalarIdRead } from "../src/repository/scalar-id-read";
import { commerceDecoder } from "../src/value/decoder";
import type { SchemaTable } from "../src/schema/model";
import type { CommerceRelation } from "../src/query/relations";

let order: Effect.Success<ReturnType<typeof makeStoreOrderReadCommands>>;
beforeAll(async () => { order = await Effect.runPromise(makeStoreOrderReadCommands()); });

it("uses the shared native database page window without altering the finance/checkout profile", async () => {
  const table = Result.getOrThrow(order.prepared.contracts.entity("order")).table;
  const input = buildQuery({ customer_id: "customer-store", is_draft_order: false, $or: [{ status: "pending" }, { status: "completed" }] },
    { take: 50, skip: 2, order: { id: "DESC" }, select: ["id"] });
  const plan = Result.getOrThrow(order.prepared.query(table, input));
  expect(plan.window).toEqual({ kind: "database", countAt: "beforePopulation" });
  expect(plan.query).toMatchObject({ take: 50, skip: 2, order: { column: "id", direction: "desc" } });
  const old = await Effect.runPromise(makeOrderCheckoutCommands());
  expect(Result.isFailure(old.prepared.query(Result.getOrThrow(old.prepared.contracts.entity("order")).table, input))).toBe(true);
  expect(order.workflow.methods).toEqual({});
});

it("authenticates the actual Order-Fulfillment link and nonempty native local Fulfillment paths", async () => {
  const fulfillment = await Effect.runPromise(makeFulfillmentStoreOrderReadCommands());
  const link = await Effect.runPromise(prepareOrderFulfillmentLinkRead());
  const product = await Effect.runPromise(makeLocalProductCommands());
  const selected = [order.workflow, fulfillment.workflow, link.workflow, product.workflow].map((workflow, index) => {
    const definition = workflowModuleDefinition(workflow);
    if (definition === undefined) throw new Error("Missing native read definition");
    return { participant: defineAtomicCommerceParticipant("store-order-read-contract-" + index), module: definition.graph };
  });
  const graph = Result.getOrThrow(prepareLocalGraph(selected));
  expect(Result.isSuccess(graph.admitProjection("order", ["id", "payment_status", "fulfillment_status", "items.*", "items.detail.*", "fulfillments.*",
    "fulfillments.items.*", "fulfillments.labels.*", "fulfillments.delivery_address.*"]))).toBe(true);
  expect(workflowModuleDefinition(fulfillment.workflow)?.graph.reads.map(read => read.model))
    .toEqual(["ShippingOption", "ShippingProfile", "Fulfillment"]);
});

it("requires explicit native wildcard and bare-relation selection capabilities", () => {
  const table = (name: string): SchemaTable => ({ name, columns: [
    { name: "id", type: "id", nullable: false, primaryKey: true, generated: false },
    { name: "deleted_at", type: "text", nullable: true, primaryKey: false, generated: false },
  ], indexes: [], foreignKeys: [] });
  const root = table("record"), child = table("detail");
  const relation: CommerceRelation = { name: "detail", targetTable: child.name, sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"],
    join: { type: "hasOne", foreignKeys: ["id"] } };
  const relations = new Map([[root.name, new Map([[relation.name, relation]])]]);
  const prepare = (native: boolean) => Result.getOrThrow(prepareIdReadRepository(root, "Record", [root, child], relations, [], "recordRead",
    { hasManyPaths: [], decodeRead: commerceDecoder(ScalarIdRead, "invalidInput"),
      ...(native ? { allowBareRelations: true, allowWildcard: true } : {}) }));
  const ordinary = prepare(false), native = prepare(true);
  for (const fields of [["*"], ["detail"], ["detail.*"]]) {
    const query = { where: {}, options: { fields, populate: ["detail"] } };
    expect(Result.isFailure(ordinary.query(query))).toBe(true);
    expect(Result.isSuccess(native.query(query))).toBe(true);
  }
  expect(Result.isFailure(native.query({ where: {}, options: { fields: ["detail"], populate: [] } }))).toBe(true);
  expect(Result.isFailure(native.query({ where: {}, options: { fields: ["other.*"], populate: ["other"] } }))).toBe(true);
});
