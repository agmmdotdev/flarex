import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { Data, Effect, Result } from "effect";
import type { GrantRetentionPolicyV1 } from
  "flarex-protocol/grant-retention-policy";
import {
  CommitSeqSchema,
  projectScopeEpochUuidV1Result,
  projectScopeIdUuidV1Result,
  type CommitSeq,
  type ScopeId,
} from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import { databaseTimestampFromUnknown } from "./databaseTimestamp";
import type { FlarexMetadataDatabase } from "./deployments";
import { rowsFromDriverExecuteResult } from "./driverExecuteResult";
import { getScopeClock } from "./scopeClock";
import {
  lockScopeClockForUpdateInTransactionEffect,
  lockScopeClockForShareInTransactionEffect,
  type LockScopeClockForUpdateError,
  type LockScopeClockForShareError,
  type ScopeClockRecord,
  decodeScopeClockRecordResult,
} from "./scopeClock";
import {
  captureTrustedScopeAuthorityResolutionPorts,
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import { captureScopePhysicalLocator } from "./scopePhysicalLocator";
import {
  fxSystemScopeClocks,
  fxSystemCommits,
  fxSystemSnapshotLeases,
} from "./schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
  type RunLocatedReadCommittedTransactionV1,
} from "./transactionSessionAttemptKernel";
import { runLocatedReadCommittedEffect } from "./locatedReadCommittedEffect";

export const MAX_RETAINED_FLOOR_LEASE_ROWS = 4_096;
export const MAX_RETAINED_FLOOR_COMMIT_ROWS = 4_096;
export const MAX_RETAINED_FLOOR_PIN_FACETS = 8;

const retainedHistoryFloorPortBrand: unique symbol = Symbol(
  "FlarexDB/retainedHistoryFloorObservationPort",
);
const retainedHistoryFloorPinFacetBrand: unique symbol = Symbol(
  "FlarexDB/retainedHistoryFloorPinFacet",
);
const retainedHistoryFloorPublicationPinFacetBrand: unique symbol = Symbol(
  "FlarexDB/retainedHistoryFloorPublicationPinFacet",
);
const retainedHistoryFloorPublicationPortBrand: unique symbol = Symbol(
  "FlarexDB/retainedHistoryFloorPublicationPort",
);

export interface LocatedRetainedHistoryFloorTarget
  extends LocatedReadCommittedAttemptTargetV1 {}

const locatedTargets = new WeakSet<LocatedRetainedHistoryFloorTarget>();

/** Package-internal authenticity check shared by the O11 physical owners. */
export function isLocatedRetainedHistoryFloorTargetInternal(
  target: LocatedRetainedHistoryFloorTarget,
): boolean {
  return locatedTargets.has(target);
}

