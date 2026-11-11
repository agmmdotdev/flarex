import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils/portable";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { batchProductVariantsWorkflow } from "@medusajs/core-flows/product/batch-product-variants";
import { batchProductsWorkflow } from "@medusajs/core-flows/product/batch-products";
import type { PreparedWorkflow } from "@medusajs/workflows-sdk";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { validateProductVariantParentRead } from "../src/modules/product/variant-parent-read-receipt";
import { ProductModuleService } from "@medusajs/product/services";

function execute(prepared: PreparedWorkflow, input: unknown, bindings: Readonly<Record<string, unknown>>) {
  const port: WorkflowExecutionPort<unknown> = { checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }),
    context: { eventGroupId: "native-product-batch-parent", container: { resolve<Value>(name: string): Value {
      if (!Object.hasOwn(bindings, name)) throw new Error("Unexpected native batch resource " + name);
      // SAFETY: this test implements the native generic container signature;
      // each selected real callback's calls are asserted below.
      return bindings[name] as Value;
    } } } };
  return Effect.runPromise(executeWorkflow(prepared, input, port));
}
function resources() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const old = { id: "variant-existing", product_id: "product-route", title: "Before", manage_inventory: false };
  const bindings = {
    [Modules.PRODUCT]: {
      async listProductVariants(...args: unknown[]) { calls.push({ method: "list", args }); return [old]; },
      async createProductVariants(...args: unknown[]) { calls.push({ method: "create", args }); return []; },
      async upsertProductVariants(...args: unknown[]) { calls.push({ method: "update", args }); return [{ ...old, title: "Updated" }]; },
      async softDeleteProductVariants(...args: unknown[]) { calls.push({ method: "delete", args }); },
    },
    [Modules.INVENTORY]: { async createInventoryItems() { return []; }, async createInventoryLevels() { return []; }, async softDeleteInventoryItems() {} },
    [Modules.PRICING]: { async createPriceSets() { return []; } },
    [ContainerRegistrationKeys.LINK]: { async create() { return []; }, async delete() { return [null, {}]; } },
    [ContainerRegistrationKeys.QUERY]: { maxPageSize: 256, async graph(...args: unknown[]) {
      calls.push({ method: "graph", args }); return { data: [], metadata: { count: 0, skip: 0, take: 256 } };
    } },
    [Modules.EVENT_BUS]: { async emit() {} },
  };
  return { calls, bindings };
}

