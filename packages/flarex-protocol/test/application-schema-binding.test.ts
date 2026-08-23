import { Effect, Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  APPLICATION_MANIFEST_SCHEMA_BINDING_FORMAT_V1,
  APPLICATION_MANIFEST_SCHEMA_BINDING_VERSION_V1,
  APPLICATION_SCHEMA_BINDING_FORMAT,
  APPLICATION_SCHEMA_BINDING_VERSION_V1,
  APPLICATION_SCHEMA_BINDING_VERSION_V2,
  MAX_PHYSICAL_EDGE_DEFINITION_CANONICAL_BYTES_V1,
  MAX_SEMANTIC_RELATION_DEFINITION_CANONICAL_BYTES_V1,
  ApplicationSchemaBindingError,
  canonicalizeApplicationManifestSchemaBinding,
  canonicalizeApplicationSchemaBinding,
  canonicalizeApplicationSchemaBindingV1,
  canonicalizeApplicationSchemaBindingV2,
  canonicalizePhysicalEdgeDefinition,
  canonicalizeSemanticRelationDefinition,
  decodeApplicationSchemaBindingResult,
  type ApplicationManifestSchemaBindingSha256Hex,
  type ApplicationSchemaBindingSha256Hex,
} from "../src/application-schema-binding";

const digest = (byte: string): string => byte.repeat(64 / byte.length);

const declaration = (inverseName: string | null = "posts") => ({
  format: "flarex.relation-declaration" as const,
  version: 1 as const,
  source: {
    table: "posts",
    path: [{ kind: "field" as const, name: "author" }],
    forwardName: "author",
  },
  target: { table: "users" },
  value: { cardinality: "one" as const, required: false },
  inverse: { cardinality: "many" as const, name: inverseName },
  localized: false as const,
  onTargetDelete: "restrict" as const,
});

const semanticDefinition = (
  inverseName?: string | null,
) => ({
  format: "flarex.semantic-relation-definition",
  version: 1,
  applicationSchemaSha256: digest("2"),
  relationId: 7,
  sourceTableId: 11,
  targetTableId: 12,
  declaration: declaration(inverseName),
});

const physicalDefinition = () => ({
  format: "flarex.physical-edge-definition",
  version: 1,
  sourceTableId: 11,
  targetTableId: 12,
  sourcePath: [{ kind: "field", name: "author" }],
  sourceValueExtraction: "scalar",
  duplicates: "forbid",
  localization: { kind: "none" },
  positionRetention: {
    storage: "nullable",
    scalar: "null",
    array: "zeroBasedIndex",
  },
  occurrenceCodec: {
    format: "flarex.relation-occurrence",
    version: 1,
    duplicateOrdinal: 0,
  },
  currentOccurrenceIdentity: [
    "scopeId",
    "edgeDefinitionId",
    "sourceDocumentId",
    "targetDocumentId",
    "duplicateOrdinal",
  ],
  outgoingCurrentAccess: {
    equalityPrefix: [
      "scopeId",
      "edgeDefinitionId",
      "sourceDocumentId",
    ],
    order: ["targetDocumentId", "duplicateOrdinal"],
  },
  incomingCurrentAccess: {
    equalityPrefix: [
      "scopeId",
      "edgeDefinitionId",
      "targetDocumentId",
    ],
    order: ["sourceDocumentId", "duplicateOrdinal"],
  },
  currentProjection: {
    position: "includedNullable",
    commitProvenance: "included",
  },
  incomingPage: {
    maximumLogicalIdentities: 128,
    maximumBaseRows: 129,
    internalFrontier: ["sourceDocumentId", "duplicateOrdinal"],
    exhausted: "allReturnedRowsConsumedAndNoLookahead",
    callerAuthoredCursor: "none",
    maximumTransactionBaseOccurrences: 4_096,
  },
  snapshot: {
    kind: "endpointAdjacencyVersion",
    version: 1,
    key: [
      "scopeId",
      "edgeDefinitionId",
      "direction",
      "endpointDocumentId",
    ],
    value: "lastChangedCommitSeq",
    absentValue: "0",
    advancement: "oncePerAffectedEndpointScopeCommit",
    pageRead: "versionBeforeCurrentPageVersionAfter",
    snapshotEligibility: "versionsEqualAndAtOrBeforeSnapshot",
    dependency: "exactObservedEndpointVersion",
    validationLockOrder: "scopeClockFirst",
    finalValidation: "dependencyUnchanged",
    conflict: "replaceAttemptAndDeterministicallyRerun",
    historyFallback: "forbidden",
  },
});

