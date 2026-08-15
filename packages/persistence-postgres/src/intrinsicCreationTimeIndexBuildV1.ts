import { bytesEqualFullScan, copyBytes } from "@flarex/utils/bytes";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { and, asc, desc, eq, gt, lte, sql } from "drizzle-orm";
import { Cause, Data, Effect, Exit, Option, Result, Schema } from "effect";
import {
  AppDocumentSystemFieldV1Error,
  type AppCreationTimeV1,
  verifyAppDocumentEvidenceV1,
} from "flarex-protocol/app-document";
import {
  appRowIdHexV1FromBytes,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  CatalogIndexDefinitionIdSchema,
  type CatalogIndexDefinitionId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import { appIndexPhysicalSpecSha256HexV1ToBytes } from
  "flarex-protocol/index-definition";
import type { IndexBuildStateRecord } from "./indexBuildStates";
import {
  encodeAppOrderedIndexKeyV1,
  OrderedIndexKeyTooLargeError,
  orderedIndexCreationTimeV1,
  orderedIndexKeyHexV1ToBytes,
  orderedIndexRowIdHexV1FromBytesResult,
  orderedIndexRowIdHexV1ToBytes,
  type OrderedIndexKeyHexV1,
  type OrderedIndexRowIdHexV1,
} from "flarex-protocol/ordered-index";
import {
  FlarexValueCodecV1Error,
  FlarexValueEvidenceV1Error,
  type CanonicalFlarexValueV1,
} from "flarex-protocol/value";
import {
  projectScopeIdUuidV1Result,
  type CommitSeq,
  type ScopeId,
  type ScopeEpochUuidV1,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";

import {
  appendBackfilledLiveAppIndexEntryRevisionInTransactionEffect,
  readCurrentAppIndexEntriesForRowInTransactionEffect,
  type AppendAppIndexEntryRevisionV1Error,
  type AppIndexEntryTransaction,
  type ReadAppIndexRangeV1Error,
} from "./appIndexEntries";
import { lowerAppDeveloperIndexKeyV1 } from "./appDeveloperIndexCommitV1";
import {
  locateAppCreationTimeIndexDefinitionForTableEffect,
  locateAppIndexDefinitionByIdEffect,
  type LocatedAppIndexDefinitionV1,
  type ReadAppIndexDefinitionError,
} from "./appIndexDefinitions";
import type { AppRowTransaction } from "./appRows";
import type { FlarexMetadataDatabase } from "./deployments";
import { hasExactOwnDataKeys } from "./exactOwnDataKeys";
import {
  decodeIndexBuildStateRowResult,
  IndexBuildStateCorruptionError,
} from "./indexBuildStates";
import {
  lockScopeClockForUpdateInTransactionEffect,
  type LockScopeClockForUpdateError,
} from "./scopeClock";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import {
  fxAppIndexEntryCurrent,
  fxAppIndexEntryRevisions,
  fxAppRowCurrent,
  fxAppRowRevisions,
  fxSystemIndexBuildStates,
} from "./schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

const INPUT_KEYS = Object.freeze([
  "deploymentId",
  "indexDefinitionId",
  "pageSize",
] as const);
export const MAX_APP_ORDERED_INDEX_BUILD_PAGE_SIZE_V1 = 16;
export const MAX_INTRINSIC_INDEX_BUILD_PAGE_SIZE_V1 =
  MAX_APP_ORDERED_INDEX_BUILD_PAGE_SIZE_V1;

const decodeDefinitionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogIndexDefinitionIdSchema),
);

export interface LocateIntrinsicCreationTimeIndexV1Input {
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly tableId: CatalogTableId;
}

export interface IntrinsicCreationTimeIndexDefinitionPortV1 {
  readonly locate: (
    input: LocateIntrinsicCreationTimeIndexV1Input,
  ) => Effect.Effect<
    LocatedAppIndexDefinitionV1 | null,
    ReadAppIndexDefinitionError
  >;
}

/** Control-catalog adapter used by the private C08 point-commit composition. */
export function createIntrinsicCreationTimeIndexDefinitionPortV1(
  controlDb: FlarexMetadataDatabase,
): IntrinsicCreationTimeIndexDefinitionPortV1 {
  return Object.freeze({
    locate: Effect.fn("IntrinsicCreationTimeIndexDefinition.locate")(
      (input: LocateIntrinsicCreationTimeIndexV1Input) =>
        locateAppCreationTimeIndexDefinitionForTableEffect(
          controlDb,
          input.deploymentId,
          input.scopeId,
          input.tableId,
        ),
    ),
  });
}

export interface BuildAppOrderedIndexV1Input {
  readonly deploymentId: string;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly pageSize: number;
}
export type BuildIntrinsicCreationTimeIndexV1Input =
  BuildAppOrderedIndexV1Input;
export type BuildAppDeveloperOrderedIndexV1Input = BuildAppOrderedIndexV1Input;

export interface LocatedAppOrderedIndexBuildTargetV1
  extends LocatedReadCommittedAttemptTargetV1 {}
export type LocatedIntrinsicCreationTimeIndexBuildTargetV1 =
  LocatedAppOrderedIndexBuildTargetV1;

export interface AppOrderedIndexBuildPortsV1 {
  readonly controlDb: FlarexMetadataDatabase;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedAppOrderedIndexBuildTargetV1
  >;
}
export type IntrinsicCreationTimeIndexBuildPortsV1 =
  AppOrderedIndexBuildPortsV1;
export type AppDeveloperOrderedIndexBuildPortsV1 = AppOrderedIndexBuildPortsV1;

export type AppOrderedIndexBuildFaultPointV1 =
  | "afterScopeClockLock"
  | "afterLifecycleTransition"
  | "afterEntryWrite"
  | "beforeEnable";
export type IntrinsicCreationTimeIndexBuildFaultPointV1 =
  AppOrderedIndexBuildFaultPointV1;

export interface AppOrderedIndexBuildOptionsV1 {
  readonly faultAfter?: (
    point: AppOrderedIndexBuildFaultPointV1,
    rowId: OrderedIndexRowIdHexV1 | null,
  ) => void | Promise<void>;
}
export type IntrinsicCreationTimeIndexBuildOptionsV1 =
  AppOrderedIndexBuildOptionsV1;
export type AppDeveloperOrderedIndexBuildOptionsV1 =
  AppOrderedIndexBuildOptionsV1;

export interface AppOrderedIndexBuildResultV1 {
  readonly status: "advanced" | "enabled" | "replayed";
  readonly scopeId: ScopeId;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly lifecycle:
    | "building"
    | "backfilling"
    | "validating"
    | "enabled";
  readonly processedRows: number;
  readonly replayedRows: number;
  readonly cursorRowId: OrderedIndexRowIdHexV1 | null;
}
export type IntrinsicCreationTimeIndexBuildResultV1 =
  AppOrderedIndexBuildResultV1;
