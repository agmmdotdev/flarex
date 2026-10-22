import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
  APP_UNIQUE_KEY_CODEC_VERSION_V1,
  canonicalizeAppUniqueConstraintPhysicalSpecV1,
  decodeAppUniqueConstraintPhysicalSpecV1Result,
  LogicalDocumentUniqueConstraintDeclarationSchema,
} from "../src/app-unique-constraint-definition";

const spec = (sparse: boolean) => ({
  kind: "appUniqueConstraint" as const,
  specVersion: 1 as const,
  orderedFields: ["tenantId", "email"] as const,
  sparse,
  localePolicy: { kind: "none" as const },
  keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
  keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
});

describe("app unique constraint physical definition", () => {
  it("commits Boolean membership without widening document producer declarations", async () => {
    const predicate = { kind: "fieldIsNullAndBooleanEquals", nullField: "retired", booleanField: "selected", value: true };
    const selected = await canonicalizeAppUniqueConstraintPhysicalSpecV1({ ...spec(false), predicate, nullsDistinct: true });
    predicate.value = false;
    expect(selected.physicalSpec.predicate).toEqual({ ...predicate, value: true });
    expect(Object.isFrozen(selected.physicalSpec.predicate)).toBe(true);
    expect(selected.canonicalText).toContain('"predicate":{"booleanField":"selected","kind":"fieldIsNullAndBooleanEquals","nullField":"retired","value":true}');
    expect(await canonicalizeAppUniqueConstraintPhysicalSpecV1(selected.physicalSpec)).toEqual(selected);
    for (const changed of [predicate, { ...predicate, value: true, nullField: "other" },
      { ...predicate, value: true, booleanField: "other" }]) {
      expect((await canonicalizeAppUniqueConstraintPhysicalSpecV1({ ...spec(false), predicate: changed, nullsDistinct: true })).sha256Hex)
        .not.toBe(selected.sha256Hex);
    }
    for (const invalid of [{ ...predicate, value: "false" }, { ...predicate, value: 0 },
      { ...predicate, value: null }, { ...predicate, value: undefined }, { ...predicate, booleanField: "retired" },
      { ...predicate, booleanField: "" }, { ...predicate, unknown: true }]) {
      expect(Result.isFailure(decodeAppUniqueConstraintPhysicalSpecV1Result({ ...spec(false), predicate: invalid }))).toBe(true);
    }
    const declaration = { tableLogicalName: "members", descriptor: "selected-parent", fields: ["parent"], sparse: false, nullsDistinct: false };
    const decodeDeclaration = Schema.decodeUnknownResult(LogicalDocumentUniqueConstraintDeclarationSchema);
    expect(Result.isSuccess(decodeDeclaration({ ...declaration, predicate: { kind: "fieldIsNull", field: "retired" } }))).toBe(true);
    expect(Result.isFailure(decodeDeclaration({ ...declaration, predicate }))).toBe(true);
  });

  it("preserves the existing null-predicate canonical bytes", async () => {
    const base = await canonicalizeAppUniqueConstraintPhysicalSpecV1(spec(false));
    const conditional = await canonicalizeAppUniqueConstraintPhysicalSpecV1({ ...spec(false),
      predicate: { kind: "fieldIsNull", field: "retired" } });
    expect(conditional.canonicalText).toBe(base.canonicalText.replace('"sparse":false',
      '"predicate":{"field":"retired","kind":"fieldIsNull"},"sparse":false'));
  });

  it("authenticates predicate paths and null semantics without changing native bytes", async () => {
    const native = await canonicalizeAppUniqueConstraintPhysicalSpecV1(spec(false));
    const predicate = { kind: "fieldIsNull", field: "deleted_at" };
    const conditional = await canonicalizeAppUniqueConstraintPhysicalSpecV1({ ...spec(false), predicate, nullsDistinct: true });
    predicate.field = "changed";
    expect(conditional.physicalSpec.predicate).toEqual({ kind: "fieldIsNull", field: "deleted_at" });
    expect(Object.isFrozen(conditional.physicalSpec.predicate)).toBe(true);
    expect(await canonicalizeAppUniqueConstraintPhysicalSpecV1(conditional.physicalSpec)).toEqual(conditional);
    expect(conditional.sha256Hex).not.toBe(native.sha256Hex);
    for (const changed of [{ ...spec(false), nullsDistinct: true },
      { ...spec(false), predicate: { kind: "fieldIsNull", field: "deleted_at" } },
      { ...spec(false), predicate: { kind: "fieldIsNull", field: "other" }, nullsDistinct: true }]) {
      expect((await canonicalizeAppUniqueConstraintPhysicalSpecV1(changed)).sha256Hex).not.toBe(conditional.sha256Hex);
    }
    for (const invalid of [{ ...spec(false), nullsDistinct: false }, { ...spec(false), predicate: "deleted_at IS NULL" },
      { ...spec(false), predicate: { kind: "fieldIsNull", field: "" } },
      { ...spec(false), predicate: { kind: "fieldEquals", field: "deleted_at", value: null } }]) {
      expect(Result.isFailure(decodeAppUniqueConstraintPhysicalSpecV1Result(invalid))).toBe(true);
    }
  });
  it("canonicalizes the same non-localized spec deterministically", async () => {
    const first = await canonicalizeAppUniqueConstraintPhysicalSpecV1(spec(false));
    const replay = await canonicalizeAppUniqueConstraintPhysicalSpecV1(spec(false));

    expect(first).toEqual(replay);
    expect(first.canonicalText).toBe(
      '{"format":"flarexdb-app-unique-constraint-physical-spec","physicalSpec":{"keyCodecIdentity":"flarex.unique-key/ordered-index-components/v1","keyCodecVersion":1,"kind":"appUniqueConstraint","localePolicy":{"kind":"none"},"orderedFields":["tenantId","email"],"sparse":false,"specVersion":1},"physicalSpecCodecVersion":1}',
    );
    expect(first.canonicalBytesHex).toBe(
      "7b22666f726d6174223a22666c6172657864622d6170702d756e697175652d636f6e73747261696e742d706879736963616c2d73706563222c22706879736963616c53706563223a7b226b6579436f6465634964656e74697479223a22666c617265782e756e697175652d6b65792f6f7264657265642d696e6465782d636f6d706f6e656e74732f7631222c226b6579436f64656356657273696f6e223a312c226b696e64223a22617070556e69717565436f6e73747261696e74222c226c6f63616c65506f6c696379223a7b226b696e64223a226e6f6e65227d2c226f7264657265644669656c6473223a5b2274656e616e744964222c22656d61696c225d2c22737061727365223a66616c73652c227370656356657273696f6e223a317d2c22706879736963616c53706563436f64656356657273696f6e223a317d",
    );
    expect(first.sha256Hex).toBe(
      "de39fece2f05a4b280d4445e246ea6bcbe98140f76d2ba63611f86f439262d24",
    );
    expect(Object.isFrozen(first.physicalSpec.orderedFields)).toBe(true);
  });

  it("binds field order and sparse policy into distinct commitments", async () => {
    const base = await canonicalizeAppUniqueConstraintPhysicalSpecV1(spec(false));
    const sparse = await canonicalizeAppUniqueConstraintPhysicalSpecV1(spec(true));
    const reversed = await canonicalizeAppUniqueConstraintPhysicalSpecV1({
      ...spec(false),
      orderedFields: ["email", "tenantId"],
    });

    expect(sparse.sha256Hex).not.toBe(base.sha256Hex);
    expect(reversed.sha256Hex).not.toBe(base.sha256Hex);
  });

  it("rejects duplicates, empty fields, localization, and unknown members", () => {
    for (const candidate of [
      { ...spec(false), orderedFields: ["email", "email"] },
      { ...spec(false), orderedFields: [] },
      { ...spec(false), localePolicy: { kind: "documentLocale" } },
      { ...spec(false), activation: true },
    ]) {
      expect(Result.isFailure(
        decodeAppUniqueConstraintPhysicalSpecV1Result(candidate),
      )).toBe(true);
    }
  });
});
