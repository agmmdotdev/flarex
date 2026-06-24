import { describe, expect, expectTypeOf, it } from "vitest";
import {
  anyApi,
  createApi,
  internalQuery,
  justInternal,
  justPublic,
  getFunctionName,
  makeFunctionReference,
  mutation,
  type ApiFromModules,
  type FilterApi,
  type FunctionReference,
  type FunctionType,
  type FunctionArgs,
  type FunctionReturnType,
} from "../src/server";
import { v } from "../src/values";

const userPartition = {
  type: "partition" as const,
  table: "users",
  selector: "byId",
  partitionField: "_id",
  argField: "userId",
};

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

const hidden = internalQuery({
  args: { secret: v.string() },
  returns: v.string(),
  handler: async (_ctx, args) => args.secret,
});

mutation({
  args: {},
  returns: v.object({ ok: v.boolean() }),
  // @ts-expect-error Handler return must match the declared returns validator.
  handler: () => ({ ok: "yes" }),
});

type GeneratedApi = ApiFromModules<{
  lessons: {
    complete: typeof complete;
    objectShorthandReturn: typeof objectShorthandReturn;
    hidden: typeof hidden;
  };
}>;
type PublicApi = FilterApi<GeneratedApi, FunctionReference<FunctionType, "public">>;
type InternalApi = FilterApi<GeneratedApi, FunctionReference<FunctionType, "internal">>;

describe("Convex-compatible function references", () => {
  it("builds function paths through anyApi", () => {
    expect(getFunctionName(anyApi.lessons.complete)).toBe("lessons:complete");
    expect(anyApi.lessons.complete._path).toBe("lessons:complete");
  });

  it("builds standalone serializable references", () => {
    const reference = makeFunctionReference<"mutation">(
      "lessons:complete",
      "mutation",
      userPartition,
    );
    expect(reference).toMatchObject({
      _path: "lessons:complete",
      _kind: "mutation",
      _partition: userPartition,
    });
  });

  it("attaches generated partition metadata to api references", () => {
    const api = createApi({
      "lessons:complete": {
        partition: userPartition,
      },
    });
    expect(api.lessons.complete._partition).toEqual(userPartition);
    expect(api.lessons.list._partition).toBeNull();
  });

  it("filters generated references by visibility like Convex api/internal", () => {
    const fullApi = createApi() as unknown as GeneratedApi;
    expect(getFunctionName(justPublic(fullApi).lessons.complete)).toBe("lessons:complete");
    expect(getFunctionName(justInternal(fullApi).lessons.hidden)).toBe("lessons:hidden");

    expectTypeOf<keyof PublicApi["lessons"]>().toEqualTypeOf<
      "complete" | "objectShorthandReturn"
    >();
    expectTypeOf<keyof InternalApi["lessons"]>().toEqualTypeOf<"hidden">();
  });

  it("derives generated reference argument and return types", () => {
    type Complete = GeneratedApi["lessons"]["complete"];
    type ObjectShorthand = GeneratedApi["lessons"]["objectShorthandReturn"];
    expectTypeOf<FunctionArgs<Complete>>().toEqualTypeOf<{ lessonId: string }>();
    expectTypeOf<FunctionReturnType<Complete>>().toMatchTypeOf<{ completed: string }>();
    expectTypeOf<FunctionReturnType<ObjectShorthand>>().toMatchTypeOf<{ ok: boolean }>();
  });
});
