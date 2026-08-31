import type { DatabaseSync } from "node:sqlite";

import {
  MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS,
  MAX_CANONICAL_DEPENDENCY_KEY_BYTES,
  MAX_CANONICAL_QUERY_IDENTITY_BYTES,
  MAX_COUNTED_CANONICAL_BYTES,
  MAX_INLINE_PUBLICATION_CONTENT_BYTES,
  MAX_PENDING_PUBLICATIONS,
  MAX_QUERY_DEPENDENCY_BYTES,
  MAX_QUERY_DEPENDENCY_KEYS,
  MAX_REFERENCE_QUERIES,
  MAX_RETAINED_PUBLICATION_CONTENT_BYTES,
  MAX_RETAINED_QUERY_IDENTITY_BYTES,
  QuerySyncStateLimitError,
  buildQuerySyncState,
  captureCanonicalDependencyKey,
  captureNamespaceCursor,
  captureQueryAuthorityWitness,
  captureQueryDescriptor,
  captureQueryEvaluationEvidence,
  captureQueryGeneration,
  captureQueryPublicationArtifact,
  captureQuerySyncWorkRevision,
  completeQueryEvaluation as completeReferenceQueryEvaluation,
  createEmptyQuerySyncState,
  makePendingQueryPublication,
  makeQueryPublicationIdentity,
  pendingPublicationDisposition,
  unchangedPublicationDisposition,
  type CanonicalDependencyKey,
  type CanonicalPublicationContent,
  type NamespaceCursor,
  type PendingQueryPublication,
  type QueryDescriptor,
  type QueryEvaluationAttempt,
  type QueryState,
  type QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";
import { Cause, Effect, Encoding, Exit, Option, Result } from "effect";
import { describe, expect, it } from "vitest";

import type {
  DeploymentQuerySyncBinding,
} from "../src/deploymentSync/Binding";
import {
  COMPLETION_COMMON_READ_STAGES,
  completeEvaluation,
  makeCompletionSqlProbe,
  type CompletionEvidenceInput,
  type CompletionSqlStage,
} from "./deploymentSyncCompletionTestSupport";
import {
  seedEvaluationPopulation,
} from "./deploymentSyncEvaluationPopulationTestSupport";
import {
  beginRequest,
  canonicalKey,
  prepareEvaluationState,
  readEvaluationScope,
  success,
} from "./deploymentSyncEvaluationStateTestSupport";

const MATERIAL_READ_TRACE = Object.freeze([
  ...COMPLETION_COMMON_READ_STAGES,
  "active-dependencies-read",
  "completion-dependencies-read",
  "pending-publication-read",
] as const satisfies readonly CompletionSqlStage[]);

const MAXIMUM_TEST_TIMEOUT = 120_000;

describe("deployment query-sync completion maximum populations", () => {
  it("completes with 4,096 queries and 32 MiB of retained identities", async () => {
    const prepared = await prepareEvaluationState();
    try {
      const cursor = cursorAt(prepared.binding, 11n);
      const identity = canonicalData(8_192, 0x69);
      const queries = Array.from(
        { length: MAX_REFERENCE_QUERIES },
        (_value, index) => provisionalQuery(cursor, index, identity),
      );
      const population = buildPopulation(cursor, queries, []);
      expect(population.metrics).toMatchObject({
        queryCount: MAX_REFERENCE_QUERIES,
        retainedIdentityBytes: MAX_RETAINED_QUERY_IDENTITY_BYTES,
      });
      seedEvaluationPopulation(
        prepared.database,
        prepared.binding,
        population,
      );

      const target = requiredAt(population.queries, 0);
      const attempt = await replayAttempt(prepared, target);
      const input = completionEvidence(
        prepared.binding,
        attempt,
        [],
        canonicalKey(41),
        canonicalContent(0, 0),
      );
      const receipt = await completeEvaluation(prepared, attempt, input);

      expect(receipt).toMatchObject({
        _tag: "completed",
        generation: 1n,
        publicationDisposition: { _tag: "pending" },
      });
      expect(readEvaluationScope(prepared.database).metrics).toMatchObject({
        queryCount: MAX_REFERENCE_QUERIES,
        retainedIdentityBytes: MAX_RETAINED_QUERY_IDENTITY_BYTES,
      });
      expect(sqlCount(
        prepared.database,
        "deployment_sync_queries",
      )).toBe(MAX_REFERENCE_QUERIES);
    } finally {
      prepared.database.close();
    }
  }, MAXIMUM_TEST_TIMEOUT);

  it("preserves 4,096 pending rows and maps retained-content overflow", async () => {
    const probe = makeCompletionSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const scopeCursor = cursorAt(prepared.binding, 12n);
      const registrationCursor = cursorAt(prepared.binding, 11n);
      const maximumContent = canonicalContent(
        MAX_INLINE_PUBLICATION_CONTENT_BYTES,
        0x70,
      );
      const emptyContent = canonicalContent(0, 0);
      const completed = Array.from(
        { length: MAX_PENDING_PUBLICATIONS },
        (_value, index) => completedQuery({
          scopeCursor,
          registrationCursor,
          index,
          dependencies: [],
          pendingContent: index < 32 ? maximumContent : emptyContent,
          successorReady: index === 32 || index === 33,
        }),
      );
      const population = buildPopulation(
        scopeCursor,
        completed.map(fixture => fixture.query),
        completed.map(fixture => requiredPending(fixture.pending)),
      );
      expect(population.metrics).toMatchObject({
        queryCount: MAX_REFERENCE_QUERIES,
        pendingPublicationCount: MAX_PENDING_PUBLICATIONS,
        retainedPublicationContentBytes:
          MAX_RETAINED_PUBLICATION_CONTENT_BYTES,
      });
      seedEvaluationPopulation(
        prepared.database,
        prepared.binding,
        population,
      );
      expect(sqlCount(
        prepared.database,
        "deployment_sync_pending_publications",
      )).toBe(MAX_PENDING_PUBLICATIONS);
      expect(prepared.database.prepare(`SELECT count(*) AS value
        FROM deployment_sync_pending_publications
        WHERE length(content) = ?`).get(maximumContent.length)?.value).toBe(32);

      const stableTarget = findQuery(population, 32);
      const overflowTarget = findQuery(population, 33);
      const stableAttempt = await replayAttempt(prepared, stableTarget);
      const overflowAttempt = await replayAttempt(prepared, overflowTarget);
      const stableInput = completionEvidence(
        prepared.binding,
        stableAttempt,
        [],
        requiredActive(stableTarget).resultDigest,
        emptyContent,
      );
      const stableReceipt = await completeEvaluation(
        prepared,
        stableAttempt,
        stableInput,
      );
      expect(stableReceipt).toMatchObject({
        _tag: "completed",
        publicationDisposition: { _tag: "unchanged" },
      });
      const referenceAfterStable = completedReferenceState(
        population,
        stableAttempt,
        stableInput,
      );
      expect(readEvaluationScope(prepared.database).metrics).toMatchObject({
        pendingPublicationCount: MAX_PENDING_PUBLICATIONS,
        retainedPublicationContentBytes:
          MAX_RETAINED_PUBLICATION_CONTENT_BYTES,
      });

      const overflowInput = completionEvidence(
        prepared.binding,
        overflowAttempt,
        [],
        canonicalKey(177),
        canonicalContent(1, 0x78),
      );
      const expected = resultFailure(completeReferenceQueryEvaluation(
        referenceAfterStable,
        overflowAttempt,
        overflowInput.evaluation,
        overflowInput.refresh,
        overflowInput.publication,
      ));
      const before = lightweightPopulationSnapshot(
        prepared.database,
        [overflowTarget.descriptor.queryKey],
      );
      probe.start();
      const exit = await Effect.runPromiseExit(
        prepared.state.completeQueryEvaluation(
          overflowAttempt,
          overflowInput.evaluation,
          overflowInput.refresh,
          overflowInput.publication,
        ),
      );

      expectStateLimitFailure(exit, expected, {
        dimension: "retainedPublicationContentBytes",
        maximum: MAX_RETAINED_PUBLICATION_CONTENT_BYTES,
        observed: MAX_RETAINED_PUBLICATION_CONTENT_BYTES + 1,
      });
      expect(probe.stop()).toEqual(MATERIAL_READ_TRACE);
      expect(lightweightPopulationSnapshot(
        prepared.database,
        [overflowTarget.descriptor.queryKey],
      )).toEqual(before);
    } finally {
      prepared.database.close();
    }
  }, MAXIMUM_TEST_TIMEOUT);

  it("preserves 262,144 memberships and 524,288 physical dependency rows", async () => {
    const probe = makeCompletionSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const scopeCursor = cursorAt(prepared.binding, 12n);
      const registrationCursor = cursorAt(prepared.binding, 11n);
      const fullDependencies = dependencySet(
        MAX_QUERY_DEPENDENCY_KEYS,
        2,
        0x31,
      );
      const completed = [
        ...Array.from({ length: 30 }, (_value, index) => completedQuery({
          scopeCursor,
          registrationCursor,
          index,
          dependencies: fullDependencies,
        })),
        completedQuery({
          scopeCursor,
          registrationCursor,
          index: 30,
          dependencies: fullDependencies,
          successorReady: true,
        }),
        completedQuery({
          scopeCursor,
          registrationCursor,
          index: 31,
          dependencies: fullDependencies.slice(0, -1),
          successorReady: true,
        }),
        completedQuery({
          scopeCursor,
          registrationCursor,
          index: 32,
          dependencies: fullDependencies.slice(0, 1),
        }),
      ];
      const population = buildPopulation(
        scopeCursor,
        completed.map(fixture => fixture.query),
        [],
      );
      expect(population.metrics.dependencyMemberships).toBe(
        MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS,
      );
      seedEvaluationPopulation(
        prepared.database,
        prepared.binding,
        population,
      );
      expect(dependencyRoleCounts(prepared.database)).toEqual({
        active: MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS,
        completion: MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS,
        total: 2 * MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS,
      });

      const stableTarget = findQuery(population, 30);
      const overflowTarget = findQuery(population, 31);
      const stableAttempt = await replayAttempt(prepared, stableTarget);
      const overflowAttempt = await replayAttempt(prepared, overflowTarget);
      const stableInput = completionEvidence(
        prepared.binding,
        stableAttempt,
        fullDependencies,
        requiredActive(stableTarget).resultDigest,
        canonicalContent(0, 0),
      );
      await expect(completeEvaluation(
        prepared,
        stableAttempt,
        stableInput,
      )).resolves.toMatchObject({
        _tag: "completed",
        publicationDisposition: { _tag: "unchanged" },
      });
      const referenceAfterStable = completedReferenceState(
        population,
        stableAttempt,
        stableInput,
      );
      expect(dependencyRoleCounts(prepared.database)).toEqual({
        active: MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS,
        completion: MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS,
        total: 2 * MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS,
      });

      const overflowInput = completionEvidence(
        prepared.binding,
        overflowAttempt,
        fullDependencies,
        requiredActive(overflowTarget).resultDigest,
        canonicalContent(0, 0),
      );
      const expected = resultFailure(completeReferenceQueryEvaluation(
        referenceAfterStable,
        overflowAttempt,
        overflowInput.evaluation,
        overflowInput.refresh,
        overflowInput.publication,
      ));
      const before = lightweightPopulationSnapshot(
        prepared.database,
        [overflowTarget.descriptor.queryKey],
      );
      probe.start();
      const exit = await Effect.runPromiseExit(
        prepared.state.completeQueryEvaluation(
          overflowAttempt,
          overflowInput.evaluation,
          overflowInput.refresh,
          overflowInput.publication,
        ),
      );

      expectStateLimitFailure(exit, expected, {
        dimension: "dependencyMemberships",
        maximum: MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS,
        observed: MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS + 1,
      });
      expect(probe.stop()).toEqual(MATERIAL_READ_TRACE);
      expect(lightweightPopulationSnapshot(
        prepared.database,
        [overflowTarget.descriptor.queryKey],
      )).toEqual(before);
    } finally {
      prepared.database.close();
    }
  }, MAXIMUM_TEST_TIMEOUT);

  it("starts at 64 MiB and reads exact 4 MiB dependency roles", async () => {
    const probe = makeCompletionSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const scopeCursor = cursorAt(prepared.binding, 12n);
      const registrationCursor = cursorAt(prepared.binding, 11n);
      const maximumByteDependencies = dependencySet(
        MAX_QUERY_DEPENDENCY_BYTES / MAX_CANONICAL_DEPENDENCY_KEY_BYTES,
        MAX_CANONICAL_DEPENDENCY_KEY_BYTES,
        0x42,
      );
      const baseQueries = [
        completedQuery({
          scopeCursor,
          registrationCursor,
          index: 0,
          dependencies: maximumByteDependencies,
          successorReady: true,
        }).query,
        ...Array.from({ length: 6 }, (_value, offset) => completedQuery({
          scopeCursor,
          registrationCursor,
          index: offset + 1,
          dependencies: maximumByteDependencies,
        }).query),
        provisionalQuery(scopeCursor, 7, canonicalData(0, 0)),
      ];
      const population = padCanonicalPopulation(
        scopeCursor,
        baseQueries,
        1_000,
      );
      expect(population.metrics.countedCanonicalBytes).toBe(
        MAX_COUNTED_CANONICAL_BYTES,
      );
      seedEvaluationPopulation(
        prepared.database,
        prepared.binding,
        population,
      );
      expect(readEvaluationScope(prepared.database).metrics
        .countedCanonicalBytes).toBe(MAX_COUNTED_CANONICAL_BYTES);

      const shrinkTarget = findQuery(population, 0);
      const overflowTarget = findQuery(population, 7);
      const shrinkAttempt = await replayAttempt(prepared, shrinkTarget);
      const overflowAttempt = await replayAttempt(prepared, overflowTarget);
      const overflowInput = completionEvidence(
        prepared.binding,
        overflowAttempt,
        maximumByteDependencies,
        canonicalKey(199),
        canonicalContent(0, 0),
      );
      const expected = resultFailure(completeReferenceQueryEvaluation(
        population,
        overflowAttempt,
        overflowInput.evaluation,
        overflowInput.refresh,
        overflowInput.publication,
      ));
      const before = lightweightPopulationSnapshot(
        prepared.database,
        [overflowTarget.descriptor.queryKey],
      );
      probe.start();
      const exit = await Effect.runPromiseExit(
        prepared.state.completeQueryEvaluation(
          overflowAttempt,
          overflowInput.evaluation,
          overflowInput.refresh,
          overflowInput.publication,
        ),
      );

      expectStateLimitFailure(exit, expected, {
        dimension: "countedCanonicalBytes",
        maximum: MAX_COUNTED_CANONICAL_BYTES,
      });
      expect(probe.stop()).toEqual(MATERIAL_READ_TRACE);
      expect(lightweightPopulationSnapshot(
        prepared.database,
        [overflowTarget.descriptor.queryKey],
      )).toEqual(before);

      const shrinkInput = completionEvidence(
        prepared.binding,
        shrinkAttempt,
        [],
        requiredActive(shrinkTarget).resultDigest,
        canonicalContent(0, 0),
      );
      await expect(completeEvaluation(
        prepared,
        shrinkAttempt,
        shrinkInput,
      )).resolves.toMatchObject({
        _tag: "completed",
        publicationDisposition: { _tag: "unchanged" },
      });
      expect(readEvaluationScope(prepared.database).metrics
        .countedCanonicalBytes).toBeLessThan(MAX_COUNTED_CANONICAL_BYTES);
      expect(dependencyCountForQuery(
        prepared.database,
        shrinkTarget.descriptor.queryKey,
      )).toEqual({ active: 0, completion: 0 });
    } finally {
      prepared.database.close();
    }
  }, MAXIMUM_TEST_TIMEOUT);
});

