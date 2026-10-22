import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { encodeCanonicalJson } from "flarex-protocol/json";
import {
  normalizeRelationalSchema,
} from "flarex-protocol/internal/relational-schema";
import { captureRelationalSchemaArtifact, authenticateStoredRelationalSchemaArtifactEffect } from "../../../src/storage/relationalSchema/artifact";
import { captureRelationalPhysicalLayout, verifyStoredRelationalPhysicalValue } from "../../../src/storage/relationalSchema/physical/canonical";
import { FRAMEWORK_VALUE_LOCATOR, frameworkTargetNamespace, currencySchemaInput } from "../../installation/frameworkSchema/frameworkMigrationValueFixtures";
import { compoundIndexSchema } from "../indexes/compoundIndexFixture";

const capture = (schema: unknown) => captureRelationalSchemaArtifact({ deploymentId: "deployment-a",
  provenance: { kind: "sourceSnapshot", repository: "https://example.com/compound", revision: "d".repeat(40), paths: ["model.ts"] }, schema });

describe("bounded compound index predicates", () => {
  it("refuses the logical Boolean predicate on the historical physical-layout route", async () => {
    const origin = { kind: "synthetic", sourceId: "neutral-boolean-layout-refusal" };
    const captured = await Effect.runPromise(capture({ owner: "medusa", lineageId: "boolean-layout-refusal", capabilities: [], tables: [{
      tableId: "entries", origin, columns: [
        { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
        { columnId: "deleted_at", type: "text", nullable: true, default: { kind: "none" }, origin },
        { columnId: "selected", type: "boolean", nullable: false, default: { kind: "none" }, origin },
      ], keys: [{ keyId: "entries.primary", kind: "primary", columns: ["id"], origin }], indexes: [{
        indexId: "entries.selected", kind: "uniqueBtree", columns: ["id"], origin,
        predicate: { kind: "isNullAndBooleanEquals", nullColumnId: "deleted_at", booleanColumnId: "selected", value: true },
      }], constraints: [], relationships: [],
    }] }));
    expect(await Effect.runPromise(Effect.result(captureRelationalPhysicalLayout({ artifact: captured.artifact,
      physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace: await frameworkTargetNamespace() }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedArtifact" } });
  });
  it("does not substitute a compound index for the soft-delete active-row index", () => {
    const input = currencySchemaInput();
    Reflect.set(input.tables[0]?.indexes[0] ?? {}, "predicate", {
      kind: "isNullAndTextEquals", nullColumnId: "deleted_at", textColumnId: "code", value: "USD",
    });
    expect(normalizeRelationalSchema(input)).toMatchObject({ _tag: "Failure", failure: { path: "$.capabilities[currency.soft-delete]" } });
  });
  it("retains both references and capabilities through canonical capture and restoration", async () => {
    const input = compoundIndexSchema();
    const captured = await Effect.runPromise(capture(input));
    const restored = await Effect.runPromise(authenticateStoredRelationalSchemaArtifactEffect(captured.artifact));
    expect(restored.schema).toEqual(captured.schema);
    expect(captured.artifact.capabilities).toContain("relational-schema.index-predicate.isNullAndTextEquals");
    input.tables[0]?.columns.reverse();
    expect(await Effect.runPromise(capture(input))).toEqual(captured);
    const layout = await Effect.runPromise(captureRelationalPhysicalLayout({ artifact: captured.artifact,
      physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace: await frameworkTargetNamespace() }));
    expect(await Effect.runPromise(verifyStoredRelationalPhysicalValue({ kind: "physicalLayout",
      canonicalBytes: new TextEncoder().encode(layout.canonicalJson), sha256Hex: layout.layoutSha256 }))).toEqual(layout.frame);
    for (const change of [{ textColumn: "scope_uuid" }, { value: "missing-choice" }]) {
      const altered = { ...layout.frame, tables: layout.frame.tables.map(table => ({ ...table,
        indexes: table.indexes.map(index => ({ ...index, predicate: { ...index.predicate, ...change } })) })) };
      const canonical = encodeCanonicalJson(altered, cause => { throw cause; });
      expect(await Effect.runPromise(Effect.result(verifyStoredRelationalPhysicalValue({ kind: "physicalLayout",
        canonicalBytes: new TextEncoder().encode(canonical), sha256Hex: createHash("sha256").update(canonical).digest("hex") }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "storedStateCorrupt" } });
    }
  });

  it.each([
    { nullColumnId: "missing" }, { textColumnId: "missing" }, { textColumnId: "retired" },
    { nullColumnId: "state" }, { value: "missing-choice" }, { value: null }, { value: "a\0b" },
    { kind: "and" }, { expression: "1 = 1" },
  ])("refuses unsupported or inconsistent predicates %j", change => {
    const input = compoundIndexSchema();
    const predicate = input.tables[0]?.indexes[0]?.predicate;
    if (!predicate) throw new Error("Missing compound fixture");
    Object.assign(predicate, change);
    expect(Result.isFailure(normalizeRelationalSchema(input))).toBe(true);
  });
});
