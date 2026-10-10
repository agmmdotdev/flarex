import {
  captureHostPreparationLifetime,
  registerHostPreparationDisposal,
} from "../../execution/preparation/preparedHostRuntime";
import {
  acquireProtectedMetadataInstallationAdmission,
  authenticateProtectedTargetMetadataSnapshot,
  captureProtectedMetadataEpoch,
  guardProtectedMetadataEpoch,
  hasProtectedMetadataFinalGuardScope,
  registerProtectedMetadataFinalGuard,
} from "../../execution/preparation/preparedMetadataEpoch";
import {
  hasLocatedReadCommittedTargetDatabaseV1,
} from "../../database/locatedTransactionIdentity";
import {
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  type TrustedScopeAuthority,
} from "../../scope/scopeAuthorityResolution";
import {
  lockScopeClockForSnapshotReadInTransactionEffect,
  type ScopeClockRecord,
} from "../../scope/scopeClock";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import {
  readStandaloneReadSnapshot,
  type StandaloneReadSnapshot,
} from "../../storage/documents/standaloneReadSnapshot";
import type { DecodedApplicationActiveHead } from "../activeHead/contracts";
import {
  fxSystemApplicationActivations,
  fxSystemApplicationActiveHeads,
  fxSystemApplicationReadBindings,
} from "../applicationActivationSchema";
import {
  decodeStandaloneApplicationBinding,
  type StandaloneApplicationBinding,
} from "../applicationStandaloneBinding";
import {
  hasApplicationReadinessComposition,
  readApplicationReadinessPreparationProtection,
} from "../readiness/identity";
import type {
  ApplicationActivationContext,
  ApplicationStandaloneBindingContext,
} from "./constructionContracts";
import type {
  ApplicationStandaloneBindingSelectionReader,
  PreparedStandaloneApplicationBinding,
} from "./contracts";
import { query, runLocatedTransaction } from "./databaseBoundary";
import { activationError, activationFailure } from "./errors";
import { decodeActivation, decodeHead } from "./headCapture";
import { validIdentity } from "./limits";
import { registerStandaloneApplicationBindingPreparationReader } from "./repositoryIdentity";
import {
  clockMatches,
  closeStandaloneApplicationBindingPreparation,
  readPreparedStandaloneApplicationBinding,
  readStandaloneApplicationBindingPreparation,
  registerStandaloneApplicationBindingPreparation,
  registerStandaloneApplicationBindingSelectionReader,
} from "./selectionIdentity";
import { bytesEqualFullScan, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

export function makeApplicationStandaloneBindingSelectionReader(context: ApplicationStandaloneBindingContext): ApplicationStandaloneBindingSelectionReader {
  const captured = Object.freeze({ ...context, protectedMetadata: Object.freeze({ ...context.protectedMetadata }) });
  // SAFETY: this private registry, not token fields, authenticates the reader.
  const reader = Object.freeze({}) as ApplicationStandaloneBindingSelectionReader;
  registerStandaloneApplicationBindingSelectionReader(reader, captured);
  registerStandaloneApplicationBindingPreparationReader(reader, makeStandaloneBindingPreparationReader(captured));
  return reader;
}

export const acquireStandaloneApplicationBindingInstallation = Effect.fn("ApplicationActivation.acquireStandaloneInstallation")(
  function* (input: PreparedStandaloneApplicationBinding, tx: AppRowTransaction) {
    const state = readStandaloneApplicationBindingPreparation(input);
    if (state === undefined) return yield* activationFailure("validateSelection", "invalidComposition");
    yield* Effect.fromResult(readPreparedStandaloneApplicationBinding(input));
    yield* acquireProtectedMetadataInstallationAdmission(state.protection.token, state.protection.database, tx)
      .pipe(Effect.mapError(cause => activationError("validateSelection", "resourceFailure", state.frame.revisionId, false, cause)));
  },
);

export function makeLegacyStandaloneBindingPreparationReader(context: ApplicationActivationContext<unknown, unknown>) {
  return Effect.fn("ApplicationActivation.captureLegacyStandaloneBinding")(function* () {
    if (!hasApplicationReadinessComposition(context.readiness, context.authority))
      return yield* activationFailure("read", "invalidComposition");
    const protectedMetadata = yield* Effect.fromResult(readApplicationReadinessPreparationProtection(context.readiness));
    return yield* makeStandaloneBindingPreparationReader({ deploymentId: context.deploymentId, scopeId: context.scopeId,
      authority: context.authority, protectedMetadata })();
  });
}

export function makeStandaloneBindingPreparationReader(context: ApplicationStandaloneBindingContext) {
  return Effect.fn("ApplicationActivation.captureStandaloneBinding")(function* () {
    const lifetime = yield* captureHostPreparationLifetime();
    if (lifetime === undefined || !validIdentity(context.deploymentId))
      return yield* activationFailure("read", "invalidComposition");
    yield* Effect.fromResult(lifetime.checkOpen()).pipe(Effect.mapError(cause =>
      activationError("read", "resourceFailure", undefined, false, cause)));
    const protectedMetadata = context.protectedMetadata;
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
    registerStandaloneApplicationBindingPreparation(result, { authority: { ...located.authority, physicalLocator: { ...located.authority.physicalLocator } },
      frame, protection: { ...protectedMetadata, epoch: captured.epoch }, lifetime });
    yield* registerHostPreparationDisposal(() => { closeStandaloneApplicationBindingPreparation(result); }).pipe(
      Effect.mapError(cause => activationError("read", "resourceFailure", head.revisionId, false, cause)));
    return result;
  });
}

export function standaloneBindingMatchesHead(frame: StandaloneApplicationBinding, head: DecodedApplicationActiveHead): boolean {
  if (frame.scopeId !== head.scopeId || frame.revisionId !== head.revisionId || frame.activationSequence !== head.activationSequence.toString() ||
    frame.headSha256 !== encodeBytesToLowercaseHex(head.headSha256) || frame.activationSha256 !== encodeBytesToLowercaseHex(head.activationSha256) ||
    frame.readinessSha256 !== encodeBytesToLowercaseHex(head.readinessSha256)) return false;
  const readiness = frame.readiness;
  return head.readinessKind === "legacy" ? readiness.kind === "legacy" : readiness.kind !== "legacy" &&
    readiness.relationCount === head.relationCount && readiness.relationSetReadinessSha256 === encodeBytesToLowercaseHex(head.relationSetReadinessSha256) &&
    (head.readinessContractVersion === 2 ? readiness.kind === "relation" : readiness.kind === "policy" &&
      readiness.writeOwnershipSha256 === head.writeOwnershipSha256 && readiness.writePolicySetSha256 === head.writePolicySetSha256);
}

export const withStandaloneApplicationBindingInTransaction = Effect.fn("ApplicationActivation.withStandaloneBinding")(
  function* <Value, Failure, Requirements>(input: PreparedStandaloneApplicationBinding, tx: AppRowTransaction, clock: ScopeClockRecord,
    work: (state: { readonly frame: StandaloneApplicationBinding; readonly authority: TrustedScopeAuthority }) => Effect.Effect<Value, Failure, Requirements>) {
    const state = readStandaloneApplicationBindingPreparation(input);
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

export function standaloneApplicationHeadMatches(frame: StandaloneApplicationBinding,
  head: StandaloneReadSnapshot["applicationHead"] | undefined): boolean {
  return head !== undefined && head !== null && head.sequence.toString() === frame.activationSequence && head.revisionId === frame.revisionId &&
    head.readinessContractVersion === (frame.readiness.kind === "legacy" ? 1 : frame.readiness.kind === "relation" ? 2 : 3) &&
    encodeBytesToLowercaseHex(head.headSha256) === frame.headSha256 && encodeBytesToLowercaseHex(head.activationSha256) === frame.activationSha256 &&
    encodeBytesToLowercaseHex(head.readinessSha256) === frame.readinessSha256;
}