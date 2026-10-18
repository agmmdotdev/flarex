import { makeFulfillmentSetDeletionCommands } from "../src/modules/fulfillment/fulfillment-set-delete-service";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { commerceCommandIdentity } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareInventoryItemDeletionLinks, prepareInventoryItemDeletionLinkResource } from "../src/links/inventory-item-deletion";
import { prepareLocalVariantLinks } from "../src/links/variant-service";
import { prepareStockLocationDeletionLinks } from "../src/links/stock-location-deletion";
import { captureVariantInventoryLinkMetadata } from "../src/composition/product-variant-inventory-schema";
import { prepareLinkService } from "../src/links/service";
import { prepareLinkWorkflowService, linkWorkflowServiceDefinition } from "../src/links/workflow-service";
import { composedWorkflowResourceDefinition, type ComposedWorkflowServices, type InvokeWorkflowMethod } from "../src/workflow/composed-resource";
import { workflowMethodDefinition, workflowModuleDefinition, type WorkflowMethod } from "../src/workflow/module";

let links: Effect.Success<ReturnType<typeof prepareInventoryItemDeletionLinks>>;
type Service = ComposedWorkflowServices<{ readonly link: typeof links.resource }>["link"];
const endpoint = (ids: string[]) => ({ inventory: { inventory_item_id: [...ids] } });

/** Native router observations use authentic method contracts, without mocking
 * persistence, receipts, rollback-only state or outer settlement. */
function bind(respond: (name: string, args: readonly unknown[]) => Json | Promise<Json>) {
  const definition = composedWorkflowResourceDefinition(links.resource);
  if (definition === undefined) throw new Error("Missing Inventory Item deletion Link resource");
  const calls: Array<{ name: string; args: readonly unknown[] }> = [];
  const invoke: InvokeWorkflowMethod = async <Output>(method: WorkflowMethod<readonly unknown[], Output>, ...args: readonly unknown[]) => {
    const selected = workflowMethodDefinition(method);
    const identity = selected === undefined ? undefined : commerceCommandIdentity(selected.command);
    if (selected === undefined || identity === undefined) throw new Error("Missing native Link method");
    Result.getOrThrow(selected.input(args));
    calls.push({ name: identity.name, args: structuredClone(args) });
    // SAFETY: this observation port validates the issuer-associated method's
    // actual codecs, retaining the same output association as production.
    return Result.getOrThrow(selected.output(await respond(identity.name, args))) as Output;
  };
  // SAFETY: the authentic resource factory retains its associated service ABI.
  return { service: definition.bind(invoke) as Service, calls, definition };
}

