import type { SessionJournalAttempt } from "./sessionJournalStore";
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
import { and, asc, eq, getTableColumns, gt, sql } from "drizzle-orm";
import { Cause, Data, Effect, Encoding, Exit, Result } from "effect";
import { encodeCanonicalJson, isJson } from "flarex-protocol/json";

import { AppRowReadPersistenceError, type AppRowTransaction } from "./appRows";
import { readApplicationReadinessTargetProtection } from "./applicationReadiness";
import { readApplicationReadinessPreparationProtection } from "./applicationReadiness";
import { captureProtectedMetadataEpoch, authenticateProtectedTargetMetadataSnapshot, guardProtectedMetadataEpoch,
  acquireProtectedMetadataInstallationAdmission,
  hasProtectedMetadataFinalGuardScope, registerProtectedMetadataFinalGuard,
  type ProtectedTargetMetadataEvidence } from "./preparedMetadataEpoch";
import { canonicalStandaloneApplicationBinding, decodeStandaloneApplicationBinding,
  type StandaloneApplicationBinding } from "./applicationStandaloneBinding";
import { hasLocatedReadCommittedTargetDatabaseV1 } from "./transactionSessionAttemptKernel";
import { readStandaloneReadSnapshot, type StandaloneReadSnapshot } from "./standaloneReadSnapshot";
import { prepareApplicationActiveHeadStructure, type PreparedApplicationActiveHeadStructure } from "./applicationActiveHeadRead";
import { captureHostPreparationCharge, captureHostPreparationLifetime } from "./preparedHostRuntime";
import { replaceActiveIndexMaintenanceInTransactionEffect } from "./indexMaintenance";
import { replaceActiveUniqueMaintenanceInTransactionEffect, AppUniqueConstraintSetBuildIntegrationV1Error, type ReadUniqueMaintenanceRequirements } from "./appUniqueConstraintSetBuildV1";
import { UniqueMaintenanceError } from "./uniqueMaintenanceEvidence";
import { readApplicationActivationUniqueRequirements } from "./applicationReadiness";
import { readApplicationRelationActivationUniqueRequirements } from "./applicationRelationReadinessFold";
import { loadRelatedPublishedPhysicalRequirementSnapshotV1, type ReadRelatedPublishedPhysicalRequirements } from "./indexBuildReconciliation";
import { IndexMaintenanceError } from "./indexMaintenanceEvidence";
import { fxSystemApplicationWriteOwnership } from "./applicationWriteOwnership/Schema";
import { readApplicationRelationOwnershipInTransaction, readApplicationActivationRelatedPhysicalRequirements } from "./applicationRelationReadinessFold";
import { ApplicationWriteOwnershipError } from "./applicationWriteOwnership/Model";
import { ApplicationWriteOwnershipHistoryBudget } from "./applicationWriteOwnership/Policy";
import {
  decodeApplicationActivationRowEffect,
  decodeApplicationActiveHeadRowEffect,
  readApplicationActiveHeadForShareInTransactionEffect,
  readCoherentApplicationActiveHeadForShareInTransactionEffect,
  readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect,
  readCheckedApplicationActiveHead,
  readCheckedApplicationSchemaForHeadForShareInTransactionEffect,
  releaseCheckedApplicationActiveHead,
  type ApplicationActiveHeadStateError,
  type CheckedApplicationActiveHead,
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
  fxSystemApplicationReadBindings,
} from "./applicationActivationSchema";
import {
  hasApplicationRelationReadinessFoldComposition,
  prepareApplicationRelationActiveRead,
  readPreparedApplicationRelationInputs,
  hasPreparedApplicationRelationReadRepository,
  acceptPreparedApplicationRelationActiveRead,
  type PreparedApplicationRelationActiveRead,
  validateActiveApplicationRelationReadinessInTransaction,
  validateApplicationRelationReadinessForActivationInTransaction,
  withApplicationActivationCatalogLock,
  type ApplicationActivationCatalogLease,
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
  withStoredApplicationReadinessForBindingInTransaction,
  captureApplicationReadinessInTransaction,
  prepareCapturedApplicationReadiness,
  ApplicationReadinessError,
  type ApplicationReadinessActivationBasis,
  type ApplicationReadinessRepository,
  type ApplicationReadinessResult,
  type ReadApplicationReadinessError,
  type SettleApplicationReadinessError,
} from "./applicationReadiness";
import type { ApplicationSchemaAuthorityPublisher } from
  "./applicationSchemaAuthority";
import { databaseTimestampFromUnknown } from "./databaseTimestamp";
import { chargeHostPreparation } from "./preparedHostRuntime";
import type { FlarexMetadataDatabase } from "./deployments";
import {
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  type ExactTrustedScopeAuthorityResolutionPorts,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import {
  lockScopeClockForShareInTransactionEffect,
  lockScopeClockForSnapshotReadInTransactionEffect,
  lockScopeClockForUpdateInTransactionEffect,
  type LockScopeClockForShareError,
  type LockScopeClockForUpdateError,
  type ScopeClockRecord,
} from "./scopeClock";
import {
  fxSystemApplicationAnalysesV1,
  fxSystemApplicationRevisionsV2,
  fxSystemScopeClocks,
  fxSystemApplicationReadinessV1,
} from "./schema";
import { fxSystemApplicationReadiness } from "./applicationRelationSchema";
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

export type ApplicationExecutableActiveSelection =
  | Readonly<{
      readonly kind: "legacy";
      readonly basis: ApplicationActiveSelectionBasis;
    }>
  | Readonly<{
      readonly kind: "relation";
      readonly basis: ApplicationRelationActiveSelectionBasis;
    }>;

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
  readonly scopeId: TrustedScopeAuthority["scopeId"];
  readonly readiness: ApplicationReadinessRepository<SchemaFailure, ColdFailure>;
  readonly authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1> &
    ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  /** Test-only failure or transaction gate after an owned persistence step. */
  readonly faultAfter?: (
    point: "activationInserted" | "maintenanceClosed" | "maintenanceOpened" | "uniqueMaintenanceClosed" | "uniqueMaintenanceOpened" | "headWritten",
  ) => void | Promise<void>;
}

