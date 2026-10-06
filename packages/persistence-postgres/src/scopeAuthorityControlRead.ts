import { fxSystemScopeExecutionAuthorities } from "./schema";
import { Data, Effect, Result, Schema } from "effect";
import { getTableName, sql, type SQL } from "drizzle-orm";
import type { PreparedQueryConfig } from "drizzle-orm/pg-core";
import type { SelectedFieldsOrdered } from "drizzle-orm/pg-core/query-builders/select.types";
import type { SelectResultFields } from "drizzle-orm/query-builders/select.types";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import { acceptCoLocatedInstallationAdmission, requireCoLocatedInstallationAdmissionResult, getCoLocatedReadInstallationReferencesResult, coLocatedInstallationGateSource,
  type PreparedCoLocatedReadInstallation } from "./installationLifecycle";
import { managedInstallationIdentity, managedInstallationMetadataIncarnation } from "./installationLifecycle";
import { recordManagedMetadataEpochSnapshot, hasProtectedMetadataFinalGuardScope,
  registerManagedMetadataSnapshotFinalGuard } from "./preparedMetadataEpoch";
import { fxControlScopes, fxControlScopeProvisioning, fxSystemScopeClocks, fxSystemPreparedMetadataEpoch } from "./schema";
import { decodeScopeMetadataRecord } from "./scopeMetadata";
import { decodeScopeAuthorityProvisioningReceipt } from "./scopeAuthorityProvisioningReceipt";
import { decodeScopeClockRecordResult, ScopeExecutionAuthoritySchema } from "./scopeClock";
import { resolveTrustedScopeAuthoritySnapshotResult } from "./scopeAuthorityResolution";
import type { LocatedScopeClockReader } from "./scopeAuthorityResolution";
import type { FlarexMetadataDatabase } from "./deployments";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import { closeInstallationAdmission, lockInstallationForCurrentTransaction } from "./installationLifecycle";
import { getScopeMetadata, getScopeMetadataByDeploymentId } from "./scopeMetadata";
import { getScopeAuthorityProvisioningReceipt } from "./scopeAuthorityProvisioningReceipt";
import type { ExactScopeMetadataReader, ScopeMetadataReader, ScopeProvisioningReceiptReader } from "./scopeAuthorityResolution";

export class InstalledScopeAuthorityError extends Data.TaggedError("InstalledScopeAuthorityError")<{
  readonly reason: "invalidAuthority" | "resourceFailure";
  readonly cause?: unknown;
}> {}
const installedFailure = (reason: InstalledScopeAuthorityError["reason"], cause?: unknown) =>
  new InstalledScopeAuthorityError({ reason, ...(cause === undefined ? {} : { cause }) });
const decodeExecutionAuthority = Schema.decodeUnknownEffect(Schema.toType(ScopeExecutionAuthoritySchema));
/** Construction support only. Live authority is always read by the target's
 * installed acceptance operation in its own transaction. */
export const INSTALLED_SCOPE_AUTHORITY_TARGET: unique symbol = Symbol("Flarex/InstalledScopeAuthorityTarget");

export const epochFields = (alias: "target_epoch" | "control_epoch") => {
  const a = sql.identifier(alias);
  return { databaseName: sql<string>`${a}.database_name`,
    namespaceOid: sql`${a}.namespace_oid`.mapWith(fxSystemPreparedMetadataEpoch.namespaceOid),
    incarnation: sql<string>`${a}.incarnation::text`,
    generation: sql`${a}.generation`.mapWith(fxSystemPreparedMetadataEpoch.generation),
    login: sql<string>`session_user` };
};

export const installedScopeFields = () => ({ scopeId: sql`placement.scope_id`.mapWith(fxControlScopes.scopeId),
          deploymentId: sql`placement.deployment_id`.mapWith(fxControlScopes.deploymentId),
          activeSchemaVersionId: sql`placement.active_schema_version_id`.mapWith(fxControlScopes.activeSchemaVersionId),
          isolationKind: sql`placement.isolation_kind`.mapWith(fxControlScopes.isolationKind),
          physicalLocator: sql`placement.physical_locator_json`.mapWith(fxControlScopes.physicalLocator),
          createdAt: sql`placement.created_at`.mapWith(fxControlScopes.createdAt) });
