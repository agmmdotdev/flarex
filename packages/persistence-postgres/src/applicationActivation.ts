import {
  bytesEqualFullScan,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { canonicalizeApplicationManifest } from
  "@flarex/analysis/application-analysis";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq, sql } from "drizzle-orm";
import { Cause, Data, Effect, Exit, Result } from "effect";
import { encodeCanonicalJson, isJson } from "flarex-protocol/json";

import type { AppRowTransaction } from "./appRows";
import {
  decodeApplicationActivationRowEffect,
  decodeApplicationActiveHeadRowEffect,
  readApplicationActiveHeadForShareInTransactionEffect,
  readCoherentApplicationActiveHeadForShareInTransactionEffect,
  type ApplicationActiveHeadStateError,
  type DecodedApplicationActivation,
  type DecodedApplicationActiveHead,
} from "./applicationActiveHeadRead";
import {
  applicationActivationFrame,
  applicationActivationRequestFrame,
  applicationActiveHeadFrame,
  type ApplicationActivationReadinessCommitment,
} from "./applicationActivationFrames";
import {
  fxSystemApplicationActivations,
  fxSystemApplicationActiveHeads,
} from "./applicationActivationSchema";
import {
  hasApplicationRelationReadinessFoldComposition,
  validateActiveApplicationRelationReadinessInTransaction,
  validateApplicationRelationReadinessForActivationInTransaction,
  type ApplicationRelationReadinessActivationBasis,
  type ApplicationRelationReadinessFoldRepository,
  type ApplicationRelationReadinessFoldResult,
  type ReadApplicationRelationReadinessFoldError,
  type SettleApplicationRelationReadinessFoldError,
} from "./applicationRelationReadinessFold";
import {
  hasApplicationReadinessComposition,
  hasApplicationReadinessPlanningComposition,
  validateApplicationReadinessForActivationInTransaction,
  validateStoredApplicationReadinessForActivationInTransaction,
  type ApplicationReadinessActivationBasis,
  type ApplicationReadinessRepository,
  type ApplicationReadinessResult,
  type ReadApplicationReadinessError,
  type SettleApplicationReadinessError,
} from "./applicationReadiness";
import type { ApplicationSchemaAuthorityPublisher } from
  "./applicationSchemaAuthority";