export type AppDeveloperOrderedIndexBuildResultV1 =
  AppOrderedIndexBuildResultV1;

export class InvalidIntrinsicCreationTimeIndexBuildInputV1Error
  extends Data.TaggedError(
    "InvalidIntrinsicCreationTimeIndexBuildInputV1Error",
  )<{
    readonly reason:
      | "invalidInputShape"
      | "invalidDeploymentId"
      | "invalidIndexDefinitionId"
      | "invalidPageSize";
  }> {}

export class IntrinsicCreationTimeIndexDefinitionUnavailableV1Error
  extends Data.TaggedError(
    "IntrinsicCreationTimeIndexDefinitionUnavailableV1Error",
  )<{
    readonly deploymentId: string;
    readonly scopeId: ScopeId;
    readonly indexDefinitionId: CatalogIndexDefinitionId;
    readonly reason: "missing" | "notCreationTime";
  }> {}

export class IntrinsicCreationTimeIndexBuildStaleAuthorityV1Error
  extends Data.TaggedError(
    "IntrinsicCreationTimeIndexBuildStaleAuthorityV1Error",
  )<{
    readonly scopeId: ScopeId;
    readonly indexDefinitionId: CatalogIndexDefinitionId;
    readonly reason:
      | "storageGeneration"
      | "storageGenerationFence"
      | "epoch";
  }> {}

export class IntrinsicCreationTimeIndexBuildStateV1Error
  extends Data.TaggedError("IntrinsicCreationTimeIndexBuildStateV1Error")<{
    readonly scopeId: ScopeId;
    readonly indexDefinitionId: CatalogIndexDefinitionId;
    readonly reason:
      | "buildMissing"
      | "unsupportedLifecycle"
      | "concurrentStateChange"
      | "currentContentsMismatch"
      | "indexHistoryMismatch";
    readonly detail?: string;
  }> {}

export class IntrinsicCreationTimeIndexBuildIntegrationV1Error
  extends Data.TaggedError(
    "IntrinsicCreationTimeIndexBuildIntegrationV1Error",
  )<{
    readonly phase: "targetTransaction";
    readonly retryable: boolean;
    readonly cause: unknown;
  }> {}

export class IntrinsicCreationTimeIndexBuildDecisionUncertainV1Error
  extends Data.TaggedError(
    "IntrinsicCreationTimeIndexBuildDecisionUncertainV1Error",
  )<{
    readonly scopeId: ScopeId;
    readonly indexDefinitionId: CatalogIndexDefinitionId;
    readonly cause: unknown;
  }> {}

export class InvalidAppDeveloperOrderedIndexBuildInputV1Error
  extends Data.TaggedError(
    "InvalidAppDeveloperOrderedIndexBuildInputV1Error",
  )<{
    readonly reason:
      | "invalidInputShape"
      | "invalidDeploymentId"
      | "invalidIndexDefinitionId"
      | "invalidPageSize";
  }> {}

export class AppDeveloperOrderedIndexDefinitionUnavailableV1Error
  extends Data.TaggedError(
    "AppDeveloperOrderedIndexDefinitionUnavailableV1Error",
  )<{
    readonly deploymentId: string;
    readonly scopeId: ScopeId;
    readonly indexDefinitionId: CatalogIndexDefinitionId;
    readonly reason: "missing" | "notDeveloper";
  }> {}

export class AppDeveloperOrderedIndexBuildStaleAuthorityV1Error
  extends Data.TaggedError(
    "AppDeveloperOrderedIndexBuildStaleAuthorityV1Error",
  )<{
    readonly scopeId: ScopeId;
    readonly indexDefinitionId: CatalogIndexDefinitionId;
    readonly reason:
      | "storageGeneration"
      | "storageGenerationFence"
      | "epoch";
  }> {}

export class AppDeveloperOrderedIndexBuildStateV1Error
  extends Data.TaggedError("AppDeveloperOrderedIndexBuildStateV1Error")<{
    readonly scopeId: ScopeId;
    readonly indexDefinitionId: CatalogIndexDefinitionId;
    readonly reason:
      | "buildMissing"
      | "unsupportedLifecycle"
      | "concurrentStateChange"
      | "currentContentsMismatch"
      | "indexHistoryMismatch"
      | "storedDocumentInvalid"
      | "indexKeyLimitExceeded";
    readonly detail?: string;
  }> {}

export class AppDeveloperOrderedIndexBuildIntegrationV1Error
  extends Data.TaggedError(
    "AppDeveloperOrderedIndexBuildIntegrationV1Error",
  )<{
    readonly phase: "targetTransaction";
    readonly retryable: boolean;
    readonly cause: unknown;
  }> {}

export class AppDeveloperOrderedIndexBuildDecisionUncertainV1Error
  extends Data.TaggedError(
    "AppDeveloperOrderedIndexBuildDecisionUncertainV1Error",
  )<{
    readonly scopeId: ScopeId;
    readonly indexDefinitionId: CatalogIndexDefinitionId;
    readonly cause: unknown;
  }> {}

export type BuildIntrinsicCreationTimeIndexV1Error =
  | InvalidIntrinsicCreationTimeIndexBuildInputV1Error
  | IntrinsicCreationTimeIndexDefinitionUnavailableV1Error
  | IntrinsicCreationTimeIndexBuildStaleAuthorityV1Error
  | IntrinsicCreationTimeIndexBuildStateV1Error
  | IntrinsicCreationTimeIndexBuildIntegrationV1Error
  | IntrinsicCreationTimeIndexBuildDecisionUncertainV1Error
  | ReadAppIndexDefinitionError
  | TrustedScopeAuthorityError
  | LockScopeClockForUpdateError
  | IndexBuildStateCorruptionError
  | AppendAppIndexEntryRevisionV1Error
  | ReadAppIndexRangeV1Error;

export type BuildAppDeveloperOrderedIndexV1Error =
  | InvalidAppDeveloperOrderedIndexBuildInputV1Error
  | AppDeveloperOrderedIndexDefinitionUnavailableV1Error
  | AppDeveloperOrderedIndexBuildStaleAuthorityV1Error
  | AppDeveloperOrderedIndexBuildStateV1Error
  | AppDeveloperOrderedIndexBuildIntegrationV1Error
  | AppDeveloperOrderedIndexBuildDecisionUncertainV1Error
  | ReadAppIndexDefinitionError
  | TrustedScopeAuthorityError
  | LockScopeClockForUpdateError
  | IndexBuildStateCorruptionError
  | AppendAppIndexEntryRevisionV1Error
  | ReadAppIndexRangeV1Error;

class AppOrderedIndexBuildStaleAuthorityError extends Data.TaggedError(
  "AppOrderedIndexBuildStaleAuthorityError",
)<{
  readonly scopeId: ScopeId;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly reason: "storageGeneration" | "storageGenerationFence" | "epoch";
}> {}