const tables = [
  { applicationTableId: 1, logicalName: "posts", tableId: 11 },
  { applicationTableId: 2, logicalName: "users", tableId: 12 },
] as const;

async function bindingV2(
  inverseName?: string | null,
  evolution: Readonly<Record<string, unknown>> = { kind: "new" },
) {
  const semantic = await Effect.runPromise(
    canonicalizeSemanticRelationDefinition(semanticDefinition(inverseName)),
  );
  const physical = await Effect.runPromise(
    canonicalizePhysicalEdgeDefinition(physicalDefinition()),
  );
  return {
    format: APPLICATION_SCHEMA_BINDING_FORMAT,
    version: APPLICATION_SCHEMA_BINDING_VERSION_V2,
    deploymentId: "deployment-a",
    applicationSchemaSha256: digest("2"),
    schemaVersionId: "schema-a",
    schemaVersion: 2,
    schemaManifestSha256: digest("3"),
    tables,
    indexes: [],
    relationBindings: [{
      relationOrdinal: 1,
      sourceTableOrdinal: 1,
      targetTableOrdinal: 2,
      relationId: 7,
      sourceTableId: 11,
      targetTableId: 12,
      semanticDefinitionSha256: semantic.sha256Hex,
      edgeDefinitionId: 31,
      evolution,
    }],
    semanticDefinitions: [{
      relationId: 7,
      semanticDefinitionSha256: semantic.sha256Hex,
      definition: semantic.definition,
    }],
    edgeDefinitions: [{
      edgeDefinitionId: 31,
      edgeDefinitionSha256: physical.sha256Hex,
      definition: physical.definition,
    }],
  };
}