import { databaseTimestampFromUnknown } from "./databaseTimestamp";
import type { FlarexMetadataDatabase } from "./deployments";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import {
  lockScopeClockForShareInTransactionEffect,
  lockScopeClockForUpdateInTransactionEffect,
  type LockScopeClockForShareError,
  type LockScopeClockForUpdateError,
  type ScopeClockRecord,
} from "./scopeClock";
import {
  fxSystemApplicationAnalysesV1,
  fxSystemApplicationRevisionsV2,
  fxSystemScopeClocks,
} from "./schema";
import {
  isLocatedReadCommittedAttemptTargetV1,
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const MAX_IDENTITY_BYTES = 1_024;
const MAX_FRAME_BYTES = 1_048_576;
const MAX_SEQUENCE = 9_223_372_036_854_775_807n;

export interface ApplicationActiveCasToken {
  readonly activationSequence: bigint;
  readonly headSha256: string;
}

export interface ApplicationActivationReceipt {
  readonly status: "activated";
  readonly disposition: "inserted" | "replayed";
  readonly scopeId: TrustedScopeAuthority["scopeId"];
  readonly revisionId: string;
  readonly activationSequence: bigint;
  readonly previousActivationSequence: bigint | null;
  readonly readinessSha256: string;
  readonly activationSha256: string;
  readonly activationRequestSha256: string;
  readonly expectedActiveHead: ApplicationActiveCasToken;
  readonly activatedAt: Date;
}

declare const applicationActiveSelectionBrand: unique symbol;
export interface ApplicationActiveSelection {
  readonly [applicationActiveSelectionBrand]: true;
}

export interface ApplicationActiveSelectionBasis
  extends ApplicationReadinessActivationBasis {
  readonly activationSequence: bigint;
  readonly activationSha256: Uint8Array;
  readonly headSha256: Uint8Array;
}

export interface CoherentActiveApplication {
  readonly selection: ApplicationActiveSelection;
  readonly expectedActiveHead: ApplicationActiveCasToken;
  readonly basis: ApplicationActiveSelectionBasis;
}

export interface ApplicationRelationActiveSelectionBasis
  extends ApplicationRelationReadinessActivationBasis {
  readonly activationSequence: bigint;
  readonly activationSha256: Uint8Array;
  readonly headSha256: Uint8Array;
}

export interface ApplicationRelationActiveSelectionSnapshot {
  readonly authority: TrustedScopeAuthority;
  readonly deploymentId: string;
  readonly revisionId: string;
  readonly schemaVersionId: ApplicationRelationActiveSelectionBasis[
    "schemaVersionId"
  ];
  readonly readinessSha256: Uint8Array;
  readonly relationFrontierCommitSeq: string;
  readonly relationSetReadinessSha256: Uint8Array;
  readonly relationCount: number;
  readonly activationSequence: bigint;
  readonly activationSha256: Uint8Array;
  readonly headSha256: Uint8Array;
}

export interface CoherentActiveRelationApplication {
  readonly selection: ApplicationActiveSelection;
  readonly expectedActiveHead: ApplicationActiveCasToken;
  readonly basis: ApplicationRelationActiveSelectionSnapshot;
}

export class ApplicationActivationError extends Data.TaggedError(
  "ApplicationActivationError",
)<{
  readonly operation: "activate" | "read" | "validateSelection";
  readonly reason:
    | "invalidInput"
    | "invalidComposition"
    | "notReady"
    | "activeMissing"
    | "alreadyActive"
    | "expectedHead"
    | "scopeAuthority"
    | "concurrentHead"
    | "storedState"
    | "decisionUncertain"
    | "resourceFailure";
  readonly revisionId?: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

export interface ApplicationActivationContext<SchemaFailure, ColdFailure> {
  readonly readinessContract?: never;
  readonly deploymentId: string;
  readonly readiness: ApplicationReadinessRepository<SchemaFailure, ColdFailure>;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >;
  /** Test-only failure or transaction gate after an owned persistence step. */
  readonly faultAfter?: (
    point: "activationInserted" | "headWritten",
  ) => void | Promise<void>;
}

export interface ApplicationRelationActivationContext<SchemaFailure, ColdFailure> {
  readonly deploymentId: string;
  readonly readiness: ApplicationReadinessRepository<SchemaFailure, ColdFailure>;
  readonly relationReadiness: ApplicationRelationReadinessFoldRepository;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >;
  /** Test-only failure or transaction gate after an owned persistence step. */
  readonly faultAfter?: (
    point: "activationInserted" | "headWritten",
  ) => void | Promise<void>;
}

export interface ApplicationActivationRepository<SchemaFailure, ColdFailure> {
  readonly activate: (input: {
    readonly revisionId: string;
    readonly expectedActiveHead: ApplicationActiveCasToken | null;
  }) => Effect.Effect<
    ApplicationActivationReceipt,
    | ApplicationActivationError
    | SettleApplicationReadinessError<SchemaFailure, ColdFailure>
    | TrustedScopeAuthorityError
    | LockScopeClockForUpdateError
  >;
  readonly readActive: () => Effect.Effect<
    CoherentActiveApplication,
    | ApplicationActivationError
    | ReadApplicationReadinessError
    | TrustedScopeAuthorityError
    | LockScopeClockForShareError
  >;
}

export interface ApplicationRelationActivationRepository<
  SchemaFailure,
  ColdFailure,
> {
  readonly activate: (input: {
    readonly revisionId: string;
    readonly expectedActiveHead: ApplicationActiveCasToken | null;
  }) => Effect.Effect<
    ApplicationActivationReceipt,
    | ApplicationActivationError
    | SettleApplicationReadinessError<SchemaFailure, ColdFailure>
    | SettleApplicationRelationReadinessFoldError
    | TrustedScopeAuthorityError
    | LockScopeClockForUpdateError
  >;
  readonly readActive: () => Effect.Effect<
    CoherentActiveApplication | CoherentActiveRelationApplication,
    | ApplicationActivationError
    | ReadApplicationReadinessError
    | ReadApplicationRelationReadinessFoldError
    | TrustedScopeAuthorityError
    | LockScopeClockForUpdateError
  >;
}

interface LegacySelectionState {
  readonly kind: "legacy";
  readonly basis: ApplicationActiveSelectionBasis;
}

interface RelationSelectionState {
  readonly kind: "relation";
  readonly basis: ApplicationRelationActiveSelectionBasis;
  readonly readinessRepository: ApplicationRelationReadinessFoldRepository;
  readonly readiness: Extract<
    ApplicationRelationReadinessFoldResult,
    { readonly status: "ready" }
  >;
}

type SelectionState = LegacySelectionState | RelationSelectionState;

const selectionStates = new WeakMap<ApplicationActiveSelection, SelectionState>();
interface ApplicationActivationRepositoryState {
  readonly readinessKind: "legacy" | "composite";
  readonly readiness: unknown;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >;
}

const activationRepositoryStates = new WeakMap<
  object,
  ApplicationActivationRepositoryState
>();

export function hasApplicationActivationPlanningComposition(
  repository: ApplicationActivationRepository<unknown, unknown>,
  controlDb: FlarexMetadataDatabase,
  schema: ApplicationSchemaAuthorityPublisher<unknown>,
  authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >,
): boolean {
  const state = activationRepositoryStates.get(repository);
  return state?.readinessKind === "legacy" && state.authority === authority &&
    hasApplicationReadinessPlanningComposition(
      state.readiness,
      controlDb,
      schema,
      authority,
    );
}

export function claimApplicationActiveSelection(
  selection: unknown,
): Result.Result<ApplicationActiveSelectionBasis, ApplicationActivationError> {
  if (typeof selection !== "object" || selection === null) {
    return Result.fail(activationError("validateSelection", "invalidComposition"));
  }
  // SAFETY: the typeof guard above proved the value is a non-null object;
  // the cast only narrows it to the WeakMap's registered brand.
  const state = selectionStates.get(selection as ApplicationActiveSelection);
  return state?.kind !== "legacy"
    ? Result.fail(activationError("validateSelection", "invalidComposition"))
    : Result.succeed(copySelectionBasis(state.basis));
}

export function claimApplicationRelationActiveSelection(
  selection: unknown,
): Result.Result<
  ApplicationRelationActiveSelectionSnapshot,
  ApplicationActivationError
> {
  if (typeof selection !== "object" || selection === null) {
    return Result.fail(
      activationError("validateSelection", "invalidComposition"),
    );
  }
  // SAFETY: the typeof guard proves a non-null object; WeakMap membership is
  // the actual nominal proof and structural copies are not registered.
  const state = selectionStates.get(selection as ApplicationActiveSelection);
  return state?.kind !== "relation"
    ? Result.fail(activationError("validateSelection", "invalidComposition"))
    : Result.succeed(copyRelationSelectionSnapshot(state.basis));
}

export function applicationRelationActiveSelectionMatchesSnapshot(
  basis: ApplicationRelationActiveSelectionBasis,
  snapshot: ApplicationRelationActiveSelectionSnapshot,
): boolean {
  return sameTrustedAuthority(basis.authority, snapshot.authority) &&
    basis.deploymentId === snapshot.deploymentId &&
    basis.revisionId === snapshot.revisionId &&
    basis.schemaVersionId === snapshot.schemaVersionId &&
    basis.relationFrontierCommitSeq === snapshot.relationFrontierCommitSeq &&
    basis.relationCount === snapshot.relationCount &&
    basis.activationSequence === snapshot.activationSequence &&
    bytesEqualFullScan(basis.readinessSha256, snapshot.readinessSha256) &&
    bytesEqualFullScan(
      basis.relationSetReadinessSha256,
      snapshot.relationSetReadinessSha256,
    ) &&
    bytesEqualFullScan(basis.activationSha256, snapshot.activationSha256) &&
    bytesEqualFullScan(basis.headSha256, snapshot.headSha256);
}

function claimApplicationRelationActiveSelectionForReadiness(
  readiness: ApplicationRelationReadinessFoldRepository,
  selection: unknown,
): Result.Result<
  ApplicationRelationActiveSelectionBasis,
  ApplicationActivationError
> {
  if (typeof selection !== "object" || selection === null) {
    return Result.fail(
      activationError("validateSelection", "invalidComposition"),
    );
  }
  // SAFETY: the object guard permits the WeakMap lookup. Exact repository
  // identity prevents a selection from authorizing an adjacent composition.
  const state = selectionStates.get(selection as ApplicationActiveSelection);
  return state?.kind !== "relation" ||
      state.readinessRepository !== readiness
    ? Result.fail(activationError("validateSelection", "invalidComposition"))
    : Result.succeed(copyRelationSelectionBasis(state.basis));
}

export type ValidateApplicationRelationActiveSelectionError =
  | ApplicationActivationError
  | SettleApplicationRelationReadinessFoldError
  | TrustedScopeAuthorityError
  | LockScopeClockForUpdateError;

export type ValidateApplicationRelationActiveSelectionInTransactionError =
  | ApplicationActivationError
  | SettleApplicationRelationReadinessFoldError;

/**
 * Revalidates one exact relation selection against the current scope owner,
 * stored readiness graph, activation history, and active head before another
 * private system-core capability may be derived from it.
 */
export const validateApplicationRelationActiveSelectionForReadiness = Effect.fn(
  "ApplicationActivation.validateRelationSelectionForReadiness",
)(function* (
  readiness: ApplicationRelationReadinessFoldRepository,
  selection: unknown,
  deploymentId: string,
  authority: TrustedScopeAuthorityResolutionPorts,
): Effect.fn.Return<
  ApplicationRelationActiveSelectionBasis,
  ValidateApplicationRelationActiveSelectionError
> {
  const basis = yield* Effect.fromResult(
    claimApplicationRelationActiveSelectionForReadiness(readiness, selection),
  );
  if (basis.deploymentId !== deploymentId) {
    return yield* activationFailure(
      "validateSelection",
      "invalidComposition",
      basis.revisionId,
    );
  }
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    deploymentId,
    authority,
  );
  if (!sameTrustedAuthority(basis.authority, located.authority)) {
    return yield* activationFailure(
      "validateSelection",
      "scopeAuthority",
      basis.revisionId,
    );
  }
  if (!isLocatedReadCommittedAttemptTargetV1(located.target)) {
    return yield* activationFailure(
      "validateSelection",
      "invalidComposition",
      basis.revisionId,
    );
  }
  return yield* runLocatedTransaction(
    located.target,
    "validateSelection",
    basis.revisionId,
    tx => Effect.gen(function* () {
      const clock = yield* lockScopeClockForUpdateInTransactionEffect(
        tx,
        basis.authority.scopeId,
      );
      return yield* validateApplicationRelationActiveSelectionInTransaction(
        selection,
        tx,
        clock,
      );
    }),
  );
});

export function makeApplicationActivationRepository<SchemaFailure, ColdFailure>(
  context: ApplicationRelationActivationContext<SchemaFailure, ColdFailure>,
): ApplicationRelationActivationRepository<SchemaFailure, ColdFailure>;
export function makeApplicationActivationRepository<SchemaFailure, ColdFailure>(
  context: ApplicationActivationContext<SchemaFailure, ColdFailure>,
): ApplicationActivationRepository<SchemaFailure, ColdFailure>;
export function makeApplicationActivationRepository<SchemaFailure, ColdFailure>(
  context:
    | ApplicationActivationContext<SchemaFailure, ColdFailure>
    | ApplicationRelationActivationContext<SchemaFailure, ColdFailure>,
): ApplicationActivationRepository<SchemaFailure, ColdFailure> |
  ApplicationRelationActivationRepository<SchemaFailure, ColdFailure> {
  if ("relationReadiness" in context) {
    return makeCompositeApplicationActivationRepository(context);
  }
  return makeLegacyApplicationActivationRepository(context);
}

function makeLegacyApplicationActivationRepository<SchemaFailure, ColdFailure>(
  context: ApplicationActivationContext<SchemaFailure, ColdFailure>,
): ApplicationActivationRepository<SchemaFailure, ColdFailure> {
  const captured = Object.freeze({
    deploymentId: context.deploymentId,
    readiness: context.readiness,
    authority: context.authority,
    ...(context.faultAfter === undefined ? {} : { faultAfter: context.faultAfter }),
  });

  const activate = Effect.fn("ApplicationActivation.activate")(
    function* (input: {
      readonly revisionId: string;
      readonly expectedActiveHead: ApplicationActiveCasToken | null;
    }) {
      if (!validIdentity(captured.deploymentId) || !validIdentity(input.revisionId)) {
        return yield* activationFailure("activate", "invalidInput", input.revisionId);
      }
      const expected = yield* Effect.fromResult(
        captureCasToken(input.expectedActiveHead, "activate", input.revisionId),
      );
      if (!hasApplicationReadinessComposition(
        captured.readiness,
        captured.authority,
      )) {
        return yield* activationFailure(
          "activate",
          "invalidComposition",
          input.revisionId,
        );
      }
      const readiness = yield* captured.readiness.settle(Object.freeze({
        deploymentId: captured.deploymentId,
        revisionId: input.revisionId,
      }));
      if (readiness.status !== "ready") {
        return yield* activationFailure("activate", "notReady", input.revisionId);
      }
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
        captured.deploymentId,
        captured.authority,
      );
      return yield* runLocatedTransaction(
        located.target,
        "activate",
        input.revisionId,
        tx => activateLegacyInTransaction(
          tx,
          located.authority,
          captured.readiness,
          readiness,
          expected,
          captured.faultAfter,
        ),
      );
    },
  );

  const readActive = Effect.fn("ApplicationActivation.readActive")(
    function* () {
      if (!validIdentity(captured.deploymentId) ||
        !hasApplicationReadinessComposition(
          captured.readiness,
          captured.authority,
        )) return yield* activationFailure("read", "invalidComposition");
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
        captured.deploymentId,
        captured.authority,
      );
      const hint = yield* runLocatedTransaction(
        located.target,
        "read",
        undefined,
        tx => loadActiveRevisionHint(tx, located.authority.scopeId, "legacy"),
      );
      const readiness = yield* loadReadyForActiveRead(
        captured.readiness,
        captured.deploymentId,
        hint.revisionId,
      );
      const state = yield* runLocatedTransaction(
        located.target,
        "read",
        hint.revisionId,
        tx => readActiveLegacyInTransaction(
          tx,
          located.authority,
          captured.readiness,
          readiness,
        ),
      );
      return issueLegacyActiveSelection(state);
    },
  );

  const repository = Object.freeze({ activate, readActive });
  activationRepositoryStates.set(repository, Object.freeze({
    readinessKind: "legacy",
    readiness: captured.readiness,
    authority: captured.authority,
  }));
  return repository;
}