export const installedReceiptFields = () => ({ scopeId: sql<ScopeId | null>`placement.receipt_scope_id`,
          protocolVersion: sql`placement.receipt_protocol_version`.mapWith(fxControlScopeProvisioning.protocolVersion),
          state: sql`placement.receipt_state`.mapWith(fxControlScopeProvisioning.state),
          physicalLocator: sql`placement.receipt_physical_locator_json`.mapWith(fxControlScopeProvisioning.physicalLocator),
          initialEpoch: sql`placement.receipt_initial_epoch`.mapWith(fxControlScopeProvisioning.initialEpoch),
          reservedAt: sql`placement.receipt_reserved_at`.mapWith(fxControlScopeProvisioning.reservedAt),
          readyAt: sql`placement.receipt_ready_at`.mapWith(fxControlScopeProvisioning.readyAt) });

export const installedClockFields = () => ({ scopeUuid: sql`fx_system_scope_clock.scope_uuid`.mapWith(fxSystemScopeClocks.scopeUuid),
          epochUuid: sql`scope_authority.epoch_uuid`.mapWith(fxSystemScopeExecutionAuthorities.epochUuid), scopeId: sql`fx_system_scope_clock.${sql.identifier(fxSystemScopeClocks.scopeId.name)}`.mapWith(fxSystemScopeClocks.scopeId),
          storageGeneration: sql`scope_authority.${sql.identifier(fxSystemScopeExecutionAuthorities.storageGeneration.name)}`.mapWith(fxSystemScopeExecutionAuthorities.storageGeneration),
          storageGenerationFence: sql`scope_authority.${sql.identifier(fxSystemScopeExecutionAuthorities.storageGenerationFence.name)}`.mapWith(fxSystemScopeExecutionAuthorities.storageGenerationFence),
          lastMetadataSequence: sql`fx_system_scope_clock.last_metadata_sequence`.mapWith(fxSystemScopeClocks.lastMetadataSequence),
          lastCommitSeq: sql`fx_system_scope_clock.${sql.identifier(fxSystemScopeClocks.lastCommitSeq.name)}`.mapWith(fxSystemScopeClocks.lastCommitSeq),
          oldestAvailableCommitSeq: sql`scope_authority.${sql.identifier(fxSystemScopeExecutionAuthorities.oldestAvailableCommitSeq.name)}`.mapWith(fxSystemScopeExecutionAuthorities.oldestAvailableCommitSeq),
          authorizationRevocationEpoch: sql`scope_authority.${sql.identifier(fxSystemScopeExecutionAuthorities.authorizationRevocationEpoch.name)}`.mapWith(fxSystemScopeExecutionAuthorities.authorizationRevocationEpoch),
          epoch: sql`scope_authority.${sql.identifier(fxSystemScopeExecutionAuthorities.epoch.name)}`.mapWith(fxSystemScopeExecutionAuthorities.epoch),
          updatedAt: sql`greatest(fx_system_scope_clock.updated_at, scope_authority.updated_at)`.mapWith(fxSystemScopeClocks.updatedAt) });

const installedFiniteClockFields = () => ({
  scopeUuid: sql`(finite_scope.sequence_row).scope_uuid`.mapWith(fxSystemScopeClocks.scopeUuid),
  epochUuid: sql`(finite_scope.authority_row).epoch_uuid`.mapWith(fxSystemScopeExecutionAuthorities.epochUuid),
  scopeId: sql`(finite_scope.sequence_row).scope_id`.mapWith(fxSystemScopeClocks.scopeId),
  storageGeneration: sql`(finite_scope.authority_row).storage_generation`.mapWith(fxSystemScopeExecutionAuthorities.storageGeneration),
  storageGenerationFence: sql`(finite_scope.authority_row).storage_generation_fence`.mapWith(fxSystemScopeExecutionAuthorities.storageGenerationFence),
  lastMetadataSequence: sql`(finite_scope.sequence_row).last_metadata_sequence`.mapWith(fxSystemScopeClocks.lastMetadataSequence),
  lastCommitSeq: sql`(finite_scope.sequence_row).last_commit_seq`.mapWith(fxSystemScopeClocks.lastCommitSeq),
  oldestAvailableCommitSeq: sql`(finite_scope.authority_row).oldest_available_commit_seq`.mapWith(fxSystemScopeExecutionAuthorities.oldestAvailableCommitSeq),
  authorizationRevocationEpoch: sql`(finite_scope.authority_row).authorization_revocation_epoch`.mapWith(fxSystemScopeExecutionAuthorities.authorizationRevocationEpoch),
  epoch: sql`(finite_scope.authority_row).epoch`.mapWith(fxSystemScopeExecutionAuthorities.epoch),
  updatedAt: sql`greatest((finite_scope.sequence_row).updated_at, (finite_scope.authority_row).updated_at)`.mapWith(fxSystemScopeClocks.updatedAt),
});