interface CompletedQueryFixture {
  readonly query: QueryState;
  readonly pending: PendingQueryPublication | null;
}

interface CompletedQueryInput {
  readonly scopeCursor: NamespaceCursor;
  readonly registrationCursor: NamespaceCursor;
  readonly index: number;
  readonly dependencies: readonly CanonicalDependencyKey[];
  readonly pendingContent?: CanonicalPublicationContent | null;
  readonly successorReady?: boolean;
}

function completedQuery(input: CompletedQueryInput): CompletedQueryFixture {
  const descriptor = descriptorAt(
    input.index,
    canonicalData(16, input.index),
  );
  const evaluation = success(captureQueryEvaluationEvidence({
    namespaceId: input.scopeCursor.namespaceId,
    syncModelId: input.scopeCursor.syncModelId,
    sourceEpoch: input.scopeCursor.sourceEpoch,
    descriptor,
    generation: 1n,
    snapshotSequence: input.registrationCursor.appliedThroughSequence,
    resultDigest: canonicalKey(60 + (input.index % 120)),
    authorityWitness: canonicalKey(180 + (input.index % 60)),
    dependencyKeys: input.dependencies,
  }));
  const identity = makeQueryPublicationIdentity({
    namespaceId: input.scopeCursor.namespaceId,
    syncModelId: input.scopeCursor.syncModelId,
    sourceEpoch: input.scopeCursor.sourceEpoch,
    queryKey: descriptor.queryKey,
    generation: evaluation.generation,
  });
  const pendingContent = input.pendingContent ?? null;
  const pending = pendingContent === null
    ? null
    : makePendingQueryPublication({
      identity,
      queryIdentity: descriptor.queryIdentity,
      completedThroughSequence: input.registrationCursor.appliedThroughSequence,
      resultDigest: evaluation.resultDigest,
      content: pendingContent,
    });
  const successorReady = input.successorReady === true;
  const query = Object.freeze({
    descriptor,
    active: Object.freeze({
      generation: evaluation.generation,
      evaluationSnapshotSequence: evaluation.snapshotSequence,
      freshThroughSequence: input.registrationCursor.appliedThroughSequence,
      dirtyThroughSequence: successorReady
        ? input.scopeCursor.appliedThroughSequence
        : null,
      resultDigest: evaluation.resultDigest,
      authorityWitness: evaluation.authorityWitness,
      dependencyKeys: evaluation.dependencyKeys,
    }),
    provisional: successorReady
      ? Object.freeze({
        generation: success(captureQueryGeneration(2n)),
        expectedActiveGeneration: evaluation.generation,
        registrationCursor: input.scopeCursor,
        requestedDirtyThroughSequence:
          input.scopeCursor.appliedThroughSequence,
        evaluationDisposition: Object.freeze({ _tag: "ready" as const }),
      })
      : null,
    currentCompletion: Object.freeze({
      identity,
      queryIdentity: descriptor.queryIdentity,
      expectedActiveGeneration: null,
      registrationCursor: input.registrationCursor,
      requestedDirtyThroughSequence: null,
      evaluationSnapshotSequence: evaluation.snapshotSequence,
      evaluationDependencyKeys: evaluation.dependencyKeys,
      evaluationAuthorityWitness: evaluation.authorityWitness,
      refreshedThroughSequence: input.registrationCursor.appliedThroughSequence,
      relevantThroughSequence: null,
      refreshAuthorityWitness: evaluation.authorityWitness,
      resultDigest: evaluation.resultDigest,
      publicationDisposition: pending === null
        ? unchangedPublicationDisposition()
        : pendingPublicationDisposition(identity),
    }),
    precedingCompletionIdentity: null,
  } satisfies QueryState);
  return Object.freeze({ query, pending });
}

