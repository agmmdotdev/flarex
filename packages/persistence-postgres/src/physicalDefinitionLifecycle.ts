import {
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  Array as EffectArray,
  Cause,
  Data,
  Effect,
  Exit,
  Option,
  Order,
  Result,
  Schema,
} from "effect";
import {
  CatalogIndexDefinitionIdSchema,
  CatalogUniqueConstraintDefinitionIdSchema,
  type CatalogIndexDefinitionId,
  type CatalogUniqueConstraintDefinitionId,
} from "flarex-protocol/catalog";
import { appUniqueConstraintSpecSha256HexV1ToBytes } from
  "flarex-protocol/app-unique-constraint-definition";
import { appIndexPhysicalSpecSha256HexV1ToBytes } from
  "flarex-protocol/index-definition";
import {
  FlarexDbV1StorageGenerationSchema,
  type ScopeId,
} from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import type { FlarexMetadataDatabase } from "./deployments";
import {
  getAppIndexDefinitionByIdEffect,
  type ReadAppIndexDefinitionError,
} from "./appIndexDefinitions";
import {
  getAppUniqueConstraintDefinitionByIdEffect,
  type ReadAppUniqueConstraintDefinitionV1Error,
} from "./appUniqueConstraintDefinitions";
import {
  hasAppUniqueConstraintSetEligibilityEvidenceCompositionV1,
  type AppUniqueConstraintSetEligibilityResultV1,
} from "./appUniqueConstraintSetBuildV1";
import {
  readAppUniqueConstraintSetClosureV1Effect,
  type LocatedAppUniqueConstraintSetClosureV1,
  type ReadAppUniqueConstraintSetClosureV1Error,
} from "./appUniqueConstraintSetClosureV1";
import { hasExactOwnDataKeys } from "./exactOwnDataKeys";
import {
  lockScopeClockForShareInTransactionEffect,
  lockScopeClockForUpdateInTransactionEffect,
  getScopeClock,
  type LockScopeClockForShareError,
  type LockScopeClockForUpdateError,
  type ScopeClockRecord,
} from "./scopeClock";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type LocatedTrustedScopeAuthority,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import {
  captureScopePhysicalLocator,
  scopePhysicalLocatorsEqual,
} from "./scopePhysicalLocator";
import {
  isPublishedPhysicalRequirementSnapshotV1,
  type PublishedPhysicalRequirementSnapshotV1,
} from "./indexBuildReconciliation";
import {
  fxControlSchemaVersionIndexBindings,
  fxControlSchemaVersionUniqueConstraintBindings,
  fxSystemPhysicalDefinitionLifecycles,
  type PhysicalDefinitionLifecycleKindV1,
  type PhysicalDefinitionLifecycleV1,
} from "./schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
  type RunLocatedReadCommittedTransactionV1,
} from "./transactionSessionAttemptKernel";
import { createDefaultLocatedReadCommittedTransactionRunnerV1 } from
  "./transactionSessionActivation";

const PORT_KEYS = Object.freeze(["authority", "controlDb"] as const);
const INDEX_SUBJECT_KEYS = Object.freeze([
  "definitionKind",
  "deploymentId",
  "indexDefinitionId",
] as const);
const UNIQUE_SUBJECT_KEYS = Object.freeze([
  "definitionKind",
  "deploymentId",
  "uniqueConstraintDefinitionId",
] as const);
const TRANSITION_KEYS = Object.freeze(["expectedTransitionFence"] as const);
const MAX_SCHEMA_BINDINGS_PER_DEFINITION = 4_096;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const REQUEST_CODEC_VERSION = 1;
const TEXT_ENCODER = new TextEncoder();
const FLAREXDB_V1_STORAGE_GENERATION =
  FlarexDbV1StorageGenerationSchema.make("flarexdb_v1");
const decodeIndexDefinitionId = Schema.decodeUnknownResult(
  CatalogIndexDefinitionIdSchema,
);
const decodeUniqueDefinitionId = Schema.decodeUnknownResult(
  CatalogUniqueConstraintDefinitionIdSchema,
);
const portBrand: unique symbol = Symbol(
  "FlarexDB/PhysicalDefinitionLifecyclePort",
);
const preparedBrand: unique symbol = Symbol(
  "FlarexDB/PreparedPhysicalDefinitionLifecycleSubject",
);
const readinessBrand: unique symbol = Symbol(
  "FlarexDB/PreparedPhysicalDefinitionLifecycleReadiness",
);

export type PhysicalDefinitionLifecycleSubject =
  | Readonly<{
      readonly definitionKind: "index";
      readonly deploymentId: string;
      readonly indexDefinitionId: CatalogIndexDefinitionId;
    }>
  | Readonly<{
      readonly definitionKind: "unique_constraint";
      readonly deploymentId: string;
      readonly uniqueConstraintDefinitionId:
        CatalogUniqueConstraintDefinitionId;
    }>;

export interface LocatedPhysicalDefinitionLifecycleTarget
  extends LocatedReadCommittedAttemptTargetV1 {}