export interface ApplicationRelationActivationContext<SchemaFailure, ColdFailure> {
  readonly deploymentId: string;
  readonly scopeId: TrustedScopeAuthority["scopeId"];
  readonly readiness: ApplicationReadinessRepository<SchemaFailure, ColdFailure>;
  readonly relationReadiness: ApplicationRelationReadinessFoldRepository;
  readonly authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1> &
    ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  /** Test-only failure or transaction gate after an owned persistence step. */
  readonly faultAfter?: (
    point: "activationInserted" | "maintenanceClosed" | "maintenanceOpened" | "uniqueMaintenanceClosed" | "uniqueMaintenanceOpened" | "headWritten",
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
  readonly readinessRepository: unknown;
  readonly readiness: ApplicationReadinessResult;
  readonly lifetime: Effect.Success<ReturnType<typeof captureHostPreparationLifetime>>;
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
const bindingHeadPreparations = new WeakMap<object, PreparedApplicationActiveHeadStructure>();

/** Source readers derive protection from an actual Application readiness
 * issuer, never from copied digests or unique-build configuration. */
export function readApplicationBindingTargetProtection(input: ApplicationBindingInput) {
  const standalone = standaloneBindingPreparations.get(input);
  if (standalone !== undefined) return standalone.lifetime.checkOpen().pipe(
    Result.mapError(cause => activationError("validateSelection", "invalidComposition", standalone.frame.revisionId, false, cause)),
    Result.map(() => ({ protection: standalone.protection, lifetime: standalone.lifetime })));
  // SAFETY: nominal registry membership, not this lookup assertion, authenticates the selection.
  const state = legacyBindingPreparations.get(input) ?? selectionStates.get(input as ApplicationActiveSelection);
  if (state === undefined) {
    const prepared = bindingPreparations.get(input);
    if (prepared === undefined) return Result.fail(activationError("validateSelection", "invalidComposition"));
    return (prepared.lifetime?.checkOpen() ?? Result.succeed(undefined)).pipe(
      Result.mapError(cause => activationError("validateSelection", "invalidComposition", prepared.revisionId, false, cause)),
      Result.map(() => Object.freeze({ protection: undefined, lifetime: prepared.lifetime })));
  }
  if (state.kind !== "legacy") return Result.succeed(Object.freeze({ protection: undefined, lifetime: undefined }));
  const protection = readApplicationReadinessTargetProtection(state.readinessRepository, state.readiness);
  return (state.lifetime?.checkOpen() ?? Result.succeed(undefined)).pipe(
    Result.mapError(cause => activationError("validateSelection", "invalidComposition", state.basis.revisionId, false, cause)),
    Result.map(() => Object.freeze({ protection, lifetime: state.lifetime })));
}
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

declare const finiteActivePreparationBrand: unique symbol;
export interface PreparedFiniteActiveApplication {
  readonly [finiteActivePreparationBrand]: true;
}
interface FiniteActivePreparationState {
  readonly repository: object;
  readonly selection: ApplicationActiveSelection;
  readonly schema: AwaitedFiniteSchema;
  readonly lifetime: Effect.Success<ReturnType<typeof captureHostPreparationLifetime>>;
}
type AwaitedFiniteSchema = Extract<Effect.Success<ReturnType<typeof prepareCapturedApplicationReadiness>>, { readonly schema: unknown }>["schema"];
const finiteActivePreparations = new WeakMap<PreparedFiniteActiveApplication, FiniteActivePreparationState>();
const finiteActivePreparationReaders = new WeakMap<object, () => Effect.Effect<PreparedFiniteActiveApplication,
  ReadApplicationReadinessError | ApplicationActivationError | LocatedReadCommittedTransactionFailureV1 |
  TrustedScopeAuthorityError | LockScopeClockForShareError>>();

export const prepareFiniteActiveApplication = Effect.fn("ApplicationActivation.prepareFiniteActive")(
function* (repository: ApplicationActivationRepository<unknown, unknown>) {
  const prepare = finiteActivePreparationReaders.get(repository);
  if (prepare === undefined) return yield* activationFailure("read", "invalidComposition");
  return yield* prepare();
});

/** Structural construction inputs only; every accepting transaction reauthenticates the selection. */
export function readPreparedFiniteActiveApplication(prepared: PreparedFiniteActiveApplication) {
  const state = finiteActivePreparations.get(prepared);
  if (state === undefined) return Result.fail(activationError("read", "invalidComposition"));
  return (state.lifetime?.checkOpen() ?? Result.succeed(undefined)).pipe(
    Result.mapError(cause => activationError("read", "invalidComposition", undefined, false, cause)),
    Result.flatMap(() => claimApplicationExecutableActiveSelection(state.selection)),
    Result.map(claimed => Object.freeze({ claimed: structuredClone(claimed), schema: structuredClone(state.schema) })),
  );
}

export const withPreparedFiniteActiveApplicationInTransaction = Effect.fn(
  "ApplicationActivation.withPreparedFiniteActive",
)(function* <Value, Failure, Requirements>(prepared: PreparedFiniteActiveApplication, tx: AppRowTransaction,
  clock: ScopeClockRecord,
  work: (accepted: Readonly<{ selection: ApplicationActiveSelection; basis: ApplicationActiveSelectionBasis }>,
    binding: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>) {
  const state = finiteActivePreparations.get(prepared);
  if (state === undefined) return yield* activationFailure("validateSelection", "invalidComposition");
  yield* Effect.fromResult((state.lifetime?.checkOpen() ?? Result.succeed(undefined)).pipe(
    Result.mapError(cause => activationError("validateSelection", "invalidComposition", undefined, false, cause))));
  return yield* withValidatedApplicationBindingBasisInTransaction(state.selection, tx, clock,
    (validated, _checked, binding) => Effect.gen(function* () {
      if (validated.kind !== "legacy") return yield* activationFailure("validateSelection", "invalidComposition");
      return yield* work(Object.freeze({ selection: state.selection, basis: validated.basis }), binding);
    }));
});

const bindingPreparationBrand: unique symbol = Symbol("ApplicationBindingPreparation");
export interface ApplicationBindingPreparation { readonly [bindingPreparationBrand]: true }
declare const legacyBindingPreparationBrand: unique symbol;
/** Immutable construction evidence; it grants no executable Application selection. */
export interface PreparedApplicationBinding { readonly [legacyBindingPreparationBrand]: true }
declare const standaloneApplicationBindingBrand: unique symbol;
export interface PreparedStandaloneApplicationBinding { readonly [standaloneApplicationBindingBrand]: true }
export type ApplicationBindingInput = ApplicationActiveSelection | ApplicationBindingPreparation | PreparedApplicationBinding | PreparedStandaloneApplicationBinding;
interface StandaloneBindingState {
  readonly authority: TrustedScopeAuthority;
  readonly frame: StandaloneApplicationBinding;
  readonly protection: ProtectedTargetMetadataEvidence;
  readonly lifetime: NonNullable<LegacySelectionState["lifetime"]>;
}
const standaloneBindingPreparations = new WeakMap<object, StandaloneBindingState>();
const standaloneBindingPreparationReaders = new WeakMap<object, () => Effect.Effect<PreparedStandaloneApplicationBinding,
  ApplicationActivationError | ReadApplicationReadinessError | TrustedScopeAuthorityError | LockScopeClockForShareError>>();

export function isPreparedStandaloneApplicationBinding(input: ApplicationBindingInput): input is PreparedStandaloneApplicationBinding {
  return standaloneBindingPreparations.has(input);
}

/** Exact indexed publication capture under the existing retained host lease. */
export const prepareStandaloneApplicationBindingSelection = Effect.fn("ApplicationActivation.prepareStandaloneBinding")(
  function* <Failure>(repository: ApplicationBindingSelectionReader<Failure>) {
    const prepare = standaloneBindingPreparationReaders.get(repository);
    if (prepare === undefined) return yield* activationFailure("read", "invalidComposition");
    return yield* prepare();
  },
);

export function readPreparedStandaloneApplicationBinding(input: PreparedStandaloneApplicationBinding) {
  const state = standaloneBindingPreparations.get(input);
  if (state === undefined) return Result.fail(activationError("validateSelection", "invalidComposition"));
  return state.lifetime.checkOpen().pipe(
    Result.mapError(cause => activationError("validateSelection", "invalidComposition", state.frame.revisionId, false, cause)),
    Result.map(() => ({ authority: { ...state.authority, physicalLocator: { ...state.authority.physicalLocator } },
      frame: structuredClone(state.frame), protection: state.protection })));
}

/** The host enters the installation before any scope or metadata lock. Keep
 * protected token/database ownership inside the authenticated binding issuer. */
export const acquireStandaloneApplicationBindingInstallation = Effect.fn("ApplicationActivation.acquireStandaloneInstallation")(
  function* (input: PreparedStandaloneApplicationBinding, tx: AppRowTransaction) {
    const state = standaloneBindingPreparations.get(input);
    if (state === undefined) return yield* activationFailure("validateSelection", "invalidComposition");
    yield* Effect.fromResult(readPreparedStandaloneApplicationBinding(input));
    yield* acquireProtectedMetadataInstallationAdmission(state.protection.token, state.protection.database, tx)
      .pipe(Effect.mapError(cause => activationError("validateSelection", "resourceFailure", state.frame.revisionId, false, cause)));
  },
);
const legacyBindingPreparations = new WeakMap<object, LegacySelectionState>();
type BindingPreparationError = ApplicationActivationError | ReadApplicationReadinessError |
  ReadApplicationRelationReadinessFoldError | TrustedScopeAuthorityError | LockScopeClockForUpdateError;
const bindingPreparations = new WeakMap<object, Readonly<{
  authority: TrustedScopeAuthority; revisionId: string; readiness: PreparedApplicationRelationActiveRead;
  lifetime: LegacySelectionState["lifetime"];
}>>();
const bindingPreparationReaders = new WeakMap<object, (profile: "request" | "retained") => Effect.Effect<ApplicationBindingInput, BindingPreparationError>>();

export function isApplicationBindingPreparation(input: ApplicationBindingInput): input is ApplicationBindingPreparation {
  return bindingPreparations.has(input);
}

export function isPreparedApplicationBinding(input: ApplicationBindingInput): input is PreparedApplicationBinding {
  return legacyBindingPreparations.has(input);
}

/** Binding-only consumers construct request evidence; acceptance remains with the business transaction. */
export const prepareApplicationBindingSelection = Effect.fn("ApplicationActivation.prepareBindingSelection")(
  function* <Failure>(repository: ApplicationBindingSelectionReader<Failure>) {
    const prepare = bindingPreparationReaders.get(repository);
    if (prepare === undefined) return yield* activationFailure("read", "invalidComposition");
    return yield* prepare("request");
  },
);

/** Host construction captures immutable binding inputs under its existing
 * allocation. Every use still authenticates the live target and binding. */
export const prepareRetainedApplicationBindingSelection = Effect.fn("ApplicationActivation.prepareRetainedBindingSelection")(
  function* <Failure>(repository: ApplicationBindingSelectionReader<Failure>) {
    const prepare = bindingPreparationReaders.get(repository);
    const lifetime = yield* captureHostPreparationLifetime();
    if (prepare === undefined || lifetime === undefined)
      return yield* activationFailure("read", "invalidComposition");
    yield* Effect.fromResult(lifetime.checkOpen()).pipe(Effect.mapError(cause =>
      activationError("read", "resourceFailure", undefined, false, cause)));
    return yield* prepare("retained");
  },
);

export const readApplicationBindingPreparationInputs = Effect.fn("ApplicationActivation.readBindingPreparationInputs")(
  function* (input: ApplicationBindingInput, controlDb: FlarexMetadataDatabase) {
  const state = bindingPreparations.get(input);
  if (state === undefined) return yield* activationFailure("validateSelection", "invalidComposition");
  yield* Effect.fromResult(readApplicationBindingTargetProtection(input));
    const inputs = yield* readPreparedApplicationRelationInputs(state.readiness, controlDb);
    return Object.freeze({ ...inputs, scopeId: state.authority.scopeId });
  },
);

declare const acceptedBindingBrand: unique symbol;
/** Only valid inside the accepting callback; deliberately not an executable selection. */
export interface AcceptedApplicationBinding { readonly [acceptedBindingBrand]: true }
const acceptedBindings = new WeakMap<object, Readonly<{
  selection: ApplicationBindingInput; tx: AppRowTransaction; clock: ScopeClockRecord;
  validated: ApplicationExecutableActiveSelection;
  checkedActive: CheckedApplicationActiveHead | undefined;
  readiness: PreparedApplicationRelationActiveRead | undefined;
}>>();

declare const finiteBindingCorrelationBrand: unique symbol;
/** Issued only from the live full-entry observation. This cannot stand in for
 * entry/final readiness and is bound to the source owner's exact attempt. */
export interface FiniteApplicationBindingCorrelation {
  readonly [finiteBindingCorrelationBrand]: true;
}
const finiteBindingCorrelations = new WeakMap<FiniteApplicationBindingCorrelation, Readonly<{
  selection: ApplicationBindingInput;
  root: SessionJournalAttempt;
  validated: ApplicationExecutableActiveSelection;
  target: Result.Result.Success<ReturnType<typeof readApplicationBindingTargetProtection>>;
}>>();

/** The outer owner installs this token only after complete entry acceptance
 * succeeds. Its live accepted handle cannot be replayed after callback close. */
export function captureFiniteApplicationBindingCorrelation(binding: AcceptedApplicationBinding,
  selection: ApplicationBindingInput, tx: AppRowTransaction, clock: ScopeClockRecord, root: SessionJournalAttempt) {
  return Result.gen(function* () {
    yield* requireAcceptedApplicationBindingObservation(binding, selection, tx, clock);
    const accepted = acceptedBindings.get(binding);
    if (accepted === undefined) return yield* Result.fail(activationError("validateSelection", "invalidComposition"));
    const target = yield* readApplicationBindingTargetProtection(selection);
    // Full entry already detached this private immutable basis. A correlation
    // is bounded by the source owner's per-root admission count; repeated
    // attempts must not consume retained-host capacity for the same graph.
    const validated = accepted.validated;
    // SAFETY: the issuer retains exact root/selection identity and detached
    // immutable basis; the empty carrier conveys no caller-authored evidence.
    const token = Object.freeze({}) as FiniteApplicationBindingCorrelation;
    finiteBindingCorrelations.set(token, Object.freeze({ selection, root, validated, target }));
    return token;
  });
}

/** Fresh Application correlation for one demanded finite storage frontier.
 * Full-entry/final consumers continue through their complete readiness owner. */
export const withFiniteApplicationBindingCorrelationInTransaction = Effect.fn(
  "ApplicationActivation.withFiniteBindingCorrelation",
)(function* <Value, Failure, Requirements>(token: FiniteApplicationBindingCorrelation,
  selection: ApplicationBindingInput, root: SessionJournalAttempt, tx: AppRowTransaction, clock: ScopeClockRecord,
  work: (validated: ApplicationExecutableActiveSelection, checked: CheckedApplicationActiveHead) =>
    Effect.Effect<Value, Failure, Requirements>) {
  const state = finiteBindingCorrelations.get(token);
  if (state === undefined || state.selection !== selection || state.root !== root)
    return yield* activationFailure("validateSelection", "invalidComposition");
  const basis = state.validated.basis;
  yield* Effect.fromResult(readApplicationBindingTargetProtection(selection));
  if (!clockMatches(basis.authority, clock))
    return yield* activationFailure("validateSelection", "scopeAuthority", basis.revisionId);
  const protection = state.target.protection;
  if (protection !== undefined) yield* authenticateProtectedTargetMetadataSnapshot(protection, tx).pipe(
    Effect.mapError(cause => activationError("validateSelection", "resourceFailure", basis.revisionId, false, cause)));
  let checked: CheckedApplicationActiveHead | undefined;
  return yield* Effect.gen(function* () {
    const observed = yield* readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect(tx, clock,
      issued => { checked = issued; }, bindingHeadPreparations.get(selection));
    if (observed === null || !(state.validated.kind === "legacy"
      ? headMatchesBasis(observed.active.head, state.validated.basis)
      : relationHeadMatchesBasis(observed.active.head, state.validated.basis)))
      return yield* activationFailure("validateSelection", "concurrentHead", basis.revisionId);
    const schema = yield* readCheckedApplicationSchemaForHeadForShareInTransactionEffect(observed.checked, tx, clock);
    if (schema === "refresh" || schema.deploymentId !== basis.deploymentId || schema.revisionId !== basis.revisionId ||
      schema.schemaVersionId !== basis.schemaVersionId || schema.schemaManifestSha256 !== encodeBytesToLowercaseHex(basis.schemaManifestSha256))
      return yield* activationFailure("validateSelection", "concurrentHead", basis.revisionId);
    const validated = state.validated.kind === "legacy"
      ? Object.freeze({ kind: "legacy" as const, basis: copySelectionBasis(state.validated.basis) })
      : Object.freeze({ kind: "relation" as const, basis: copyRelationSelectionBasis(state.validated.basis) });
    const value = yield* Effect.suspend(() => work(validated, observed.checked));
    if (protection !== undefined) yield* (hasProtectedMetadataFinalGuardScope(tx)
      ? registerProtectedMetadataFinalGuard(tx, protection.token, protection.database, protection.epoch)
      : guardProtectedMetadataEpoch(protection.token, protection.database, protection.epoch, tx)).pipe(
      Effect.mapError(cause => activationError("validateSelection", "resourceFailure", basis.revisionId, false, cause)));
    return value;
  }).pipe(Effect.ensuring(Effect.sync(() => releaseCheckedApplicationActiveHead(checked))));
});

export const withAcceptedApplicationBinding = Effect.fn("ApplicationActivation.withAcceptedBinding")(
  function* <A, E, R>(input: ApplicationBindingInput, tx: AppRowTransaction, clock: ScopeClockRecord,
    work: (binding: AcceptedApplicationBinding) => Effect.Effect<A, E, R>, borrowed?: AcceptedApplicationBinding) {
    const prepared = bindingPreparations.get(input);
    if (prepared === undefined) return yield* activationFailure("validateSelection", "invalidComposition");
    if (borrowed !== undefined) {
      yield* Effect.fromResult(readAcceptedApplicationBinding(borrowed, tx, clock));
      if (acceptedBindings.get(borrowed)?.selection !== input ||
        acceptedBindings.get(borrowed)?.readiness !== prepared.readiness)
        return yield* activationFailure("validateSelection", "invalidComposition");
      return yield* Effect.suspend(() => work(borrowed));
    }
    return yield* withValidatedApplicationBindingBasisInTransaction(input, tx, clock,
      (validated, _checked, binding) => Effect.gen(function* () {
        if (validated.kind !== "relation") return yield* activationFailure("validateSelection", "invalidComposition");
        return yield* work(binding);
      }));
  },
);

export function readAcceptedApplicationBinding(binding: AcceptedApplicationBinding, tx: AppRowTransaction,
  clock: ScopeClockRecord, repository?: ApplicationRelationReadinessFoldRepository): Result.Result<
    ApplicationRelationActiveSelectionBasis, ApplicationActivationError> {
  const state = acceptedBindings.get(binding);
  if (state === undefined || state.validated.kind !== "relation" || state.tx !== tx ||
    !clockMatches(state.validated.basis.authority, clock) ||
    state.clock.lastCommitSeq !== clock.lastCommitSeq ||
    (repository !== undefined && (state.readiness === undefined ||
      !hasPreparedApplicationRelationReadRepository(state.readiness, repository)))) {
    return Result.fail(new ApplicationActivationError({ operation: "validateSelection", reason: "invalidComposition", retryable: false }));
  }
  return Result.succeed(copyRelationSelectionBasis(state.validated.basis));
}

/** The entry/source owner supplies its genuine captured source membership.
 * This verifies only the borrowed Application observation, never source proof. */
export function requireAcceptedApplicationBindingObservation(binding: AcceptedApplicationBinding,
  selection: ApplicationBindingInput, tx: AppRowTransaction, clock: ScopeClockRecord) {
  const state = acceptedBindings.get(binding);
  if (state === undefined || state.selection !== selection || state.tx !== tx ||
    !clockMatches(state.validated.basis.authority, clock) || state.checkedActive === undefined)
    return Result.fail(activationError("validateSelection", "invalidComposition"));
  const checked = state.checkedActive;
  return readApplicationBindingTargetProtection(selection).pipe(Result.flatMap(() =>
    readCheckedApplicationActiveHead(checked, tx, clock).pipe(Result.map(() => undefined))));
}

/** Private identity check for read-only binding composition, including both readiness contracts. */
export interface ApplicationBindingSelectionReader<Failure> {
  readonly readActive: () => Effect.Effect<CoherentActiveApplication | CoherentActiveRelationApplication, Failure>;
}

export function hasApplicationBindingComposition<Failure>(repository: ApplicationBindingSelectionReader<Failure>,
  authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1> |
    ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>): boolean {
  return activationRepositoryStates.get(repository)?.authority === authority;
}

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

/**
 * Claims the nominal active selection accepted by the function runtime while
 * preserving which immutable publication contract owns its evidence.
 */
export function claimApplicationExecutableActiveSelection(
  selection: unknown,
): Result.Result<
  ApplicationExecutableActiveSelection,
  ApplicationActivationError
> {
  if (typeof selection !== "object" || selection === null) {
    return Result.fail(
      activationError("validateSelection", "invalidComposition"),
    );
  }
  // SAFETY: the object guard permits the WeakMap lookup. Membership, rather
  // than structural shape, is the authority for both supported selections.
  const state = selectionStates.get(selection as ApplicationActiveSelection);
  if (state === undefined) {
    return Result.fail(
      activationError("validateSelection", "invalidComposition"),
    );
  }
  return state.kind === "legacy"
    ? Result.succeed(Object.freeze({
        kind: "legacy" as const,
        basis: copySelectionBasis(state.basis),
      }))
    : Result.succeed(Object.freeze({
        kind: "relation" as const,
        basis: copyRelationSelectionBasis(state.basis),
      }));
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
  authority: ExactTrustedScopeAuthorityResolutionPorts,
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
  const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
    { deploymentId, scopeId: basis.authority.scopeId },
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
    scopeId: context.scopeId,
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
      const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
        captured,
        captured.authority,
      );
      const replay = yield* tryReplayStoredActivation(located.target, located.authority, input.revisionId, expected, "legacy");
      if (replay !== null) return replay;
      const readiness = yield* captured.readiness.settle(Object.freeze({
        deploymentId: captured.deploymentId,
        scopeId: captured.scopeId,
        revisionId: input.revisionId,
      }));
      if (readiness.status !== "ready") {
        return yield* activationFailure("activate", "notReady", input.revisionId);
      }
      return yield* runLocatedTransaction(
        located.target,
        "activate",
        input.revisionId,
        tx => activateLegacyInTransaction(
          tx,
          located.target,
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
      const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
        captured,
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
        captured.scopeId,
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
      const active = issueLegacyActiveSelection(state, captured.readiness, readiness, yield* captureHostPreparationLifetime());
      const protection = readApplicationReadinessTargetProtection(captured.readiness, readiness);
      if (protection !== undefined) bindingHeadPreparations.set(active.selection,
        prepareApplicationActiveHeadStructure(protection, yield* captureHostPreparationCharge(), state.basis));
      return active;
    },
  );

  const repository = Object.freeze({ activate, readActive });
  activationRepositoryStates.set(repository, Object.freeze({
    readinessKind: "legacy",
    readiness: captured.readiness,
    authority: captured.authority,
  }));
  const prepare = makeActivePreparationReader(captured);
  finiteActivePreparationReaders.set(repository, Effect.fn("ApplicationActivation.prepareFiniteActiveOwned")(function* () {
    const prepared = yield* prepare("retained", false);
    if (prepared.kind !== "legacy") return yield* activationFailure("read", "activeMissing");
    const active = issueLegacyActiveSelection({ expectedActiveHead: {
      activationSequence: prepared.basis.activationSequence, headSha256: encodeBytesToLowercaseHex(prepared.basis.headSha256),
    }, basis: prepared.basis }, captured.readiness, prepared.readiness, prepared.lifetime);
    installBindingHeadPreparation(active.selection, prepared);
    // SAFETY: registry identity binds the exact repository and host construction lifetime.
    const result = Object.freeze({}) as PreparedFiniteActiveApplication;
    finiteActivePreparations.set(result, Object.freeze({ repository, selection: active.selection,
      schema: prepared.schema, lifetime: prepared.lifetime }));
    return result;
  }));
  bindingPreparationReaders.set(repository, Effect.fn("ApplicationActivation.prepareLegacyBinding")(function* (profile: "request" | "retained") {
    const prepared = yield* prepare(profile, false);
    if (prepared.kind !== "legacy") return yield* activationFailure("read", "activeMissing");
    return issueLegacyBindingPreparation(prepared);
  }));
  standaloneBindingPreparationReaders.set(repository, makeStandaloneBindingPreparationReader(captured));
  return repository;
}

function makeStandaloneBindingPreparationReader(context: ApplicationActivationContext<unknown, unknown>) {
  return Effect.fn("ApplicationActivation.captureStandaloneBinding")(function* () {
    const lifetime = yield* captureHostPreparationLifetime();
    if (lifetime === undefined || !validIdentity(context.deploymentId) ||
      !hasApplicationReadinessComposition(context.readiness, context.authority))
      return yield* activationFailure("read", "invalidComposition");
    yield* Effect.fromResult(lifetime.checkOpen()).pipe(Effect.mapError(cause =>
      activationError("read", "resourceFailure", undefined, false, cause)));
    const protectedMetadata = yield* Effect.fromResult(readApplicationReadinessPreparationProtection(context.readiness));
    const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(context, context.authority);
    if (!hasLocatedReadCommittedTargetDatabaseV1(located.target, protectedMetadata.database))
      return yield* activationFailure("read", "invalidComposition");
    const captured = yield* runLocatedTransaction(located.target, "read", undefined, tx => Effect.gen(function* () {
      yield* acquireProtectedMetadataInstallationAdmission(protectedMetadata.token, protectedMetadata.database, tx).pipe(
        Effect.mapError(cause => activationError("read", "resourceFailure", undefined, false, cause)));
      const epoch = yield* captureProtectedMetadataEpoch(protectedMetadata.token, protectedMetadata.database, tx).pipe(
        Effect.mapError(cause => activationError("read", "resourceFailure", undefined, false, cause)));
      const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, located.authority.scopeId);
      if (!clockMatches(located.authority, clock)) return yield* activationFailure("read", "scopeAuthority");
      const rows = yield* query(tx.select({ head: fxSystemApplicationActiveHeads, activation: fxSystemApplicationActivations,
        binding: fxSystemApplicationReadBindings }).from(fxSystemApplicationActiveHeads)
        .innerJoin(fxSystemApplicationActivations, and(eq(fxSystemApplicationActivations.scopeId, fxSystemApplicationActiveHeads.scopeId),
          eq(fxSystemApplicationActivations.activationSequence, fxSystemApplicationActiveHeads.activationSequence)))
        .innerJoin(fxSystemApplicationReadBindings, and(eq(fxSystemApplicationReadBindings.scopeId, fxSystemApplicationActiveHeads.scopeId),
          eq(fxSystemApplicationReadBindings.activationSequence, fxSystemApplicationActiveHeads.activationSequence)))
        .where(eq(fxSystemApplicationActiveHeads.scopeId, located.authority.scopeId)).limit(1)
        .for("share", { of: fxSystemApplicationActiveHeads }), "read");
      const row = rows[0];
      if (row === undefined) return yield* activationFailure("read", "activeMissing");
      yield* guardProtectedMetadataEpoch(protectedMetadata.token, protectedMetadata.database, epoch, tx).pipe(
        Effect.mapError(cause => activationError("read", "resourceFailure", undefined, false, cause)));
      return { row: structuredClone(row), epoch };
    }));
    const head = yield* decodeHead(captured.row.head, "read");
    const activation = yield* decodeActivation(captured.row.activation, "read", head.revisionId);
    const frame = yield* decodeStandaloneApplicationBinding(captured.row.binding).pipe(Effect.mapError(cause =>
      activationError("read", cause.reason, head.revisionId, false, cause)));
    if (!standaloneBindingMatchesHead(frame, head) || activation.scopeId !== head.scopeId ||
      activation.activationSequence !== head.activationSequence || activation.revisionId !== head.revisionId ||
      !bytesEqualFullScan(activation.activationSha256, head.activationSha256) ||
      !bytesEqualFullScan(activation.readinessSha256, head.readinessSha256) ||
      frame.deploymentId !== context.deploymentId || frame.storageGeneration !== located.authority.storageGeneration ||
      frame.storageGenerationFence !== located.authority.storageGenerationFence.toString() || frame.epoch !== located.authority.epoch)
      return yield* activationFailure("read", "storedState", head.revisionId);
    yield* Effect.fromResult(lifetime.charge(frame)).pipe(Effect.mapError(cause =>
      activationError("read", "resourceFailure", head.revisionId, false, cause)));
    // SAFETY: only this exact issuer owns the inert token and detached immutable frame.
    const result = Object.freeze({}) as PreparedStandaloneApplicationBinding;
    standaloneBindingPreparations.set(result, { authority: { ...located.authority, physicalLocator: { ...located.authority.physicalLocator } },
      frame, protection: { ...protectedMetadata, epoch: captured.epoch }, lifetime });
    return result;
  });
}

function standaloneBindingMatchesHead(frame: StandaloneApplicationBinding, head: DecodedApplicationActiveHead): boolean {
  if (frame.scopeId !== head.scopeId || frame.revisionId !== head.revisionId || frame.activationSequence !== head.activationSequence.toString() ||
    frame.headSha256 !== encodeBytesToLowercaseHex(head.headSha256) || frame.activationSha256 !== encodeBytesToLowercaseHex(head.activationSha256) ||
    frame.readinessSha256 !== encodeBytesToLowercaseHex(head.readinessSha256)) return false;
  const readiness = frame.readiness;
  return head.readinessKind === "legacy" ? readiness.kind === "legacy" : readiness.kind !== "legacy" &&
    readiness.relationCount === head.relationCount && readiness.relationSetReadinessSha256 === encodeBytesToLowercaseHex(head.relationSetReadinessSha256) &&
    (head.readinessContractVersion === 2 ? readiness.kind === "relation" : readiness.kind === "policy" &&
      readiness.writeOwnershipSha256 === head.writeOwnershipSha256 && readiness.writePolicySetSha256 === head.writePolicySetSha256);
}

/** Compact fresh Application correlation. Query-required storage admission is
 * owned separately; the original installation/epoch guard follows body success. */
export const withStandaloneApplicationBindingInTransaction = Effect.fn("ApplicationActivation.withStandaloneBinding")(
  function* <Value, Failure, Requirements>(input: PreparedStandaloneApplicationBinding, tx: AppRowTransaction, clock: ScopeClockRecord,
    work: (state: { readonly frame: StandaloneApplicationBinding; readonly authority: TrustedScopeAuthority }) => Effect.Effect<Value, Failure, Requirements>) {
    const state = standaloneBindingPreparations.get(input);
    if (state === undefined) return yield* activationFailure("validateSelection", "invalidComposition");
    yield* Effect.fromResult(readPreparedStandaloneApplicationBinding(input));
    if (!clockMatches(state.authority, clock)) return yield* activationFailure("validateSelection", "scopeAuthority", state.frame.revisionId);
    yield* authenticateProtectedTargetMetadataSnapshot(state.protection, tx).pipe(Effect.mapError(cause =>
      activationError("validateSelection", "resourceFailure", state.frame.revisionId, false, cause)));
    const snapshot = readStandaloneReadSnapshot(tx, state.protection.database, clock.scopeId);
    const head = snapshot === undefined ? (yield* query(tx.select({ sequence: fxSystemApplicationActiveHeads.activationSequence,
      readinessContractVersion: fxSystemApplicationActiveHeads.readinessContractVersion,
      revisionId: fxSystemApplicationActiveHeads.revisionId, headSha256: fxSystemApplicationActiveHeads.headSha256,
      activationSha256: fxSystemApplicationActiveHeads.activationSha256, readinessSha256: fxSystemApplicationActiveHeads.readinessSha256 })
      .from(fxSystemApplicationActiveHeads).where(eq(fxSystemApplicationActiveHeads.scopeId, clock.scopeId)).limit(1).for("share"), "validateSelection"))[0]
      : snapshot.applicationHead;
    if (!standaloneApplicationHeadMatches(state.frame, head))
      return yield* activationFailure("validateSelection", "concurrentHead", state.frame.revisionId);
    const value = yield* Effect.suspend(() => work({ frame: structuredClone(state.frame),
      authority: { ...state.authority, physicalLocator: { ...state.authority.physicalLocator } } }));
    yield* (hasProtectedMetadataFinalGuardScope(tx)
      ? registerProtectedMetadataFinalGuard(tx, state.protection.token, state.protection.database, state.protection.epoch)
      : guardProtectedMetadataEpoch(state.protection.token, state.protection.database, state.protection.epoch, tx)).pipe(
      Effect.mapError(cause => activationError("validateSelection", "resourceFailure", state.frame.revisionId, false, cause)));
    return value;
  },
);

function standaloneApplicationHeadMatches(frame: StandaloneApplicationBinding,
  head: StandaloneReadSnapshot["applicationHead"] | undefined): boolean {
  return head !== undefined && head !== null && head.sequence.toString() === frame.activationSequence && head.revisionId === frame.revisionId &&
    head.readinessContractVersion === (frame.readiness.kind === "legacy" ? 1 : frame.readiness.kind === "relation" ? 2 : 3) &&
    encodeBytesToLowercaseHex(head.headSha256) === frame.headSha256 && encodeBytesToLowercaseHex(head.activationSha256) === frame.activationSha256 &&
    encodeBytesToLowercaseHex(head.readinessSha256) === frame.readinessSha256;
}

function makeActivePreparationReader<SchemaFailure, ColdFailure>(captured: ApplicationActivationContext<SchemaFailure, ColdFailure>) {
  return Effect.fn("ApplicationActivation.captureActive")(function* (profile: "request" | "retained", allowRelation: boolean) {
    if (!validIdentity(captured.deploymentId) || !hasApplicationReadinessComposition(
      captured.readiness, captured.authority)) return yield* activationFailure("read", "invalidComposition");
    const lifetime = profile === "retained" ? yield* captureHostPreparationLifetime() : undefined;
    const protectionResult = readApplicationReadinessPreparationProtection(captured.readiness);
    const protection = Result.isSuccess(protectionResult) ? protectionResult.success : undefined;
    const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(captured, captured.authority);
    if (protection !== undefined && !hasLocatedReadCommittedTargetDatabaseV1(located.target, protection.database))
      return yield* activationFailure("read", "invalidComposition");
    const raw = yield* runLocatedTransaction(located.target, "read", undefined, tx => Effect.gen(function* () {
      if (protection !== undefined) yield* acquireProtectedMetadataInstallationAdmission(protection.token, protection.database, tx).pipe(
        Effect.mapError(cause => activationError("read", "resourceFailure", undefined, false, cause)));
      // Match activation's clock-before-head order. KEY SHARE retains lifecycle
      // protection while ordinary sequence publication remains compatible.
      const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, located.authority.scopeId);
      const heads = yield* query(tx.select({ ...getTableColumns(fxSystemApplicationActiveHeads),
        headBytes: sql<Uint8Array>`case when octet_length(${fxSystemApplicationActiveHeads.headBytes}) between 1 and ${MAX_FRAME_BYTES}
          then ${fxSystemApplicationActiveHeads.headBytes} else ''::bytea end`,
      }).from(fxSystemApplicationActiveHeads).where(eq(
        fxSystemApplicationActiveHeads.scopeId, located.authority.scopeId,
      )).limit(1).for("share"), "read");
      const head = heads[0];
      if (head === undefined || (!allowRelation && head.readinessContractVersion !== 1) || !validIdentity(head.revisionId))
        return yield* activationFailure("read", "activeMissing");
      if (head.headBytes.byteLength > MAX_FRAME_BYTES) return yield* activationFailure("read", "storedState");
      const readiness = head.readinessContractVersion === 1 ? yield* captureApplicationReadinessInTransaction(captured.readiness,
        located.authority, head.revisionId, located.target, tx, clock, profile).pipe(
          Effect.mapError(error => mapPreparationReadinessError(profile, error))) : undefined;
      return Object.freeze({ head: structuredClone(head), readiness });
    }));
    const head = yield* decodeHead(raw.head, "read");
    if (head.readinessKind !== "legacy") return Object.freeze({ kind: "relation" as const,
      authority: located.authority, revisionId: head.revisionId });
    if (raw.readiness === undefined) return yield* activationFailure("read", "invalidComposition");
    const prepared = yield* prepareCapturedApplicationReadiness(captured.readiness, raw.readiness).pipe(
      Effect.mapError(error => mapPreparationReadinessError(profile, error)));
    if ("status" in prepared) return yield* activationFailure("read", "notReady", head.revisionId);
    if (!headMatchesValidatedReadiness(head,
      { kind: "legacy", basis: prepared.basis })) return yield* activationFailure("read", "concurrentHead");
    const basis = copySelectionBasis({ ...prepared.basis, activationSequence: head.activationSequence,
      activationSha256: copyBytes(head.activationSha256), headSha256: copyBytes(head.headSha256) });
    if (profile === "retained") yield* chargeHostPreparation({ basis: { ...basis,
      physicalRequirements: { ...basis.physicalRequirements } }, schema: prepared.schema }).pipe(
      Effect.mapError(cause => activationError("read", "resourceFailure", head.revisionId, false, cause)));
    return Object.freeze({ kind: "legacy" as const, basis, readinessRepository: captured.readiness,
      readiness: prepared.readiness, schema: prepared.schema, lifetime });
  });
}