// These explicit fixed groups match select's insertion order. Drizzle's
// session applies its own nested result mapping and column decoders.
function orderInstalledFields(selected: Readonly<{
  targetInstallation: SQL<unknown>; controlInstallation: SQL<unknown>; safePath: SQL<string>;
  scope: ReturnType<typeof installedScopeFields>; receipt: ReturnType<typeof installedReceiptFields>;
  clock: ReturnType<typeof installedClockFields>;
  targetEpoch: ReturnType<typeof epochFields>; controlEpoch: ReturnType<typeof epochFields>;
}>): SelectedFieldsOrdered {
  return [
    { path: ["targetInstallation"], field: selected.targetInstallation },
    { path: ["controlInstallation"], field: selected.controlInstallation },
    { path: ["safePath"], field: selected.safePath },
    ...Object.entries(selected.scope).map(([key, field]) => ({ path: ["scope", key], field })),
    ...Object.entries(selected.receipt).map(([key, field]) => ({ path: ["receipt", key], field })),
    ...Object.entries(selected.clock).map(([key, field]) => ({ path: ["clock", key], field })),
    ...Object.entries(selected.targetEpoch).map(([key, field]) => ({ path: ["targetEpoch", key], field })),
    ...Object.entries(selected.controlEpoch).map(([key, field]) => ({ path: ["controlEpoch", key], field })),
  ];
}

/** Pure installed SQL/projection topology. Query builders and sessions end at
 * compilation; every transaction observation remains with its fresh owner. */
function compileInstalledAttemptScopePlan(database: FlarexMetadataDatabase,
  refs: Result.Result.Success<ReturnType<typeof getCoLocatedReadInstallationReferencesResult>>) {
  const target = sql.identifier(refs.target.schemaName), control = sql.identifier(refs.control.schemaName);
  const epochTable = sql.identifier(getTableName(fxSystemPreparedMetadataEpoch));
  const authorityTable = sql.identifier(getTableName(fxSystemScopeExecutionAuthorities));
  const clockTable = sql.identifier(getTableName(fxSystemScopeClocks));
  const fields = {
    targetInstallation: sql<unknown>`installed.target_installation`, controlInstallation: sql<unknown>`installed.control_installation`,
    safePath: sql<string>`pg_catalog.set_config('search_path', pg_catalog.format('%I, pg_temp', ${refs.target.schemaName}::text), true)`,
    scope: installedScopeFields(), receipt: installedReceiptFields(), clock: installedClockFields(),
    targetEpoch: epochFields("target_epoch"), controlEpoch: epochFields("control_epoch"),
  };
  const orderedFields = orderInstalledFields(fields);
  const placementSource = sql`${coLocatedInstallationGateSource(refs)} as installed
    cross join lateral ${control}.fx_lock_read_scope_placement(${sql.placeholder("deploymentId")},
      case when installed.first_oid > 0 and installed.second_oid > 0 then ${sql.placeholder("scopeId")} else null end) as placement`;
  const epochJoins = sql`left join ${target}.${epochTable} as target_epoch on target_epoch.${sql.identifier(fxSystemPreparedMetadataEpoch.singletonId.name)} = 1
    left join ${control}.${epochTable} as control_epoch on control_epoch.${sql.identifier(fxSystemPreparedMetadataEpoch.singletonId.name)} = 1`;
  const installedSource = (protection: "share" | "attempt") => sql`${placementSource}
    join lateral (select * from ${target}.${authorityTable} where ${sql.identifier(fxSystemScopeExecutionAuthorities.scopeId.name)} = ${fields.scope.scopeId} for share) as scope_authority on true
    join lateral (select * from ${target}.${clockTable} where ${sql.identifier(fxSystemScopeClocks.scopeId.name)} = scope_authority.${sql.identifier(fxSystemScopeExecutionAuthorities.scopeId.name)}
      ${protection === "attempt" ? sql`for no key update` : sql`for share`}) as fx_system_scope_clock on true
    ${epochJoins}`;
  const share = database.select(fields).from(installedSource("share")).limit(2);
  const attempt = database.select(fields).from(installedSource("attempt")).limit(2);
  const compiled = { share: Object.freeze(share.toSQL()), attempt: Object.freeze(attempt.toSQL()) };
  const finiteFields = { ...fields, clock: installedFiniteClockFields() };
  const scopeRootsPresent = sql<boolean>`(finite_scope.authority_row).${sql.identifier(fxSystemScopeExecutionAuthorities.scopeId.name)} is not null
    and (finite_scope.sequence_row).${sql.identifier(fxSystemScopeClocks.scopeId.name)} is not null`;
  const finite = database.select({ ...finiteFields, scopeRootsPresent }).from(sql`${placementSource}
    cross join lateral ${target}.fx_lock_finite_scope_observation(${fields.scope.scopeId}) as finite_scope ${epochJoins}`).limit(2);
  const finiteOrderedFields: SelectedFieldsOrdered = [...orderInstalledFields(finiteFields),
    { path: ["scopeRootsPresent"], field: scopeRootsPresent },
  ];
  const compiledFinite = finite.toSQL();
  return Object.freeze({ compiled: Object.freeze(compiled), compiledFinite: Object.freeze(compiledFinite),
    fields, finiteFields: { ...finiteFields, scopeRootsPresent }, orderedFields, finiteOrderedFields });
}
type InstalledAttemptScopePlan = ReturnType<typeof compileInstalledAttemptScopePlan>;
type InstalledAttemptScopeRow = SelectResultFields<InstalledAttemptScopePlan["fields"]>;
type InstalledFiniteScopeRow = SelectResultFields<InstalledAttemptScopePlan["finiteFields"]>;
const installedAttemptScopePlans = new WeakMap<FlarexMetadataDatabase,
  WeakMap<PreparedCoLocatedReadInstallation, Readonly<{ locator: ScopePhysicalLocator; plan: InstalledAttemptScopePlan }>>>();