export function createLocatedPhysicalDefinitionLifecycleTarget(
  db: FlarexMetadataDatabase,
  physicalLocator: ScopePhysicalLocator,
  runReadCommitted: RunLocatedReadCommittedTransactionV1 =
    createDefaultLocatedReadCommittedTransactionRunnerV1(db),
): LocatedPhysicalDefinitionLifecycleTarget {
  return Object.freeze({
    physicalLocator: captureScopePhysicalLocator(physicalLocator),
    getCurrentClock: (scopeId: ScopeId) => getScopeClock(db, scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted,
  });
}

export interface PhysicalDefinitionLifecyclePortDependencies {
  readonly controlDb: FlarexMetadataDatabase;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedPhysicalDefinitionLifecycleTarget
  >;
}

export interface PhysicalDefinitionLifecyclePort {
  readonly [portBrand]: true;
}

export interface PreparedPhysicalDefinitionLifecycleSubject {
  readonly [preparedBrand]: true;
}

export interface PreparedPhysicalDefinitionLifecycleReadiness {
  readonly [readinessBrand]: true;
}

interface PreparedSubjectState {
  readonly port: PhysicalDefinitionLifecyclePort;
  readonly subject: PhysicalDefinitionLifecycleSubject;
  readonly definitionId: number;
  readonly physicalSpecSha256: Uint8Array;
  readonly bindingSetSha256: Uint8Array;
  readonly located: LocatedTrustedScopeAuthority<
    LocatedPhysicalDefinitionLifecycleTarget
  >;
}

interface PhysicalDefinitionLifecycleReadinessRequirement {
  readonly definitionKind: PhysicalDefinitionLifecycleKindV1;
  readonly definitionId: number;
  readonly physicalSpecSha256Hex: string;
}

interface PreparedReadinessState {
  readonly port: PhysicalDefinitionLifecyclePort;
  readonly deploymentId: string;
  readonly schemaVersionId: PublishedPhysicalRequirementSnapshotV1["schemaVersionId"];
  readonly located: LocatedTrustedScopeAuthority<
    LocatedPhysicalDefinitionLifecycleTarget
  >;
  readonly requirements:
    ReadonlyArray<PhysicalDefinitionLifecycleReadinessRequirement>;
}

const portStates = new WeakMap<
  PhysicalDefinitionLifecyclePort,
  Readonly<PhysicalDefinitionLifecyclePortDependencies>
>();
const preparedStates = new WeakMap<
  PreparedPhysicalDefinitionLifecycleSubject,
  Readonly<PreparedSubjectState>
>();
const preparedReadinessStates = new WeakMap<
  PreparedPhysicalDefinitionLifecycleReadiness,
  Readonly<PreparedReadinessState>
>();

export class InvalidPhysicalDefinitionLifecycleInputError extends Data.TaggedError(
  "InvalidPhysicalDefinitionLifecycleInputError",
)<{ readonly field: string }> {}

export class InvalidPhysicalDefinitionLifecyclePortError extends Data.TaggedError(
  "InvalidPhysicalDefinitionLifecyclePortError",
)<{}> {}

export class InvalidPreparedPhysicalDefinitionLifecycleSubjectError
  extends Data.TaggedError(
    "InvalidPreparedPhysicalDefinitionLifecycleSubjectError",
  )<{}> {}

export class InvalidPreparedPhysicalDefinitionLifecycleReadinessError
  extends Data.TaggedError(
    "InvalidPreparedPhysicalDefinitionLifecycleReadinessError",
  )<{}> {}

export class PhysicalDefinitionLifecycleDefinitionNotFoundError
  extends Data.TaggedError("PhysicalDefinitionLifecycleDefinitionNotFoundError")<{
    readonly definitionKind: PhysicalDefinitionLifecycleKindV1;
    readonly definitionId: number;
  }> {}

export class PhysicalDefinitionLifecycleBindingLimitError
  extends Data.TaggedError("PhysicalDefinitionLifecycleBindingLimitError")<{
    readonly observed: number;
    readonly maximum: number;
  }> {}

export class PhysicalDefinitionLifecyclePersistenceError extends Data.TaggedError(
  "PhysicalDefinitionLifecyclePersistenceError",
)<{
  readonly operation:
    | "readBindings"
    | "readLifecycle"
    | "writeLifecycle";
  readonly cause: unknown;
}> {}

export class PhysicalDefinitionLifecycleCryptoError extends Data.TaggedError(
  "PhysicalDefinitionLifecycleCryptoError",
)<{ readonly cause: unknown }> {}

export class PhysicalDefinitionLifecycleConflictError extends Data.TaggedError(
  "PhysicalDefinitionLifecycleConflictError",
)<{
  readonly reason:
    | "authorityChanged"
    | "expectedFenceMismatch"
    | "requestConflict"
    | "transitionInvalid"
    | "storedStateInvalid";
}> {}

export class PhysicalDefinitionLifecycleTransactionError extends Data.TaggedError(
  "PhysicalDefinitionLifecycleTransactionError",
)<{
  readonly disposition: "rollbackConfirmed" | "decisionUncertain";
  readonly cause: unknown;
}> {}

export class PhysicalDefinitionLifecycleFaultError extends Data.TaggedError(
  "PhysicalDefinitionLifecycleFaultError",
)<{ readonly cause: unknown }> {}

export type PreparePhysicalDefinitionLifecycleSubjectError =
  | InvalidPhysicalDefinitionLifecycleInputError
  | InvalidPhysicalDefinitionLifecyclePortError
  | PhysicalDefinitionLifecycleDefinitionNotFoundError
  | PhysicalDefinitionLifecycleBindingLimitError
  | PhysicalDefinitionLifecyclePersistenceError
  | PhysicalDefinitionLifecycleCryptoError
  | ReadAppIndexDefinitionError
  | ReadAppUniqueConstraintDefinitionV1Error
  | TrustedScopeAuthorityError;

export type InspectPhysicalDefinitionLifecycleError =
  | InvalidPreparedPhysicalDefinitionLifecycleSubjectError
  | LockScopeClockForShareError
  | PhysicalDefinitionLifecyclePersistenceError
  | PhysicalDefinitionLifecycleConflictError
  | PhysicalDefinitionLifecycleTransactionError;

export type TransitionPhysicalDefinitionLifecycleError =
  | InvalidPhysicalDefinitionLifecycleInputError
  | InvalidPreparedPhysicalDefinitionLifecycleSubjectError
  | LockScopeClockForUpdateError
  | PhysicalDefinitionLifecyclePersistenceError
  | PhysicalDefinitionLifecycleCryptoError
  | PhysicalDefinitionLifecycleConflictError
  | PhysicalDefinitionLifecycleFaultError
  | PhysicalDefinitionLifecycleTransactionError;

export type PreparePhysicalDefinitionLifecycleReadinessError =
  | InvalidPhysicalDefinitionLifecycleInputError
  | InvalidPhysicalDefinitionLifecyclePortError
  | ReadAppUniqueConstraintSetClosureV1Error
  | TrustedScopeAuthorityError;

export type PhysicalDefinitionLifecycleUniqueEligibility = Exclude<
  AppUniqueConstraintSetEligibilityResultV1,
  { readonly status: "not_ready" }
>;

export type ValidatePhysicalDefinitionLifecycleReadinessError =
  | InvalidPhysicalDefinitionLifecyclePortError
  | InvalidPreparedPhysicalDefinitionLifecycleReadinessError
  | PhysicalDefinitionLifecyclePersistenceError
  | PhysicalDefinitionLifecycleConflictError;

export interface StoredPhysicalDefinitionLifecycle {
  readonly scopeId: ScopeId;
  readonly deploymentId: string;
  readonly definitionKind: PhysicalDefinitionLifecycleKindV1;
  readonly definitionId: number;
  readonly lifecycle: PhysicalDefinitionLifecycleV1;
  readonly transitionFence: bigint;
  readonly physicalSpecSha256Hex: string;
  readonly requestSha256Hex: string;
  readonly storageGeneration: "flarexdb_v1";
  readonly storageGenerationFence: bigint;
  readonly epoch: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type InspectPhysicalDefinitionLifecycleResult =
  | Readonly<{ readonly status: "implicitActive" }>
  | Readonly<{
      readonly status: "persisted";
      readonly lifecycle: StoredPhysicalDefinitionLifecycle;
    }>;

export interface PhysicalDefinitionLifecycleTransitionInput {
  /** Zero denotes the absent, implicitly-active state. */
  readonly expectedTransitionFence: bigint;
}

export interface PhysicalDefinitionLifecycleTransitionResult {
  readonly disposition: "created" | "transitioned" | "replayed";
  readonly lifecycle: StoredPhysicalDefinitionLifecycle;
}

export interface PhysicalDefinitionLifecycleTransitionOptions {
  /** Persistence-owned deterministic rollback seam for direct adapter tests. */
  readonly faultAfterWrite?: () => void;
}

export interface PhysicalDefinitionLifecycleReadinessEntry {
  readonly definitionKind: PhysicalDefinitionLifecycleKindV1;
  readonly definitionId: number;
  readonly physicalSpecSha256Hex: string;
  readonly source: "implicit" | "persisted";
  readonly lifecycle: "active";
  readonly transitionFence: bigint;
}

export type PhysicalDefinitionLifecycleReadinessResult =
  | Readonly<{
      readonly status: "not_ready";
      readonly definitionKind: PhysicalDefinitionLifecycleKindV1;
      readonly definitionId: number;
      readonly lifecycle: Exclude<PhysicalDefinitionLifecycleV1, "active">;
    }>
  | Readonly<{
      readonly status: "ready";
      readonly entries: ReadonlyArray<PhysicalDefinitionLifecycleReadinessEntry>;
    }>;

export function createPhysicalDefinitionLifecyclePort(
  dependencies: PhysicalDefinitionLifecyclePortDependencies,
): PhysicalDefinitionLifecyclePort {
  const port = Object.freeze({ [portBrand]: true as const });
  if (hasExactOwnDataKeys(dependencies, PORT_KEYS)) {
    const controlDb = dependencies.controlDb;
    const authority = dependencies.authority;
    portStates.set(port, Object.freeze({ controlDb, authority }));
  }
  return port;
}

export function hasPhysicalDefinitionLifecycleComposition(
  port: unknown,
  controlDb: FlarexMetadataDatabase,
  authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >,
): port is PhysicalDefinitionLifecyclePort {
  if (typeof port !== "object" || port === null) return false;
  // SAFETY: the cast is used only for a WeakMap identity lookup; an unknown
  // object cannot acquire authority unless it is the exact registered key.
  const state = portStates.get(port as PhysicalDefinitionLifecyclePort);
  return state?.controlDb === controlDb && state.authority === authority;
}

export const preparePhysicalDefinitionLifecycleReadinessEffect = Effect.fn(
  "PhysicalDefinitionLifecycle.prepareReadiness",
)(function* (
  port: PhysicalDefinitionLifecyclePort,
  scopeId: ScopeId,
  snapshot: PublishedPhysicalRequirementSnapshotV1,
  uniqueEligibility: PhysicalDefinitionLifecycleUniqueEligibility,
): Effect.fn.Return<
  PreparedPhysicalDefinitionLifecycleReadiness,
  PreparePhysicalDefinitionLifecycleReadinessError
> {
  const state = portStates.get(port);
  if (state === undefined) {
    return yield* Effect.fail(new InvalidPhysicalDefinitionLifecyclePortError());
  }
  if (!isPublishedPhysicalRequirementSnapshotV1(snapshot, state.controlDb)) {
    return yield* Effect.fail(new InvalidPhysicalDefinitionLifecycleInputError({
      field: "requirementSnapshot",
    }));
  }
  const uniqueClosure = yield* readAppUniqueConstraintSetClosureV1Effect(
    state.controlDb,
    snapshot.deploymentId,
    snapshot.schemaVersionId,
  );
  if (
    uniqueClosure === null ||
    !uniqueEligibilityMatchesClosure(
      state,
      scopeId,
      snapshot,
      uniqueEligibility,
      uniqueClosure,
    )
  ) {
    return yield* Effect.fail(new InvalidPhysicalDefinitionLifecycleInputError({
      field: "uniqueConstraintEligibility",
    }));
  }
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    snapshot.deploymentId,
    state.authority,
  );
  if (located.authority.scopeId !== scopeId) {
    return yield* Effect.fail(new InvalidPhysicalDefinitionLifecycleInputError({
      field: "scopeId",
    }));
  }
  const requirements: PhysicalDefinitionLifecycleReadinessRequirement[] = [
    ...snapshot.definitions.map(definition => Object.freeze({
      definitionKind: "index" as const,
      definitionId: definition.indexDefinitionId,
      physicalSpecSha256Hex: definition.physicalSpecSha256Hex,
    })),
    ...uniqueClosure.members.map(definition => Object.freeze({
      definitionKind: "unique_constraint" as const,
      definitionId: definition.uniqueConstraintDefinitionId,
      physicalSpecSha256Hex: definition.physicalSpecSha256Hex,
    })),
  ];
  requirements.sort(compareReadinessRequirement);
  const prepared = Object.freeze({ [readinessBrand]: true as const });
  preparedReadinessStates.set(prepared, Object.freeze({
    port,
    deploymentId: snapshot.deploymentId,
    schemaVersionId: snapshot.schemaVersionId,
    located,
    requirements: Object.freeze(requirements),
  }));
  return prepared;
});

export const validatePhysicalDefinitionLifecycleReadinessInTransactionEffect =
  Effect.fn("PhysicalDefinitionLifecycle.validateReadinessInTransaction")(
    function* (
      port: PhysicalDefinitionLifecyclePort,
      prepared: PreparedPhysicalDefinitionLifecycleReadiness,
      tx: AppRowTransaction,
      authority: TrustedScopeAuthority,
      clock: ScopeClockRecord,
    ): Effect.fn.Return<
      PhysicalDefinitionLifecycleReadinessResult,
      ValidatePhysicalDefinitionLifecycleReadinessError
    > {
      if (!portStates.has(port)) {
        return yield* Effect.fail(
          new InvalidPhysicalDefinitionLifecyclePortError(),
        );
      }
      const state = preparedReadinessStates.get(prepared);
      if (state === undefined || state.port !== port) {
        return yield* Effect.fail(
          new InvalidPreparedPhysicalDefinitionLifecycleReadinessError(),
        );
      }
      yield* Effect.fromResult(
        requireReadinessAuthorityResult(state, authority, clock),
      );
      const indexIds = state.requirements.filter(
        requirement => requirement.definitionKind === "index",
      ).map(requirement => requirement.definitionId);
      const uniqueIds = state.requirements.filter(
        requirement => requirement.definitionKind === "unique_constraint",
      ).map(requirement => requirement.definitionId);
      const rows = [
        ...(indexIds.length === 0 ? [] : yield* queryEffect(
          "readLifecycle",
          () => tx.select().from(fxSystemPhysicalDefinitionLifecycles).where(and(
            eq(fxSystemPhysicalDefinitionLifecycles.scopeId, authority.scopeId),
            eq(fxSystemPhysicalDefinitionLifecycles.definitionKind, "index"),
            inArray(fxSystemPhysicalDefinitionLifecycles.definitionId, indexIds),
          )).for("share"),
        )),
        ...(uniqueIds.length === 0 ? [] : yield* queryEffect(
          "readLifecycle",
          () => tx.select().from(fxSystemPhysicalDefinitionLifecycles).where(and(
            eq(fxSystemPhysicalDefinitionLifecycles.scopeId, authority.scopeId),
            eq(
              fxSystemPhysicalDefinitionLifecycles.definitionKind,
              "unique_constraint",
            ),
            inArray(fxSystemPhysicalDefinitionLifecycles.definitionId, uniqueIds),
          )).for("share"),
        )),
      ];
      const rowsByKey = new Map(rows.map(row => [
        `${row.definitionKind}:${row.definitionId}`,
        row,
      ] as const));
      if (rowsByKey.size !== rows.length) {
        return yield* Effect.fail(new PhysicalDefinitionLifecycleConflictError({
          reason: "storedStateInvalid",
        }));
      }
      const entries: PhysicalDefinitionLifecycleReadinessEntry[] = [];
      for (const requirement of state.requirements) {
        const row = rowsByKey.get(
          `${requirement.definitionKind}:${requirement.definitionId}`,
        );
        if (row === undefined) {
          entries.push(Object.freeze({
            ...requirement,
            source: "implicit" as const,
            lifecycle: "active" as const,
            transitionFence: 0n,
          }));
          continue;
        }
        const stored = yield* decodeLifecycleRowEffect(row, {
          authority,
          deploymentId: state.deploymentId,
          definitionKind: requirement.definitionKind,
          definitionId: requirement.definitionId,
        });
        if (
          stored.physicalSpecSha256Hex !== requirement.physicalSpecSha256Hex ||
          stored.storageGeneration !== authority.storageGeneration ||
          stored.storageGenerationFence !== authority.storageGenerationFence ||
          stored.epoch !== authority.epoch
        ) {
          return yield* Effect.fail(new PhysicalDefinitionLifecycleConflictError({
            reason: "storedStateInvalid",
          }));
        }
        if (stored.lifecycle !== "active") {
          return Object.freeze({
            status: "not_ready" as const,
            definitionKind: requirement.definitionKind,
            definitionId: requirement.definitionId,
            lifecycle: stored.lifecycle,
          });
        }
        entries.push(Object.freeze({
          ...requirement,
          source: "persisted" as const,
          lifecycle: "active" as const,
          transitionFence: stored.transitionFence,
        }));
      }
      return Object.freeze({
        status: "ready" as const,
        entries: Object.freeze(entries),
      });
    },
  );

export const preparePhysicalDefinitionLifecycleSubjectEffect = Effect.fn(
  "PhysicalDefinitionLifecycle.prepareSubject",
)(function* (
  port: PhysicalDefinitionLifecyclePort,
  input: PhysicalDefinitionLifecycleSubject,
): Effect.fn.Return<
  PreparedPhysicalDefinitionLifecycleSubject,
  PreparePhysicalDefinitionLifecycleSubjectError
> {
  const state = portStates.get(port);
  if (state === undefined) {
    return yield* Effect.fail(new InvalidPhysicalDefinitionLifecyclePortError());
  }
  const subject = yield* Effect.fromResult(captureSubjectResult(input));
  const definition = yield* loadDefinitionEffect(state.controlDb, subject);
  const bindingSetSha256 = yield* loadBindingSetSha256Effect(
    state.controlDb,
    subject,
    definition.accessKind,
  );
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    subject.deploymentId,
    state.authority,
  );
  const prepared = Object.freeze({ [preparedBrand]: true as const });
  preparedStates.set(prepared, Object.freeze({
    port,
    subject,
    definitionId: definition.definitionId,
    physicalSpecSha256: copyBytes(definition.physicalSpecSha256),
    bindingSetSha256: copyBytes(bindingSetSha256),
    located,
  }));
  return prepared;
});

