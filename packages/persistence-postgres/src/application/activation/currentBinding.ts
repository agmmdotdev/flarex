import { observeExecution } from "../../execution/diagnostics/operation";
import {
  captureHostPreparationLifetime,
  type PreparedHostGeneration,
  PreparedHostRuntimeError,
} from "../../execution/preparation/preparedHostRuntime";
import {
  acquireProtectedMetadataInstallationAdmission,
  authenticateProtectedTargetMetadataSnapshot,
  hasProtectedMetadataFinalGuardScope,
  openProtectedMetadataFinalGuardScope,
  type ProtectedTargetMetadataEvidence,
} from "../../execution/preparation/preparedMetadataEpoch";
import type {
  PointMutationSessionAuthorityResolutionPortsV1,
} from "../../execution/session/constructionContracts";
import {
  hasLocatedReadCommittedTargetDatabaseV1,
} from "../../database/locatedTransactionIdentity";
import {
  closeInstallationAdmission,
  type PreparedCoLocatedReadInstallation,
} from "../../installation/installationLifecycle";
import { prepareInstalledPlacementAuthority } from "../../scope/scopeAuthorityControlRead";
import {
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  resolveTrustedScopeAuthoritySnapshotResult,
  type TrustedScopeAuthority,
  type TrustedScopeSelection,
} from "../../scope/scopeAuthorityResolution";
import {
  lockScopeClockForOrdinaryWriteInTransactionEffect,
  lockScopeClockForSnapshotReadInTransactionEffect,
  lockScopeClockForUpdateInTransactionEffect,
} from "../../scope/scopeClock";
import {
  captureAppSchemaCandidateWriteGuardPlanningHeadInTransactionEffect,
  readAppSchemaCandidateWriteGuardPlanningHeadIdentity,
} from "../../storage/catalog/appSchemaCandidateValidation";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import type { CheckedApplicationActiveHead } from "../activeHead/contracts";
import {
  readCheckedApplicationActiveHead,
  releaseCheckedApplicationActiveHead,
} from "../activeHead/identity";
import { readCheckedApplicationActiveHeadForShareInTransactionEffect } from "../applicationActiveHeadRead";
import type { FlarexMetadataDatabase } from "../deployments";
import { lendPreparedApplicationRelationInputs } from "../relations/applicationRelationReadinessFold";
import { headMatchesBasis } from "./bindingAcceptance";
import type {
  ApplicationBindingInput,
  ApplicationBindingSelectionReader,
  CurrentApplicationEntry,
  CurrentApplicationFiniteEntry,
  CurrentApplicationGenerationContext,
  CurrentApplicationPreparation,
  CurrentApplicationPreparationRefresh,
} from "./contracts";
import { borrowCurrentApplicationFiniteEntry } from "./currentEntryIdentity";
import { query, runLocatedTransaction } from "./databaseBoundary";
import {
  activationError,
  activationFailure,
  type ApplicationActivationError,
  type CurrentApplicationPreparationFailure,
} from "./errors";
import {
  readApplicationActivationRepositoryState,
  readApplicationBindingPreparationReader,
} from "./repositoryIdentity";
import {
  attachCurrentApplicationBindingMetadata,
  clockMatches,
  readApplicationBindingTargetProtection,
  readLegacyApplicationBindingPreparation,
  readRelationApplicationBindingPreparation,
  type RetainedBindingMetadata,
} from "./selectionIdentity";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { sql } from "drizzle-orm";
import { Cause, Effect, Result, Semaphore } from "effect";

export const protectedMetadataEpochKey = (evidence: ProtectedTargetMetadataEvidence) => [evidence.epoch.databaseName,
  evidence.epoch.namespaceOid.toString(), evidence.epoch.incarnation, evidence.epoch.generation.toString(), evidence.epoch.login];

