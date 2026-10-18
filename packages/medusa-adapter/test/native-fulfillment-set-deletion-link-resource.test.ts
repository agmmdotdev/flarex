import { beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Option, Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { LocationFulfillmentSet } from "@medusajs/link-modules";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareFulfillmentSetDeletionLinkResource } from "../src/links/fulfillment-set-deletion";
import { makeFulfillmentSetDeletionCommands } from "../src/modules/fulfillment/fulfillment-set-delete-service";
import { prepareLocationFulfillmentSetDeletionLinks } from "../src/links/location-fulfillment-set-deletion";
import { composedWorkflowResourceDefinition, type ComposedWorkflowServices } from "../src/workflow/composed-resource";
import { prepareWorkflowResources, workflowResourceSelections } from "../src/workflow/resources";
import { bindWorkflowResources } from "../src/workflow/binding";
import { makeCommercePromiseOwner } from "../src/module/promise-owner";
import { captureCommerceInput } from "../src/value/input";
import { commerceDecoder } from "../src/value/decoder";

type Resource = Result.Result.Success<ReturnType<typeof prepareFulfillmentSetDeletionLinkResource>>;
type Service = ComposedWorkflowServices<{ readonly link: Resource }>["link"];
const endpoint = (ids: string[]) => ({ fulfillment: { fulfillment_set_id: ids } });
async function prepare() {
  const fulfillment = await Effect.runPromise(makeFulfillmentSetDeletionCommands());
  const links = await Effect.runPromise(prepareLocationFulfillmentSetDeletionLinks("fulfillment-set-deletions", "setResourceLocationLink"));
  const resource = Result.getOrThrow(prepareFulfillmentSetDeletionLinkResource({ location: links.nativeService, fulfillment: fulfillment.workflow }));
  return { resource, resources: Result.getOrThrow(prepareWorkflowResources({
    fulfillment: { module: fulfillment.workflow, methods: ["softDeleteFulfillmentSets", "restoreFulfillmentSets"], graph: false },
    locationLinks: { module: links.workflow, methods: ["create", "list", "softDelete", "restore"], graph: false, expose: false },
  }, false, { link: resource })) };
}
let prepared: Awaited<ReturnType<typeof prepare>>;
beforeAll(async () => { prepared = await prepare(); });

/** Empty selected rows still reach the installed native family. Persistence
 * and atomicity belong to the connected tests. */
async function bind() {
  const { resource, resources } = prepared;
  const selected = workflowResourceSelections(resources); if (selected === undefined) throw new Error("Missing genuine Set Link selection");
  const decodeJson = commerceDecoder(Schema.Json, "invalidInput");
  const call = vi.fn<AtomicCommerceContext["call"]>(() => Effect.succeed({}));
  const emit = vi.fn<AtomicCommerceContext["emit"]>(() => Effect.fail(commerceError("unadmittedEvent")));
  const refuse = vi.fn<AtomicCommerceContext["refuse"]>(error => Effect.fail(error));
  const context: AtomicCommerceContext = { eventGroupId: "native-fulfillment-set-links", checkpoint: Effect.void,
    capture: (input, normalize) => Effect.suspend(() => Effect.fromResult(captureCommerceInput(input).pipe(Result.flatMap(normalize ?? decodeJson)))), call, emit, refuse };
  const owner = await Effect.runPromise(makeCommercePromiseOwner());
  const service = bindWorkflowResources(resources, selected, undefined, [], context, owner).resolve<Service>("link");
  return { resource, service, owner, call, emit, refuse };
}