/** Package-internal primitive; public composition roots bind one persistence. */
export function createLocatedRetainedHistoryFloorTargetInternal(
  database: FlarexMetadataDatabase,
  physicalLocator: ScopePhysicalLocator,
  runReadCommitted: RunLocatedReadCommittedTransactionV1,
): LocatedRetainedHistoryFloorTarget {
  const target = Object.freeze({
    physicalLocator: captureScopePhysicalLocator(physicalLocator),
    getCurrentClock: (scopeId: ScopeId) => getScopeClock(database, scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted,
  });
  locatedTargets.add(target);
  return target;
}

export type RetainedHistoryFloorPinObservation =
  | Readonly<{ readonly kind: "absent" }>
  | Readonly<{ readonly kind: "unavailable" }>
  | Readonly<{
      readonly kind: "pinned";
      readonly minimumCommitSeq: CommitSeq;
    }>;

export interface RetainedHistoryFloorPinFacet {
  readonly [retainedHistoryFloorPinFacetBrand]: true;
}

interface RetainedHistoryFloorPinFacetState {
  readonly owner: "reconnect" | "rollback" | "adapter" | "test";
  readonly observation: RetainedHistoryFloorPinObservation;
}

const pinFacetStates = new WeakMap<
  RetainedHistoryFloorPinFacet,
  RetainedHistoryFloorPinFacetState
>();

export interface RetainedHistoryFloorPublicationPinFacet {
  readonly [retainedHistoryFloorPublicationPinFacetBrand]: true;
}

const publicationPinFacetStates = new WeakMap<
  RetainedHistoryFloorPublicationPinFacet,
  Readonly<{ readonly policy: "testNoReconnect" }>
>();

/**
 * Explicit private proof policy. It is not production permission to advance a
 * floor: roadmap 21 must supply the reconnect owner before O11 is wired.
 */
export function createTestNoReconnectRetainedHistoryFloorPublicationPinFacet():
  RetainedHistoryFloorPublicationPinFacet {
  const facet = Object.freeze({
    [retainedHistoryFloorPublicationPinFacetBrand]: true as const,
  });
  publicationPinFacetStates.set(facet, Object.freeze({
    policy: "testNoReconnect" as const,
  }));
  return facet;
}

/**
 * Package-private O11-B observation seam. A future pin owner must authenticate
 * its own observation before constructing this process-local facet. The O11-C
 * writer deliberately rejects these static observation facets and owns a
 * separate in-transaction publication policy.
 */
export function createRetainedHistoryFloorPinFacet(
  owner: RetainedHistoryFloorPinFacetState["owner"],
  observation: RetainedHistoryFloorPinObservation,
): RetainedHistoryFloorPinFacet {
  const facet = Object.freeze({
    [retainedHistoryFloorPinFacetBrand]: true as const,
  });
  const capturedObservation = observation.kind === "pinned"
    ? Object.freeze({
        kind: observation.kind,
        minimumCommitSeq: observation.minimumCommitSeq,
      })
    : Object.freeze({ kind: observation.kind });
  pinFacetStates.set(facet, Object.freeze({
    owner,
    observation: capturedObservation,
  }));
  return facet;
}

export interface RetainedHistoryFloorObservationPort {
  readonly [retainedHistoryFloorPortBrand]: true;
}

interface RetainedHistoryFloorObservationPortState {
  readonly authority: TrustedScopeAuthorityResolutionPorts<
  LocatedRetainedHistoryFloorTarget
  >;
  readonly maximumLiveSnapshotRetentionMilliseconds: number;
  readonly pinFacets: ReadonlyArray<RetainedHistoryFloorPinFacetState>;
}

export interface RetainedHistoryFloorPublicationPort {
  readonly [retainedHistoryFloorPublicationPortBrand]: true;
}

interface RetainedHistoryFloorPublicationPortState {
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedRetainedHistoryFloorTarget
  >;
  readonly maximumLiveSnapshotRetentionMilliseconds: number;
  readonly pinFacets: ReadonlyArray<
    Readonly<{ readonly policy: "testNoReconnect" }>
  >;
}

const publicationPortStates = new WeakMap<
  RetainedHistoryFloorPublicationPort,
  RetainedHistoryFloorPublicationPortState
>();

const portStates = new WeakMap<
  RetainedHistoryFloorObservationPort,
  RetainedHistoryFloorObservationPortState
>();

export function createRetainedHistoryFloorObservationPort(input: {
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedRetainedHistoryFloorTarget
  >;
  readonly grantRetentionPolicy: GrantRetentionPolicyV1;
  readonly pinFacets: ReadonlyArray<RetainedHistoryFloorPinFacet>;
}): RetainedHistoryFloorObservationPort {
  const port = Object.freeze({
    [retainedHistoryFloorPortBrand]: true as const,
  });
  const pinFacets = input.pinFacets;
  if (
    pinFacets.length === 0 ||
    pinFacets.length > MAX_RETAINED_FLOOR_PIN_FACETS
  ) return port;
  const capturedPins: RetainedHistoryFloorPinFacetState[] = [];
  for (const facet of pinFacets) {
    const state = pinFacetStates.get(facet);
    if (state === undefined) return port;
    capturedPins.push(state);
  }
  portStates.set(port, Object.freeze({
    authority: captureTrustedScopeAuthorityResolutionPorts(input.authority),
    maximumLiveSnapshotRetentionMilliseconds:
      input.grantRetentionPolicy.maximumLiveSnapshotRetentionMilliseconds,
    pinFacets: Object.freeze(capturedPins),
  }));
  return port;
}

export function createRetainedHistoryFloorPublicationPort(input: {
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedRetainedHistoryFloorTarget
  >;
  readonly grantRetentionPolicy: GrantRetentionPolicyV1;
  readonly pinFacets: ReadonlyArray<RetainedHistoryFloorPublicationPinFacet>;
}): RetainedHistoryFloorPublicationPort {
  const port = Object.freeze({
    [retainedHistoryFloorPublicationPortBrand]: true as const,
  });
  const facets = input.pinFacets;
  if (facets.length === 0 || facets.length > MAX_RETAINED_FLOOR_PIN_FACETS) {
    return port;
  }
  const capturedPins: Array<Readonly<{ readonly policy: "testNoReconnect" }>> =
    [];
  for (const facet of facets) {
    const state = publicationPinFacetStates.get(facet);
    if (state === undefined) return port;
    capturedPins.push(state);
  }
  publicationPortStates.set(port, Object.freeze({
    authority: captureTrustedScopeAuthorityResolutionPorts(input.authority),
    maximumLiveSnapshotRetentionMilliseconds:
      input.grantRetentionPolicy.maximumLiveSnapshotRetentionMilliseconds,
    pinFacets: Object.freeze(capturedPins),
  }));
  return port;
}

export type RetainedHistoryFloorHoldReason =
  | "leaseDirectoryLimit"
  | "liveLeaseAuthorityUnavailable"
  | "commitDirectoryLimit"
  | "requiredPinUnavailable";

export interface RetainedHistoryFloorCandidateObservation {
  readonly status: "observed";
  readonly disposition: "held" | "advanceable";
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly databaseNow: string;
  readonly currentFloor: CommitSeq;
  readonly lastCommitSeq: CommitSeq;
  readonly candidateFloor: CommitSeq;
  readonly leaseCeiling: CommitSeq;
  readonly timeWindowCeiling: CommitSeq;
  readonly additionalPinCeiling: CommitSeq;
  readonly holdReasons: ReadonlyArray<RetainedHistoryFloorHoldReason>;
}

export interface RetainedHistoryFloorPublicationResult {
  readonly status: "published";
  readonly disposition: "held" | "advanced";
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly databaseNow: string;
  readonly previousFloor: CommitSeq;
  readonly currentFloor: CommitSeq;
  readonly lastCommitSeq: CommitSeq;
  readonly candidateFloor: CommitSeq;
  readonly leaseCeiling: CommitSeq;
  readonly timeWindowCeiling: CommitSeq;
  readonly additionalPinCeiling: CommitSeq;
  readonly holdReasons: ReadonlyArray<RetainedHistoryFloorHoldReason>;
}

export class RetainedHistoryFloorObservationError extends Data.TaggedError(
  "RetainedHistoryFloorObservationError",
)<{
  readonly reason:
    | "invalidPort"
    | "invalidTarget"
    | "staleAuthority"
    | "storedEvidenceInvalid";
  readonly deploymentId: string;
  readonly scopeId?: ScopeId;
  readonly cause?: unknown;
}> {}

export class RetainedHistoryFloorPersistenceError extends Data.TaggedError(
  "RetainedHistoryFloorPersistenceError",
)<{
  readonly operation:
    | "databaseTime"
    | "leaseDirectory"
    | "commitDirectory"
    | "publication";
  readonly cause: unknown;
}> {}

export type ObserveRetainedHistoryFloorCandidateError =
  | RetainedHistoryFloorObservationError
  | RetainedHistoryFloorPersistenceError
  | LockScopeClockForShareError
  | LocatedReadCommittedTransactionFailureV1
  | TrustedScopeAuthorityError;

export type PublishRetainedHistoryFloorError =
  | RetainedHistoryFloorObservationError
  | RetainedHistoryFloorPersistenceError
  | LockScopeClockForUpdateError
  | LocatedReadCommittedTransactionFailureV1
  | TrustedScopeAuthorityError;

export const observeRetainedHistoryFloorCandidateEffect = Effect.fn(
  "RetainedHistoryFloor.observeCandidate",
)(function* (
  port: RetainedHistoryFloorObservationPort,
  deploymentId: string,
): Effect.fn.Return<
  RetainedHistoryFloorCandidateObservation,
  ObserveRetainedHistoryFloorCandidateError
> {
  const state = portStates.get(port);
  if (state === undefined) {
    return yield* Effect.fail(new RetainedHistoryFloorObservationError({
      reason: "invalidPort",
      deploymentId,
    }));
  }
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    deploymentId,
    state.authority,
  );
  if (!locatedTargets.has(located.target)) {
    return yield* Effect.fail(new RetainedHistoryFloorObservationError({
      reason: "invalidTarget",
      deploymentId,
      scopeId: located.authority.scopeId,
    }));
  }
  return yield* runLocatedReadCommittedEffect(
    located.target,
    {
      rollbackMessage: "rollback:retained-history-floor-observation",
      cleanupDefect: failure => failure,
    },
    tx => observeInTransaction(tx, located.authority, state),
  );
});

