import { describe, expect, it, vi } from "vitest";
import { Result } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareShippingOptionTypeDeletionLinkResource } from "../src/links/shipping-option-type-deletion";
import { composedWorkflowResourceDefinition, type ComposedWorkflowServices } from "../src/workflow/composed-resource";

const resource = Result.getOrThrow(prepareShippingOptionTypeDeletionLinkResource());
const definition = composedWorkflowResourceDefinition(resource);
if (definition === undefined) throw new Error("Missing genuine Type deletion Link admission");
type Service = ComposedWorkflowServices<{ readonly link: typeof resource }>["link"];
// SAFETY: the authentic definition owns this exact associated service ABI.
// This observation port grants no participant methods or persistence authority.
const bind = () => definition.bind(async () => { throw new Error("Unexpected Type Link participant dispatch"); }) as Service;
const endpoint = (ids: string[]) => ({ fulfillment: { shipping_option_type_id: ids } });

describe("native Type deletion explicit empty installed Link closure", () => {
  it.each(["delete", "restore"] as const)("invokes genuine Link.%s for raw and empty grouped endpoints", async operation => {
    const native = vi.spyOn(Link.prototype, operation), service = bind();
    try {
      for (const ids of [[], ["b", "missing", "b", "a"]]) {
        const input = endpoint(ids), original = structuredClone(input);
        const output = await service[operation](input);
        expect(output).toEqual([null, {}]); expect(input).toEqual(original);
        expect(native.mock.calls.at(-1)?.[0]).toEqual(original);
        expect(Result.isSuccess(definition.methods[operation]!.output(output))).toBe(true);
      }
      expect(native).toHaveBeenCalledTimes(2);
      expect(definition.dependencies).toEqual([]);
      expect(definition.identity).toEqual({ format: "medusa.shipping-option-type.deletion-links", services: [] });
      expect(Object.keys(definition.methods)).toEqual(["delete", "restore"]);
    } finally { native.mockRestore(); }
  });
  it("refuses foreign families, scalar endpoints, excess IDs and fabricated nonempty cascade maps", () => {
    for (const operation of ["delete", "restore"] as const) {
      const method = definition.methods[operation]!;
      for (const input of [{}, { fulfillment: {} }, endpoint([""]), endpoint(["1", "2", "3", "4", "5"]),
        { fulfillment: { shipping_option_type_id: "scalar" } }, { fulfillment: { shipping_profile_id: ["profile"] } },
        { fulfillment: { shipping_option_type_id: ["type"] }, product: { product_id: ["p"] } }])
        expect(Result.isFailure(method.arguments([input]))).toBe(true);
      for (const output of [[null, { custom: {} }], [[], {}], [[{ serviceName: "custom", method: "softDelete", args: {}, error: { message: "failure" } }], {}],
        [null, {}, "extra"], {}, null] satisfies Json[]) expect(Result.isFailure(method.output(output))).toBe(true);
    }
  });
});