class AppOrderedIndexBuildStateError extends Data.TaggedError(
  "AppOrderedIndexBuildStateError",
)<{
  readonly scopeId: ScopeId;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly reason:
    | "buildMissing"
    | "unsupportedLifecycle"
    | "concurrentStateChange"
    | "currentContentsMismatch"
    | "indexHistoryMismatch"
    | "storedDocumentInvalid"
    | "indexKeyLimitExceeded";
  readonly detail?: string;
}> {}

class AppOrderedIndexBuildIntegrationError extends Data.TaggedError(
  "AppOrderedIndexBuildIntegrationError",
)<{
  readonly phase: "targetTransaction";
  readonly retryable: boolean;
  readonly cause: unknown;
}> {}

class AppOrderedIndexBuildDecisionUncertainError extends Data.TaggedError(
  "AppOrderedIndexBuildDecisionUncertainError",
)<{
  readonly scopeId: ScopeId;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly cause: unknown;
}> {}

type AppOrderedIndexBuildRuntimeError =
  | AppOrderedIndexBuildStaleAuthorityError
  | AppOrderedIndexBuildStateError
  | AppOrderedIndexBuildIntegrationError
  | AppOrderedIndexBuildDecisionUncertainError
  | LockScopeClockForUpdateError
  | IndexBuildStateCorruptionError
  | AppendAppIndexEntryRevisionV1Error
  | ReadAppIndexRangeV1Error;

type BuildTransactionErrorV1 =
  | LockScopeClockForUpdateError
  | IndexBuildStateCorruptionError
  | AppOrderedIndexBuildStaleAuthorityError
  | AppOrderedIndexBuildStateError
  | AppOrderedIndexBuildIntegrationError
  | AppendAppIndexEntryRevisionV1Error
  | ReadAppIndexRangeV1Error;

interface DecodedBuildInputV1 {
  readonly deploymentId: string;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly pageSize: number;
}

interface CurrentAppRowBaseV1 {
  readonly rowId: AppRowIdHexV1;
  readonly commitSeq: CommitSeq;
  readonly creationTime: AppCreationTimeV1;
  readonly writeEpochUuid: ScopeEpochUuidV1;
}

type CurrentAppRowV1 =
  | Readonly<CurrentAppRowBaseV1 & {
      readonly kind: "intrinsicCreationTime";
    }>
  | Readonly<CurrentAppRowBaseV1 & {
      readonly kind: "developer";
      readonly document: CanonicalFlarexValueV1;
    }>;

type AppOrderedIndexBuildPolicyV1 =
  | Readonly<{ readonly kind: "intrinsicCreationTime" }>
  | Readonly<{ readonly kind: "developer" }>;

const INTRINSIC_CREATION_TIME_POLICY = Object.freeze({
  kind: "intrinsicCreationTime",
} as const);
const APP_DEVELOPER_ORDERED_INDEX_POLICY = Object.freeze({
  kind: "developer",
} as const);

export const buildIntrinsicCreationTimeIndexV1Effect = Effect.fn(
  "IntrinsicCreationTimeIndexBuild.buildOneStep",
)(function* (
  ports: IntrinsicCreationTimeIndexBuildPortsV1,
  input: unknown,
  options: IntrinsicCreationTimeIndexBuildOptionsV1 = {},
): Effect.fn.Return<
  IntrinsicCreationTimeIndexBuildResultV1,
  BuildIntrinsicCreationTimeIndexV1Error
> {
  const decoded = yield* Effect.fromResult(decodeBuildInputResult(
    input,
    (reason) => new InvalidIntrinsicCreationTimeIndexBuildInputV1Error({ reason }),
  ));
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    decoded.deploymentId,
    ports.authority,
  );
  const definition = yield* locateAppIndexDefinitionByIdEffect(
    ports.controlDb,
    located.authority.scopeId,
    decoded.indexDefinitionId,
  );
  if (definition === null) {
    return yield* Effect.fail(
      new IntrinsicCreationTimeIndexDefinitionUnavailableV1Error({
        deploymentId: decoded.deploymentId,
        scopeId: located.authority.scopeId,
        indexDefinitionId: decoded.indexDefinitionId,
        reason: "missing",
      }),
    );
  }
  if (
    definition.deploymentId !== decoded.deploymentId ||
    definition.access.kind !== "by_creation_time"
  ) {
    return yield* Effect.fail(
      new IntrinsicCreationTimeIndexDefinitionUnavailableV1Error({
        deploymentId: decoded.deploymentId,
        scopeId: located.authority.scopeId,
        indexDefinitionId: decoded.indexDefinitionId,
        reason: "notCreationTime",
      }),
    );
  }
  return yield* runBuildTransaction(
    located.target,
    located.authority,
    definition,
    decoded.pageSize,
    options,
    INTRINSIC_CREATION_TIME_POLICY,
  ).pipe(Effect.mapError(mapAppOrderedIndexBuildErrorToIntrinsic));
});

export const buildAppDeveloperOrderedIndexV1Effect = Effect.fn(
  "AppDeveloperOrderedIndexBuild.buildOneStep",
)(function* (
  ports: AppDeveloperOrderedIndexBuildPortsV1,
  input: unknown,
  options: AppDeveloperOrderedIndexBuildOptionsV1 = {},
): Effect.fn.Return<
  AppDeveloperOrderedIndexBuildResultV1,
  BuildAppDeveloperOrderedIndexV1Error
> {
  const decoded = yield* Effect.fromResult(decodeBuildInputResult(
    input,
    (reason) => new InvalidAppDeveloperOrderedIndexBuildInputV1Error({ reason }),
  ));
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    decoded.deploymentId,
    ports.authority,
  );
  const definition = yield* locateAppIndexDefinitionByIdEffect(
    ports.controlDb,
    located.authority.scopeId,
    decoded.indexDefinitionId,
  );
  if (definition === null) {
    return yield* Effect.fail(
      new AppDeveloperOrderedIndexDefinitionUnavailableV1Error({
        deploymentId: decoded.deploymentId,
        scopeId: located.authority.scopeId,
        indexDefinitionId: decoded.indexDefinitionId,
        reason: "missing",
      }),
    );
  }
  if (
    definition.deploymentId !== decoded.deploymentId ||
    definition.access.kind !== "developer"
  ) {
    return yield* Effect.fail(
      new AppDeveloperOrderedIndexDefinitionUnavailableV1Error({
        deploymentId: decoded.deploymentId,
        scopeId: located.authority.scopeId,
        indexDefinitionId: decoded.indexDefinitionId,
        reason: "notDeveloper",
      }),
    );
  }
  return yield* runBuildTransaction(
    located.target,
    located.authority,
    definition,
    decoded.pageSize,
    options,
    APP_DEVELOPER_ORDERED_INDEX_POLICY,
  ).pipe(Effect.mapError(mapAppOrderedIndexBuildErrorToDeveloper));
});

