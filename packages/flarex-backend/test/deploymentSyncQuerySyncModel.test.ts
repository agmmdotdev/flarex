import type { CommitFeedCommitV1 } from
  "@flarex/persistence-postgres/internal/commit-feed";
import {
  ChangeProjectionLimitError,
  CommittedChangeInvalidError,
  type AuthorityProjectionBudget,
  type ChangeProjectionBudget,
  type SourceCommittedBatch,
} from "@flarex/query-sync/internal/change";
import {
  QueryKeyCollisionError,
  beginQueryEvaluation,
  captureNamespaceCursor,
  captureQueryOperationTarget,
  captureSyncModelId,
  createEmptyQuerySyncState,
  MAX_INLINE_PUBLICATION_CONTENT_BYTES,
} from "@flarex/query-sync/internal/kernel";
import { Effect, Encoding, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  CatalogEdgeDefinitionIdSchema,
  CatalogTableIdSchema,
} from "flarex-protocol/catalog";
import {
  ApplicationActivationSequenceV1Schema,
  ApplicationActiveHeadSha256HexV1Schema,
} from "flarex-protocol/commit-protocol";
import {
  SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
  SCOPE_SYNC_CANONICAL_QUERY_FORMAT_V1,
  SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
  SCOPE_SYNC_PROTOCOL_VERSION_V1,
  ScopeSyncQueryArgumentsSha256HexV1Schema,
  ScopeSyncQueryGenerationSequenceV1Schema,
  ScopeSyncQueryIdentityAccessPolicySha256HexV1Schema,
  ScopeSyncQuerySourcePackageSha256HexV1Schema,
  captureScopeSyncActiveHeadObservationV1,
  captureScopeSyncCanonicalQueryIdentityV1,
  captureScopeSyncDependencyKeyV1,
  type ScopeSyncCanonicalQueryIdentityV1,
  type ScopeSyncDependencyKeyV1,
} from "flarex-protocol/internal/scope-sync-v1";
import {
  SCOPE_SYNC_APPLICATION_QUERY_MODEL_ID_V1,
  SCOPE_SYNC_QUERY_AUTHORITY_FORMAT_V1,
  ScopeSyncQueryModelSha256,
  canonicalizeScopeSyncDependencyKeyV1Result,
  canonicalizeScopeSyncQueryAuthorityV1,
  canonicalizeScopeSyncQueryKeyV1,
  type ScopeSyncDependencyKeyEvidenceV1,
  type ScopeSyncQueryAuthorityEvidenceV1,
  type ScopeSyncQueryKeyEvidenceV1,
  type ScopeSyncQueryModelSha256Api,
} from "flarex-protocol/internal/scope-sync-query-model-v1";
import { CatalogSchemaVersionIdSchema } from
  "flarex-protocol/schema-manifest";
import {
  AppRowIdHexV1Schema,
} from "flarex-protocol/app-document-id";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import {
  canonicalizeFlarexValueV1Effect,
  type CanonicalFlarexValueV1,
} from "flarex-protocol/value";

import {
  FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1,
  ScopeSyncQueryModelMappingV1Error,
  ScopeSyncQueryModelWebCryptoSha256Live,
  captureScopeSyncQueryDescriptorV1Result,
  captureScopeSyncQueryEvaluationProjectionV1Result,
  captureScopeSyncQueryResultProjectionV1Result,
  captureScopeSyncNamespaceCursorV1Result,
  captureScopeSyncQuerySnapshotV1,
  captureScopeSyncNamespaceIdV1,
  captureScopeSyncSourceEpochV1,
  captureScopeSyncSourceSequenceV1,
  flarexApplicationQueryInvalidationProjectorV1,
} from "../src/deploymentSync/QuerySyncModel";