describe("application schema binding", () => {
  it("publishes shared per-definition byte ceilings", () => {
    expect(MAX_SEMANTIC_RELATION_DEFINITION_CANONICAL_BYTES_V1).toBe(16_384);
    expect(MAX_PHYSICAL_EDGE_DEFINITION_CANONICAL_BYTES_V1).toBe(16_384);
  });

  it("preserves the exact V1 readiness frame bytes", async () => {
    const canonical = await Effect.runPromise(
      canonicalizeApplicationSchemaBindingV1({
        format: APPLICATION_SCHEMA_BINDING_FORMAT,
        version: APPLICATION_SCHEMA_BINDING_VERSION_V1,
        deploymentId: "deployment-a",
        applicationSchemaSha256: digest("1"),
        schemaVersionId: "schema-a",
        schemaVersion: 1,
        schemaManifestSha256: digest("2"),
        tables: [{
          applicationTableId: 1,
          logicalName: "posts",
          tableId: 11,
        }],
        indexes: [{
          applicationIndexId: 1,
          applicationTableId: 1,
          descriptor: "by_author",
          logicalIndexId: 21,
          tableId: 11,
        }],
      }),
    );

    expect(canonical.canonicalText).toBe(
      `{"applicationSchemaSha256":"${digest("1")}",` +
        `"deploymentId":"deployment-a",` +
        `"format":"flarex.application-schema-binding",` +
        `"indexes":[{"applicationIndexId":1,"applicationTableId":1,` +
        `"descriptor":"by_author","logicalIndexId":21,"tableId":11}],` +
        `"schemaManifestSha256":"${digest("2")}","schemaVersion":1,` +
        `"schemaVersionId":"schema-a",` +
        `"tables":[{"applicationTableId":1,"logicalName":"posts",` +
        `"tableId":11}],"version":1}`,
    );
    const first = canonical.canonicalBytes;
    first[0] = 0;
    expect(canonical.canonicalBytes[0]).toBe("{".charCodeAt(0));
  });

  it("binds complete semantic and R01-P physical meaning in V2", async () => {
    const input = await bindingV2();
    const canonical = await Effect.runPromise(
      canonicalizeApplicationSchemaBindingV2(input),
    );
    const dispatched = await Effect.runPromise(
      canonicalizeApplicationSchemaBinding(input),
    );

    expect(canonical.binding.version).toBe(2);
    expect(canonical.binding.edgeDefinitions[0]?.definition.snapshot).toEqual({
      kind: "endpointAdjacencyVersion",
      version: 1,
      key: [
        "scopeId",
        "edgeDefinitionId",
        "direction",
        "endpointDocumentId",
      ],
      value: "lastChangedCommitSeq",
      absentValue: "0",
      advancement: "oncePerAffectedEndpointScopeCommit",
      pageRead: "versionBeforeCurrentPageVersionAfter",
      snapshotEligibility: "versionsEqualAndAtOrBeforeSnapshot",
      dependency: "exactObservedEndpointVersion",
      validationLockOrder: "scopeClockFirst",
      finalValidation: "dependencyUnchanged",
      conflict: "replaceAttemptAndDeterministicallyRerun",
      historyFallback: "forbidden",
    });
    expect(canonical.binding.edgeDefinitions[0]?.definition.incomingPage)
      .toEqual({
        maximumLogicalIdentities: 128,
        maximumBaseRows: 129,
        internalFrontier: ["sourceDocumentId", "duplicateOrdinal"],
        exhausted: "allReturnedRowsConsumedAndNoLookahead",
        callerAuthoredCursor: "none",
        maximumTransactionBaseOccurrences: 4_096,
      });
    expect(dispatched.sha256Hex).toBe(canonical.sha256Hex);
    expect(Object.isFrozen(canonical.binding.relationBindings)).toBe(true);
    expect(Object.isFrozen(
      canonical.binding.edgeDefinitions[0]?.definition.sourcePath,
    )).toBe(true);
  });

  it("records explicit preserve/reuse evolution without guessing identity", async () => {
    const input = await bindingV2("articles", {
      kind: "preserve",
      fromSchemaVersionId: "schema-prior",
      fromRelationOrdinal: 1,
      physical: "reuse",
      compatibility: {
        declarationCodec: "sameV1",
        changes: ["inverseName"],
      },
    });
    const canonical = await Effect.runPromise(
      canonicalizeApplicationSchemaBindingV2(input),
    );

    expect(canonical.binding.relationBindings[0]?.evolution).toEqual({
      kind: "preserve",
      fromSchemaVersionId: "schema-prior",
      fromRelationOrdinal: 1,
      physical: "reuse",
      compatibility: {
        declarationCodec: "sameV1",
        changes: ["inverseName"],
      },
    });
    expect(canonical.binding.edgeDefinitions[0]?.definition)
      .toEqual(physicalDefinition());
  });

  it("requires canonical compatibility evidence for preserved relations", async () => {
    const valid = await bindingV2("articles", {
      kind: "preserve",
      fromSchemaVersionId: "schema-prior",
      fromRelationOrdinal: 1,
      physical: "reuse",
      compatibility: {
        declarationCodec: "sameV1",
        changes: ["sourcePath", "inverseName"],
      },
    });
    expect(Result.isSuccess(
      decodeApplicationSchemaBindingResult(valid),
    )).toBe(true);

    const selfOrigin = {
      ...valid,
      relationBindings: [{
        ...valid.relationBindings[0],
        evolution: {
          ...valid.relationBindings[0]?.evolution,
          fromSchemaVersionId: valid.schemaVersionId,
        },
      }],
    };
    expect(Result.isFailure(
      decodeApplicationSchemaBindingResult(selfOrigin),
    )).toBe(true);

    const evolution = valid.relationBindings[0]?.evolution;
    for (const compatibility of [
      { declarationCodec: "sameV1", changes: ["inverseName", "sourcePath"] },
      { declarationCodec: "sameV1", changes: ["inverseName", "inverseName"] },
      { declarationCodec: "sameV1", changes: ["inverseName"], inferred: true },
    ]) {
      const candidate = {
        ...valid,
        relationBindings: [{
          ...valid.relationBindings[0],
          evolution: { ...evolution, compatibility },
        }],
      };
      expect(Result.isFailure(
        decodeApplicationSchemaBindingResult(candidate),
      )).toBe(true);
    }

    const missing = {
      ...valid,
      relationBindings: [{
        ...valid.relationBindings[0],
        evolution: {
          kind: "preserve",
          fromSchemaVersionId: "schema-prior",
          fromRelationOrdinal: 1,
          physical: "reuse",
        },
      }],
    };
    expect(Result.isFailure(
      decodeApplicationSchemaBindingResult(missing),
    )).toBe(true);
  });

  it("rejects reordered mappings, broken references, extras, and bad digests", async () => {
    const valid = await bindingV2();
    for (const candidate of [
      { ...valid, tables: valid.tables.toReversed() },
      {
        ...valid,
        relationBindings: [{
          ...valid.relationBindings[0],
          sourceTableId: 12,
        }],
      },
      { ...valid, fallback: true },
    ]) {
      expect(Result.isFailure(
        decodeApplicationSchemaBindingResult(candidate),
      )).toBe(true);
    }

    const badDigest = digest("f");
    const mismatched = {
      ...valid,
      relationBindings: [{
        ...valid.relationBindings[0],
        semanticDefinitionSha256: badDigest,
      }],
      semanticDefinitions: [{
        ...valid.semanticDefinitions[0],
        semanticDefinitionSha256: badDigest,
      }],
    };
    await expect(Effect.runPromise(
      canonicalizeApplicationSchemaBindingV2(mismatched),
    )).rejects.toBeInstanceOf(ApplicationSchemaBindingError);
  });

  it("rejects sharing one physical definition across distinct relations", async () => {
    const valid = await bindingV2();
    const secondSemantic = await Effect.runPromise(
      canonicalizeSemanticRelationDefinition({
        ...semanticDefinition(),
        relationId: 8,
      }),
    );
    const sharedPhysical = {
      ...valid,
      relationBindings: [
        valid.relationBindings[0],
        {
          ...valid.relationBindings[0],
          relationOrdinal: 2,
          relationId: 8,
          semanticDefinitionSha256: secondSemantic.sha256Hex,
        },
      ],
      semanticDefinitions: [
        valid.semanticDefinitions[0],
        {
          relationId: 8,
          semanticDefinitionSha256: secondSemantic.sha256Hex,
          definition: secondSemantic.definition,
        },
      ],
    };

    expect(Result.isFailure(
      decodeApplicationSchemaBindingResult(sharedPhysical),
    )).toBe(true);
  });

  it("pins each analyzed manifest to the reusable bound publication", async () => {
    const canonical = await Effect.runPromise(
      canonicalizeApplicationManifestSchemaBinding({
        format: APPLICATION_MANIFEST_SCHEMA_BINDING_FORMAT_V1,
        version: APPLICATION_MANIFEST_SCHEMA_BINDING_VERSION_V1,
        deploymentId: "deployment-a",
        applicationManifestSha256: digest("1"),
        applicationSchemaSha256: digest("2"),
        schemaVersionId: "schema-a",
        schemaVersion: 2,
        boundPublicationSha256: digest("3"),
      }),
    );

    expect(canonical.binding.applicationManifestSha256).toBe(digest("1"));
    expect(canonical.binding.boundPublicationSha256).toBe(digest("3"));
    expect(canonical.canonicalText).toContain(
      '"format":"flarex.application-manifest-schema-binding"',
    );
    expectTypeOf(canonical.sha256Hex)
      .toEqualTypeOf<ApplicationManifestSchemaBindingSha256Hex>();
    expectTypeOf(canonical.sha256Hex)
      .not.toEqualTypeOf<ApplicationSchemaBindingSha256Hex>();
  });
});
