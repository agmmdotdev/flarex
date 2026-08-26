import { webcrypto } from "node:crypto";

import {
  canonicalizeApplicationManifestV2,
  type ApplicationManifestV2,
} from "@flarex/analysis/application-analysis";
import {
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { Result } from "effect";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  decodeCatalogEdgeDefinitionId,
  decodeCatalogRelationId,
  decodeCatalogTableId,
} from "flarex-protocol/catalog";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import { beforeAll, describe, expect, it } from "vitest";

import {
  publishApplicationRelationBindingEffect,
  type ApplicationRelationBindingRepository,
  type PublishApplicationRelationBindingInput,
} from "../src/applicationRelationBinding";
import {
  ApplicationRelationCommitCorruptionError,
  ApplicationRelationCommitResourceExhaustionError,
  ApplicationRelationConstraintError,
  ApplicationRelationTargetNotLiveError,
  createApplicationRelationCommitPort,
  hasPreparedApplicationRelationCommitAuthority,
  lowerApplicationRelationCommitResult,
  prepareApplicationRelationCommitResult,
  type ApplicationRelationRowTransition,
  type LocatedApplicationRelationDefinitionSet,
} from "../src/applicationRelationCommit";
import { createPGlitePersistence } from "../src/pglite";
import type { PointMutationSessionAuthorityResolutionPortsV1 } from
  "../src/transactionSessionActivation";
import { runEffect } from "./effectTestRuntime";

type PGlitePersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

let persistence: PGlitePersistence;
let sequence = 0;

beforeAll(async () => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
  persistence = await createPGlitePersistence();
  await persistence.migrate();
});