const scopeUuid = ScopeUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000001",
);
const otherScopeUuid = ScopeUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000002",
);
const epochUuid = ScopeEpochUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000003",
);
const otherEpochUuid = ScopeEpochUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000004",
);
const activationSequence = ApplicationActivationSequenceV1Schema.make(3n);
const activeHeadSha256Hex = ApplicationActiveHeadSha256HexV1Schema.make(
  "11".repeat(32),
);
const tableId = CatalogTableIdSchema.make(7);
const edgeDefinitionId = CatalogEdgeDefinitionIdSchema.make(9);
const endpointRowId = AppRowIdHexV1Schema.make("22".repeat(16));
const fullBudget: ChangeProjectionBudget = Object.freeze({
  modelSemanticWorkUnits: 65_536,
  modelSemanticBytes: 16 * 1_024 * 1_024,
  dependencyKeyExaminations: 65_536,
  canonicalDependencyBytes: 16 * 1_024 * 1_024,
});

describe("deployment sync portable query model", () => {
  it("maps exact scope, model, epoch, and signed-int64 sequence primitives", () => {
    const maximum = CommitSeqSchema.make(9_223_372_036_854_775_807n);
    const zero = CommitSeqSchema.make(0n);

    expect(Result.getOrThrow(captureScopeSyncNamespaceIdV1(scopeUuid)))
      .toBe(scopeUuid);
    expect(FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1)
      .toBe(SCOPE_SYNC_APPLICATION_QUERY_MODEL_ID_V1);
    expect(Result.getOrThrow(captureScopeSyncSourceEpochV1(epochUuid)))
      .toBe(epochUuid);
    expect(Result.getOrThrow(captureScopeSyncSourceSequenceV1(maximum)))
      .toBe(maximum);
    expect(Result.getOrThrow(captureScopeSyncQuerySnapshotV1(maximum)))
      .toBe(maximum);
    expect(Result.getOrThrow(captureScopeSyncSourceSequenceV1(zero)))
      .toBe(0n);
    expect(Result.getOrThrow(captureScopeSyncQuerySnapshotV1(zero)))
      .toBe(0n);
  });

  it.each([
    ["zero", 0n],
    ["maximum signed-int64", 9_223_372_036_854_775_807n],
  ] as const)(
    "projects one %s active-head observation into an owned namespace cursor",
    (_case, commitSeq) => {
      const observation = captureScopeSyncActiveHeadObservationV1({
        format: SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        scopeUuid,
        epochUuid,
        storageGeneration: FlarexDbV1StorageGenerationSchema.make(
          "flarexdb_v1",
        ),
        storageGenerationFence: StorageGenerationFenceSchema.make(9n),
        observedAtCommitSeq: CommitSeqSchema.make(commitSeq),
        activationSequence,
        activeHeadSha256Hex,
      });
      const cursor = Result.getOrThrow(
        captureScopeSyncNamespaceCursorV1Result(observation),
      );

      expect(cursor).toEqual({
        namespaceId: scopeUuid,
        syncModelId: FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1,
        sourceEpoch: epochUuid,
        appliedThroughSequence: commitSeq,
      });
      expect(Object.isFrozen(cursor)).toBe(true);
    },
  );

  it("maps one canonical query receipt to its exact portable descriptor", async () => {
    const query = await queryEvidence();
    const descriptor = Result.getOrThrow(
      captureScopeSyncQueryDescriptorV1Result(query),
    );

    expect(descriptor).toEqual({
      queryKey: Encoding.encodeBase64Url(query.sha256),
      queryIdentity: Encoding.encodeBase64Url(query.canonicalBytes),
    });
    expect(Object.isFrozen(descriptor)).toBe(true);
  });

  it("lets the portable core refuse one digest shared by unequal identities", async () => {
    const collisionSha256 = ScopeSyncQueryModelSha256.of({
      digest: () => Effect.succeed(Uint8Array.from({ length: 32 }, () => 0x5a)),
    });
    const firstQuery = await queryEvidenceWith(
      identity(),
      collisionSha256,
    );
    const secondQuery = await queryEvidenceWith(
      identity({ functionPath: "users:other" }),
      collisionSha256,
    );
    const firstDescriptor = Result.getOrThrow(
      captureScopeSyncQueryDescriptorV1Result(firstQuery),
    );
    const secondDescriptor = Result.getOrThrow(
      captureScopeSyncQueryDescriptorV1Result(secondQuery),
    );
    expect(firstDescriptor.queryKey).toBe(secondDescriptor.queryKey);
    expect(firstDescriptor.queryIdentity).not.toBe(
      secondDescriptor.queryIdentity,
    );

    const cursor = Result.getOrThrow(captureNamespaceCursor({
      namespaceId: scopeUuid,
      syncModelId: FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1,
      sourceEpoch: epochUuid,
      appliedThroughSequence: 0n,
    }));
    const initial = Result.getOrThrow(createEmptyQuerySyncState(cursor));
    const firstTarget = Result.getOrThrow(captureQueryOperationTarget({
      namespaceId: scopeUuid,
      syncModelId: FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1,
      sourceEpoch: epochUuid,
      descriptor: firstDescriptor,
    }));
    const secondTarget = Result.getOrThrow(captureQueryOperationTarget({
      namespaceId: scopeUuid,
      syncModelId: FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1,
      sourceEpoch: epochUuid,
      descriptor: secondDescriptor,
    }));
    const begun = Result.getOrThrow(beginQueryEvaluation(initial, Object.freeze({
      target: firstTarget,
      expectedActiveGeneration: null,
      requestedDirtyThroughSequence: null,
    })));
    const failure = expectFailure(beginQueryEvaluation(
      begun.state,
      Object.freeze({
        target: secondTarget,
        expectedActiveGeneration: null,
        requestedDirtyThroughSequence: null,
      }),
    ));

    expect(failure).toBeInstanceOf(QueryKeyCollisionError);
    expect(begun.state.queries[0]?.descriptor).toEqual(firstDescriptor);
  });

  it("projects row, table, and incoming relation keys with exact accounting", () => {
    const commit = commitWithFacts();
    const projected = expectSuccess(
      flarexApplicationQueryInvalidationProjectorV1.projectCommittedBatch(
        sourceBatch(commit),
        fullBudget,
      ),
    );
    const expectedCanonicalBytes = projected.admittedBatch.dependencyKeys
      .reduce((total, key) => total + decodedLength(key), 0);

    expect(projected.admittedBatch.dependencyKeys).toHaveLength(3);
    expect(projected.metrics).toEqual({
      modelSemanticWorkUnits: 4,
      modelSemanticBytes: 62,
      dependencyKeyExaminations: 3,
      canonicalDependencyBytes: expectedCanonicalBytes,
    });
    expect([...projected.admittedBatch.dependencyKeys]).toEqual(
      [...projected.admittedBatch.dependencyKeys].toSorted(),
    );
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.metrics)).toBe(true);
    expect(Object.isFrozen(projected.admittedBatch.dependencyKeys)).toBe(true);
  });

  it("counts duplicate and outgoing facts while deduplicating projected keys", () => {
    const first = commitWithFacts();
    const duplicate = Object.freeze({
      ...first,
      appRowChanges: Object.freeze([
        first.appRowChanges[0]!,
        first.appRowChanges[0]!,
      ]),
    });
    const projected = expectSuccess(
      flarexApplicationQueryInvalidationProjectorV1.projectCommittedBatch(
        sourceBatch(duplicate),
        fullBudget,
      ),
    );

    expect(projected.admittedBatch.dependencyKeys).toHaveLength(3);
    expect(projected.metrics).toMatchObject({
      modelSemanticWorkUnits: 5,
      modelSemanticBytes: 82,
      dependencyKeyExaminations: 5,
    });
    expect(projected.metrics.canonicalDependencyBytes).toBe(
      projected.admittedBatch.dependencyKeys.reduce(
        (total, key) => total + decodedLength(key),
        0,
      ),
    );
  });

  it("admits an empty commit as one empty source batch", () => {
    const commit = baseCommit();
    const projected = expectSuccess(
      flarexApplicationQueryInvalidationProjectorV1.projectCommittedBatch(
        sourceBatch(commit),
        fullBudget,
      ),
    );

    expect(projected.admittedBatch.dependencyKeys).toEqual([]);
    expect(projected.metrics).toEqual({
      modelSemanticWorkUnits: 1,
      modelSemanticBytes: 0,
      dependencyKeyExaminations: 0,
      canonicalDependencyBytes: 0,
    });
  });

  it.each([
    ["namespace", () => Object.freeze({
      ...sourceBatch(baseCommit()),
      namespaceId: Result.getOrThrow(
        captureScopeSyncNamespaceIdV1(otherScopeUuid),
      ),
    })],
    ["model", () => Object.freeze({
      ...sourceBatch(baseCommit()),
      syncModelId: Result.getOrThrow(captureSyncModelId("other-model")),
    })],
    ["epoch", () => Object.freeze({
      ...sourceBatch(baseCommit()),
      sourceEpoch: Result.getOrThrow(
        captureScopeSyncSourceEpochV1(otherEpochUuid),
      ),
    })],
    ["sequence", () => Object.freeze({
      ...sourceBatch(baseCommit()),
      sourceSequence: Result.getOrThrow(captureScopeSyncSourceSequenceV1(
        CommitSeqSchema.make(8n),
      )),
    })],
  ] as const)("rejects a %s envelope mismatch before projection", (
    _field,
    makeBatch,
  ) => {
    const failure = expectFailure(
      flarexApplicationQueryInvalidationProjectorV1.projectCommittedBatch(
        makeBatch(),
        fullBudget,
      ),
    );

    expect(failure).toBeInstanceOf(CommittedChangeInvalidError);
    expect(failure).toMatchObject({
      operation: "projectCommittedBatch",
      reason: "projectionAuthorityMismatch",
    });
  });

  it("translates malformed row input to the portable projection error", () => {
    const commit = Object.freeze({
      ...baseCommit(),
      appRowChanges: Object.freeze([Object.freeze({
        ordinal: 0,
        tableId,
        rowId: new Uint8Array(15),
      })]),
    });
    const failure = expectFailure(
      flarexApplicationQueryInvalidationProjectorV1.projectCommittedBatch(
        sourceBatch(commit),
        fullBudget,
      ),
    );

    expect(failure).toBeInstanceOf(CommittedChangeInvalidError);
    expect(failure).toMatchObject({
      operation: "projectCommittedBatch",
      reason: "invalidPayload",
    });
  });

  it("stops at exact remaining-budget plus one for every batch dimension", () => {
    const batch = sourceBatch(commitWithFacts());
    const complete = expectSuccess(
      flarexApplicationQueryInvalidationProjectorV1.projectCommittedBatch(
        batch,
        fullBudget,
      ),
    ).metrics;

    for (const dimension of [
      "modelSemanticWorkUnits",
      "modelSemanticBytes",
      "dependencyKeyExaminations",
      "canonicalDependencyBytes",
    ] as const) {
      const maximum = complete[dimension] - 1;
      const failure = expectFailure(
        flarexApplicationQueryInvalidationProjectorV1.projectCommittedBatch(
          batch,
          Object.freeze({ ...fullBudget, [dimension]: maximum }),
        ),
      );
      expect(failure).toEqual(new ChangeProjectionLimitError({
        operation: "projectCommittedBatch",
        dimension,
        maximum,
        observed: maximum + 1,
      }));
    }
  });

  it("maps exact authority evidence and enforces both authority budgets", async () => {
    const observation = await authorityEvidence();
    const input = authorityInput(observation);
    const semanticBytes = observation.canonicalBytes.byteLength;
    const completeBudget: AuthorityProjectionBudget = Object.freeze({
      modelSemanticWorkUnits: 1,
      modelSemanticBytes: semanticBytes,
    });
    const projected = expectSuccess(
      flarexApplicationQueryInvalidationProjectorV1
        .projectAuthorityObservation(input, completeBudget),
    );

    expect(projected.authorityWitness).toBe(
      Encoding.encodeBase64Url(observation.sha256),
    );
    expect(projected.metrics).toEqual({
      modelSemanticWorkUnits: 1,
      modelSemanticBytes: semanticBytes,
    });
    for (const dimension of [
      "modelSemanticWorkUnits",
      "modelSemanticBytes",
    ] as const) {
      const maximum = completeBudget[dimension] - 1;
      const failure = expectFailure(
        flarexApplicationQueryInvalidationProjectorV1
          .projectAuthorityObservation(input, Object.freeze({
            ...completeBudget,
            [dimension]: maximum,
          })),
      );
      expect(failure).toEqual(new ChangeProjectionLimitError({
        operation: "projectAuthorityObservation",
        dimension,
        maximum,
        observed: maximum + 1,
      }));
    }
  });

  it.each([
    ["namespace", () => ({
      namespaceId: Result.getOrThrow(
        captureScopeSyncNamespaceIdV1(otherScopeUuid),
      ),
    })],
    ["model", () => ({
      syncModelId: Result.getOrThrow(captureSyncModelId("other-model")),
    })],
    ["epoch", () => ({
      sourceEpoch: Result.getOrThrow(
        captureScopeSyncSourceEpochV1(otherEpochUuid),
      ),
    })],
  ] as const)("rejects authority evidence under another %s envelope", async (
    _field,
    mismatch,
  ) => {
    const observation = await authorityEvidence();
    const failure = expectFailure(
      flarexApplicationQueryInvalidationProjectorV1
        .projectAuthorityObservation(Object.freeze({
          ...authorityInput(observation),
          ...mismatch(),
        }), Object.freeze({
          modelSemanticWorkUnits: 1,
          modelSemanticBytes: observation.canonicalBytes.byteLength,
        })),
    );

    expect(failure).toBeInstanceOf(CommittedChangeInvalidError);
    expect(failure).toMatchObject({
      operation: "projectAuthorityObservation",
      reason: "projectionAuthorityMismatch",
    });
  });

  it("couples one owned Value V1 receipt to evaluation digest and content", async () => {
    const query = await queryEvidence();
    const authority = await authorityEvidence();
    const canonical = await canonicalValue({ ok: true, value: 42 });
    const expectedContent =
      "eyJmb3JtYXQiOiJmbGFyZXgtdmFsdWUiLCJ2YWx1ZSI6eyJvayI6dHJ1ZSwidmFsdWUiOjQyfSwidmFsdWVDb2RlY1ZlcnNpb24iOjF9";
    const expectedDigest =
      "jZDcGU1apeBbH_4q4PYTPPPnHKCytImUN-bkdjyGmqo";
    const projected = expectSuccess(
      captureScopeSyncQueryEvaluationProjectionV1Result({
        query,
        generation: ScopeSyncQueryGenerationSequenceV1Schema.make(1n),
        snapshotCommitSeq: CommitSeqSchema.make(7n),
        authority,
        dependencies: Object.freeze([
          dependencyEvidence(tableDependency()),
          dependencyEvidence(tableDependency()),
          dependencyEvidence(relationDependency()),
        ]),
        result: canonical,
      }),
    );

    canonical.canonicalBytes.fill(0xff);
    canonical.sha256.fill(0xff);
    expect(projected.evaluation.resultDigest).toBe(expectedDigest);
    expect(projected.publication.content).toBe(expectedContent);
    expect(projected.evaluation.authorityWitness).toBe(
      Encoding.encodeBase64Url(authority.sha256),
    );
    expect(projected.evaluation.dependencyKeys).toHaveLength(2);
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.evaluation)).toBe(true);
    expect(Object.isFrozen(projected.publication)).toBe(true);
  });

  it.each([
    ["scopeUuid", () => authorityEvidence({ scopeUuid: otherScopeUuid })],
    ["epochUuid", () => authorityEvidence({ epochUuid: otherEpochUuid })],
    ["activationSequence", () => authorityEvidence({
      activationSequence: ApplicationActivationSequenceV1Schema.make(4n),
    })],
    ["activeHeadSha256Hex", () => authorityEvidence({
      activeHeadSha256Hex:
        ApplicationActiveHeadSha256HexV1Schema.make("66".repeat(32)),
    })],
  ] as const)("refuses query evaluation with mismatched %s authority", async (
    field,
    makeAuthority,
  ) => {
    const query = await queryEvidence();
    const authority = await makeAuthority();
    const failure = expectFailure(
      captureScopeSyncQueryEvaluationProjectionV1Result({
        query,
        generation: ScopeSyncQueryGenerationSequenceV1Schema.make(1n),
        snapshotCommitSeq: CommitSeqSchema.make(7n),
        authority,
        dependencies: Object.freeze([]),
        result: await canonicalValue(null),
      }),
    );

    expect(failure).toBeInstanceOf(ScopeSyncQueryModelMappingV1Error);
    expect(failure).toMatchObject({
      operation: "mapQueryEvaluation",
      reason: "queryAuthorityMismatch",
      field,
    });
  });

  it("rejects canonical result content above the portable inline ceiling", async () => {
    const canonical = await canonicalValue(
      "x".repeat(MAX_INLINE_PUBLICATION_CONTENT_BYTES),
    );
    const failure = expectFailure(
      captureScopeSyncQueryResultProjectionV1Result(canonical),
    );

    expect(failure).toBeInstanceOf(ScopeSyncQueryModelMappingV1Error);
    expect(failure).toMatchObject({
      operation: "mapQueryResult",
      reason: "publicationContentTooLarge",
      maximumBytes: MAX_INLINE_PUBLICATION_CONTENT_BYTES,
      observedBytes: canonical.canonicalBytes.byteLength,
    });

    const composedFailure = expectFailure(
      captureScopeSyncQueryEvaluationProjectionV1Result({
        query: await queryEvidence(),
        generation: ScopeSyncQueryGenerationSequenceV1Schema.make(1n),
        snapshotCommitSeq: CommitSeqSchema.make(7n),
        authority: await authorityEvidence(),
        dependencies: Object.freeze([]),
        result: canonical,
      }),
    );
    expect(composedFailure).toBeInstanceOf(
      ScopeSyncQueryModelMappingV1Error,
    );
    expect(composedFailure).toMatchObject({
      operation: "mapQueryResult",
      reason: "publicationContentTooLarge",
      maximumBytes: MAX_INLINE_PUBLICATION_CONTENT_BYTES,
      observedBytes: canonical.canonicalBytes.byteLength,
    });
  });
});

