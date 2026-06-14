import { describe, expect, expectTypeOf, it } from "vitest";
import {
  anyApi,
  getFunctionName,
  makeFunctionReference,
  mutation,
  type ApiFromModules,
  type FunctionArgs,
  type FunctionReturnType,
} from "../src/server";
import { v } from "../src/values";

const complete = mutation({
  args: { lessonId: v.string() },
  returns: v.object({ completed: v.string() }),
  handler: async (_ctx, args) => ({ completed: args.lessonId }),
});

const objectShorthandReturn = mutation({
  args: {},
  returns: { ok: v.boolean() },
  handler: () => ({ ok: true }),
});

// @ts-expect-error Handler return must match the declared returns validator.
mutation({
  args: {},
  returns: v.object({ ok: v.boolean() }),
  handler: () => ({ ok: "yes" }),
});

type GeneratedApi = ApiFromModules<{
  lessons: {
    complete: typeof complete;
    objectShorthandReturn: typeof objectShorthandReturn;
  };
}>;

describe("Convex-compatible function references", () => {
  it("builds function paths through anyApi", () => {
    expect(getFunctionName(anyApi.lessons.complete)).toBe("lessons:complete");
    expect(anyApi.lessons.complete._path).toBe("lessons:complete");
  });

  it("builds standalone serializable references", () => {
    const reference = makeFunctionReference<"mutation">("lessons:complete", "mutation");
    expect(reference).toMatchObject({
      _path: "lessons:complete",
      _kind: "mutation",
    });
  });

  it("derives generated reference argument and return types", () => {
    type Complete = GeneratedApi["lessons"]["complete"];
    type ObjectShorthand = GeneratedApi["lessons"]["objectShorthandReturn"];
    expectTypeOf<FunctionArgs<Complete>>().toEqualTypeOf<{ lessonId: string }>();
    expectTypeOf<FunctionReturnType<Complete>>().toMatchTypeOf<{ completed: string }>();
    expectTypeOf<FunctionReturnType<ObjectShorthand>>().toMatchTypeOf<{ ok: boolean }>();
  });
});
