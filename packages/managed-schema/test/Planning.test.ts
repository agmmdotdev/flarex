import { Effect } from "effect";
import {
  CatalogSchemaVersionIdSchema,
  decodeSchemaManifestAppSchemaV1,
  SchemaManifestSha256Schema,
  type SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import { describe, expect, it } from "vitest";

import {
  MAX_APP_SCHEMA_EVOLUTION_EVIDENCE_ENTRIES_V1,
  MAX_APP_SCHEMA_EVOLUTION_RENAME_INTENTS_V1,
  planAppSchemaEvolutionV1Effect,
  type AppSchemaEvolutionPlanAuthorityPinsV1,
  type AppSchemaRenameIntentV1,
} from "@flarex/managed-schema/planning";

const stringField = Object.freeze({
  fieldType: Object.freeze({ type: "string" } as const),
  optional: false,
});

describe("managed app-schema planning", () => {
  it("pins a deterministic read-only plan identity without granting apply authority", async () => {
    const current = manifest([
      table(1, "recipes", objectValidator({ name: stringField })),
    ]);
    const first = await runEffect(planAppSchemaEvolutionV1Effect({
      authority: authority(),
      activeManifest: current,
      candidateManifest: current,
    }));
    const second = await runEffect(planAppSchemaEvolutionV1Effect({
      authority: authority(),
      activeManifest: current,
      candidateManifest: current,
    }));

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      format: "flarex.managed-schema/evolution-plan/v1",
      planVersion: 1,
      disposition: "safeMetadataActivation",
      classification: {
        identity: "consistent",
        dataCompatibility: "universallyCompatible",
        physicalRequirements: "unchanged",
      },
      operations: [],
      incompatibilityEvidence: {
        entries: [],
        observedCount: 0,
        truncated: false,
      },
    });
    expect(first.canonicalText).toContain(
      '"dataFrontierCommitSeq":"10"',
    );
    expect(first.planSha256Hex).toBe(
      "5e667f735da149eb758132f51f44bc23c325e02f0332a237face5e9945ee674f",
    );
    expect(first.canonicalText).toBe(
      '{"activationPrerequisites":["activeAuthorityPinsStillMatch","candidateArtifactDigestStillMatches","dataFrontierStillCoversValidation","requiredPhysicalBuildsAreEnabled","planHasNoIdentityBlockers","recomputedPlanDigestMatches"],"authority":{"activeManifestSha256Hex":"0101010101010101010101010101010101010101010101010101010101010101","activeSchemaVersionId":"schema_cooking_v1","candidateManifestSha256Hex":"0202020202020202020202020202020202020202020202020202020202020202","candidateSchemaVersionId":"schema_cooking_v2","dataFrontierCommitSeq":"10","scopeEpoch":"epoch-cooking-2","scopeId":"scope-cooking","storageGeneration":"flarexdb_v1","storageGenerationFence":"7"},"classification":{"dataCompatibility":"universallyCompatible","disposition":"safeMetadataActivation","identity":"consistent","physicalRequirements":"unchanged"},"disposition":"safeMetadataActivation","format":"flarex.managed-schema/evolution-plan/v1","incompatibilityEvidence":{"entries":[],"observedCount":0,"truncated":false},"operations":[],"planVersion":1,"remediationActions":[],"resolvedRenames":[],"rollbackPrerequisites":["previousActiveArtifactRetained","rollbackTargetAuthorityRevalidated","rollbackUsesExistingActivationOwner"]}',
    );
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.authority)).toBe(true);
    expect(Object.isFrozen(first.operations)).toBe(true);
    expect(Object.isFrozen(first.incompatibilityEvidence.entries)).toBe(true);
  });

  it("requires exact intent and clears only stable-ID-preserving renames", async () => {
    const active = manifest(
      [table(1, "recipes", objectValidator({ name: stringField }))],
      [index(1, 1, "by_name", ["name"])],
    );
    const candidate = manifest(
      [table(1, "meals", objectValidator({ name: stringField }))],
      [index(1, 1, "by_title", ["name"])],
    );
    const blocked = await runEffect(planAppSchemaEvolutionV1Effect({
      authority: authority(),
      activeManifest: active,
      candidateManifest: candidate,
    }));
    expect(blocked.disposition).toBe("blocked");
    expect(blocked.incompatibilityEvidence.entries.map((entry) => entry.code))
      .toEqual([
        "explicitIndexRenameIntentRequired",
        "explicitTableRenameIntentRequired",
      ]);

    const resolved = await runEffect(planAppSchemaEvolutionV1Effect({
      authority: authority(),
      activeManifest: active,
      candidateManifest: candidate,
      renameIntents: [
        indexRenameIntent(active, candidate),
        tableRenameIntent(active, candidate),
      ],
    }));
    expect(resolved).toMatchObject({
      disposition: "managedBuildAndValidation",
      classification: {
        identity: "consistent",
        physicalRequirements: "requiresBuildOrRetirement",
      },
      incompatibilityEvidence: { entries: [], observedCount: 0 },
    });
    expect(resolved.resolvedRenames.map((intent) => intent.kind))
      .toEqual(["index", "table"]);
    expect(resolved.operations.map((operation) => operation.safetyClass))
      .toEqual(["requiresPhysicalWork", "metadataOnly"]);

    const reverseOrder = await runEffect(planAppSchemaEvolutionV1Effect({
      authority: authority(),
      activeManifest: active,
      candidateManifest: candidate,
      renameIntents: [
        tableRenameIntent(active, candidate),
        indexRenameIntent(active, candidate),
      ],
    }));
    expect(reverseOrder.planSha256Hex).toBe(resolved.planSha256Hex);
    expect(reverseOrder.canonicalText).toBe(resolved.canonicalText);
  });

  it("never reinterprets a remove-add replacement as a rename", async () => {
    const active = manifest([
      table(1, "recipes", objectValidator({ name: stringField })),
    ]);
    const candidate = manifest([
      table(2, "meals", objectValidator({ name: stringField })),
    ]);
    const plan = await runEffect(planAppSchemaEvolutionV1Effect({
      authority: authority(),
      activeManifest: active,
      candidateManifest: candidate,
    }));
    expect(plan.disposition).toBe("blocked");
    expect(new Set(plan.incompatibilityEvidence.entries.map((entry) => entry.code)))
      .toEqual(new Set([
        "candidateTableEmptinessValidationRequired",
        "tableReplacementAmbiguous",
      ]));
    expect(plan.remediationActions).toContain(
      "regenerateCandidatePreservingStableIdentity",
    );

    await expect(runEffect(planAppSchemaEvolutionV1Effect({
      authority: authority(),
      activeManifest: active,
      candidateManifest: candidate,
      renameIntents: [tableRenameIntent(active, manifest([
        table(1, "meals", objectValidator({ name: stringField })),
      ]))],
    }))).rejects.toMatchObject({
      _tag: "AppSchemaEvolutionPlanningV1Error",
      issue: { reason: "extraneousRenameIntent" },
    });
  });

  it("requires pinned emptiness validation before removing a table", async () => {
    const active = manifest([
      table(1, "recipes", objectValidator({ name: stringField })),
    ]);
    const plan = await runEffect(planAppSchemaEvolutionV1Effect({
      authority: authority(),
      activeManifest: active,
      candidateManifest: manifest([]),
    }));

    expect(plan).toMatchObject({
      disposition: "managedBuildAndValidation",
      classification: {
        identity: "consistent",
        dataCompatibility: "requiresDataValidation",
      },
      incompatibilityEvidence: {
        entries: [{
          code: "candidateTableEmptinessValidationRequired",
          tableId: 1,
          logicalName: "recipes",
        }],
        observedCount: 1,
        truncated: false,
      },
    });
    expect(plan.remediationActions).toContain(
      "emptyRemovedTablesThenReplanAtNewFrontier",
    );
  });

  it("emits bounded non-sensitive validation evidence and pins its data frontier", async () => {
    const active = manifest(Array.from({ length: 300 }, (_, offset) =>
      table(
        offset + 1,
        `table_${offset + 1}`,
        objectValidator({ note: {
          fieldType: { type: "string" },
          optional: true,
        } }),
      )
    ));
    const candidate = manifest(Array.from({ length: 300 }, (_, offset) =>
      table(
        offset + 1,
        `table_${offset + 1}`,
        objectValidator({ note: stringField }),
      )
    ));
    const first = await runEffect(planAppSchemaEvolutionV1Effect({
      authority: authority(),
      activeManifest: active,
      candidateManifest: candidate,
    }));
    expect(first.incompatibilityEvidence).toMatchObject({
      observedCount: 300,
      truncated: true,
    });
    expect(first.incompatibilityEvidence.entries).toHaveLength(
      MAX_APP_SCHEMA_EVOLUTION_EVIDENCE_ENTRIES_V1,
    );
    expect(first.incompatibilityEvidence.entries[0]).toEqual({
      code: "candidateDocumentValidationRequired",
      tableId: 1,
      logicalName: "table_1",
      validatorPath: "$document.note",
      reason: "narrowingOrUnknown",
    });
    expect(first.canonicalText).not.toContain("documentValue");

    const movedFrontier = await runEffect(planAppSchemaEvolutionV1Effect({
      authority: authority({ dataFrontierCommitSeq: 11n }),
      activeManifest: active,
      candidateManifest: candidate,
    }));
    expect(movedFrontier.planSha256Hex).not.toBe(first.planSha256Hex);
  });

  it("rejects duplicate, extraneous, and over-budget rename intent before hashing", async () => {
    const active = manifest([
      table(1, "recipes", objectValidator({ name: stringField })),
    ]);
    const candidate = manifest([
      table(1, "meals", objectValidator({ name: stringField })),
    ]);
    const intent = tableRenameIntent(active, candidate);

    await expect(runEffect(planAppSchemaEvolutionV1Effect({
      authority: authority(),
      activeManifest: active,
      candidateManifest: candidate,
      renameIntents: [intent, intent],
    }))).rejects.toMatchObject({
      issue: { reason: "duplicateRenameIntent" },
    });

    await expect(runEffect(planAppSchemaEvolutionV1Effect({
      authority: authority(),
      activeManifest: active,
      candidateManifest: active,
      renameIntents: [intent],
    }))).rejects.toMatchObject({
      issue: { reason: "extraneousRenameIntent" },
    });

    await expect(runEffect(planAppSchemaEvolutionV1Effect({
      authority: authority(),
      activeManifest: active,
      candidateManifest: candidate,
      renameIntents: Array.from(
        { length: MAX_APP_SCHEMA_EVOLUTION_RENAME_INTENTS_V1 + 1 },
        () => intent,
      ),
    }))).rejects.toMatchObject({
      issue: {
        reason: "limitExceeded",
        dimension: "renameIntents",
        observed: MAX_APP_SCHEMA_EVOLUTION_RENAME_INTENTS_V1 + 1,
        maximum: MAX_APP_SCHEMA_EVOLUTION_RENAME_INTENTS_V1,
      },
    });
  });

  it("rejects an oversized plan before allocating its canonical text and bytes", async () => {
    const activeTables = Array.from({ length: 10_000 }, (_, offset) =>
      table(
        offset + 1,
        largePlanTableName(offset),
        objectValidator({ name: stringField }),
      )
    );
    const candidateTables = Array.from({ length: 10_000 }, (_, offset) =>
      table(
        offset + 10_001,
        largePlanTableName(offset),
        objectValidator({ name: stringField }),
      )
    );

    await expect(runEffect(planAppSchemaEvolutionV1Effect({
      authority: authority(),
      activeManifest: manifest(activeTables),
      candidateManifest: manifest(candidateTables),
    }))).rejects.toMatchObject({
      issue: {
        reason: "limitExceeded",
        dimension: "canonicalBytes",
        maximum: 4 * 1024 * 1024,
      },
    });
  });
});