function provisionalQuery(
  cursor: NamespaceCursor,
  index: number,
  queryIdentity: string,
): QueryState {
  return Object.freeze({
    descriptor: descriptorAt(index, queryIdentity),
    active: null,
    provisional: Object.freeze({
      generation: success(captureQueryGeneration(1n)),
      expectedActiveGeneration: null,
      registrationCursor: cursor,
      requestedDirtyThroughSequence: null,
      evaluationDisposition: Object.freeze({ _tag: "ready" as const }),
    }),
    currentCompletion: null,
    precedingCompletionIdentity: null,
  });
}

function buildPopulation(
  cursor: NamespaceCursor,
  queries: readonly QueryState[],
  pending: readonly PendingQueryPublication[],
): QuerySyncState {
  const empty = success(createEmptyQuerySyncState(cursor));
  return success(buildQuerySyncState({
    cursor,
    queries,
    evaluationWork: Object.freeze({
      revision: success(captureQuerySyncWorkRevision(
        BigInt(2 * queries.length),
      )),
      fairnessAnchor: null,
    }),
    publicationWork: Object.freeze({
      pending,
      inFlight: empty.publicationWork.inFlight,
      latestDelivered: empty.publicationWork.latestDelivered,
      precedingAttemptOutcome: empty.publicationWork.precedingAttemptOutcome,
    }),
  }));
}

