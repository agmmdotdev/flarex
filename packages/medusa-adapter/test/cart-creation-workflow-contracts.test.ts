import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { cartCreationRuntimes } from "./support/cart-creation-runtimes";
import { cartCreationModuleNames, prepareCartCreationModules } from "../src/workflows/cart/creation-graph";
import { prepareCartCreationResources } from "../src/workflows/cart/create-cart";
import { captureInstalledWorkflowModules, type InstalledWorkflowModule } from "../src/workflow/host";
import { workflowModuleDefinition } from "../src/workflow/module";
import { prepareLocalGraph } from "../src/local-graph/query";
import { workflowResourceSelections } from "../src/workflow/resources";

it("authenticates the complete genuine eighteen-source Cart creation graph and original native resources", async () => {
  const runtime = await cartCreationRuntimes(), entries: Record<string, InstalledWorkflowModule> = {};
  // Pure preparation does not install storage or execute database operations.
  // Real source authority and all row reads are checked by the connected cases.
  for (const [name, module] of Object.entries(runtime.workflows)) Object.defineProperty(entries, name,
    { enumerable: true, value: { module, logicalStorage: {} } });
  const bindings = Result.getOrThrow(captureInstalledWorkflowModules(entries, cartCreationModuleNames));
  const selected = await Effect.runPromise(prepareCartCreationModules(bindings, runtime.salesChannelRead));
  const graph = Result.getOrThrow(prepareLocalGraph(Object.entries(selected.modules).map(([name, binding]) => {
    const definition = workflowModuleDefinition(binding.module);
    if (definition === undefined) throw new Error("Missing genuine Cart creation graph");
    return { participant: defineAtomicCommerceParticipant(name), module: definition.graph };
  })));
  expect(graph.entities).toContain("cart");
  expect(graph.entities).toContain("line_item");
  expect(graph.entities).toContain("shipping_method");
  const resources = Result.getOrThrow(prepareCartCreationResources(selected.modules, selected.inventory, runtime.link, runtime.logger));
  const selections = workflowResourceSelections(resources);
  expect(selections).toHaveLength(18);
  expect(selections?.filter(selection => selection.module.name === "cart")).toHaveLength(1);
  expect(selections?.filter(selection => selection.module.name === "inventory")).toHaveLength(1);
  const cart = workflowModuleDefinition(selected.modules.cart.module), cartRead = cart?.graph.reads.find(read => read.model === "Cart"),
    nestedItem = cartRead?.paths.find(path => path.path === "items"),
    directItem = cart?.graph.reads.find(read => read.model === "LineItem")?.table;
  expect(nestedItem?.presentation?.columns).toEqual(expect.arrayContaining(["subtotal", "raw_subtotal", "original_total", "raw_original_total"]));
  expect(nestedItem?.table.columns).not.toContain("subtotal");
  expect(cartRead?.table.columns).not.toContain("total");
  expect(cartRead?.presentation?.columns).toEqual(expect.arrayContaining(["total", "raw_total"]));
  expect(nestedItem?.presentation?.columns).not.toContain("raw_quantity");
  expect(directItem?.columns).not.toContain("subtotal");
  expect(directItem?.columns).toContain("raw_unit_price");
});
