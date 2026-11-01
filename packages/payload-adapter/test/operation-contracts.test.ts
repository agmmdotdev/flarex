import { expect, expectTypeOf, it } from "vitest";
import { Effect, Result } from "effect";
import { cmsLimits } from "@flarex/persistence-postgres/internal/cms-adapter";
import { decodePayloadPaging, makePayloadQuery } from "../src/query";
import { payloadCanonicalResults, payloadResults, type PayloadCountResult, type PayloadDocument, type PayloadPageResult } from "../src/results";
import { isJsonObject } from "flarex-protocol/json";
import type { PayloadCreateInput, PayloadUpdateInput, PayloadFindByIdInput } from "../src/inputs";
import { payloadIsManagedField, payloadRelatedPostsField, type PayloadContentProfile } from "../src/contract";
import { payloadPostsCollection, payloadContentFields, payloadScalarConfiguration } from "../src/testing/profiles";
import { makePayloadCollectionRuntime } from "../src/collectionRuntime";
import type { PayloadRuntime, PayloadHost, PayloadReadHost, PayloadCreateArgs } from "../src/runtime";
import { compilePayloadCollections } from "../src/collections";
import { makePayloadConformanceRuntime, inspectPayloadRuntimeForTest } from "../src/testing";

const collection = makePayloadCollectionRuntime(payloadScalarConfiguration.tables[0]!);
const { decode: decodePayloadWhere, adapter: payloadAdapterWhere } = makePayloadQuery(collection);

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
  expect(Result.getOrThrow(decodePayloadPaging({ page: 257, limit: cmsLimits.pageRows, pagination: false })))
    .toEqual({ page: 257, limit: cmsLimits.pageRows, pagination: false });
  for (const unsupported of [{ limit: 0 }, { limit: cmsLimits.pageRows + 1 }, { page: 258 }, { page: 0 }, { page: 1.5 }, { sort: ["id"] }]) {
    expect(Result.isFailure(decodePayloadPaging(unsupported))).toBe(true);
  }
});

it("derives equality from each collection's declared unique field, including absence", () => {
  const other = makePayloadQuery({ logicalTableName: "inventory", collectionSlug: "inventory", timestamps: true,
    fields: [{ name: "sku", kind: "text", unique: true }] });
  expect(Result.getOrThrow(other.adapter({ and: [{ sku: { equals: "one" } }] }))).toEqual({ sku: "one" });
  expect(Result.isFailure(other.decode({ title: { equals: "one" } }))).toBe(true);
  const plain = makePayloadQuery({ logicalTableName: "notes", collectionSlug: "notes", timestamps: true,
    fields: [{ name: "label", kind: "text" }] });
  expect(Result.getOrThrow(plain.decode({ id: { equals: "identity" } }))).toEqual({ id: { equals: "identity" } });
  expect(Result.isFailure(plain.decode({ label: { equals: "one" } }))).toBe(true);
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

it("projects a fresh mutable populated tree from an immutable saved native result", () => {
  const original = { id: "post", author: { id: "author", name: "Ada" }, relatedPosts: [{ id: "target", labels: ["original"] }] };
  const canonical = Result.getOrThrow(payloadResults.document(original));
  expect(Object.isFrozen(canonical.author)).toBe(true);
  expect(Object.isFrozen(canonical.relatedPosts)).toBe(true);
  const first = Result.getOrThrow(payloadCanonicalResults.document(canonical));
  if (first.author === undefined || !isJsonObject(first.author) || !Array.isArray(first.relatedPosts) || !isJsonObject(first.relatedPosts[0])
    || !Array.isArray(first.relatedPosts[0].labels)) throw new Error("Missing populated caller result");
  expect(Reflect.set(first.author, "name", "Caller changed")).toBe(true);
  first.relatedPosts[0].labels.push("caller label");
  first.relatedPosts.push({ id: "caller-added" });
  expect(canonical).toEqual(original);
  const replayed = Result.getOrThrow(payloadCanonicalResults.document(canonical));
  expect(replayed).toEqual(original);
  expect(replayed.author).not.toBe(first.author);
  expect(replayed.relatedPosts).not.toBe(first.relatedPosts);
});

it("detaches page documents and arrays independently on each Local API projection", () => {
  const canonical = Result.getOrThrow(payloadResults.page({ docs: [{ id: "post", author: { id: "author", name: "Ada" } }],
    totalDocs: 1, limit: 10, totalPages: 1, page: 1, pagingCounter: 1, hasPrevPage: false, hasNextPage: false, prevPage: null, nextPage: null }));
  const first = Result.getOrThrow(payloadCanonicalResults.page(canonical));
  const author = first.docs[0]?.author;
  if (author === undefined || !isJsonObject(author)) throw new Error("Missing populated page document");
  expect(Reflect.set(author, "name", "Page caller changed")).toBe(true);
  expect(Reflect.set(first.docs, "0", { id: "replacement" })).toBe(true);
  expect(Reflect.set(first.docs, "length", 0)).toBe(true);
  const second = Result.getOrThrow(payloadCanonicalResults.page(canonical));
  expect(second).toEqual(canonical);
  expect(second.docs).not.toBe(first.docs);
  expect(canonical.docs).toHaveLength(1);
  const count = Result.getOrThrow(payloadResults.count({ totalDocs: 1 }));
  const callerCount = Result.getOrThrow(payloadCanonicalResults.count(count));
  expect(Reflect.set(callerCount, "totalDocs", 99)).toBe(true);
  expect(Result.getOrThrow(payloadCanonicalResults.count(count))).toEqual({ totalDocs: 1 });
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

it("derives the conformance profile from configured collections and refuses a supplied mismatch", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const compiled = yield* compilePayloadCollections([
      { slug: "authors", fields: [{ name: "name", type: "text", required: true }] },
      { slug: "articles", fields: [{ name: "headline", type: "text", required: true },
        { name: "author", type: "relationship", relationTo: "authors" }] },
    ]);
    const configured = yield* makePayloadConformanceRuntime(undefined, compiled);
    expect(inspectPayloadRuntimeForTest(configured.runtime).commands.create).toBeDefined();
    expect(configured.observations.executions()).toBe(0);
    expect(yield* Effect.flip(makePayloadConformanceRuntime("payload.scalar", compiled))).toMatchObject({ reason: "invalidAuthority" });
  })));
});

