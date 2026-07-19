import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeStableCatalogTableIdInputResult,
  validateStableCatalogNonBlankInputResult,
} from "../src/stableCatalogInputValidation";

describe("stable catalog input validation", () => {
  it("preserves accepted nonblank text without normalizing it", () => {
    const onInvalid = () => new Error("unexpected invalid text");

    expect(validateStableCatalogNonBlankInputResult(
      "  users  ",
      onInvalid,
    )).toEqual(Result.succeed("  users  "));
  });

  it("constructs the caller-owned text failure only when validation fails", () => {
    const failure = new Error("invalid catalog text");
    let constructionCount = 0;
    const result = validateStableCatalogNonBlankInputResult("\t\n", () => {
      constructionCount += 1;
      return failure;
    });

    expect(constructionCount).toBe(1);
    expect(result).toEqual(Result.fail(failure));
  });

  it("decodes protocol table IDs without constructing a success-path failure", () => {
    let constructionCount = 0;
    const result = decodeStableCatalogTableIdInputResult(1, () => {
      constructionCount += 1;
      return new Error("unexpected invalid table ID");
    });

    expect(constructionCount).toBe(0);
    expect(result).toEqual(Result.succeed(CatalogTableIdSchema.make(1)));
  });

  it("projects protocol table-ID parse failures through the caller callback", () => {
    const failure = new Error("invalid catalog table ID");
    const result = decodeStableCatalogTableIdInputResult(0, () => failure);

    expect(result).toEqual(Result.fail(failure));
  });
});
