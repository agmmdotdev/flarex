import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { expectTypeOf } from "vitest";

describe("generated Flarex API", () => {
  it("contains application function references", () => {
    expect(api.lessons.complete._path).toBe("lessons:complete");
  });

  it("lowers model table partitions into generated client metadata", () => {
    expect(api.lessons.complete._partition).toEqual({
      type: "partition",
      table: "users",
      selector: "byId",
      partitionField: "_id",
      argField: "userId",
    });
    expect(api.lessons.list._partition).toEqual(api.lessons.complete._partition);
  });

  it("generates document types from the schema", () => {
    const user = null as unknown as Doc<"users">;
    expect(user).toBeNull();
    expectTypeOf<MutationCtx["db"]["insert"]>().toBeFunction();
  });
});