function identity(
  overrides: Readonly<Partial<ScopeSyncCanonicalQueryIdentityV1>> = {},
): ScopeSyncCanonicalQueryIdentityV1 {
  return captureScopeSyncCanonicalQueryIdentityV1({
    format: SCOPE_SYNC_CANONICAL_QUERY_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid,
    epochUuid,
    activationSequence,
    activeHeadSha256Hex,
    sourcePackageSha256Hex:
      ScopeSyncQuerySourcePackageSha256HexV1Schema.make("33".repeat(32)),
    schemaVersionId: CatalogSchemaVersionIdSchema.make("schema_users_v1"),
    policyVersion: "policy_query_v1",
    componentPath: null,
    functionPath: "users:list",
    argumentsSha256Hex:
      ScopeSyncQueryArgumentsSha256HexV1Schema.make("44".repeat(32)),
    identityAccessPolicySha256Hex:
      ScopeSyncQueryIdentityAccessPolicySha256HexV1Schema.make(
        "55".repeat(32),
      ),
    ...overrides,
  });
}

async function queryEvidence(): Promise<ScopeSyncQueryKeyEvidenceV1> {
  return Effect.runPromise(canonicalizeScopeSyncQueryKeyV1(identity()).pipe(
    Effect.provide(ScopeSyncQueryModelWebCryptoSha256Live),
  ));
}