function makeCompositeApplicationActivationRepository<
  SchemaFailure,
  ColdFailure,
>(
  context: ApplicationRelationActivationContext<SchemaFailure, ColdFailure>,
): ApplicationRelationActivationRepository<SchemaFailure, ColdFailure> {
  const captured = Object.freeze({
    deploymentId: context.deploymentId,
    readiness: context.readiness,
    relationReadiness: context.relationReadiness,
    authority: context.authority,
    ...(context.faultAfter === undefined
      ? {}
      : { faultAfter: context.faultAfter }),
  });
  const compositionIsExact = () =>
    hasApplicationReadinessComposition(
      captured.readiness,
      captured.authority,
    ) && hasApplicationRelationReadinessFoldComposition(
      captured.relationReadiness,
      captured.authority,
    );
  const activate: ApplicationRelationActivationRepository<
    SchemaFailure,
    ColdFailure
  >["activate"] = Effect.fn("ApplicationActivation.activateDispatched")(
    function* (input) {
      if (!validIdentity(captured.deploymentId) ||
        !validIdentity(input.revisionId)) {
        return yield* activationFailure(
          "activate",
          "invalidInput",
          input.revisionId,
        );
      }
      const expected = yield* Effect.fromResult(
        captureCasToken(input.expectedActiveHead, "activate", input.revisionId),
      );
      if (!compositionIsExact()) {
        return yield* activationFailure(
          "activate",
          "invalidComposition",
          input.revisionId,
        );
      }
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
        captured.deploymentId,
        captured.authority,
      );
      const readinessKind = yield* runLocatedTransaction(
        located.target,
        "activate",
        input.revisionId,
        tx => loadRevisionReadinessKindInTransaction(
          tx,
          located.authority,
          input.revisionId,
        ),
      );
      if (readinessKind === "legacy") {
        const readiness = yield* captured.readiness.settle(Object.freeze({
          deploymentId: captured.deploymentId,
          revisionId: input.revisionId,
        }));
        if (readiness.status !== "ready") {
          return yield* activationFailure(
            "activate",
            "notReady",
            input.revisionId,
          );
        }
        return yield* runLocatedTransaction(
          located.target,
          "activate",
          input.revisionId,
          tx => activateLegacyInTransaction(
            tx,
            located.authority,
            captured.readiness,
            readiness,
            expected,
            captured.faultAfter,
          ),
        );
      }
      const replay = yield* tryReplayStoredRelationActivation(
        located.target,
        located.authority,
        captured.relationReadiness,
        captured.deploymentId,
        input.revisionId,
        expected,
      );
      if (replay !== null) return replay;
      const readiness = yield* captured.relationReadiness.settle(Object.freeze({
        deploymentId: captured.deploymentId,
        revisionId: input.revisionId,
      }));
      if (readiness.status !== "ready") {
        const racedReplay = yield* tryReplayStoredRelationActivation(
          located.target,
          located.authority,
          captured.relationReadiness,
          captured.deploymentId,
          input.revisionId,
          expected,
        );
        if (racedReplay !== null) return racedReplay;
        return yield* activationFailure(
          "activate",
          "notReady",
          input.revisionId,
        );
      }
      return yield* runLocatedTransaction(
        located.target,
        "activate",
        input.revisionId,
        tx => activateRelationInTransaction(
          tx,
          located.authority,
          captured.relationReadiness,
          readiness,
          expected,
          captured.faultAfter,
        ),
      );
    },
  );

  const readActive: ApplicationRelationActivationRepository<
    SchemaFailure,
    ColdFailure
  >["readActive"] = Effect.fn("ApplicationActivation.readActiveDispatched")(
    function* () {
      if (!validIdentity(captured.deploymentId) || !compositionIsExact()) {
        return yield* activationFailure("read", "invalidComposition");
      }
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
        captured.deploymentId,
        captured.authority,
      );
      const hint = yield* runLocatedTransaction(
        located.target,
        "read",
        undefined,
        tx => loadActiveRevisionHint(tx, located.authority.scopeId),
      );
      if (hint.readinessKind === "legacy") {
        const readiness = yield* loadReadyForActiveRead(
          captured.readiness,
          captured.deploymentId,
          hint.revisionId,
        );
        const state = yield* runLocatedTransaction(
          located.target,
          "read",
          hint.revisionId,
          tx => readActiveLegacyInTransaction(
            tx,
            located.authority,
            captured.readiness,
            readiness,
          ),
        );
        return issueLegacyActiveSelection(state);
      }
      const readiness = yield* loadRelationReadyForActiveRead(
        captured.relationReadiness,
        captured.deploymentId,
        hint.revisionId,
      );
      const state = yield* runLocatedTransaction(
        located.target,
        "read",
        hint.revisionId,
        tx => readActiveRelationInTransaction(
          tx,
          located.authority,
          captured.relationReadiness,
          readiness,
        ),
      );
      return issueRelationActiveSelection(
        state,
        captured.relationReadiness,
        readiness,
      );
    },
  );

  const repository = Object.freeze({ activate, readActive });
  activationRepositoryStates.set(repository, Object.freeze({
    readinessKind: "composite",
    readiness: captured,
    authority: captured.authority,
  }));
  return repository;
}

const loadReadyForActiveRead = Effect.fn(
  "ApplicationActivation.loadReadyForActiveRead",
)(function* <SchemaFailure, ColdFailure>(
  readinessRepository: ApplicationReadinessRepository<SchemaFailure, ColdFailure>,
  deploymentId: string,
  revisionId: string,
) {
  const readiness = yield* readinessRepository.readReady(Object.freeze({
    deploymentId,
    revisionId,
  }));
  if (readiness.status !== "ready") {
    return yield* activationFailure("read", "notReady", revisionId);
  }
  return readiness;
});

const loadRelationReadyForActiveRead = Effect.fn(
  "ApplicationActivation.loadRelationReadyForActiveRead",
)(function* (
  readinessRepository: ApplicationRelationReadinessFoldRepository,
  deploymentId: string,
  revisionId: string,
): Effect.fn.Return<
  Extract<
    ApplicationRelationReadinessFoldResult,
    { readonly status: "ready" }
  >,
  | ReadApplicationRelationReadinessFoldError
  | ApplicationActivationError
> {
  const readiness = yield* readinessRepository.readActiveReady(Object.freeze({
    deploymentId,
    revisionId,
  }));
  if (readiness.status !== "ready") {
    return yield* activationFailure("read", "notReady", revisionId);
  }
  return readiness;
});

function issueLegacyActiveSelection(state: Readonly<{
  readonly expectedActiveHead: ApplicationActiveCasToken;
  readonly basis: ApplicationActiveSelectionBasis;
}>): CoherentActiveApplication {
  // SAFETY: the selection is an inert identity token; all authority remains
  // in the module-local WeakMap keyed by this object identity.
  const selection = Object.freeze({}) as ApplicationActiveSelection;
  selectionStates.set(selection, Object.freeze({
    kind: "legacy",
    basis: copySelectionBasis(state.basis),
  }));
  return Object.freeze({
    selection,
    expectedActiveHead: copyCasToken(state.expectedActiveHead),
    basis: copySelectionBasis(state.basis),
  });
}

function issueRelationActiveSelection(
  state: Readonly<{
    readonly expectedActiveHead: ApplicationActiveCasToken;
    readonly basis: ApplicationRelationActiveSelectionBasis;
  }>,
  readinessRepository: ApplicationRelationReadinessFoldRepository,
  readiness: Extract<
    ApplicationRelationReadinessFoldResult,
    { readonly status: "ready" }
  >,
): CoherentActiveRelationApplication {
  // SAFETY: the inert token is the only public carrier. The full readiness
  // basis and definition-set authority remain hidden behind its identity.
  const selection = Object.freeze({}) as ApplicationActiveSelection;
  selectionStates.set(selection, Object.freeze({
    kind: "relation",
    basis: copyRelationSelectionBasis(state.basis),
    readinessRepository,
    readiness,
  }));
  return Object.freeze({
    selection,
    expectedActiveHead: copyCasToken(state.expectedActiveHead),
    basis: copyRelationSelectionSnapshot(state.basis),
  });
}

