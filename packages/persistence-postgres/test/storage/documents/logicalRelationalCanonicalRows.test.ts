import { Effect, Result, Schema } from "effect";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type { JsonObject } from "flarex-protocol/json";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { expect, it, vi } from "vitest";
import { syntheticSchemaInput } from "../../installation/frameworkSchema/frameworkMigrationValueFixtures";
import { decodeStoredAppDocumentEvidenceEffect } from "../../../src/storage/documents/appRowCanonicalEvidence";
import {
  canonicalizeLogicalRelationalRow, captureLogicalRelationalCanonicalRow,
  detachLogicalCanonicalDocument, nativeLogicalRelationalCanonicalRow,
  prepareLogicalRelationalTableMechanics, validateLogicalRelationalCanonicalRow,
  type PreparedLogicalRelationalTableMechanics,
} from "../../../src/storage/documents/logicalDocuments/relationalRows";

const failure = (reason: string, cause?: unknown) => new Error(reason, { cause });
const tableId = CatalogTableIdSchema.make(1);
const rowId = decodeAppRowIdHexV1("00000000000000000000000000000001");
const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
const creationTime = Schema.decodeUnknownSync(AppCreationTimeV1Schema)(1);
async function ownedRow(): Promise<{
  mechanics: PreparedLogicalRelationalTableMechanics; document: CanonicalFlarexValueV1; fields: JsonObject;
}> {
  const schema = Result.getOrThrow(normalizeRelationalSchema(syntheticSchemaInput()));
  const table = schema.tables[0];
  if (table === undefined) throw new Error("Missing relational table");
  const mechanics = prepareLogicalRelationalTableMechanics(table, schema.capabilities);
  const rows = Result.getOrThrow(mechanics.rows);
  const fields = Result.getOrThrow(rows.normalize({ id: "row", parent_id: "parent" }, null, "2026-10-12T00:00:00Z"));
  const document = await Effect.runPromise(canonicalizeLogicalRelationalRow(mechanics, fields, documentId, creationTime));
  return { mechanics, document, fields };
}

async function ingestedRow(): Promise<{ mechanics: PreparedLogicalRelationalTableMechanics; document: CanonicalFlarexValueV1 }> {
  const { mechanics, document } = await ownedRow();
  const stored = await Effect.runPromise(decodeStoredAppDocumentEvidenceEffect({
    tableId, rowId,
    creationTime, codecVersion: document.codecVersion, canonicalBytes: document.canonicalBytes, sha256: document.sha256,
  }));
  const ingested = detachLogicalCanonicalDocument(stored);
  expect(Object.isFrozen(ingested)).toBe(false);
  Result.getOrThrow(captureLogicalRelationalCanonicalRow(ingested, 4096, failure));
  return { mechanics, document: ingested };
}

it("retains complete native values and independent validation across genuine detachment", async () => {
  const { mechanics, document, fields } = await ownedRow();
  for (const candidate of [document, detachLogicalCanonicalDocument(document)]) {
    expect(Result.getOrThrow(nativeLogicalRelationalCanonicalRow(mechanics, candidate, 4096, failure))).toEqual(fields);
    expect(Result.isSuccess(validateLogicalRelationalCanonicalRow(mechanics, candidate, "storedCorruption"))).toBe(true);
  }
});

it.each(["canonicalBytes", "sha256"] as const)("rechecks altered %s on each later access and validation", async field => {
  const { mechanics, document } = await ownedRow();
  expect(Result.isSuccess(nativeLogicalRelationalCanonicalRow(mechanics, document, 4096, failure))).toBe(true);
  expect(Result.isSuccess(validateLogicalRelationalCanonicalRow(mechanics, document, "storedCorruption"))).toBe(true);
  document[field].fill(9);
  for (const candidate of [document, detachLogicalCanonicalDocument(document)]) {
    expect(nativeLogicalRelationalCanonicalRow(mechanics, candidate, 4096, failure))
      .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
    expect(validateLogicalRelationalCanonicalRow(mechanics, candidate, "storedCorruption"))
      .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  }
});

it("preserves return bounds before native authority checks and validation authority before corruption", async () => {
  const { mechanics, document } = await ownedRow();
  const foreignMechanics = { ...mechanics };
  expect(nativeLogicalRelationalCanonicalRow(foreignMechanics, document, 0, failure))
    .toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
  expect(nativeLogicalRelationalCanonicalRow(foreignMechanics, document, 4096, failure))
    .toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
  document.canonicalBytes.fill(9);
  expect(nativeLogicalRelationalCanonicalRow(foreignMechanics, document, 4096, failure))
    .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
  expect(validateLogicalRelationalCanonicalRow(foreignMechanics, document, "storedCorruption"))
    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
});

