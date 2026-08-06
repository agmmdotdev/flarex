import { describe, expect, expectTypeOf, it } from "vitest";

import {
  FlarexError,
  flarexToJson,
  jsonToFlarex,
  type JSONValue,
  type Value,
} from "../src/index";

describe("public Flarex value facade", () => {
  it("exposes a standalone typed application error beside Value", () => {
    const error = new FlarexError(
      "RECIPE_NOT_FOUND",
      "Recipe was not found.",
      { recipeId: "recipes:missing" },
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(FlarexError);
    expect(error.name).toBe("FlarexError");
    expect(error.message).toBe("Recipe was not found.");
    expect(error.code).toBe("RECIPE_NOT_FOUND");
    expect(error.data).toEqual({ recipeId: "recipes:missing" });
    expectTypeOf(error.data).toEqualTypeOf<
      { recipeId: string } | undefined
    >();
  });

  it("exposes Convex-shaped value conversion without protocol version names", () => {
    const input = {
      id: "users:1",
      sequence: 7n,
      bytes: new Uint8Array([0, 1]).buffer,
      nul: "a\u0000b",
      omitted: undefined,
    } satisfies Value;

    const json = flarexToJson(input);
    const decoded = jsonToFlarex(json);

    expect(json).toEqual({
      bytes: { $bytes: "AAE=" },
      id: "users:1",
      nul: { $string: "YQBi" },
      sequence: { $integer: "BwAAAAAAAAA=" },
    });
    expect(decoded).toEqual({
      bytes: new Uint8Array([0, 1]).buffer,
      id: "users:1",
      nul: "a\u0000b",
      sequence: 7n,
    });
    expectTypeOf(decoded).toMatchTypeOf<Value>();
    expectTypeOf(flarexToJson).toEqualTypeOf<
      (value: Value) => JSONValue
    >();
    expectTypeOf(jsonToFlarex).toEqualTypeOf<
      (value: JSONValue) => Value
    >();

    if (false) {
      // @ts-expect-error Undefined is not a public Flarex value.
      flarexToJson(undefined);
      // @ts-expect-error Profile selection is protocol-internal.
      flarexToJson(null, "appDocument");
    }
  });
});
