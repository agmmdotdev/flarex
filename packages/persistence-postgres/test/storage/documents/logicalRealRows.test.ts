import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { normalizeRelationalSchema, relationalSchemaSourceFromDefinition } from "flarex-protocol/internal/relational-schema";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { prepareLogicalRelationalTableMechanics, prepareLogicalRelationalRealBatch, inspectLogicalRelationalRealBatch,
  canonicalizeLogicalRelationalRow } from "../../../src/storage/documents/logicalDocuments/relationalRows";
import { captureRelationalSchemaArtifact } from "../../../src/storage/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../../../src/storage/relationalSchema/physical/canonical";
import { FRAMEWORK_VALUE_LOCATOR, frameworkTargetNamespace } from "../../installation/frameworkSchema/frameworkMigrationValueFixtures";

const origin = { kind: "synthetic", sourceId: "neutral-real-mechanics" };
const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "system", lineageId: "neutral-real-mechanics", capabilities: [],
  tables: [{ tableId: "entry", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "amount", type: "real", nullable: true, default: { kind: "none" }, origin },
  ], keys: [{ keyId: "primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [] }] }));
const table = schema.tables[0]; if (table === undefined) throw new Error("Missing REAL table");
const mechanics = prepareLogicalRelationalTableMechanics(table, schema.capabilities), policy = Result.getOrThrow(mechanics.rows);
const tableId = CatalogTableIdSchema.make(1), bounds = { rows: 1, bytes: 4096 };
const error = (reason: string, cause?: unknown) => new Error(reason, { cause });
const candidate = () => Result.getOrThrow(policy.normalize({ id: "row", amount: 1.0000000596046448 }, null, "2026-10-22T00:00:00.000Z"));

describe("REAL normalization authority", () => {
  it("refuses REAL in the retained physical layout owner", async () => {
    const artifact = await Effect.runPromise(captureRelationalSchemaArtifact({ deploymentId: "deployment-a",
      schema: relationalSchemaSourceFromDefinition(schema), provenance: { kind: "synthetic", fixtureId: "neutral-real-physical" } }));
    await expect(Effect.runPromise(captureRelationalPhysicalLayout({ artifact: artifact.artifact,
      physicalLocator: FRAMEWORK_VALUE_LOCATOR, targetNamespace: await frameworkTargetNamespace() })))
      .rejects.toMatchObject({ reason: "unsupportedArtifact" });
  });
  it("keeps pure merge/default candidates separate from canonical SQL verdicts", async () => {
    const fields = candidate();
    expect(fields.amount).toBe(1.0000000596046448);
    expect(policy.validate(fields, "documentInvalid")).toMatchObject({ _tag: "Failure", failure: { reason: "documentInvalid" } });
    const id = appDocumentIdV1FromRowIdentity({ tableId, rowId: decodeAppRowIdHexV1("11".repeat(16)) });
    await expect(Effect.runPromise(canonicalizeLogicalRelationalRow(mechanics, fields, id, Schema.decodeUnknownSync(AppCreationTimeV1Schema)(1))))
      .rejects.toMatchObject({ reason: "invalidAuthority" });
  });
  it("requires genuine mechanics and captured candidate identity before creating a closed batch", () => {
    const fields = candidate(), input = { mode: "normalize", rows: [fields] } as const;
    const batch = Result.getOrThrow(prepareLogicalRelationalRealBatch(mechanics, tableId, input, bounds, error));
    expect(Result.getOrThrow(inspectLogicalRelationalRealBatch(batch, tableId, error)).table).toBe(mechanics.table);
    expect(inspectLogicalRelationalRealBatch({ ...batch }, tableId, error)).toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
    expect(inspectLogicalRelationalRealBatch(batch, CatalogTableIdSchema.make(2), error)).toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
    expect(prepareLogicalRelationalRealBatch({ ...mechanics }, tableId, input, bounds, error)).toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
    expect(prepareLogicalRelationalRealBatch(mechanics, tableId, { mode: "normalize", rows: [{ ...fields }] }, bounds, error))
      .toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
  });
  it("bounds actual SQL cells and response envelopes before executing", () => {
    for (const bytes of [0, 64, 128]) expect(prepareLogicalRelationalRealBatch(mechanics, tableId,
      { mode: "normalize", rows: [candidate()] }, { rows: 1, bytes }, error)).toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
    expect(prepareLogicalRelationalRealBatch(mechanics, tableId, { mode: "normalize", rows: [candidate(), candidate()] }, bounds, error))
      .toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
  });
});
