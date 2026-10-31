import { Result } from "effect";
import { describe, expect, it } from "vitest";
import type { SchemaManifestAppTableDeclarationV1 } from "flarex-protocol/schema-manifest";
import { decodeSchemaManifestAppTableName } from "flarex-protocol/schema-manifest";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import { enforceAppSchemaPublicationV1CanonicalByteLowerBoundResult,
  MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES } from "../../../src/storage/catalog/appSchemaPublicationPolicy";

const table = (fieldType: ValidatorJsonV1): SchemaManifestAppTableDeclarationV1 => ({ logicalName: decodeSchemaManifestAppTableName("items"),
  definition: { kind: "appDocument", definitionVersion: 2,
    documentType: { type: "object", value: { value: { fieldType, optional: false } } } } });

describe("app schema publication declaration byte lower bound", () => {
  it("counts Function argument and return metadata toward the canonical byte ceiling", () => {
    const literal: ValidatorJsonV1 = { type: "literal", value: "x".repeat(MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES) };
    const signatures: readonly ValidatorJsonV1[] = [{ type: "function", fnType: "query", args: literal },
      { type: "function", fnType: "mutation", returns: literal }];
    for (const signature of signatures) expect(enforceAppSchemaPublicationV1CanonicalByteLowerBoundResult([table(signature)], []))
      .toMatchObject({ failure: { issue: { reason: "canonicalByteLowerBoundExceeded" } } });
  });

  it("admits ordinary Function and CommitTs declarations at the byte preflight", () => {
    const signature: ValidatorJsonV1 = { type: "function", fnType: "query", args: { type: "id", tableName: "signatureOnly" }, returns: { type: "commitTs" } };
    expect(Result.isSuccess(enforceAppSchemaPublicationV1CanonicalByteLowerBoundResult([table(signature), table({ type: "commitTs" })], []))).toBe(true);
  });
});
