import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { prepareProductInlineImportInput, verifyProductInlineImportInput } from "../src/workflows/product/import-inline-input";

const input = { fileContent: "Product Title\nShirt\n", filename: "products.csv" };

describe("inline Product import Task input commitment", () => {
  it("captures the exact original body, including filename, and refuses changed retry input", async () => {
    const prepared = await Effect.runPromise(prepareProductInlineImportInput(input));
    expect(await Effect.runPromise(verifyProductInlineImportInput({ ...input }, prepared.reference))).toEqual(input);
    for (const changed of [{ ...input, filename: "other.csv" }, { ...input, fileContent: input.fileContent + "Other\n" }]) {
      expect(await Effect.runPromise(Effect.result(verifyProductInlineImportInput(changed, prepared.reference))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
    }
    expect(prepared.canonicalBytes.byteLength).toBe(prepared.reference.byteLength);
  });

  it("refuses getters, extra options and UTF8 byte overflow before native work", async () => {
    let reads = 0;
    const getter = Object.defineProperty({ filename: input.filename }, "fileContent", {
      enumerable: true, get() { reads++; return input.fileContent; },
    });
    for (const value of [getter, { ...input, fileKey: "upload.csv" },
      { ...input, filename: "က".repeat(86) }, { ...input, fileContent: "x".repeat(256 * 1024 + 1) }]) {
      expect(Result.isFailure(await Effect.runPromise(Effect.result(prepareProductInlineImportInput(value))))).toBe(true);
    }
    expect(reads).toBe(0);
  });
});