type InvalidAppOrderedIndexBuildInputReasonV1 =
  | "invalidInputShape"
  | "invalidDeploymentId"
  | "invalidIndexDefinitionId"
  | "invalidPageSize";

function decodeBuildInputResult<E>(
  input: unknown,
  invalid: (reason: InvalidAppOrderedIndexBuildInputReasonV1) => E,
): Result.Result<DecodedBuildInputV1, E> {
  return Result.gen(function* () {
    if (!hasExactOwnDataKeys(input, INPUT_KEYS)) {
      return yield* Result.fail(invalid("invalidInputShape"));
    }
    if (
      typeof input.deploymentId !== "string" ||
      input.deploymentId.trim().length === 0
    ) {
      return yield* Result.fail(invalid("invalidDeploymentId"));
    }
    const indexDefinitionId = yield* decodeDefinitionIdResult(
      input.indexDefinitionId,
    ).pipe(Result.mapError(() => invalid("invalidIndexDefinitionId")));
    if (
      !isPositiveSafeInteger(input.pageSize) ||
      input.pageSize > MAX_APP_ORDERED_INDEX_BUILD_PAGE_SIZE_V1
    ) {
      return yield* Result.fail(invalid("invalidPageSize"));
    }
    return Object.freeze({
      deploymentId: input.deploymentId,
      indexDefinitionId,
      pageSize: input.pageSize,
    });
  });
}

const runBuildTransaction = Effect.fn(
  "AppOrderedIndexBuild.runTransaction",
)(function* (
  target: LocatedAppOrderedIndexBuildTargetV1,
  authority: TrustedScopeAuthority,
  definition: LocatedAppIndexDefinitionV1,
  pageSize: number,
  options: AppOrderedIndexBuildOptionsV1,
  policy: AppOrderedIndexBuildPolicyV1,
): Effect.fn.Return<
  AppOrderedIndexBuildResultV1,
  AppOrderedIndexBuildRuntimeError
> {
  const started = startAppOrderedIndexBuildTransaction(
    target,
    (tx) => buildInTransaction(
      tx,
      authority,
      definition,
      pageSize,
      options,
      policy,
    ),
  );
  const exit = yield* Effect.uninterruptible(Effect.exit(Effect.tryPromise({
    try: () => started.promise,
    catch: (cause) => cause,
  })));
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.findErrorOption(exit.cause);
  if (Option.isNone(failure)) return yield* Effect.die(exit.cause);
  const cause = failure.value;
  const callbackCause = started.callbackCause();
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack" &&
    cause.issue.callbackCause === started.rollbackSignal &&
    callbackCause !== undefined
  ) {
    return yield* Effect.failCause(callbackCause);
  }
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "decisionUncertain"
  ) {
    return yield* Effect.fail(
      new AppOrderedIndexBuildDecisionUncertainError({
        scopeId: authority.scopeId,
        indexDefinitionId: definition.indexDefinitionId,
        cause,
      }),
    );
  }
  return yield* Effect.fail(
    new AppOrderedIndexBuildIntegrationError({
      phase: "targetTransaction",
      retryable: cause instanceof LocatedReadCommittedTransactionFailureV1,
      cause,
    }),
  );
});

interface StartedAppOrderedIndexBuildTransactionV1 {
  readonly promise: Promise<AppOrderedIndexBuildResultV1>;
  readonly rollbackSignal: Error;
  readonly callbackCause: () => Cause.Cause<BuildTransactionErrorV1> |
    undefined;
}

/** The single audited Effect runtime bridge for this driver callback owner. */
function startAppOrderedIndexBuildTransaction(
  target: LocatedAppOrderedIndexBuildTargetV1,
  work: (
    tx: AppRowTransaction,
  ) => Effect.Effect<
    AppOrderedIndexBuildResultV1,
    BuildTransactionErrorV1
  >,
): StartedAppOrderedIndexBuildTransactionV1 {
  let observedCause: Cause.Cause<BuildTransactionErrorV1> | undefined;
  const rollbackSignal = new Error("C08 ordered-index build step rolled back.");
  const promise = target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
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

const buildInTransaction = Effect.fn(
  "AppOrderedIndexBuild.buildInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  definition: LocatedAppIndexDefinitionV1,
  pageSize: number,
  options: AppOrderedIndexBuildOptionsV1,
  policy: AppOrderedIndexBuildPolicyV1,
): Effect.fn.Return<
  AppOrderedIndexBuildResultV1,
  | LockScopeClockForUpdateError
  | IndexBuildStateCorruptionError
  | AppOrderedIndexBuildStaleAuthorityError
  | AppOrderedIndexBuildStateError
  | AppOrderedIndexBuildIntegrationError
  | AppendAppIndexEntryRevisionV1Error
  | ReadAppIndexRangeV1Error
> {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* runFault(options, "afterScopeClockLock", null);
  yield* Effect.fromResult(requireAuthorityResult(
    authority,
    definition.indexDefinitionId,
    clock,
  ));
  const scopeUuid = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(authority.scopeId),
  ).pipe(Effect.mapError((cause) =>
    new AppOrderedIndexBuildStateError({
      scopeId: authority.scopeId,
      indexDefinitionId: definition.indexDefinitionId,
      reason: "indexHistoryMismatch",
      detail: String(cause),
    })
  ));
  const rows = yield* queryEffect(
    tx.select().from(fxSystemIndexBuildStates).where(and(
      eq(fxSystemIndexBuildStates.scopeId, authority.scopeId),
      eq(
        fxSystemIndexBuildStates.indexDefinitionId,
        definition.indexDefinitionId,
      ),
    )).limit(1).for("update"),
  );
  const row = rows[0];
  if (row === undefined) {
    return yield* Effect.fail(new AppOrderedIndexBuildStateError({
      scopeId: authority.scopeId,
      indexDefinitionId: definition.indexDefinitionId,
      reason: "buildMissing",
    }));
  }
  const state = yield* Effect.fromResult(decodeIndexBuildStateRowResult(
    row,
    authority.scopeId,
    definition.indexDefinitionId,
  ));
  yield* Effect.fromResult(requireBuildAuthorityResult(state, authority));
  if (state.startCommitSeq > clock.lastCommitSeq) {
    return yield* Effect.fail(new IndexBuildStateCorruptionError(
      authority.scopeId,
      definition.indexDefinitionId,
      `start commit sequence ${state.startCommitSeq} is ahead of scope clock ${clock.lastCommitSeq}`,
    ));
  }
  switch (state.lifecycle) {
    case "declared":
      yield* transitionLifecycle(
        tx,
        state,
        "building",
        null,
        options,
      );
      return result(state, "advanced", "building", 0, 0, null);
    case "building":
      yield* transitionLifecycle(
        tx,
        state,
        "backfilling",
        null,
        options,
      );
      return result(state, "advanced", "backfilling", 0, 0, null);
    case "backfilling":
      return yield* backfillPage(
        tx,
        scopeUuid.scopeUuid,
        state,
        definition,
        pageSize,
        options,
        policy,
      );
    case "validating":
      return yield* validateAndEnable(
        tx,
        scopeUuid.scopeUuid,
        state,
        definition,
        pageSize,
        options,
        policy,
      );
    case "enabled":
      return result(state, "replayed", "enabled", 0, 0, null);
    case "retiring":
      return yield* Effect.fail(new AppOrderedIndexBuildStateError({
        scopeId: state.scopeId,
        indexDefinitionId: state.indexDefinitionId,
        reason: "unsupportedLifecycle",
      }));
  }
});