type ActivePreparation = Extract<Effect.Success<ReturnType<ReturnType<typeof makeActivePreparationReader>>>, { readonly kind: "legacy" }>;

function mapPreparationReadinessError<E>(profile: "request" | "retained", error: E): E | ApplicationReadinessError {
  return profile === "request" && error instanceof ApplicationReadinessError
    ? new ApplicationReadinessError({ operation: "readReady", reason: error.reason, retryable: error.retryable,
      ...("cause" in error ? { cause: error.cause } : {}) }) : error;
}

function installBindingHeadPreparation(token: ApplicationActiveSelection | PreparedApplicationBinding, prepared: ActivePreparation): void {
  const protection = readApplicationReadinessTargetProtection(prepared.readinessRepository, prepared.readiness);
  if (protection !== undefined) bindingHeadPreparations.set(token, prepareApplicationActiveHeadStructure(
    protection, prepared.lifetime?.charge, prepared.basis));
}

function issueLegacyBindingPreparation(prepared: ActivePreparation): PreparedApplicationBinding {
  // SAFETY: the inert handle is recognized only by its issuer-owned registry.
  const token = Object.freeze({}) as PreparedApplicationBinding;
  legacyBindingPreparations.set(token, Object.freeze({ kind: "legacy", basis: copySelectionBasis(prepared.basis),
    readinessRepository: prepared.readinessRepository, readiness: prepared.readiness, lifetime: prepared.lifetime }));
  if (prepared.lifetime !== undefined) installBindingHeadPreparation(token, prepared);
  return token;
}