function padCanonicalPopulation(
  cursor: NamespaceCursor,
  baseQueries: readonly QueryState[],
  firstPaddingIndex: number,
): QuerySyncState {
  const base = buildPopulation(cursor, baseQueries, []);
  const emptyPadding = provisionalQuery(
    cursor,
    firstPaddingIndex,
    canonicalData(0, 0),
  );
  const withEmptyPadding = buildPopulation(
    cursor,
    [...baseQueries, emptyPadding],
    [],
  );
  const fixedPaddingBytes = withEmptyPadding.metrics.countedCanonicalBytes
    - base.metrics.countedCanonicalBytes;
  const deficit = MAX_COUNTED_CANONICAL_BYTES
    - base.metrics.countedCanonicalBytes;
  const paddingCount = Math.ceil(
    deficit / (fixedPaddingBytes + MAX_CANONICAL_QUERY_IDENTITY_BYTES),
  );
  const identityBytes = deficit - (paddingCount * fixedPaddingBytes);
  if (
    paddingCount < 1
    || identityBytes < 0
    || identityBytes > paddingCount * MAX_CANONICAL_QUERY_IDENTITY_BYTES
  ) {
    throw new Error("Canonical maximum cannot be represented by query padding.");
  }
  let remainingIdentityBytes = identityBytes;
  const padding = Array.from({ length: paddingCount }, (_value, offset) => {
    const byteLength = Math.min(
      remainingIdentityBytes,
      MAX_CANONICAL_QUERY_IDENTITY_BYTES,
    );
    remainingIdentityBytes -= byteLength;
    return provisionalQuery(
      cursor,
      firstPaddingIndex + offset,
      canonicalData(byteLength, 0x50 + (offset % 16)),
    );
  });
  if (remainingIdentityBytes !== 0) {
    throw new Error("Canonical maximum padding did not consume every byte.");
  }
  return buildPopulation(cursor, [...baseQueries, ...padding], []);
}