export const inspectPhysicalDefinitionLifecycleEffect = Effect.fn(
  "PhysicalDefinitionLifecycle.inspect",
)(function* (
  prepared: PreparedPhysicalDefinitionLifecycleSubject,
): Effect.fn.Return<
  InspectPhysicalDefinitionLifecycleResult,
  InspectPhysicalDefinitionLifecycleError
> {
  const state = preparedStates.get(prepared);
  if (state === undefined) {
    return yield* Effect.fail(
      new InvalidPreparedPhysicalDefinitionLifecycleSubjectError(),
    );
  }
  return yield* runLocatedTransaction(
    state.located.target,
    tx => inspectInTransaction(tx, state),
  );
});

export const beginPhysicalDefinitionDrainingEffect = Effect.fn(
  "PhysicalDefinitionLifecycle.beginDraining",
)(function* (
  prepared: PreparedPhysicalDefinitionLifecycleSubject,
  input: PhysicalDefinitionLifecycleTransitionInput,
  options: PhysicalDefinitionLifecycleTransitionOptions = {},
): Effect.fn.Return<
  PhysicalDefinitionLifecycleTransitionResult,
  TransitionPhysicalDefinitionLifecycleError
> {
  return yield* transitionEffect(prepared, input, "begin_draining", options);
});