const backfillPage = Effect.fn(
  "AppOrderedIndexBuild.backfillPage",
)(function* (
  tx: AppRowTransaction,
  scopeUuid: ScopeUuidV1,
  state: IndexBuildStateRecord,
  definition: LocatedAppIndexDefinitionV1,
  pageSize: number,
  options: AppOrderedIndexBuildOptionsV1,
  policy: AppOrderedIndexBuildPolicyV1,
): Effect.fn.Return<
  AppOrderedIndexBuildResultV1,
  | AppOrderedIndexBuildIntegrationError
  | AppOrderedIndexBuildStateError
  | AppendAppIndexEntryRevisionV1Error
> {
  const cursor = state.backfillCursor.afterRowId;
  const cursorBytes = cursor === null
    ? null
    : orderedIndexRowIdHexV1ToBytes(cursor);
  const candidates = yield* queryEffect(
    tx.selectDistinctOn([fxAppRowRevisions.rowId], {
      rowId: fxAppRowRevisions.rowId,
      commitSeq: fxAppRowRevisions.commitSeq,
    }).from(fxAppRowRevisions).where(and(
      eq(fxAppRowRevisions.scopeUuid, scopeUuid),
      eq(fxAppRowRevisions.tableId, definition.access.tableId),
      lte(fxAppRowRevisions.commitSeq, state.startCommitSeq),
      ...(cursorBytes === null
        ? []
        : [gt(fxAppRowRevisions.rowId, cursorBytes)]),
    )).orderBy(
      asc(fxAppRowRevisions.rowId),
      desc(fxAppRowRevisions.commitSeq),
    ).limit(pageSize + 1),
  );
  const page = candidates.slice(0, pageSize);
  let written = 0;
  let replayed = 0;
  let lastRowId: OrderedIndexRowIdHexV1 | null = cursor;
  for (const candidate of page) {
    const rowId = yield* Effect.fromResult(
      orderedIndexRowIdHexV1FromBytesResult(candidate.rowId),
    ).pipe(Effect.mapError((cause) =>
      new AppOrderedIndexBuildStateError({
        scopeId: state.scopeId,
        indexDefinitionId: state.indexDefinitionId,
        reason: "indexHistoryMismatch",
        detail: String(cause),
      })
    ));
    lastRowId = rowId;
    const current = yield* loadCurrentAppRow(
      tx,
      scopeUuid,
      definition,
      rowId,
      policy,
      state,
    );
    if (current === null) continue;
    const disposition = yield* ensureCurrentIndexEntry(
      tx,
      scopeUuid,
      state,
      definition,
      current,
    );
    if (disposition === "written") {
      written += 1;
      yield* runFault(options, "afterEntryWrite", rowId);
    } else {
      replayed += 1;
    }
  }
  const isDone = candidates.length <= pageSize;
  const lifecycle = isDone ? "validating" as const : "backfilling" as const;
  const nextCursor = isDone ? null : lastRowId;
  yield* transitionLifecycle(tx, state, lifecycle, nextCursor, options);
  return result(
    state,
    "advanced",
    lifecycle,
    written,
    replayed,
    nextCursor,
  );
});

const validateAndEnable = Effect.fn(
  "AppOrderedIndexBuild.validateAndEnable",
)(function* (
  tx: AppRowTransaction,
  scopeUuid: ScopeUuidV1,
  state: IndexBuildStateRecord,
  definition: LocatedAppIndexDefinitionV1,
  pageSize: number,
  options: AppOrderedIndexBuildOptionsV1,
  policy: AppOrderedIndexBuildPolicyV1,
): Effect.fn.Return<
  AppOrderedIndexBuildResultV1,
  | AppOrderedIndexBuildIntegrationError
  | AppOrderedIndexBuildStateError
  | ReadAppIndexRangeV1Error
> {
  const cursor = state.backfillCursor.afterRowId;
  const cursorBytes = cursor === null
    ? null
    : orderedIndexRowIdHexV1ToBytes(cursor);
  const expectedRowIds = yield* queryEffect(
    tx.select({ rowId: fxAppRowCurrent.rowId }).from(fxAppRowCurrent).where(and(
      eq(fxAppRowCurrent.scopeUuid, scopeUuid),
      eq(fxAppRowCurrent.tableId, definition.access.tableId),
      ...(cursorBytes === null
        ? []
        : [gt(fxAppRowCurrent.rowId, cursorBytes)]),
    )).orderBy(asc(fxAppRowCurrent.rowId)).limit(pageSize + 1),
  );
  const indexRowIds = yield* queryEffect(
    tx.selectDistinct({ rowId: fxAppIndexEntryCurrent.rowId })
      .from(fxAppIndexEntryCurrent).where(and(
        eq(fxAppIndexEntryCurrent.scopeUuid, scopeUuid),
        eq(
          fxAppIndexEntryCurrent.indexDefinitionId,
          definition.indexDefinitionId,
        ),
        ...(cursorBytes === null
          ? []
          : [gt(fxAppIndexEntryCurrent.rowId, cursorBytes)]),
      )).orderBy(asc(fxAppIndexEntryCurrent.rowId)).limit(pageSize + 1),
  );
  const observedRowIds: OrderedIndexRowIdHexV1[] = [];
  for (const observed of [...expectedRowIds, ...indexRowIds]) {
    observedRowIds.push(yield* Effect.fromResult(
      orderedIndexRowIdHexV1FromBytesResult(observed.rowId),
    ).pipe(Effect.mapError((cause) =>
      new AppOrderedIndexBuildStateError({
        scopeId: state.scopeId,
        indexDefinitionId: state.indexDefinitionId,
        reason: "indexHistoryMismatch",
        detail: String(cause),
      })
    )));
  }
  const mergedRowIds = [...new Set(observedRowIds)].sort();
  const page = mergedRowIds.slice(0, pageSize);
  let lastRowId: OrderedIndexRowIdHexV1 | null = cursor;
  for (let index = 0; index < page.length; index += 1) {
    const rowId = page[index]!;
    lastRowId = rowId;
    const expectedRow = yield* loadCurrentAppRow(
      tx,
      scopeUuid,
      definition,
      rowId,
      policy,
      state,
    );
    const actualRows = yield* readCurrentAppIndexEntriesForRowInTransactionEffect(
      tx,
      { scopeId: state.scopeId, definition, rowId },
    );
    if (expectedRow === null) {
      if (actualRows.length !== 0) {
        return yield* mismatch(
          state,
          `index-only row ${index} has ${actualRows.length} current entries`,
        );
      }
      continue;
    }
    if (actualRows.length !== 1) {
      return yield* mismatch(
        state,
        `current row ${index} has ${actualRows.length} index entries`,
      );
    }
    const actualRow = actualRows[0]!;
    const encodedKey = yield* projectIndexKey(
      definition,
      expectedRow,
      state,
    );
    if (
      rowId !== actualRow.rowId ||
      expectedRow.commitSeq !== actualRow.commitSeq ||
      expectedRow.writeEpochUuid !== actualRow.writeEpochUuid ||
      actualRow.tableId !== definition.access.tableId ||
      actualRow.encodedKey !== encodedKey ||
      !bytesEqualFullScan(
        actualRow.physicalSpecSha256,
        appIndexPhysicalSpecSha256HexV1ToBytes(
          definition.physicalSpecSha256Hex,
        ),
      )
    ) {
      return yield* mismatch(state, `current row ${index} is inconsistent`);
    }
  }
  const hasMore = expectedRowIds.length > pageSize ||
    indexRowIds.length > pageSize ||
    mergedRowIds.length > pageSize;
  if (hasMore) {
    yield* transitionLifecycle(
      tx,
      state,
      "validating",
      lastRowId,
      options,
    );
    return result(
      state,
      "advanced",
      "validating",
      page.length,
      0,
      lastRowId,
    );
  }
  yield* runFault(options, "beforeEnable", null);
  yield* transitionLifecycle(tx, state, "enabled", null, options);
  return result(state, "enabled", "enabled", page.length, 0, null);
});

