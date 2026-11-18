import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { FrozenFiniteCommitValidationValues } from "@flarex/persistence-postgres/internal/session-journal";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { decodeAppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { createOwnedCanonicalFlarexRuntimeValueReaderV1 } from "flarex-protocol/internal/value-runtime-core";
import { decodeSchemaManifestAppSchemaV1 } from "flarex-protocol/schema-manifest";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import * as valueCodec from "flarex-protocol/value";
import { verifyFiniteCommitValuesEffect } from "../../../src/mutation/authentication/stored/commitInputVerification";

const tableId = decodeCatalogTableId(1);
const foreignTableId = decodeCatalogTableId(2);
const documentId = decodeAppDocumentIdV1("1:00000000-0000-4000-8000-000000000001");
const creationTime = AppCreationTimeV1Schema.make(1);
type Row = FrozenFiniteCommitValidationValues["rowIntents"][number];

function manifest(documentType: ValidatorJsonV1) {
  return decodeSchemaManifestAppSchemaV1({ kind: "appSchema", manifestVersion: 1,
    tableDefinitions: { kind: "tableDefinitions", sectionVersion: 1, tables: [{ tableId,
      namespace: "app", logicalName: "users", definition: { kind: "appDocument", definitionVersion: 1, documentType } }] },
    indexBindings: { kind: "indexBindings", sectionVersion: 1, indexes: [] },
  });
}

function verification(rows: readonly Row[], successfulResult: FrozenFiniteCommitValidationValues["successfulResult"],
  documentType: ValidatorJsonV1, returnsValidator: ValidatorJsonV1 | null) {
  return verifyFiniteCommitValuesEffect({ rowIntents: rows, successfulResult,
    schemaManifest: manifest(documentType), functionValidationAuthority: { path: "users:update", returnsValidator } });
}

describe("finite canonical runtime validation loans", () => {
  it("selects Application tables and live kinds before accessing runtime values", async () => {
    let bodyReads = 0;
    const foreign = { kind: "live" as const, documentId, tableId: foreignTableId, creationTime,
      get value(): never { bodyReads++; throw new Error("Foreign body must remain untouched"); } };
    const deleted = { kind: "deleted" as const, documentId, tableId,
      get value(): never { bodyReads++; throw new Error("Deleted body must remain untouched"); } };
    await Effect.runPromise(verification([foreign, deleted], { value: null }, { type: "object", value: {} }, { type: "null" }));
    expect(bodyReads).toBe(0);
  });

  it("stops after the first document refusal before a later row or result getter", async () => {
    let laterReads = 0;
    const first: Row = { kind: "live", documentId, tableId, creationTime,
      value: valueCodec.normalizeFlarexValueV1({ _id: documentId, _creationTime: creationTime, name: 1 }).value };
    const later: Row = { kind: "live", documentId, tableId, creationTime,
      get value(): never { laterReads++; throw new Error("Later row must remain untouched"); } };
    const result = { get value(): never { laterReads++; throw new Error("Result must remain untouched"); } };
    const verdict = await Effect.runPromise(verification([first, later], result,
      { type: "object", value: { name: { optional: false, fieldType: { type: "string" } } } }, { type: "null" }).pipe(Effect.result));
    expect(verdict).toMatchObject({ _tag: "Failure", failure: { _tag: "CommitDocumentValidationV1Error",
      documentId, tableName: "users", issue: { reason: "validator", issue: { reason: "typeMismatch", path: "$document.name" } } } });
    expect(laterReads).toBe(0);
  });

  it("preserves runtime scalar and binary values through real document and returns validators without JSON reconstruction", async () => {
    const domain = { bigint: 42n, bytes: new Uint8Array([1, 2]).buffer, nan: NaN, negativeZero: -0,
      positiveInfinity: Infinity, negativeInfinity: -Infinity };
    const fields = { bigint: { optional: false, fieldType: { type: "bigint" as const } },
      bytes: { optional: false, fieldType: { type: "bytes" as const } },
      nan: { optional: false, fieldType: { type: "number" as const } },
      negativeZero: { optional: false, fieldType: { type: "number" as const } },
      positiveInfinity: { optional: false, fieldType: { type: "number" as const } },
      negativeInfinity: { optional: false, fieldType: { type: "number" as const } } };
    const validator: ValidatorJsonV1 = { type: "object", value: fields };
    const readRow = createOwnedCanonicalFlarexRuntimeValueReaderV1(
      valueCodec.normalizeFlarexValueV1({ ...domain, _id: documentId, _creationTime: creationTime }).value);
    const readResult = createOwnedCanonicalFlarexRuntimeValueReaderV1(valueCodec.normalizeFlarexValueV1(domain).value);
    const row: Row = { kind: "live", documentId, tableId, creationTime, get value() { return readRow(); } };
    const result = { get value() { return readResult(); } };
    const escaped = row.value;
    if (!valueCodec.isCanonicalFlarexRuntimeObjectV1(escaped) || !(escaped.bytes instanceof ArrayBuffer))
      throw new Error("Expected a detached canonical binary value");
    new Uint8Array(escaped.bytes).fill(9);
    const normalize = vi.spyOn(valueCodec, "normalizeFlarexValueJsonV1");
    try {
      await Effect.runPromise(verification([row], result, validator, validator));
      expect(normalize).not.toHaveBeenCalled();
      const second = row.value;
      if (!valueCodec.isCanonicalFlarexRuntimeObjectV1(second) || !(second.bytes instanceof ArrayBuffer))
        throw new Error("Expected a second detached canonical binary value");
      expect(new Uint8Array(second.bytes)).toEqual(new Uint8Array([1, 2]));
      expect(Object.is(second.negativeZero, -0)).toBe(true);
      expect(second).toMatchObject(domain);
    } finally { normalize.mockRestore(); }
  });

  it("keeps identity, creation time, system fields and return validator refusals", async () => {
    const valid = { _id: documentId, _creationTime: creationTime, name: "valid" };
    const documentType: ValidatorJsonV1 = { type: "object", value: { name: { optional: false, fieldType: { type: "string" } } } };
    for (const [value, failure] of [
      [{ ...valid, _id: "other" }, { _tag: "CommitInputAuthorityCorruptionV1Error", reason: "pointIdentityMismatch" }],
      [{ ...valid, _creationTime: 2 }, { _tag: "CommitInputAuthorityCorruptionV1Error", reason: "pointCreationTimeMismatch" }],
      [{ ...valid, _private: true }, { _tag: "CommitDocumentValidationV1Error", issue: { reason: "unexpectedSystemField", field: "_private" } }],
    ] as const) {
      const row: Row = { kind: "live", documentId, tableId, creationTime, value: valueCodec.normalizeFlarexValueV1(value).value };
      expect(await Effect.runPromise(verification([row], { value: null }, documentType, { type: "null" }).pipe(Effect.result)))
        .toMatchObject({ _tag: "Failure", failure });
    }
    const row: Row = { kind: "live", documentId, tableId, creationTime, value: valueCodec.normalizeFlarexValueV1(valid).value };
    expect(await Effect.runPromise(verification([row], { value: 42n }, documentType, { type: "string" }).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "CommitSuccessfulResultValidationV1Error",
        functionPath: "users:update", issue: { reason: "typeMismatch", path: "$return", expected: "string" } } });
  });
});