export const cancelPhysicalDefinitionDrainingEffect = Effect.fn(
  "PhysicalDefinitionLifecycle.cancelDraining",
)(function* (
  prepared: PreparedPhysicalDefinitionLifecycleSubject,
  input: PhysicalDefinitionLifecycleTransitionInput,
  options: PhysicalDefinitionLifecycleTransitionOptions = {},
): Effect.fn.Return<
  PhysicalDefinitionLifecycleTransitionResult,
  TransitionPhysicalDefinitionLifecycleError
> {
  return yield* transitionEffect(prepared, input, "cancel_draining", options);
});

const transitionEffect = Effect.fn(
  "PhysicalDefinitionLifecycle.transition",
)(function* (
  prepared: PreparedPhysicalDefinitionLifecycleSubject,
  input: PhysicalDefinitionLifecycleTransitionInput,
  operation: "begin_draining" | "cancel_draining",
  options: PhysicalDefinitionLifecycleTransitionOptions,
): Effect.fn.Return<
  PhysicalDefinitionLifecycleTransitionResult,
  TransitionPhysicalDefinitionLifecycleError
> {
  const state = preparedStates.get(prepared);
  if (state === undefined) {
    return yield* Effect.fail(
      new InvalidPreparedPhysicalDefinitionLifecycleSubjectError(),
    );
  }
  const expectedFence = yield* Effect.fromResult(captureExpectedFenceResult(input));
  const requestSha256 = yield* requestDigestEffect(state, operation, expectedFence);
  return yield* runLocatedTransaction(
    state.located.target,
    tx => transitionInTransaction(
      tx,
      state,
      operation,
      expectedFence,
      requestSha256,
      options,
    ),
  );
});