const loadCurrentAppRow = Effect.fn(
  "AppOrderedIndexBuild.loadCurrentAppRow",
)(function* (
  tx: AppRowTransaction,
  scopeUuid: ScopeUuidV1,
  definition: LocatedAppIndexDefinitionV1,
  rowId: OrderedIndexRowIdHexV1,
  policy: AppOrderedIndexBuildPolicyV1,
  state: IndexBuildStateRecord,
): Effect.fn.Return<
  CurrentAppRowV1 | null,
  | AppOrderedIndexBuildIntegrationError
  | AppOrderedIndexBuildStateError
> {
  const rowIdBytes = orderedIndexRowIdHexV1ToBytes(rowId);
  if (policy.kind === "intrinsicCreationTime") {
    const rows = yield* queryEffect(
      tx.select({
        rowId: fxAppRowRevisions.rowId,
        commitSeq: fxAppRowRevisions.commitSeq,
        creationTime: fxAppRowRevisions.creationTime,
        writeEpochUuid: fxAppRowRevisions.writeEpochUuid,
      }).from(fxAppRowCurrent).innerJoin(fxAppRowRevisions, and(
        eq(fxAppRowRevisions.scopeUuid, fxAppRowCurrent.scopeUuid),
        eq(fxAppRowRevisions.tableId, fxAppRowCurrent.tableId),
        eq(fxAppRowRevisions.rowId, fxAppRowCurrent.rowId),
        eq(fxAppRowRevisions.commitSeq, fxAppRowCurrent.commitSeq),
      )).where(and(
        eq(fxAppRowCurrent.scopeUuid, scopeUuid),
        eq(fxAppRowCurrent.tableId, definition.access.tableId),
        eq(fxAppRowCurrent.rowId, rowIdBytes),
        eq(fxAppRowRevisions.isTombstone, false),
      )).limit(1),
    );
    const row = rows[0];
    return row === undefined
      ? null
      : Object.freeze({
        kind: "intrinsicCreationTime",
        rowId: appRowIdHexV1FromBytes(copyBytes(row.rowId)),
        commitSeq: row.commitSeq,
        creationTime: row.creationTime,
        writeEpochUuid: row.writeEpochUuid,
      });
  }
  const rows = yield* queryEffect(
    tx.select({
      rowId: fxAppRowRevisions.rowId,
      commitSeq: fxAppRowRevisions.commitSeq,
      creationTime: fxAppRowRevisions.creationTime,
      writeEpochUuid: fxAppRowRevisions.writeEpochUuid,
      valueCodecVersion: fxAppRowRevisions.valueCodecVersion,
      valueJson: fxAppRowRevisions.valueJson,
      valueBytes: fxAppRowRevisions.valueBytes,
      valueSha256: fxAppRowRevisions.valueSha256,
    }).from(fxAppRowCurrent).innerJoin(fxAppRowRevisions, and(
      eq(fxAppRowRevisions.scopeUuid, fxAppRowCurrent.scopeUuid),
      eq(fxAppRowRevisions.tableId, fxAppRowCurrent.tableId),
      eq(fxAppRowRevisions.rowId, fxAppRowCurrent.rowId),
      eq(fxAppRowRevisions.commitSeq, fxAppRowCurrent.commitSeq),
    )).where(and(
      eq(fxAppRowCurrent.scopeUuid, scopeUuid),
      eq(fxAppRowCurrent.tableId, definition.access.tableId),
      eq(fxAppRowCurrent.rowId, rowIdBytes),
      eq(fxAppRowRevisions.isTombstone, false),
    )).limit(1),
  );
  const row = rows[0];
  if (row === undefined) return null;
  const appRowId = appRowIdHexV1FromBytes(copyBytes(row.rowId));
  if (
    row.valueCodecVersion === null || row.valueJson === null ||
    row.valueBytes === null || row.valueSha256 === null
  ) {
    return yield* Effect.fail(new AppOrderedIndexBuildStateError({
      scopeId: state.scopeId,
      indexDefinitionId: state.indexDefinitionId,
      reason: "storedDocumentInvalid",
      detail: "live current row is missing canonical value evidence",
    }));
  }
  const document = yield* Effect.tryPromise({
    try: () => verifyAppDocumentEvidenceV1({
      tableId: definition.access.tableId,
      rowId: appRowId,
      creationTime: row.creationTime,
      codecVersion: row.valueCodecVersion,
      valueJson: row.valueJson,
      canonicalBytes: row.valueBytes,
      sha256: row.valueSha256,
    }),
    catch: (cause): unknown => cause,
  }).pipe(Effect.catch((cause: unknown) =>
    cause instanceof AppDocumentSystemFieldV1Error ||
      cause instanceof FlarexValueCodecV1Error ||
      cause instanceof FlarexValueEvidenceV1Error
      ? Effect.fail(new AppOrderedIndexBuildStateError({
          scopeId: state.scopeId,
          indexDefinitionId: state.indexDefinitionId,
          reason: "storedDocumentInvalid",
          detail: "live current row canonical evidence does not verify",
        }))
      : Effect.die(cause)
  ));
  return Object.freeze({
    kind: "developer",
    rowId: appRowId,
    commitSeq: row.commitSeq,
    creationTime: row.creationTime,
    writeEpochUuid: row.writeEpochUuid,
    document,
  });
});

