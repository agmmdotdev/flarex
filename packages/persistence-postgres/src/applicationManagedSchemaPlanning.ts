import type {
  AppSchemaEvolutionPlanAuthorityPinsV1,
  PlanAppSchemaEvolutionV1Input,
} from "@flarex/managed-schema/planning";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { and, eq } from "drizzle-orm";
import { Data, Effect, Encoding, Result, Schema } from "effect";
import {
  SchemaManifestSha256Schema,
  type SchemaManifestSha256,
} from "flarex-protocol/schema-manifest";

import type { AppRowTransaction } from "./appRows";
import {
  claimApplicationPublicationPlanningEvidenceResult,
  type ApplicationPublication,
} from "./applicationPublication";
import {
  ApplicationSchemaAuthorityError,
  hasApplicationSchemaAuthorityComposition,
  type ApplicationSchemaAuthorityPublisher,
} from "./applicationSchemaAuthority";
import {
  ApplicationActivationError,
  hasApplicationActivationPlanningComposition,
  validateApplicationActiveSelectionInTransaction,
  type ApplicationActivationRepository,
} from "./applicationActivation";
import type { ReadApplicationReadinessError } from "./applicationReadiness";
import type { FlarexMetadataDatabase } from "./deployments";
import { runLocatedReadCommittedEffect } from "./locatedReadCommittedEffect";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import {
  lockScopeClockForShareInTransactionEffect,
  type LockScopeClockForShareError,
  type ScopeClockRecord,
} from "./scopeClock";
import type { ReadSchemaVersionArtifactError } from "./schemaVersionArtifacts";
import { scopePhysicalLocatorsEqual } from "./scopePhysicalLocator";
import {
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationRevisionsV2,
} from "./schema";
import {
  hasLocatedReadCommittedTargetDatabaseV1,
  LocatedReadCommittedTransactionFailureV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

const decodeSchemaManifestSha256Result = Schema.decodeUnknownResult(
  Schema.toType(SchemaManifestSha256Schema),
);

declare const applicationManagedSchemaPlanningPortBrand: unique symbol;

/** Process-local, read-only composition capability. */
export interface ApplicationManagedSchemaPlanningPort {
  readonly [applicationManagedSchemaPlanningPortBrand]: true;
}

export interface ApplicationManagedSchemaPlanningPortDependencies {
  readonly deploymentId: string;
  readonly controlDb: FlarexMetadataDatabase;
  readonly activation: ApplicationActivationRepository<unknown, unknown>;
  readonly schema: ApplicationSchemaAuthorityPublisher<unknown>;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >;
}

export type ApplicationManagedSchemaPlanningSnapshot =
  PlanAppSchemaEvolutionV1Input;

export class ApplicationManagedSchemaPlanningError extends Data.TaggedError(
  "ApplicationManagedSchemaPlanningError",
)<{
  readonly reason:
    | "invalidComposition"
    | "candidateEvidenceInvalid"
    | "candidateAlreadyActive"
    | "scopeAuthorityChanged"
    | "activeSchemaChanged"
    | "candidateSchemaChanged"
    | "candidatePublicationChanged"
    | "resourceFailure";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

type PortState = Readonly<ApplicationManagedSchemaPlanningPortDependencies>;

export type LoadApplicationManagedSchemaPlanningSnapshotError =
  | ApplicationManagedSchemaPlanningError
  | ApplicationActivationError
  | ReadApplicationReadinessError
  | ApplicationSchemaAuthorityError
  | ReadSchemaVersionArtifactError
  | TrustedScopeAuthorityError
  | LockScopeClockForShareError
  | LocatedReadCommittedTransactionFailureV1;

const portStates = new WeakMap<ApplicationManagedSchemaPlanningPort, PortState>();

export function createApplicationManagedSchemaPlanningPort(
  dependencies: ApplicationManagedSchemaPlanningPortDependencies,
): ApplicationManagedSchemaPlanningPort {
  // SAFETY: the port is an inert identity token; all state lives in the
  // module-local WeakMap keyed by this object identity.
  const port = Object.freeze({}) as ApplicationManagedSchemaPlanningPort;
  portStates.set(port, Object.freeze({
    deploymentId: dependencies.deploymentId,
    controlDb: dependencies.controlDb,
    activation: dependencies.activation,
    schema: dependencies.schema,
    authority: dependencies.authority,
  }));
  return port;
}

/** Exact shared-dependency guard used by the private apply port constructor. */
export function hasApplicationManagedSchemaPlanningApplicationComposition(
  port: unknown,
  dependencies: Readonly<{
    readonly deploymentId: string;
    readonly controlDb: FlarexMetadataDatabase;
    readonly activation: ApplicationActivationRepository<unknown, unknown>;
    readonly authority: TrustedScopeAuthorityResolutionPorts<
      LocatedReadCommittedAttemptTargetV1
    >;
  }>,
): port is ApplicationManagedSchemaPlanningPort {
  if (typeof port !== "object" || port === null) return false;
  // SAFETY: the typeof guard above proved the value is a non-null object;
  // the cast only narrows it to the WeakMap's registered port brand.
  const state = portStates.get(port as ApplicationManagedSchemaPlanningPort);
  return state !== undefined &&
    state.deploymentId === dependencies.deploymentId &&
    state.controlDb === dependencies.controlDb &&
    state.activation === dependencies.activation &&
    state.authority === dependencies.authority;
}

export const loadApplicationManagedSchemaPlanningSnapshot = Effect.fn(
  "ApplicationManagedSchemaPlanning.loadSnapshot",
)(function* (
  port: ApplicationManagedSchemaPlanningPort,
  candidatePublication: ApplicationPublication,
): Effect.fn.Return<
  ApplicationManagedSchemaPlanningSnapshot,
  LoadApplicationManagedSchemaPlanningSnapshotError
> {
  const state = portStates.get(port);
  if (state === undefined ||
    !hasApplicationSchemaAuthorityComposition(state.schema, state.controlDb) ||
    !hasApplicationActivationPlanningComposition(
      state.activation,
      state.controlDb,
      state.schema,
      state.authority,
    )) {
    return yield* planningFailure("invalidComposition");
  }
  const candidateEvidence = yield* Effect.fromResult(
    claimApplicationPublicationPlanningEvidenceResult(candidatePublication).pipe(
      Result.mapError(cause => planningFailureValue(
        "candidateEvidenceInvalid",
        false,
        cause,
      )),
    ),
  );
  const active = yield* state.activation.readActive();
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    state.deploymentId,
    state.authority,
  );
  if (located.authority.storageGeneration !== "flarexdb_v1" ||
    !authorityMatches(active.basis.authority, located.authority) ||
    !publicationAuthorityMatches(candidateEvidence.authority, located.authority)) {
    return yield* planningFailure("scopeAuthorityChanged");
  }
  if (!hasLocatedReadCommittedTargetDatabaseV1(
    located.target,
    candidateEvidence.database,
  )) {
    return yield* planningFailure("invalidComposition");
  }
  if (active.basis.revisionId === candidatePublication.revisionId) {
    return yield* planningFailure("candidateAlreadyActive");
  }

  const activeSchema = yield* state.schema.readPublished(Object.freeze({
    deploymentId: state.deploymentId,
    manifest: active.basis.manifest,
  }));
  const candidateSchema = yield* state.schema.readPublished(Object.freeze({
    deploymentId: state.deploymentId,
    manifest: candidateEvidence.manifest,
  }));
  if (!activeSchemaMatches(active.basis, activeSchema)) {
    return yield* planningFailure("activeSchemaChanged");
  }
  if (candidateSchema.applicationSchemaSha256 !==
      candidatePublication.schemaSha256) {
    return yield* planningFailure("candidateSchemaChanged");
  }

  const clock = yield* runLocatedReadCommittedEffect(
    located.target,
    {
      rollbackMessage: "Managed-schema planning snapshot read rolled back.",
      cleanupDefect: cause => planningFailureValue(
        "resourceFailure",
        false,
        cause,
      ),
    },
    tx => verifyTargetSnapshot(
      tx,
      located.authority,
      active.selection,
      candidatePublication,
    ),
  );
  const activeManifestSha256 = yield* Effect.fromResult(
    decodeManifestDigestResult(
      activeSchema.schemaManifestSha256,
      "activeSchemaChanged",
    ),
  );
  const candidateManifestSha256 = yield* Effect.fromResult(
    decodeManifestDigestResult(
      candidateSchema.schemaManifestSha256,
      "candidateSchemaChanged",
    ),
  );
  const authority = Object.freeze({
    scopeId: located.authority.scopeId,
    storageGeneration: located.authority.storageGeneration,
    storageGenerationFence: located.authority.storageGenerationFence,
    scopeEpoch: located.authority.epoch,
    activeSchemaVersionId: activeSchema.schemaVersionId,
    activeManifestSha256,
    candidateSchemaVersionId: candidateSchema.schemaVersionId,
    candidateManifestSha256,
    dataFrontierCommitSeq: clock.lastCommitSeq,
  } satisfies AppSchemaEvolutionPlanAuthorityPinsV1);
  return Object.freeze({
    authority,
    activeManifest: activeSchema.manifest,
    candidateManifest: candidateSchema.manifest,
  });
});

function verifyTargetSnapshot(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  activeSelection: unknown,
  candidatePublication: ApplicationPublication,
): Effect.Effect<ScopeClockRecord, ApplicationManagedSchemaPlanningError |
  Effect.Error<ReturnType<typeof lockScopeClockForShareInTransactionEffect>> |
  Effect.Error<ReturnType<typeof validateApplicationActiveSelectionInTransaction>>> {
  return Effect.gen(function* () {
    const clock = yield* lockScopeClockForShareInTransactionEffect(
      tx,
      authority.scopeId,
    );
    if (!clockMatchesAuthority(clock, authority)) {
      return yield* planningFailure("scopeAuthorityChanged");
    }
    yield* validateApplicationActiveSelectionInTransaction(
      activeSelection,
      tx,
      clock,
    );
    const revisions = yield* query(
      tx.select().from(fxSystemApplicationRevisionsV2).where(and(
        eq(fxSystemApplicationRevisionsV2.scopeId, authority.scopeId),
        eq(
          fxSystemApplicationRevisionsV2.revisionId,
          candidatePublication.revisionId,
        ),
      )).limit(1).for("share"),
    );
    const revision = revisions[0];
    if (revision === undefined || revision.status !== "inactive" ||
      revision.candidateId !== candidatePublication.candidateId ||
      revision.analysisId !== candidatePublication.analysisId ||
      encodeBytesToLowercaseHex(revision.sourceArtifactRootSha256) !==
        candidatePublication.sourceArtifactRootSha256 ||
      encodeBytesToLowercaseHex(revision.manifestSha256) !==
        candidatePublication.manifestSha256) {
      return yield* planningFailure("candidatePublicationChanged");
    }
    const publications = yield* query(
      tx.select().from(fxSystemApplicationPublicationsV1).where(and(
        eq(fxSystemApplicationPublicationsV1.scopeId, authority.scopeId),
        eq(
          fxSystemApplicationPublicationsV1.revisionId,
          candidatePublication.revisionId,
        ),
      )).limit(1).for("share"),
    );
    const publication = publications[0];
    if (publication === undefined || publication.revisionStatus !== "inactive" ||
      publication.candidateId !== candidatePublication.candidateId ||
      publication.analysisId !== candidatePublication.analysisId ||
      encodeBytesToLowercaseHex(publication.sourceArtifactRootSha256) !==
        candidatePublication.sourceArtifactRootSha256 ||
      encodeBytesToLowercaseHex(publication.manifestSha256) !==
        candidatePublication.manifestSha256 ||
      encodeBytesToLowercaseHex(publication.schemaSha256) !==
        candidatePublication.schemaSha256 ||
      encodeBytesToLowercaseHex(publication.functionCatalogSha256) !==
        candidatePublication.functionCatalogSha256 ||
      encodeBytesToLowercaseHex(publication.publicationSha256) !==
        candidatePublication.publicationSha256) {
      return yield* planningFailure("candidatePublicationChanged");
    }
    return clock;
  });
}

function query<Row>(statement: PromiseLike<ReadonlyArray<Row>>): Effect.Effect<
  ReadonlyArray<Row>,
  ApplicationManagedSchemaPlanningError
> {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: cause => planningFailureValue(
      "resourceFailure",
      isRetryableTransactionCause(cause),
      cause,
    ),
  });
}