describe("native Inventory Item deletion Link resource", () => {
  beforeAll(async () => { links = await Effect.runPromise(prepareInventoryItemDeletionLinks()); });

  it.each(["delete", "restore"] as const)("routes %s through only the genuine rich Inventory family", async operation => {
    const family = links.nativeServices.inventory;
    const map = { variant_id: ["shared", "shared"], inventory_item_id: ["i1", "i2"] };
    const { service, calls, definition } = bind(() => map);
    const input = endpoint(["i2", "missing", "i1", "i2"]);
    const result = await service[operation](input);
    expect(result).toEqual([null, { [family.routing.__joinerConfig.serviceName!]: map }]);
    expect(calls).toEqual([{ name: operation === "delete" ? family.softDeleteName : family.restoreName,
      args: [{ inventory_item_id: ["i2", "missing", "i1", "i2"] }, { returnLinkableKeys: family.routing.__joinerConfig.primaryKeys }] }]);
    expect(definition.dependencies).toEqual([family.softDeleteMethod, family.restoreMethod]);
    expect(Object.keys(definition.methods)).toEqual(["delete", "restore"]);
    expect(input).toEqual(endpoint(["i2", "missing", "i1", "i2"]));
    expect(Result.isSuccess(definition.methods[operation]!.output(result))).toBe(true);
    expect(family.routing.__joinerConfig.relationships?.every(relationship => relationship.deleteCascade !== true)).toBe(true);
  });

  it.each(["delete", "restore"] as const)("retains grouped empty %s without stored family calls", async operation => {
    const { service, calls, definition } = bind(() => { throw new Error("Unexpected empty family callback"); });
    const result = await service[operation](endpoint([]));
    expect(result).toEqual([null, {}]);
    expect(calls).toEqual([]);
    expect(Result.isSuccess(definition.methods[operation]!.output(result))).toBe(true);
  });

  it.each(["delete", "restore"] as const)("preserves authentic errors-as-data and refuses them at the atomic %s boundary", async operation => {
    const { service, calls, definition } = bind(async () => { throw new Error("native rich Link failure"); });
    const result = await service[operation](endpoint(["item"]));
    expect(result[0]).toMatchObject([{ serviceName: links.nativeServices.inventory.routing.__joinerConfig.serviceName,
      method: operation === "delete" ? "softDelete" : "restore", args: { inventory_item_id: ["item"] },
      error: { message: "native rich Link failure" } }]);
    expect(result[1]).toEqual({}); expect(calls).toHaveLength(1);
    expect(definition.methods[operation]!.output(result)).toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure", cause: result } });
  });

  it("uses a distinct single-family admission without loading Pricing", () => {
    const workflow = links.inventory.workflow, definition = workflowModuleDefinition(workflow);
    expect(workflow.name).toBe("product_variant_inventory_item_deletion_links");
    expect(definition?.source).toEqual({ name: links.nativeServices.inventory.routing.__joinerConfig.serviceName, profile: "inventory-item-deletions" });
    expect(definition?.graph).toEqual({ aliases: [], reads: [] });
    expect(Object.keys(workflow.methods)).toEqual(["create", "list", "softDelete", "restore"]);
    expect(links.inventory.commands).toHaveLength(4);
    expect(Object.keys(links.nativeServices)).toEqual(["inventory"]);
  });

  it("refuses forged tokens, the Product deletion admission and another genuine family", async () => {
    expect(prepareInventoryItemDeletionLinkResource({ inventory: { ...links.nativeServices.inventory } }))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    const previous = await Effect.runPromise(prepareLocalVariantLinks("product-deletions"));
    const location = await Effect.runPromise(prepareStockLocationDeletionLinks((await Effect.runPromise(makeFulfillmentSetDeletionCommands())).workflow,
      (await Effect.runPromise(makeLocalPricingCommands("shipping-options"))).workflow));
    for (const inventory of [previous.nativeServices.inventory, previous.nativeServices.pricing, location.nativeServices.location])
      expect(prepareInventoryItemDeletionLinkResource({ inventory }))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(previous.nativeServices.inventory.restoreMethod).toBeUndefined();
  });

  it("refuses genuine unbounded and active-only DAL owners for the named Item deletion admission", async () => {
    const metadata = await Effect.runPromise(captureVariantInventoryLinkMetadata());
    const unbounded = await Effect.runPromise(prepareLinkService(metadata));
    const activeOnly = await Effect.runPromise(prepareLinkService(metadata, 8));
    for (const prepared of [unbounded, activeOnly]) {
      expect(Object.isFrozen(prepared)).toBe(true);
      expect(Object.isFrozen(prepared.lifecycle)).toBe(true);
      expect(Reflect.set(prepared.lifecycle, "completeHistory", true)).toBe(false);
      expect(Reflect.set(prepared, "lifecycle", Object.freeze({ maximumRows: 8, completeHistory: true }))).toBe(false);
      expect(prepareLinkWorkflowService(prepared, "looseItemDeletion", "inventory-item-deletions"))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
      const substituted = { ...prepared, lifecycle: Object.freeze({ maximumRows: 8 as const, completeHistory: true }) };
      expect(prepareLinkWorkflowService(substituted, "spoofedItemDeletion", "inventory-item-deletions"))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    }
    expect(unbounded.lifecycle).toEqual({ maximumRows: null, completeHistory: false });
    expect(activeOnly.lifecycle).toEqual({ maximumRows: 8, completeHistory: false });
    // Older native admissions retain their existing active-row bound.
    expect(Result.isSuccess(prepareLinkWorkflowService(activeOnly, "priorProductDeletion", "inventory-deletions"))).toBe(true);
  });

  it("snapshots the immutable complete-history owner into the issued definition and resource", async () => {
    const prepared = await Effect.runPromise(prepareLinkService(await Effect.runPromise(captureVariantInventoryLinkMetadata()), 8, true));
    const loose = await Effect.runPromise(prepareLinkService(await Effect.runPromise(captureVariantInventoryLinkMetadata())));
    const originalBind = prepared.prepared.bind;
    expect(Object.isFrozen(prepared.prepared)).toBe(true);
    expect(Reflect.set(prepared.prepared, "bind", loose.prepared.bind)).toBe(false);
    expect(prepared.prepared.bind).toBe(originalBind);
    const native = Result.getOrThrow(prepareLinkWorkflowService(prepared, "strictItemDeletion", "inventory-item-deletions"));
    const issued = linkWorkflowServiceDefinition(native);
    if (issued === undefined) throw new Error("Missing issued Item Link definition");
    expect(issued.lifecycle).toEqual({ maximumRows: 8, completeHistory: true });
    expect(issued.lifecycle).not.toBe(prepared.lifecycle);
    expect(Object.isFrozen(issued.lifecycle)).toBe(true);
    const resource = Result.getOrThrow(prepareInventoryItemDeletionLinkResource({ inventory: native }));
    const definition = composedWorkflowResourceDefinition(resource);
    if (definition === undefined) throw new Error("Missing strict Item Link resource");
    const identity = structuredClone(definition.identity);
    expect(identity).toMatchObject({ lifecycle: { maximumRows: 8, completeHistory: true } });
    expect(Reflect.set(prepared.lifecycle, "completeHistory", false)).toBe(false);
    expect(Reflect.set(prepared, "lifecycle", Object.freeze({ maximumRows: null, completeHistory: false }))).toBe(false);
    expect(Reflect.set(issued.lifecycle, "maximumRows", null)).toBe(false);
    // Changing a detached inspection result cannot replace the issuer's copy.
    expect(Reflect.set(issued, "lifecycle", Object.freeze({ maximumRows: null, completeHistory: false }))).toBe(true);
    expect(linkWorkflowServiceDefinition(native)?.lifecycle).toEqual({ maximumRows: 8, completeHistory: true });
    expect(Result.isSuccess(prepareInventoryItemDeletionLinkResource({ inventory: native }))).toBe(true);
    expect(definition.identity).toEqual(identity);
  });

  it("refuses structural replacements of the genuine prepared Link owner", async () => {
    const prepared = await Effect.runPromise(prepareLinkService(await Effect.runPromise(captureVariantInventoryLinkMetadata()), 8, true));
    for (const modify of [
      (routing: typeof prepared.routing) => { if (routing.__joinerConfig.relationships?.[0]) routing.__joinerConfig.relationships[0].deleteCascade = true; },
      (routing: typeof prepared.routing) => { routing.__joinerConfig.extraDataFields = []; },
      (routing: typeof prepared.routing) => { routing.__joinerConfig.primaryKeys = ["id", "inventory_item_id", "variant_id"]; },
    ]) {
      const routing = structuredClone(prepared.routing); modify(routing);
      expect(prepareLinkWorkflowService({ ...prepared, routing }, "wrongIdentity", "inventory-item-deletions"))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    }
  });

  it("keeps four raw endpoints while admitting eight complete result rows", () => {
    const { definition } = bind(() => ({}));
    const family = links.nativeServices.inventory;
    const config = { returnLinkableKeys: family.routing.__joinerConfig.primaryKeys };
    for (const operation of ["delete", "restore"] as const) {
      const method = definition.methods[operation]!;
      expect(Result.isSuccess(method.arguments([endpoint(["i", "i", "missing", "j"])]))).toBe(true);
      for (const value of [endpoint(["1", "2", "3", "4", "5"]), endpoint([""]), {},
        { inventory: {} }, { inventory: { inventory_item_id: "i" } },
        { inventory: { inventory_item_id: ["i"], id: ["i"] } },
        { inventory: { inventory_item_id: ["i"] }, product: { variant_id: ["v"] } }])
        expect(Result.isFailure(method.arguments([value]))).toBe(true);
      const native = workflowMethodDefinition(operation === "delete" ? family.softDeleteMethod! : family.restoreMethod!);
      expect(Result.isSuccess(native!.input([{ inventory_item_id: ["1", "2", "3", "4"] }, config]))).toBe(true);
      expect(Result.isFailure(native!.input([{ inventory_item_id: ["1", "2", "3", "4", "5"] }, config]))).toBe(true);
      const map = { variant_id: Array.from({ length: 8 }, (_, index) => "v" + index), inventory_item_id: Array.from({ length: 8 }, () => "i") };
      expect(Result.isSuccess(method.output([null, { [family.routing.__joinerConfig.serviceName!]: map }]))).toBe(true);
      expect(Result.isFailure(method.output([null, { [family.routing.__joinerConfig.serviceName!]: {
        ...map, variant_id: [...map.variant_id, "overflow"], inventory_item_id: [...map.inventory_item_id, "overflow"],
      } }]))).toBe(true);
    }
  });

  it("authenticates the full native tuple, family identity, paired keys and method", () => {
    const { definition } = bind(() => ({})), family = links.nativeServices.inventory.routing.__joinerConfig.serviceName!;
    const malformed: Json[] = [[null, {}, "discarded"], [null], [[], {}], [null, { foreign: {} }],
      [null, { [family]: { variant_id: ["v"] } }], [null, { [family]: { variant_id: ["v"], inventory_item_id: [] } }],
      [null, { [family]: { variant_id: ["v"], inventory_item_id: ["i"], required_quantity: ["1"] } }],
      [[{ serviceName: family, method: "restore", args: { inventory_item_id: ["i"] }, error: {} }], {}],
      [[{ serviceName: "foreign", method: "softDelete", args: { inventory_item_id: ["i"] }, error: {} }], {}],
      [[{ serviceName: family, method: "softDelete", args: { variant_id: ["v"] }, error: {} }], {}]];
    for (const value of malformed) expect(Result.isFailure(definition.methods.delete!.output(value))).toBe(true);
    expect(Result.isSuccess(definition.methods.delete!.output([null, { [family]: {} }]))).toBe(true);
  });
});
