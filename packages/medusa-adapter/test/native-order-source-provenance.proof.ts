import { describe, expect, inject, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { Order, OrderAddress, OrderChange, OrderChangeAction, OrderClaim, OrderExchange, OrderItem,
  OrderLineItem, OrderSummary, OrderTransaction, Return } from "@medusajs/order/models";
import { OrderModuleService, OrderService } from "@medusajs/order/services";
import { orderModuleExports, orderModuleModels, orderStaticResources } from "@medusajs/order/static-manifest";
import { updateOrderChangesWorkflow } from "@medusajs/core-flows/order/update-order-changes";
import { updateOrderChangesStep, updateOrderChangesStepId } from "@medusajs/core-flows/order/update-order-changes-step";
import { cancelOrderChangeWorkflow } from "@medusajs/core-flows/order/cancel-order-change";
import { cancelOrderChangeStep, cancelOrderChangeStepId } from "@medusajs/core-flows/order/cancel-order-change-step";
import { declineOrderChangeWorkflow } from "@medusajs/core-flows/order/decline-order-change";
import { declineOrderChangeStep, declineOrderChangeStepId } from "@medusajs/core-flows/order/decline-order-change-step";
import { deleteOrderChangeWorkflow } from "@medusajs/core-flows/order/delete-order-change";
import { deleteOrderChangesStep, deleteOrderChangesStepId } from "@medusajs/core-flows/order/delete-order-changes-step";
import { archiveOrderWorkflow } from "@medusajs/core-flows/order/archive-orders";
import { archiveOrdersStep, archiveOrdersStepId } from "@medusajs/core-flows/order/archive-orders-step";
import { completeOrderWorkflow } from "@medusajs/core-flows/order/complete-orders";
import { completeOrdersStep, completeOrdersStepId } from "@medusajs/core-flows/order/complete-orders-step";
import { createOrdersStep } from "@medusajs/core-flows/order/create-orders-step";
import { createWorkflow } from "@medusajs/workflows-sdk";
import { executeWorkflow } from "@medusajs/workflows-sdk/native";
import { compileOrderCoreDefinition, compileOrderDefinition } from "../src/modules/order/schema";
import { NativeSourceEvidenceSchema } from "./support/native-stock-sales-source-provenance";
import { nativeOrderSourceTargets } from "./support/native-order-source-provenance";

const decodeEvidence = Schema.decodeUnknownSync(NativeSourceEvidenceSchema);
const archive = Result.getOrThrow(archiveOrderWorkflow.prepare());
const completion = Result.getOrThrow(completeOrderWorkflow.prepare());
const loaded: Record<typeof nativeOrderSourceTargets[number]["name"], unknown> = {
  "Order module service": OrderModuleService,
  "Order service": OrderService,
  "Order static manifest": orderStaticResources,
  "Order model": Order,
  "Order Address model": OrderAddress,
  "Order Change model": OrderChange,
  "Order Change Action model": OrderChangeAction,
  "Order Claim model": OrderClaim,
  "Order Exchange model": OrderExchange,
  "Return model": Return,
  "Order Line Item model": OrderLineItem,
  "Order Item model": OrderItem,
  "Order Summary model": OrderSummary,
  "Order Transaction model": OrderTransaction,
  "Checkout Create Orders step": createOrdersStep,
  "DML schema compiler": compileDmlSchema,
  "Update Order Changes workflow": updateOrderChangesWorkflow,
  "Update Order Changes step": updateOrderChangesStep,
  "Cancel Order Change workflow": cancelOrderChangeWorkflow,
  "Cancel Order Change step": cancelOrderChangeStep,
  "Decline Order Change workflow": declineOrderChangeWorkflow,
  "Decline Order Change step": declineOrderChangeStep,
  "Delete Order Change workflow": deleteOrderChangeWorkflow,
  "Delete Order Changes step": deleteOrderChangesStep,
  "Archive Orders workflow": archiveOrderWorkflow,
  "Archive Orders step": archiveOrdersStep,
  "Archive event step": archive.nodes.find(node => node.name === "emit-event-step"),
  "Complete Orders workflow": completeOrderWorkflow,
  "Complete Orders step": completeOrdersStep,
  "Completion event step": completion.nodes.find(node => node.name === "emit-event-step"),
  "Native SDK definition": createWorkflow,
  "Native SDK execution": executeWorkflow,
};

describe("Order native Source execution provenance", () => {
  it.each(nativeOrderSourceTargets)("loads the promoted $name implementation", target => {
    const evidence = decodeEvidence(inject("nativeOrderSource"));
    expect(evidence.entries).toHaveLength(nativeOrderSourceTargets.length);
    expect(evidence.entries.filter(entry => entry.name === target.name)).toMatchObject([{
      specifier: target.specifier, entry: target.entry, leaf: target.leaf, external: false,
    }]);
    expect(loaded[target.name]).toBeDefined();
  });

  it("uses the promoted model, service and retained step definitions", () => {
    expect(orderModuleExports.service).toBe(OrderModuleService);
    expect(orderStaticResources.moduleService).toBe(OrderModuleService);
    expect(orderStaticResources.services).toContain(OrderService);
    expect(orderStaticResources.models).toBe(orderModuleModels);
    expect(orderModuleModels).toEqual(expect.arrayContaining([Order, OrderAddress, OrderChange, OrderChangeAction, OrderTransaction]));
    for (const [workflow, stepId] of [
      [updateOrderChangesWorkflow, updateOrderChangesStepId],
      [cancelOrderChangeWorkflow, cancelOrderChangeStepId],
      [declineOrderChangeWorkflow, declineOrderChangeStepId],
      [deleteOrderChangeWorkflow, deleteOrderChangesStepId],
    ] as const) {
      expect(Result.getOrThrow(workflow.prepare()).nodes).toMatchObject([{
        name: stepId, kind: "step", compensation: "transactionCovered", compensate: expect.any(Function),
      }]);
    }
  });

  it("keeps the status roots' event, compensation and hook order", () => {
    expect(archive.nodes).toMatchObject([
      { name: "emit-event-step", kind: "step" },
      { name: archiveOrdersStepId, kind: "step", compensation: "transactionCovered", compensate: expect.any(Function) },
    ]);
    expect(completion.nodes).toMatchObject([
      { name: completeOrdersStepId, kind: "step", compensation: "transactionCovered", compensate: expect.any(Function) },
      { name: "emit-event-step", kind: "step" },
      { name: "ordersCompleted", kind: "step", hook: true },
    ]);
  });

  it("lowers the complete preserve-mode Order source without command or Application grants", async () => {
    const target = { scopeUuid: "98f9ef45-9cc8-4a23-883f-0be3a3a2ad69", epochUuid: "bda6935a-b2a6-4c08-b934-1f51d5301da8" };
    const [native, compiled] = await Effect.runPromise(Effect.all([
      compileOrderCoreDefinition(target), compileOrderDefinition("preserve"),
    ]));
    expect(native.identity).toMatchObject({ ...target, sourceKey: "medusa.order" });
    expect(native.source).toMatchObject({ key: "medusa.order", writeProfile: "medusa.order", owner: "medusa",
      definition: { kind: "relational", schema: compiled.schema },
      evidence: { provenance: compiled.provenance, profile: "medusa.order" } });
    expect(native.applicationRead).toBe(false);
    expect(native.commands).toEqual([]);
    expect(native.source.bindings).toHaveLength(23);
    expect(native.tables.map(table => table.localName).toSorted())
      .toEqual(compiled.schema.tables.map(table => table.identity.tableId).toSorted());
    const sourceConditions = compiled.schema.tables.flatMap(table => table.indexes.flatMap(index => {
      const predicate = index.predicate;
      if (predicate?.kind !== "isNotNull" && predicate?.kind !== "isNullAndNotNull") return [];
      const nonNull = (predicate.kind === "isNotNull" ? predicate.column : predicate.notNullColumn).columnId;
      const prefix = predicate.kind === "isNullAndNotNull" ? { field: predicate.nullColumn.columnId, value: null } : undefined;
      return [{ table: table.identity.tableId, index: index.identity.indexId, nonNull, prefix }];
    }));
    expect(sourceConditions).toHaveLength(34);
    for (const condition of sourceConditions) {
      const declaration = native.tables.find(table => table.localName === condition.table);
      const index = declaration?.indexes?.find(index => index.nativeId === condition.index);
      expect(index).toMatchObject({ kind: "index", requiredNonNull: condition.nonNull,
        fields: condition.prefix === undefined ? [condition.nonNull] : [condition.prefix.field, condition.nonNull] });
      expect(index?.requiredPrefix).toEqual(condition.prefix);
    }
  });

  it("lowers exactly the five source serials with inclusive private backings", async () => {
    const target = { scopeUuid: "98f9ef45-9cc8-4a23-883f-0be3a3a2ad69", epochUuid: "bda6935a-b2a6-4c08-b934-1f51d5301da8" };
    const [generated, preserved] = await Effect.runPromise(Effect.all([
      compileOrderCoreDefinition(target, "generate"), compileOrderCoreDefinition(target),
    ]));
    const expected = [
      "order.display_id", "order_change_action.ordering", "order_claim.display_id",
      "order_exchange.display_id", "return.display_id",
    ];
    expect(orderModuleModels).toEqual(expect.arrayContaining([
      Order, OrderChangeAction, OrderClaim, OrderExchange, Return, OrderLineItem, OrderItem, OrderSummary,
    ]));
    const source = compileDmlSchema(orderModuleModels);
    expect(source.tables).toHaveLength(23);
    expect(source.tables.flatMap(table => table.columns.filter(column => column.type === "serial")
      .map(column => `${table.name}.${column.name}`)).toSorted()).toEqual(expected);
    const definition = generated.source.definition;
    if (definition.kind !== "relational") throw new Error("Missing Order relational source");
    const serials = definition.schema.tables.flatMap(table => table.columns.filter(column => column.default.kind === "serialNext")
      .map(column => ({ table: table.identity.tableId, field: column.identity.columnId })));
    expect(serials.map(({ table, field }) => `${table}.${field}`).toSorted()).toEqual(expected);
    expect(generated.tables).toEqual(preserved.tables);
    expect(generated.identity.sourceSha256).not.toBe(preserved.identity.sourceSha256);
    expect(generated.identity.definitionHash).not.toBe(preserved.identity.definitionHash);
    expect(generated.applicationRead).toBe(false);
    expect(generated.commands).toEqual([]);
    for (const { table, field } of serials) {
      const declaration = generated.tables.find(candidate => candidate.localName === table);
      const backing = generated.schema.tables.find(candidate => candidate.tableName === declaration?.name)
        ?.indexes.filter(index => index.indexDescriptor.startsWith("s_"));
      expect(backing).toMatchObject([{ indexDescriptor: expect.stringMatching(/^s_/u), fields: [field] }]);
    }
  });
});