function isRetryableTransactionCause(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const code = Reflect.get(cause, "code");
  return code === "40001" || code === "40P01" || code === "55P03";
}

function decodeManifestDigestResult(
  value: string,
  reason: "activeSchemaChanged" | "candidateSchemaChanged",
): Result.Result<SchemaManifestSha256, ApplicationManagedSchemaPlanningError> {
  return Encoding.decodeHex(value).pipe(
    Result.flatMap(decodeSchemaManifestSha256Result),
    Result.mapError(cause => planningFailureValue(
      reason,
      false,
      cause,
    )),
  );
}

function authorityMatches(
  left: TrustedScopeAuthority,
  right: TrustedScopeAuthority,
): boolean {
  return left.deploymentId === right.deploymentId &&
    left.scopeId === right.scopeId &&
    scopePhysicalLocatorsEqual(left.physicalLocator, right.physicalLocator) &&
    left.storageGeneration === right.storageGeneration &&
    left.storageGenerationFence === right.storageGenerationFence &&
    left.epoch === right.epoch;
}

function publicationAuthorityMatches(
  left: Readonly<{
    readonly scopeId: string;
    readonly storageGeneration: string;
    readonly storageGenerationFence: bigint;
    readonly epoch: string;
  }>,
  right: TrustedScopeAuthority,
): boolean {
  return left.scopeId === right.scopeId &&
    left.storageGeneration === right.storageGeneration &&
    left.storageGenerationFence === right.storageGenerationFence &&
    left.epoch === right.epoch;
}

