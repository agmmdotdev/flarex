import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { compileCurrencyCoreDefinition } from "../../../medusa-adapter/src/modules/currency/schema";
import { checkCoreTableAccess, coreNativePolicyForTable, coreNativePolicyMatches, sameCoreNativeTablePolicy } from "../../src/core/nativePolicy";
import { CoreNativeTablePolicySchema } from "../../src/core/nativePolicyTypes";
import { parseCoreTableRecord } from "../../src/core/registry";
import { isCoreSchemaBundleSuccessor, makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import type { CoreTableDefinition } from "../../src/core/api";

const target = { scopeUuid: "f2bfbf4a-271e-4a44-bcc8-7aa3c7fe59bd", epochUuid: "df564a72-4a2c-4265-8b96-83ac7c90ee1e" };
const schemaId = Result.getOrThrow(encodeDocumentId(532, new Uint8Array(16).fill(4)));

describe("authenticated native source binding selection", () => {
  it("reuses only the captured policy and issued definition for the selected table", async () => {
    const definition = await Effect.runPromise(compileCurrencyCoreDefinition(target));
    const declaration = definition.tables[0];
    if (declaration === undefined) throw new Error("Missing Currency table");
    const identity = { ...definition.identity };
    const mutable = Object.freeze({ ...coreNativePolicyForTable(definition, declaration, "active", schemaId), identity });
    const parsed = Result.getOrThrow(parseCoreTableRecord({
      id: schemaId, creationTime: 0,
      value: { name: declaration.name, number: 10_001n, state: "active", nativePolicy: mutable },
    }, 1n)).definition;
    const owned = parsed.nativePolicy;
    if (owned === undefined) throw new Error("Missing parsed native policy");

    expect(coreNativePolicyMatches(owned, definition, declaration.name)).toBe(true);
    expect(coreNativePolicyMatches(owned, definition, declaration.name)).toBe(true);
    expect(coreNativePolicyMatches(owned, definition, "another_table")).toBe(false);
    expect(coreNativePolicyMatches(mutable, definition, declaration.name)).toBe(true);
    identity.sourceKey = "foreign.source";
    expect(coreNativePolicyMatches(mutable, definition, declaration.name)).toBe(false);
    expect(coreNativePolicyMatches(owned, definition, declaration.name)).toBe(true);

    const unissuedIdentity = { ...definition.identity };
    const unissued = { ...definition, identity: unissuedIdentity };
    expect(coreNativePolicyMatches(owned, unissued, declaration.name)).toBe(true);
    unissuedIdentity.sourceKey = "foreign.source";
    expect(coreNativePolicyMatches(owned, unissued, declaration.name)).toBe(false);
  });

  it("preserves omitted profiles and authenticates withdrawal independently of installed data schema", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const definition = yield* compileCurrencyCoreDefinition(target);
      const sources = [{ kind: "native" as const, definition }];
      const original = yield* makeCoreSchemaBundle({ sources });
      const withdrawn = yield* makeCoreSchemaBundle({ sources, nativeBindings: [{ sourceKey: "medusa.currency", selected: false }] });
      const reselected = yield* makeCoreSchemaBundle({ sources, nativeBindings: [{ sourceKey: "medusa.currency", selected: true }] });
      expect(original).not.toHaveProperty("nativeBindings");
      expect(original.metadata).not.toContain('"nativeBindings"');
      expect(withdrawn.schema).toEqual(original.schema);
      expect(withdrawn.nativeDefinitions).toEqual(original.nativeDefinitions);
      expect(isCoreSchemaBundleSuccessor(original, withdrawn)).toBe(true);
      expect(isCoreSchemaBundleSuccessor(withdrawn, reselected)).toBe(true);
      const declaration = definition.tables[0];
      if (declaration === undefined) return yield* Effect.die(new Error("Missing native Currency table"));
      const selected = coreNativePolicyForTable(definition, declaration, "active", schemaId);
      const disabled = coreNativePolicyForTable(definition, declaration, "active", schemaId, [], false);
      expect(selected).not.toHaveProperty("bindingSelected");
      expect(Schema.is(CoreNativeTablePolicySchema)(disabled)).toBe(true);
      expect(sameCoreNativeTablePolicy(selected, disabled)).toBe(false);
      const table: CoreTableDefinition = { name: declaration.name, namespace: null, number: 10001, tabletId: new Uint8Array(16),
        indexes: [], state: "active", nativePolicy: disabled };
      const authority = { definition, namespace: null, schemaId, authorityEpoch: 0n, tables: [table] };
      expect(Result.isFailure(checkCoreTableAccess(table, "read", authority))).toBe(true);
      expect(Result.isFailure(checkCoreTableAccess(table, "write", authority))).toBe(true);
      expect(Result.isFailure(checkCoreTableAccess(table, "read"))).toBe(true);
    }));
  });

  it("refuses unknown and duplicate selected source identities", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const definition = yield* compileCurrencyCoreDefinition(target);
      const sources = [{ kind: "native" as const, definition }];
      for (const nativeBindings of [[{ sourceKey: "foreign.source", selected: false }],
        [{ sourceKey: "medusa.currency", selected: true }, { sourceKey: "medusa.currency", selected: false }]])
        expect(Result.isFailure(yield* Effect.result(makeCoreSchemaBundle({ sources, nativeBindings })))).toBe(true);
    }));
  });

  it("captures the complete selection before asynchronous bundle lowering", async () => {
    const definition = await Effect.runPromise(compileCurrencyCoreDefinition(target));
    const selection = { sourceKey: "medusa.currency", selected: false };
    const selections = [selection];
    const pending = Effect.runPromise(makeCoreSchemaBundle({ sources: [{ kind: "native", definition }], nativeBindings: selections }));
    selection.selected = true;
    const bundle = await pending;
    expect(bundle.nativeBindings).toEqual([{ sourceKey: "medusa.currency", selected: false }]);
    expect(Object.isFrozen(bundle.nativeBindings?.[0])).toBe(true);
  });
});
