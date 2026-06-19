import { describe, expect, expectTypeOf, it } from "vitest";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  workflowMutation,
  type DefaultFunctionArgs,
  type MutationBuilder,
} from "../src/server";
import { v, type Id } from "../src/values";

type ScopedTestDataModel = {
  users: {
    document: {
      _id: Id<"users">;
      _creationTime: number;
      name: string;
    };
    fieldPaths: "_id" | "_creationTime" | "name";
    indexes: {};
  };
  lessonProgress: {
    document: {
      _id: Id<"lessonProgress">;
      _creationTime: number;
      userId: Id<"users">;
      lessonId: string;
    };
    fieldPaths: "_id" | "_creationTime" | "userId" | "lessonId";
    indexes: {};
  };
  leaderboard: {
    document: {
      _id: Id<"leaderboard">;
      _creationTime: number;
      userId: Id<"users">;
      score: number;
    };
    fieldPaths: "_id" | "_creationTime" | "userId" | "score";
    indexes: {};
  };
};

type ScopedTestPartitionScopes = {
  users: "users" | "lessonProgress";
};

const scopedMutation = mutation as unknown as MutationBuilder<
  ScopedTestDataModel,
  "public",
  "mutation",
  ScopedTestPartitionScopes
>;

const userPartition = {
  type: "partition",
  table: "users",
  selector: "byId",
  partitionField: "_id",
  argField: "userId",
} as const;

const userPartitionRoot = {
  type: "partitionRoot",
  table: "users",
  partitionField: "_id",
} as const;

describe("Convex-style function registration", () => {
  it("attaches exclusive function kind and visibility markers", () => {
    const functions = [
      [query({ args: {}, handler: async () => null }), "isQuery", "isPublic"],
      [internalQuery({ args: {}, handler: async () => null }), "isQuery", "isInternal"],
      [mutation({ args: {}, handler: async () => null }), "isMutation", "isPublic"],
      [internalMutation({ args: {}, handler: async () => null }), "isMutation", "isInternal"],
      [workflowMutation({ args: {}, handler: async () => null }), "isWorkflowMutation", "isPublic"],
      [action({ args: {}, handler: async () => null }), "isAction", "isPublic"],
      [internalAction({ args: {}, handler: async () => null }), "isAction", "isInternal"],
    ] as const;

    for (const [fn, kindMarker, visibilityMarker] of functions) {
      expect(fn.isFlarexFunction).toBe(true);
      expect(fn).toHaveProperty(kindMarker, true);
      expect(fn).toHaveProperty(visibilityMarker, true);
      expect(fn._handler).toBe(fn.handler);
      expect(
        ["isQuery", "isMutation", "isWorkflowMutation", "isAction"].filter(marker => marker in fn),
      ).toHaveLength(1);
      expect(["isPublic", "isInternal"].filter(marker => marker in fn)).toHaveLength(1);
    }
  });

  it("supports direct handlers and object definitions without validators", () => {
    const direct = query(async _ctx => null);
    const directWithArgs = query(async (_ctx, args: DefaultFunctionArgs) => args);
    const object = mutation({ handler: async (_ctx, args) => args });

    expect(direct.exportArgs()).toBe(JSON.stringify(v.any().json));
    expect(direct.exportReturns()).toBe("null");
    expect(directWithArgs.exportArgs()).toBe(JSON.stringify(v.any().json));
    expect(object.exportArgs()).toBe(JSON.stringify(v.any().json));
    expect(object.exportReturns()).toBe("null");
    expectTypeOf(directWithArgs).toMatchTypeOf<{
      _handler: (_ctx: never, args: never) => Promise<DefaultFunctionArgs>;
    }>();
  });

  it("supports a root argument validator like Convex", () => {
    const fn = query({
      args: v.any(),
      handler: async (_ctx, args) => args,
    });

    expect(fn.exportArgs()).toBe(JSON.stringify(v.any().json));
  });

  it("exports argument and return validators as serialized JSON", () => {
    const fn = mutation({
      args: { name: v.string(), nickname: v.optional(v.string()) },
      returns: { ok: v.boolean() },
      handler: async () => ({ ok: true }),
    });

    expect(JSON.parse(fn.exportArgs())).toEqual({
      type: "object",
      value: {
        name: { fieldType: { type: "string" }, optional: false },
        nickname: { fieldType: { type: "string" }, optional: true },
      },
    });
    expect(JSON.parse(fn.exportReturns())).toEqual({
      type: "object",
      value: {
        ok: { fieldType: { type: "boolean" }, optional: false },
      },
    });
  });

  it("rejects undefined validators during strict export", () => {
    const badArgs = query({
      args: { missing: undefined as never },
      handler: async () => null,
    });
    const badReturns = query({
      args: {},
      returns: { missing: undefined as never },
      handler: async () => ({}),
    });

    expect(() => badArgs.exportArgs()).toThrowError(
      'A validator is undefined for field "fieldType".',
    );
    expect(() => badReturns.exportReturns()).toThrowError(
      'A validator is undefined for field "fieldType".',
    );
  });

  it("narrows mutation writer tables from partition scope metadata", () => {
    const fn = scopedMutation({
      partition: userPartition,
      args: { userId: v.id("users"), lessonId: v.string() },
      handler: async (ctx, args) => {
        await ctx.db.insert("lessonProgress", {
          userId: args.userId,
          lessonId: args.lessonId,
        });
        await ctx.db.insert("users", { name: "Ada" });
        // @ts-expect-error leaderboard is not colocated with the users partition scope.
        await ctx.db.insert("leaderboard", { userId: args.userId, score: 1 });
      },
    });

    expect(fn.partition).toEqual(userPartition);
  });

  it("accepts root partition metadata and narrows mutation writer tables", () => {
    const fn = scopedMutation({
      partition: userPartitionRoot,
      args: { userId: v.id("users"), lessonId: v.string() },
      handler: async (ctx, args) => {
        await ctx.db.insert("lessonProgress", {
          userId: args.userId,
          lessonId: args.lessonId,
        });
        // @ts-expect-error leaderboard is not colocated with the users partition scope.
        await ctx.db.insert("leaderboard", { userId: args.userId, score: 1 });
      },
    });

    expect(fn.partition).toEqual(userPartitionRoot);
    expect(JSON.parse(fn.exportPartition())).toEqual(userPartitionRoot);
  });
});
