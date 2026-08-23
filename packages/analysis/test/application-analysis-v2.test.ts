import { Effect, Result, Schema } from "effect";
import type { ValidatorJSON } from "flarex/values";
import { describe, expect, it } from "vitest";

import {
  analyzeLoadedApplicationSourcePackageEffect,
  type ApplicationAnalysis,
} from "../src/index.ts";
import {
  APPLICATION_ANALYSIS_MAXIMUM_RELATIONS,
  ApplicationManifestSchema,
  ApplicationManifestV2Schema,
  canonicalizeApplicationManifest,
  canonicalizeApplicationManifestV2,
  isApplicationManifestV1,
  isApplicationManifestV2,
  makeApplicationManifest,
  makeApplicationManifestV1,
} from "../src/applicationAnalysis.ts";

const digest = (digit: string) => digit.repeat(64);

describe("Application Manifest V2", () => {
  it("emits exact V1 for zero relations and V2 only for relation-bearing analysis", async () => {
    const zeroRelationAnalysis = await analyze(schemaDefinition([]));
    const fromUnion = await Effect.runPromise(makeApplicationManifest(
      zeroRelationAnalysis,
      sourceArtifact(),
    ));
    const fromV1 = await Effect.runPromise(makeApplicationManifestV1(
      zeroRelationAnalysis,
      sourceArtifact(),
    ));

    expect(fromUnion.manifest.version).toBe(1);
    expect(fromUnion.canonicalBytes).toEqual(fromV1.canonicalBytes);
    expect(fromUnion.canonicalText).toBe(fromV1.canonicalText);

    const relationAnalysis = await analyze(schemaDefinition([
      relationOne("posts", "author", "users", "posts"),
    ]));
    const relationBearingManifest = await Effect.runPromise(makeApplicationManifest(
      relationAnalysis,
      sourceArtifact(),
    ));
    expect(relationBearingManifest.manifest.version).toBe(2);
    if (relationBearingManifest.manifest.version !== 2) return;
    expect(relationBearingManifest.manifest.schema.version).toBe(2);
    expect(relationBearingManifest.manifest.schema.relations).toHaveLength(1);
    expect(relationBearingManifest.manifest.schema.relations[0]).toMatchObject({
      relationOrdinal: 1,
      sourceTableOrdinal: 1,
      targetTableOrdinal: 2,
    });
  });

  it("strictly roundtrips, owns, and freezes a canonical V2 manifest", async () => {
    const built = await relationManifest();
    const callerOwned = structuredClone(built.manifest);
    const canonical = Effect.runSync(Effect.fromResult(
      canonicalizeApplicationManifestV2(callerOwned),
    ));

    expect(Reflect.set(
      callerOwned.schema.relations[0]!.declaration.source.path[0]!,
      "name",
      "changed",
    )).toBe(true);
    expect(
      canonical.manifest.schema.relations[0]?.declaration.source.path[0]
        ?.name,
    ).toBe("author");
    expect(Object.isFrozen(canonical.manifest)).toBe(true);
    expect(Object.isFrozen(canonical.manifest.schema.relations)).toBe(
      true,
    );
    expect(canonical.canonicalBytes).toEqual(built.canonicalBytes);

    const schemaDecoded = Effect.runSync(Effect.fromResult(
      Schema.decodeUnknownResult(ApplicationManifestV2Schema)(
        structuredClone(built.manifest),
      ),
    ));
    expect(Object.isFrozen(schemaDecoded)).toBe(true);
    expect(schemaDecoded).toEqual(built.manifest);
  });

  it("rejects unsupported fields and noncanonical ordinal bindings", async () => {
    const built = await relationManifest();
    expect(canonicalizeApplicationManifestV2({
      ...structuredClone(built.manifest),
      futureRelationRuntime: true,
    })).toMatchObject({
      _tag: "Failure",
      failure: { reason: "invalidInput" },
    });

    const wrongOrdinal = structuredClone(built.manifest);
    expect(Reflect.set(
      wrongOrdinal.schema.relations[0]!,
      "relationOrdinal",
      2,
    )).toBe(true);
    expect(canonicalizeApplicationManifestV2(wrongOrdinal)).toMatchObject({
      _tag: "Failure",
      failure: {
        reason: "noncanonicalOrder",
        path: "schema.relations[0]",
      },
    });

    const futureDeclaration = structuredClone(built.manifest);
    const relation = futureDeclaration.schema.relations[0];
    if (relation === undefined) throw new Error("Fixture lost its relation.");
    Object.assign(relation.declaration, { populated: true });
    expect(canonicalizeApplicationManifestV2(futureDeclaration)).toMatchObject({
      _tag: "Failure",
      failure: {
        reason: "invalidSchemaRelationship",
        path: "schema.relations[0].declaration",
      },
    });

    const futureArrayProperty = structuredClone(built.manifest);
    Object.assign(futureArrayProperty.schema.relations, { future: true });
    expect(canonicalizeApplicationManifestV2(futureArrayProperty)).toMatchObject({
      _tag: "Failure",
      failure: { reason: "invalidInput", path: "schema.relations" },
    });

    const accessorEntry = structuredClone(built.manifest);
    let getterCalls = 0;
    Object.defineProperty(accessorEntry.schema.relations, "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return built.manifest.schema.relations[0];
      },
    });
    expect(canonicalizeApplicationManifestV2(accessorEntry)).toMatchObject({
      _tag: "Failure",
      failure: { reason: "invalidInput", path: "schema.relations[0]" },
    });
    expect(getterCalls).toBe(0);
  });

  it("enforces the relation-count ceiling before semantic traversal", async () => {
    const built = await relationManifest();
    const oversized = structuredClone(built.manifest);
    const relation = oversized.schema.relations[0];
    if (relation === undefined) throw new Error("Fixture lost its relation.");
    expect(Reflect.set(oversized.schema, "relations", Array.from(
      { length: APPLICATION_ANALYSIS_MAXIMUM_RELATIONS + 1 },
      () => structuredClone(relation),
    ))).toBe(true);

    expect(canonicalizeApplicationManifestV2(oversized)).toMatchObject({
      _tag: "Failure",
      failure: {
        reason: "limitExceeded",
        path: "schema.relations",
        observed: APPLICATION_ANALYSIS_MAXIMUM_RELATIONS + 1,
        maximum: APPLICATION_ANALYSIS_MAXIMUM_RELATIONS,
      },
    });
  });

  it("selects and narrows the manifest union by its exact version", async () => {
    const v1 = await Effect.runPromise(makeApplicationManifest(
      await analyze(schemaDefinition([])),
      sourceArtifact(),
    ));
    const v2 = await relationManifest();
    const decodedV1 = canonicalizeApplicationManifest(
      structuredClone(v1.manifest),
    );
    const decodedV2 = canonicalizeApplicationManifest(
      structuredClone(v2.manifest),
    );
    expect(Result.isSuccess(decodedV1)).toBe(true);
    expect(Result.isSuccess(decodedV2)).toBe(true);
    if (Result.isFailure(decodedV1) || Result.isFailure(decodedV2)) return;
    expect(isApplicationManifestV1(decodedV1.success.manifest)).toBe(true);
    expect(isApplicationManifestV2(decodedV2.success.manifest)).toBe(true);
    expect(Result.isSuccess(Schema.decodeUnknownResult(
      ApplicationManifestSchema,
    )(structuredClone(v2.manifest)))).toBe(true);
    expect(canonicalizeApplicationManifest({
      ...structuredClone(v1.manifest),
      version: 3,
    })).toMatchObject({
      _tag: "Failure",
      failure: { reason: "invalidInput", path: "version" },
    });
  });

  it("applies the shared one-MiB manifest ceiling to V2", async () => {
    const analysis = await analyze(largeRelationSchemaDefinition());
    const failure = await Effect.runPromise(Effect.flip(makeApplicationManifest(
      analysis,
      sourceArtifact(),
    )));
    expect(failure).toMatchObject({
      _tag: "ApplicationAnalysisContractError",
      operation: "lowerManifest",
      reason: "manifestBytesExceeded",
    });
  });
});

