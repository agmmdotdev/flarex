import { describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { admitParticipantEvents, captureParticipantEvents, defineCommerceEventContract, prepareAtomicCommerceEvents } from "../../persistence-postgres/src/atomicCommerce/events";
import { runEffect } from "../../persistence-postgres/test/effectTestRuntime";

describe("participant event configuration capture", () => {
  const revision = "a".repeat(64);
  const first = defineCommerceEventContract({ name: "first", revision, internal: true, decode: () => Effect.succeed(null) });
  const second = defineCommerceEventContract({ name: "second", revision, internal: true, decode: () => Effect.succeed(null) });
  it("captures token order and callback identity and admits a canonical association", async () => {
    const tokens = [second, first], select = () => Effect.succeed(first);
    const input = { contracts: tokens, select };
    const captured = Result.getOrThrow(captureParticipantEvents(input));
    tokens.reverse(); input.select = () => Effect.succeed(second);
    expect(captured?.contracts).toEqual([second, first]); expect(captured?.select).toBe(select);
    expect(Object.isFrozen(captured)).toBe(true); expect(Object.isFrozen(captured?.contracts)).toBe(true);
    const policy = await runEffect(prepareAtomicCommerceEvents({ producerRevision: revision, contracts: [second, first],
      subscribers: [{ id: "test", revision }], validate: () => Effect.void }));
    expect(Result.getOrThrow(admitParticipantEvents(captured, policy))).toEqual([{ name: "first", revision }, { name: "second", revision }]);
    expect(Result.getOrThrow(captureParticipantEvents(undefined))).toBeUndefined();
    expect(Result.getOrThrow(admitParticipantEvents(undefined, undefined))).toEqual([]);
  });
  it("refuses malformed registrations without executing accessors", () => {
    const getter = vi.fn(() => first);
    const select = () => Effect.succeed(first);
    const values: unknown[] = [null, {}, { contracts: [first] }, { contracts: [first, first], select },
      { contracts: [{}], select }, { contracts: new Array(1), select },
      { contracts: Object.defineProperty([], 0, { get: getter, enumerable: true }), select },
      Object.defineProperty({ select }, "contracts", { get: getter }),
      Object.defineProperty({ contracts: [first] }, "select", { get: getter }),
      { contracts: Array.from({ length: 65 }, () => first), select }];
    for (const value of values) expect(Result.isFailure(Reflect.apply(captureParticipantEvents, undefined, [value]))).toBe(true);
    expect(getter).not.toHaveBeenCalled();
  });
});