describe("native Product-qualified Variant batch", () => {
  it.each(["update", "delete"] as const)("checks foreign %s targets before any child can resolve a resource", async arm => {
    const reads: unknown[] = [];
    await expect(execute(Result.getOrThrow(batchProductVariantsWorkflow.prepare()), {
      product_id: "product-route", create: [{ title: "Never inserted", product_id: "product-route" }],
      [arm]: arm === "update" ? [{ id: "variant-foreign", title: "Never updated", product_id: "product-route" }] : ["variant-foreign"],
    }, { [Modules.PRODUCT]: { async listProductVariants(...args: unknown[]) {
      reads.push(args); return [{ id: "variant-foreign", product_id: "product-other" }];
    } } })).rejects.toThrow("Could not find all Product Variants for Product product-route");
    expect(reads).toEqual([[{ id: ["variant-foreign"] }, { select: ["id", "product_id"], relations: [] }]]);
  });

  it("retains missing requested deletion IDs while qualifying the native deletion child", async () => {
    const { calls, bindings } = resources();
    bindings[Modules.PRODUCT].listProductVariants = async (...args: unknown[]) => { calls.push({ method: "list", args }); return []; };
    expect(await execute(Result.getOrThrow(batchProductVariantsWorkflow.prepare()), {
      product_id: "product-route", delete: ["variant-missing", "variant-missing"],
    }, bindings)).toEqual({ created: [], updated: [], deleted: ["variant-missing", "variant-missing"] });
    expect(calls.find(call => call.method === "list")?.args).toEqual([{ id: ["variant-missing"] }, { select: ["id", "product_id"], relations: [] }]);
    expect(calls.find(call => call.method === "delete")?.args).toEqual([{ id: [], product_id: "product-route" }]);
    expect(calls.find(call => call.method === "create")?.args).toEqual([[]]);
    expect(calls.filter(call => call.method === "graph").some(call => JSON.stringify(call.args).includes('"product_id":"product-route"'))).toBe(true);
  });

  it("retains the authoritative scoped parent through the genuine update child and final mutator", async () => {
    const { calls, bindings } = resources();
    const input = { product_id: "product-route", update: [{ id: "variant-existing", title: "Updated", product_id: "product-route" }] };
    await execute(Result.getOrThrow(batchProductVariantsWorkflow.prepare()), input, bindings);
    const update = calls.find(call => call.method === "update");
    expect(update?.args).toEqual([[{ id: "variant-existing", title: "Updated", product_id: "product-route", prices: undefined }]]);
    expect(calls[0]).toEqual({ method: "list", args: [{ id: ["variant-existing"] }, { select: ["id", "product_id"], relations: [] }] });
    expect(input.update[0]?.product_id).toBe("product-route");
  });

  it("keeps unscoped requested deletion IDs and skips the scoped parent query", async () => {
    const { calls, bindings } = resources();
    expect(await execute(Result.getOrThrow(batchProductVariantsWorkflow.prepare()), { delete: ["variant-missing"] }, bindings))
      .toEqual({ created: [], updated: [], deleted: ["variant-missing"] });
    expect(calls.filter(call => call.method === "list")).toEqual([]);
    expect(calls.find(call => call.method === "delete")?.args).toEqual([["variant-missing"]]);
    expect(calls.find(call => call.method === "create")?.args).toEqual([[]]);
  });

  it("injects the authoritative Product into the genuine create child without mutating its caller", async () => {
    const { calls, bindings } = resources();
    bindings[Modules.PRODUCT].createProductVariants = async (...args: unknown[]) => {
      calls.push({ method: "create", args }); throw new Error("Captured native create");
    };
    const input = { product_id: "product-route", create: [{ title: "New", product_id: "product-body", options: {}, manage_inventory: false }] };
    await expect(execute(Result.getOrThrow(batchProductVariantsWorkflow.prepare()), input, bindings)).rejects.toThrow("Captured native create");
    expect(calls.find(call => call.method === "create")?.args).toEqual([[{
      title: "New", product_id: "product-route", options: {}, manage_inventory: false, prices: undefined,
    }]]);
    expect(input.create[0]?.product_id).toBe("product-body");
    expect(calls.filter(call => call.method === "list")).toEqual([]);
  });

  it("retains Product batch's native empty-child skipping", async () => {
    expect(await execute(Result.getOrThrow(batchProductsWorkflow.prepare()), {}, {})).toEqual({ created: [], updated: [], deleted: [] });
  });

  it("keeps native update's active-row missing refusal before any tombstone upsert can run", async () => {
    const reads: unknown[] = [], writes: unknown[] = [];
    const update: unknown = Reflect.get(ProductModuleService.prototype, "updateVariants_");
    if (typeof update !== "function") throw new Error("Missing genuine native Variant update owner");
    const transactionManager = {};
    const receiver = { productVariantService_: {
      async list(...args: unknown[]) { reads.push(args); return []; },
      async upsertWithReplace(...args: unknown[]) { writes.push(args); throw new Error("Tombstone must not reach write"); },
    } };
    // The selected DAL's active-row filter hides a tombstone. Invoke the real
    // native mutator with that exact empty result; no replacement algorithm is
    // reproduced here and the transaction is the already borrowed owner.
    await expect(Reflect.apply(update, receiver, [[{ id: "variant-foreign-deleted", title: "Never revived", product_id: "product-route" }],
      { transactionManager }])).rejects.toThrow("Cannot update non-existing variants with ids: variant-foreign-deleted");
    expect(reads).toEqual([
      [{ id: ["variant-foreign-deleted"] }, {}, { transactionManager }],
      [{ product_id: [] }, { relations: ["options"] }, { transactionManager }],
    ]);
    expect(writes).toEqual([]);
  });
});

describe("exact Product Variant parent projection receipt", () => {
  type Receipt = Parameters<LogicalCallReceiptValidation>[0];
  type Activity = Parameters<LogicalCallReceiptValidation>[1];
  const call: Receipt = { commandName: "productVariantlist", mode: "read", input: {
    filters: { id: ["variant-existing"] }, config: { select: ["id", "product_id"], relations: [] },
  }, result: [{ id: "variant-existing", product_id: "product-route" }], events: [], fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 };
  const activity: Activity = { mutations: [], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [], observedRows: [
    { table: "product_variant", row: { id: "variant-existing", product_id: "product-route", deleted_at: null } },
  ] };
  it("binds unscoped ID projection to authentic observed parent rows", async () => {
    await Effect.runPromise(validateProductVariantParentRead("product_variant", call, activity));
  });
  it.each([
    { id: "variant-existing", product_id: "product-other" },
    { id: "variant-unobserved", product_id: "product-route" },
    { id: "variant-existing" },
  ])("refuses forged or incomplete parent projection $product_id", async row => {
    expect(await Effect.runPromise(Effect.result(validateProductVariantParentRead("product_variant", { ...call, result: [row] }, activity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });
});
