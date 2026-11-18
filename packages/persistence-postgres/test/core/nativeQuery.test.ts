import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import { encodeDocumentId } from "flarex-protocol/document-id";
import type { CoreTableDefinition } from "../../src/core/api";
import { makeCoreNativeDefinition } from "../../src/core/nativePolicy";
import { captureCoreNativeWhere, planCoreNativeQuery, prepareCoreNativePredicate } from "../../src/core/nativeQuery";

async function table(): Promise<CoreTableDefinition> {
  const definition = await Effect.runPromise(Effect.gen(function* () {
    const compiled = yield* compilePayloadCollections([{ slug: "items", fields: [
      { name: "title", type: "text", required: true, unique: true },
      { name: "alias", type: "text", unique: true },
      { name: "category", type: "text", required: true },
      { name: "amount", type: "number", index: true },
    ], indexes: [{ fields: ["category", "amount"], unique: true }] }]);
    return yield* makeCoreNativeDefinition({ source: compiled.sourceContract,
      scopeUuid: "11111111-1111-4111-8111-111111111111", epochUuid: "22222222-2222-4222-8222-222222222222" });
  }));
  const selected = definition.tables[0], schema = definition.schema.tables[0];
  if (selected === undefined || schema === undefined) throw new Error("Missing genuine source table");
  return { name: selected.name, number: 10001, tabletId: new Uint8Array(16), namespace: null, state: "active",
    nativePolicy: { state: "active", identity: definition.identity,
      schemaId: Result.getOrThrow(encodeDocumentId(532, new Uint8Array(16))), applicationRead: false,
      uniqueConstraints: selected.uniqueConstraints },
    indexes: schema.indexes.map((index, position) => ({ name: index.indexDescriptor, fields: index.fields,
      ref: { id: Uint8Array.of(position + 1) } })) };
}

describe("native scalar query policy", () => {
  it("selects ID before full unique tuples and preserves nullable uniqueness as ordinary indexed membership", async () => {
    const selected = await table();
    const plan = (where: Parameters<typeof captureCoreNativeWhere>[0]) =>
      Result.getOrThrow(planCoreNativeQuery(selected, Result.getOrThrow(captureCoreNativeWhere(where))));
    expect(plan({ _id: "point", title: "title" })).toMatchObject({ kind: "id", id: "point" });
    expect(plan({ title: "title", category: "red", amount: 10 })).toMatchObject({ kind: "unique", values: ["title"] });
    expect(plan({ category: "red", amount: 10 })).toMatchObject({ kind: "unique", values: ["red", 10] });
    expect(plan({ category: "red", amount: null })).toMatchObject({ kind: "range" });
    expect(plan({ alias: null })).toMatchObject({ kind: "range" });
    expect(plan({ amount: { gte: 10, lt: 20 }, category: "red" })).toMatchObject({ kind: "range",
      index: { fields: ["category", "amount"] } });
  });

  it("keeps residual encodings lazy and preserves ordered short-circuit failures", () => {
    const where = Result.getOrThrow(captureCoreNativeWhere({ category: "red", amount: { gte: "\ud800" } }));
    const matches = prepareCoreNativePredicate(where);
    expect(Result.getOrThrow(matches({ category: "blue", amount: 15 }))).toBe(false);
    expect(matches({ category: "red", amount: 15 })).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(Result.getOrThrow(matches({ category: "blue", amount: 15 }))).toBe(false);
  });

  it("distinguishes raw signed-zero equality and refuses conflicting bounds before candidate reads", () => {
    const matches = prepareCoreNativePredicate(Result.getOrThrow(captureCoreNativeWhere({ amount: -0 })));
    expect(Result.getOrThrow(matches({ amount: -0 }))).toBe(true);
    expect(Result.getOrThrow(matches({ amount: 0 }))).toBe(false);
    expect(captureCoreNativeWhere({ amount: { gt: 1, gte: 2 } })).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(captureCoreNativeWhere({ amount: Infinity })).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  });
});
