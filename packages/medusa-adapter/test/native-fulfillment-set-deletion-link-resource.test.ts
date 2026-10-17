import { describe, expect, it, vi } from "vitest";
import { Effect, Option, Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareFulfillmentSetDeletionLinkResource } from "../src/links/fulfillment-set-deletion";
import { composedWorkflowResourceDefinition, type ComposedWorkflowServices } from "../src/workflow/composed-resource";
import { prepareWorkflowResources, workflowResourceSelections } from "../src/workflow/resources";
import { bindWorkflowResources } from "../src/workflow/binding";
import { makeCommercePromiseOwner } from "../src/module/promise-owner";
import { captureCommerceInput } from "../src/value/input";
import { commerceDecoder } from "../src/value/decoder";

type Resource = Result.Result.Success<ReturnType<typeof prepareFulfillmentSetDeletionLinkResource>>;
type Service = ComposedWorkflowServices<{ readonly link: Resource }>["link"];
const endpoint = (ids: string[]) => ({ fulfillment: { fulfillment_set_id: ids } });

/** This observes the actual empty-registry native Link ABI under the genuine
 * composed callback owner. Persistence and atomicity belong to connected tests. */
async function bind() {
  const resource = Result.getOrThrow(prepareFulfillmentSetDeletionLinkResource()), resources = Result.getOrThrow(prepareWorkflowResources({}, false, { link: resource }));
  const selected = workflowResourceSelections(resources); if (selected === undefined) throw new Error("Missing genuine Set Link selection");
  const decodeJson = commerceDecoder(Schema.Json, "invalidInput");
  const call = vi.fn<AtomicCommerceContext["call"]>(() => Effect.fail(commerceError("invalidAuthority")));
  const emit = vi.fn<AtomicCommerceContext["emit"]>(() => Effect.fail(commerceError("unadmittedEvent")));
  const refuse = vi.fn<AtomicCommerceContext["refuse"]>(error => Effect.fail(error));
  const context: AtomicCommerceContext = { eventGroupId: "native-fulfillment-set-links", checkpoint: Effect.void,
    capture: (input, normalize) => Effect.suspend(() => Effect.fromResult(captureCommerceInput(input).pipe(Result.flatMap(normalize ?? decodeJson)))), call, emit, refuse };
  const owner = await Effect.runPromise(makeCommercePromiseOwner());
  const service = bindWorkflowResources(resources, selected, undefined, [], context, owner).resolve<Service>("link");
  return { resource, service, owner, call, emit, refuse };
}

describe("native Fulfillment Set deletion explicit empty installed Link resource", () => {
  it.each(["delete", "restore"] as const)("invokes actual Link.%s for raw and truthy empty grouped endpoints", async operation => {
    const bound = await bind(), native = vi.spyOn(Link.prototype, operation);
    try {
      for (const ids of [[], ["b", "missing", "b", "a"]]) {
        const input = endpoint(ids), original = structuredClone(input);
        expect(await bound.service[operation](input)).toEqual([null, {}]); expect(input).toEqual(original); expect(native.mock.calls.at(-1)?.[0]).toEqual(original);
      }
      expect(native).toHaveBeenCalledTimes(2); expect(bound.call).not.toHaveBeenCalled(); expect(bound.emit).not.toHaveBeenCalled();
      expect(Option.isNone(bound.owner.refusal())).toBe(true);
      const definition = composedWorkflowResourceDefinition(bound.resource);
      expect(definition?.dependencies).toEqual([]); expect(Object.keys(definition?.methods ?? {})).toEqual(["delete", "restore"]);
      expect(definition?.identity).toEqual({ format: "medusa.fulfillment-set.deletion-links", services: [] });
    } finally { native.mockRestore(); await Effect.runPromise(bound.owner.close); }
  });

  it("refuses other endpoints and every nonempty/error native cascade result", () => {
    const resource = Result.getOrThrow(prepareFulfillmentSetDeletionLinkResource()), definition = composedWorkflowResourceDefinition(resource);
    if (definition === undefined) throw new Error("Missing authentic Set Link definition");
    for (const operation of ["delete", "restore"] as const) {
      const method = definition.methods[operation]; if (method === undefined) throw new Error("Missing selected Link method");
      expect(Result.isSuccess(method.arguments([endpoint(["b", "missing", "b", "a"])]))).toBe(true);
      for (const input of [{}, { fulfillment: {} }, endpoint([""]), endpoint(["a".repeat(257)]), endpoint(["1", "2", "3", "4", "5"]),
        { fulfillment: { fulfillment_set_id: "scalar" } }, { fulfillment: { fulfillment_set_id: [], service_zone_id: [] } },
        { fulfillment: { shipping_profile_id: ["profile"] } }, { fulfillment: { fulfillment_set_id: [] }, product: { product_id: [] } }])
        expect(method.arguments([input])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      expect(Result.isSuccess(method.output([null, {}]))).toBe(true);
      for (const output of [[null, { futureLink: {} }], [[], {}], [[{ serviceName: "future-link", method: "softDelete", args: {}, error: { message: "failed" } }], {}],
        [null, {}, "extra"], [null], {}, null] satisfies Json[]) expect(Result.isFailure(method.output(output))).toBe(true);
    }
  });

  it("rejects copied, serialized and inherited resource identities before admission", () => {
    const resource = Result.getOrThrow(prepareFulfillmentSetDeletionLinkResource());
    expect(Result.isSuccess(prepareWorkflowResources({}, false, { link: resource }))).toBe(true);
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
