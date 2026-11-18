import { promiseFailureObserver } from "./support/promise-failure-observer";
import { describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareProductTypeDeletionLinkResource } from "../src/links/product-type-resource";
import { composedWorkflowResourceDefinition, type ComposedWorkflowServices } from "../src/workflow/composed-resource";
import { prepareWorkflowResources, workflowResourceSelections } from "../src/workflow/resources";
import { bindWorkflowResources } from "../src/workflow/binding";
import { makeCommercePromiseOwner } from "../src/module/promise-owner";
import { captureCommerceInput } from "../src/value/input";
import { commerceDecoder } from "../src/value/decoder";

type Resource = Result.Result.Success<ReturnType<typeof prepareProductTypeDeletionLinkResource>>;
type Service = ComposedWorkflowServices<{ readonly link: Resource }>["link"];

/** Observe the real composed-resource ABI and borrowed callback owner. This
 * port models neither storage nor atomic settlement, which integration owns. */
async function bind() {
  const resource = Result.getOrThrow(prepareProductTypeDeletionLinkResource());
  const resources = Result.getOrThrow(prepareWorkflowResources({}, false, { link: resource }));
  const selected = workflowResourceSelections(resources);
  if (selected === undefined) throw new Error("Missing authentic Type Link selection");
  const decodeJson = commerceDecoder(Schema.Json, "invalidInput");
  const call = vi.fn<AtomicCommerceContext["call"]>(() => Effect.fail(commerceError("invalidAuthority")));
  const emit = vi.fn<AtomicCommerceContext["emit"]>(() => Effect.fail(commerceError("unadmittedEvent")));
  const refuse = vi.fn<AtomicCommerceContext["refuse"]>(error => Effect.fail(error));
  const recordFailure = promiseFailureObserver();
  const ctx: AtomicCommerceContext = { eventGroupId: "native-product-type-links", checkpoint: Effect.void,
    clearPendingEvents: () => Effect.fail(commerceError("unadmittedEvent")),
    capture: (input, normalize) => Effect.suspend(() => Effect.fromResult(captureCommerceInput(input).pipe(Result.flatMap(normalize ?? decodeJson)))),
    call, emit, refuse, recordFailure,
  };
  const owner = await Effect.runPromise(makeCommercePromiseOwner(recordFailure));
  const service = bindWorkflowResources(resources, selected, undefined, [], ctx, owner).resolve<Service>("link");
  return { resource, service, owner, call, emit, refuse, recordFailure };
}

describe("native Product Type deletion Link resource", () => {
  it("uses the authentic empty router and preserves the entire native cascade tuple", async () => {
    const bound = await bind();
    const nativeDelete = vi.spyOn(Link.prototype, "delete");
    try {
      const input = { product: { product_type_id: ["type-a", "missing-type", "type-a", "type-b"] } };
      expect(await bound.service.delete(input)).toEqual([null, {}]);
      expect(nativeDelete).toHaveBeenCalledExactlyOnceWith(input);
      expect(bound.call).not.toHaveBeenCalled(); expect(bound.emit).not.toHaveBeenCalled();
      const definition = composedWorkflowResourceDefinition(bound.resource);
      expect(definition?.dependencies).toEqual([]);
      expect(Object.keys(definition?.methods ?? {})).toEqual(["delete"]);
      expect(definition?.identity).toEqual({ format: "medusa.product-type.deletion-links", services: [] });
      expect(bound.recordFailure).not.toHaveBeenCalled();
    } finally { nativeDelete.mockRestore(); await Effect.runPromise(bound.owner.close); }
  });

  it("executes the actual native empty-selector path", async () => {
    const bound = await bind();
    const nativeDelete = vi.spyOn(Link.prototype, "delete");
    try {
      expect(await bound.service.delete({ product: { product_type_id: [] } })).toEqual([null, {}]);
      expect(nativeDelete).toHaveBeenCalledExactlyOnceWith({ product: { product_type_id: [] } });
      expect(bound.call).not.toHaveBeenCalled(); expect(bound.emit).not.toHaveBeenCalled();
    } finally { nativeDelete.mockRestore(); await Effect.runPromise(bound.owner.close); }
  });

  it("admits at most four input entries and rejects other selectors or malformed native results", () => {
    const resource = Result.getOrThrow(prepareProductTypeDeletionLinkResource());
    const method = composedWorkflowResourceDefinition(resource)?.methods.delete;
    if (method === undefined) throw new Error("Missing native Type Link method");
    expect(Result.isSuccess(method.arguments([{ product: { product_type_id: ["t", "t", "missing", "other"] } }]))).toBe(true);
    for (const input of [
      { product: { product_type_id: ["1", "2", "3", "4", "5"] } },
      { product: { product_type_id: "type" } }, { product: { product_type_id: [""] } },
      { product: { product_type_id: ["x".repeat(257)] } }, { product: { product_type_id: [], variant_id: [] } },
      { product: { product_id: ["p"] } }, { inventory: { inventory_item_id: ["i"] } },
      { product: { product_type_id: [] }, pricing: { price_set_id: [] } },
    ]) expect(method.arguments([input])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(Result.isSuccess(method.output([null, {}]))).toBe(true);
    expect(Result.isFailure(method.output([null, {}, "discarded"]))).toBe(true);
    expect(Result.isFailure(method.output([null]))).toBe(true);
  });

  it("rejects cloned and inherited resource tokens before binding", () => {
    const resource = Result.getOrThrow(prepareProductTypeDeletionLinkResource());
    expect(Result.isSuccess(prepareWorkflowResources({}, false, { link: resource }))).toBe(true);
    for (const forged of [{ ...resource }, structuredClone(resource), Object.create(resource)]) {
      expect(composedWorkflowResourceDefinition(forged)).toBeUndefined();
      expect(Reflect.apply(prepareWorkflowResources, undefined, [{}, false, { link: forged }]))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    }
  });

  it("forwards caught input refusal, retains synchronous resource refusal and revokes an escaped callback", async () => {
    const bound = await bind();
    const nativeDelete = vi.spyOn(Link.prototype, "delete");
    try {
      await expect(Reflect.apply(bound.service.delete, undefined, [{ product: { product_type_id: ["1", "2", "3", "4", "5"] } }]))
        .rejects.toMatchObject({ reason: "invalidInput" });
      expect(bound.refuse).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reason: "invalidInput" }));
      expect(bound.recordFailure).toHaveBeenCalledWith(expect.objectContaining({ reasons: expect.arrayContaining([expect.objectContaining({ _tag: "Fail", error: expect.objectContaining({ reason: "invalidInput" }) })]) }));
      expect(() => Reflect.apply(Reflect.get(bound.service, "restore"), undefined, []))
        .toThrow(expect.objectContaining({ reason: "unsupportedProfile" }));
      expect(bound.recordFailure).toHaveBeenCalledWith(expect.objectContaining({ reasons: expect.arrayContaining([expect.objectContaining({ _tag: "Fail", error: expect.objectContaining({ reason: "unsupportedProfile" }) })]) }));
      expect(nativeDelete).not.toHaveBeenCalled();
      const escaped = bound.service.delete;
      await Effect.runPromise(bound.owner.close);
      await expect(escaped({ product: { product_type_id: ["type"] } })).rejects.toMatchObject({ reason: "closed" });
      expect(nativeDelete).not.toHaveBeenCalled(); expect(bound.call).not.toHaveBeenCalled(); expect(bound.emit).not.toHaveBeenCalled();
    } finally { nativeDelete.mockRestore(); await Effect.runPromise(bound.owner.close); }
  });
});
