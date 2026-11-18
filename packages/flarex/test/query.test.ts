import { describe, expect, expectTypeOf, it } from "vitest";
import type { Id } from "../src/values";
import { mutation, type AnyDataModel, type DocumentByName, type MutationCtx, type QueryCtx } from "flarex/server";
import { createQueryInitializer, type DatabaseQueryTerminal, type IndexRange, type QueryInitializer } from "../src/query";

type LessonProgress = {
  document: {
    _id: Id<"lessonProgress">;
    _creationTime: number;
    userId: Id<"users">;
    lessonId: string;
    completed: boolean;
  };
  fieldPaths: "_id" | "_creationTime" | "userId" | "lessonId" | "completed";
  indexes: {
    by_user: readonly ["userId"];
    by_user_lesson: readonly ["userId", "lessonId"];
  };
};

describe("query builder", () => {
  it("builds a lazy typed index query", async () => {
    const requests: unknown[] = [];
    const query: QueryInitializer<LessonProgress> = createQueryInitializer(
      "lessonProgress",
      async request => {
        requests.push(request);
        return { page: [{ lessonId: "intro" }], isDone: true, continueCursor: "cursor-1" };
      },
    );

    const documents = await query
      .withIndex("by_user_lesson", q =>
        q.eq("userId", "users:1" as Id<"users">).eq("lessonId", "intro"),
      )
      .take(5);

    expect(requests).toEqual([
      {
        table: "lessonProgress",
        index: "by_user_lesson",
        range: {
          expressions: [
            { op: "eq", field: "userId", value: "users:1" },
            { op: "eq", field: "lessonId", value: "intro" },
          ],
        },
        limit: 5,
      },
    ]);
    expectTypeOf(documents).toEqualTypeOf<Array<LessonProgress["document"]>>();
  });

  it("implements first and unique consumers", async () => {
    const one = createQueryInitializer<LessonProgress>("lessonProgress", async () => ({
      page: [{ lessonId: "intro" }],
      isDone: true,
      continueCursor: "cursor-1",
    }));
    await expect(one.withIndex("by_user").first()).resolves.toMatchObject({
      lessonId: "intro",
    });

    const many = createQueryInitializer<LessonProgress>("lessonProgress", async () => ({
      page: [{}, {}],
      isDone: true,
      continueCursor: "cursor-2",
    }));
    await expect(many.withIndex("by_user").unique()).rejects.toThrow(
      "Query returned more than one document.",
    );
  });

  it("builds prefix and inequality ranges in index order", async () => {
    const requests: unknown[] = [];
    const query = createQueryInitializer<LessonProgress>("lessonProgress", async request => {
      requests.push(request);
      return { page: [], isDone: true, continueCursor: "" };
    });

    await query
      .withIndex("by_user_lesson", q =>
        q.eq("userId", "users:1" as Id<"users">).gte("lessonId", "b").lt("lessonId", "m"),
      )
      .collect();

    expect(requests).toEqual([
      {
        table: "lessonProgress",
        index: "by_user_lesson",
        range: {
          expressions: [
            { op: "eq", field: "userId", value: "users:1" },
            { op: "gte", field: "lessonId", value: "b" },
            { op: "lt", field: "lessonId", value: "m" },
          ],
        },
      },
    ]);
  });

  it("builds ordered cursor pagination requests", async () => {
    const requests: unknown[] = [];
    const query = createQueryInitializer<LessonProgress>("lessonProgress", async request => {
      requests.push(request);
      return { page: [{ lessonId: "next" }], isDone: false, continueCursor: "cursor-2" };
    });

    const result = await query
      .withIndex("by_user")
      .order("desc")
      .paginate({ numItems: 2, cursor: "cursor-1" });

    expect(requests).toEqual([
      {
        table: "lessonProgress",
        index: "by_user",
        order: "desc",
        range: { expressions: [] },
        limit: 2,
        cursor: "cursor-1",
      },
    ]);
    expect(result).toEqual({
      page: [{ lessonId: "next" }],
      isDone: false,
      continueCursor: "cursor-2",
    });
  });
  it("admits the complete terminal through unique postprocessing", async () => {
    const events: string[] = [];
    const terminals: DatabaseQueryTerminal[] = [];
    const query = createQueryInitializer<LessonProgress>("lessonProgress", async (_request, terminal) => {
      if (terminal !== undefined) terminals.push(terminal);
      events.push("execute");
      return { page: [{}, {}], isDone: true, continueCursor: "end" };
    }, async operation => {
      events.push("admit");
      try { return await operation(); }
      catch (cause) { events.push("terminal-error"); throw cause; }
      finally { events.push("settled"); }
    });
    await expect(query.unique()).rejects.toThrow("more than one");
    expect(events).toEqual(["admit", "execute", "terminal-error", "settled"]);
    expect(terminals).toEqual([{ kind: "take", count: 2 }]);
  });

  it("does not fetch for take zero and rejects invalid limits before execution", async () => {
    let executions = 0;
    let admissions = 0;
    const query = createQueryInitializer<LessonProgress>("lessonProgress", async () => {
      executions++;
      return { page: [], isDone: true, continueCursor: "end" };
    }, operation => { admissions++; return operation(); });
    await expect(query.take(0)).resolves.toEqual([]);
    for (const count of [-1, 0.5, Infinity, NaN]) {
      await expect(query.take(count)).rejects.toThrow("nonnegative safe integer");
    }
    await expect(query.paginate({ numItems: 0, cursor: null })).rejects.toThrow("positive");
    expect(executions).toBe(0);
    expect(admissions).toBe(6);
  });

  it("keeps collection, limit and pagination terminal identities separate", async () => {
    const terminals: DatabaseQueryTerminal[] = [];
    const query = createQueryInitializer<LessonProgress>("lessonProgress", async (_request, terminal) => {
      if (terminal !== undefined) terminals.push(terminal);
      return { page: [], isDone: true, continueCursor: "end" };
    });
    await query.collect();
    await query.take(280);
    await query.first();
    await query.paginate({ numItems: 280, cursor: null });
    expect(terminals).toEqual([
      { kind: "collect" }, { kind: "take", count: 280 },
      { kind: "take", count: 1 }, { kind: "paginate", numItems: 280 },
    ]);
  });

  it("keeps trusted executor and terminal admission private across derived builders", async () => {
    let admissions = 0;
    let executions = 0;
    const query = createQueryInitializer<LessonProgress>("lessonProgress", async request => {
      executions++;
      expect(request.table).toBe("lessonProgress");
      return { page: [{ lessonId: "intro" }], isDone: true, continueCursor: "end" };
    }, operation => { admissions++; return operation(); });
    const derived = query.withIndex("by_user").order("desc");
    for (const builder of [query, derived]) {
      expect(Reflect.ownKeys(builder)).toEqual([]);
      for (const member of ["executor", "request", "terminalExecution", "execute"]) {
        expect(Reflect.get(builder, member)).toBeUndefined();
      }
      expect(Reflect.get(Object.getPrototypeOf(builder), "execute")).toBeUndefined();
      expect(() => Reflect.apply(builder.collect, Object.create(Object.getPrototypeOf(builder)), []))
        .toThrow(TypeError);
    }
    expect(executions).toBe(0);
    expect(admissions).toBe(0);
    Reflect.set(derived, "executor", () => { throw new Error("exposed executor used"); });
    Reflect.set(derived, "terminalExecution", () => { throw new Error("exposed wrapper used"); });
    Reflect.set(derived, "request", { table: "other" });
    Reflect.set(derived, "execute", () => { throw new Error("exposed helper used"); });
    await expect(derived.take(1)).resolves.toEqual([{ lessonId: "intro" }]);
    expect(executions).toBe(1);
    expect(admissions).toBe(1);
  });

  it("reuses initializers while consuming derived terminal aliases", async () => {
    let executions = 0;
    const initializer = createQueryInitializer<LessonProgress>("lessonProgress", async () => {
      executions++;
      return { page: [], isDone: true, continueCursor: "end" };
    });
    await initializer.take(1);
    await initializer.take(1);
    const query = initializer.withIndex("by_user");
    const alias = query;
    await query.take(1);
    await expect(alias.take(1)).rejects.toThrow("only be chained once");
    await expect(alias.collect()).rejects.toThrow("chained with another operator");
    const collected = initializer.withIndex("by_user");
    const pending = collected.collect();
    await expect(collected.collect()).rejects.toThrow("Iteration can only begin");
    await pending;
    await expect(collected.collect()).rejects.toThrow("closed and can't emit");
    expect(executions).toBe(4);
  });

  it("consumes each order chain once and preserves validation before consumption", async () => {
    let executions = 0;
    const initializer = createQueryInitializer<LessonProgress>("lessonProgress", async () => {
      executions++;
      return { page: [], isDone: true, continueCursor: "end" };
    });
    const query = initializer.withIndex("by_user");
    expect(() => Reflect.apply(query.order, query, [undefined])).toThrow(TypeError);
    const ordered = query.order("asc");
    expect(() => query.order("desc")).toThrow("only be chained once");
    expect(() => ordered.order("desc")).toThrow("order at most once");
    await expect(ordered.take(1)).rejects.toThrow("only be chained once");
    const invalid = initializer.withIndex("by_user");
    await expect(invalid.take(-1)).rejects.toThrow("nonnegative safe integer");
    await invalid.take(1);
    await expect(invalid.take(-1)).rejects.toThrow("nonnegative safe integer");
    const zero = initializer.withIndex("by_user");
    await expect(zero.take(0)).resolves.toEqual([]);
    await expect(zero.take(0)).rejects.toThrow("only be chained once");
    expect(executions).toBe(1);
  });

  it.each(["eq", "gt", "gte", "lt", "lte"])("consumes %s range aliases and rejects discarded chains", op => {
    const initializer = createQueryInitializer<LessonProgress>("lessonProgress", async () => {
      throw new Error("invalid builder reached executor");
    });
    expect(() => initializer.withIndex("by_user", builder => {
      Reflect.apply(Reflect.get(builder, op), builder, ["userId", "users:1"]);
      return builder;
    })).toThrow("IndexRangeBuilder has already been used");
  });

  it("exports only a real unused range builder once", () => {
    const initializer = createQueryInitializer<LessonProgress>("lessonProgress", async () => {
      throw new Error("invalid builder reached executor");
    });
    let exported: () => IndexRange = () => { throw new Error("missing builder"); };
    initializer.withIndex("by_user", builder => {
      const range = builder.eq("userId", "users:1" as Id<"users">);
      exported = () => range;
      return range;
    });
    expect(() => initializer.withIndex("by_user", () => exported())).toThrow("already been used");
    for (const forged of [undefined, { expressions: [] }]) {
      expect(() => Reflect.apply(initializer.withIndex, initializer, ["by_user", () => forged]))
        .toThrow("must return its chained range builder");
    }
    expect(() => initializer.withIndex("by_user", builder => {
      builder.eq("userId", "users:1" as Id<"users">);
      return builder;
    })).toThrow("already been used");
  });

  it("captures bound operands when each builder operation is accepted", async () => {
    type Operands = {
      document: { object: { nested: { value: string } }; bytes: ArrayBuffer; optional?: string };
      fieldPaths: "object" | "bytes" | "optional";
      indexes: { by_object: readonly ["object"]; by_bytes: readonly ["bytes"]; by_optional: readonly ["optional"] };
    };
    const requests: unknown[] = [];
    const initializer = createQueryInitializer<Operands>("operands", async request => {
      requests.push(request);
      return { page: [], isDone: true, continueCursor: "end" };
    });
    const object = { nested: { value: "original" } };
    const objectQuery = initializer.withIndex("by_object", builder => {
      const result = builder.eq("object", object);
      object.nested.value = "changed before export";
      return result;
    });
    object.nested.value = "changed before terminal";
    await objectQuery.collect();
    const bytes = new Uint8Array([1, 2]);
    const byteQuery = initializer.withIndex("by_bytes", builder => builder.eq("bytes", bytes.buffer));
    bytes[0] = 9;
    await byteQuery.collect();
    await initializer.withIndex("by_optional", builder => builder.eq("optional", undefined)).collect();
    expect(requests).toEqual([
      { table: "operands", index: "by_object", range: { expressions: [{ op: "eq", field: "object", value: { nested: { value: "original" } } }] } },
      { table: "operands", index: "by_bytes", range: { expressions: [{ op: "eq", field: "bytes", value: new Uint8Array([1, 2]).buffer }] } },
      { table: "operands", index: "by_optional", range: { expressions: [{ op: "eq", field: "optional", value: undefined }] } },
    ]);
  });

  it("consumes the predecessor before rejecting an invalid bound without invoking getters", () => {
    const initializer = createQueryInitializer<LessonProgress>("lessonProgress", async () => {
      throw new Error("invalid builder reached executor");
    });
    let getters = 0;
    const invalid = { get value() { getters++; return "untrusted"; } };
    expect(() => initializer.withIndex("by_user", builder => {
      expect(() => Reflect.apply(builder.eq, builder, ["userId", invalid])).toThrow();
      expect(() => builder.eq("userId", "users:1" as Id<"users">)).toThrow("already been used");
      return builder;
    })).toThrow("already been used");
    expect(getters).toBe(0);
  });

  it("types the public default mutation and query contexts with a generic first range field", () => {
    const registered = mutation(async ctx => {
      expectTypeOf(ctx).toEqualTypeOf<MutationCtx>();
      return ctx.db.query("users").withIndex("by_name", builder => {
        const range = builder.eq("name", "Ada");
        expectTypeOf(range).toEqualTypeOf<IndexRange>();
        // @ts-expect-error The pinned generic string[] range ends after its first equality.
        range.eq("other", "value");
        return range;
      }).collect();
    });
    expect(registered.isMutation).toBe(true);
    const publicQuery = (ctx: QueryCtx) => ctx.db.query("users")
      .withIndex("by_name", builder => builder.gte("name", "A").lte("name", "Z"))
      .collect();
    expectTypeOf<ReturnType<typeof publicQuery>>()
      .toEqualTypeOf<Promise<Array<DocumentByName<AnyDataModel, "users">>>>();
  });

  it("preserves tuple field order, value types and bound exhaustion in public typed contexts", () => {
    const publicQuery = (ctx: QueryCtx<{ lessonProgress: LessonProgress }>) =>
      ctx.db.query("lessonProgress").withIndex("by_user_lesson", builder => {
        // @ts-expect-error The first tuple field is userId.
        builder.eq("lessonId", "intro");
        // @ts-expect-error userId requires a users ID.
        builder.eq("userId", 1);
        const prefix = builder.eq("userId", "users:1" as Id<"users">);
        // @ts-expect-error The remaining tuple field is lessonId.
        prefix.gte("userId", "users:1" as Id<"users">);
        // @ts-expect-error A non-null lessonId bound requires a string.
        prefix.gte("lessonId", null);
        const lower = prefix.gte("lessonId", "a");
        // @ts-expect-error A lower bound exposes only the upper bound operations.
        lower.gte("lessonId", "b");
        // @ts-expect-error The upper bound must use the same remaining tuple field.
        lower.lt("userId", "users:1" as Id<"users">);
        const complete = prefix.eq("lessonId", "intro");
        expectTypeOf(complete).toEqualTypeOf<IndexRange>();
        // @ts-expect-error The concrete tuple is exhausted after both equalities.
        complete.eq("lessonId", "again");
        const range = lower.lt("lessonId", "z");
        expectTypeOf(range).toEqualTypeOf<IndexRange>();
        return range;
      }).collect();
    expectTypeOf<ReturnType<typeof publicQuery>>().toEqualTypeOf<Promise<Array<LessonProgress["document"]>>>();
  });

});
