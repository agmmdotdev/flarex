import { Result } from "effect";
import { expect, expectTypeOf, it } from "vitest";
import { payloadJoins } from "../src/contract";
import { PayloadJoinInputSchema, payloadJoinQuery, type PayloadJoinInput } from "../src/joins";

const failureReason = (input: unknown, sanitized = false) => Result.match(payloadJoinQuery(input, sanitized), {
  onSuccess: () => "unexpectedSuccess",
  onFailure: error => error.reason,
});
const defaults = Object.fromEntries(payloadJoins.map(join => [join.name, { limit: join.defaultLimit }]));

it("derives caller options from the join schema and retains false/default semantics", () => {
  expectTypeOf<PayloadJoinInput>().toEqualTypeOf<typeof PayloadJoinInputSchema.Type>();
  const caller: PayloadJoinInput = { referencedBy: { limit: 1, page: 1, count: false }, referencedByMany: false };
  expect(Result.getOrThrow(payloadJoinQuery(caller))).toEqual({ referencedBy: { limit: 1 }, referencedByMany: false });
  for (const input of [undefined, {}, { referencedBy: {} }]) {
    expect(Result.getOrThrow(payloadJoinQuery(input))).toEqual(defaults);
  }
  expect(Result.getOrThrow(payloadJoinQuery(false))).toEqual({ referencedBy: false, referencedByMany: false });
  expect(Result.getOrThrow(payloadJoinQuery({ referencedBy: false }))).toEqual({
    referencedBy: false, referencedByMany: { limit: payloadJoins[1].defaultLimit },
  });
  // @ts-expect-error Native sanitized where options are not caller inputs.
  const sanitizedCaller: PayloadJoinInput = { referencedBy: { where: {} } };
  void sanitizedCaller;
});

it("refuses malformed join envelopes and excess keys", () => {
  for (const input of [null, true, 1, "joins", [], { otherJoin: false },
    { referencedBy: null }, { referencedBy: true }, { referencedBy: [] }, { referencedBy: 1 },
    { referencedBy: { extra: false } }, { referencedByMany: { extra: false } }]) {
    expect(failureReason(input)).toBe("unsupportedProfile");
    expect(failureReason(input, true)).toBe("unsupportedProfile");
  }
});

it("retains each metadata limit and the fixed page/count options", () => {
  for (const join of payloadJoins) {
    for (const limit of [1, join.defaultLimit, join.maximumLimit]) {
      for (const sanitized of [false, true]) expect(Result.getOrThrow(payloadJoinQuery({
        [join.name]: { limit, page: 1, count: false },
      }, sanitized))[join.name]).toEqual({ limit });
    }
    for (const options of [{ limit: 0 }, { limit: -1 }, { limit: 1.5 }, { limit: join.maximumLimit + 1 },
      { limit: Number.MAX_SAFE_INTEGER + 1 }, { limit: "1" }, { limit: null },
      { page: 0 }, { page: 2 }, { page: null }, { count: true }, { count: 0 }, { count: null }]) {
      expect(failureReason({ [join.name]: options })).toBe("unsupportedProfile");
      expect(failureReason({ [join.name]: options }, true)).toBe("unsupportedProfile");
    }
  }
});

it("allows only the native sanitizer's empty where object", () => {
  for (const join of payloadJoins) {
    const input = { [join.name]: { where: {}, limit: join.maximumLimit, page: 1, count: false } };
    expect(failureReason(input)).toBe("unsupportedProfile");
    expect(Result.getOrThrow(payloadJoinQuery(input, true))[join.name]).toEqual({ limit: join.maximumLimit });
    for (const where of [null, [], false, { id: { equals: "post" } }, { and: [] }]) {
      expect(failureReason({ [join.name]: { where } }, true)).toBe("unsupportedProfile");
    }
  }
  expect(Result.getOrThrow(payloadJoinQuery(false, true))).toEqual({ referencedBy: false, referencedByMany: false });
  expect(Result.getOrThrow(payloadJoinQuery(undefined, true))).toEqual(defaults);
});

it("captures descriptors and resource bounds before decoding unsupported options", () => {
  let getterCalls = 0;
  const getter = Object.defineProperty({ unsupported: true }, "referencedBy", {
    enumerable: true, get: () => { getterCalls++; return {}; },
  });
  const cyclic: Record<string, unknown> = { unsupported: true };
  cyclic.referencedBy = cyclic;
  for (const sanitized of [false, true]) {
    expect(failureReason(getter, sanitized)).toBe("invalidInput");
    expect(failureReason(cyclic, sanitized)).toBe("limitExceeded");
    expect(failureReason({ unsupported: "x".repeat(4096) }, sanitized)).toBe("limitExceeded");
    expect(failureReason({ referencedBy: { limit: undefined } }, sanitized)).toBe("invalidInput");
    expect(failureReason({ referencedBy: { limit: Number.NaN } }, sanitized)).toBe("invalidInput");
  }
  expect(getterCalls).toBe(0);
});