function clockMatchesAuthority(
  clock: ScopeClockRecord,
  authority: TrustedScopeAuthority,
): boolean {
  return clock.scopeId === authority.scopeId &&
    clock.storageGeneration === authority.storageGeneration &&
    clock.storageGenerationFence === authority.storageGenerationFence &&
    clock.epoch === authority.epoch;
}

function activeSchemaMatches(
  active: Readonly<{
    readonly schemaVersionId: string;
    readonly applicationSchemaSha256: Uint8Array;
    readonly schemaManifestSha256: Uint8Array;
  }>,
  schema: Readonly<{
    readonly schemaVersionId: string;
    readonly applicationSchemaSha256: string;
    readonly schemaManifestSha256: string;
  }>,
): boolean {
  return active.schemaVersionId === schema.schemaVersionId &&
    encodeBytesToLowercaseHex(active.applicationSchemaSha256) ===
      schema.applicationSchemaSha256 &&
    encodeBytesToLowercaseHex(active.schemaManifestSha256) ===
      schema.schemaManifestSha256;
}

function planningFailure(
  reason: ApplicationManagedSchemaPlanningError["reason"],
  retryable = false,
  cause?: unknown,
) {
  return Effect.fail(planningFailureValue(reason, retryable, cause));
}

function planningFailureValue(
  reason: ApplicationManagedSchemaPlanningError["reason"],
  retryable = false,
  cause?: unknown,
) {
  return new ApplicationManagedSchemaPlanningError({
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  });
}
