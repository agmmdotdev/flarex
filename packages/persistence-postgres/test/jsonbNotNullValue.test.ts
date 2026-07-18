import { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { jsonbNotNullValue } from "../src/jsonbNotNullValue";

describe("jsonbNotNullValue", () => {
  it("preserves every non-null input by identity", () => {
    const values: ReadonlyArray<unknown> = [
      undefined,
      false,
      0,
      -0,
      "",
      { kind: "object" },
      ["array"],
    ];

    for (const value of values) {
      expect(jsonbNotNullValue(value)).toBe(value);
    }
  });

  it("creates a fresh PostgreSQL JSON null literal", () => {
    const first = jsonbNotNullValue(null);
    const second = jsonbNotNullValue(null);

    expect(first).toBeInstanceOf(SQL);
    expect(second).toBeInstanceOf(SQL);
    expect(second).not.toBe(first);
    if (!(first instanceof SQL)) {
      throw new Error("Expected a Drizzle SQL value");
    }

    expect(new PgDialect().sqlToQuery(first)).toEqual({
      sql: "'null'::jsonb",
      params: [],
    });
  });
});
