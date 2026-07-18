import { describe, expect, it } from "vitest";

import { observeDrizzleQuery } from "../src/drizzleQueryObservation";

describe("observeDrizzleQuery", () => {
  it("does not compile a query when no observer is present", () => {
    let compileCount = 0;
    const toSQL = () => {
      compileCount += 1;
      return { sql: "select 1", params: [] };
    };

    expect(observeDrizzleQuery("clock", { toSQL }, undefined)).toBeUndefined();
    expect(compileCount).toBe(0);
  });

  it("captures one frozen observation with detached parameters", () => {
    const nested = { scopeId: "scope_original" };
    const params: ReadonlyArray<unknown> = [nested];
    let observation: unknown;

    observeDrizzleQuery(
      "clock",
      { toSQL: () => ({ sql: "select $1", params }) },
      (captured) => {
        observation = captured;
      },
    );
    nested.scopeId = "scope_mutated";

    expect(observation).toEqual({
      name: "clock",
      sql: "select $1",
      params: [{ scopeId: "scope_original" }],
    });
    expect(Object.isFrozen(observation)).toBe(true);
    if (
      typeof observation !== "object" ||
      observation === null ||
      !("params" in observation)
    ) {
      throw new Error("Expected a query observation with parameters.");
    }
    expect(Object.isFrozen(observation.params)).toBe(true);
  });

  it("preserves synchronous compiler and observer failures", () => {
    const compilerFailure = new Error("compile failed");
    expect(() => observeDrizzleQuery(
      "clock",
      {
        toSQL: () => {
          throw compilerFailure;
        },
      },
      () => undefined,
    )).toThrow(compilerFailure);

    const observerFailure = new Error("observer failed");
    expect(() => observeDrizzleQuery(
      "clock",
      { toSQL: () => ({ sql: "select 1", params: [] }) },
      () => {
        throw observerFailure;
      },
    )).toThrow(observerFailure);
  });
});