describe("native Fulfillment Set deletion installed Location Link resource", () => {
  it.each(["delete", "restore"] as const)("invokes actual Link.%s for raw and truthy empty grouped endpoints", async operation => {
    const bound = await bind(), native = vi.spyOn(Link.prototype, operation);
    try {
      for (const ids of [[], ["b", "missing", "b", "a"]]) {
        const input = endpoint(ids), original = structuredClone(input);
        expect(await bound.service[operation](input)).toEqual([null, {}]); expect(input).toEqual(original); expect(native.mock.calls.at(-1)?.[0]).toEqual(original);
      }
      expect(native).toHaveBeenCalledTimes(2); expect(bound.call).toHaveBeenCalledTimes(1); expect(bound.emit).not.toHaveBeenCalled();
      expect(Option.isNone(bound.owner.refusal())).toBe(true);
      const definition = composedWorkflowResourceDefinition(bound.resource);
      expect(definition?.dependencies).toHaveLength(4); expect(Object.keys(definition?.methods ?? {})).toEqual(["delete", "restore"]);
      expect(definition?.identity).toMatchObject({ format: "medusa.fulfillment-set.deletion-links", lifecycle: { maximumRows: 8, completeHistory: true } });
    } finally { native.mockRestore(); await Effect.runPromise(bound.owner.close); }
  });

  it("accepts installed identity maps and refuses malformed endpoints and foreign/error cascade results", () => {
    const definition = composedWorkflowResourceDefinition(prepared.resource);
    if (definition === undefined) throw new Error("Missing authentic Set Link definition");
    for (const operation of ["delete", "restore"] as const) {
      const method = definition.methods[operation]; if (method === undefined) throw new Error("Missing selected Link method");
      expect(Result.isSuccess(method.arguments([endpoint(["b", "missing", "b", "a"])]))).toBe(true);
      for (const input of [{}, { fulfillment: {} }, endpoint([""]), endpoint(["a".repeat(257)]), endpoint(["1", "2", "3", "4", "5"]),
        { fulfillment: { fulfillment_set_id: "scalar" } }, { fulfillment: { fulfillment_set_id: [], service_zone_id: [] } },
        { fulfillment: { shipping_profile_id: ["profile"] } }, { fulfillment: { fulfillment_set_id: [] }, product: { product_id: [] } }])
        expect(method.arguments([input])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      expect(Result.isSuccess(method.output([null, {}]))).toBe(true);
      const family = LocationFulfillmentSet.serviceName;
      if (family === undefined) throw new Error("Missing installed native family");
      expect(Result.isSuccess(method.output([null, { [family]: { stock_location_id: ["location"], fulfillment_set_id: ["set"] },
        fulfillment: { fulfillment_set_id: ["set"] } }]))).toBe(true);
      for (const value of [{ [family]: { stock_location_id: ["location"] } },
        { [family]: { stock_location_id: ["location"], fulfillment_set_id: ["set", "other"] } },
        { fulfillment: { fulfillment_address_id: ["address"] } }, { fulfillment: { fulfillment_set_id: [] } }])
        expect(Result.isFailure(method.output([null, value]))).toBe(true);
      for (const output of [[null, { futureLink: {} }], [[], {}], [[{ serviceName: "future-link", method: "softDelete", args: {}, error: { message: "failed" } }], {}],
        [null, {}, "extra"], [null], {}, null] satisfies Json[]) expect(Result.isFailure(method.output(output))).toBe(true);
    }
  });

  it("rejects copied, serialized and inherited resource identities before admission", () => {
    const resource = prepared.resource;
    expect(composedWorkflowResourceDefinition(resource)).toBeDefined();
    for (const forged of [{ ...resource }, structuredClone(resource), Object.create(resource)]) {
      expect(composedWorkflowResourceDefinition(forged)).toBeUndefined();
      expect(Reflect.apply(prepareWorkflowResources, undefined, [{}, false, { link: forged }])).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    }
  });

  it("hands caught decoder refusal to the root owner and revokes both escaped native Link methods", async () => {
    const bound = await bind(), nativeDelete = vi.spyOn(Link.prototype, "delete"), nativeRestore = vi.spyOn(Link.prototype, "restore");
    try {
      await expect(Reflect.apply(bound.service.delete, undefined, [endpoint(["1", "2", "3", "4", "5"])]))
        .rejects.toMatchObject({ reason: "invalidInput" });
      expect(bound.refuse).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reason: "invalidInput" }));
      expect(Option.isNone(bound.owner.refusal())).toBe(true);
      expect(() => Reflect.apply(Reflect.get(bound.service, "create"), undefined, [])).toThrow(expect.objectContaining({ reason: "unsupportedProfile" }));
      expect(bound.owner.refusal()).toMatchObject({ _tag: "Some", value: { reason: "unsupportedProfile" } });
      const remove = bound.service.delete, restore = bound.service.restore; await Effect.runPromise(bound.owner.close);
      await expect(remove(endpoint(["set"]))).rejects.toMatchObject({ reason: "closed" });
      await expect(restore(endpoint(["set"]))).rejects.toMatchObject({ reason: "closed" });
      expect(nativeDelete).not.toHaveBeenCalled(); expect(nativeRestore).not.toHaveBeenCalled(); expect(bound.call).not.toHaveBeenCalled(); expect(bound.emit).not.toHaveBeenCalled();
    } finally { nativeDelete.mockRestore(); nativeRestore.mockRestore(); await Effect.runPromise(bound.owner.close); }
  });
});