async function queryEvidenceWith(
  input: unknown,
  sha256: ScopeSyncQueryModelSha256Api,
): Promise<ScopeSyncQueryKeyEvidenceV1> {
  return Effect.runPromise(canonicalizeScopeSyncQueryKeyV1(input).pipe(
    Effect.provideService(ScopeSyncQueryModelSha256, sha256),
  ));
}

async function authorityEvidence(
  overrides: Readonly<{
    scopeUuid?: typeof scopeUuid | typeof otherScopeUuid;
    epochUuid?: typeof epochUuid | typeof otherEpochUuid;
    activationSequence?: typeof activationSequence;
    activeHeadSha256Hex?: typeof activeHeadSha256Hex;
  }> = {},
): Promise<ScopeSyncQueryAuthorityEvidenceV1> {
  return Effect.runPromise(canonicalizeScopeSyncQueryAuthorityV1({
    format: SCOPE_SYNC_QUERY_AUTHORITY_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid: overrides.scopeUuid ?? scopeUuid,
    syncModelId: SCOPE_SYNC_APPLICATION_QUERY_MODEL_ID_V1,
    epochUuid: overrides.epochUuid ?? epochUuid,
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(9n),
    activationSequence: overrides.activationSequence ?? activationSequence,
    activeHeadSha256Hex:
      overrides.activeHeadSha256Hex ?? activeHeadSha256Hex,
  }).pipe(Effect.provide(ScopeSyncQueryModelWebCryptoSha256Live)));
}