const ensureCurrentIndexEntry = Effect.fn(
  "AppOrderedIndexBuild.ensureCurrentEntry",
)(function* (
  tx: AppIndexEntryTransaction,
  scopeUuid: ScopeUuidV1,
  state: IndexBuildStateRecord,
  definition: LocatedAppIndexDefinitionV1,
  current: CurrentAppRowV1,
): Effect.fn.Return<
  "written" | "replayed",
  | AppOrderedIndexBuildIntegrationError
  | AppOrderedIndexBuildStateError
  | AppendAppIndexEntryRevisionV1Error
> {
  const encodedKey = yield* projectIndexKey(
    definition,
    current,
    state,
  );
  const rowId = yield* Effect.fromResult(
    orderedIndexRowIdHexV1FromBytesResult(
      orderedIndexRowIdHexV1ToBytes(current.rowId),
    ),
  ).pipe(Effect.mapError((cause) =>
    new AppOrderedIndexBuildStateError({
      scopeId: state.scopeId,
      indexDefinitionId: state.indexDefinitionId,
      reason: "indexHistoryMismatch",
      detail: String(cause),
    })
  ));
  const keyBytes = orderedIndexKeyHexV1ToBytes(encodedKey);
  const rowIdBytes = orderedIndexRowIdHexV1ToBytes(rowId);
  const heads = yield* queryEffect(
    tx.select({
      commitSeq: fxAppIndexEntryRevisions.commitSeq,
      isTombstone: fxAppIndexEntryRevisions.isTombstone,
      encodedKey: fxAppIndexEntryRevisions.encodedKey,
      tableId: fxAppIndexEntryRevisions.tableId,
    }).from(fxAppIndexEntryRevisions).where(and(
      eq(fxAppIndexEntryRevisions.scopeUuid, scopeUuid),
      eq(
        fxAppIndexEntryRevisions.indexDefinitionId,
        definition.indexDefinitionId,
      ),
      eq(fxAppIndexEntryRevisions.encodedKey, keyBytes),
      eq(fxAppIndexEntryRevisions.rowId, rowIdBytes),
    )).orderBy(desc(fxAppIndexEntryRevisions.commitSeq)).limit(1),
  );
  const head = heads[0];
  if (head !== undefined && head.commitSeq === current.commitSeq) {
    if (
      head.isTombstone ||
      head.tableId !== definition.access.tableId ||
      !bytesEqualFullScan(head.encodedKey, keyBytes)
    ) {
      return yield* mismatch(state, "matching revision is contradictory");
    }
    const pointers = yield* queryEffect(
      tx.select({ commitSeq: fxAppIndexEntryCurrent.commitSeq })
        .from(fxAppIndexEntryCurrent).where(and(
          eq(fxAppIndexEntryCurrent.scopeUuid, scopeUuid),
          eq(
            fxAppIndexEntryCurrent.indexDefinitionId,
            definition.indexDefinitionId,
          ),
          eq(fxAppIndexEntryCurrent.encodedKey, keyBytes),
          eq(fxAppIndexEntryCurrent.rowId, rowIdBytes),
        )).limit(1),
    );
    if (pointers[0]?.commitSeq !== current.commitSeq) {
      return yield* mismatch(state, "matching revision has no exact current pointer");
    }
    return "replayed";
  }
  if (head !== undefined && head.commitSeq > current.commitSeq) {
    return yield* mismatch(state, "index history is ahead of the current row");
  }
  yield* appendBackfilledLiveAppIndexEntryRevisionInTransactionEffect(tx, {
    scopeId: state.scopeId,
    scopeUuid,
    definition,
    encodedKey,
    rowId,
    writeEpochUuid: current.writeEpochUuid,
    commitSeq: current.commitSeq,
    prevCommitSeq: head?.commitSeq ?? null,
  });
  return "written";
});

function creationTimeKey(
  definition: LocatedAppIndexDefinitionV1,
  creationTime: AppCreationTimeV1,
): OrderedIndexKeyHexV1 {
  return encodeAppOrderedIndexKeyV1({
    spec: definition.physicalSpec,
    values: [orderedIndexCreationTimeV1(creationTime)],
  });
}

function projectIndexKey(
  definition: LocatedAppIndexDefinitionV1,
  current: CurrentAppRowV1,
  state: IndexBuildStateRecord,
): Effect.Effect<
  OrderedIndexKeyHexV1,
  AppOrderedIndexBuildStateError
> {
  if (current.kind === "intrinsicCreationTime") {
    return Effect.succeed(creationTimeKey(definition, current.creationTime));
  }
  return Effect.fromResult(lowerAppDeveloperIndexKeyV1(
    definition,
    current.document,
    current.creationTime,
  )).pipe(Effect.mapError((cause: OrderedIndexKeyTooLargeError) =>
    new AppOrderedIndexBuildStateError({
      scopeId: state.scopeId,
      indexDefinitionId: state.indexDefinitionId,
      reason: "indexKeyLimitExceeded",
      detail: `ordered key uses ${cause.observedBytes} bytes; maximum is ${cause.maximumBytes}`,
    })
  ));
}

function transitionLifecycle(
  tx: AppRowTransaction,
  state: IndexBuildStateRecord,
  lifecycle: "building" | "backfilling" | "validating" | "enabled",
  cursorRowId: OrderedIndexRowIdHexV1 | null,
  options: AppOrderedIndexBuildOptionsV1,
): Effect.Effect<
  void,
  | AppOrderedIndexBuildIntegrationError
  | AppOrderedIndexBuildStateError
> {
  return Effect.gen(function* () {
    const updated = yield* queryEffect(
      tx.update(fxSystemIndexBuildStates).set({
        lifecycle,
        backfillCursorRowId:
          cursorRowId === null
            ? null
            : orderedIndexRowIdHexV1ToBytes(cursorRowId),
        updatedAt: sql`clock_timestamp()`,
      }).where(and(
        eq(fxSystemIndexBuildStates.scopeId, state.scopeId),
        eq(
          fxSystemIndexBuildStates.indexDefinitionId,
          state.indexDefinitionId,
        ),
        eq(fxSystemIndexBuildStates.storageGenerationFence,
          state.storageGenerationFence),
        eq(fxSystemIndexBuildStates.epoch, state.epoch),
        eq(fxSystemIndexBuildStates.attemptFence, state.attemptFence),
        eq(fxSystemIndexBuildStates.lifecycle, state.lifecycle),
      )).returning({
        indexDefinitionId: fxSystemIndexBuildStates.indexDefinitionId,
      }),
    );
    if (updated.length !== 1) {
      return yield* Effect.fail(
        new AppOrderedIndexBuildStateError({
          scopeId: state.scopeId,
          indexDefinitionId: state.indexDefinitionId,
          reason: "concurrentStateChange",
        }),
      );
    }
    yield* runFault(options, "afterLifecycleTransition", cursorRowId);
  });
}

