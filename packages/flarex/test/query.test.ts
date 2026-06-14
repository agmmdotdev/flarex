import { describe, expect, expectTypeOf, it } from "vitest";
import type { Id } from "../src/values";
import { createQueryInitializer, type QueryInitializer } from "../src/query";

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
});