const inspectInTransaction = Effect.fn(
  "PhysicalDefinitionLifecycle.inspectInTransaction",
)(function* (
  tx: AppRowTransaction,
  state: PreparedSubjectState,
): Effect.fn.Return<
  InspectPhysicalDefinitionLifecycleResult,
  LockScopeClockForShareError |
    PhysicalDefinitionLifecyclePersistenceError |
    PhysicalDefinitionLifecycleConflictError
> {
  const clock = yield* lockScopeClockForShareInTransactionEffect(
    tx,
    state.located.authority.scopeId,
  );
  yield* Effect.fromResult(requireAuthorityResult(state.located.authority, clock));
  const stored = yield* readLifecycleEffect(tx, state, "share");
  if (stored !== null) {
    yield* Effect.fromResult(requireStoredAuthorityResult(stored, state));
  }
  return stored === null
    ? Object.freeze({ status: "implicitActive" as const })
    : Object.freeze({ status: "persisted" as const, lifecycle: stored });
});

const transitionInTransaction = Effect.fn(
  "PhysicalDefinitionLifecycle.transitionInTransaction",
)(function* (
  tx: AppRowTransaction,
  state: PreparedSubjectState,
  operation: "begin_draining" | "cancel_draining",
  expectedFence: bigint,
  requestSha256: Uint8Array,
  options: PhysicalDefinitionLifecycleTransitionOptions,
): Effect.fn.Return<
  PhysicalDefinitionLifecycleTransitionResult,
  LockScopeClockForUpdateError |
    PhysicalDefinitionLifecyclePersistenceError |
    PhysicalDefinitionLifecycleConflictError |
    PhysicalDefinitionLifecycleFaultError
> {
  const authority = state.located.authority;
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* Effect.fromResult(requireAuthorityResult(authority, clock));
  const existing = yield* readLifecycleEffect(tx, state, "update");
  const actualFence = existing?.transitionFence ?? 0n;
  if (existing !== null) {
    yield* Effect.fromResult(requireStoredAuthorityResult(existing, state));
  }
  if (
    existing !== null &&
    existing.requestSha256Hex === encodeBytesToLowercaseHex(requestSha256)
  ) {
    const replayLifecycle = operation === "begin_draining"
      ? "draining"
      : "active";
    if (
      existing.lifecycle !== replayLifecycle ||
      existing.transitionFence !== expectedFence + 1n
    ) {
      return yield* Effect.fail(new PhysicalDefinitionLifecycleConflictError({
        reason: "storedStateInvalid",
      }));
    }
    return Object.freeze({ disposition: "replayed" as const, lifecycle: existing });
  }
  if (actualFence !== expectedFence) {
    return yield* Effect.fail(new PhysicalDefinitionLifecycleConflictError({
      reason: "expectedFenceMismatch",
    }));
  }
  const from = existing?.lifecycle ?? "active";
  const to: PhysicalDefinitionLifecycleV1 = operation === "begin_draining"
    ? "draining"
    : "active";
  if (
    (operation === "begin_draining" && from !== "active") ||
    (operation === "cancel_draining" && from !== "draining")
  ) {
    return yield* Effect.fail(new PhysicalDefinitionLifecycleConflictError({
      reason: existing === null ? "transitionInvalid" : "requestConflict",
    }));
  }
  const nextFence = actualFence + 1n;
  if (nextFence > MAX_POSTGRES_BIGINT) {
    return yield* Effect.fail(new PhysicalDefinitionLifecycleConflictError({
      reason: "storedStateInvalid",
    }));
  }
  const values = {
    deploymentId: state.subject.deploymentId,
    lifecycle: to,
    transitionFence: nextFence,
    physicalSpecSha256: state.physicalSpecSha256,
    requestCodecVersion: REQUEST_CODEC_VERSION,
    requestSha256,
    storageGeneration: FLAREXDB_V1_STORAGE_GENERATION,
    storageGenerationFence: authority.storageGenerationFence,
    epoch: authority.epoch,
    updatedAt: sql`clock_timestamp()`,
  };
  if (existing === null) {
    yield* queryEffect("writeLifecycle", () =>
      tx.insert(fxSystemPhysicalDefinitionLifecycles).values({
        scopeId: authority.scopeId,
        definitionKind: state.subject.definitionKind,
        definitionId: state.definitionId,
        ...values,
      }).returning({ scopeId: fxSystemPhysicalDefinitionLifecycles.scopeId })
    );
  } else {
    const updated = yield* queryEffect("writeLifecycle", () =>
      tx.update(fxSystemPhysicalDefinitionLifecycles).set(values).where(and(
        eq(fxSystemPhysicalDefinitionLifecycles.scopeId, authority.scopeId),
        eq(
          fxSystemPhysicalDefinitionLifecycles.definitionKind,
          state.subject.definitionKind,
        ),
        eq(fxSystemPhysicalDefinitionLifecycles.definitionId, state.definitionId),
        eq(fxSystemPhysicalDefinitionLifecycles.transitionFence, actualFence),
      )).returning({ scopeId: fxSystemPhysicalDefinitionLifecycles.scopeId })
    );
    if (updated.length !== 1) {
      return yield* Effect.fail(new PhysicalDefinitionLifecycleConflictError({
        reason: "expectedFenceMismatch",
      }));
    }
  }
  if (options.faultAfterWrite !== undefined) {
    yield* Effect.try({
      try: options.faultAfterWrite,
      catch: cause => new PhysicalDefinitionLifecycleFaultError({ cause }),
    });
  }
  const lifecycle = yield* readLifecycleEffect(tx, state, "update");
  if (lifecycle === null) {
    return yield* Effect.fail(new PhysicalDefinitionLifecycleConflictError({
      reason: "storedStateInvalid",
    }));
  }
  return Object.freeze({
    disposition: existing === null ? "created" as const : "transitioned" as const,
    lifecycle,
  });
});

interface LoadedDefinition {
  readonly definitionId: number;
  readonly accessKind: "developer" | "by_creation_time" | null;
  readonly tableId: number;
  readonly physicalSpecSha256: Uint8Array;
}