export const publishRetainedHistoryFloorEffect = Effect.fn(
  "RetainedHistoryFloor.publish",
)(function* (
  port: RetainedHistoryFloorPublicationPort,
  deploymentId: string,
): Effect.fn.Return<
  RetainedHistoryFloorPublicationResult,
  PublishRetainedHistoryFloorError
> {
  const state = publicationPortStates.get(port);
  if (state === undefined) {
    return yield* Effect.fail(new RetainedHistoryFloorObservationError({
      reason: "invalidPort",
      deploymentId,
    }));
  }
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    deploymentId,
    state.authority,
  );
  if (!locatedTargets.has(located.target)) {
    return yield* Effect.fail(new RetainedHistoryFloorObservationError({
      reason: "invalidTarget",
      deploymentId,
      scopeId: located.authority.scopeId,
    }));
  }
  return yield* runLocatedReadCommittedEffect(
    located.target,
    {
      rollbackMessage: "rollback:retained-history-floor-publication",
      cleanupDefect: failure => failure,
    },
    tx => publishInTransaction(tx, located.authority, state),
  );
});

const observeInTransaction = Effect.fn(
  "RetainedHistoryFloor.observeInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  state: RetainedHistoryFloorObservationPortState,
): Effect.fn.Return<
  RetainedHistoryFloorCandidateObservation,
  | RetainedHistoryFloorObservationError
  | RetainedHistoryFloorPersistenceError
  | LockScopeClockForShareError
