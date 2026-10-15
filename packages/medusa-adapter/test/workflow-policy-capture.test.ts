import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { commerceLimits, inspectCapturedPrivateJsonData, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureWorkflowPolicy } from "../src/workflow/configuration";
import { captureCommerceInput } from "../src/value/input";

const nested = (depth: number): Json => {
  let value: Json = "leaf";
  for (let index = 0; index < depth; index++) value = { child: value };
  return value;
};

describe("trusted workflow policy capture", () => {
  it("uses the core policy envelope while retaining the entire identity preimage", () => {
    const input = { policy: {}, workflow: { definition: nested(20), resources: [], revision: "a".repeat(64) } };
    const captured = Result.getOrThrow(captureWorkflowPolicy(input));
    expect(captured).toEqual(input);
    expect(captured).not.toBe(input);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(inspectCapturedPrivateJsonData(captured)?.depth).toBeGreaterThan(16);
    expect(captureCommerceInput(input)).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    const wide = Array.from({ length: 9000 }, () => 0);
    expect(Result.getOrThrow(captureWorkflowPolicy(wide))).toEqual(wide);
    expect(captureCommerceInput(wide)).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  });

  it("retains the existing core configuration byte and depth ceilings", () => {
    expect(captureWorkflowPolicy(nested(65))).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    expect(captureWorkflowPolicy("x".repeat(commerceLimits.rowBytes))).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  });

  it("preserves native omission and rejects malformed configuration without invoking getters", () => {
    let getters = 0;
    const accessor = Object.defineProperty({}, "secret", { enumerable: true, get: () => { getters++; return "hidden"; } });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(Result.getOrThrow(captureWorkflowPolicy({ optional: undefined, kept: "value" }))).toEqual({ kept: "value" });
    for (const input of [accessor, cycle, new Date(), { invalid: "\ud800" }])
      expect(captureWorkflowPolicy(input)).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(getters).toBe(0);
  });
});