async function relationManifest() {
  const analysis = await analyze(schemaDefinition([
    relationOne("posts", "author", "users", "posts"),
  ]));
  const manifest = await Effect.runPromise(makeApplicationManifest(
    analysis,
    sourceArtifact(),
  ));
  if (manifest.manifest.version !== 2) {
    throw new Error("Expected a relation-bearing Application Manifest V2.");
  }
  return Effect.runSync(Effect.fromResult(
    canonicalizeApplicationManifestV2(manifest.manifest),
  ));
}

async function analyze(schemaDefinitionInput: unknown): Promise<ApplicationAnalysis> {
  return Effect.runPromise(analyzeLoadedApplicationSourcePackageEffect({
    executionModules: {},
    schemaDefinition: schemaDefinitionInput,
    sourceMaps: {},
  }));
}

function schemaDefinition(relations: ReadonlyArray<unknown>) {
  return {
    tables: {
      posts: schemaTable({
        author: {
          fieldType: { type: "id", tableName: "users" },
          optional: false,
        },
      }),
      users: schemaTable({
        name: { fieldType: { type: "string" }, optional: false },
      }),
    },
    relations,
  };
}

function largeRelationSchemaDefinition() {
  const tables: Record<string, unknown> = {};
  const relations: unknown[] = [];
  const targetTable = `target_${"t".repeat(120)}`;
  tables[targetTable] = schemaTable({});
  for (let tableIndex = 0; tableIndex < 16; tableIndex += 1) {
    const sourceTable = `source_${String(tableIndex).padStart(2, "0")}_${
      "s".repeat(116)
    }`;
    const fields: Record<string, {
      readonly fieldType: ValidatorJSON;
      readonly optional: boolean;
    }> = {};
    for (let fieldIndex = 0; fieldIndex < 64; fieldIndex += 1) {
      const field = `field_${String(fieldIndex).padStart(2, "0")}_${
        "f".repeat(231)
      }`;
      fields[field] = {
        fieldType: { type: "id", tableName: targetTable },
        optional: false,
      };
      relations.push(relationOne(
        sourceTable,
        field,
        targetTable,
        null,
      ));
    }
    tables[sourceTable] = schemaTable(fields);
  }
  return { tables, relations };
}

function schemaTable(
  fields: Record<string, { readonly fieldType: ValidatorJSON; readonly optional: boolean }>,
) {
  return {
    kind: "table",
    validator: {
      isFlarexValidator: true,
      json: { type: "object", value: fields },
    },
    indexes: [],
  };
}

function relationOne(
  sourceTable: string,
  field: string,
  targetTable: string,
  inverseName: string | null,
) {
  return {
    format: "flarex.relation-declaration",
    version: 1,
    source: {
      table: sourceTable,
      path: [{ kind: "field", name: field }],
      forwardName: field,
    },
    target: { table: targetTable },
    value: { cardinality: "one", required: true },
    inverse: { cardinality: "many", name: inverseName },
    localized: false,
    onTargetDelete: "restrict",
  } as const;
}

function sourceArtifact() {
  return {
    rootSha256: digest("1"),
    executionModulePath: "_flarex/execution.js",
    schemaModulePath: "_flarex/schema.js",
    modules: [
      {
        path: "_flarex/execution.js",
        roles: 8,
        sourceSha256: digest("2"),
        sourceByteLength: 48,
      },
      {
        path: "_flarex/schema.js",
        roles: 2,
        sourceSha256: digest("3"),
        sourceByteLength: 64,
      },
    ],
  };
}