> {
  const clock = yield* lockScopeClockForShareInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* requireExactAuthority(authority, clock);
  return yield* calculateCandidateInTransaction(
    tx,
    authority,
    clock,
    state.maximumLiveSnapshotRetentionMilliseconds,
    state.pinFacets,
  );
});

const publishInTransaction = Effect.fn(
  "RetainedHistoryFloor.publishInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  state: RetainedHistoryFloorPublicationPortState,
): Effect.fn.Return<
  RetainedHistoryFloorPublicationResult,
  | RetainedHistoryFloorObservationError
  | RetainedHistoryFloorPersistenceError
  | LockScopeClockForUpdateError
> {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* requireExactAuthority(authority, clock);
  const pins = state.pinFacets.map(() => Object.freeze({
    owner: "test" as const,
    observation: Object.freeze({ kind: "absent" as const }),
  }));
  const observation = yield* calculateCandidateInTransaction(
    tx,
    authority,
    clock,
    state.maximumLiveSnapshotRetentionMilliseconds,
    pins,
  );
  if (observation.candidateFloor === observation.currentFloor) {
    return publicationResult(observation, "held", observation.currentFloor);
  }
  const updatedRows = yield* queryEffect(
    "publication",
    tx.update(fxSystemScopeClocks)
      .set({
        oldestAvailableCommitSeq: observation.candidateFloor,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(and(
        eq(fxSystemScopeClocks.scopeId, authority.scopeId),
        eq(fxSystemScopeClocks.storageGeneration, clock.storageGeneration),
        eq(
          fxSystemScopeClocks.storageGenerationFence,
          clock.storageGenerationFence,
        ),
        eq(fxSystemScopeClocks.epoch, clock.epoch),
        eq(fxSystemScopeClocks.lastCommitSeq, clock.lastCommitSeq),
        eq(
          fxSystemScopeClocks.oldestAvailableCommitSeq,
          clock.oldestAvailableCommitSeq,
        ),
      ))
      .returning(),
  );
  if (updatedRows.length !== 1) {
    return yield* Effect.fail(observationError(
      authority,
      "storedEvidenceInvalid",
    ));
  }
  const updated = yield* decodeScopeClockRecordResult(updatedRows[0]).pipe(
    Result.mapError(cause => observationError(
      authority,
      "storedEvidenceInvalid",
      cause,
    )),
    Effect.fromResult,
  );
  if (
    updated.oldestAvailableCommitSeq !== observation.candidateFloor ||
    updated.lastCommitSeq !== clock.lastCommitSeq ||
    updated.storageGeneration !== clock.storageGeneration ||
    updated.storageGenerationFence !== clock.storageGenerationFence ||
    updated.epoch !== clock.epoch
  ) {
    return yield* Effect.fail(observationError(
      authority,
      "storedEvidenceInvalid",
    ));
  }
  return publicationResult(
    observation,
    "advanced",
    updated.oldestAvailableCommitSeq,
  );
});

const calculateCandidateInTransaction = Effect.fn(
  "RetainedHistoryFloor.calculateCandidateInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
  maximumLiveSnapshotRetentionMilliseconds: number,
  pinFacets: ReadonlyArray<RetainedHistoryFloorPinFacetState>,
): Effect.fn.Return<
  RetainedHistoryFloorCandidateObservation,
  RetainedHistoryFloorObservationError | RetainedHistoryFloorPersistenceError
> {
  const epochUuid = yield* projectScopeEpochUuidV1Result(clock.epoch).pipe(
    Result.mapError(cause => observationError(
      authority,
      "storedEvidenceInvalid",
      cause,
    )),
    Effect.fromResult,
  );
  const scopeUuid = yield* projectScopeIdUuidV1Result(clock.scopeId).pipe(
    Result.mapError(cause => observationError(
      authority,
      "storedEvidenceInvalid",
      cause,
    )),
    Effect.fromResult,
  );
  const databaseNow = yield* readDatabaseTimeEffect(tx, authority);
  const databaseNowMilliseconds = databaseNow.getTime();
  const cutoffMilliseconds = databaseNowMilliseconds -
    maximumLiveSnapshotRetentionMilliseconds;
  if (!Number.isSafeInteger(cutoffMilliseconds)) {
    return yield* Effect.fail(observationError(
      authority,
      "storedEvidenceInvalid",
    ));
  }

  const leaseRows = yield* queryEffect(
    "leaseDirectory",
    tx.select({
      snapshotEpochUuid: fxSystemSnapshotLeases.snapshotEpochUuid,
      snapshotCommitSeq: fxSystemSnapshotLeases.snapshotCommitSeq,
      leaseExpiresAt: fxSystemSnapshotLeases.leaseExpiresAt,
    })
      .from(fxSystemSnapshotLeases)
      .where(eq(fxSystemSnapshotLeases.scopeUuid, scopeUuid.scopeUuid))
      .orderBy(asc(fxSystemSnapshotLeases.sessionId))
      .limit(MAX_RETAINED_FLOOR_LEASE_ROWS + 1),
  );
  const leaseObservation = yield* Effect.fromResult(observeLeasesResult(
    authority,
    clock.oldestAvailableCommitSeq,
    clock.lastCommitSeq,
    epochUuid.epochUuid,
    databaseNowMilliseconds,
    leaseRows,
  ));

  const commitRows = yield* queryEffect(
    "commitDirectory",
    tx.select({
      commitSeq: fxSystemCommits.commitSeq,
      committedAt: fxSystemCommits.committedAt,
    })
      .from(fxSystemCommits)
      .where(and(
        eq(fxSystemCommits.scopeUuid, scopeUuid.scopeUuid),
        gte(fxSystemCommits.commitSeq, clock.oldestAvailableCommitSeq),
      ))
      .orderBy(desc(fxSystemCommits.commitSeq))
      .limit(MAX_RETAINED_FLOOR_COMMIT_ROWS + 1),
  );
  const commitObservation = yield* Effect.fromResult(observeCommitsResult(
    authority,
    clock.oldestAvailableCommitSeq,
    clock.lastCommitSeq,
    databaseNowMilliseconds,
    cutoffMilliseconds,
    commitRows,
  ));
  const pinObservation = yield* Effect.fromResult(observePinsResult(
    authority,
    clock.oldestAvailableCommitSeq,
    clock.lastCommitSeq,
    pinFacets,
  ));

  const holdReasons = Object.freeze([
    ...leaseObservation.holdReasons,
    ...commitObservation.holdReasons,
    ...pinObservation.holdReasons,
  ]);
  const candidateFloor = CommitSeqSchema.make([
    leaseObservation.ceiling,
    commitObservation.ceiling,
    pinObservation.ceiling,
  ].reduce((minimum, value) => value < minimum ? value : minimum));
  return Object.freeze({
    status: "observed" as const,
    disposition: candidateFloor === clock.oldestAvailableCommitSeq
      ? "held" as const
      : "advanceable" as const,
    deploymentId: authority.deploymentId,
    scopeId: authority.scopeId,
    databaseNow: databaseNow.toISOString(),
    currentFloor: clock.oldestAvailableCommitSeq,
    lastCommitSeq: clock.lastCommitSeq,
    candidateFloor,
    leaseCeiling: leaseObservation.ceiling,
    timeWindowCeiling: commitObservation.ceiling,
    additionalPinCeiling: pinObservation.ceiling,
    holdReasons,
  });
});