export const validateApplicationActiveSelectionInTransaction = Effect.fn(
  "ApplicationActivation.validateSelectionInTransaction",
)(function* (
  selection: unknown,
  tx: AppRowTransaction,
  currentClock: ScopeClockRecord,
) {
  const basis = yield* Effect.fromResult(claimApplicationActiveSelection(selection));
  if (!clockMatches(basis.authority, currentClock)) {
    return yield* activationFailure(
      "validateSelection",
      "scopeAuthority",
      basis.revisionId,
    );
  }
  const rows = yield* query(
    tx.select().from(fxSystemApplicationActiveHeads).where(eq(
      fxSystemApplicationActiveHeads.scopeId,
      basis.authority.scopeId,
    )).limit(1).for("share"),
    "validateSelection",
    basis.revisionId,
  );
  const row = rows[0];
  if (row === undefined) {
    return yield* activationFailure(
      "validateSelection",
      "concurrentHead",
      basis.revisionId,
    );
  }
  const head = yield* decodeHead(row, "validateSelection", basis.revisionId);
  if (!headMatchesBasis(head, basis)) {
    return yield* activationFailure(
      "validateSelection",
      "concurrentHead",
      basis.revisionId,
    );
  }
  return copySelectionBasis(basis);
});

export const validateApplicationRelationActiveSelectionInTransaction = Effect.fn(
  "ApplicationActivation.validateRelationSelectionInTransaction",
)(function* (
  selection: unknown,
  tx: AppRowTransaction,
  currentClock: ScopeClockRecord,
): Effect.fn.Return<
  ApplicationRelationActiveSelectionBasis,
  ValidateApplicationRelationActiveSelectionInTransactionError
> {
  if (typeof selection !== "object" || selection === null) {
    return yield* activationFailure(
      "validateSelection",
      "invalidComposition",
    );
  }
  // SAFETY: the object guard permits the WeakMap lookup; the relation
  // discriminant and stored nominal handles carry the actual authority.
  const state = selectionStates.get(selection as ApplicationActiveSelection);
  if (state?.kind !== "relation") {
    return yield* activationFailure(
      "validateSelection",
      "invalidComposition",
    );
  }
  const basis = state.basis;
  if (!clockMatches(basis.authority, currentClock)) {
    return yield* activationFailure(
      "validateSelection",
      "scopeAuthority",
      basis.revisionId,
    );
  }
  const validated = yield*
    validateActiveApplicationRelationReadinessInTransaction(
      state.readinessRepository,
      state.readiness,
      tx,
      currentClock,
    );
  if (!relationReadinessMatchesSelection(validated.basis, basis)) {
    return yield* activationFailure(
      "validateSelection",
      "scopeAuthority",
      basis.revisionId,
    );
  }
  const active = yield*
    readCoherentApplicationActiveHeadForShareInTransactionEffect(
      tx,
      basis.authority.scopeId,
    ).pipe(Effect.mapError(error => activeHeadFailure(
      "validateSelection",
      error,
      basis.revisionId,
    )));
  if (active === null || !relationHeadMatchesBasis(active.head, basis)) {
    return yield* activationFailure(
      "validateSelection",
      "concurrentHead",
      basis.revisionId,
    );
  }
  return copyRelationSelectionBasis(basis);
});

const tryReplayStoredRelationActivation = Effect.fn(
  "ApplicationActivation.tryReplayStoredRelation",
)(function* (
  target: LocatedReadCommittedAttemptTargetV1,
  authority: TrustedScopeAuthority,
  readinessRepository: ApplicationRelationReadinessFoldRepository,
  deploymentId: string,
  revisionId: string,
  expected: ApplicationActiveCasToken | null,
): Effect.fn.Return<
  ApplicationActivationReceipt | null,
  | ApplicationActivationError
  | ReadApplicationRelationReadinessFoldError
  | LockScopeClockForUpdateError
> {
  const candidateExists = yield* runLocatedTransaction(
    target,
    "activate",
    revisionId,
    tx => hasPotentialActivationReplayInTransaction(
      tx,
      authority,
      revisionId,
      "relation",
      expected,
    ),
  );
  if (!candidateExists) return null;
  const readiness = yield* readinessRepository.readActiveReady(Object.freeze({
    deploymentId,
    revisionId,
  }));
  if (readiness.status !== "ready") return null;
  return yield* runLocatedTransaction(
    target,
    "activate",
    revisionId,
    tx => replayStoredRelationActivationInTransaction(
      tx,
      authority,
      readinessRepository,
      readiness,
      expected,
    ),
  );
});

const replayStoredRelationActivationInTransaction = Effect.fn(
  "ApplicationActivation.replayStoredRelationTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  readinessRepository: ApplicationRelationReadinessFoldRepository,
  readiness: Extract<
    ApplicationRelationReadinessFoldResult,
    { readonly status: "ready" }
  >,
  expected: ApplicationActiveCasToken | null,
) {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  if (!clockMatches(authority, clock)) {
    return yield* activationFailure(
      "activate",
      "scopeAuthority",
      readiness.revisionId,
    );
  }
  const validated = yield*
    validateActiveApplicationRelationReadinessInTransaction(
      readinessRepository,
      readiness,
      tx,
      clock,
    );
  return yield* replayValidatedActivationInTransaction(
    tx,
    Object.freeze({ kind: "relation", basis: validated.basis }),
    expected,
  );
});

const activateLegacyInTransaction = Effect.fn(
  "ApplicationActivation.activateLegacyTransaction",
)(
function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  readinessRepository: unknown,
  readiness: ApplicationReadinessResult,
  expected: ApplicationActiveCasToken | null,
  faultAfter: ApplicationActivationContext<unknown, unknown>["faultAfter"],
) {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  if (!clockMatches(authority, clock)) {
    return yield* activationFailure(
      "activate",
      "scopeAuthority",
      readiness.status === "ready" ? readiness.revisionId : undefined,
    );
  }
  const validated = yield* validateApplicationReadinessForActivationInTransaction(
    readinessRepository,
    readiness,
    tx,
    clock,
  );
  if (validated.status !== "ready") {
    return yield* activationFailure(
      "activate",
      "notReady",
      validated.revisionId,
    );
  }
  return yield* persistActivationInTransaction(
    tx,
    Object.freeze({ kind: "legacy", basis: validated.basis }),
    expected,
    faultAfter,
  );
});

const activateRelationInTransaction = Effect.fn(
  "ApplicationActivation.activateRelationTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  readinessRepository: ApplicationRelationReadinessFoldRepository,
  readiness: Extract<
    ApplicationRelationReadinessFoldResult,
    { readonly status: "ready" }
  >,
  expected: ApplicationActiveCasToken | null,
  faultAfter: ApplicationRelationActivationContext<unknown, unknown>[
    "faultAfter"
  ],
) {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  if (!clockMatches(authority, clock)) {
    return yield* activationFailure(
      "activate",
      "scopeAuthority",
      readiness.revisionId,
    );
  }
  const validated = yield*
    validateApplicationRelationReadinessForActivationInTransaction(
      readinessRepository,
      readiness,
      tx,
      clock,
    );
  if (validated.status !== "ready") {
    return yield* activationFailure(
      "activate",
      "notReady",
      validated.revisionId,
    );
  }
  return yield* persistActivationInTransaction(
    tx,
    Object.freeze({ kind: "relation", basis: validated.basis }),
    expected,
    faultAfter,
  );
});

type ValidatedActivation =
  | Readonly<{
      readonly kind: "legacy";
      readonly basis: ApplicationReadinessActivationBasis;
    }>
  | Readonly<{
      readonly kind: "relation";
      readonly basis: ApplicationRelationReadinessActivationBasis;
    }>;

type ActivationFault = NonNullable<
  | ApplicationActivationContext<unknown, unknown>["faultAfter"]
  | ApplicationRelationActivationContext<unknown, unknown>["faultAfter"]
>;

type CanonicalActivationFrame = Readonly<{
  readonly bytes: Uint8Array;
  readonly sha256: Uint8Array;
}>;

const canonicalActivationRequest = Effect.fn(
  "ApplicationActivation.canonicalRequest",
)(function* (
  validated: ValidatedActivation,
  expected: ApplicationActiveCasToken | null,
): Effect.fn.Return<CanonicalActivationFrame, ApplicationActivationError> {
  const basis = validated.basis;
  return yield* canonicalFrame(applicationActivationRequestFrame({
    scopeId: basis.authority.scopeId,
    revisionId: basis.revisionId,
    readiness: activationReadinessCommitment(validated),
    expectedActiveHead: expected === null ? null : {
      activationSequence: expected.activationSequence.toString(),
      headSha256: expected.headSha256,
    },
  }), "activate", basis.revisionId);
});

const replayValidatedActivationInTransaction = Effect.fn(
  "ApplicationActivation.replayValidatedRequest",
)(function* (
  tx: AppRowTransaction,
  validated: ValidatedActivation,
  expected: ApplicationActiveCasToken | null,
) {
  const request = yield* canonicalActivationRequest(validated, expected);
  return yield* replayCanonicalActivationRequestInTransaction(
    tx,
    validated,
    request,
  );
});

