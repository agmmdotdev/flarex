import { Data, Effect, Option } from "effect";
import { sql } from "drizzle-orm";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { readApplicationBindingTargetProtection, type PreparedStandaloneApplicationBinding } from "../../../application/applicationActivation";
import { withStandaloneApplicationBindingEvidenceInTransaction } from "../../../application/applicationBindingProjection";
import type { FlarexMetadataDatabase } from "../../../application/deployments";
import { verifyPreparedLogicalSchemaBinding } from "../../../installation/frameworkSchema/binding/logicalSchema";
import type { DataBindingHeadToken } from "../../../installation/frameworkSchema/binding/model";
import { readBindingSelectedEvidence, prepareBindingSelectedStructure, type PreparedBindingSelectedStructure } from "../../../installation/frameworkSchema/binding/repository";
import type { PreparedInstallation } from "../../../installation/installationLifecycle";
import { prepareLogicalReadMetadata, LogicalReadMetadataError, type LogicalReadSourceRoot, type LogicalSourceReadPin } from "../logicalReadMetadata";
import { prepareLogicalReadDemand } from "../../catalog/logicalStorageReadiness";
import type { FlarexMetadataTransaction } from "../../../database/metadataTransaction";
import { runDrizzleStatementEffect } from "../../../database/drizzleStatementEffect";
import { openProtectedMetadataFinalGuardScope, closeProtectedMetadataFinalGuardScope,
  prepareProtectedMetadataFinalGuardBatch, acceptProtectedMetadataFinalGuardBatch } from "../../../execution/preparation/preparedMetadataEpoch";
import type { ScopeClockRecord } from "../../../scope/scopeClock";
import type { TrustedScopeAuthority } from "../../../scope/scopeAuthorityResolution";
import type { LogicalStorageReadDemand, LogicalStorageReadReadiness } from "./model";

export class LogicalReadAdmissionError extends Data.TaggedError("LogicalReadAdmissionError")<{
  readonly reason: "invalidInput" | "invalidAuthority" | "sourceMismatch" | "notReady" | "bindingMissing" | "unsupportedProfile" | "resourceFailure" | "closed";
  readonly cause?: unknown;
}> {}
const failure = (reason: LogicalReadAdmissionError["reason"], cause?: unknown) => new LogicalReadAdmissionError({ reason, cause });
const metadataFailure = (cause: LogicalReadMetadataError) => failure(
  cause.reason === "resourceFailure" || cause.reason === "closed" || cause.reason === "invalidInput" ? cause.reason : "sourceMismatch", cause);
export type ManagedLogicalReadPorts = Readonly<{ controlDb: FlarexMetadataDatabase; controlInstallation: PreparedInstallation }>;
export type LogicalReadSelection = Readonly<{ deploymentId: string; scopeId: ScopeId; schemaVersionId: CatalogSchemaVersionId }>;
declare const readAdmissionBrand: unique symbol;
export interface LogicalReadAdmission { readonly [readAdmissionBrand]: true }
export interface LogicalReadAdmissionState {
  readonly tx: FlarexMetadataTransaction;
  readonly authority: TrustedScopeAuthority;
  readonly clock: ScopeClockRecord;
  readonly head: DataBindingHeadToken;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly sourceKey: string;
  readonly sourceSha256: string;
  readonly defaultTableName: string;
  readonly root: LogicalReadSourceRoot;
  readonly readReadiness: Extract<LogicalStorageReadReadiness<LogicalReadAdmissionError>, { kind: "queryRequired" }>;
  readonly checkOpen: Effect.Effect<void, LogicalReadAdmissionError>;
}
const admissions = new WeakMap<object, LogicalReadAdmissionState>();

/** This token borrows only one live accepting callback, never write authority. */
export const requireLogicalReadAdmission = Effect.fn("LogicalReadAdmission.require")(function* (
  admission: LogicalReadAdmission, tx: FlarexMetadataTransaction,
) {
  const state = admissions.get(admission);
  if (state === undefined || state.tx !== tx) return yield* Effect.fail(failure("invalidAuthority"));
  yield* state.checkOpen;
  return state;
});

/** Query metadata has a protected control owner; Application and data-binding
 * acceptance remain with their existing target owners and original epoch. */