async function canonicalValue(value: unknown): Promise<CanonicalFlarexValueV1> {
  return Effect.runPromise(canonicalizeFlarexValueV1Effect(value));
}

function dependencyEvidence(
  dependency: ScopeSyncDependencyKeyV1,
): ScopeSyncDependencyKeyEvidenceV1 {
  return Result.getOrThrow(
    canonicalizeScopeSyncDependencyKeyV1Result(dependency),
  );
}

function tableDependency(): ScopeSyncDependencyKeyV1 {
  return captureScopeSyncDependencyKeyV1({
    format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    kind: "appTable",
    tableId,
  });
}

function relationDependency(): ScopeSyncDependencyKeyV1 {
  return captureScopeSyncDependencyKeyV1({
    format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    kind: "appRelationIncoming",
    edgeDefinitionId,
    targetRowId: endpointRowId,
  });
}

function baseCommit(): CommitFeedCommitV1 {
  return Object.freeze({
    scopeUuid,
    epochUuid,
    commitSeq: CommitSeqSchema.make(7n),
    committedAtMilliseconds: 1_000,
    appRowChanges: Object.freeze([]),
    relationAdjacencyChanges: Object.freeze([]),
  });
}

function commitWithFacts(): CommitFeedCommitV1 {
  return Object.freeze({
    ...baseCommit(),
    appRowChanges: Object.freeze([Object.freeze({
      ordinal: 0,
      tableId,
      rowId: Uint8Array.from({ length: 16 }, () => 0x11),
    })]),
    relationAdjacencyChanges: Object.freeze([
      Object.freeze({
        ordinal: 0,
        edgeDefinitionId,
        direction: "incoming" as const,
        endpointRowId,
      }),
      Object.freeze({
        ordinal: 1,
        edgeDefinitionId,
        direction: "outgoing" as const,
        endpointRowId,
      }),
    ]),
  });
}

