import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { commerceCommandIdentity } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareSalesChannelDeletionLinks, prepareSalesChannelDeletionLinkResource } from "../src/links/sales-channel-deletion";
import { prepareLocalProductLinks } from "../src/links/product-service";
import { composedWorkflowResourceDefinition, type ComposedWorkflowServices, type InvokeWorkflowMethod } from "../src/workflow/composed-resource";
import { workflowMethodDefinition, workflowModuleDefinition, type WorkflowMethod } from "../src/workflow/module";

let links: Effect.Success<ReturnType<typeof prepareSalesChannelDeletionLinks>>;
type Service = ComposedWorkflowServices<{ readonly link: typeof links.resource }>["link"];

/** Observe native routing over authenticated method contracts. Connected tests
 * separately prove storage, participant scheduling and atomic settlement. */
function bind(respond: (name: string, args: readonly unknown[]) => Json | Promise<Json>) {
  const definition = composedWorkflowResourceDefinition(links.resource);
  if (definition === undefined) throw new Error("Missing Sales Channel deletion Link resource");
  const calls: Array<{ name: string; args: readonly unknown[] }> = [];
  const invoke: InvokeWorkflowMethod = async <Output>(method: WorkflowMethod<readonly unknown[], Output>, ...args: readonly unknown[]) => {
    const selected = workflowMethodDefinition(method);
    const identity = selected === undefined ? undefined : commerceCommandIdentity(selected.command);
    if (selected === undefined || identity === undefined) throw new Error("Missing native Link method");
    Result.getOrThrow(selected.input(args));
    calls.push({ name: identity.name, args: structuredClone(args) });
    // SAFETY: this observation port checks the authentic method contracts,
    // preserving the issuer-associated output type as the production binder does.
    return Result.getOrThrow(selected.output(await respond(identity.name, args))) as Output;
  };
  // SAFETY: the authentic factory is associated with these exact service codecs.
  return { service: definition.bind(invoke) as Service, calls, definition };
}

describe("native Sales Channel deletion Link resource", () => {
  beforeAll(async () => { links = await Effect.runPromise(prepareSalesChannelDeletionLinks()); });

  it.each(["delete", "restore"] as const)("routes %s to exactly two native families without deleting endpoints", async operation => {
    const { sales, location } = links.nativeServices;
    const { service, calls, definition } = bind(name => name.startsWith("salesChannelProductLink")
      ? { product_id: ["p1", "p2"], sales_channel_id: ["sc", "sc"] }
      : { sales_channel_id: ["sc"], stock_location_id: ["loc"] });
    const input = { sales_channel: { sales_channel_id: ["sc", "missing", "sc"] } };
    expect(await service[operation](input)).toEqual([null, {
      [sales.routing.__joinerConfig.serviceName!]: { product_id: ["p1", "p2"], sales_channel_id: ["sc", "sc"] },
      [location.routing.__joinerConfig.serviceName!]: { sales_channel_id: ["sc"], stock_location_id: ["loc"] },
    }]);
    expect(calls).toHaveLength(2);
    for (const family of [sales, location]) expect(calls).toContainEqual({
      name: operation === "delete" ? family.softDeleteName : family.restoreName,
      args: [{ sales_channel_id: ["sc", "missing", "sc"] }, { returnLinkableKeys: family.routing.__joinerConfig.primaryKeys }],
    });
    expect(Object.keys(definition.methods)).toEqual(["delete", "restore"]);
    expect(definition.dependencies).toEqual([sales.softDeleteMethod, sales.restoreMethod, location.softDeleteMethod, location.restoreMethod]);
    expect(input).toEqual({ sales_channel: { sales_channel_id: ["sc", "missing", "sc"] } });
  });

  it("retains both real native grouped-empty paths without family calls", async () => {
    const { service, calls } = bind(() => { throw new Error("Unexpected empty family callback"); });
    expect(await service.delete({ sales_channel: { sales_channel_id: [] } })).toEqual([null, {}]);
    expect(await service.restore({ sales_channel: { sales_channel_id: [] } })).toEqual([null, {}]);
    expect(calls).toEqual([]);
  });

  it("retains native parallel dispatch and full errors-as-data tuples", async () => {
    let release!: () => void, locationEntered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { locationEntered = resolve; });
    const { service, calls, definition } = bind(async name => {
      if (name.startsWith("salesChannelProductLink")) { await blocked; throw new Error("native Link failure"); }
      locationEntered(); return {};
    });
    const pending = service.delete({ sales_channel: { sales_channel_id: ["sc"] } });
    await entered;
    expect(calls).toHaveLength(2); release();
    const result = await pending;
    expect(result[0]).toMatchObject([{ serviceName: links.nativeServices.sales.routing.__joinerConfig.serviceName,
      method: "softDelete", args: { sales_channel_id: ["sc"] }, error: { message: "native Link failure" } }]);
    expect(Result.isSuccess(definition.methods.delete!.output(result))).toBe(true);
  });

  it("keeps genuine families in distinct source modules and binds lifecycle-only resource dependencies", () => {
    expect(links.sales.workflow.name).toBe("product_sales_channel_deletion_links");
    expect(links.location.workflow.name).toBe("sales_channel_location_deletion_links");
    for (const family of [links.sales, links.location]) {
      const definition = workflowModuleDefinition(family.workflow);
      expect(definition?.source.profile).toBe("sales-channel-deletions");
      expect(definition?.graph).toEqual({ aliases: [], reads: [] });
      expect(Object.keys(family.workflow.methods)).toEqual(["create", "list", "softDelete", "restore"]);
    }
    expect(workflowModuleDefinition(links.sales.workflow)?.source.name).toBe("flarex-product-links");
    expect(workflowModuleDefinition(links.location.workflow)?.source.name).toBe(links.nativeServices.location.routing.__joinerConfig.serviceName);
  });

  it("rejects forged families and existing Product admissions", async () => {
    const { sales, location } = links.nativeServices;
    expect(prepareSalesChannelDeletionLinkResource({ sales: { ...sales }, location })).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    expect(prepareSalesChannelDeletionLinkResource({ sales: location, location: sales })).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    const product = await Effect.runPromise(prepareLocalProductLinks("product-deletions"));
    expect(prepareSalesChannelDeletionLinkResource({ sales: product.nativeServices.sales, location })).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(product.nativeServices.sales.restoreMethod).toBeUndefined();
  });

  it("rejects unsupported selectors, overflow and malformed tuples without projection", () => {
    const { definition } = bind(() => ({}));
    for (const method of Object.values(definition.methods)) {
      expect(Result.isSuccess(method.arguments([{ sales_channel: { sales_channel_id: ["1", "2", "3", "4"] } }]))).toBe(true);
      for (const input of [{ sales_channel: { sales_channel_id: ["1", "2", "3", "4", "5"] } },
        { sales_channel: { sales_channel_id: "sc" } }, { sales_channel: { sales_channel_id: [""] } },
        { sales_channel: { sales_channel_id: ["sc"], id: [] } }, { product: { product_id: ["p"] } },
        { sales_channel: { sales_channel_id: ["sc"] }, stock_location: { stock_location_id: ["loc"] } }])
        expect(method.arguments([input])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      expect(Result.isFailure(method.output([null, {}, "discarded"]))).toBe(true);
      expect(Result.isFailure(method.output([null]))).toBe(true);
    }
  });
});