/** Authenticate the original database/pair before reusing pure preparation.
 * A bounded locator slot never changes a plan held by an active owner. */
export function prepareInstalledAttemptScopeAuthority(installation: PreparedCoLocatedReadInstallation,
  database: FlarexMetadataDatabase, physicalLocator: ScopePhysicalLocator) {
  const capturedLocator = Object.freeze({ ...physicalLocator });
  return Result.gen(function* () {
    const refs = yield* getCoLocatedReadInstallationReferencesResult(installation, database);
    if (capturedLocator.schemaName !== refs.target.schemaName) return yield* Result.fail(installedFailure("invalidAuthority"));
    const slots = installedAttemptScopePlans.get(database) ?? new WeakMap<PreparedCoLocatedReadInstallation,
      Readonly<{ locator: ScopePhysicalLocator; plan: InstalledAttemptScopePlan }>>();
    const retainedPlan = slots.get(installation);
    const plan = retainedPlan !== undefined && retainedPlan.locator.kind === capturedLocator.kind &&
      retainedPlan.locator.databaseKey === capturedLocator.databaseKey && retainedPlan.locator.schemaName === capturedLocator.schemaName
      ? retainedPlan.plan : compileInstalledAttemptScopePlan(database, refs);
    if (plan !== retainedPlan?.plan) {
      slots.set(installation, Object.freeze({ locator: capturedLocator, plan }));
      installedAttemptScopePlans.set(database, slots);
    }
    const acceptedTransactions = new WeakMap<FlarexMetadataTransaction, Readonly<{
      deploymentId: string; scopeId: ScopeId; protection: "share" | "attempt" | "finite";
    }>>();
    const { compiled, compiledFinite, orderedFields, finiteOrderedFields } = plan;
    const acceptInstalledPlacement = Effect.fn("InstalledScopeAuthority.acceptPlacement")(function* (tx: FlarexMetadataTransaction,
      row: Omit<InstalledAttemptScopeRow, "clock">) {
      yield* acceptCoLocatedInstallationAdmission(installation, database, tx,
        { target: row.targetInstallation, control: row.controlInstallation });
      yield* recordManagedMetadataEpochSnapshot(tx, database, refs.targetInstallation, row.targetEpoch);
      yield* recordManagedMetadataEpochSnapshot(tx, database, refs.controlInstallation, row.controlEpoch);
      if (hasProtectedMetadataFinalGuardScope(tx)) {
        yield* registerManagedMetadataSnapshotFinalGuard(tx, database, refs.targetInstallation);
        yield* registerManagedMetadataSnapshotFinalGuard(tx, database, refs.controlInstallation);
      }
      const scope = yield* Effect.try({ try: () => decodeScopeMetadataRecord(row.scope), catch: cause => installedFailure("invalidAuthority", cause) });
      const receiptScopeId = row.receipt.scopeId;
      const receipt = receiptScopeId === null ? null : yield* Effect.try({ try: () =>
        decodeScopeAuthorityProvisioningReceipt({ ...row.receipt, scopeId: receiptScopeId }), catch: cause => installedFailure("invalidAuthority", cause) });
      return Object.freeze({ scope, receipt });
    });
    const acceptInstalledRow = Effect.fn("InstalledScopeAuthority.acceptRow")(function* (tx: FlarexMetadataTransaction,
      selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>, row: InstalledAttemptScopeRow) {
      const { scope, receipt } = yield* acceptInstalledPlacement(tx, row);
      const clock = yield* Effect.fromResult(decodeScopeClockRecordResult(row.clock));
      const authority = yield* Effect.fromResult(resolveTrustedScopeAuthoritySnapshotResult(selection, scope, receipt, capturedLocator, clock));
      const executionAuthority = yield* decodeExecutionAuthority(row.clock).pipe(
        Effect.mapError(cause => installedFailure("invalidAuthority", cause)));
      return Object.freeze({ authority, executionAuthority, row: row.clock });
    });
    const lock = Effect.fn("InstalledScopeAuthority.lockAttempt")(function* (tx: FlarexMetadataTransaction,
      selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>, protection: "share" | "attempt") {
      yield* Effect.fromResult(getCoLocatedReadInstallationReferencesResult(installation, database));
      const rows = yield* Effect.tryPromise({ try: () => tx._.session.prepareQuery<PreparedQueryConfig & {
        execute: InstalledAttemptScopeRow[];
      }>(compiled[protection], orderedFields, undefined, true).execute(selection),
        catch: cause => installedFailure("resourceFailure", cause) });
      const row = rows[0];
      if (rows.length !== 1 || row === undefined) return yield* Effect.fail(installedFailure("invalidAuthority"));
      const accepted = yield* acceptInstalledRow(tx, selection, row);
      acceptedTransactions.set(tx, Object.freeze({ ...selection, protection }));
      return accepted;
    });
    const lockFiniteScope = Effect.fn("InstalledScopeAuthority.lockFiniteScope")(function* (tx: FlarexMetadataTransaction,
      selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>) {
      yield* Effect.fromResult(getCoLocatedReadInstallationReferencesResult(installation, database));
      const rows = yield* Effect.tryPromise({ try: () => tx._.session.prepareQuery<PreparedQueryConfig & {
        execute: InstalledFiniteScopeRow[];
      }>(compiledFinite, finiteOrderedFields, undefined, true).execute(selection),
        catch: cause => installedFailure("resourceFailure", cause) });
      const row = rows[0];
      if (rows.length !== 1 || row === undefined || !row.scopeRootsPresent)
        return yield* Effect.fail(installedFailure("invalidAuthority"));
      // Complete installed JS validation before the separate compact statement
      // can acquire any session, lease, journal or execution-claim lock.
      const accepted = yield* acceptInstalledRow(tx, selection, row);
      acceptedTransactions.set(tx, Object.freeze({ ...selection, protection: "finite" }));
      return accepted;
    });
    const requireAcceptedTransaction = (
      tx: FlarexMetadataTransaction, selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>, protection: "share" | "attempt",
    ) => Result.gen(function* () {
      yield* requireCoLocatedInstallationAdmissionResult(installation, database, tx);
      const accepted = acceptedTransactions.get(tx);
      if (accepted === undefined || accepted.deploymentId !== selection.deploymentId || accepted.scopeId !== selection.scopeId ||
        accepted.protection !== protection) return yield* Result.fail(installedFailure("invalidAuthority"));
    });
    const closeAcceptedTransaction = (tx: FlarexMetadataTransaction) => { acceptedTransactions.delete(tx); };
    const requireDatabase = (candidate: FlarexMetadataDatabase) => candidate === database ? Result.succeed(undefined) :
      Result.fail(installedFailure("invalidAuthority"));
    return Object.freeze({ lock, lockFiniteScope, requireAcceptedTransaction, closeAcceptedTransaction, requireDatabase });
  });
}