function makeCompositeApplicationActivationRepository<
  SchemaFailure,
  ColdFailure,
>(
  context: ApplicationRelationActivationContext<SchemaFailure, ColdFailure>,
): ApplicationRelationActivationRepository<SchemaFailure, ColdFailure> {
  const captured = Object.freeze({
    deploymentId: context.deploymentId,
    scopeId: context.scopeId,
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
      const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
        captured,
        captured.authority,
      );
      const replay = yield* tryReplayStoredActivation(located.target, located.authority, input.revisionId, expected);
      if (replay !== null) return replay;
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
          scopeId: captured.scopeId,
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
            located.target,
            located.authority,
            captured.readiness,
            readiness,
            expected,
            captured.faultAfter,
          ),
        );
      }
      const readiness = yield* captured.relationReadiness.settle(Object.freeze({
        deploymentId: captured.deploymentId,
        scopeId: captured.scopeId,
        revisionId: input.revisionId,
      }));
      if (readiness.status !== "ready") {
        const racedReplay = yield* tryReplayStoredActivation(located.target, located.authority, input.revisionId, expected);
        if (racedReplay !== null) return racedReplay;
        return yield* activationFailure(
          "activate",
          "notReady",
          input.revisionId,
        );
      }
      return yield* withApplicationActivationCatalogLock(captured.relationReadiness, readiness,
        catalogLease => runLocatedTransaction(
          located.target,
          "activate",
          input.revisionId,
          tx => activateRelationInTransaction(
            tx,
            located.target,
            located.authority,
            captured.relationReadiness,
            readiness,
            expected,
            captured.faultAfter,
            catalogLease,
          ),
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
      const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
        captured,
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
          captured.scopeId,
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
        return issueLegacyActiveSelection(state, captured.readiness, readiness, yield* captureHostPreparationLifetime());
      }
      const readiness = yield* loadRelationReadyForActiveRead(
        captured.relationReadiness,
        captured.deploymentId,
        captured.scopeId,
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
  const prepareActive = makeActivePreparationReader(captured);
  bindingPreparationReaders.set(repository, Effect.fn("ApplicationActivation.prepareCompositeBinding")(
    function* (profile: "request" | "retained") {
      if (!validIdentity(captured.deploymentId) || !compositionIsExact()) return yield* activationFailure("read", "invalidComposition");
      const lifetime = profile === "retained" ? yield* captureHostPreparationLifetime() : undefined;
      const prepared = yield* prepareActive(profile, true);
      if (prepared.kind === "legacy") return issueLegacyBindingPreparation(prepared);
      const readiness = yield* prepareApplicationRelationActiveRead(captured.relationReadiness,
        { deploymentId: captured.deploymentId, scopeId: captured.scopeId, revisionId: prepared.revisionId });
      yield* chargeHostPreparation({ authority: prepared.authority, revisionId: prepared.revisionId }).pipe(
        Effect.mapError(cause => activationError("read", "resourceFailure", prepared.revisionId, false, cause)),
      );
      const token: ApplicationBindingPreparation = Object.freeze({ [bindingPreparationBrand]: true as const });
      bindingPreparations.set(token, Object.freeze({ authority: prepared.authority, revisionId: prepared.revisionId, readiness, lifetime }));
      return token;
    },
  ));
  standaloneBindingPreparationReaders.set(repository, makeStandaloneBindingPreparationReader(captured));
  return repository;
}

const loadReadyForActiveRead = Effect.fn(
  "ApplicationActivation.loadReadyForActiveRead",
)(function* <SchemaFailure, ColdFailure>(
  readinessRepository: ApplicationReadinessRepository<SchemaFailure, ColdFailure>,
  deploymentId: string,
  scopeId: TrustedScopeAuthority["scopeId"],
  revisionId: string,
) {
  const readiness = yield* readinessRepository.readReady(Object.freeze({
    deploymentId,
    scopeId,
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
  scopeId: TrustedScopeAuthority["scopeId"],
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
    scopeId,
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
}>, readinessRepository: unknown, readiness: ApplicationReadinessResult,
  lifetime: LegacySelectionState["lifetime"]): CoherentActiveApplication {
  // SAFETY: the selection is an inert identity token; all authority remains
  // in the module-local WeakMap keyed by this object identity.
  const selection = Object.freeze({}) as ApplicationActiveSelection;
  selectionStates.set(selection, Object.freeze({
    kind: "legacy",
    basis: copySelectionBasis(state.basis),
    readinessRepository,
    readiness,
    lifetime,
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

/** The callback owns the positive observation through all selected checks and releases it on every exit. */
export const withValidatedApplicationBindingBasisInTransaction = Effect.fn(
  "ApplicationActivation.withValidatedBindingBasis",
)(function* <Value, Failure, Requirements>(selection: ApplicationBindingInput, tx: AppRowTransaction,
  currentClock: ScopeClockRecord,
  work: (validated: Effect.Success<ReturnType<typeof validateApplicationBindingBasisOwned>>,
    checked: CheckedApplicationActiveHead | undefined, binding: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>,
  borrowed?: AcceptedApplicationBinding) {
  let checked: CheckedApplicationActiveHead | undefined;
  return yield* Effect.gen(function* () {
    const validated = yield* validateApplicationBindingBasisOwned(selection, tx, currentClock,
      issued => { checked = issued; }, borrowed);
    const observed = checked ?? (borrowed === undefined ? undefined : acceptedBindings.get(borrowed)?.checkedActive);
    return yield* withApplicationBindingObservation(selection, tx, currentClock, validated, observed,
      binding => work(validated, observed, binding), borrowed);
  }).pipe(Effect.ensuring(Effect.sync(() => releaseCheckedApplicationActiveHead(checked))));
});

/** The standalone outer SQL owner must finish all source/native/settlement
 * work in this callback, with no metadata acquisition after successful return. */
export const withPreparedApplicationBindingBasisInTransaction = Effect.fn(
  "ApplicationActivation.withPreparedBindingBasis",
)(function* <Value, Failure, Requirements>(selection: PreparedApplicationBinding, tx: AppRowTransaction,
  currentClock: ScopeClockRecord,
  work: (validated: Extract<ApplicationExecutableActiveSelection, { readonly kind: "legacy" }>,
    checked: CheckedApplicationActiveHead | undefined, binding: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>) {
  const state = legacyBindingPreparations.get(selection);
  if (state === undefined) return yield* activationFailure("validateSelection", "invalidComposition");
  yield* Effect.fromResult(readApplicationBindingTargetProtection(selection));
  if (!clockMatches(state.basis.authority, currentClock))
    return yield* activationFailure("validateSelection", "scopeAuthority", state.basis.revisionId);
  let checked: CheckedApplicationActiveHead | undefined;
  return yield* Effect.gen(function* () {
    // The request capture authenticated readiness, not the activation/schema
    // rows. Keep the actual live row proofs, without a retained head template.
    const observed = yield* readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect(tx, currentClock,
      issued => { checked = issued; });
    return yield* withStoredApplicationReadinessForBindingInTransaction(state.readinessRepository,
      state.readiness, tx, currentClock, checked, ready => Effect.gen(function* () {
        if (observed === null || !headMatchesBasis(observed.active.head, state.basis) ||
          !headMatchesValidatedReadiness(observed.active.head, { kind: "legacy", basis: ready.basis }))
          return yield* activationFailure("validateSelection", "concurrentHead", state.basis.revisionId);
        const validated = Object.freeze({ kind: "legacy" as const, basis: copySelectionBasis(state.basis) });
        return yield* withApplicationBindingObservation(selection, tx, currentClock, validated, checked,
          binding => work(validated, checked, binding));
      }));
  }).pipe(Effect.ensuring(Effect.sync(() => releaseCheckedApplicationActiveHead(checked))));
});

function withApplicationBindingObservation<Value, Failure, Requirements>(selection: ApplicationBindingInput,
  tx: AppRowTransaction, clock: ScopeClockRecord, validated: ApplicationExecutableActiveSelection,
  checkedActive: CheckedApplicationActiveHead | undefined,
  work: (binding: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>,
  borrowed?: AcceptedApplicationBinding): Effect.Effect<Value, Failure, Requirements> {
  if (borrowed !== undefined) return Effect.suspend(() => work(borrowed));
  return Effect.acquireUseRelease(Effect.sync(() => {
    // SAFETY: this existing issuer owns the inert callback-local observation;
    // neither its basis nor its checked handle grants executable authority.
    const binding = Object.freeze({}) as AcceptedApplicationBinding;
    const detached = validated.kind === "legacy"
      ? Object.freeze({ kind: "legacy" as const, basis: copySelectionBasis(validated.basis) })
      : Object.freeze({ kind: "relation" as const, basis: copyRelationSelectionBasis(validated.basis) });
    acceptedBindings.set(binding, { selection, tx, clock: { ...clock, updatedAt: new Date(clock.updatedAt.getTime()) },
      validated: detached, checkedActive, readiness: bindingPreparations.get(selection)?.readiness });
    return binding;
  }), binding => Effect.suspend(() => work(binding)), binding => Effect.sync(() => { acceptedBindings.delete(binding); }));
}

/** Read-only composition for ordinary callers; no checked observation leaves this method. */
export const validateApplicationBindingBasisInTransaction = Effect.fn(
  "ApplicationActivation.validateBindingBasisInTransaction",
)((selection: ApplicationBindingInput, tx: AppRowTransaction, currentClock: ScopeClockRecord) =>
  withValidatedApplicationBindingBasisInTransaction(selection, tx, currentClock, validated => Effect.succeed(validated)));

const validateApplicationBindingBasisOwned = Effect.fn(
  "ApplicationActivation.validateBindingBasisOwned",
)(function* (selection: ApplicationBindingInput, tx: AppRowTransaction, currentClock: ScopeClockRecord,
  issued: (checked: CheckedApplicationActiveHead | undefined) => void, borrowed?: AcceptedApplicationBinding) {
  const readActive = () => readApplicationBindingActiveHead(selection, tx, currentClock, issued, borrowed);
  const preparation = bindingPreparations.get(selection);
  if (preparation !== undefined) {
    yield* Effect.fromResult(readApplicationBindingTargetProtection(selection));
    if (!clockMatches(preparation.authority, currentClock)) return yield* activationFailure("validateSelection", "scopeAuthority", preparation.revisionId);
    const observed = yield* readActive();
    const active = observed?.active ?? null;
    if (active === null || active.head.revisionId !== preparation.revisionId || active.head.readinessKind === "legacy") {
      return yield* activationFailure("validateSelection", "concurrentHead", preparation.revisionId);
    }
    const validated = yield* acceptPreparedApplicationRelationActiveRead(preparation.readiness, tx, currentClock);
    if (!headMatchesValidatedReadiness(active.head, { kind: "relation", basis: validated })) {
      return yield* activationFailure("validateSelection", "concurrentHead", preparation.revisionId);
    }
    return Object.freeze({ kind: "relation" as const, basis: copyRelationSelectionBasis({ ...validated,
      activationSequence: active.head.activationSequence, activationSha256: copyBytes(active.head.activationSha256),
      headSha256: copyBytes(active.head.headSha256),
    }) });
  }
  // SAFETY: this assertion only permits lookup by object identity. The selection registry authenticates the remaining member; a forged
  // preparation is not promoted to an active selection by this lookup.
  const state = legacyBindingPreparations.get(selection) ?? selectionStates.get(selection as ApplicationActiveSelection);
  if (state === undefined) return yield* activationFailure("validateSelection", "invalidComposition");
    if (state.kind === "relation") {
      // Binding admission locks the Application head before restoring its readiness dependencies.
      const observed = yield* readActive();
      const active = observed?.active ?? null;
      if (active === null || !relationHeadMatchesBasis(active.head, state.basis)) {
        return yield* activationFailure("validateSelection", "concurrentHead", state.basis.revisionId);
      }
      const basis = yield* validateCheckedRelationSelection(state, tx, currentClock);
    return Object.freeze({ kind: "relation" as const, basis });
  }
  yield* Effect.fromResult((state.lifetime?.checkOpen() ?? Result.succeed(undefined)).pipe(
    Result.mapError(cause => activationError("validateSelection", "invalidComposition", state.basis.revisionId, false, cause))));
  if (!clockMatches(state.basis.authority, currentClock)) {
    return yield* activationFailure("validateSelection", "scopeAuthority", state.basis.revisionId);
  }
  const observed = yield* readActive();
  const active = observed?.active ?? null;
  const validated = yield* validateStoredApplicationReadinessForActivationInTransaction(
    state.readinessRepository, state.readiness, tx, currentClock, observed?.checked,
  );
  if (active === null || !headMatchesBasis(active.head, state.basis)
    || !headMatchesValidatedReadiness(active.head, { kind: "legacy", basis: validated.basis })) {
    return yield* activationFailure("validateSelection", "concurrentHead", state.basis.revisionId);
  }
  return Object.freeze({ kind: "legacy" as const, basis: copySelectionBasis(state.basis) });
});

const readApplicationBindingActiveHead = Effect.fn("ApplicationActivation.readBindingActiveHead")(
  function* (selection: ApplicationBindingInput, tx: AppRowTransaction, clock: ScopeClockRecord,
    issued: (checked: CheckedApplicationActiveHead | undefined) => void, borrowed?: AcceptedApplicationBinding) {
    if (borrowed !== undefined) {
      yield* Effect.fromResult(requireAcceptedApplicationBindingObservation(borrowed, selection, tx, clock));
      const checked = acceptedBindings.get(borrowed)?.checkedActive;
      if (checked === undefined) return yield* activationFailure("validateSelection", "invalidComposition");
      const active = yield* Effect.fromResult(readCheckedApplicationActiveHead(checked, tx, clock));
      if (active !== "refresh") return Object.freeze({ active, checked });
    }
    return yield* readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect(tx, clock, issued,
      bindingHeadPreparations.get(selection));
  },
);

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

const validateCheckedRelationSelection = Effect.fn(
  "ApplicationActivation.validateCheckedRelationSelection",
)(function* (
  state: RelationSelectionState,
  tx: AppRowTransaction,
  currentClock: ScopeClockRecord,
): Effect.fn.Return<
  ApplicationRelationActiveSelectionBasis,
  ValidateApplicationRelationActiveSelectionInTransactionError
> {
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
  return copyRelationSelectionBasis(basis);
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
  return yield* validateCheckedRelationSelection(state, tx, currentClock);
});

export const validateApplicationExecutableActiveSelectionInTransaction =
  Effect.fn("ApplicationActivation.validateExecutableSelectionInTransaction")(
    function* (
      selection: unknown,
      tx: AppRowTransaction,
      currentClock: ScopeClockRecord,
    ) {
      const claimed = yield* Effect.fromResult(
        claimApplicationExecutableActiveSelection(selection),
      );
      if (claimed.kind === "legacy") {
        const basis = yield* validateApplicationActiveSelectionInTransaction(
          selection,
          tx,
          currentClock,
        );
        return Object.freeze({ kind: "legacy" as const, basis });
      }
      const basis = yield*
        validateApplicationRelationActiveSelectionInTransaction(
          selection,
          tx,
          currentClock,
        );
      return Object.freeze({ kind: "relation" as const, basis });
    },
  );

/** Receipt recovery never restores serving authority or changes the active head. */
const tryReplayStoredActivation = Effect.fn("ApplicationActivation.tryReplayStored")(
  (target: LocatedReadCommittedAttemptTargetV1, authority: TrustedScopeAuthority,
    revisionId: string, expected: ApplicationActiveCasToken | null, readinessKind?: DecodedActivation["readinessKind"]) =>
    runLocatedTransaction(target, "activate", revisionId, tx => Effect.gen(function* () {
      const clock = yield* lockScopeClockForShareInTransactionEffect(tx, authority.scopeId);
      if (!clockMatches(authority, clock)) return yield* activationFailure("activate", "scopeAuthority", revisionId);
      if (expected?.activationSequence === MAX_SEQUENCE) return null;
      const sequence = expected === null ? 1n : expected.activationSequence + 1n;
      const rows = yield* query(tx.select().from(fxSystemApplicationActivations).where(and(
        eq(fxSystemApplicationActivations.scopeId, authority.scopeId),
        eq(fxSystemApplicationActivations.activationSequence, sequence),
        eq(fxSystemApplicationActivations.revisionId, revisionId),
      )).limit(1).for("share"), "activate", revisionId);
      const row = rows[0];
      if (row === undefined) return null;
      const decoded = yield* decodeActivation(row, "activate", revisionId);
      if (decoded.scopeId !== authority.scopeId || decoded.revisionId !== revisionId ||
        decoded.activationSequence !== sequence || decoded.previousActivationSequence !== (expected?.activationSequence ?? null) ||
        (readinessKind !== undefined && decoded.readinessKind !== readinessKind))
        return yield* activationFailure("activate", "storedState", revisionId);
      const request = yield* canonicalFrame(applicationActivationRequestFrame({
        scopeId: authority.scopeId, revisionId, readiness: decodedReadinessCommitment(decoded),
        expectedActiveHead: expected === null ? null : { activationSequence: expected.activationSequence.toString(), headSha256: expected.headSha256 },
      }), "activate", revisionId);
      if (!bytesEqualFullScan(decoded.activationRequestSha256, request.sha256))
        return yield* activationFailure("activate", "expectedHead", revisionId);
      return yield* activationReceipt("replayed", row, decoded, request.sha256);
    })),
);

const activateLegacyInTransaction = Effect.fn(
  "ApplicationActivation.activateLegacyTransaction",
)(
function* (
  tx: AppRowTransaction,
  target: LocatedReadCommittedAttemptTargetV1,
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
    schemaVersionId => loadRelatedPublishedPhysicalRequirementSnapshotV1(validated.basis.physicalRequirements, schemaVersionId, target, tx),
    schemaVersionId => readApplicationActivationUniqueRequirements(readinessRepository, readiness, schemaVersionId, target, tx),
    Object.freeze({ kind: "legacy", basis: validated.basis }),
    clock,
    expected,
    faultAfter,
  );
});

const activateRelationInTransaction = Effect.fn(
  "ApplicationActivation.activateRelationTransaction",
)(function* (
  tx: AppRowTransaction,
  target: LocatedReadCommittedAttemptTargetV1,
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
  catalogLease: ApplicationActivationCatalogLease | undefined,
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
      catalogLease,
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
    schemaVersionId => readApplicationActivationRelatedPhysicalRequirements(readinessRepository, readiness, schemaVersionId, target, tx, catalogLease),
    schemaVersionId => readApplicationRelationActivationUniqueRequirements(readinessRepository, readiness, schemaVersionId, target, tx, catalogLease),
    Object.freeze({ kind: "relation", basis: validated.basis }),
    clock,
    expected,
    faultAfter,
    budget => readApplicationRelationOwnershipInTransaction(readinessRepository, tx, authority.scopeId, budget, catalogLease, target),
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

const persistActivationInTransaction = Effect.fn(
  "ApplicationActivation.persistTransaction",
)(function* (
  tx: AppRowTransaction,
  readRelatedRequirements: ReadRelatedPublishedPhysicalRequirements,
  readUniqueRequirements: ReadUniqueMaintenanceRequirements,
  validated: ValidatedActivation,
  clock: ScopeClockRecord,
  expected: ApplicationActiveCasToken | null,
  faultAfter: ActivationFault | undefined,
  recoverOwnership?: (budget: ApplicationWriteOwnershipHistoryBudget) => Effect.Effect<unknown, ApplicationWriteOwnershipError>,
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
  const ownership = validated.kind === "relation" ? validated.basis.writeOwnership : null;
  const writePolicySetSha256 = ownership === null ? null : yield* Effect.fromResult(
    Encoding.decodeHex(ownership.frame.writePolicySetSha256).pipe(Result.mapError(cause =>
      activationError("activate", "storedState", basis.revisionId, false, cause))));
  if (ownership === null) {
    const retained = yield* query(tx.select({ sequence: fxSystemApplicationWriteOwnership.activationSequence })
      .from(fxSystemApplicationWriteOwnership).where(eq(fxSystemApplicationWriteOwnership.scopeId, authority.scopeId)).limit(1),
      "activate", basis.revisionId);
    if (head?.readinessContractVersion === 3 || retained.length !== 0) {
      return yield* activationFailure("activate", "notReady", basis.revisionId);
    }
  } else if (ownership.frame.scopeId !== authority.scopeId || ownership.frame.revisionId !== basis.revisionId ||
    ownership.frame.activationSequence !== activationSequence.toString() ||
    (ownership.frame.predecessor === null ? head?.readinessContractVersion === 3 :
      head?.activationSequence.toString() !== ownership.frame.predecessor.activationSequence ||
      head.writeOwnershipSha256 !== ownership.frame.predecessor.claimsSha256)) {
    return yield* activationFailure("activate", "expectedHead", basis.revisionId);
  }
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
      writePolicySetSha256: writePolicySetSha256,
      writeOwnershipSha256: ownership?.sha256 ?? null,
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
  if (ownership !== null) {
    yield* query(tx.insert(fxSystemApplicationWriteOwnership).values({ scopeId: authority.scopeId, activationSequence,
      claimsSha256: ownership.sha256, claimsBytes: ownership.canonicalBytes }).returning({
      sequence: fxSystemApplicationWriteOwnership.activationSequence }), "activate", basis.revisionId);
  }
  const nextHead = yield* canonicalFrame(applicationActiveHeadFrame({
    scopeId: authority.scopeId,
    activationSequence: activationSequence.toString(),
    revisionId: basis.revisionId,
    readiness,
    activationSha256: encodeBytesToLowercaseHex(activation.sha256),
  }), "activate", basis.revisionId);
  yield* replaceActiveIndexMaintenanceInTransactionEffect(tx, readRelatedRequirements, clock, basis.physicalRequirements, activationSequence, nextHead.sha256, faultAfter)
    .pipe(Effect.mapError(cause => {
      const resource = cause instanceof AppRowReadPersistenceError ||
        (cause instanceof IndexMaintenanceError && cause.reason === "resourceFailure");
      return activationError("activate", resource ? "resourceFailure" : "storedState", basis.revisionId,
        resource && (cause instanceof IndexMaintenanceError ? (cause.retryable ?? retryableCause(cause.cause)) : retryableCause(cause.cause)), cause);
    }));
  yield* replaceActiveUniqueMaintenanceInTransactionEffect(tx, clock, readUniqueRequirements,
    basis.deploymentId, basis.schemaVersionId, activationSequence, nextHead.sha256, faultAfter)
    .pipe(Effect.mapError(cause => {
      const resource = cause instanceof AppUniqueConstraintSetBuildIntegrationV1Error ||
        ((cause instanceof UniqueMaintenanceError || cause instanceof IndexMaintenanceError) && cause.reason === "resourceFailure");
      return activationError("activate", resource ? "resourceFailure" : "storedState", basis.revisionId,
        resource && ((cause instanceof AppUniqueConstraintSetBuildIntegrationV1Error || cause instanceof UniqueMaintenanceError ||
          cause instanceof IndexMaintenanceError) ? (cause.retryable ?? false) : false), cause);
    }));
  if (head === null) {
    const inserted = yield* query(
      tx.insert(fxSystemApplicationActiveHeads).values({
        scopeId: authority.scopeId,
        activationSequence,
        revisionId: basis.revisionId,
        readinessContractVersion: readiness.contractVersion,
        writePolicySetSha256: writePolicySetSha256,
        writeOwnershipSha256: ownership?.sha256 ?? null,
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
        writePolicySetSha256: writePolicySetSha256,
        writeOwnershipSha256: ownership?.sha256 ?? null,
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
  if (ownership !== null) {
    // A newly installed head must remain cold-readable and replayable within the
    // same aggregate limit. Failure rolls back both the claim and head writes.
    const recoveryBudget = new ApplicationWriteOwnershipHistoryBudget();
    if (recoverOwnership === undefined) return yield* activationFailure("activate", "notReady", basis.revisionId);
    yield* recoverOwnership(recoveryBudget).pipe(Effect.mapError(cause =>
      activationError("activate", "notReady", basis.revisionId, false, cause)));
  }
  yield* publishStandaloneBindingInTransaction(tx, validated, activationSequence, activation.sha256, nextHead.sha256);
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

const publishStandaloneBindingInTransaction = Effect.fn("ApplicationActivation.publishStandaloneBinding")(
  function* (tx: AppRowTransaction, validated: ValidatedActivation, activationSequence: bigint,
    activationSha256: Uint8Array, headSha256: Uint8Array) {
    const basis = validated.basis;
    const readiness = validated.kind === "legacy"
      ? { kind: "legacy" as const, schemaBindingSha256: encodeBytesToLowercaseHex(validated.basis.schemaBindingSha256) }
      : { ...(validated.basis.writeOwnership === null ? { kind: "relation" as const } : { kind: "policy" as const,
          writePolicySetSha256: validated.basis.writeOwnership.frame.writePolicySetSha256,
          writeOwnershipSha256: validated.basis.writeOwnership.sha256Hex }),
        manifestSchemaBindingSha256: encodeBytesToLowercaseHex(validated.basis.manifestSchemaBindingSha256),
        boundPublicationSha256: encodeBytesToLowercaseHex(validated.basis.boundPublicationSha256),
        relationFrontierCommitSeq: validated.basis.relationFrontierCommitSeq,
        relationSetReadinessSha256: encodeBytesToLowercaseHex(validated.basis.relationSetReadinessSha256), relationCount: validated.basis.relationCount };
    const canonical = yield* canonicalStandaloneApplicationBinding({ format: "flarex.application.read-binding",
      deploymentId: basis.deploymentId, scopeId: basis.authority.scopeId, storageGeneration: basis.authority.storageGeneration,
      storageGenerationFence: basis.authority.storageGenerationFence.toString(), epoch: basis.authority.epoch,
      activationSequence: activationSequence.toString(), activationSha256: encodeBytesToLowercaseHex(activationSha256),
      headSha256: encodeBytesToLowercaseHex(headSha256), revisionId: basis.revisionId, schemaVersionId: basis.schemaVersionId,
      applicationSchemaSha256: encodeBytesToLowercaseHex(basis.applicationSchemaSha256), schemaManifestSha256: encodeBytesToLowercaseHex(basis.schemaManifestSha256),
      readinessSha256: encodeBytesToLowercaseHex(basis.readinessSha256), readiness,
      analysis: { candidateId: basis.candidateId, analysisId: basis.analysisId, manifestSha256: encodeBytesToLowercaseHex(basis.manifestSha256),
        sourceArtifactRootSha256: encodeBytesToLowercaseHex(basis.sourceArtifactRootSha256) } }).pipe(Effect.mapError(cause =>
          activationError("activate", cause.reason, basis.revisionId, false, cause)));
    yield* query(tx.select({ published: sql<null>`${sql.identifier(basis.authority.physicalLocator.schemaName)}.fx_publish_application_read_binding(
      ${canonical.bytes}::bytea, ${canonical.sha256}::bytea)` }).from(sql`(values (1)) as publication_input(value)`), "activate", basis.revisionId);
  },
);

/** Installation owner only: its dedicated fenced backend invokes this before
 * verification/reopen. Page through durable heads; retain at most one bounded
 * parent frame at a time and let the constrained publisher authenticate it. */
export const backfillStandaloneApplicationBindings = Effect.fn("ApplicationActivation.backfillStandaloneBindings")(
  function* (database: FlarexMetadataDatabase): Effect.fn.Return<void, ApplicationActivationError> {
    const schemaNameRows = yield* Effect.uninterruptible(query(database.select({ schemaName: sql<string>`current_schema()` })
      .from(sql`(values (1)) as schema_input(value)`), "activate"));
    const schemaName = schemaNameRows[0]?.schemaName;
    if (schemaName === undefined) return yield* activationFailure("activate", "storedState");
    let cursor: typeof fxSystemApplicationActiveHeads.$inferSelect.scopeId | undefined;
    for (;;) {
      const heads = yield* Effect.uninterruptible(query(database.select({ scopeId: fxSystemApplicationActiveHeads.scopeId }).from(fxSystemApplicationActiveHeads)
        .where(cursor === undefined ? undefined : gt(fxSystemApplicationActiveHeads.scopeId, cursor))
        .orderBy(asc(fxSystemApplicationActiveHeads.scopeId)).limit(64), "activate"));
      if (heads.length === 0) return;
      for (const selected of heads) {
        // Settle every foreign read/publication for one finite head before
        // cancellation can leave maintenance. The next head is interruptible.
        cursor = yield* Effect.uninterruptible(Effect.gen(function* () {
          const currentHeads = yield* query(database.select().from(fxSystemApplicationActiveHeads)
            .where(eq(fxSystemApplicationActiveHeads.scopeId, selected.scopeId)).limit(1), "activate");
          const row = currentHeads[0];
          if (row === undefined) return yield* activationFailure("activate", "storedState");
          const head = yield* decodeHead(row, "activate");
          const activations = yield* query(database.select().from(fxSystemApplicationActivations).where(and(
            eq(fxSystemApplicationActivations.scopeId, row.scopeId),
            eq(fxSystemApplicationActivations.activationSequence, row.activationSequence))).limit(1), "activate", row.revisionId);
          const activationRow = activations[0];
          if (activationRow === undefined) return yield* activationFailure("activate", "storedState", row.revisionId);
          yield* decodeActivation(activationRow, "activate", row.revisionId);
          const readinessRows = row.readinessContractVersion === 1
            ? yield* query(database.select().from(fxSystemApplicationReadinessV1).where(and(
                eq(fxSystemApplicationReadinessV1.scopeId, row.scopeId), eq(fxSystemApplicationReadinessV1.revisionId, row.revisionId))).limit(1), "activate", row.revisionId)
            : yield* query(database.select().from(fxSystemApplicationReadiness).where(and(
                eq(fxSystemApplicationReadiness.scopeId, row.scopeId), eq(fxSystemApplicationReadiness.revisionId, row.revisionId))).limit(1), "activate", row.revisionId);
          const parent = readinessRows[0];
          if (parent === undefined) return yield* activationFailure("activate", "storedState", row.revisionId);
          const readiness = "schemaBindingSha256" in parent
            ? { kind: "legacy", schemaBindingSha256: encodeBytesToLowercaseHex(parent.schemaBindingSha256) }
            : { kind: row.readinessContractVersion === 3 ? "policy" : "relation",
                manifestSchemaBindingSha256: encodeBytesToLowercaseHex(parent.manifestSchemaBindingSha256),
                boundPublicationSha256: encodeBytesToLowercaseHex(parent.boundPublicationSha256),
                relationFrontierCommitSeq: parent.relationFrontierCommitSeq.toString(),
                relationSetReadinessSha256: encodeBytesToLowercaseHex(parent.relationSetReadinessSha256), relationCount: parent.relationCount,
                ...(head.readinessContractVersion === 3 ? { writePolicySetSha256: head.writePolicySetSha256,
                  writeOwnershipSha256: head.writeOwnershipSha256 } : {}) };
          const canonical = yield* canonicalStandaloneApplicationBinding({ format: "flarex.application.read-binding",
            deploymentId: parent.deploymentId, scopeId: row.scopeId, storageGeneration: parent.storageGeneration,
            storageGenerationFence: parent.storageGenerationFence.toString(), epoch: parent.epoch,
            activationSequence: row.activationSequence.toString(), headSha256: encodeBytesToLowercaseHex(row.headSha256),
            activationSha256: encodeBytesToLowercaseHex(row.activationSha256), revisionId: row.revisionId,
            schemaVersionId: parent.schemaVersionId, applicationSchemaSha256: encodeBytesToLowercaseHex(parent.applicationSchemaSha256),
            schemaManifestSha256: encodeBytesToLowercaseHex(parent.schemaManifestSha256), readinessSha256: encodeBytesToLowercaseHex(parent.readinessSha256),
            readiness, analysis: { candidateId: parent.candidateId, analysisId: parent.analysisId,
              manifestSha256: encodeBytesToLowercaseHex(parent.manifestSha256), sourceArtifactRootSha256: encodeBytesToLowercaseHex(parent.sourceArtifactRootSha256) } })
            .pipe(Effect.mapError(cause => activationError("activate", cause.reason, row.revisionId, false, cause)));
          yield* query(database.select({ published: sql<null>`${sql.identifier(schemaName)}.fx_publish_application_read_binding(
            ${canonical.bytes}::bytea, ${canonical.sha256}::bytea)` }).from(sql`(values (1)) as publication_input(value)`), "activate", row.revisionId);
          return row.scopeId;
        }));
      }
    }
  },
);

const readActiveLegacyInTransaction = Effect.fn(
  "ApplicationActivation.readLegacyTransaction",
)(
function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  readinessRepository: unknown,
  readiness: ApplicationReadinessResult,
) {
  const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(
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
  const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(
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
  switch (canonical.manifest.version) {
    case 1: return "legacy";
    case 2: return "relation";
    case 3: return "relation";
  }
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
  if (validated.kind === "relation" && validated.basis.writeOwnership !== null) {
    return Object.freeze({ kind: "policy", contractVersion: 3,
      readinessSha256: encodeBytesToLowercaseHex(validated.basis.readinessSha256),
      relationSetReadinessSha256: encodeBytesToLowercaseHex(validated.basis.relationSetReadinessSha256), relationCount: validated.basis.relationCount,
      writePolicySetSha256: validated.basis.writeOwnership.frame.writePolicySetSha256,
      writeOwnershipSha256: validated.basis.writeOwnership.sha256Hex });
  }
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
  if (decoded.readinessKind === "relation" && decoded.readinessContractVersion === 3 &&
    decoded.writePolicySetSha256 !== null && decoded.writeOwnershipSha256 !== null) {
    return Object.freeze({ kind: "policy", contractVersion: 3,
      readinessSha256: encodeBytesToLowercaseHex(decoded.readinessSha256),
      relationSetReadinessSha256: encodeBytesToLowercaseHex(decoded.relationSetReadinessSha256), relationCount: decoded.relationCount,
      writePolicySetSha256: decoded.writePolicySetSha256, writeOwnershipSha256: decoded.writeOwnershipSha256 });
  }
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
    activation.readinessContractVersion !== (validated.kind === "legacy" ? 1 : validated.basis.manifest.version) ||
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
    head.readinessContractVersion !== (validated.kind === "legacy" ? 1 : validated.basis.manifest.version) ||
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
  point: "activationInserted" | "maintenanceClosed" | "maintenanceOpened" | "headWritten",
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

/** The admitted selection retains its exact catalog composition; target metadata is not a fallback catalog. */
export const readApplicationSelectionOwnershipInTransaction = Effect.fn("ApplicationActivation.readOwnership")(function* (
  selection: ApplicationActiveSelection, tx: AppRowTransaction, scopeId: TrustedScopeAuthority["scopeId"], budget: ApplicationWriteOwnershipHistoryBudget,
  targetDatabase: FlarexMetadataDatabase,
) {
  const state = selectionStates.get(selection);
  if (state?.kind !== "relation" || state.basis.authority.scopeId !== scopeId) return yield* Effect.fail(new ApplicationWriteOwnershipError({ reason: "invalidEvidence" }));
  return yield* readApplicationRelationOwnershipInTransaction(state.readinessRepository, tx, scopeId, budget, undefined, undefined, targetDatabase);
});