function authority(
  overrides: Readonly<{ readonly dataFrontierCommitSeq?: bigint }> = {},
): AppSchemaEvolutionPlanAuthorityPinsV1 {
  return {
    scopeId: ScopeIdSchema.make("scope-cooking"),
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(7n),
    scopeEpoch: ScopeEpochSchema.make("epoch-cooking-2"),
    activeSchemaVersionId: CatalogSchemaVersionIdSchema.make("schema_cooking_v1"),
    activeManifestSha256: SchemaManifestSha256Schema.make(new Uint8Array(32).fill(1)),
    candidateSchemaVersionId: CatalogSchemaVersionIdSchema.make("schema_cooking_v2"),
    candidateManifestSha256: SchemaManifestSha256Schema.make(new Uint8Array(32).fill(2)),
    dataFrontierCommitSeq: CommitSeqSchema.make(
      overrides.dataFrontierCommitSeq ?? 10n,
    ),
  };
}

function tableRenameIntent(
  active: SchemaManifestAppSchemaV1,
  candidate: SchemaManifestAppSchemaV1,
): Extract<AppSchemaRenameIntentV1, { readonly kind: "table" }> {
  const activeTable = active.tableDefinitions.tables[0];
  const candidateTable = candidate.tableDefinitions.tables[0];
  if (activeTable === undefined || candidateTable === undefined) {
    throw new Error("rename fixture requires one table");
  }
  return {
    kind: "table",
    tableId: activeTable.tableId,
    fromLogicalName: activeTable.logicalName,
    toLogicalName: candidateTable.logicalName,
  };
}

