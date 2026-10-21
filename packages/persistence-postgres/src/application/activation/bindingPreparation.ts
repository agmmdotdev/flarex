import {
  captureHostPreparationLifetime,
  chargeHostPreparation,
  registerHostPreparationDisposal,
} from "../../execution/preparation/preparedHostRuntime";
import {
  acquireProtectedMetadataInstallationAdmission,
} from "../../execution/preparation/preparedMetadataEpoch";
import {
  hasLocatedReadCommittedTargetDatabaseV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../../database/locatedTransactionIdentity";
import {
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityResolutionPorts,
} from "../../scope/scopeAuthorityResolution";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../../scope/scopeClock";
import { prepareApplicationActiveHeadStructure } from "../activeHead/identity";
import { fxSystemApplicationActiveHeads } from "../applicationActivationSchema";
import type { ApplicationSchemaAuthorityPublisher } from "../applicationSchemaAuthority";
import type { FlarexMetadataDatabase } from "../deployments";
import type {
  ApplicationReadinessProtection,
  ApplicationReadinessRepository,
} from "../readiness/contracts";
import { ApplicationReadinessError } from "../readiness/errors";
import {
  hasApplicationReadinessComposition,
  readApplicationReadinessPreparationProtection,
  readApplicationReadinessTargetProtection,
} from "../readiness/identity";
import {
  captureApplicationReadinessInTransaction,
  hasApplicationReadinessPlanningComposition,
  prepareCapturedApplicationReadiness,
} from "../readiness/preparation";
import {
  type ApplicationRelationReadinessFoldRepository,
  type ApplicationRelationReadinessFoldResult,
  hasApplicationRelationReadinessFoldComposition,
  lendPreparedApplicationRelationInputs,
  prepareApplicationRelationActiveRead,
  type ReadApplicationRelationReadinessFoldError,
  readPreparedApplicationRelationInputs,
} from "../relations/applicationRelationReadinessFold";
import { headMatchesValidatedReadiness } from "./capture";
import type {
  ApplicationActivationContext,
  ApplicationRelationActivationContext,
} from "./constructionContracts";
import {
  type ApplicationActivationRepository,
  type ApplicationRelationActivationRepository,
  type ApplicationActiveSelection,
  type ApplicationBindingInput,
  type ApplicationBindingPreparation,
  bindingPreparationBrand,
  type PreparedApplicationBinding,
} from "./contracts";
import { query, runLocatedTransaction } from "./databaseBoundary";
import { activationError, activationFailure, type ApplicationActivationError } from "./errors";
import { decodeHead } from "./headCapture";
import { MAX_FRAME_BYTES, validIdentity } from "./limits";
import { readApplicationActivationRepositoryState } from "./repositoryIdentity";
import {
  closeLegacyApplicationBindingPreparation,
  closeRelationApplicationBindingPreparation,
  copySelectionBasis,
  readApplicationBindingTargetProtection,
  readRelationApplicationBindingPreparation,
  registerApplicationBindingHeadPreparation,
  registerLegacyApplicationBindingPreparation,
  registerRelationApplicationBindingPreparation,
} from "./selectionIdentity";
import { copyBytes } from "@flarex/utils/bytes";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { Effect, Result } from "effect";

export const readApplicationBindingPreparationInputs = Effect.fn("ApplicationActivation.readBindingPreparationInputs")(
  function* (input: ApplicationBindingInput, controlDb: FlarexMetadataDatabase) {
  const state = readRelationApplicationBindingPreparation(input);
  if (state === undefined) return yield* activationFailure("validateSelection", "invalidComposition");
  yield* Effect.fromResult(readApplicationBindingTargetProtection(input));
    const inputs = yield* readPreparedApplicationRelationInputs(state.readiness, controlDb);
    return Object.freeze({ ...inputs, scopeId: state.authority.scopeId });
  },
);

export const lendApplicationBindingPreparationInputs = Effect.fn("ApplicationActivation.lendBindingPreparationInputs")(
  function* (input: ApplicationBindingInput, controlDb: FlarexMetadataDatabase): Effect.fn.Return<
    Effect.Success<ReturnType<typeof lendPreparedApplicationRelationInputs>>,
    ApplicationActivationError | Effect.Error<ReturnType<typeof lendPreparedApplicationRelationInputs>>> {
    const state = readRelationApplicationBindingPreparation(input);
    if (state === undefined) return yield* activationFailure("validateSelection", "invalidComposition");
    yield* Effect.fromResult(readApplicationBindingTargetProtection(input));
    return yield* lendPreparedApplicationRelationInputs(state.readiness, controlDb);
  });

export function hasApplicationActivationPlanningComposition(
  repository: ApplicationActivationRepository<unknown, unknown> | ApplicationRelationActivationRepository<unknown, unknown>,
  controlDb: FlarexMetadataDatabase,
  schema: ApplicationSchemaAuthorityPublisher<unknown>,
  authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >,
): boolean {
  const state = readApplicationActivationRepositoryState(repository);
  return state !== undefined && state.authority === authority &&
    state.controlDatabase === controlDb &&
    hasApplicationReadinessPlanningComposition(
      state.nativeReadiness,
      controlDb,
      schema,
      authority,
    );
}

export function makeActivePreparationReader<SchemaFailure, ColdFailure>(captured: ApplicationActivationContext<SchemaFailure, ColdFailure>) {
  return Effect.fn("ApplicationActivation.captureActive")(function* (profile: "request" | "retained", allowRelation: boolean,
    preparationProfile: "full" | "finiteEntry" = "full", originalGenerationProtection?: ApplicationReadinessProtection) {
    if (!validIdentity(captured.deploymentId) || !hasApplicationReadinessComposition(
      captured.readiness, captured.authority)) return yield* activationFailure("read", "invalidComposition");
    const lifetime = profile === "retained" ? yield* captureHostPreparationLifetime() : undefined;
    const protection = Result.getOrElse(
      readApplicationReadinessPreparationProtection(captured.readiness),
      () => undefined,
    );
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
    const prepared = yield* prepareCapturedApplicationReadiness(captured.readiness, raw.readiness, preparationProfile, originalGenerationProtection).pipe(
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
      readiness: prepared.readiness, schema: prepared.schema, originalControl: prepared.originalControl, lifetime });
  });
}

