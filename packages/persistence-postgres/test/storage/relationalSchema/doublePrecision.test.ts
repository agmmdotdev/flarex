import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureRelationalSchemaArtifact } from "../../../src/storage/relationalSchema/artifact";
import { captureRelationalPhysicalLayout, verifyStoredRelationalPhysicalValue } from "../../../src/storage/relationalSchema/physical/canonical";
import { prepareLogicalRelationalRows } from "../../../src/storage/documents/logicalDocuments/relationalRows";
import { compileLogicalRelationalRead } from "../../../src/storage/documents/logicalDocuments/relationalQuery";
import { FRAMEWORK_VALUE_LOCATOR, frameworkTargetNamespace } from "../../installation/frameworkSchema/frameworkMigrationValueFixtures";

const origin = { kind: "synthetic", sourceId: "neutral.binary64" };
const input = () => ({ owner: "medusa", lineageId: "neutral-binary64", capabilities: [], tables: [{ tableId: "measure", origin,
  columns: [{ columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "value", type: "doublePrecision", nullable: false, default: { kind: "doublePrecisionLiteral", value: 1.25 }, origin }],
  keys: [{ keyId: "measure.primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [] }] });
const error = (reason: string) => new Error(reason);

describe("relational binary64 owners", () => {
  it("normalizes defaults and signed zero before canonical shared row and index derivation", () => {
    const schema = Result.getOrThrow(normalizeRelationalSchema(input())), table = schema.tables[0];
    if (table === undefined) throw new Error("Missing measure table");
    const rows = Result.getOrThrow(prepareLogicalRelationalRows(table, schema.capabilities, error));
    expect(Result.getOrThrow(rows.normalize({ id: "default" }, null, "2026-10-16T00:00:00.000Z"))).toEqual({ id: "default", value: 1.25 });
    expect(Object.is(Result.getOrThrow(rows.normalize({ id: "zero", value: -0 }, null, "2026-10-16T00:00:00.000Z")).value, -0)).toBe(false);
    const query = { order: { column: "value", direction: "asc" } };
    const read = Result.getOrThrow(compileLogicalRelationalRead(table, [], query, 16, error));
    const values = [-1e30, -2147483649, -1.25, 0, Number.MIN_VALUE, 1.25, 2147483648, 1e30, Number.MAX_VALUE];
    const keys = values.map((value, index) => Result.getOrThrow(read.inspect({ id: String(index), value })).order);
    for (let index = 1; index < keys.length; index++) {
      const previous = keys[index - 1], current = keys[index];
      if (previous === undefined || current === undefined) throw new Error("Missing binary64 order key");
      expect(Buffer.compare(previous, current)).toBeLessThan(0);
    }
    for (const predicate of [{ kind: "in", column: "value", values: [1.25] }, { kind: "greaterThan", column: "value", value: 1.25 }])
      expect(Result.isFailure(compileLogicalRelationalRead(table, [], { ...query, predicate }, 16, error))).toBe(true);
    expect(Result.isFailure(rows.normalize({ id: "nan", value: NaN }, null, "2026-10-16T00:00:00.000Z"))).toBe(true);
  });

  it("authenticates physical type, default and capabilities without changing int32 layouts", async () => {
    const artifact = await Effect.runPromise(captureRelationalSchemaArtifact({ deploymentId: "deployment-a", schema: input(),
      provenance: { kind: "synthetic", fixtureId: "binary64-physical" } }));
    const layout = await Effect.runPromise(captureRelationalPhysicalLayout({ artifact: artifact.artifact,
      physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace: await frameworkTargetNamespace() }));
    expect(layout.frame.tables[0]?.columns[1]).toMatchObject({ type: "double precision", default: { kind: "doublePrecisionLiteral", value: 1.25 } });
    expect(artifact.artifact.capabilities).toContain("relational-schema.column.doublePrecision");
    expect(artifact.artifact.capabilities).toContain("relational-schema.default.doublePrecisionLiteral");
    expect(await Effect.runPromise(verifyStoredRelationalPhysicalValue({ kind: "physicalLayout", canonicalBytes: new TextEncoder().encode(layout.canonicalJson),
      sha256Hex: layout.layoutSha256 }))).toEqual(layout.frame);
    for (const replacement of [{ type: "integer" }, { default: { kind: "integerLiteral", value: 1 } }, { default: { kind: "doublePrecisionLiteral", value: "1.25" } }]) {
      const altered = { ...layout.frame, tables: layout.frame.tables.map(table => ({ ...table,
        columns: table.columns.map(column => column.identity.columnId === "value" ? { ...column, ...replacement } : column) })) };
      const canonical = encodeCanonicalJson(altered, cause => { throw cause; });
      await expect(Effect.runPromise(verifyStoredRelationalPhysicalValue({ kind: "physicalLayout", canonicalBytes: new TextEncoder().encode(canonical),
        sha256Hex: createHash("sha256").update(canonical).digest("hex") }))).rejects.toMatchObject({ reason: "storedStateCorrupt" });
    }
  });
});