it("preserves operation argument and result types at the JSON boundary", () => {
  const create: PayloadCreateInput = { collection, data: { title: "example" } };
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

it("binds direct readers without write capabilities", () => {
  type ReadHost = Effect.Success<ReturnType<PayloadRuntime["bindRead"]>>;
  expectTypeOf<ReadHost>().toEqualTypeOf<PayloadReadHost>();
  // @ts-expect-error Direct readers cannot execute write commands.
  expectTypeOf<ReadHost["run"]>();
  // @ts-expect-error Direct readers cannot create write request keys.
  expectTypeOf<ReadHost["newRequestKey"]>();
});

it("issues bound operation contracts without construction bags or command tokens", () => {
  type Host = Effect.Success<ReturnType<PayloadRuntime["bind"]>>;
  expectTypeOf<Host>().toEqualTypeOf<PayloadHost>();
  expectTypeOf<PayloadCreateArgs["collection"]>().toEqualTypeOf<string>();
  expectTypeOf<Effect.Success<ReturnType<Host["create"]>>>().toEqualTypeOf<PayloadDocument>();
  expectTypeOf<Effect.Success<ReturnType<Host["update"]>>>().toEqualTypeOf<PayloadDocument>();
  expectTypeOf<Effect.Success<ReturnType<Host["delete"]>>>().toEqualTypeOf<PayloadDocument>();
  expectTypeOf<Effect.Success<ReturnType<Host["find"]>>>().toEqualTypeOf<PayloadPageResult>();
  expectTypeOf<Effect.Success<ReturnType<Host["count"]>>>().toEqualTypeOf<PayloadCountResult>();
  // @ts-expect-error Ordinary runtimes select native commands privately.
  expectTypeOf<PayloadRuntime["commands"]>();
  // @ts-expect-error A bound host has no generic execution dispatcher.
  expectTypeOf<Host["run"]>();
  // @ts-expect-error Callers provide the collection slug, not an internal decoded collection.
  const decoded: PayloadCreateArgs = { collection, data: { title: "example" } };
  // @ts-expect-error A construction bag has no CMS issuer identity.
  const construction: Parameters<PayloadRuntime["bind"]>[0] = { database: {} };
  void decoded;
  void construction;
});