async function replayAttempt(
  prepared: Awaited<ReturnType<typeof prepareEvaluationState>>,
  query: QueryState,
): Promise<QueryEvaluationAttempt> {
  const provisional = query.provisional;
  if (provisional === null) throw new Error("Expected a provisional target.");
  const receipt = await Effect.runPromise(
    prepared.state.beginQueryEvaluation(beginRequest(
      prepared.binding,
      query.descriptor,
      {
        ...(provisional.expectedActiveGeneration === null
          ? {}
          : {
            expectedActiveGeneration: provisional.expectedActiveGeneration,
          }),
        ...(provisional.requestedDirtyThroughSequence === null
          ? {}
          : {
            requestedDirtyThroughSequence:
              provisional.requestedDirtyThroughSequence,
          }),
      },
    )),
  );
  if (receipt._tag !== "replayed") {
    throw new Error(`Expected replayed evaluation, received ${receipt._tag}.`);
  }
  return receipt.attempt;
}

function completionEvidence(
  binding: DeploymentQuerySyncBinding,
  attempt: QueryEvaluationAttempt,
  dependencies: readonly CanonicalDependencyKey[],
  resultDigest: string,
  content: CanonicalPublicationContent,
): CompletionEvidenceInput {
  const authorityWitness = success(captureQueryAuthorityWitness(
    canonicalKey(211),
  ));
  const evaluation = success(captureQueryEvaluationEvidence({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    descriptor: attempt.descriptor,
    generation: attempt.generation,
    snapshotSequence: attempt.registrationCursor.appliedThroughSequence,
    resultDigest,
    authorityWitness,
    dependencyKeys: dependencies,
  }));
  const refresh = success(deriveGenerationRefreshEvidence(
    evaluation,
    attempt.registrationCursor,
    [],
    authorityWitness,
  ));
  const publication = success(captureQueryPublicationArtifact({ content }));
  return Object.freeze({ evaluation, refresh, publication });
}