function requireExactAuthority(
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
): Effect.Effect<void, RetainedHistoryFloorObservationError> {
  return clock.storageGeneration === "flarexdb_v1" &&
      clock.storageGeneration === authority.storageGeneration &&
      clock.storageGenerationFence === authority.storageGenerationFence &&
      clock.epoch === authority.epoch
    ? Effect.void
    : Effect.fail(observationError(authority, "staleAuthority"));
}

function publicationResult(
  observation: RetainedHistoryFloorCandidateObservation,
  disposition: RetainedHistoryFloorPublicationResult["disposition"],
  currentFloor: CommitSeq,
): RetainedHistoryFloorPublicationResult {
  return Object.freeze({
    status: "published" as const,
    disposition,
    deploymentId: observation.deploymentId,
    scopeId: observation.scopeId,
    databaseNow: observation.databaseNow,
    previousFloor: observation.currentFloor,
    currentFloor,
    lastCommitSeq: observation.lastCommitSeq,
    candidateFloor: observation.candidateFloor,
    leaseCeiling: observation.leaseCeiling,
    timeWindowCeiling: observation.timeWindowCeiling,
    additionalPinCeiling: observation.additionalPinCeiling,
    holdReasons: observation.holdReasons,
  });
}

function observeLeasesResult(
  authority: TrustedScopeAuthority,
  currentFloor: CommitSeq,
  lastCommitSeq: CommitSeq,
  currentEpochUuid: string,
  databaseNowMilliseconds: number,
  rows: ReadonlyArray<{
    readonly snapshotEpochUuid: unknown;
    readonly snapshotCommitSeq: unknown;
    readonly leaseExpiresAt: unknown;
  }>,
): Result.Result<
  Readonly<{
    readonly ceiling: CommitSeq;
    readonly holdReasons: ReadonlyArray<RetainedHistoryFloorHoldReason>;
  }>,
  RetainedHistoryFloorObservationError
