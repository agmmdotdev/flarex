import { standardV1 } from "@flarex/standard-application-definition/internal/legacy-authoring";
import { v } from "flarex/values";
import { describe, expect, it } from "vitest";

describe("application schema authoring conformance", () => {
  it("emits identical protocol metadata from public and Standard validators", () => {
    const publicValidator = v.object({
      ownerId: v.id("users"),
      title: v.string(),
      rank: v.number(),
      tags: v.array(v.string()),
      attributes: v.record(v.string(), v.boolean()),
      state: v.union(v.literal("draft"), v.literal("published")),
      note: v.optional(v.nullable(v.string())),
    });
    const standardValidator = standardV1.object({
      ownerId: standardV1.id("users"),
      title: standardV1.string(),
      rank: standardV1.number(),
      tags: standardV1.array(standardV1.string()),
      attributes: standardV1.record(standardV1.string(), standardV1.boolean()),
      state: standardV1.union(
        standardV1.literal("draft"),
        standardV1.literal("published"),
      ),
      note: standardV1.optional(standardV1.nullable(standardV1.string())),
    });

    expect(publicValidator.json).toEqual(standardValidator.json);
    expect(Object.isFrozen(publicValidator.json)).toBe(true);
    expect(Object.isFrozen(standardValidator.json)).toBe(true);
  });

  it("rejects the same invalid authoring inputs at both facades", () => {
    for (const makeLiteral of [v.literal, standardV1.literal]) {
      expect(() => makeLiteral(Number.NaN)).toThrow(RangeError);
      expect(() => makeLiteral(Number.POSITIVE_INFINITY)).toThrow(RangeError);
      expect(() => makeLiteral(-0)).toThrow(RangeError);
    }
    for (const makeId of [v.id, standardV1.id]) {
      expect(() => makeId("")).toThrow(RangeError);
    }
  });
});
