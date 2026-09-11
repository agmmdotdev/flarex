import { expect, expectTypeOf, it } from "vitest";
import { Result } from "effect";
import { decodePayloadPaging, decodePayloadWhere, payloadAdapterWhere } from "../src/query";
import { payloadResults, type PayloadCountResult, type PayloadDocument, type PayloadPageResult } from "../src/results";
import type { PayloadCreateInput, PayloadUpdateInput, PayloadFindByIdInput } from "../src/inputs";
import { payloadContentFields, payloadIsManagedField, payloadRelatedPostsField, type PayloadContentProfile } from "../src/contract";
import { payloadPostsCollection } from "../src/profile";

it("keeps caller equality and sanitized adapter filters distinct", () => {
  const where = { title: { equals: "example" } };
  expect(Result.getOrThrow(decodePayloadWhere(where))).toEqual(where);
  expect(Result.getOrThrow(payloadAdapterWhere({ and: [where] }))).toEqual({ title: "example" });
  expect(Result.isFailure(decodePayloadWhere({ and: [where] }))).toBe(true);
  for (const unsupported of [{ id: { in: ["one"] } }, { title: { contains: "one" } },
    { title: { equals: "one", extra: true } }, { score: { equals: "one" } }]) {
    expect(Result.isFailure(decodePayloadWhere(unsupported))).toBe(true);
    expect(Result.isFailure(payloadAdapterWhere({ and: [unsupported] }))).toBe(true);
  }
  expect(Result.isFailure(payloadAdapterWhere({ and: [where, where] }))).toBe(true);
});

it("preserves the same bounded caller paging policy", () => {
  expect(Result.getOrThrow(decodePayloadPaging({ page: 257, limit: 32, pagination: false })))
    .toEqual({ page: 257, limit: 32, pagination: false });
  for (const unsupported of [{ limit: 0 }, { limit: 33 }, { page: 258 }, { page: 0 }, { page: 1.5 }, { sort: ["id"] }]) {
    expect(Result.isFailure(decodePayloadPaging(unsupported))).toBe(true);
  }
});

it("retains populated output with detached ownership and checks result envelopes", () => {
  const original = { id: "post", relatedPosts: [{ id: "target", title: "before" }] };
  const captured = Result.getOrThrow(payloadResults.document(original));
  for (const related of original.relatedPosts) related.title = "after";
  expect(captured.relatedPosts).toEqual([{ id: "target", title: "before" }]);
  expect(Result.isFailure(payloadResults.document({ title: "missing identity" }))).toBe(true);
  expect(Result.isFailure(payloadResults.page({ docs: [], totalDocs: 0 }))).toBe(true);
  expect(Result.getOrThrow(payloadResults.count({ totalDocs: 0 }))).toEqual({ totalDocs: 0 });
});

it("keeps the admitted field metadata aligned with the native collection", () => {
  const profiles: PayloadContentProfile[] = ["payload.scalar", "payload.content-relations", "payload.content-many", "payload.content-joins"];
  for (const profile of profiles) {
    const collection = payloadPostsCollection(profile);
    for (const field of payloadContentFields(profile)) {
      if (payloadIsManagedField(field.name)) continue;
      const native = collection.fields.find(candidate => "name" in candidate && candidate.name === field.name);
      expect(native).toMatchObject({ type: field.kind === "boolean" ? "checkbox" : field.kind });
      if (field.name === "relatedPosts") expect(native).toMatchObject({ maxRows: payloadRelatedPostsField.maxItems, defaultValue: [] });
    }
  }
});

it("preserves operation argument and result types at the JSON boundary", () => {
  const create: PayloadCreateInput = { data: { title: "example" } };
  // @ts-expect-error update requires an identity even when create accepts the data
  const update: PayloadUpdateInput = create;
  // @ts-expect-error a decoded identity cannot be a number
  const byId: PayloadFindByIdInput = { id: 1, depth: 0, where: {}, joins: { referencedBy: false, referencedByMany: false }, joinRead: false };
  void update;
  void byId;
  expectTypeOf<PayloadDocument["id"]>().toEqualTypeOf<string>();
  expectTypeOf<PayloadPageResult["docs"][number]>().toEqualTypeOf<PayloadDocument>();
  expectTypeOf<PayloadCountResult["totalDocs"]>().toEqualTypeOf<number>();
});