const loadDefinitionEffect = Effect.fn(
  "PhysicalDefinitionLifecycle.loadDefinition",
)(function* (
  db: FlarexMetadataDatabase,
  subject: PhysicalDefinitionLifecycleSubject,
): Effect.fn.Return<
  LoadedDefinition,
  PhysicalDefinitionLifecycleDefinitionNotFoundError |
    PhysicalDefinitionLifecyclePersistenceError |
    ReadAppIndexDefinitionError |
    ReadAppUniqueConstraintDefinitionV1Error
> {
  if (subject.definitionKind === "index") {
    const definition = yield* getAppIndexDefinitionByIdEffect(
      db,
      subject.deploymentId,
      subject.indexDefinitionId,
    );
    if (definition === null) {
      return yield* Effect.fail(
        new PhysicalDefinitionLifecycleDefinitionNotFoundError({
          definitionKind: subject.definitionKind,
          definitionId: subject.indexDefinitionId,
        }),
      );
    }
    return Object.freeze({
      definitionId: definition.indexDefinitionId,
      accessKind: definition.access.kind,
      tableId: definition.access.tableId,
      physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
        definition.physicalSpecSha256Hex,
      ),
    });
  }
  const definition = yield* getAppUniqueConstraintDefinitionByIdEffect(
    db,
    subject.deploymentId,
    subject.uniqueConstraintDefinitionId,
  );
  if (definition === null) {
    return yield* Effect.fail(
      new PhysicalDefinitionLifecycleDefinitionNotFoundError({
        definitionKind: subject.definitionKind,
        definitionId: subject.uniqueConstraintDefinitionId,
      }),
    );
  }
  return Object.freeze({
    definitionId: definition.uniqueConstraintDefinitionId,
    accessKind: null,
    tableId: definition.tableId,
    physicalSpecSha256: appUniqueConstraintSpecSha256HexV1ToBytes(
      definition.physicalSpecSha256Hex,
    ),
  });
});

const loadBindingSetSha256Effect = Effect.fn(
  "PhysicalDefinitionLifecycle.loadBindingSet",
)(function* (
  db: FlarexMetadataDatabase,
  subject: PhysicalDefinitionLifecycleSubject,
  accessKind: LoadedDefinition["accessKind"],
): Effect.fn.Return<
  Uint8Array,
  PhysicalDefinitionLifecycleBindingLimitError |
    PhysicalDefinitionLifecyclePersistenceError |
    PhysicalDefinitionLifecycleCryptoError
> {
  const rows = subject.definitionKind === "index" && accessKind === "developer"
    ? yield* queryEffect("readBindings", () => db.select({
        schemaVersionId: fxControlSchemaVersionIndexBindings.schemaVersionId,
      }).from(fxControlSchemaVersionIndexBindings).where(and(
        eq(fxControlSchemaVersionIndexBindings.deploymentId, subject.deploymentId),
        eq(
          fxControlSchemaVersionIndexBindings.indexDefinitionId,
          subject.indexDefinitionId,
        ),
      )).orderBy(asc(fxControlSchemaVersionIndexBindings.schemaVersionId))
        .limit(MAX_SCHEMA_BINDINGS_PER_DEFINITION + 1))
    : subject.definitionKind === "unique_constraint"
    ? yield* queryEffect("readBindings", () => db.select({
        schemaVersionId:
          fxControlSchemaVersionUniqueConstraintBindings.schemaVersionId,
      }).from(fxControlSchemaVersionUniqueConstraintBindings).where(and(
        eq(
          fxControlSchemaVersionUniqueConstraintBindings.deploymentId,
          subject.deploymentId,
        ),
        eq(
          fxControlSchemaVersionUniqueConstraintBindings
            .uniqueConstraintDefinitionId,
          subject.uniqueConstraintDefinitionId,
        ),
      )).orderBy(
        asc(fxControlSchemaVersionUniqueConstraintBindings.schemaVersionId),
      ).limit(MAX_SCHEMA_BINDINGS_PER_DEFINITION + 1))
    : [];
  if (rows.length > MAX_SCHEMA_BINDINGS_PER_DEFINITION) {
    return yield* Effect.fail(new PhysicalDefinitionLifecycleBindingLimitError({
      observed: rows.length,
      maximum: MAX_SCHEMA_BINDINGS_PER_DEFINITION,
    }));
  }
  const canonical = JSON.stringify({
    definitionId: definitionId(subject),
    definitionKind: subject.definitionKind,
    deploymentId: subject.deploymentId,
    format: "flarexdb-physical-definition-binding-set",
    schemaVersionIds: rows.map(row => row.schemaVersionId),
    version: 1,
  });
  return yield* sha256Effect(TEXT_ENCODER.encode(canonical));
});

function captureSubjectResult(
  input: PhysicalDefinitionLifecycleSubject,
): Result.Result<
  PhysicalDefinitionLifecycleSubject,
  InvalidPhysicalDefinitionLifecycleInputError
> {
  type CapturedSubject =
    | Readonly<{
        readonly definitionKind: "index";
        readonly deploymentId: string;
        readonly definitionId: unknown;
      }>
    | Readonly<{
        readonly definitionKind: "unique_constraint";
        readonly deploymentId: string;
        readonly definitionId: unknown;
      }>;
  const captured: Result.Result<
    CapturedSubject,
    InvalidPhysicalDefinitionLifecycleInputError
  > = Result.try({
    try: () => {
      if (
        input.definitionKind === "index" &&
        hasExactOwnDataKeys(input, INDEX_SUBJECT_KEYS) &&
        isNonBlankString(input.deploymentId)
      ) {
        return {
          definitionKind: "index" as const,
          deploymentId: input.deploymentId,
          definitionId: input.indexDefinitionId,
        };
      }
      if (
        input.definitionKind === "unique_constraint" &&
        hasExactOwnDataKeys(input, UNIQUE_SUBJECT_KEYS) &&
        isNonBlankString(input.deploymentId)
      ) {
        return {
          definitionKind: "unique_constraint" as const,
          deploymentId: input.deploymentId,
          definitionId: input.uniqueConstraintDefinitionId,
        };
      }
      throw new Error("Invalid lifecycle subject.");
    },
    catch: () => new InvalidPhysicalDefinitionLifecycleInputError({
      field: "subject",
    }),
  });
  return captured.pipe(Result.flatMap((value): Result.Result<
    PhysicalDefinitionLifecycleSubject,
    InvalidPhysicalDefinitionLifecycleInputError
  > =>
    value.definitionKind === "index"
      ? decodeIndexDefinitionId(value.definitionId).pipe(
          Result.map((indexDefinitionId): PhysicalDefinitionLifecycleSubject =>
            Object.freeze({
            definitionKind: "index" as const,
            deploymentId: value.deploymentId,
            indexDefinitionId,
          })),
          Result.mapError(() =>
            new InvalidPhysicalDefinitionLifecycleInputError({
              field: "indexDefinitionId",
            })
          ),
        )
      : decodeUniqueDefinitionId(value.definitionId).pipe(
          Result.map((uniqueConstraintDefinitionId):
            PhysicalDefinitionLifecycleSubject => Object.freeze({
              definitionKind: "unique_constraint" as const,
              deploymentId: value.deploymentId,
              uniqueConstraintDefinitionId,
            })),
          Result.mapError(() =>
            new InvalidPhysicalDefinitionLifecycleInputError({
              field: "uniqueConstraintDefinitionId",
            })
          ),
        )
  ));
}

