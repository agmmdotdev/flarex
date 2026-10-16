import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { commerceCommandIdentity } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareStockLocationDeletionLinks, prepareStockLocationDeletionLinkResource } from "../src/links/stock-location-deletion";
import { prepareSalesChannelDeletionLinks } from "../src/links/sales-channel-deletion";
import { composedWorkflowResourceDefinition, type ComposedWorkflowServices, type InvokeWorkflowMethod } from "../src/workflow/composed-resource";
import { workflowMethodDefinition, workflowModuleDefinition, type WorkflowMethod } from "../src/workflow/module";

let links: Effect.Success<ReturnType<typeof prepareStockLocationDeletionLinks>>;
type Service = ComposedWorkflowServices<{ readonly link: typeof links.resource }>["link"];

/** Real native Link routing over authentic method contracts. Connected tests
 * own storage, refusal poisoning, scheduling and final settlement evidence. */
function bind(respond: (name: string, args: readonly unknown[]) => Json | Promise<Json>) {
  const definition = composedWorkflowResourceDefinition(links.resource);
  if (definition === undefined) throw new Error("Missing Stock Location deletion Link resource");
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

const endpoint = (ids: string[]) => ({ stock_location: { stock_location_id: [...ids], location_id: [...ids] } });

describe("native Stock Location deletion Link resource", () => {
  beforeAll(async () => { links = await Effect.runPromise(prepareStockLocationDeletionLinks()); });

  it.each(["delete", "restore"] as const)("routes %s once through stock_location_id and ignores the agreed authored alias", async operation => {
    const family = links.nativeServices.location;
    const { service, calls, definition } = bind(() => ({ sales_channel_id: ["sc1", "sc2"], stock_location_id: ["loc", "loc"] }));
    const input = endpoint(["loc", "missing", "loc"]);
    expect(await service[operation](input)).toEqual([null, {
      [family.routing.__joinerConfig.serviceName!]: { sales_channel_id: ["sc1", "sc2"], stock_location_id: ["loc", "loc"] },
    }]);
    expect(calls).toEqual([{ name: operation === "delete" ? family.softDeleteName : family.restoreName,
      args: [{ stock_location_id: ["loc", "missing", "loc"] }, { returnLinkableKeys: family.routing.__joinerConfig.primaryKeys }] }]);
    expect(definition.dependencies).toEqual([family.softDeleteMethod, family.restoreMethod]);
    expect(Object.keys(definition.methods)).toEqual(["delete", "restore"]);
    expect(input).toEqual(endpoint(["loc", "missing", "loc"]));
  });

  it("retains native generated-empty and grouped-empty paths for deletion and compensation", async () => {
    const { service, calls } = bind(() => { throw new Error("Unexpected empty family callback"); });
    for (const operation of ["delete", "restore"] as const) {
      expect(await service[operation]({ stock_location: {} })).toEqual([null, {}]);
      expect(await service[operation](endpoint([]))).toEqual([null, {}]);
    }
    expect(calls).toEqual([]);
  });

  it.each(["delete", "restore"] as const)("preserves complete native errors-as-data for %s", async operation => {
    const { service, calls, definition } = bind(async () => { throw new Error("native Link failure"); });
    const result = await service[operation](endpoint(["loc"]));
    expect(result[0]).toMatchObject([{ serviceName: links.nativeServices.location.routing.__joinerConfig.serviceName,
      method: operation === "delete" ? "softDelete" : "restore", args: { stock_location_id: ["loc"] },
      error: { message: "native Link failure" } }]);
    expect(result[1]).toEqual({}); expect(calls).toHaveLength(1);
    expect(Result.isSuccess(definition.methods[operation]!.output(result))).toBe(true);
  });

  it("binds the one genuine family and retained restoration to a distinct admitted source", () => {
    const workflow = links.location.workflow, definition = workflowModuleDefinition(workflow);
    expect(workflow.name).toBe("sales_channel_location_stock_location_deletion_links");
    expect(definition?.source).toEqual({ name: links.nativeServices.location.routing.__joinerConfig.serviceName, profile: "stock-location-deletions" });
    expect(definition?.graph).toEqual({ aliases: [], reads: [] });
    expect(Object.keys(workflow.methods)).toEqual(["create", "list", "softDelete", "restore"]);
    expect(links.nativeServices.location.restoreMethod).toBeDefined();
  });

  it("rejects forged services and another endpoint's genuine admission", async () => {
    expect(prepareStockLocationDeletionLinkResource({ location: { ...links.nativeServices.location } }))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    const sales = await Effect.runPromise(prepareSalesChannelDeletionLinks());
    expect(prepareStockLocationDeletionLinkResource({ location: sales.nativeServices.location }))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(prepareStockLocationDeletionLinkResource({ location: sales.nativeServices.sales }))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });

  it("authenticates both aliases including order, exact endpoint shape, empty maps and bounds", () => {
    const { definition } = bind(() => ({}));
    for (const method of Object.values(definition.methods)) {
      for (const input of [{ stock_location: {} }, endpoint([]), endpoint(["1", "2", "3", "4"])])
        expect(Result.isSuccess(method.arguments([input]))).toBe(true);
      for (const input of [endpoint(["1", "2", "3", "4", "5"]), endpoint([""]),
        { stock_location: { stock_location_id: ["loc"] } }, { stock_location: { location_id: ["loc"] } },
        { stock_location: { stock_location_id: ["loc"], location_id: ["other"] } },
        { stock_location: { stock_location_id: ["a", "b"], location_id: ["b", "a"] } },
        { stock_location: { stock_location_id: "loc", location_id: "loc" } },
        { stock_location: { stock_location_id: [], location_id: [], id: [] } },
        {}, { stock_location: {}, sales_channel: { sales_channel_id: ["sc"] } }])
        expect(method.arguments([input])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    }
  });

  it("decodes the full native cascade tuple before accepting any output", () => {
    const { definition } = bind(() => ({}));
    for (const method of Object.values(definition.methods)) {
      const malformed: Json[] = [[null, {}, "discarded"], [null], [[], {}], [null, { family: { id: "loc" } }],
        [[{ serviceName: "family", method: "softDelete", args: {}, error: "lost" }], {}]];
      for (const output of malformed)
        expect(Result.isFailure(method.output(output))).toBe(true);
      expect(Result.isSuccess(method.output([null, {}]))).toBe(true);
    }
  });
});