function completedReferenceState(
  state: QuerySyncState,
  attempt: QueryEvaluationAttempt,
  input: CompletionEvidenceInput,
): QuerySyncState {
  const decision = success(completeReferenceQueryEvaluation(
    state,
    attempt,
    input.evaluation,
    input.refresh,
    input.publication,
  ));
  if (decision._tag !== "completed") {
    throw new Error(`Expected reference completion, received ${decision._tag}.`);
  }
  return decision.state;
}

function cursorAt(
  binding: DeploymentQuerySyncBinding,
  appliedThroughSequence: bigint,
): NamespaceCursor {
  return success(captureNamespaceCursor({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    appliedThroughSequence,
  }));
}

function descriptorAt(index: number, queryIdentity: string): QueryDescriptor {
  return success(captureQueryDescriptor({
    queryKey: indexedCanonicalData(32, index, 0x4b),
    queryIdentity,
  }));
}

function dependencySet(
  count: number,
  byteLength: number,
  fill: number,
): readonly CanonicalDependencyKey[] {
  return Object.freeze(Array.from({ length: count }, (_value, index) => (
    success(captureCanonicalDependencyKey(
      indexedCanonicalData(byteLength, index, fill),
    ))
  )).toSorted());
}

function canonicalContent(
  byteLength: number,
  fill: number,
): CanonicalPublicationContent {
  return success(captureQueryPublicationArtifact({
    content: canonicalData(byteLength, fill),
  })).content;
}