function indexRenameIntent(
  active: SchemaManifestAppSchemaV1,
  candidate: SchemaManifestAppSchemaV1,
): Extract<AppSchemaRenameIntentV1, { readonly kind: "index" }> {
  const activeIndex = active.indexBindings.indexes[0];
  const candidateIndex = candidate.indexBindings.indexes[0];
  if (activeIndex === undefined || candidateIndex === undefined) {
    throw new Error("rename fixture requires one index");
  }
  return {
    kind: "index",
    logicalIndexId: activeIndex.logicalIndexId,
    tableId: activeIndex.tableId,
    fromDescriptor: activeIndex.descriptor,
    toDescriptor: candidateIndex.descriptor,
  };
}

function manifest(
  tables: ReadonlyArray<Readonly<Record<string, unknown>>>,
  indexes: ReadonlyArray<Readonly<Record<string, unknown>>> = [],
): SchemaManifestAppSchemaV1 {
  return decodeSchemaManifestAppSchemaV1({
    kind: "appSchema",
    manifestVersion: 1,
    tableDefinitions: {
      kind: "tableDefinitions",
      sectionVersion: 1,
      tables,
    },
    indexBindings: {
      kind: "indexBindings",
      sectionVersion: 1,
      indexes,
    },
  });
}

function table(
  tableId: number,
  logicalName: string,
  documentType: ValidatorJsonV1,
): Readonly<Record<string, unknown>> {
  return {
    tableId,
    namespace: "app",
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType,
    },
  };
}

function index(
  logicalIndexId: number,
  tableId: number,
  descriptor: string,
  fields: ReadonlyArray<string>,
): Readonly<Record<string, unknown>> {
  return {
    logicalIndexId,
    tableId,
    namespace: "app",
    descriptor,
    spec: {
      kind: "developerOrdered",
      specVersion: 1,
      fields,
    },
  };
}

function objectValidator(
  fields: Readonly<Record<string, Readonly<{
    readonly fieldType: ValidatorJsonV1;
    readonly optional: boolean;
  }>>>,
): Extract<ValidatorJsonV1, { readonly type: "object" }> {
  return { type: "object", value: fields };
}

function largePlanTableName(offset: number): string {
  return `table_${offset.toString().padStart(5, "0")}_${"x".repeat(48)}`;
}

function runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}