> {
  if (rows.length > MAX_RETAINED_FLOOR_LEASE_ROWS) {
    return Result.succeed(Object.freeze({
      ceiling: currentFloor,
      holdReasons: Object.freeze(["leaseDirectoryLimit"] as const),
    }));
  }
  let ceiling = lastCommitSeq;
  for (const row of rows) {
    const expiresAt = finiteDateMilliseconds(row.leaseExpiresAt);
    if (
      expiresAt === undefined ||
      typeof row.snapshotEpochUuid !== "string" ||
      typeof row.snapshotCommitSeq !== "bigint"
    ) return Result.fail(observationError(authority, "storedEvidenceInvalid"));
    if (expiresAt <= databaseNowMilliseconds) continue;
    if (
      row.snapshotEpochUuid !== currentEpochUuid ||
      row.snapshotCommitSeq < currentFloor ||
      row.snapshotCommitSeq > lastCommitSeq
    ) {
      return Result.succeed(Object.freeze({
        ceiling: currentFloor,
        holdReasons: Object.freeze([
          "liveLeaseAuthorityUnavailable",
        ] as const),
      }));
    }
    if (row.snapshotCommitSeq < ceiling) {
      ceiling = CommitSeqSchema.make(row.snapshotCommitSeq);
    }
  }
  return Result.succeed(Object.freeze({
    ceiling: CommitSeqSchema.make(ceiling),
    holdReasons: Object.freeze([]),
  }));
}