describe("C09 application relation commit lowering", () => {
  it("lowers a same-commit live target without a stored-target check", async () => {
    const fixture = await relationFixture();
    const target = documentIdentity(2, 1);
    const source = documentIdentity(1, 2);
    const targetDocument = await appDocument(target, { name: "Ada" }, 1);
    const sourceDocument = await appDocument(
      source,
      { author: target.documentId },
      2,
    );
    const prepared = Result.getOrThrow(prepareApplicationRelationCommitResult(
      fixture.definitions,
      Object.freeze([
        transition(target, null, targetDocument),
        transition(source, null, sourceDocument),
      ]),
    ));

    expect(prepared.actions).toHaveLength(1);
    expect(prepared.actions[0]).toMatchObject({
      kind: "put",
      occurrence: {
        sourceDocumentId: source.documentId,
        targetDocumentId: target.documentId,
      },
      position: null,
    });
    expect(prepared.adjacencyChanges).toEqual([
      {
        edgeDefinitionId:
          fixture.definitions.definitions[0]?.edge.edgeDefinitionId,
        direction: "outgoing",
        endpointRowId: source.rowId,
      },
      {
        edgeDefinitionId:
          fixture.definitions.definitions[0]?.edge.edgeDefinitionId,
        direction: "incoming",
        endpointRowId: target.rowId,
      },
    ]);
    expect(Object.isFrozen(prepared.adjacencyChanges)).toBe(true);
    expect(prepared.adjacencyChanges.every(Object.isFrozen)).toBe(true);
    expect(prepared.storedTargetChecks).toEqual([]);
    expect(prepared.distinctFinalTargetCount).toBe(1);
    expect(hasPreparedApplicationRelationCommitAuthority(
      fixture.port,
      prepared,
      fixture.definitions.schemaVersionId,
    )).toBe(true);
  });

  it("emits one deterministic stored-target check and rejects a final tombstone", async () => {
    const fixture = await relationFixture();
    const target = documentIdentity(2, 3);
    const source = documentIdentity(1, 4);
    const sourceDocument = await appDocument(
      source,
      { author: target.documentId },
      4,
    );
    const stored = Result.getOrThrow(prepareApplicationRelationCommitResult(
      fixture.definitions,
      Object.freeze([transition(source, null, sourceDocument)]),
    ));
    expect(stored.storedTargetChecks).toEqual([expect.objectContaining({
      documentId: target.documentId,
      sourceDocumentId: source.documentId,
    })]);

    const targetDocument = await appDocument(target, { name: "Grace" }, 3);
    const deleted = prepareApplicationRelationCommitResult(
      fixture.definitions,
      Object.freeze([
        transition(source, null, sourceDocument),
        transition(target, targetDocument, null),
      ]),
    );
    expect(Result.isFailure(deleted)).toBe(true);
    if (Result.isFailure(deleted)) {
      expect(deleted.failure).toBeInstanceOf(
        ApplicationRelationTargetNotLiveError,
      );
    }
  });

  it("classifies prior invalid values as corruption and final invalid values as constraints", async () => {
    const fixture = await relationFixture();
    const source = documentIdentity(1, 5);
    const invalid = await appDocument(source, { author: "not-an-id" }, 5);
    const prior = lowerApplicationRelationCommitResult(
      fixture.definitions,
      Object.freeze([transition(source, invalid, null)]),
    );
    const final = lowerApplicationRelationCommitResult(
      fixture.definitions,
      Object.freeze([transition(source, null, invalid)]),
    );

    expect(Result.isFailure(prior)).toBe(true);
    if (Result.isFailure(prior)) {
      expect(prior.failure).toBeInstanceOf(
        ApplicationRelationCommitCorruptionError,
      );
      expect(prior.failure).toMatchObject({
        reason: "invalidPriorRelationValue",
      });
    }
    expect(Result.isFailure(final)).toBe(true);
    if (Result.isFailure(final)) {
      expect(final.failure).toBeInstanceOf(ApplicationRelationConstraintError);
      expect(final.failure).toMatchObject({ reason: "invalidRelationValue" });
    }
  });

  it("distinguishes optional scalar absence from a missing required relation", async () => {
    const optionalFixture = await relationFixture({ required: false });
    const requiredFixture = await relationFixture();
    const source = documentIdentity(1, 16);
    const withoutRelation = await appDocument(source, { title: "Draft" }, 16);

    const optional = Result.getOrThrow(lowerApplicationRelationCommitResult(
      optionalFixture.definitions,
      Object.freeze([transition(source, null, withoutRelation)]),
    ));
    expect(optional.actions).toEqual([]);
    expect(optional.adjacencyChanges).toEqual([]);
    expect(optional.finalOccurrenceCount).toBe(0);

    const required = lowerApplicationRelationCommitResult(
      requiredFixture.definitions,
      Object.freeze([transition(source, null, withoutRelation)]),
    );
    expect(Result.isFailure(required)).toBe(true);
    if (Result.isFailure(required)) {
      expect(required.failure).toBeInstanceOf(ApplicationRelationConstraintError);
      expect(required.failure).toMatchObject({ reason: "missingRequiredValue" });
    }
  });

  it("enforces many-value minimum and maximum cardinality", async () => {
    const fixture = await relationFixture({
      many: true,
      minimumItems: 1,
      maximumItems: 2,
    });
    const source = documentIdentity(1, 17);
    const targets = [
      documentIdentity(2, 18).documentId,
      documentIdentity(2, 19).documentId,
      documentIdentity(2, 20).documentId,
    ];
    const tooSmall = await appDocument(source, { author: [] }, 17);
    const tooLarge = await appDocument(source, { author: targets }, 17);

    for (const document of [tooSmall, tooLarge]) {
      const result = lowerApplicationRelationCommitResult(
        fixture.definitions,
        Object.freeze([transition(source, null, document)]),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(
          ApplicationRelationConstraintError,
        );
        expect(result.failure).toMatchObject({
          reason: "relationCardinalityViolation",
        });
      }
    }
  });

  it("rejects duplicate array targets and lowers a reorder without put/remove", async () => {
    const fixture = await relationFixture({ many: true });
    const source = documentIdentity(1, 6);
    const targetA = documentIdentity(2, 7);
    const targetB = documentIdentity(2, 8);
    const duplicated = await appDocument(source, {
      author: [targetA.documentId, targetA.documentId],
    }, 6);
    const duplicateResult = lowerApplicationRelationCommitResult(
      fixture.definitions,
      Object.freeze([transition(source, null, duplicated)]),
    );
    expect(Result.isFailure(duplicateResult)).toBe(true);
    if (Result.isFailure(duplicateResult)) {
      expect(duplicateResult.failure).toBeInstanceOf(
        ApplicationRelationConstraintError,
      );
      expect(duplicateResult.failure).toMatchObject({ reason: "duplicateTarget" });
    }

    const prior = await appDocument(source, {
      author: [targetA.documentId, targetB.documentId],
    }, 6);
    const final = await appDocument(source, {
      author: [targetB.documentId, targetA.documentId],
    }, 6);
    const reordered = Result.getOrThrow(lowerApplicationRelationCommitResult(
      fixture.definitions,
      Object.freeze([transition(source, prior, final)]),
    ));
    expect(reordered.actions).toHaveLength(2);
    expect(reordered.actions.every((action) => action.kind === "reorder"))
      .toBe(true);
    expect(reordered.actions.map((action) => action.kind === "reorder"
      ? action.position
      : null)).toEqual([1, 0]);
    expect(reordered.adjacencyChanges).toEqual([
      expect.objectContaining({
        direction: "outgoing",
        endpointRowId: source.rowId,
      }),
      expect.objectContaining({
        direction: "incoming",
        endpointRowId: targetA.rowId,
      }),
      expect.objectContaining({
        direction: "incoming",
        endpointRowId: targetB.rowId,
      }),
    ]);
  });

  it("does not authenticate a plan produced only by the pure lowerer", async () => {
    const fixture = await relationFixture();
    const target = documentIdentity(2, 9);
    const source = documentIdentity(1, 10);
    const sourceDocument = await appDocument(
      source,
      { author: target.documentId },
      10,
    );
    const pure = Result.getOrThrow(lowerApplicationRelationCommitResult(
      fixture.definitions,
      Object.freeze([transition(source, null, sourceDocument)]),
    ));
    expect(hasPreparedApplicationRelationCommitAuthority(
      fixture.port,
      pure,
      fixture.definitions.schemaVersionId,
    )).toBe(false);
  });

  it("lowers scalar retarget and source deletion through exact remove and put phases", async () => {
    const fixture = await relationFixture();
    const source = documentIdentity(1, 11);
    const targetA = documentIdentity(2, 12);
    const targetB = documentIdentity(2, 13);
    const prior = await appDocument(source, { author: targetA.documentId }, 11);
    const final = await appDocument(source, { author: targetB.documentId }, 11);
    const retargeted = Result.getOrThrow(lowerApplicationRelationCommitResult(
      fixture.definitions,
      Object.freeze([transition(source, prior, final)]),
    ));
    expect(retargeted.actions.map((action) => action.kind)).toEqual([
      "remove",
      "put",
    ]);
    expect(retargeted.actions.map((action) =>
      action.occurrence.targetDocumentId
    )).toEqual([targetA.documentId, targetB.documentId]);
    expect(retargeted.adjacencyChanges).toEqual([
      expect.objectContaining({
        direction: "outgoing",
        endpointRowId: source.rowId,
      }),
      expect.objectContaining({
        direction: "incoming",
        endpointRowId: targetA.rowId,
      }),
      expect.objectContaining({
        direction: "incoming",
        endpointRowId: targetB.rowId,
      }),
    ]);

    const deleted = Result.getOrThrow(lowerApplicationRelationCommitResult(
      fixture.definitions,
      Object.freeze([transition(source, prior, null)]),
    ));
    expect(deleted.actions).toEqual([
      expect.objectContaining({
        kind: "remove",
        occurrence: expect.objectContaining({
          sourceDocumentId: source.documentId,
          targetDocumentId: targetA.documentId,
        }),
      }),
    ]);
    expect(deleted.adjacencyChanges).toEqual([
      expect.objectContaining({
        direction: "outgoing",
        endpointRowId: source.rowId,
      }),
      expect.objectContaining({
        direction: "incoming",
        endpointRowId: targetA.rowId,
      }),
    ]);
  });

  it("keeps exact physical definitions isolated during stale-edge cleanup", async () => {
    const fixture = await relationFixture();
    const first = fixture.definitions.definitions[0];
    if (first === undefined) throw new Error("Missing first C09 definition.");
    const relationId = decodeCatalogRelationId(Number(first.binding.relationId) + 1);
    const edgeDefinitionId = decodeCatalogEdgeDefinitionId(
      Number(first.binding.edgeDefinitionId) + 1,
    );
    const replacement = Object.freeze({
      binding: Object.freeze({
        ...first.binding,
        relationOrdinal: first.binding.relationOrdinal + 1,
        relationId,
        edgeDefinitionId,
      }),
      semantic: Object.freeze({ ...first.semantic, relationId }),
      edge: Object.freeze({ ...first.edge, relationId, edgeDefinitionId }),
    });
    const definitions = Object.freeze({
      ...fixture.definitions,
      definitions: Object.freeze([first, replacement]),
    });
    const source = documentIdentity(1, 14);
    const target = documentIdentity(2, 15);
    const prior = await appDocument(source, { author: target.documentId }, 14);
    const cleaned = Result.getOrThrow(lowerApplicationRelationCommitResult(
      definitions,
      Object.freeze([transition(source, prior, null)]),
    ));

    expect(cleaned.actions).toHaveLength(2);
    expect(cleaned.actions.map((action) => action.definition.edgeDefinitionId))
      .toEqual([first.edge.edgeDefinitionId, edgeDefinitionId]);
    expect(cleaned.actions.every((action) => action.kind === "remove")).toBe(
      true,
    );
    expect(cleaned.adjacencyChanges).toHaveLength(4);
  });

  it("fails final and prior occurrence limits at the frozen maximum plus one", async () => {
    const fixture = await relationFixture({
      many: true,
      maximumItems: 1_024,
    });
    const targets = Array.from({ length: 1_024 }, (_, index) =>
      documentIdentity(2, 1_000 + index).documentId
    );
    const transitions = await Promise.all(
      Array.from({ length: 5 }, async (_, index) => {
        const source = documentIdentity(1, 3_000 + index);
        const document = await appDocument(
          source,
          { author: index === 4 ? [targets[0]] : targets },
          3_000 + index,
        );
        return transition(source, null, document);
      }),
    );
    const result = lowerApplicationRelationCommitResult(
      fixture.definitions,
      Object.freeze(transitions),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(
        ApplicationRelationCommitResourceExhaustionError,
      );
      expect(result.failure).toMatchObject({
        dimension: "finalOccurrences",
        observed: 4_097,
        maximum: 4_096,
      });
    }

    const priorResult = lowerApplicationRelationCommitResult(
      fixture.definitions,
      Object.freeze(transitions.map((current) => Object.freeze({
        ...current,
        prior: current.final,
        final: null,
      }))),
    );
    expect(Result.isFailure(priorResult)).toBe(true);
    if (Result.isFailure(priorResult)) {
      expect(priorResult.failure).toBeInstanceOf(
        ApplicationRelationCommitResourceExhaustionError,
      );
      expect(priorResult.failure).toMatchObject({
        dimension: "priorOccurrences",
        observed: 4_097,
        maximum: 4_096,
      });
    }
  });

  it("fails the emitted action limit before sidecar publication", async () => {
    const fixture = await relationFixture({
      many: true,
      maximumItems: 1_024,
    });
    const transitions = await Promise.all(
      [1_024, 1_024, 1].map(async (count, transitionIndex) => {
        const source = documentIdentity(1, 8_000 + transitionIndex);
        const priorTargets = Array.from({ length: count }, (_, index) =>
          documentIdentity(
            2,
            10_000 + transitionIndex * 2_000 + index,
          ).documentId
        );
        const finalTargets = Array.from({ length: count }, (_, index) =>
          documentIdentity(
            2,
            20_000 + transitionIndex * 2_000 + index,
          ).documentId
        );
        return transition(
          source,
          await appDocument(source, { author: priorTargets }, 8_000),
          await appDocument(source, { author: finalTargets }, 8_000),
        );
      }),
    );

    const result = lowerApplicationRelationCommitResult(
      fixture.definitions,
      Object.freeze(transitions),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(
        ApplicationRelationCommitResourceExhaustionError,
      );
      expect(result.failure).toMatchObject({
        dimension: "edgeActions",
        observed: 4_098,
        maximum: 4_096,
      });
    }
  });

  it("fails the restrict-probe limit at the frozen maximum plus one", async () => {
    const fixture = await relationFixture();
    const transitions = Array.from({ length: 4_097 }, (_, index) =>
      transition(documentIdentity(2, 30_000 + index), null, null)
    );

    const result = lowerApplicationRelationCommitResult(
      fixture.definitions,
      Object.freeze(transitions),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(
        ApplicationRelationCommitResourceExhaustionError,
      );
      expect(result.failure).toMatchObject({
        dimension: "restrictProbes",
        observed: 4_097,
        maximum: 4_096,
      });
    }
  });
});