export type PreparedInstalledAttemptScopeAuthority = Result.Result.Success<ReturnType<typeof prepareInstalledAttemptScopeAuthority>>;

/** Compile actual installation and control placement acceptance into the named
 * capture statement. Only authenticated preparations supply namespace names. */
export function prepareInstalledFiniteCaptureSource(installation: PreparedCoLocatedReadInstallation,
  database: FlarexMetadataDatabase, physicalLocator: ScopePhysicalLocator) {
  return Result.gen(function* () {
    const refs = yield* getCoLocatedReadInstallationReferencesResult(installation, database);
    if (physicalLocator.schemaName !== refs.target.schemaName) return yield* Result.fail(installedFailure("invalidAuthority"));
    const control = sql.identifier(refs.control.schemaName);
    const target = sql.identifier(refs.target.schemaName);
    const targetIdentity = managedInstallationIdentity(refs.targetInstallation, database);
    const controlIdentity = managedInstallationIdentity(refs.controlInstallation, database);
    const targetIncarnation = managedInstallationMetadataIncarnation(refs.targetInstallation, database);
    const controlIncarnation = managedInstallationMetadataIncarnation(refs.controlInstallation, database);
    if (targetIdentity === undefined || controlIdentity === undefined || targetIncarnation === undefined || controlIncarnation === undefined)
      return yield* Result.fail(installedFailure("invalidAuthority"));
    const locator = sql`jsonb_build_object('kind', ${physicalLocator.kind}::text,
      'databaseKey', ${physicalLocator.databaseKey}::text, 'schemaName', ${physicalLocator.schemaName}::text)`;
    const source = sql`(values (1)) capture_resource(value)
      left join lateral ${coLocatedInstallationGateSource(refs, "finiteCapture")} installed on true
      left join lateral (select * from ${control}.fx_lock_read_scope_placement(${sql.placeholder("deploymentId")},
        ${sql.placeholder("scopeId")}) as admitted_placement
        where installed.first_oid > 0 and installed.second_oid > 0 offset 0) placement on true
      left join ${target}.fx_system_prepared_metadata_epoch target_epoch on target_epoch.singleton_id = 1
      left join ${control}.fx_system_prepared_metadata_epoch control_epoch on control_epoch.singleton_id = 1`;
    const acceptedScope = sql`case when placement.scope_id = ${sql.placeholder("scopeId")}
      and target_epoch.database_name = ${targetIdentity.databaseName}
      and target_epoch.namespace_oid = ${targetIdentity.namespaceOid}::bigint
      and target_epoch.incarnation = ${targetIncarnation}::uuid and target_epoch.generation > 0
      and control_epoch.database_name = ${controlIdentity.databaseName}
      and control_epoch.namespace_oid = ${controlIdentity.namespaceOid}::bigint
      and control_epoch.incarnation = ${controlIncarnation}::uuid and control_epoch.generation > 0
      and session_user = ${targetIdentity.login} and current_user = session_user
      and placement.deployment_id = ${sql.placeholder("deploymentId")}
      and (placement.active_schema_version_id is null or btrim(placement.active_schema_version_id) <> '')
      and placement.isolation_kind = ${physicalLocator.kind}
      and placement.physical_locator_json = ${locator}
      and (placement.receipt_scope_id is null or (
        placement.receipt_scope_id = placement.scope_id
        and placement.receipt_protocol_version = 'split_scope_authority_v1'
        and btrim(placement.receipt_initial_epoch) <> ''
        and placement.receipt_physical_locator_json ->> 'kind' in ('schema_per_scope','database_per_scope')
        and case when jsonb_typeof(placement.receipt_physical_locator_json) = 'object' then
          (select count(*) from jsonb_object_keys(placement.receipt_physical_locator_json)) = 3 else false end
        and btrim(placement.receipt_physical_locator_json ->> 'databaseKey') <> ''
        and btrim(placement.receipt_physical_locator_json ->> 'schemaName') <> ''
        and placement.receipt_reserved_at is not null and isfinite(placement.receipt_reserved_at)
        and (placement.receipt_state = 'reserved' and placement.receipt_ready_at is null or
          placement.receipt_state = 'ready' and isfinite(placement.receipt_ready_at) and isfinite(placement.receipt_ready_at) and placement.receipt_ready_at >= placement.receipt_reserved_at)))
      and (placement.isolation_kind = 'shared_database' or (
        placement.receipt_scope_id = placement.scope_id
        and placement.receipt_protocol_version = 'split_scope_authority_v1'
        and placement.receipt_state = 'ready'
        and placement.receipt_physical_locator_json = ${locator}
        and btrim(placement.receipt_initial_epoch) <> ''
        and placement.receipt_reserved_at is not null and isfinite(placement.receipt_reserved_at) and isfinite(placement.receipt_ready_at) and placement.receipt_ready_at >= placement.receipt_reserved_at))
      then placement.scope_id else null end`;
    return Object.freeze({ source, acceptedScope, schemaName: refs.target.schemaName, controlSchemaName: refs.control.schemaName });
  });
}