const replayCanonicalActivationRequestInTransaction = Effect.fn(
  "ApplicationActivation.replayCanonicalRequest",
)(function* (
  tx: AppRowTransaction,
  validated: ValidatedActivation,
  request: CanonicalActivationFrame,
): Effect.fn.Return<
  ApplicationActivationReceipt | null,
  ApplicationActivationError
> {
  const basis = validated.basis;
  const replayRows = yield* query(
    tx.select().from(fxSystemApplicationActivations).where(and(
      eq(
        fxSystemApplicationActivations.scopeId,
        basis.authority.scopeId,
      ),
      eq(
        fxSystemApplicationActivations.activationRequestSha256,
        request.sha256,
      ),
    )).limit(1).for("share"),
    "activate",
    basis.revisionId,
  );
  const replay = replayRows[0];
  if (replay === undefined) return null;
  const decoded = yield* decodeActivation(replay, "activate", basis.revisionId);
  if (!activationMatchesValidated(decoded, validated) ||
    !bytesEqualFullScan(decoded.activationRequestSha256, request.sha256)) {
    return yield* activationFailure(
      "activate",
      "storedState",
      basis.revisionId,
    );
  }
  return yield* activationReceipt("replayed", replay, decoded, request.sha256);
});

const hasPotentialActivationReplayInTransaction = Effect.fn(
  "ApplicationActivation.hasPotentialReplay",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  revisionId: string,
  readinessKind: DecodedActivation["readinessKind"],
  expected: ApplicationActiveCasToken | null,
): Effect.fn.Return<boolean, ApplicationActivationError> {
  if (expected?.activationSequence === MAX_SEQUENCE) return false;
  const activationSequence = expected === null
    ? 1n
    : expected.activationSequence + 1n;
  const rows = yield* query(
    tx.select().from(fxSystemApplicationActivations).where(and(
      eq(fxSystemApplicationActivations.scopeId, authority.scopeId),
      eq(
        fxSystemApplicationActivations.activationSequence,
        activationSequence,
      ),
      eq(fxSystemApplicationActivations.revisionId, revisionId),
    )).limit(1).for("share"),
    "activate",
    revisionId,
  );
  const row = rows[0];
  if (row === undefined) return false;
  const decoded = yield* decodeActivation(row, "activate", revisionId);
  if (decoded.scopeId !== authority.scopeId ||
    decoded.activationSequence !== activationSequence ||
    decoded.revisionId !== revisionId ||
    decoded.readinessKind !== readinessKind) {
    return yield* activationFailure("activate", "storedState", revisionId);
  }
  return true;
});

const persistActivationInTransaction = Effect.fn(
  "ApplicationActivation.persistTransaction",
)(function* (
  tx: AppRowTransaction,
  validated: ValidatedActivation,
  expected: ApplicationActiveCasToken | null,
  faultAfter: ActivationFault | undefined,
) {
  const basis = validated.basis;
  const authority = basis.authority;
  const readiness = activationReadinessCommitment(validated);
  const headRows = yield* query(
    tx.select().from(fxSystemApplicationActiveHeads).where(eq(
      fxSystemApplicationActiveHeads.scopeId,
      authority.scopeId,
    )).limit(1).for("update"),
    "activate",
    basis.revisionId,
  );
  const headRow = headRows[0];
  const head = headRow === undefined
    ? null
    : yield* decodeHead(headRow, "activate", basis.revisionId);
  const request = yield* canonicalActivationRequest(validated, expected);
  const replay = yield* replayCanonicalActivationRequestInTransaction(
    tx,
    validated,
    request,
  );
  if (replay !== null) return replay;
  if (head !== null && headMatchesValidatedReadiness(head, validated)) {
    return yield* activationFailure("activate", "alreadyActive", basis.revisionId);
  }
  if (!expectedMatchesHead(expected, head)) {
    return yield* activationFailure("activate", "expectedHead", basis.revisionId);
  }
  const previousActivationSequence = head?.activationSequence ?? null;
  if (previousActivationSequence === MAX_SEQUENCE) {
    return yield* activationFailure("activate", "storedState", basis.revisionId);
  }
  const activationSequence = previousActivationSequence === null
    ? 1n
    : previousActivationSequence + 1n;
  const activatedAt = yield* databaseTime(
    tx,
    authority.scopeId,
    "activate",
    basis.revisionId,
  );
  const activation = yield* canonicalFrame(applicationActivationFrame({
    scopeId: authority.scopeId,
    activationSequence: activationSequence.toString(),
    previousActivationSequence: previousActivationSequence?.toString() ?? null,
    revisionId: basis.revisionId,
    readiness,
    activationRequestSha256: encodeBytesToLowercaseHex(request.sha256),
    activatedAt: activatedAt.toISOString(),
  }), "activate", basis.revisionId);
  yield* query(
    tx.insert(fxSystemApplicationActivations).values({
      scopeId: authority.scopeId,
      activationSequence,
      previousActivationSequence,
      revisionId: basis.revisionId,
      readinessContractVersion: readiness.contractVersion,
      readinessSha256: copyBytes(basis.readinessSha256),
      legacyReadinessSha256: validated.kind === "legacy"
        ? copyBytes(basis.readinessSha256)
        : null,
      relationReadinessSha256: validated.kind === "relation"
        ? copyBytes(basis.readinessSha256)
        : null,
      relationSetReadinessSha256: validated.kind === "relation"
        ? copyBytes(validated.basis.relationSetReadinessSha256)
        : null,
      relationCount: validated.kind === "relation"
        ? validated.basis.relationCount
        : null,
      activationRequestSha256: copyBytes(request.sha256),
      activationSha256: copyBytes(activation.sha256),
      activationBytes: copyBytes(activation.bytes),
      activatedAt,
    }).returning({
      activationSequence: fxSystemApplicationActivations.activationSequence,
    }),
    "activate",
    basis.revisionId,
  );
  yield* runFault(faultAfter, "activationInserted", basis.revisionId);
  const nextHead = yield* canonicalFrame(applicationActiveHeadFrame({
    scopeId: authority.scopeId,
    activationSequence: activationSequence.toString(),
    revisionId: basis.revisionId,
    readiness,
    activationSha256: encodeBytesToLowercaseHex(activation.sha256),
  }), "activate", basis.revisionId);
  if (head === null) {
    const inserted = yield* query(
      tx.insert(fxSystemApplicationActiveHeads).values({
        scopeId: authority.scopeId,
        activationSequence,
        revisionId: basis.revisionId,
        readinessContractVersion: readiness.contractVersion,
        readinessSha256: copyBytes(basis.readinessSha256),
        relationSetReadinessSha256: validated.kind === "relation"
          ? copyBytes(validated.basis.relationSetReadinessSha256)
          : null,
        relationCount: validated.kind === "relation"
          ? validated.basis.relationCount
          : null,
        activationSha256: copyBytes(activation.sha256),
        headSha256: copyBytes(nextHead.sha256),
        headBytes: copyBytes(nextHead.bytes),
        createdAt: activatedAt,
        updatedAt: activatedAt,
      }).onConflictDoNothing().returning({
        activationSequence: fxSystemApplicationActiveHeads.activationSequence,
      }),
      "activate",
      basis.revisionId,
    );
    if (inserted.length !== 1) {
      return yield* activationFailure(
        "activate",
        "concurrentHead",
        basis.revisionId,
      );
    }
  } else {
    const updated = yield* query(
      tx.update(fxSystemApplicationActiveHeads).set({
        activationSequence,
        revisionId: basis.revisionId,
        readinessContractVersion: readiness.contractVersion,
        readinessSha256: copyBytes(basis.readinessSha256),
        relationSetReadinessSha256: validated.kind === "relation"
          ? copyBytes(validated.basis.relationSetReadinessSha256)
          : null,
        relationCount: validated.kind === "relation"
          ? validated.basis.relationCount
          : null,
        activationSha256: copyBytes(activation.sha256),
        headSha256: copyBytes(nextHead.sha256),
        headBytes: copyBytes(nextHead.bytes),
        updatedAt: activatedAt,
      }).where(and(
        eq(fxSystemApplicationActiveHeads.scopeId, authority.scopeId),
        eq(
          fxSystemApplicationActiveHeads.activationSequence,
          head.activationSequence,
        ),
        eq(fxSystemApplicationActiveHeads.headSha256, head.headSha256),
      )).returning({
        activationSequence: fxSystemApplicationActiveHeads.activationSequence,
      }),
      "activate",
      basis.revisionId,
    );
    if (updated.length !== 1) {
      return yield* activationFailure(
        "activate",
        "concurrentHead",
        basis.revisionId,
      );
    }
  }
  yield* runFault(faultAfter, "headWritten", basis.revisionId);
  return Object.freeze({
    status: "activated",
    disposition: "inserted",
    scopeId: authority.scopeId,
    revisionId: basis.revisionId,
    activationSequence,
    previousActivationSequence,
    readinessSha256: encodeBytesToLowercaseHex(basis.readinessSha256),
    activationSha256: encodeBytesToLowercaseHex(activation.sha256),
    activationRequestSha256: encodeBytesToLowercaseHex(request.sha256),
    expectedActiveHead: Object.freeze({
      activationSequence,
      headSha256: encodeBytesToLowercaseHex(nextHead.sha256),
    }),
    activatedAt: new Date(activatedAt.getTime()),
  } as const);
});