interface RelationFixtureOptions {
  readonly many?: boolean;
  readonly minimumItems?: number;
  readonly maximumItems?: number;
  readonly required?: boolean;
}

async function relationFixture(
  options: RelationFixtureOptions = {},
): Promise<Readonly<{
  readonly port: ReturnType<typeof createApplicationRelationCommitPort>;
  readonly definitions: LocatedApplicationRelationDefinitionSet;
}>> {
  sequence += 1;
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_c09_lowering_${sequence}`,
  );
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_c09_lowering_${sequence}`,
  });
  const publication = await runEffect(publishApplicationRelationBindingEffect(
    repositoryFor(persistence),
    await publicationInput(deploymentId, options),
  ));
  const authority = pointCommitAuthority(persistence);
  const port = createApplicationRelationCommitPort(
    persistence.drizzle,
    authority,
  );
  const definitions = await runEffect(port.locate({
    deploymentId,
    schemaVersionId: publication.binding.schemaVersionId,
  }));
  if (definitions === null) throw new Error("Missing C09 definition set.");
  return Object.freeze({ port, definitions });
}

function pointCommitAuthority(
  selected: PGlitePersistence,
): PointMutationSessionAuthorityResolutionPortsV1 {
  return Object.freeze({
    scopeMetadata: selected,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("A shared C09 fixture must not read split receipts.");
      },
    },
    scopeSessionTargets: {
      resolve: async () => {
        throw new Error("The pure C09 fixture must not open a transaction.");
      },
    },
  });
}