export type ActivePreparation = Extract<Effect.Success<ReturnType<ReturnType<typeof makeActivePreparationReader>>>, { readonly kind: "legacy" }>;

export function mapPreparationReadinessError<E>(profile: "request" | "retained", error: E): E | ApplicationReadinessError {
  return profile === "request" && error instanceof ApplicationReadinessError
    ? new ApplicationReadinessError({ operation: "readReady", reason: error.reason, retryable: error.retryable,
      ...("cause" in error ? { cause: error.cause } : {}) }) : error;
}

export function installBindingHeadPreparation(token: ApplicationActiveSelection | PreparedApplicationBinding, prepared: ActivePreparation): void {
  const protection = readApplicationReadinessTargetProtection(prepared.readinessRepository, prepared.readiness);
  if (protection !== undefined) registerApplicationBindingHeadPreparation(token, prepareApplicationActiveHeadStructure(
    protection, prepared.lifetime?.charge, prepared.basis));
}

export const issueLegacyBindingPreparation = Effect.fn("ApplicationActivation.issueLegacyBindingPreparation")(function* (prepared: ActivePreparation) {
  // SAFETY: the inert handle is recognized only by its issuer-owned registry.
  const token = Object.freeze({}) as PreparedApplicationBinding;
  registerLegacyApplicationBindingPreparation(token, Object.freeze({ kind: "legacy", basis: copySelectionBasis(prepared.basis),
    readinessRepository: prepared.readinessRepository, readiness: prepared.readiness, lifetime: prepared.lifetime }));
  if (prepared.lifetime !== undefined) {
    installBindingHeadPreparation(token, prepared);
    yield* registerHostPreparationDisposal(() => {
      closeLegacyApplicationBindingPreparation(token);
    }).pipe(Effect.mapError(cause => activationError("read", "resourceFailure", prepared.basis.revisionId, false, cause)));
  }
  return token;
});

export const loadReadyForActiveRead = Effect.fn(
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

export const loadRelationReadyForActiveRead = Effect.fn(
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

export function makeLegacyBindingPreparationReader<SchemaFailure, ColdFailure>(_captured: ApplicationActivationContext<SchemaFailure, ColdFailure>, prepare: ReturnType<typeof makeActivePreparationReader>) {
  return Effect.fn("ApplicationActivation.prepareLegacyBinding")(function* (profile: "request" | "retained",
    originalGenerationProtection?: ApplicationReadinessProtection) {
    const prepared = yield* prepare(profile, false, "full", originalGenerationProtection);
    if (prepared.kind !== "legacy") return yield* activationFailure("read", "activeMissing");
    return yield* issueLegacyBindingPreparation(prepared);
  });
}

export function hasExactCompositeApplicationActivationComposition(captured: ApplicationRelationActivationContext<unknown, unknown>): boolean {
  return hasApplicationReadinessComposition(
      captured.readiness,
      captured.authority,
    ) && hasApplicationRelationReadinessFoldComposition(
      captured.relationReadiness,
      captured.authority,
    );
}

export function makeCompositeBindingPreparationReader<SchemaFailure, ColdFailure>(captured: ApplicationRelationActivationContext<SchemaFailure, ColdFailure>, prepareActive: ReturnType<typeof makeActivePreparationReader>) {
  return Effect.fn("ApplicationActivation.prepareCompositeBinding")(
    function* (profile: "request" | "retained", originalGenerationProtection?: ApplicationReadinessProtection) {
      if (!validIdentity(captured.deploymentId) || !hasExactCompositeApplicationActivationComposition(captured)) return yield* activationFailure("read", "invalidComposition");
      const lifetime = profile === "retained" ? yield* captureHostPreparationLifetime() : undefined;
      const prepared = yield* prepareActive(profile, true, "full", originalGenerationProtection);
      if (prepared.kind === "legacy") return yield* issueLegacyBindingPreparation(prepared);
      const readiness = yield* prepareApplicationRelationActiveRead(captured.relationReadiness,
        { deploymentId: captured.deploymentId, scopeId: captured.scopeId, revisionId: prepared.revisionId }, profile);
      if (lifetime !== undefined) yield* chargeHostPreparation({ authority: prepared.authority, revisionId: prepared.revisionId }).pipe(
        Effect.mapError(cause => activationError("read", "resourceFailure", prepared.revisionId, false, cause)),
      );
      const token: ApplicationBindingPreparation = Object.freeze({ [bindingPreparationBrand]: true as const });
      registerRelationApplicationBindingPreparation(token, Object.freeze({ authority: prepared.authority, revisionId: prepared.revisionId, readiness, lifetime }));
      if (lifetime !== undefined) yield* registerHostPreparationDisposal(() => { closeRelationApplicationBindingPreparation(token); }).pipe(
        Effect.mapError(cause => activationError("read", "resourceFailure", prepared.revisionId, false, cause)));
      return token;
    },
  );
}
