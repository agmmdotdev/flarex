import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils/portable";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { StepResponse, type PreparedWorkflow, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { Link } from "@medusajs/modules-sdk/link";
import { getModuleService, ProductVariantInventoryItem } from "@medusajs/link-modules";
import { updateLinksWorkflow } from "@medusajs/core-flows/common/update-links";
import { batchLinksWorkflow } from "@medusajs/core-flows/common/batch-links";
import { createProductVariantInventoryLinksWorkflow, updateProductVariantInventoryLinksWorkflow,
  dismissProductVariantInventoryLinksWorkflow, batchProductVariantInventoryLinksWorkflow } from "@medusajs/core-flows/product/product-variant-inventory-links";

const link = { product: { variant_id: "variant-selected" }, inventory: { inventory_item_id: "inventory-selected" }, data: { required_quantity: 3 } };
function context(bindings: Readonly<Record<string, unknown>>): StepExecutionContext {
  return { eventGroupId: "native-product-inventory-witness", container: { resolve<Value>(name: string): Value {
    if (!Object.hasOwn(bindings, name)) throw new Error("Unexpected native resource " + name);
    // SAFETY: the test container implements the native SDK's generic resolution
    // signature; each selected callback's actual calls are asserted below.
    return bindings[name] as Value;
  } } };
}
function execute(prepared: PreparedWorkflow, input: unknown, bindings: Readonly<Record<string, unknown>>) {
  const port: WorkflowExecutionPort<unknown> = { checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }),
    context: context(bindings) };
  return Effect.runPromise(executeWorkflow(prepared, input, port));
}

describe("native Product-scoped Inventory Link composition", () => {
  it.each([
    ["create", createProductVariantInventoryLinksWorkflow],
    ["update", updateProductVariantInventoryLinksWorkflow],
    ["dismiss", dismissProductVariantInventoryLinksWorkflow],
    ["batch", batchProductVariantInventoryLinksWorkflow],
  ] as const)("finishes Product ownership before %s can resolve a Link arm", async (name, workflow) => {
    const prepared = Result.getOrThrow(workflow.prepare()), calls: unknown[] = [];
    const input = name === "batch" ? { product_id: "product-route", create: [link], update: [link], delete: [link] }
      : { product_id: "product-route", links: [link] };
    await expect(execute(prepared, input, { [Modules.PRODUCT]: {
      async listProductVariants(...args: unknown[]) {
        calls.push(args); return [{ id: "variant-selected", product_id: "product-other" }];
      },
    } })).rejects.toThrow("Could not find all Product Variants");
    expect(calls).toEqual([[{ id: ["variant-selected"], product_id: "product-route" }, { select: ["id", "product_id"], relations: [] }]]);
  });

  it("retains the real batch's three parallel arms for empty input", async () => {
    const prepared = Result.getOrThrow(batchLinksWorkflow.prepare());
    expect(prepared.nodes.filter(node => node.kind === "step").map(node => node.name)).toEqual([
      "create-remote-links", "update-remote-links-step", "dismiss-remote-links",
    ]);
    expect(prepared.parallel?.map(group => group.branches.length)).toEqual([3]);
    expect(await execute(Result.getOrThrow(batchProductVariantInventoryLinksWorkflow.prepare()), {
      product_id: "product-route", create: [], update: [], delete: [],
    }, {
      [ContainerRegistrationKeys.LINK]: {},
    })).toEqual({ created: [], updated: [], deleted: [] });
  });

  it("preserves the generic omitted-arm prerequisite witness outside HTTP's complete-array contract", async () => {
    // Pinned generic composition uses `input.create || []`. Finite SDK proxies
    // are truthy during declaration, so omitted arms reach the native step as
    // undefined. The native HTTP helper always materializes all three arrays.
    await expect(execute(Result.getOrThrow(batchLinksWorkflow.prepare()), {}, {
      [ContainerRegistrationKeys.LINK]: {},
    })).rejects.toThrow("Cannot read properties of undefined");
  });

  it("keeps update's exact existence count and genuine native endpoint/quantity preimage", async () => {
    const prepared = Result.getOrThrow(updateLinksWorkflow.prepare());
    const node = prepared.nodes.find(node => node.name === "update-remote-links-step");
    if (node?.kind !== "step" || node.compensate === undefined) throw new Error("Missing native update step/compensator");
    const before = [{ ...link, data: { required_quantity: -7 } }], writes: unknown[] = [], reads: unknown[] = [];
    const Service = getModuleService(ProductVariantInventoryItem);
    const joiner = Service.prototype.__joinerConfig();
    if (joiner.serviceName === undefined) throw new Error("Missing native Inventory Link service name");
    const loaded = {
      __joinerConfig: joiner,
      __definition: { key: joiner.serviceName, defaultPackage: "@medusajs/link-modules", label: "Inventory Link witness",
        isQueryable: true, defaultModuleDeclaration: { scope: "internal" as const } },
      async list(...args: unknown[]) {
        reads.push(args);
        return [{ id: "link-original-row-id", variant_id: "variant-selected", inventory_item_id: "inventory-selected", required_quantity: -7 }];
      },
      async create(input: unknown) { writes.push(structuredClone(input)); return []; },
    };
    // Native Link.list produces the preimage through its real converter. Its
    // generated extraDataFields contain required_quantity, never scalar id.
    const nativeContext = context({ [ContainerRegistrationKeys.LINK]: new Link([loaded]) });
    const response = await node.invoke([link], nativeContext);
    if (!(response instanceof StepResponse)) throw new Error("Missing native StepResponse");
    expect(response.output).toEqual([link]);
    expect(response.compensateInput).toEqual(before);
    expect(reads).toEqual([[{ $or: [{ variant_id: "variant-selected", inventory_item_id: "inventory-selected" }] }, {}, {}]]);
    await node.compensate(response.compensateInput, nativeContext);
    expect(writes).toEqual([
      [["variant-selected", "inventory-selected", { required_quantity: 3 }]],
      [["variant-selected", "inventory-selected", { required_quantity: -7 }]],
    ]);
    await expect(node.compensate(response.compensateInput, context({ [ContainerRegistrationKeys.LINK]: {
      async create() { throw new Error("Native inverse refused"); },
    } }))).rejects.toThrow("Native inverse refused");

    const missingContext = context({ [ContainerRegistrationKeys.LINK]: {
      async list() { return []; }, async create() { throw new Error("Update must not run"); },
    } });
    await expect(node.invoke([link], missingContext)).rejects.toThrow("Could not find all existing links from data");
  });
});
