import { describe, expect, expectTypeOf, it } from "vitest";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  workflowMutation,
  type AuthConfig,
  type AuthProvider,
  type CustomJwtAuthProvider,
  type DefaultFunctionArgs,
  type FunctionReference,
  type MutationBuilder,
  type OidcAuthProvider,
  type UserIdentity,
} from "../src/server";
import type { Auth } from "../src/auth";
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

declare const internalUserQuery: FunctionReference<
  "query",
  "internal",
  { userId: Id<"users"> },
  { name: string }
>;
declare const internalNoArgsQuery: FunctionReference<"query", "internal", {}, number>;
declare const internalUserMutation: FunctionReference<
  "mutation",
  "internal",
  { userId: Id<"users">; name: string },
  null
>;
declare const internalNoArgsMutation: FunctionReference<"mutation", "internal", {}, null>;
declare const internalUserAction: FunctionReference<
  "action",
  "internal",
  { userId: Id<"users"> },
  null
>;

describe("Convex-style function registration", () => {
  it("exports Convex-style auth config types from flarex/server", () => {
    const oidcProvider = {
      domain: "https://auth.example.com",
      applicationID: "flarex-app",
    } satisfies OidcAuthProvider;
    const customJwtProvider = {
      type: "customJwt",
      issuer: "https://issuer.example.com",
      jwks: "https://issuer.example.com/.well-known/jwks.json",
      algorithm: "RS256",
      applicationID: "flarex-custom",
    } satisfies CustomJwtAuthProvider;
    const authConfig = {
      providers: [oidcProvider, customJwtProvider],
    } satisfies AuthConfig;

    expect(authConfig.providers).toHaveLength(2);
    expectTypeOf(oidcProvider).toMatchTypeOf<AuthProvider>();
    expectTypeOf(customJwtProvider).toMatchTypeOf<AuthProvider>();
  });

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

  it("types server-side function calls like Convex contexts", () => {
    query({
      args: { userId: v.id("users") },
      handler: async (ctx, args) => {
        expectTypeOf(ctx.auth).toEqualTypeOf<Auth>();
        const identity = await ctx.auth.getUserIdentity();
        expectTypeOf(identity).toEqualTypeOf<UserIdentity | null>();
        const user = await ctx.runQuery(internalUserQuery, { userId: args.userId });
        const count = await ctx.runQuery(internalNoArgsQuery);
        expectTypeOf(user).toEqualTypeOf<{ name: string }>();
        expectTypeOf(count).toEqualTypeOf<number>();
        // @ts-expect-error Argful queries require an args object.
        await ctx.runQuery(internalUserQuery);
        // @ts-expect-error Query contexts cannot run mutations.
        await ctx.runMutation(internalUserMutation, {
          userId: args.userId,
          name: user.name,
        });
        return user;
      },
    });

    mutation({
      args: { userId: v.id("users"), name: v.string() },
      handler: async (ctx, args) => {
        await ctx.runQuery(internalUserQuery, { userId: args.userId });
        await ctx.runQuery(internalNoArgsQuery);
        await ctx.runMutation(internalUserMutation, args);
        await ctx.runMutation(internalNoArgsMutation);
        // @ts-expect-error Argful mutations require an args object.
        await ctx.runMutation(internalUserMutation);
        // @ts-expect-error runMutation only accepts mutation references.
        await ctx.runMutation(internalUserAction, { userId: args.userId });
      },
    });

    action({
      args: { userId: v.id("users"), name: v.string() },
      handler: async (ctx, args) => {
        await ctx.runQuery(internalUserQuery, { userId: args.userId });
        await ctx.runQuery(internalNoArgsQuery);
        await ctx.runMutation(internalUserMutation, args);
        await ctx.runMutation(internalNoArgsMutation);
        // @ts-expect-error runQuery only accepts query references.
        await ctx.runQuery(internalUserMutation, args);
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

  it("rejects numeric literals when the schema is authored", () => {
    for (
      const value of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        -0,
      ]
    ) {
      expect(() => v.literal(value)).toThrowError(
        "Application numeric validator literals must be finite and not negative zero.",
      );
    }
  });

  it("rejects forged validator metadata during function registration export", () => {
    const malformed = {
      isFlarexValidator: true,
      isOptional: "required",
      json: { type: "not-a-validator" },
    };
    const fn = query({
      // @ts-expect-error Deliberately exercise an untyped JavaScript caller.
      args: { value: malformed },
      handler: async () => null,
    });

    expect(() => fn.exportArgs()).toThrow(
      "$validator.value.json: Invalid validator JSON.",
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