export const prepareCurrentApplicationBinding = Effect.fnUntraced(
  function* <ReaderFailure, Payload, ConstructionFailure, ConstructionRequirements>(
    repository: ApplicationBindingSelectionReader<ReaderFailure>, database: FlarexMetadataDatabase,
    construct: (binding: ApplicationBindingInput, context: CurrentApplicationGenerationContext) =>
      Effect.Effect<Payload, ConstructionFailure, ConstructionRequirements>,
    options: Readonly<{ selection: TrustedScopeSelection; installation?: PreparedCoLocatedReadInstallation | undefined;
      candidateIssuer?: PointMutationSessionAuthorityResolutionPortsV1 }>,
  ): Effect.fn.Return<CurrentApplicationPreparation<Payload, ConstructionFailure, ConstructionRequirements>,
    ConstructionFailure | CurrentApplicationPreparationFailure, ConstructionRequirements> {
    const selection = Object.freeze({ ...options.selection });
    const owner = readApplicationActivationRepositoryState(repository);
    const prepare = readApplicationBindingPreparationReader(repository);
    const lifetime = yield* captureHostPreparationLifetime();
    if (owner === undefined || prepare === undefined || lifetime === undefined || owner.controlDatabase === undefined)
      return yield* activationFailure("read", "invalidComposition");
    const controlDatabase = owner.controlDatabase;
    const requireOpen = () => Effect.fromResult(lifetime.checkOpen()).pipe(Effect.mapError(cause =>
      activationError("read", "resourceFailure", undefined, false, cause)));
    const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(selection, owner.authority);
    // Resolve the trusted requested scope first so its own provisioning and
    // placement refusal wins. A valid peer cannot select this repository's graph.
    if (selection.deploymentId !== owner.deploymentId || selection.scopeId !== owner.scopeId)
      return yield* activationFailure("read", "invalidComposition");
    if (!hasLocatedReadCommittedTargetDatabaseV1(located.target, database))
      return yield* activationFailure("read", "invalidComposition");
    const placement = options.installation === undefined ? undefined : yield* Effect.fromResult(
      prepareInstalledPlacementAuthority(options.installation, database, located.authority.physicalLocator)).pipe(
        Effect.mapError(cause => activationError("read", "invalidComposition", undefined, false, cause)));
    const controls = placement === undefined ? undefined : yield* query(controlDatabase.select({
      databaseName: sql<string>`current_database()`, namespaceOid: sql<string>`current_schema()::pg_catalog.regnamespace::oid::text`,
    }).from(sql`(values (1)) as control_identity(value)`).limit(1), "read");
    const controlIdentity = controls?.[0];
    if (placement !== undefined && controlIdentity === undefined) return yield* activationFailure("read", "invalidComposition");
    const slot = Object.freeze({});
    const gate = yield* Semaphore.make(1);
    const readPlacement = (tx: AppRowTransaction) => Effect.gen(function* () {
      return placement === undefined ? undefined : yield* Effect.gen(function* () {
        const rows = yield* query(tx.select(placement.fields).from(placement.source).limit(2).execute(selection), "read");
        if (rows.length !== 1 || rows[0] === undefined) return yield* activationFailure("read", "scopeAuthority");
        const value = yield* placement.accept(tx, selection, rows[0]).pipe(Effect.mapError(cause =>
          activationError("read", "scopeAuthority", undefined, false, cause)));
        if (controlIdentity === undefined || value.control.epoch.databaseName !== controlIdentity.databaseName ||
          value.control.epoch.namespaceOid.toString() !== controlIdentity.namespaceOid)
          return yield* activationFailure("read", "invalidComposition");
        return value;
      });
    });
    const probe = (tx: AppRowTransaction, onIssued: (checked: CheckedApplicationActiveHead) => void,
      metadata: Effect.Success<ReturnType<typeof readPlacement>>, clockAccess: "snapshotRead" | "ordinaryWrite" | "update" = "snapshotRead",
      fullProofAuthority: TrustedScopeAuthority = located.authority) =>
      observeExecution("ApplicationActivation.observeCurrentPreparation", Effect.gen(function* () {
      const clock = yield* (clockAccess === "update" ? lockScopeClockForUpdateInTransactionEffect(tx, selection.scopeId) :
        clockAccess === "ordinaryWrite" ? lockScopeClockForOrdinaryWriteInTransactionEffect(tx, selection.scopeId) :
          lockScopeClockForSnapshotReadInTransactionEffect(tx, selection.scopeId));
      const authority = metadata === undefined ? fullProofAuthority : yield* Effect.fromResult(
        resolveTrustedScopeAuthoritySnapshotResult(selection, metadata.scope, metadata.receipt, located.authority.physicalLocator, clock));
      if (!clockMatches(authority, clock)) return yield* activationFailure("read", "scopeAuthority");
      const observed = yield* readCheckedApplicationActiveHeadForShareInTransactionEffect(tx, clock, onIssued);
      if (observed === null) return yield* activationFailure("read", "activeMissing");
      const head = observed.head;
      const planningHead = options.candidateIssuer === undefined ? undefined :
        yield* captureAppSchemaCandidateWriteGuardPlanningHeadInTransactionEffect(tx, authority, options.candidateIssuer);
      const candidateKey = planningHead === undefined || options.candidateIssuer === undefined ? undefined :
        yield* readAppSchemaCandidateWriteGuardPlanningHeadIdentity(planningHead, options.candidateIssuer);
      const key = JSON.stringify([selection.deploymentId, selection.scopeId, authority.physicalLocator,
        authority.storageGeneration, authority.storageGenerationFence.toString(), authority.epoch,
        head.activationSequence.toString(), head.revisionId, head.readinessKind,
        encodeBytesToLowercaseHex(head.headSha256), encodeBytesToLowercaseHex(head.activationSha256),
        encodeBytesToLowercaseHex(head.readinessSha256), metadata === undefined ? null : protectedMetadataEpochKey(metadata.target),
        metadata === undefined ? null : protectedMetadataEpochKey(metadata.control), candidateKey]);
      return Object.freeze({ key, head, authority, clock, planningHead, candidateKey, metadata, checked: observed.checked });
    }));
    const observe = (fullProofAuthority: TrustedScopeAuthority) => {
      let checked: CheckedApplicationActiveHead | undefined;
      return runLocatedTransaction(located.target, "read", undefined, tx => readPlacement(tx).pipe(
        Effect.flatMap(metadata => probe(tx, issued => { checked = issued; }, metadata, "snapshotRead", fullProofAuthority)),
        Effect.ensuring(Effect.sync(() => { releaseCheckedApplicationActiveHead(checked); closeInstallationAdmission(tx); }))));
    };
    type Observation = Effect.Success<ReturnType<typeof probe>>;
    type Graph = Readonly<{ binding: ApplicationBindingInput; payload: Payload; key: string; candidateKey: string | undefined }>;
    let current: Readonly<{ key: string; generation: PreparedHostGeneration<Graph> }> | undefined;
    let fixedSchema: string | undefined;
    const schemaIdentity = (binding: ApplicationBindingInput) => observeExecution("ApplicationActivation.currentBindingSchema", Effect.gen(function* () {
      const legacy = readLegacyApplicationBindingPreparation(binding);
      if (legacy !== undefined) return JSON.stringify([legacy.basis.schemaVersionId,
        encodeBytesToLowercaseHex(legacy.basis.schemaManifestSha256), legacy.basis.runtimeHostIdentity, legacy.basis.compatibilityDate, "legacy", null]);
      const relation = readRelationApplicationBindingPreparation(binding);
      if (relation === undefined) return yield* activationFailure("read", "invalidComposition");
      const inputs = yield* lendPreparedApplicationRelationInputs(relation.readiness, controlDatabase);
      return JSON.stringify([inputs.schema.schemaVersionId, inputs.schema.schemaManifestSha256,
        "relation", inputs.schema.writePolicy?.writePolicySetSha256 ?? null]);
    }));
    const stage = (before: Observation, fullProofAuthority: TrustedScopeAuthority) => lifetime.stage(Effect.gen(function* () {
      const binding = yield* prepare("retained", before.metadata);
      const schema = yield* schemaIdentity(binding);
      if (fixedSchema !== undefined && fixedSchema !== schema) return yield* activationFailure("read", "invalidComposition");
      let constructionOpen = true;
      if (placement !== undefined) {
        const metadata = before.metadata;
        if (metadata === undefined) return yield* activationFailure("read", "invalidComposition");
        const retained: RetainedBindingMetadata = Object.freeze({ slot, key: before.key, target: metadata.target, control: metadata.control,
          get constructionOpen() { return constructionOpen; } });
        yield* Effect.fromResult(attachCurrentApplicationBindingMetadata(binding, retained));
      }
      // Constructors borrow the original paired anchors above. The complete
      // after observation brackets their metadata work before publishing this
      // generation; a racing writer discards the whole staged graph.
      const payload = yield* Effect.suspend(() => construct(binding, { authority: before.authority, planningHead: before.planningHead })).pipe(
        Effect.onExit(() => Effect.sync(() => { constructionOpen = false; })));
      const after = yield* observe(fullProofAuthority);
      if (before.key !== after.key) return yield* activationFailure("read", "concurrentHead");
      fixedSchema ??= schema;
      return Object.freeze({ binding, payload, key: after.key, candidateKey: after.candidateKey });
    })).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error => error instanceof PreparedHostRuntimeError
      ? activationError("read", "resourceFailure", undefined, false, error) : error))));
    const replace = (observation: Observation, fullProofAuthority: TrustedScopeAuthority) => Effect.uninterruptibleMask(restore => restore(stage(observation, fullProofAuthority)).pipe(
      Effect.flatMap(generation => Effect.gen(function* () {
        const previous = current;
        current = Object.freeze({ key: observation.key, generation });
        if (previous !== undefined) yield* previous.generation.retire;
        return generation;
      }))));
    const acquireFreshFinitePreparation: CurrentApplicationPreparation<Payload, ConstructionFailure, ConstructionRequirements>["acquireFreshFinitePreparation"] = Effect.gen(function* () {
      yield* requireOpen();
      const liveLocation = placement === undefined ? yield* resolveLocatedTrustedScopeAuthorityByIdEffect(selection, owner.authority) : located;
      if (!hasLocatedReadCommittedTargetDatabaseV1(liveLocation.target, database))
        return yield* activationFailure("read", "invalidComposition");
      const observation = yield* observe(liveLocation.authority);
      return yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
        yield* restore(gate.take(1));
        return yield* Effect.gen(function* () {
          if (current?.key !== observation.key) yield* restore(replace(observation, liveLocation.authority));
          const generation = current?.generation;
          if (generation === undefined) return yield* activationFailure("read", "invalidComposition");
          // Register the existing generation borrow in the caller's Scope before
          // releasing the gate; a concurrent refresh may then retire it safely.
          return yield* generation.acquire;
        }).pipe(Effect.ensuring(gate.release(1)));
      }));
    });
    // This callback lifecycle boundary must preserve the exact original full Cause.
    const withEntry = Effect.fnUntraced(function* <Value, E, R>(work: (
      graph: Graph, enter: CurrentApplicationEntry, finite: CurrentApplicationFiniteEntry,
    ) => Effect.Effect<Result.Result<Value, CurrentApplicationPreparationRefresh>, E, R>):
      Effect.fn.Return<Value, E | ConstructionFailure | CurrentApplicationPreparationFailure, R | ConstructionRequirements> {
      yield* requireOpen();
      let replacement: Observation | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        // Full proof resolves current control authority independently for every
        // actual entry, including an internal pre-business refresh attempt.
        const liveLocation = placement === undefined ? yield* resolveLocatedTrustedScopeAuthorityByIdEffect(selection, owner.authority) : located;
        if (!hasLocatedReadCommittedTargetDatabaseV1(liveLocation.target, database))
          return yield* activationFailure("read", "invalidComposition");
        if (replacement !== undefined) {
          const next = replacement;
          yield* gate.withPermits(1)(Effect.suspend(() => current?.key === next.key ? Effect.void :
            replace(next, liveLocation.authority).pipe(Effect.asVoid)));
        }
        let refresh: Readonly<{ token: CurrentApplicationPreparationRefresh; observation: Observation }> | undefined;
        const run = (graph: Graph) => {
          let entryOpen = true;
          let entered = false;
          let nativeRefresh: ApplicationActivationError | undefined;
          const finite = borrowCurrentApplicationFiniteEntry(graph.binding,
            (tx, clock, checked, observation, changedEpoch) => Effect.gen(function* () {
              if (!entryOpen || entered) return yield* activationFailure("validateSelection", "invalidComposition");
              entered = true;
              yield* requireOpen();
              const selected = readLegacyApplicationBindingPreparation(graph.binding);
              if (selected === undefined || !clockMatches(selected.basis.authority, clock))
                return yield* activationFailure("validateSelection", "scopeAuthority");
              const active = yield* Effect.fromResult(readCheckedApplicationActiveHead(checked, tx, clock));
              if (active === "refresh") return yield* activationFailure("validateSelection", "invalidComposition");
              const planningHead = options.candidateIssuer === undefined ? undefined :
                yield* captureAppSchemaCandidateWriteGuardPlanningHeadInTransactionEffect(tx,
                  { ...selected.basis.authority, ...clock }, options.candidateIssuer, observation);
              const candidateKey = planningHead === undefined || options.candidateIssuer === undefined ? undefined :
                yield* readAppSchemaCandidateWriteGuardPlanningHeadIdentity(planningHead, options.candidateIssuer);
              if (changedEpoch || !headMatchesBasis(active.head, selected.basis) || candidateKey !== graph.candidateKey) {
                nativeRefresh = activationError("validateSelection", "concurrentHead", selected.basis.revisionId);
                return yield* Effect.fail(nativeRefresh);
              }
            }));
          const enter: CurrentApplicationEntry = (tx, requireInstallation, beforeClock, business, clockAccess) => {
            let checked: CheckedApplicationActiveHead | undefined;
            return Effect.gen(function* () {
              if (!entryOpen || entered) return yield* activationFailure("validateSelection", "invalidComposition");
              entered = true;
              yield* requireOpen();
              if (placement === undefined) {
                yield* requireInstallation;
                // The fresh binding can retain protected metadata even when
                // this entry uses the full catalog proof profile. Authenticate
                // its original installation token on this actual transaction.
                const target = yield* Effect.fromResult(readApplicationBindingTargetProtection(graph.binding));
                if (target.protection !== undefined)
                  yield* acquireProtectedMetadataInstallationAdmission(target.protection.token, target.protection.database, tx);
              }
              if (!hasProtectedMetadataFinalGuardScope(tx)) openProtectedMetadataFinalGuardScope(tx);
              const metadata = yield* readPlacement(tx);
              // Installation acceptance precedes native settings and request
              // exclusion; those precede the scope clock and Application head.
              yield* beforeClock;
              const fresh = yield* probe(tx, issued => { checked = issued; }, metadata, clockAccess, liveLocation.authority);
              const retained = readLegacyApplicationBindingPreparation(graph.binding)?.currentPreparation ?? readRelationApplicationBindingPreparation(graph.binding)?.currentPreparation;
              if (placement !== undefined && (retained === undefined || retained.slot !== slot))
                return yield* activationFailure("validateSelection", "invalidComposition");
              if (graph.key !== fresh.key) {
                // SAFETY: only this lexical entry owner recognizes the verdict identity.
                const token = Object.freeze({}) as CurrentApplicationPreparationRefresh;
                refresh = Object.freeze({ token, observation: fresh });
                return Result.fail(token);
              }
              if (placement !== undefined && retained !== undefined) {
                yield* requireInstallation;
                yield* authenticateProtectedTargetMetadataSnapshot(retained.target, tx);
                yield* authenticateProtectedTargetMetadataSnapshot(retained.control, tx);
                yield* placement.registerFinalGuards(tx);
              }
              return yield* business({ authority: fresh.authority, clock: fresh.clock, checked: fresh.checked }).pipe(Effect.map(Result.succeed));
            }).pipe(Effect.ensuring(Effect.sync(() => releaseCheckedApplicationActiveHead(checked))));
          };
          return Effect.suspend(() => work(graph, enter, finite)).pipe(Effect.catchCause((cause): Effect.Effect<
            Result.Result<Value, CurrentApplicationPreparationRefresh>, E | Effect.Error<ReturnType<typeof observe>>> => {
            const reason = cause.reasons.length === 1 ? cause.reasons[0] : undefined;
            if (nativeRefresh === undefined || reason === undefined || !Cause.isFailReason(reason) || reason.error !== nativeRefresh)
              return Effect.failCause(cause);
            // The original native owner has already settled rollback. Only
            // immutable cold observations enter the next staged generation.
            return observe(liveLocation.authority).pipe(Effect.map(observation => {
              // SAFETY: this lexical owner alone recognizes the refresh identity.
              const token = Object.freeze({}) as CurrentApplicationPreparationRefresh;
              refresh = Object.freeze({ token, observation });
              return Result.fail(token);
            }));
          }), Effect.ensuring(Effect.sync(() => { entryOpen = false; finite.close(); })));
        };
        const outcome = yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
            yield* restore(gate.take(1));
            let held = true;
            return yield* Effect.gen(function* () {
              const generation = current?.generation;
              if (generation === undefined) return yield* activationFailure("read", "invalidComposition");
              return yield* generation.use(graph => Effect.gen(function* () {
                held = false;
                yield* gate.release(1);
                return yield* restore(run(graph));
              }));
            }).pipe(Effect.ensuring(Effect.suspend(() => held ? gate.release(1).pipe(Effect.asVoid) : Effect.void)));
          }));
        const decision = yield* Result.match(outcome, {
          onSuccess: value => Effect.succeed({ kind: "complete" as const, value }),
          onFailure: token => refresh === undefined || token !== refresh.token
            ? activationFailure("validateSelection", "invalidComposition")
            : Effect.succeed({ kind: "refresh" as const, observation: refresh.observation }),
        });
        if (decision.kind === "complete") return decision.value;
        if (attempt === 1) return yield* activationFailure("validateSelection", "concurrentHead");
        replacement = decision.observation;
      }
      return yield* Effect.die(new Error("Current preparation entry did not terminate"));
    });
    // Both profiles retain only original immutable construction. Full proof
    // still resolves live control authority and validates the complete catalog
    // and readiness at every actual transaction acceptance.
    yield* replace(yield* observe(located.authority), located.authority);
    const withFiniteEntry: CurrentApplicationPreparation<Payload, ConstructionFailure, ConstructionRequirements>["withFiniteEntry"] = work =>
      withEntry((graph, _enter, finite) => work(graph, finite).pipe(Effect.map(Result.succeed)));
    return Object.freeze({ withEntry, withFiniteEntry, acquireFreshFinitePreparation });
  },
  work => observeExecution("ApplicationActivation.prepareCurrentBinding", work),
);