function captureExpectedFenceResult(
  input: PhysicalDefinitionLifecycleTransitionInput,
): Result.Result<bigint, InvalidPhysicalDefinitionLifecycleInputError> {
  return Result.try({
    try: () => {
      if (!hasExactOwnDataKeys(input, TRANSITION_KEYS)) {
        throw new Error("Unexpected transition input.");
      }
      const fence = input.expectedTransitionFence;
      if (typeof fence !== "bigint" || fence < 0n || fence > MAX_POSTGRES_BIGINT) {
        throw new Error("Invalid transition fence.");
      }
      return fence;
    },
    catch: () => new InvalidPhysicalDefinitionLifecycleInputError({
      field: "expectedTransitionFence",
    }),
  });
}

function definitionId(subject: PhysicalDefinitionLifecycleSubject): number {
  return subject.definitionKind === "index"
    ? subject.indexDefinitionId
    : subject.uniqueConstraintDefinitionId;
}

function compareReadinessRequirement(
  left: PhysicalDefinitionLifecycleReadinessRequirement,
  right: PhysicalDefinitionLifecycleReadinessRequirement,
): number {
  const kindOrder = left.definitionKind.localeCompare(right.definitionKind);
  return kindOrder === 0 ? left.definitionId - right.definitionId : kindOrder;
}

function uniqueEligibilityMatchesClosure(
  state: Readonly<PhysicalDefinitionLifecyclePortDependencies>,
  scopeId: ScopeId,
  snapshot: PublishedPhysicalRequirementSnapshotV1,
  eligibility: PhysicalDefinitionLifecycleUniqueEligibility,
  closure: LocatedAppUniqueConstraintSetClosureV1,
): boolean {
  if (
    closure.closure.deploymentId !== snapshot.deploymentId ||
    closure.closure.schemaVersionId !== snapshot.schemaVersionId
  ) return false;
  if (eligibility.status === "not_required") {
    return closure.members.length === 0 && closure.closure.definitionCount === 0;
  }
  const evidence = eligibility.evidence;
  if (
    !hasAppUniqueConstraintSetEligibilityEvidenceCompositionV1(
      evidence,
      state.controlDb,
      state.authority,
    ) ||
    evidence.deploymentId !== snapshot.deploymentId ||
    evidence.scopeId !== scopeId ||
    evidence.schemaVersionId !== snapshot.schemaVersionId ||
    evidence.definitionCount !== closure.closure.definitionCount ||
    evidence.definitionSetSha256Hex !== closure.closure.definitionSetSha256Hex
  ) return false;
  const tableIds = EffectArray.sort(
    new Set(closure.members.map(member => member.tableId)),
    Order.Number,
  );
  return tableIds.length === evidence.tableIds.length &&
    tableIds.every((tableId, index) => tableId === evidence.tableIds[index]);
}

function requireReadinessAuthorityResult(
  state: PreparedReadinessState,
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
): Result.Result<void, PhysicalDefinitionLifecycleConflictError> {
  const prepared = state.located.authority;
  return authority.deploymentId === state.deploymentId &&
      authority.deploymentId === prepared.deploymentId &&
      authority.scopeId === prepared.scopeId &&
      scopePhysicalLocatorsEqual(
        authority.physicalLocator,
        prepared.physicalLocator,
      ) &&
      authority.storageGeneration === prepared.storageGeneration &&
      authority.storageGenerationFence === prepared.storageGenerationFence &&
      authority.epoch === prepared.epoch
    ? requireAuthorityResult(authority, clock)
    : Result.fail(new PhysicalDefinitionLifecycleConflictError({
        reason: "authorityChanged",
      }));
}

function requireAuthorityResult(
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
): Result.Result<void, PhysicalDefinitionLifecycleConflictError> {
  return authority.storageGeneration === "flarexdb_v1" &&
      clock.scopeId === authority.scopeId &&
      clock.storageGeneration === authority.storageGeneration &&
      clock.storageGenerationFence === authority.storageGenerationFence &&
      clock.epoch === authority.epoch
    ? Result.succeed(undefined)
    : Result.fail(new PhysicalDefinitionLifecycleConflictError({
        reason: "authorityChanged",
      }));
}

function requireStoredAuthorityResult(
  stored: StoredPhysicalDefinitionLifecycle,
  state: PreparedSubjectState,
): Result.Result<void, PhysicalDefinitionLifecycleConflictError> {
  const authority = state.located.authority;
  return stored.physicalSpecSha256Hex ===
      encodeBytesToLowercaseHex(state.physicalSpecSha256) &&
      stored.storageGeneration === authority.storageGeneration &&
      stored.storageGenerationFence === authority.storageGenerationFence &&
      stored.epoch === authority.epoch
    ? Result.succeed(undefined)
    : Result.fail(new PhysicalDefinitionLifecycleConflictError({
        reason: "storedStateInvalid",
      }));
}

const requestDigestEffect = Effect.fn(
  "PhysicalDefinitionLifecycle.requestDigest",
)(function* (
  state: PreparedSubjectState,
  operation: "begin_draining" | "cancel_draining",
  expectedTransitionFence: bigint,
): Effect.fn.Return<Uint8Array, PhysicalDefinitionLifecycleCryptoError> {
  const canonical = JSON.stringify({
    bindingSetSha256Hex: encodeBytesToLowercaseHex(state.bindingSetSha256),
    definitionId: state.definitionId,
    definitionKind: state.subject.definitionKind,
    deploymentId: state.subject.deploymentId,
    expectedTransitionFence: expectedTransitionFence.toString(),
    format: "flarexdb-physical-definition-lifecycle-request",
    operation,
    physicalSpecSha256Hex: encodeBytesToLowercaseHex(state.physicalSpecSha256),
    requestCodecVersion: REQUEST_CODEC_VERSION,
    scopeId: state.located.authority.scopeId,
  });
  return yield* sha256Effect(TEXT_ENCODER.encode(canonical));
});