/** Only a genuinely constructed managed target lends its installed accepting owner. */
export const ACCEPT_INSTALLED_ATTEMPT_SCOPE_AUTHORITY_IN_TRANSACTION: unique symbol =
  Symbol("FlarexDB/acceptInstalledAttemptScopeAuthorityInTransaction");
export const RUN_INSTALLED_ACCEPTING_READ_COMMITTED: unique symbol = Symbol("FlarexDB/runInstalledAcceptingReadCommitted");
export interface InstalledAttemptScopeAuthorityTarget extends LocatedScopeClockReader {
  readonly [ACCEPT_INSTALLED_ATTEMPT_SCOPE_AUTHORITY_IN_TRANSACTION]: (
    tx: FlarexMetadataTransaction, selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>,
  ) => ReturnType<PreparedInstalledAttemptScopeAuthority["lock"]>;
  readonly [RUN_INSTALLED_ACCEPTING_READ_COMMITTED]: <Value>(selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>,
    work: (tx: FlarexMetadataTransaction) => Promise<Value>) => Promise<Value>;
}
export function isInstalledAttemptScopeAuthorityTarget(target: LocatedScopeClockReader):
  target is InstalledAttemptScopeAuthorityTarget {
  return typeof Reflect.get(target, ACCEPT_INSTALLED_ATTEMPT_SCOPE_AUTHORITY_IN_TRANSACTION) === "function";
}