function repositoryFor(
  selected: PGlitePersistence,
): ApplicationRelationBindingRepository {
  return {
    db: selected.drizzle,
    runTransaction: run => selected.drizzle.transaction(run),
  };
}

async function publicationInput(
  deploymentId: string,
  options: RelationFixtureOptions,
): Promise<PublishApplicationRelationBindingInput> {
  const canonical = Result.getOrThrow(canonicalizeApplicationManifestV2(
    manifestInput(
      `${sequence}`.padStart(64, "a").slice(-64),
      options,
    ),
  ));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(canonical.canonicalBytes),
  ));
  return Object.freeze({
    deploymentId,
    manifest: canonical.manifest,
    manifestSha256: encodeBytesToLowercaseHex(digest),
    decisions: Object.freeze([{
      relationOrdinal: 1,
      evolution: Object.freeze({ kind: "new" as const }),
    }]),
  });
}

function manifestInput(
  rootSha256: string,
  options: RelationFixtureOptions,
): ApplicationManifestV2 {
  const many = options.many ?? false;
  const minimumItems = options.minimumItems ?? 0;
  const maximumItems = options.maximumItems ?? 32;
  const required = options.required ?? true;
  return Result.getOrThrow(canonicalizeApplicationManifestV2({
    format: "flarex.application-manifest",
    version: 2,
    sourceArtifact: {
      rootSha256,
      executionModulePath: "functions.js",
      schemaModulePath: "schema.js",
      modules: [{
        path: "functions.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
        sourceSha256: "e".repeat(64),
        sourceByteLength: 18,
      }, {
        path: "schema.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
        sourceSha256: "f".repeat(64),
        sourceByteLength: 32,
      }],
    },
    schema: {
      version: 2,
      tables: [{
        tableId: 1,
        name: "posts",
        validator: {
          type: "object",
          value: {
            author: {
              fieldType: many
                ? {
                    type: "array",
                    value: { type: "id", tableName: "users" },
                  }
                : { type: "id", tableName: "users" },
              optional: many ? false : !required,
            },
          },
        },
        placement: { kind: "global" },
      }, {
        tableId: 2,
        name: "users",
        validator: {
          type: "object",
          value: {
            name: {
              fieldType: { type: "string" },
              optional: false,
            },
          },
        },
        placement: { kind: "global" },
      }],
      indexes: [],
      relations: [{
        relationOrdinal: 1,
        sourceTableOrdinal: 1,
        targetTableOrdinal: 2,
        declaration: {
          format: "flarex.relation-declaration",
          version: 1,
          source: {
            table: "posts",
            path: [{ kind: "field", name: "author" }],
            forwardName: "author",
          },
          target: { table: "users" },
          value: many
            ? {
                cardinality: "many",
                minItems: minimumItems,
                maxItems: maximumItems,
                ordered: true,
                duplicates: "forbid",
              }
            : { cardinality: "one", required },
          inverse: { cardinality: "many", name: "posts" },
          localized: false,
          onTargetDelete: "restrict",
        },
      }],
    },
    functions: [],
  })).manifest;
}

function documentIdentity(tableId: number, ordinal: number) {
  const catalogTableId = decodeCatalogTableId(tableId);
  const rowId = decodeAppRowIdHexV1(ordinal.toString(16).padStart(32, "0"));
  return Object.freeze({
    tableId: catalogTableId,
    rowId,
    documentId: appDocumentIdV1FromRowIdentity({
      tableId: catalogTableId,
      rowId,
    }),
  });
}

async function appDocument(
  identity: ReturnType<typeof documentIdentity>,
  fields: Readonly<Record<string, unknown>>,
  creationTime: number,
) {
  return canonicalizeAppDocumentV1({
    tableId: identity.tableId,
    rowId: identity.rowId,
    creationTime: decodeAppCreationTimeV1(creationTime),
    fields,
  });
}

function transition(
  identity: ReturnType<typeof documentIdentity>,
  prior: Awaited<ReturnType<typeof appDocument>> | null,
  final: Awaited<ReturnType<typeof appDocument>> | null,
): ApplicationRelationRowTransition {
  return Object.freeze({
    documentId: identity.documentId,
    tableId: identity.tableId,
    rowId: identity.rowId,
    prior,
    final,
  });
}