const readActiveLegacyInTransaction = Effect.fn(
  "ApplicationActivation.readLegacyTransaction",
)(
function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  readinessRepository: unknown,
  readiness: ApplicationReadinessResult,
) {
  const clock = yield* lockScopeClockForShareInTransactionEffect(
    tx,
    authority.scopeId,
  );
  if (!clockMatches(authority, clock)) {
    return yield* activationFailure("read", "scopeAuthority");
  }
  const validated = yield* validateStoredApplicationReadinessForActivationInTransaction(
    readinessRepository,
    readiness,
    tx,
    clock,
  );
  const active = yield* readValidatedActiveInTransaction(
    tx,
    Object.freeze({ kind: "legacy", basis: validated.basis }),
  );
  return Object.freeze({
    expectedActiveHead: active.expectedActiveHead,
    basis: copySelectionBasis(Object.freeze({
      ...validated.basis,
      activationSequence: active.head.activationSequence,
      activationSha256: copyBytes(active.head.activationSha256),
      headSha256: copyBytes(active.head.headSha256),
    })),
  });
});

const readActiveRelationInTransaction = Effect.fn(
  "ApplicationActivation.readRelationTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  readinessRepository: ApplicationRelationReadinessFoldRepository,
  readiness: Extract<
    ApplicationRelationReadinessFoldResult,
    { readonly status: "ready" }
  >,
) {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  if (!clockMatches(authority, clock)) {
    return yield* activationFailure("read", "scopeAuthority");
  }
  const validated = yield*
    validateActiveApplicationRelationReadinessInTransaction(
      readinessRepository,
      readiness,
      tx,
      clock,
    );
  const active = yield* readValidatedActiveInTransaction(
    tx,
    Object.freeze({ kind: "relation", basis: validated.basis }),
  );
  return Object.freeze({
    expectedActiveHead: active.expectedActiveHead,
    basis: copyRelationSelectionBasis(Object.freeze({
      ...validated.basis,
      activationSequence: active.head.activationSequence,
      activationSha256: copyBytes(active.head.activationSha256),
      headSha256: copyBytes(active.head.headSha256),
    })),
  });
});

const readValidatedActiveInTransaction = Effect.fn(
  "ApplicationActivation.readValidatedActiveInTransaction",
)(function* (
  tx: AppRowTransaction,
  validated: ValidatedActivation,
) {
  const basis = validated.basis;
  const active = yield*
    readCoherentApplicationActiveHeadForShareInTransactionEffect(
      tx,
      basis.authority.scopeId,
    ).pipe(Effect.mapError(error => activeHeadFailure(
      "read",
      error,
      basis.revisionId,
    )));
  if (active === null) {
    return yield* activationFailure("read", "activeMissing", basis.revisionId);
  }
  if (!headMatchesValidatedReadiness(active.head, validated)) {
    return yield* activationFailure(
      "read",
      "concurrentHead",
      basis.revisionId,
    );
  }
  const expectedActiveHead = Object.freeze({
    activationSequence: active.head.activationSequence,
    headSha256: encodeBytesToLowercaseHex(active.head.headSha256),
  });
  return Object.freeze({ expectedActiveHead, head: active.head });
});

const loadRevisionReadinessKindInTransaction = Effect.fn(
  "ApplicationActivation.loadRevisionReadinessKindInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  revisionId: string,
): Effect.fn.Return<
  DecodedHead["readinessKind"],
  ApplicationActivationError | LockScopeClockForUpdateError
> {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  if (!clockMatches(authority, clock)) {
    return yield* activationFailure(
      "activate",
      "scopeAuthority",
      revisionId,
    );
  }
  const revisionRows = yield* query(
    tx.select().from(fxSystemApplicationRevisionsV2).where(and(
      eq(fxSystemApplicationRevisionsV2.scopeId, authority.scopeId),
      eq(fxSystemApplicationRevisionsV2.revisionId, revisionId),
    )).limit(2).for("share"),
    "activate",
    revisionId,
  );
  const revision = revisionRows[0];
  if (revision === undefined) {
    return yield* activationFailure("activate", "notReady", revisionId);
  }
  if (revisionRows.length !== 1 || revision.scopeId !== authority.scopeId ||
    revision.revisionId !== revisionId || revision.status !== "inactive" ||
    revision.analysisStatus !== "analyzed" ||
    !validIdentity(revision.candidateId) ||
    !validIdentity(revision.analysisId) ||
    !isUint8ArrayWithByteLength(revision.sourceArtifactRootSha256, 32) ||
    !isUint8ArrayWithByteLength(revision.manifestSha256, 32)) {
    return yield* activationFailure(
      "activate",
      "storedState",
      revisionId,
    );
  }
  const analysisRows = yield* query(
    tx.select().from(fxSystemApplicationAnalysesV1).where(and(
      eq(fxSystemApplicationAnalysesV1.scopeId, authority.scopeId),
      eq(fxSystemApplicationAnalysesV1.analysisId, revision.analysisId),
    )).limit(2).for("share"),
    "activate",
    revisionId,
  );
  const analysis = analysisRows[0];
  if (analysisRows.length !== 1 || analysis === undefined ||
    analysis.scopeId !== revision.scopeId ||
    analysis.candidateId !== revision.candidateId ||
    analysis.analysisId !== revision.analysisId ||
    analysis.status !== "analyzed" || analysis.manifestBytes === null ||
    analysis.manifestSha256 === null ||
    analysis.manifestBytes.byteLength < 1 ||
    analysis.manifestBytes.byteLength > 16_777_216 ||
    !isUint8ArrayWithByteLength(analysis.manifestSha256, 32) ||
    !bytesEqualFullScan(
      analysis.sourceArtifactRootSha256,
      revision.sourceArtifactRootSha256,
    ) || !bytesEqualFullScan(
      analysis.manifestSha256,
      revision.manifestSha256,
    )) {
    return yield* activationFailure(
      "activate",
      "storedState",
      revisionId,
    );
  }
  const manifestBytes = analysis.manifestBytes;
  const parsed = yield* Effect.try({
    try: (): unknown => JSON.parse(UTF8_FATAL.decode(manifestBytes)),
    catch: cause => activationError(
      "activate",
      "storedState",
      revisionId,
      false,
      cause,
    ),
  });
  const canonical = yield* Effect.fromResult(
    canonicalizeApplicationManifest(parsed).pipe(Result.mapError(cause =>
      activationError(
        "activate",
        "storedState",
        revisionId,
        false,
        cause,
      )
    )),
  );
  if (!bytesEqualFullScan(canonical.canonicalBytes, manifestBytes) ||
    !bytesEqualFullScan(
      yield* sha256(canonical.canonicalBytes),
      revision.manifestSha256,
    )) {
    return yield* activationFailure(
      "activate",
      "storedState",
      revisionId,
    );
  }
  return canonical.manifest.version === 1 ? "legacy" : "relation";
});

const loadActiveRevisionHint = Effect.fn("ApplicationActivation.loadHeadHint")(
function* (
  tx: AppRowTransaction,
  scopeId: TrustedScopeAuthority["scopeId"],
  expectedKind?: DecodedHead["readinessKind"],
) {
  const head = yield* readApplicationActiveHeadForShareInTransactionEffect(
    tx,
    scopeId,
  ).pipe(Effect.mapError(error => activeHeadFailure("read", error)));
  if (head === null ||
    (expectedKind !== undefined && head.readinessKind !== expectedKind) ||
    !validIdentity(head.revisionId)) {
    return yield* activationFailure("read", "activeMissing");
  }
  return Object.freeze({
    revisionId: head.revisionId,
    readinessKind: head.readinessKind,
  });
});

type DecodedHead = DecodedApplicationActiveHead;
type DecodedActivation = DecodedApplicationActivation;

function decodeHead(
  row: typeof fxSystemApplicationActiveHeads.$inferSelect,
  operation: ApplicationActivationError["operation"],
  revisionId?: string,
): Effect.Effect<DecodedHead, ApplicationActivationError> {
  return decodeApplicationActiveHeadRowEffect(row).pipe(Effect.mapError(error =>
    activationError(
      operation,
      error.reason === "resourceFailure" ? "resourceFailure" : "storedState",
      revisionId ?? error.revisionId,
      error.retryable,
      error.cause,
    )
  ));
}

function decodeActivation(
  row: typeof fxSystemApplicationActivations.$inferSelect,
  operation: ApplicationActivationError["operation"],
  revisionId: string,
): Effect.Effect<DecodedActivation, ApplicationActivationError> {
  return decodeApplicationActivationRowEffect(row).pipe(Effect.mapError(error =>
    activationError(
      operation,
      error.reason === "resourceFailure" ? "resourceFailure" : "storedState",
      revisionId,
      error.retryable,
      error.cause,
    )
  ));
}

const activationReceipt = Effect.fn(
  "ApplicationActivation.activationReceipt",
)(function* (
  disposition: "replayed",
  row: typeof fxSystemApplicationActivations.$inferSelect,
  decoded: DecodedActivation,
  requestSha256: Uint8Array,
): Effect.fn.Return<
  ApplicationActivationReceipt,
  ApplicationActivationError
> {
  const activatedAt = databaseTimestampFromUnknown(row.activatedAt);
  if (activatedAt === null) {
    return yield* activationFailure(
      "activate",
      "storedState",
      decoded.revisionId,
    );
  }
  const head = yield* canonicalFrame(applicationActiveHeadFrame({
    scopeId: decoded.scopeId,
    activationSequence: decoded.activationSequence.toString(),
    revisionId: decoded.revisionId,
    readiness: decodedReadinessCommitment(decoded),
    activationSha256: encodeBytesToLowercaseHex(decoded.activationSha256),
  }), "activate", decoded.revisionId);
  return Object.freeze({
    status: "activated",
    disposition,
    scopeId: decoded.scopeId,
    revisionId: decoded.revisionId,
    activationSequence: decoded.activationSequence,
    previousActivationSequence: decoded.previousActivationSequence,
    readinessSha256: encodeBytesToLowercaseHex(decoded.readinessSha256),
    activationSha256: encodeBytesToLowercaseHex(decoded.activationSha256),
    activationRequestSha256: encodeBytesToLowercaseHex(requestSha256),
    expectedActiveHead: Object.freeze({
      activationSequence: decoded.activationSequence,
      headSha256: encodeBytesToLowercaseHex(head.sha256),
    }),
    activatedAt: new Date(activatedAt.getTime()),
  });
});