it.each([
  { operation: "native", inherited: false }, { operation: "validation", inherited: false },
  { operation: "native", inherited: true }, { operation: "validation", inherited: true },
])("rechecks bytes changed by a buffer getter during $operation (inherited: $inherited)", async ({ operation, inherited }) => {
  const { mechanics, document } = await ownedRow();
  const intrinsicLength = document.sha256.byteLength;
  const target = inherited ? Object.create(Object.getPrototypeOf(document.sha256)) : document.sha256;
  Object.defineProperty(target, "byteLength", { configurable: true, get() {
    Reflect.deleteProperty(target, "byteLength");
    document.canonicalBytes.fill(9);
    return intrinsicLength;
  } });
  if (inherited) Object.setPrototypeOf(document.sha256, target);
  const result = operation === "native"
    ? nativeLogicalRelationalCanonicalRow(mechanics, document, 4096, failure)
    : validateLogicalRelationalCanonicalRow(mechanics, document, "storedCorruption");
  expect(result).toMatchObject({ _tag: "Failure", failure: operation === "native"
    ? { message: "storedCorruption" } : { reason: "storedCorruption" } });
});

it.each(["native", "validation"] as const)("keeps corruption before a later mutable carrier getter during %s", async operation => {
  const { mechanics, document } = await ingestedRow();
  document.canonicalBytes.fill(9);
  const getter = vi.fn((): never => { throw new Error("later digest getter"); });
  Object.defineProperty(document, "sha256", { get: getter });
  const result = operation === "native"
    ? nativeLogicalRelationalCanonicalRow(mechanics, document, 4096, failure)
    : validateLogicalRelationalCanonicalRow(mechanics, document, "storedCorruption");
  expect(result).toMatchObject({ _tag: "Failure", failure: operation === "native"
    ? { message: "storedCorruption" } : { reason: "storedCorruption" } });
  expect(getter).not.toHaveBeenCalled();
});

it.each(["native", "validation"] as const)("rechecks a mutable carrier getter that changes earlier bytes during %s", async operation => {
  const { mechanics, document } = await ingestedRow();
  const digest = document.sha256;
  Object.defineProperty(document, "sha256", { get() { document.canonicalBytes.fill(9); return digest; } });
  const result = operation === "native"
    ? nativeLogicalRelationalCanonicalRow(mechanics, document, 4096, failure)
    : validateLogicalRelationalCanonicalRow(mechanics, document, "storedCorruption");
  expect(result).toMatchObject({ _tag: "Failure", failure: operation === "native"
    ? { message: "storedCorruption" } : { reason: "storedCorruption" } });
});

it.each(["native", "validation"] as const)("keeps corruption before later proxy buffer traps during %s", async operation => {
  const { mechanics, document } = await ingestedRow();
  const trap = vi.fn((): never => { throw new Error("later digest proxy"); });
  Object.defineProperty(document, "sha256", { value: new Proxy(document.sha256, { get: trap, getPrototypeOf: trap }) });
  document.canonicalBytes.fill(9);
  const result = operation === "native"
    ? nativeLogicalRelationalCanonicalRow(mechanics, document, 4096, failure)
    : validateLogicalRelationalCanonicalRow(mechanics, document, "storedCorruption");
  expect(result).toMatchObject({ _tag: "Failure", failure: operation === "native"
    ? { message: "storedCorruption" } : { reason: "storedCorruption" } });
  expect(trap).not.toHaveBeenCalled();
});

it("keeps full foreign row validation and the original getter defect", async () => {
  const { mechanics, document } = await ownedRow();
  const cause = new Error("foreign getter");
  const getter = vi.fn((): never => { throw cause; });
  const foreign = { ...document, get value() { return getter(); } };
  expect(() => nativeLogicalRelationalCanonicalRow(mechanics, foreign, 4096, failure)).toThrow(cause);
  expect(() => validateLogicalRelationalCanonicalRow(mechanics, foreign, "storedCorruption")).toThrow(cause);
  const malformed = { ...document, value: { _id: documentId, _creationTime: creationTime, id: "row", parent_id: "parent", ordinal: "bad" } };
  expect(nativeLogicalRelationalCanonicalRow(mechanics, malformed, 4096, failure))
    .toMatchObject({ _tag: "Failure", failure: { message: "storedCorruption" } });
  expect(validateLogicalRelationalCanonicalRow(mechanics, malformed, "storedCorruption"))
    .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  expect(Result.isSuccess(captureLogicalRelationalCanonicalRow(document, 4096, failure))).toBe(true);
});