function canonicalData(byteLength: number, fill: number): string {
  return Encoding.encodeBase64Url(new Uint8Array(byteLength).fill(fill));
}

function indexedCanonicalData(
  byteLength: number,
  index: number,
  fill: number,
): string {
  const bytes = new Uint8Array(byteLength).fill(fill);
  if (byteLength >= 4) {
    new DataView(bytes.buffer).setUint32(0, index, false);
  } else if (byteLength >= 2) {
    new DataView(bytes.buffer).setUint16(0, index, false);
  } else if (byteLength === 1) {
    bytes[0] = index;
  }
  return Encoding.encodeBase64Url(bytes);
}

function expectStateLimitFailure<A, E>(
  exit: Exit.Exit<A, E>,
  expected: unknown,
  shape: Readonly<{
    readonly dimension: QuerySyncStateLimitError["dimension"];
    readonly maximum: number;
    readonly observed?: number;
  }>,
): void {
  if (!Exit.isFailure(exit)) throw new Error("Expected typed state-limit failure.");
  expect(Cause.hasDies(exit.cause)).toBe(false);
  const failure = Option.getOrThrow(Cause.findErrorOption(exit.cause));
  expect(failure).toBeInstanceOf(QuerySyncStateLimitError);
  expect(failure).toEqual(expected);
  expect(failure).toMatchObject({
    _tag: "QuerySyncStateLimitError",
    operation: "buildQuerySyncState",
    ...shape,
  });
}