function expectedMatchesHead(
  expected: ApplicationActiveCasToken | null,
  head: DecodedHead | null,
): boolean {
  return expected === null
    ? head === null
    : head !== null && expected.activationSequence === head.activationSequence &&
      expected.headSha256 === encodeBytesToLowercaseHex(head.headSha256);
}

function activationReadinessCommitment(
  validated: ValidatedActivation,
): ApplicationActivationReadinessCommitment {
  return validated.kind === "legacy"
    ? Object.freeze({
        kind: "legacy" as const,
        contractVersion: 1 as const,
        readinessSha256:
          encodeBytesToLowercaseHex(validated.basis.readinessSha256),
      })
    : Object.freeze({
        kind: "relation" as const,
        contractVersion: 2 as const,
        readinessSha256:
          encodeBytesToLowercaseHex(validated.basis.readinessSha256),
        relationSetReadinessSha256: encodeBytesToLowercaseHex(
          validated.basis.relationSetReadinessSha256,
        ),
        relationCount: validated.basis.relationCount,
      });
}

function decodedReadinessCommitment(
  decoded: DecodedActivation,
): ApplicationActivationReadinessCommitment {
  return decoded.readinessKind === "legacy"
    ? Object.freeze({
        kind: "legacy" as const,
        contractVersion: 1 as const,
        readinessSha256: encodeBytesToLowercaseHex(decoded.readinessSha256),
      })
    : Object.freeze({
        kind: "relation" as const,
        contractVersion: 2 as const,
        readinessSha256: encodeBytesToLowercaseHex(decoded.readinessSha256),
        relationSetReadinessSha256: encodeBytesToLowercaseHex(
          decoded.relationSetReadinessSha256,
        ),
        relationCount: decoded.relationCount,
      });
}

function activationMatchesValidated(
  activation: DecodedActivation,
  validated: ValidatedActivation,
): boolean {
  const basis = validated.basis;
  if (activation.scopeId !== basis.authority.scopeId ||
    activation.revisionId !== basis.revisionId ||
    !bytesEqualFullScan(activation.readinessSha256, basis.readinessSha256)) {
    return false;
  }
  return validated.kind === "legacy"
    ? activation.readinessKind === "legacy"
    : activation.readinessKind === "relation" &&
      activation.relationCount === validated.basis.relationCount &&
      bytesEqualFullScan(
        activation.relationSetReadinessSha256,
        validated.basis.relationSetReadinessSha256,
      );
}

function headMatchesValidatedReadiness(
  head: DecodedHead,
  validated: ValidatedActivation,
): boolean {
  const basis = validated.basis;
  if (head.scopeId !== basis.authority.scopeId ||
    head.revisionId !== basis.revisionId ||
    !bytesEqualFullScan(head.readinessSha256, basis.readinessSha256)) {
    return false;
  }
  return validated.kind === "legacy"
    ? head.readinessKind === "legacy"
    : head.readinessKind === "relation" &&
      head.relationCount === validated.basis.relationCount &&
      bytesEqualFullScan(
        head.relationSetReadinessSha256,
        validated.basis.relationSetReadinessSha256,
      );
}

function captureCasToken(
  input: ApplicationActiveCasToken | null,
  operation: ApplicationActivationError["operation"],
  revisionId?: string,
): Result.Result<ApplicationActiveCasToken | null, ApplicationActivationError> {
  if (input === null) return Result.succeed(null);
  return Result.try({
    try: () => {
      if (typeof input !== "object" || Array.isArray(input) ||
        Reflect.ownKeys(input).length !== 2) throw new Error("invalid token");
      const sequence = Object.getOwnPropertyDescriptor(input, "activationSequence");
      const digest = Object.getOwnPropertyDescriptor(input, "headSha256");
      if (sequence === undefined || !("value" in sequence) ||
        sequence.enumerable !== true || typeof sequence.value !== "bigint" ||
        sequence.value < 1n || sequence.value > MAX_SEQUENCE ||
        digest === undefined || !("value" in digest) ||
        digest.enumerable !== true || typeof digest.value !== "string" ||
        !/^[0-9a-f]{64}$/.test(digest.value)) throw new Error("invalid token");
      return Object.freeze({
        activationSequence: sequence.value,
        headSha256: digest.value,
      });
    },
    catch: cause => activationError(
      operation,
      "invalidInput",
      revisionId,
      false,
      cause,
    ),
  });
}

function headMatchesBasis(
  head: DecodedHead,
  basis: ApplicationActiveSelectionBasis,
): boolean {
  return head.readinessKind === "legacy" &&
    head.scopeId === basis.authority.scopeId &&
    head.activationSequence === basis.activationSequence &&
    head.revisionId === basis.revisionId &&
    bytesEqualFullScan(head.readinessSha256, basis.readinessSha256) &&
    bytesEqualFullScan(head.activationSha256, basis.activationSha256) &&
    bytesEqualFullScan(head.headSha256, basis.headSha256);
}

function relationHeadMatchesBasis(
  head: DecodedHead,
  basis: ApplicationRelationActiveSelectionBasis,
): boolean {
  return head.readinessKind === "relation" &&
    head.scopeId === basis.authority.scopeId &&
    head.activationSequence === basis.activationSequence &&
    head.revisionId === basis.revisionId &&
    head.relationCount === basis.relationCount &&
    bytesEqualFullScan(head.readinessSha256, basis.readinessSha256) &&
    bytesEqualFullScan(
      head.relationSetReadinessSha256,
      basis.relationSetReadinessSha256,
    ) &&
    bytesEqualFullScan(head.activationSha256, basis.activationSha256) &&
    bytesEqualFullScan(head.headSha256, basis.headSha256);
}

function relationReadinessMatchesSelection(
  readiness: ApplicationRelationReadinessActivationBasis,
  selection: ApplicationRelationActiveSelectionBasis,
): boolean {
  return readiness.authority.scopeId === selection.authority.scopeId &&
    readiness.authority.storageGeneration ===
      selection.authority.storageGeneration &&
    readiness.authority.storageGenerationFence ===
      selection.authority.storageGenerationFence &&
    readiness.authority.epoch === selection.authority.epoch &&
    readiness.deploymentId === selection.deploymentId &&
    readiness.revisionId === selection.revisionId &&
    readiness.schemaVersionId === selection.schemaVersionId &&
    readiness.relationFrontierCommitSeq ===
      selection.relationFrontierCommitSeq &&
    readiness.relationCount === selection.relationCount &&
    bytesEqualFullScan(readiness.readinessSha256,
      selection.readinessSha256) &&
    bytesEqualFullScan(
      readiness.relationSetReadinessSha256,
      selection.relationSetReadinessSha256,
    );
}

function clockMatches(
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
): boolean {
  return authority.scopeId === clock.scopeId &&
    authority.storageGeneration === clock.storageGeneration &&
    authority.storageGenerationFence === clock.storageGenerationFence &&
      authority.epoch === clock.epoch;
}

function sameTrustedAuthority(
  expected: TrustedScopeAuthority,
  actual: TrustedScopeAuthority,
): boolean {
  const left = expected.physicalLocator;
  const right = actual.physicalLocator;
  return expected.deploymentId === actual.deploymentId &&
    expected.scopeId === actual.scopeId &&
    expected.storageGeneration === actual.storageGeneration &&
    expected.storageGenerationFence === actual.storageGenerationFence &&
    expected.epoch === actual.epoch &&
    left.kind === right.kind && left.databaseKey === right.databaseKey &&
    left.schemaName === right.schemaName;
}

function copySelectionBasis(
  basis: ApplicationActiveSelectionBasis,
): ApplicationActiveSelectionBasis {
  return Object.freeze({
    ...basis,
    authority: Object.freeze({
      ...basis.authority,
      physicalLocator: Object.freeze({ ...basis.authority.physicalLocator }),
    }),
    sourceArtifactRootSha256: copyBytes(basis.sourceArtifactRootSha256),
    manifestSha256: copyBytes(basis.manifestSha256),
    publicationSha256: copyBytes(basis.publicationSha256),
    functionCatalogSha256: copyBytes(basis.functionCatalogSha256),
    applicationSchemaSha256: copyBytes(basis.applicationSchemaSha256),
    schemaManifestSha256: copyBytes(basis.schemaManifestSha256),
    schemaBindingSha256: copyBytes(basis.schemaBindingSha256),
    taskCatalogSha256: copyBytes(basis.taskCatalogSha256),
    taskCatalogBindingSha256: copyBytes(basis.taskCatalogBindingSha256),
    readinessSha256: copyBytes(basis.readinessSha256),
    activationSha256: copyBytes(basis.activationSha256),
    headSha256: copyBytes(basis.headSha256),
  });
}

