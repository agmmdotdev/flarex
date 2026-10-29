import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { captureCustomerMetadata } from "../src/modules/customer/schema";
import { makeCustomerCartCreationCommands } from "../src/modules/customer/cart-creation-service";
import { prepareCustomerCartCreationRead } from "../src/modules/customer/cart-creation-read";
import { workflowModuleDefinition } from "../src/workflow/module";
import { populateCommerceRelations, type CommerceRelationOrder } from "../src/query/relations";

it("combines genuine Customer selection and group graph reads in one selected participant", async () => {
  const customer = await Effect.runPromise(makeCustomerCartCreationCommands()), definition = workflowModuleDefinition(customer.workflow);
  expect(definition?.source).toEqual({ name: "flarex-customer-cart-creation", profile: "customer.cart-creation" });
  expect(Object.keys(customer.workflow.methods).sort()).toEqual(["createCustomers", "deleteCustomers", "listCustomers", "retrieveCustomer"]);
  expect(customer.commands).toHaveLength(5);
  expect(definition?.graph.reads.map(read => ({ model: read.model, paths: read.paths.map(path => path.path) })))
    .toEqual([{ model: "Customer", paths: ["groups"] }]);
  expect(customer.prepared.relation.join).toEqual({ type: "manyToMany", pivotTable: "customer_group_customer",
    sourceColumns: ["customer_id"], targetColumns: ["customer_group_id"] });
});

it("honors an explicit pivot order while preserving the existing default", async () => {
  const metadata = await Effect.runPromise(captureCustomerMetadata()), prepared = Result.getOrThrow(prepareCustomerCartCreationRead(metadata.frame));
  const order: CommerceRelationOrder = { kind: "storageInsertion", direction: "asc" };
  for (const [ordering, expected] of [[new Map([[prepared.pivot.name, order]]), order], [new Map(), "customer_group_id"]] as const) {
    const actual: Array<CommerceRelationOrder | undefined> = [];
    await Effect.runPromise(populateCommerceRelations((_table, _predicate, order) => Effect.sync(() => { actual.push(order); return []; }),
      prepared.customer.name, [{ id: "cus-order" }], ["groups"], prepared.catalog.relations, ordering));
    expect(actual).toEqual([expected]);
  }
});

it("prepares only native Customer ID/scalar/group projections and retains metadata cardinality", async () => {
  const metadata = await Effect.runPromise(captureCustomerMetadata()), prepared = Result.getOrThrow(prepareCustomerCartCreationRead(metadata.frame));
  expect(prepared.query(buildQuery({ id: "cus-graph" }, { select: ["*", "groups.*"], relations: ["groups"], order: { id: "ASC" }, take: 4, skip: 0 })))
    .toMatchObject({ _tag: "Success" });
  expect(prepared.query(buildQuery({ id: "cus-graph" }, { relations: ["groups"] }))).toMatchObject({ _tag: "Success" });
  for (const config of [{ relations: ["addresses"] }, { relations: ["groups.customers"] }, { select: ["groups.fake"], relations: ["groups"] },
    { order: { id: "DESC" } }, { skip: 1 }]) {
    expect(prepared.query(buildQuery({ id: "cus-graph" }, config))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  }
});
