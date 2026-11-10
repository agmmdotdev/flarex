import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { makeLocalProductCommands } from "../src/modules/product/service";
import { productCreationWorkflowInput } from "../src/workflows/product/create-input";
import { commerceDecoder } from "../src/value/decoder";

const product = await Effect.runPromise(makeLocalProductCommands());
const decode = commerceDecoder(productCreationWorkflowInput(product.metadata.product.table.columns.map(column => column.name)), "invalidInput");
const body = { title: "Native references", options: [{ title: "Size", values: ["One"] }] };

describe("native Product create reference admission", () => {
  it("admits native HTTP Tag/Category associations unchanged through the existing module contract", () => {
    const native = { ...body, tags: [{ id: "tag_existing" }], categories: [{ id: "pcat_existing" }] };
    expect(decode({ products: [native] })).toMatchObject({ _tag: "Success", success: { products: [
      expect.objectContaining({ tags: [{ id: "tag_existing" }], categories: [{ id: "pcat_existing" }] }),
    ] } });
    expect(Result.isSuccess(product.metadata.valueProfile.validateCreate(native))).toBe(true);
  });
  it.each(["tags", "categories"])("keeps the finite four-reference workflow bound for %s", relation => {
    const refs = Array.from({ length: 4 }, (_, index) => ({ id: "reference_" + index }));
    const native = { ...body, [relation]: refs };
    expect(Result.isSuccess(decode({ products: [native] }))).toBe(true);
    const over = { ...body, [relation]: [...refs, { id: "reference_extra" }] };
    expect(Result.isFailure(decode({ products: [over] }))).toBe(true);
  });
  it("preserves private ID arrays and refuses ambiguous or malformed references", () => {
    const ids = { ...body, tag_ids: ["tag_existing"], category_ids: ["pcat_existing"] };
    expect(Result.isSuccess(decode({ products: [ids] }))).toBe(true);
    expect(Result.isSuccess(product.metadata.valueProfile.validateCreate(ids))).toBe(true);
    for (const input of [
      { ...body, tags: [{ id: "tag_existing" }], tag_ids: ["tag_other"] },
      { ...body, categories: [{ id: "pcat_existing" }], category_ids: ["pcat_other"] },
    ]) expect(Result.isFailure(product.metadata.valueProfile.validateCreate(input))).toBe(true);
    for (const input of [
      { ...body, tags: [{ id: "" }] }, { ...body, categories: [{ id: 1 }] },
      { ...body, tags: [{ id: "tag_existing", value: "unexpected" }] },
    ]) expect(Result.isFailure(decode({ products: [input] }))).toBe(true);
  });
});
