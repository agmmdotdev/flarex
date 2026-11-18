import { readFileSync } from "node:fs";
import { Effect, Result, Schema } from "effect";
import { describe, expect, inject, it } from "vitest";
import { CartCreationStore } from "@medusajs/cart/creation";
import { cartCreationModels } from "@medusajs/cart/creation-models";
import { CartModuleService } from "@medusajs/cart/services";
import { cartModuleExports, cartModuleModels, cartStaticResources } from "@medusajs/cart/static-manifest";
import { updateCartsStep, updateCartsStepId, type UpdateCartsStepInput } from "@medusajs/core-flows/cart/update-carts-step";
import { createCartsStep, createCartsStepId, type CreateCartsStepInput } from "@medusajs/core-flows/cart/create-carts-step";
import { setTaxLinesForItemsStep } from "@medusajs/core-flows/cart/set-tax-lines-for-items-step";
import { createLineItemAdjustmentsStep } from "@medusajs/core-flows/cart/create-line-item-adjustments-step";
import { prepareCheckoutOrderData } from "@medusajs/core-flows/cart/prepare-checkout-order-data";
import { createOrdersStep } from "@medusajs/core-flows/order/create-orders-step";
import { createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { cartModels } from "../src/modules/cart/schema";
import { compileCartCoreDefinition, compileCartCreationDefinition } from "../src/modules/cart/creation-schema";
import { nativeCartSourceTargets } from "./support/native-cart-source-provenance";
import { NativeSourceEvidenceSchema } from "./support/native-stock-sales-source-provenance";

const decodeEvidence = Schema.decodeUnknownSync(NativeSourceEvidenceSchema);
const decodePromotionFiles = Schema.decodeUnknownSync(Schema.Struct({
  files: Schema.Array(Schema.Struct({ target: Schema.String, classification: Schema.String, targetSha256: Schema.String })),
}));
const historyIndex = "IDX_cart_credit_line_reference_reference_id";

describe("Cart native Source execution provenance", () => {
  it.each(nativeCartSourceTargets)("loads the promoted $name implementation", target => {
    const evidence = decodeEvidence(inject("nativeCartSource"));
    expect(evidence.entries).toHaveLength(nativeCartSourceTargets.length);
    expect(evidence.entries.filter(entry => entry.name === target.name)).toMatchObject([{
      specifier: target.specifier, entry: target.entry, leaf: target.leaf, external: false,
    }]);
  });

  it("compiles the complete promoted Cart module model set", () => {
    expect(cartModuleExports.service).toBe(CartModuleService);
    expect(cartStaticResources.moduleService).toBe(CartModuleService);
    expect(cartStaticResources.models).toBe(cartModuleModels);
    expect(cartModuleModels).toHaveLength(9);
    expect(cartModels).toHaveLength(9);
    for (const model of cartModuleModels) expect(cartModels).toContain(model);
  });

  it("loads the authored creation model and ownership store through the promotion manifest", () => {
    const evidence = decodeEvidence(inject("nativeCartSource"));
    const manifest = new URL("../../../roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json", import.meta.url);
    const { files } = decodePromotionFiles(JSON.parse(readFileSync(manifest, "utf8")));
    for (const name of ["Cart creation models", "Cart creation ownership store"]) {
      const entry = evidence.entries.find(candidate => candidate.name === name);
      if (entry === undefined) throw new Error(`Missing executing Cart source evidence for ${name}`);
      expect(files.filter(file => file.target === entry.leaf)).toEqual([
        { target: entry.leaf, classification: "authored", targetSha256: entry.leafSha256 },
      ]);
    }
    expect(Object.values(cartCreationModels)).toHaveLength(12);
    expect(CartCreationStore.prototype.record).toBeTypeOf("function");
    expect(CartCreationStore.prototype.compensate).toBeTypeOf("function");
  });

  it("loads the native creation inverse and refresh steps", () => {
    const flow = createWorkflow("prove-promoted-cart-creation", (input: WorkflowData<CreateCartsStepInput>) =>
      new WorkflowResponse(createCartsStep(input)));
    expect(Result.getOrThrow(flow.prepare()).nodes).toMatchObject([{
      name: createCartsStepId, kind: "step", compensation: "transactionCovered",
      invoke: expect.any(Function), compensate: expect.any(Function),
    }]);
    expect(setTaxLinesForItemsStep).toBeTypeOf("function");
    expect(createLineItemAdjustmentsStep).toBeTypeOf("function");
  });

  it("loads the native completion inverse and exact-price checkout components", () => {
    const flow = createWorkflow("prove-promoted-cart-completion", (input: WorkflowData<UpdateCartsStepInput>) =>
      new WorkflowResponse(updateCartsStep(input)));
    expect(Result.getOrThrow(flow.prepare()).nodes).toMatchObject([{
      name: updateCartsStepId, kind: "step", compensation: "transactionCovered",
      invoke: expect.any(Function), compensate: expect.any(Function),
    }]);
    expect(prepareCheckoutOrderData).toBeTypeOf("function");
    expect(createOrdersStep).toBeTypeOf("function");
  });

  it("authenticates the full source and keeps CreditLine history separate from parent access", async () => {
    const target = { scopeUuid: "98f9ef45-9cc8-4a23-883f-0be3a3a2ad69", epochUuid: "bda6935a-b2a6-4c08-b934-1f51d5301da8" };
    const [native, compiled] = await Effect.runPromise(Effect.all([compileCartCoreDefinition(target), compileCartCreationDefinition()]));
    expect(native.identity).toMatchObject({ ...target, sourceKey: "medusa.cart" });
    expect(native.source).toMatchObject({ key: "medusa.cart", writeProfile: "medusa.cart", owner: "medusa",
      definition: { kind: "relational", schema: compiled.schema },
      evidence: { provenance: compiled.provenance, profile: "medusa.cart",
        authoredModels: ["packages/medusa-cart/src/creation/models.ts"] } });
    expect(native.applicationRead).toBe(false);
    expect(native.commands).toEqual([]);
    expect(native.source.bindings).toHaveLength(12);
    expect(native.tables.map(table => table.localName).toSorted())
      .toEqual(compiled.schema.tables.map(table => table.identity.tableId).toSorted());

    const operation = native.tables.find(table => table.localName === "cart_creation_operation");
    expect(operation).toBeDefined();
    for (const [claim, owner, field] of [
      ["cart_creation_cart", "cart", "cart_id"],
      ["cart_creation_address", "cart_address", "address_id"],
    ] as const) {
      const claimTable = native.tables.find(table => table.localName === claim);
      const ownerTable = native.tables.find(table => table.localName === owner);
      expect(claimTable?.foreignKeys).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceTable: claimTable?.name, sourceFields: [field],
          targetTable: ownerTable?.name, targetFields: ["id"], onDelete: "cascade" }),
        expect.objectContaining({ sourceTable: claimTable?.name, sourceFields: ["operation_id"],
          targetTable: operation?.name, targetFields: ["id"], onDelete: "noAction" }),
      ]));
    }

    const conditions = compiled.schema.tables.flatMap(table => table.indexes.flatMap(index => {
      const predicate = index.predicate;
      if (predicate?.kind !== "isNotNull" && predicate?.kind !== "isNullAndNotNull") return [];
      return [{ table: table.identity.tableId, id: index.identity.indexId,
        fields: index.columns.map(column => column.columnId), predicate }];
    }));
    expect(conditions).toHaveLength(14);
    const creditHistory = conditions.find(condition => condition.id === historyIndex);
    expect(creditHistory).toMatchObject({ table: "credit_line", fields: ["reference", "reference_id"],
      predicate: { kind: "isNotNull", column: { columnId: "deleted_at" } } });
    for (const condition of conditions) {
      const declaration = native.tables.find(table => table.localName === condition.table);
      const binding = declaration?.indexes?.find(index => index.nativeId === condition.id);
      const nonNull = (condition.predicate.kind === "isNotNull" ? condition.predicate.column : condition.predicate.notNullColumn).columnId;
      const prefix = condition.predicate.kind === "isNullAndNotNull" ? { field: condition.predicate.nullColumn.columnId, value: null } : undefined;
      const fields = condition.id === historyIndex ? ["reference", "reference_id", "deleted_at"]
        : prefix === undefined ? [nonNull] : [prefix.field, nonNull];
      expect(binding).toMatchObject({ kind: "index", requiredNonNull: nonNull, fields });
      expect(binding?.requiredPrefix).toEqual(prefix);
    }
    const credit = native.tables.find(table => table.localName === "credit_line");
    const cart = native.tables.find(table => table.localName === "cart");
    const parent = credit?.foreignKeys?.find(key => key.targetTable === cart?.name && key.sourceFields[0] === "cart_id");
    expect(parent).toBeDefined();
    const reverse = credit?.indexes?.find(index => index.indexName === parent?.sourceIndexName);
    expect(reverse?.fields[0]).toBe("cart_id");
    expect(reverse?.requiredNonNull).toBeUndefined();
    expect(reverse?.requiredPrefix).toBeUndefined();
  });
});
