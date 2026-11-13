import { Cause, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { strictSchemaGuard } from "../src/strict-schema-options";

describe("strict wire membership", () => {
  it("rejects extra root and nested fields while retaining declared rest fields", () => {
    const guard = strictSchemaGuard(Schema.Struct({ nested: Schema.Struct({ id: Schema.String }),
      labels: Schema.Record(Schema.String, Schema.String) }));
    expect(guard({ nested: { id: "one" }, labels: { custom: "kept" } })).toBe(true);
    expect(guard({ nested: { id: "one", authority: true }, labels: {} })).toBe(false);
    expect(guard({ nested: { id: "one" }, labels: {}, authority: true })).toBe(false);
  });
  it("checks the decoded side without accepting the encoded representation", () => {
    const guard = strictSchemaGuard(Schema.FiniteFromString);
    expect(guard(42)).toBe(true);
    expect(guard("42")).toBe(false);
  });
  it("retains defects from checks rather than returning false", () => {
    const defect = new Error("broken wire check");
    const guard = strictSchemaGuard(Schema.String.check(Schema.makeFilter(() => { throw defect; })));
    try { guard("input"); throw new Error("Expected the check defect"); }
    catch (error: unknown) {
      if (!(error instanceof Error) || !Cause.isCause(error.cause)) throw error;
      const reason = error.cause.reasons.find(Cause.isDieReason);
      expect(reason?.defect).toBe(defect);
    }
  });
});