function copyRelationSelectionBasis(
  basis: ApplicationRelationActiveSelectionBasis,
): ApplicationRelationActiveSelectionBasis {
  return Object.freeze({
    ...basis,
    authority: Object.freeze({
      ...basis.authority,
      physicalLocator: Object.freeze({ ...basis.authority.physicalLocator }),
    }),
    sourceArtifactRootSha256: copyBytes(basis.sourceArtifactRootSha256),
    manifestSha256: copyBytes(basis.manifestSha256),
    publicationSha256: copyBytes(basis.publicationSha256),
    functionCatalogSha256: copyBytes(basis.functionCatalogSha256),
    applicationSchemaSha256: copyBytes(basis.applicationSchemaSha256),
    schemaManifestSha256: copyBytes(basis.schemaManifestSha256),
    manifestSchemaBindingSha256:
      copyBytes(basis.manifestSchemaBindingSha256),
    boundPublicationSha256: copyBytes(basis.boundPublicationSha256),
    taskCatalogSha256: copyBytes(basis.taskCatalogSha256),
    taskCatalogBindingSha256: copyBytes(basis.taskCatalogBindingSha256),
    readinessSha256: copyBytes(basis.readinessSha256),
    relationSetReadinessSha256:
      copyBytes(basis.relationSetReadinessSha256),
    activationSha256: copyBytes(basis.activationSha256),
    headSha256: copyBytes(basis.headSha256),
  });
}

function copyRelationSelectionSnapshot(
  basis: ApplicationRelationActiveSelectionBasis,
): ApplicationRelationActiveSelectionSnapshot {
  return Object.freeze({
    authority: Object.freeze({
      ...basis.authority,
      physicalLocator: Object.freeze({ ...basis.authority.physicalLocator }),
    }),
    deploymentId: basis.deploymentId,
    revisionId: basis.revisionId,
    schemaVersionId: basis.schemaVersionId,
    readinessSha256: copyBytes(basis.readinessSha256),
    relationFrontierCommitSeq: basis.relationFrontierCommitSeq,
    relationSetReadinessSha256: copyBytes(
      basis.relationSetReadinessSha256,
    ),
    relationCount: basis.relationCount,
    activationSequence: basis.activationSequence,
    activationSha256: copyBytes(basis.activationSha256),
    headSha256: copyBytes(basis.headSha256),
  });
}

function copyCasToken(token: ApplicationActiveCasToken): ApplicationActiveCasToken {
  return Object.freeze({ ...token });
}

const canonicalFrame = Effect.fn(
  "ApplicationActivation.canonicalFrame",
)(function* (
  value: Readonly<Record<string, unknown>>,
  operation: ApplicationActivationError["operation"],
  revisionId?: string,
): Effect.fn.Return<
  Readonly<{ readonly bytes: Uint8Array; readonly sha256: Uint8Array }>,
  ApplicationActivationError
> {
  if (!isJson(value)) {
    return yield* activationFailure(operation, "storedState", revisionId);
  }
  const bytes = UTF8.encode(encodeCanonicalJson(value, issue => {
    throw new Error(`Application activation frame invariant: ${issue.reason}`);
  }));
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_FRAME_BYTES) {
    return yield* activationFailure(operation, "storedState", revisionId);
  }
  return Object.freeze({ bytes, sha256: yield* sha256(bytes) });
});

function databaseTime(
  tx: AppRowTransaction,
  scopeId: TrustedScopeAuthority["scopeId"],
  operation: ApplicationActivationError["operation"],
  revisionId?: string,
): Effect.Effect<Date, ApplicationActivationError> {
  return query(
    tx.select({ now: sql<Date>`current_timestamp` })
      .from(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, scopeId))
      .limit(1),
    operation,
    revisionId,
  ).pipe(Effect.flatMap(rows => {
    // SAFETY: rows is the driver's generic row array; the first row is a
    // string-keyed record when the query returned one.
    const first = rows[0] as Readonly<Record<string, unknown>> | undefined;
    const value = first === undefined ? null : databaseTimestampFromUnknown(first.now);
    return value === null
      ? activationFailure(operation, "storedState", revisionId)
      : Effect.succeed(value);
  }));
}

function sha256(bytes: Uint8Array): Effect.Effect<Uint8Array> {
  // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: host - SHA-256 of an owned ArrayBuffer copy is treated as a non-rejecting WebCrypto digest
  return Effect.promise(() =>
    globalThis.crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(bytes))
      .then(value => new Uint8Array(value))
  );
}

function query<Row>(
  statement: PromiseLike<ReadonlyArray<Row>>,
  operation: ApplicationActivationError["operation"],
  revisionId?: string,
): Effect.Effect<ReadonlyArray<Row>, ApplicationActivationError> {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: cause => activationError(
      operation,
      "resourceFailure",
      revisionId,
      retryableCause(cause),
      cause,
    ),
  });
}

const runLocatedTransaction = Effect.fn("ApplicationActivation.runTransaction")(
function* <A, E>(
  target: LocatedReadCommittedAttemptTargetV1,
  operation: ApplicationActivationError["operation"],
  revisionId: string | undefined,
  body: (tx: AppRowTransaction) => Effect.Effect<A, E>,
): Effect.fn.Return<A, E | ApplicationActivationError> {
  const rollbackSignal = Object.freeze({ kind: "ApplicationActivationRollback" });
  let callbackCause: Cause.Cause<E> | undefined;
  const promise = target[RUN_LOCATED_READ_COMMITTED_V1](async tx => {
    const result = await Effect.runPromiseExit(body(tx));
    if (Exit.isSuccess(result)) return result.value;
    callbackCause = result.cause;
    throw rollbackSignal;
  });
  const settled = yield* Effect.uninterruptible(Effect.exit(Effect.tryPromise({
    try: () => promise,
    catch: cause => cause,
  })));
  if (Exit.isSuccess(settled)) return settled.value;
  const error = Cause.findErrorOption(settled.cause);
  if (error._tag === "None") {
    return yield* Effect.failCause(Cause.map(
      settled.cause,
      cause => activationError(
        operation,
        "resourceFailure",
        revisionId,
        false,
        cause,
      ),
    ));
  }
  const cause = error.value;
  if (cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack" &&
    cause.issue.callbackCause === rollbackSignal && callbackCause !== undefined) {
    return yield* Effect.failCause(callbackCause);
  }
  if (cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackCleanupFailed" && callbackCause !== undefined) {
    return yield* Effect.failCause(Cause.combine(
      callbackCause,
      Cause.die(activationError(
        operation,
        "resourceFailure",
        revisionId,
        false,
        cause,
      )),
    ));
  }
  if (cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "decisionUncertain") {
    return yield* activationFailure(
      operation,
      "decisionUncertain",
      revisionId,
      false,
      cause,
    );
  }
  return yield* activationFailure(
    operation,
    "resourceFailure",
    revisionId,
    retryableCause(cause),
    cause,
  );
});

function runFault(
  faultAfter: ApplicationActivationContext<unknown, unknown>["faultAfter"],
  point: "activationInserted" | "headWritten",
  revisionId: string,
): Effect.Effect<void, ApplicationActivationError> {
  return faultAfter === undefined
    ? Effect.void
    : Effect.tryPromise({
        try: async () => { await faultAfter(point); },
        catch: cause => activationError(
          "activate",
          "resourceFailure",
          revisionId,
          false,
          cause,
        ),
      });
}

function validIdentity(value: string): boolean {
  return isNonBlankString(value) && !value.includes("\0") &&
    value.length <= MAX_IDENTITY_BYTES &&
    UTF8.encode(value).byteLength <= MAX_IDENTITY_BYTES;
}

function retryableCause(cause: unknown): boolean {
  if (cause === null || typeof cause !== "object") return false;
  const code = Reflect.get(cause, "code");
  return code === "40001" || code === "40P01" || code === "55P03";
}

function activationFailure(
  operation: ApplicationActivationError["operation"],
  reason: ApplicationActivationError["reason"],
  revisionId?: string,
  retryable = false,
  cause?: unknown,
): Effect.Effect<never, ApplicationActivationError> {
  return Effect.fail(activationError(
    operation,
    reason,
    revisionId,
    retryable,
    cause,
  ));
}

function activeHeadFailure(
  operation: ApplicationActivationError["operation"],
  error: ApplicationActiveHeadStateError,
  revisionId?: string,
): ApplicationActivationError {
  return activationError(
    operation,
    error.reason === "resourceFailure" ? "resourceFailure" : "storedState",
    revisionId ?? error.revisionId,
    error.retryable,
    error.cause,
  );
}

function activationError(
  operation: ApplicationActivationError["operation"],
  reason: ApplicationActivationError["reason"],
  revisionId?: string,
  retryable = false,
  cause?: unknown,
): ApplicationActivationError {
  return new ApplicationActivationError({
    operation,
    reason,
    retryable,
    ...(revisionId === undefined ? {} : { revisionId }),
    ...(cause === undefined ? {} : { cause }),
  });
}