/** The control owner borrows one short transaction for each fresh observation.
 * Target resolution begins only after this transaction has settled. Raw
 * transaction-scoped getters retain their existing caller-owned lock order. */
export function makeInstallationProtectedScopeAuthorityControlReader(database: FlarexMetadataDatabase): Readonly<{
  scopeMetadata: ExactScopeMetadataReader & ScopeMetadataReader;
  provisioningReceipts: ScopeProvisioningReceiptReader;
}> {
  const scopeMetadata: ExactScopeMetadataReader & ScopeMetadataReader = {
    getScopeMetadata: scopeId => read(tx => getScopeMetadata(tx, scopeId)),
    getScopeMetadataByDeploymentId: deploymentId => read(tx => getScopeMetadataByDeploymentId(tx, deploymentId)),
  };
  const provisioningReceipts: ScopeProvisioningReceiptReader = {
    getScopeAuthorityProvisioningReceipt: scopeId => read(tx => getScopeAuthorityProvisioningReceipt(tx, scopeId)),
  };
  return Object.freeze({ scopeMetadata: Object.freeze(scopeMetadata),
    provisioningReceipts: Object.freeze(provisioningReceipts) });

  // Promise boundary required by the existing authority ports. Await work and
  // settlement without converting the raw readers' decoding/error identity.
  function read<Value>(work: (tx: FlarexMetadataTransaction) => Promise<Value>): Promise<Value> {
    return database.transaction(async tx => {
      try {
        await Effect.runPromise(lockInstallationForCurrentTransaction(tx));
        return await work(tx);
      } finally { closeInstallationAdmission(tx); }
    });
  }
}