export const prepareLogicalReadAdmission = Effect.fn("LogicalReadAdmission.prepare")(function* (
  ports: ManagedLogicalReadPorts, input: LogicalReadSelection, pin: LogicalSourceReadPin,
  profile: "medusa" | "payload",
) {
  const captured = Object.freeze({ deploymentId: input.deploymentId, scopeId: input.scopeId, schemaVersionId: input.schemaVersionId });
  const metadata = yield* prepareLogicalReadMetadata(ports.controlDb, captured, pin, ports.controlInstallation)
    .pipe(Effect.mapError(metadataFailure));
  const root = metadata.root;
  if (root.owner !== profile || root.kind !== (profile === "medusa" ? "relational" : "documents"))
    return yield* Effect.fail(failure("sourceMismatch"));
  if (profile === "payload" && (root.contentIdentity === null || root.hasDocumentRelations))
    return yield* Effect.fail(failure("unsupportedProfile"));
  const demand = yield* prepareLogicalReadDemand(metadata).pipe(Effect.mapError(cause => failure("notReady", cause)));
  const checkOpen = metadata.checkOpen.pipe(Effect.mapError(metadataFailure));
  const targetPreparations = new WeakMap<object, PreparedBindingSelectedStructure>();
  const withReadAdmission = Effect.fn("LogicalReadAdmission.with")(function* <Value, Failure, Requirements>(
    application: PreparedStandaloneApplicationBinding, tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    work: (admission: LogicalReadAdmission) => Effect.Effect<Value, Failure, Requirements>,
  ) {
    yield* checkOpen;
    if (authority.deploymentId !== captured.deploymentId || authority.scopeId !== captured.scopeId ||
      clock.scopeId !== authority.scopeId || clock.epoch !== authority.epoch ||
      clock.storageGeneration !== authority.storageGeneration || clock.storageGenerationFence !== authority.storageGenerationFence)
      return yield* Effect.fail(failure("invalidAuthority"));
    const target = yield* Effect.fromResult(readApplicationBindingTargetProtection(application));
    if (target.protection === undefined) return yield* Effect.fail(failure("invalidAuthority"));
    let preparedTarget = targetPreparations.get(application);
    if (preparedTarget === undefined) {
      preparedTarget = yield* Effect.fromResult(prepareBindingSelectedStructure(authority, target.protection, target.lifetime));
      if (target.lifetime !== undefined) {
        targetPreparations.set(application, preparedTarget);
        yield* Effect.fromResult(target.lifetime.onDispose(() => { targetPreparations.delete(application); })).pipe(
          Effect.mapError(cause => { targetPreparations.delete(application); return failure("notReady", cause); }));
      }
    }
    yield* Effect.sync(() => openProtectedMetadataFinalGuardScope(tx));
    return yield* Effect.gen(function* () {
      yield* metadata.authenticateAndRegister(tx).pipe(Effect.mapError(metadataFailure));
      const selected = yield* readBindingSelectedEvidence(tx, authority, preparedTarget);
      if (Option.isNone(selected)) return yield* Effect.fail(failure("bindingMissing"));
      const { candidate, head, activation } = selected.value;
      return yield* withStandaloneApplicationBindingEvidenceInTransaction(application, tx, clock, evidence => Effect.gen(function* () {
        yield* Effect.fromResult(verifyPreparedLogicalSchemaBinding({ applicationAnalysis: root.applicationAnalysis,
          reference: { schemaVersionId: root.schemaVersionId, manifestSha256: root.manifestSha256 } }, candidate.frame, evidence,
          { kind: "activated", activation }));
        if (candidate.frame.payloadContent !== null || candidate.frame.payloadLifecycle !== null)
          return yield* Effect.fail(failure("unsupportedProfile"));
        const checked = new Set<string>();
        // SAFETY: only this live registry issues the inert read capability.
        const token = Object.freeze({}) as LogicalReadAdmission;
        const readReadiness: LogicalReadAdmissionState["readReadiness"] = Object.freeze({
          kind: "queryRequired", mechanics: demand.mechanics,
          requireDemand: Effect.fn("LogicalReadAdmission.requireDemand")(function* (
            demandTx: FlarexMetadataTransaction, requested: LogicalStorageReadDemand,
          ) {
            if (demandTx !== tx || !admissions.has(token)) return yield* Effect.fail(failure("invalidAuthority"));
            yield* checkOpen;
            const key = JSON.stringify(requested);
            if (checked.has(key)) return;
            const verdict = yield* demand.inspectDemand(tx, authority, clock, requested, evidence.checkedActive)
              .pipe(Effect.mapError(cause => failure("notReady", cause)));
            if (verdict.status !== "ready") return yield* Effect.fail(failure("notReady", verdict));
            checked.add(key);
          }),
        });
        admissions.set(token, Object.freeze({ tx, authority, clock, schemaVersionId: root.schemaVersionId,
          sourceKey: root.sourceKey, sourceSha256: root.sourceSha256, defaultTableName: root.defaultTableName, root,
          head: { sequence: head.frame.sequence, sha256: head.sha256 }, readReadiness, checkOpen }));
        return yield* Effect.suspend(() => work(token)).pipe(
          Effect.ensuring(Effect.sync(() => { admissions.delete(token); checked.clear(); })),
        );
      }));
    }).pipe(
      Effect.tap(() => Effect.gen(function* () {
        const batch = yield* prepareProtectedMetadataFinalGuardBatch(tx);
        const rows = yield* runDrizzleStatementEffect(tx.select({ valid: sql<boolean>`final_guard.valid` })
          .from(sql`${batch.source} as final_guard`), cause => failure("resourceFailure", cause));
        yield* acceptProtectedMetadataFinalGuardBatch(tx, rows);
      }).pipe(Effect.mapError(cause => failure("invalidAuthority", cause)))),
      Effect.ensuring(Effect.sync(() => closeProtectedMetadataFinalGuardScope(tx))),
    );
  });
  return Object.freeze({ withReadAdmission });
});