function sourceBatch(
  payload: CommitFeedCommitV1,
): SourceCommittedBatch<CommitFeedCommitV1> {
  return Object.freeze({
    namespaceId: Result.getOrThrow(
      captureScopeSyncNamespaceIdV1(payload.scopeUuid),
    ),
    syncModelId: FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1,
    sourceEpoch: Result.getOrThrow(
      captureScopeSyncSourceEpochV1(payload.epochUuid),
    ),
    sourceSequence: Result.getOrThrow(
      captureScopeSyncSourceSequenceV1(payload.commitSeq),
    ),
    payload,
  });
}

function authorityInput(
  observation: ScopeSyncQueryAuthorityEvidenceV1,
) {
  return Object.freeze({
    namespaceId: Result.getOrThrow(
      captureScopeSyncNamespaceIdV1(observation.authority.scopeUuid),
    ),
    syncModelId: FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1,
    sourceEpoch: Result.getOrThrow(
      captureScopeSyncSourceEpochV1(observation.authority.epochUuid),
    ),
    observedThroughSequence: Result.getOrThrow(
      captureScopeSyncSourceSequenceV1(CommitSeqSchema.make(7n)),
    ),
    observation,
  });
}

function decodedLength(value: string): number {
  return Math.floor((value.length * 3) / 4);
}

function expectSuccess<A, E>(result: Result.Result<A, E>): A {
  return Result.match(result, {
    onFailure: (failure) => {
      throw failure;
    },
    onSuccess: success => success,
  });
}

function expectFailure<A, E>(result: Result.Result<A, E>): E {
  return Result.match(result, {
    onFailure: failure => failure,
    onSuccess: () => {
      throw new Error("Expected Result failure.");
    },
  });
}