const sha256Effect = Effect.fn("PhysicalDefinitionLifecycle.sha256")((
  bytes: Uint8Array,
): Effect.Effect<Uint8Array, PhysicalDefinitionLifecycleCryptoError> =>
  Effect.tryPromise({
    try: async () => new Uint8Array(
      await crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(bytes)),
    ),
    catch: cause => new PhysicalDefinitionLifecycleCryptoError({ cause }),
  }));

function readLifecycleEffect(
  tx: AppRowTransaction,
  state: PreparedSubjectState,
  lock: "share" | "update",
): Effect.Effect<
  StoredPhysicalDefinitionLifecycle | null,
  PhysicalDefinitionLifecyclePersistenceError |
    PhysicalDefinitionLifecycleConflictError
> {
  const base = tx.select().from(fxSystemPhysicalDefinitionLifecycles).where(and(
    eq(
      fxSystemPhysicalDefinitionLifecycles.scopeId,
      state.located.authority.scopeId,
    ),
    eq(
      fxSystemPhysicalDefinitionLifecycles.definitionKind,
      state.subject.definitionKind,
    ),
    eq(fxSystemPhysicalDefinitionLifecycles.definitionId, state.definitionId),
  )).limit(1);
  return queryEffect("readLifecycle", () => base.for(lock)).pipe(
    Effect.flatMap(rows => rows[0] === undefined
      ? Effect.succeed(null)
      : decodeLifecycleRowEffect(rows[0], {
          authority: state.located.authority,
          deploymentId: state.subject.deploymentId,
          definitionKind: state.subject.definitionKind,
          definitionId: state.definitionId,
        })),
  );
}

interface PhysicalDefinitionLifecycleRowExpectation {
  readonly authority: TrustedScopeAuthority;
  readonly deploymentId: string;
  readonly definitionKind: PhysicalDefinitionLifecycleKindV1;
  readonly definitionId: number;
}

const decodeLifecycleRowEffect = Effect.fn(
  "PhysicalDefinitionLifecycle.decodeStored",
)(function* (
  row: typeof fxSystemPhysicalDefinitionLifecycles.$inferSelect,
  expected: PhysicalDefinitionLifecycleRowExpectation,
): Effect.fn.Return<
  StoredPhysicalDefinitionLifecycle,
  PhysicalDefinitionLifecycleConflictError
> {
  const createdAt = copyFiniteDate(row.createdAt);
  const updatedAt = copyFiniteDate(row.updatedAt);
  if (
    row.scopeId !== expected.authority.scopeId ||
    row.deploymentId !== expected.deploymentId ||
    row.definitionKind !== expected.definitionKind ||
    row.definitionId !== expected.definitionId ||
    !["active", "draining", "retired", "reactivating"].includes(row.lifecycle) ||
    row.transitionFence < 1n ||
    !isUint8ArrayWithByteLength(row.physicalSpecSha256, 32) ||
    row.requestCodecVersion !== REQUEST_CODEC_VERSION ||
    !isUint8ArrayWithByteLength(row.requestSha256, 32) ||
    row.storageGeneration !== "flarexdb_v1" ||
    row.storageGenerationFence < 1n ||
    !isNonBlankString(row.epoch) ||
    createdAt === undefined ||
    updatedAt === undefined ||
    updatedAt.getTime() < createdAt.getTime()
  ) {
    return yield* Effect.fail(new PhysicalDefinitionLifecycleConflictError({
      reason: "storedStateInvalid",
    }));
  }
  return Object.freeze({
    scopeId: row.scopeId,
    deploymentId: row.deploymentId,
    definitionKind: row.definitionKind,
    definitionId: row.definitionId,
    lifecycle: row.lifecycle,
    transitionFence: row.transitionFence,
    physicalSpecSha256Hex: encodeBytesToLowercaseHex(row.physicalSpecSha256),
    requestSha256Hex: encodeBytesToLowercaseHex(row.requestSha256),
    storageGeneration: row.storageGeneration,
    storageGenerationFence: row.storageGenerationFence,
    epoch: row.epoch,
    createdAt,
    updatedAt,
  });
});

function queryEffect<Row>(
  operation: PhysicalDefinitionLifecyclePersistenceError["operation"],
  query: () => PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<
  ReadonlyArray<Row>,
  PhysicalDefinitionLifecyclePersistenceError
> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: query,
    catch: cause => new PhysicalDefinitionLifecyclePersistenceError({
      operation,
      cause,
    }),
  }));
}

interface StartedLocatedTransaction<Value, Failure> {
  readonly promise: Promise<Value>;
  readonly rollbackSignal: Error;
  readonly callbackCause: () => Cause.Cause<Failure> | undefined;
}

function startLocatedTransaction<Value, Failure>(
  target: LocatedPhysicalDefinitionLifecycleTarget,
  work: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): StartedLocatedTransaction<Value, Failure> {
  let observedCause: Cause.Cause<Failure> | undefined;
  const rollbackSignal = new Error(
    "Physical-definition lifecycle transaction rolled back.",
  );
  const promise = target[RUN_LOCATED_READ_COMMITTED_V1](async tx => {
    const exit = await Effect.runPromise(Effect.exit(work(tx)));
    if (Exit.isFailure(exit)) {
      observedCause = exit.cause;
      throw rollbackSignal;
    }
    return exit.value;
  });
  return Object.freeze({
    promise,
    rollbackSignal,
    callbackCause: () => observedCause,
  });
}

const runLocatedTransaction = Effect.fn(
  "PhysicalDefinitionLifecycle.runLocatedTransaction",
)(function* <Value, Failure>(
  target: LocatedPhysicalDefinitionLifecycleTarget,
  work: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): Effect.fn.Return<
  Value,
  Failure | PhysicalDefinitionLifecycleTransactionError
> {
  const started = startLocatedTransaction(target, work);
  const settled = yield* Effect.uninterruptible(Effect.exit(Effect.tryPromise({
    try: () => started.promise,
    catch: cause => cause,
  })));
  if (Exit.isSuccess(settled)) return settled.value;
  const error = Cause.findErrorOption(settled.cause);
  if (Option.isNone(error)) return yield* Effect.die(settled.cause);
  const cause = error.value;
  const callbackCause = started.callbackCause();
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack" &&
    cause.issue.callbackCause === started.rollbackSignal &&
    callbackCause !== undefined
  ) {
    return yield* Effect.failCause(callbackCause);
  }
  const disposition = cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      (cause.issue.kind === "decisionUncertain" ||
        cause.issue.kind === "callbackCleanupFailed")
    ? "decisionUncertain" as const
    : "rollbackConfirmed" as const;
  return yield* Effect.fail(new PhysicalDefinitionLifecycleTransactionError({
    disposition,
    cause,
  }));
});