function observeCommitsResult(
  authority: TrustedScopeAuthority,
  currentFloor: CommitSeq,
  lastCommitSeq: CommitSeq,
  databaseNowMilliseconds: number,
  cutoffMilliseconds: number,
  rows: ReadonlyArray<{
    readonly commitSeq: unknown;
    readonly committedAt: unknown;
  }>,
): Result.Result<
  Readonly<{
    readonly ceiling: CommitSeq;
    readonly holdReasons: ReadonlyArray<RetainedHistoryFloorHoldReason>;
  }>,
  RetainedHistoryFloorObservationError
> {
  if (lastCommitSeq === 0n) {
    return rows.length === 0
      ? Result.succeed(Object.freeze({
          ceiling: currentFloor,
          holdReasons: Object.freeze([]),
        }))
      : Result.fail(observationError(authority, "storedEvidenceInvalid"));
  }
  const inspected = rows.slice(0, MAX_RETAINED_FLOOR_COMMIT_ROWS);
  let expected = lastCommitSeq;
  let reachedRetainedBoundary = false;
  for (const row of inspected) {
    const committedAt = finiteDateMilliseconds(row.committedAt);
    if (
      typeof row.commitSeq !== "bigint" ||
      row.commitSeq !== expected ||
      committedAt === undefined ||
      committedAt > databaseNowMilliseconds
    ) return Result.fail(observationError(authority, "storedEvidenceInvalid"));
    if (committedAt <= cutoffMilliseconds) {
      return Result.succeed(Object.freeze({
        ceiling: CommitSeqSchema.make(row.commitSeq),
        holdReasons: Object.freeze([]),
      }));
    }
    if (
      row.commitSeq === currentFloor ||
      (currentFloor === 0n && row.commitSeq === 1n)
    ) {
      reachedRetainedBoundary = true;
      break;
    }
    expected = CommitSeqSchema.make(expected - 1n);
  }
  if (rows.length > MAX_RETAINED_FLOOR_COMMIT_ROWS) {
    return Result.succeed(Object.freeze({
      ceiling: currentFloor,
      holdReasons: Object.freeze(["commitDirectoryLimit"] as const),
    }));
  }
  if (!reachedRetainedBoundary) {
    return Result.fail(observationError(authority, "storedEvidenceInvalid"));
  }
  return Result.succeed(Object.freeze({
    ceiling: currentFloor,
    holdReasons: Object.freeze([]),
  }));
}

