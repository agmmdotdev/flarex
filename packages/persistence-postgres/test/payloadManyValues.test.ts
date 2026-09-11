import { expect, it } from "vitest";
import { Effect, Result } from "effect";
import { verifyApplicationManifestV3 } from "@flarex/analysis/application-analysis";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { payloadManyIds, makePayloadPopulation } from "../../payload-adapter/src/testing";
import { payloadScalarFields } from "../../payload-adapter/src/contract";
import { isOptionalPostRelationSuccessor } from "../src/applicationWriteOwnership/Successor";
import { policyManifestFixture } from "./applicationWritePolicyFixture";
import { payloadRelationManifest } from "./payloadRelationFixture";

const ids = Array.from({ length: 33 }, (_, i) => appDocumentIdV1FromRowIdentity({ tableId: CatalogTableIdSchema.make(2), rowId: decodeAppRowIdHexV1((i + 1).toString(16).padStart(32, "0")) }));

it("captures only dense, canonical, unique arrays within the private bound", () => {
  expect(Result.getOrThrow(payloadManyIds([]))).toEqual([]);
  expect(Result.getOrThrow(payloadManyIds(ids.slice(0, 32)))).toEqual(ids.slice(0, 32));
  for (const invalid of [null, undefined, new Array(1), [ids[0], ids[0]], [0], [{ id: ids[0] }], ["bad-id"], ids]) {
    expect(payloadManyIds(invalid)._tag).toBe("Failure");
  }
});

it("preserves old profile identities and refuses an implicit many successor", async () => {
  const scalar = (await policyManifestFixture(undefined, true, payloadScalarFields)).manifest;
  const one = (await payloadRelationManifest(scalar)).manifest;
  const many = (await payloadRelationManifest(scalar, true)).manifest;
  expect(isOptionalPostRelationSuccessor(scalar, one)).toBe(true);
  expect(isOptionalPostRelationSuccessor(scalar, many)).toBe(false);
  expect(isOptionalPostRelationSuccessor(one, many)).toBe(false);
  const relation = many.schema.relations[1];
  if (relation?.declaration.value.cardinality !== "many") throw new Error("Expected many declaration");
  for (const value of [{ ...relation.declaration.value, ordered: false }, { ...relation.declaration.value, maxItems: 33 }, { ...relation.declaration.value, minItems: 1 }]) {
    expect(await Effect.runPromise(verifyApplicationManifestV3({ ...many, schema: { ...many.schema,
      relations: [many.schema.relations[0], { ...relation, declaration: { ...relation.declaration, value } }] } }).pipe(Effect.result))).toMatchObject({ _tag: "Failure" });
  }
  expect(await Effect.runPromise(verifyApplicationManifestV3({ ...many, schema: { ...many.schema,
    tables: many.schema.tables.map(table => table.name === "posts" && table.validator.type === "object" ? { ...table,
      validator: { ...table.validator, value: { ...table.validator.value, relatedPosts: { optional: true, fieldType: { type: "array", value: { type: "id", tableName: "posts" } } } } } } : table) } }).pipe(Effect.result))).toMatchObject({ _tag: "Failure" });
});

it("bounds many population across fields and roots, including repeated output copies", () => {
  const maximum = makePayloadPopulation("payload.content-many");
  Result.getOrThrow(maximum.roots(Array.from({ length: 32 }, (_, i) => ({ id: String(i), relatedPost: ids[0] ?? null, relatedPosts: ids.slice(0, 32) }))));
  expect(maximum.outputBytes(ids.slice(0, 32), ids.slice(0, 32).map(id => ({ id, title: "x".repeat(2000) })))).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(makePayloadPopulation("payload.content-many").roots([{ id: "root", relatedPosts: ids.slice(0, 32), relatedPost: ids[32] ?? null }])).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  for (const relatedPosts of [null, ["a", "a"], [1], ids]) expect(makePayloadPopulation("payload.content-many").roots([{ id: "root", relatedPosts }])).toMatchObject({ _tag: "Failure" });
  expect(makePayloadPopulation("payload.content-many").roots([{ id: "root" }])).toMatchObject({ _tag: "Failure" });
  const counted = makePayloadPopulation("payload.content-many");
  Result.getOrThrow(counted.roots([{ id: "root", relatedPost: "a", relatedPosts: ["a"] }, { id: "other", relatedPosts: ["a"] }]));
  expect(Result.getOrThrow(counted.outputBytes(["a"], [{ id: "a", title: "xx" }])) - Result.getOrThrow(counted.outputBytes(["a"], [{ id: "a", title: "x" }]))).toBe(3);
});