function resultFailure<A, E>(result: Result.Result<A, E>): E {
  return Result.match(result, {
    onFailure: failure => failure,
    onSuccess: () => {
      throw new Error("Expected portable completion failure.");
    },
  });
}

function requiredAt<A>(values: readonly A[], index: number): A {
  const value = values[index];
  if (value === undefined) throw new Error(`Missing value at index ${index}.`);
  return value;
}

function requiredActive(query: QueryState) {
  if (query.active === null) throw new Error("Expected active query state.");
  return query.active;
}

function requiredPending(
  pending: PendingQueryPublication | null,
): PendingQueryPublication {
  if (pending === null) throw new Error("Expected pending publication.");
  return pending;
}

function findQuery(state: QuerySyncState, descriptorIndex: number): QueryState {
  const queryKey = indexedCanonicalData(32, descriptorIndex, 0x4b);
  const query = state.queries.find(candidate =>
    candidate.descriptor.queryKey === queryKey
  );
  if (query === undefined) throw new Error("Expected maximum-population query.");
  return query;
}

function sqlCount(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT count(*) AS value FROM ${table}`).get();
  return Number(row?.value);
}

function dependencyRoleCounts(database: DatabaseSync) {
  const rows = database.prepare(`SELECT role, count(*) AS value
    FROM deployment_sync_query_dependencies
    GROUP BY role ORDER BY role`).all();
  const active = Number(rows.find(row => row.role === "active")?.value ?? 0);
  const completion = Number(
    rows.find(row => row.role === "completion")?.value ?? 0,
  );
  return Object.freeze({ active, completion, total: active + completion });
}

function dependencyCountForQuery(database: DatabaseSync, queryKey: string) {
  const rows = database.prepare(`SELECT role, count(*) AS value
    FROM deployment_sync_query_dependencies
    WHERE query_key = ? GROUP BY role ORDER BY role`).all(queryKey);
  return Object.freeze({
    active: Number(rows.find(row => row.role === "active")?.value ?? 0),
    completion: Number(
      rows.find(row => row.role === "completion")?.value ?? 0,
    ),
  });
}

function lightweightPopulationSnapshot(
  database: DatabaseSync,
  queryKeys: readonly string[],
) {
  const placeholders = queryKeys.map(() => "?").join(", ");
  return Object.freeze({
    scope: readEvaluationScope(database),
    queryCount: sqlCount(database, "deployment_sync_queries"),
    dependencyCounts: dependencyRoleCounts(database),
    pendingCount: sqlCount(database, "deployment_sync_pending_publications"),
    targets: database.prepare(`SELECT
      query_key,
      active_generation,
      active_fresh_through_sequence,
      active_dirty_through_sequence,
      provisional_generation,
      provisional_requested_dirty_through_sequence,
      completion_generation,
      completion_publication_disposition,
      preceding_completion_generation
      FROM deployment_sync_queries
      WHERE query_key IN (${placeholders})
      ORDER BY query_key`).all(...queryKeys),
  });
}