function observePinsResult(
  authority: TrustedScopeAuthority,
  currentFloor: CommitSeq,
  lastCommitSeq: CommitSeq,
  pins: ReadonlyArray<RetainedHistoryFloorPinFacetState>,
): Result.Result<
  Readonly<{
    readonly ceiling: CommitSeq;
    readonly holdReasons: ReadonlyArray<RetainedHistoryFloorHoldReason>;
  }>,
  RetainedHistoryFloorObservationError
> {
  let ceiling = lastCommitSeq;
  for (const pin of pins) {
    switch (pin.observation.kind) {
      case "absent":
        break;
      case "unavailable":
        return Result.succeed(Object.freeze({
          ceiling: currentFloor,
          holdReasons: Object.freeze(["requiredPinUnavailable"] as const),
        }));
      case "pinned":
        if (
          pin.observation.minimumCommitSeq < currentFloor ||
          pin.observation.minimumCommitSeq > lastCommitSeq
        ) return Result.fail(observationError(
          authority,
          "storedEvidenceInvalid",
        ));
        if (pin.observation.minimumCommitSeq < ceiling) {
          ceiling = pin.observation.minimumCommitSeq;
        }
        break;
    }
  }
  return Result.succeed(Object.freeze({
    ceiling: CommitSeqSchema.make(ceiling),
    holdReasons: Object.freeze([]),
  }));
}

const readDatabaseTimeEffect = Effect.fn(
  "RetainedHistoryFloor.readDatabaseTime",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
): Effect.fn.Return<
  Date,
  RetainedHistoryFloorPersistenceError | RetainedHistoryFloorObservationError
> {
  const result = yield* queryEffect(
    "databaseTime",
    tx.execute(sql`select clock_timestamp() as "now"`),
  );
  const rows = yield* Effect.try({
    try: () => rowsFromDriverExecuteResult(result, () => {
      throw new Error("driver result has no rows");
    }),
    catch: cause => new RetainedHistoryFloorPersistenceError({
      operation: "databaseTime",
      cause,
    }),
  });
  const row = rows[0];
  const now = typeof row === "object" && row !== null && "now" in row
    ? databaseTimestampFromUnknown(row.now)
    : null;
  return rows.length === 1 && now !== null
    ? now
    : yield* Effect.fail(observationError(
        authority,
        "storedEvidenceInvalid",
      ));
});

function queryEffect<Value>(
  operation: RetainedHistoryFloorPersistenceError["operation"],
  query: PromiseLike<Value>,
): Effect.Effect<Value, RetainedHistoryFloorPersistenceError> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: cause => new RetainedHistoryFloorPersistenceError({
      operation,
      cause,
    }),
  }));
}

function observationError(
  authority: TrustedScopeAuthority,
  reason: RetainedHistoryFloorObservationError["reason"],
  cause?: unknown,
): RetainedHistoryFloorObservationError {
  return new RetainedHistoryFloorObservationError({
    reason,
    deploymentId: authority.deploymentId,
    scopeId: authority.scopeId,
    cause,
  });
}
