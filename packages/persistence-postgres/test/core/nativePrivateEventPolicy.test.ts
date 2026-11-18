import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { checkCoreTableAccess, coreNativePolicyForTable, makeCoreRelationalNativeDefinition } from "../../src/core/nativePolicy";
import { CoreNativeTablePolicySchema } from "../../src/core/nativePolicyTypes";
import { isCoreNativeObservedTable, isCorePrivateTable, isCoreSystemTable } from "../../src/core/nativeTableAccess";
import type { CoreTableDefinition } from "../../src/core/api";

const target = { scopeUuid: "f2bfbf4a-271e-4a44-bcc8-7aa3c7fe59bd", epochUuid: "df564a72-4a2c-4265-8b96-83ac7c90ee1e" };
const schemaId = Result.getOrThrow(encodeDocumentId(532, new Uint8Array(16).fill(4)));
const source = Effect.gen(function* () {
  const provenance = { kind: "coreNativeEvents", version: 1 }, origin = { kind: "synthetic", sourceId: "native-events" } as const;
  const schema = yield* Effect.fromResult(normalizeRelationalSchema({ owner: "system", lineageId: "flarex.native-events", capabilities: [],
    tables: ["family", "envelope", "delivery"].map(tableId => ({ tableId, origin,
      columns: [{ columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin }],
      keys: [{ keyId: `${tableId}.primary`, kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [] })) }));
  const captured = yield* captureLogicalSchemaSource({ key: "flarex.native-events", owner: "system", writeProfile: "flarex.native-events",
    evidence: { kind: "coreNativeEvents", provenance, policy: { family: "test" },
      privateEventTables: [{ localName: "family", role: "family" }, { localName: "envelope", role: "envelope" }, { localName: "delivery", role: "delivery" }] },
    definition: { kind: "relational", schema }, bindings: schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "system", logicalName: `flarex.native-events/${table.identity.tableId}` } })) });
  return { captured, provenance };
});

describe("optional private durable event table policy", () => {
  it("authenticates every role and confines application exposure while retaining native observations", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const { captured, provenance } = yield* source;
      const definition = yield* makeCoreRelationalNativeDefinition({ ...target, source: captured, provenance, commands: [] });
      expect(definition.tables.map(table => table.privateEvent?.role).sort()).toEqual(["delivery", "envelope", "family"]);
      for (const declaration of definition.tables) {
        const nativePolicy = coreNativePolicyForTable(definition, declaration, "active", schemaId);
        expect(Schema.is(CoreNativeTablePolicySchema)(nativePolicy)).toBe(true);
        const table: CoreTableDefinition = { name: declaration.name, namespace: null, state: "active", number: 1001,
          tabletId: new Uint8Array(16).fill(2), indexes: [], nativePolicy };
        expect(isCorePrivateTable(table)).toBe(true);
        expect(isCoreSystemTable(table)).toBe(true);
        expect(isCoreNativeObservedTable(table)).toBe(true);
        expect(Result.isFailure(checkCoreTableAccess(table, "read"))).toBe(true);
        expect(Result.isSuccess(checkCoreTableAccess(table, "write", { definition, namespace: null, schemaId,
          authorityEpoch: 0n, tables: [table] }))).toBe(true);
      }
      expect(Result.isFailure(yield* Effect.result(makeCoreRelationalNativeDefinition({ ...target,
        source: captured, provenance, commands: [], applicationRead: true })))).toBe(true);
    }));
  });
});