function runFault(
  options: AppOrderedIndexBuildOptionsV1,
  point: AppOrderedIndexBuildFaultPointV1,
  rowId: OrderedIndexRowIdHexV1 | null,
): Effect.Effect<void, AppOrderedIndexBuildIntegrationError> {
  return options.faultAfter === undefined
    ? Effect.void
    : Effect.tryPromise({
      try: async () => options.faultAfter?.(point, rowId),
      catch: (cause) => new AppOrderedIndexBuildIntegrationError({
        phase: "targetTransaction",
        retryable: true,
        cause,
      }),
    });
}

function result(
  state: IndexBuildStateRecord,
  status: AppOrderedIndexBuildResultV1["status"],
  lifecycle: AppOrderedIndexBuildResultV1["lifecycle"],
  processedRows: number,
  replayedRows: number,
  cursorRowId: OrderedIndexRowIdHexV1 | null,
): AppOrderedIndexBuildResultV1 {
  return Object.freeze({
    status,
    scopeId: state.scopeId,
    indexDefinitionId: state.indexDefinitionId,
    lifecycle,
    processedRows,
    replayedRows,
    cursorRowId,
  });
}

function mismatch(
  state: IndexBuildStateRecord,
  detail: string,
): Effect.Effect<never, AppOrderedIndexBuildStateError> {
  return Effect.fail(new AppOrderedIndexBuildStateError({
    scopeId: state.scopeId,
    indexDefinitionId: state.indexDefinitionId,
    reason: "currentContentsMismatch",
    detail,
  }));
}

function requireAuthorityResult(
  expected: TrustedScopeAuthority,
  indexDefinitionId: CatalogIndexDefinitionId,
  current: {
    readonly storageGeneration: string;
    readonly storageGenerationFence: bigint;
    readonly epoch: string;
  },
): Result.Result<void, AppOrderedIndexBuildStaleAuthorityError> {
  for (const reason of [
    "storageGeneration",
    "storageGenerationFence",
    "epoch",
  ] as const) {
    if (current[reason] !== expected[reason]) {
      return Result.fail(
        new AppOrderedIndexBuildStaleAuthorityError({
          scopeId: expected.scopeId,
          indexDefinitionId,
          reason,
        }),
      );
    }
  }
  return Result.succeed(undefined);
}

function requireBuildAuthorityResult(
  state: IndexBuildStateRecord,
  authority: TrustedScopeAuthority,
): Result.Result<void, AppOrderedIndexBuildStaleAuthorityError> {
  return requireAuthorityResult(authority, state.indexDefinitionId, state);
}

function queryEffect<Value>(
  query: PromiseLike<Value>,
): Effect.Effect<Value, AppOrderedIndexBuildIntegrationError> {
  return Effect.tryPromise({
    try: () => query,
    catch: (cause) => new AppOrderedIndexBuildIntegrationError({
      phase: "targetTransaction",
      retryable: true,
      cause,
    }),
  });
}

function mapAppOrderedIndexBuildErrorToIntrinsic(
  error: AppOrderedIndexBuildRuntimeError,
): Exclude<BuildIntrinsicCreationTimeIndexV1Error,
  | InvalidIntrinsicCreationTimeIndexBuildInputV1Error
  | IntrinsicCreationTimeIndexDefinitionUnavailableV1Error
  | ReadAppIndexDefinitionError
  | TrustedScopeAuthorityError> {
  if (error instanceof AppOrderedIndexBuildStaleAuthorityError) {
    return new IntrinsicCreationTimeIndexBuildStaleAuthorityV1Error({
      scopeId: error.scopeId,
      indexDefinitionId: error.indexDefinitionId,
      reason: error.reason,
    });
  }
  if (error instanceof AppOrderedIndexBuildStateError) {
    if (
      error.reason === "storedDocumentInvalid" ||
      error.reason === "indexKeyLimitExceeded"
    ) {
      // These failures can only originate from the developer projection policy.
      // Crossing this intrinsic boundary is an implementation defect, not a
      // recoverable intrinsic state variant.
      throw error;
    }
    return new IntrinsicCreationTimeIndexBuildStateV1Error({
      scopeId: error.scopeId,
      indexDefinitionId: error.indexDefinitionId,
      reason: error.reason,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    });
  }
  if (error instanceof AppOrderedIndexBuildIntegrationError) {
    return new IntrinsicCreationTimeIndexBuildIntegrationV1Error({
      phase: error.phase,
      retryable: error.retryable,
      cause: error.cause,
    });
  }
  if (error instanceof AppOrderedIndexBuildDecisionUncertainError) {
    return new IntrinsicCreationTimeIndexBuildDecisionUncertainV1Error({
      scopeId: error.scopeId,
      indexDefinitionId: error.indexDefinitionId,
      cause: error.cause,
    });
  }
  return error;
}

function mapAppOrderedIndexBuildErrorToDeveloper(
  error: AppOrderedIndexBuildRuntimeError,
): Exclude<BuildAppDeveloperOrderedIndexV1Error,
  | InvalidAppDeveloperOrderedIndexBuildInputV1Error
  | AppDeveloperOrderedIndexDefinitionUnavailableV1Error
  | ReadAppIndexDefinitionError
  | TrustedScopeAuthorityError> {
  if (error instanceof AppOrderedIndexBuildStaleAuthorityError) {
    return new AppDeveloperOrderedIndexBuildStaleAuthorityV1Error({
      scopeId: error.scopeId,
      indexDefinitionId: error.indexDefinitionId,
      reason: error.reason,
    });
  }
  if (error instanceof AppOrderedIndexBuildStateError) {
    return new AppDeveloperOrderedIndexBuildStateV1Error({
      scopeId: error.scopeId,
      indexDefinitionId: error.indexDefinitionId,
      reason: error.reason,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    });
  }
  if (error instanceof AppOrderedIndexBuildIntegrationError) {
    return new AppDeveloperOrderedIndexBuildIntegrationV1Error({
      phase: error.phase,
      retryable: error.retryable,
      cause: error.cause,
    });
  }
  if (error instanceof AppOrderedIndexBuildDecisionUncertainError) {
    return new AppDeveloperOrderedIndexBuildDecisionUncertainV1Error({
      scopeId: error.scopeId,
      indexDefinitionId: error.indexDefinitionId,
      cause: error.cause,
    });
  }
  return error;
}
