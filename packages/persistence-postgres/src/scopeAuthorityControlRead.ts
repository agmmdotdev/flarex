import { fxSystemScopeExecutionAuthorities } from "./schema";
import { Data, Effect, Result } from "effect";
import { sql, type SQL } from "drizzle-orm";
import type { PreparedQueryConfig } from "drizzle-orm/pg-core";
import type { SelectedFieldsOrdered } from "drizzle-orm/pg-core/query-builders/select.types";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import { acceptCoLocatedInstallationAdmission, getCoLocatedReadInstallationReferencesResult, coLocatedInstallationGateSource,
  type PreparedCoLocatedReadInstallation } from "./installationLifecycle";
import { recordManagedMetadataEpochSnapshot } from "./preparedMetadataEpoch";
import { fxControlScopes, fxControlScopeProvisioning, fxSystemScopeClocks, fxSystemPreparedMetadataEpoch } from "./schema";
import { decodeScopeMetadataRecord } from "./scopeMetadata";
import { decodeScopeAuthorityProvisioningReceipt } from "./scopeAuthorityProvisioningReceipt";
import { decodeScopeClockRecordResult } from "./scopeClock";
import { resolveTrustedScopeAuthoritySnapshotResult } from "./scopeAuthorityResolution";
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

/** Retain only the fixed SQL shape in the existing target lifetime. Every
 * observation executes through the accepting transaction's own session. */
export function prepareInstalledAttemptScopeAuthority(installation: PreparedCoLocatedReadInstallation,
  database: FlarexMetadataDatabase, physicalLocator: ScopePhysicalLocator) {
  const capturedLocator = Object.freeze({ ...physicalLocator });
  return Result.gen(function* () {
    const refs = yield* getCoLocatedReadInstallationReferencesResult(installation, database);
    if (capturedLocator.schemaName !== refs.target.schemaName) return yield* Result.fail(installedFailure("invalidAuthority"));
    const target = sql.identifier(refs.target.schemaName), control = sql.identifier(refs.control.schemaName);
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
    const epochJoins = sql`left join ${target}.fx_system_prepared_metadata_epoch as target_epoch on target_epoch.singleton_id = 1
      left join ${control}.fx_system_prepared_metadata_epoch as control_epoch on control_epoch.singleton_id = 1`;
    const installedSource = (protection: "share" | "attempt") => sql`${placementSource}
      join lateral (select * from ${target}.fx_system_scope_execution_authority where scope_id = placement.scope_id for share) as scope_authority on true
      join lateral (select * from ${target}.fx_system_scope_clock where scope_id = scope_authority.scope_id
        ${protection === "attempt" ? sql`for no key update` : sql`for share`}) as fx_system_scope_clock on true
      ${epochJoins}`;
    const share = database.select(fields).from(installedSource("share")).limit(2);
    const attempt = database.select(fields).from(installedSource("attempt")).limit(2);
    const compiled = { share: share.toSQL(), attempt: attempt.toSQL() };
    const finiteFields = { ...fields, clock: installedFiniteClockFields() };
    const scopeRootsPresent = sql<boolean>`(finite_scope.authority_row).scope_id is not null
      and (finite_scope.sequence_row).scope_id is not null`;
    const finite = database.select({ ...finiteFields, scopeRootsPresent }).from(sql`${placementSource}
      cross join lateral ${target}.fx_lock_finite_scope_observation(placement.scope_id) as finite_scope ${epochJoins}`).limit(2);
    const finiteOrderedFields: SelectedFieldsOrdered = [...orderInstalledFields(finiteFields),
      { path: ["scopeRootsPresent"], field: scopeRootsPresent },
    ];
    const compiledFinite = finite.toSQL();
    const acceptInstalledPlacement = Effect.fn("InstalledScopeAuthority.acceptPlacement")(function* (tx: FlarexMetadataTransaction,
      row: Omit<typeof share._.result[number], "clock">) {
      yield* acceptCoLocatedInstallationAdmission(installation, database, tx,
        { target: row.targetInstallation, control: row.controlInstallation });
      yield* recordManagedMetadataEpochSnapshot(tx, database, refs.targetInstallation, row.targetEpoch);
      yield* recordManagedMetadataEpochSnapshot(tx, database, refs.controlInstallation, row.controlEpoch);
      const scope = yield* Effect.try({ try: () => decodeScopeMetadataRecord(row.scope), catch: cause => installedFailure("invalidAuthority", cause) });
      const receiptScopeId = row.receipt.scopeId;
      const receipt = receiptScopeId === null ? null : yield* Effect.try({ try: () =>
        decodeScopeAuthorityProvisioningReceipt({ ...row.receipt, scopeId: receiptScopeId }), catch: cause => installedFailure("invalidAuthority", cause) });
      return Object.freeze({ scope, receipt });
    });
    const acceptInstalledRow = Effect.fn("InstalledScopeAuthority.acceptRow")(function* (tx: FlarexMetadataTransaction,
      selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>, row: typeof share._.result[number]) {
      const { scope, receipt } = yield* acceptInstalledPlacement(tx, row);
      const clock = yield* Effect.fromResult(decodeScopeClockRecordResult(row.clock));
      const authority = yield* Effect.fromResult(resolveTrustedScopeAuthoritySnapshotResult(selection, scope, receipt, capturedLocator, clock));
      return Object.freeze({ authority, row: row.clock });
    });
    const lock = Effect.fn("InstalledScopeAuthority.lockAttempt")(function* (tx: FlarexMetadataTransaction,
      selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>, protection: "share" | "attempt") {
      yield* Effect.fromResult(getCoLocatedReadInstallationReferencesResult(installation, database));
      const rows = yield* Effect.tryPromise({ try: () => tx._.session.prepareQuery<PreparedQueryConfig & {
        execute: typeof share._.result;
      }>(compiled[protection], orderedFields, undefined, true).execute(selection),
        catch: cause => installedFailure("resourceFailure", cause) });
      const row = rows[0];
      if (rows.length !== 1 || row === undefined) return yield* Effect.fail(installedFailure("invalidAuthority"));
      return yield* acceptInstalledRow(tx, selection, row);
    });
    const lockFiniteScope = Effect.fn("InstalledScopeAuthority.lockFiniteScope")(function* (tx: FlarexMetadataTransaction,
      selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>) {
      yield* Effect.fromResult(getCoLocatedReadInstallationReferencesResult(installation, database));
      const rows = yield* Effect.tryPromise({ try: () => tx._.session.prepareQuery<PreparedQueryConfig & {
        execute: typeof finite._.result;
      }>(compiledFinite, finiteOrderedFields, undefined, true).execute(selection),
        catch: cause => installedFailure("resourceFailure", cause) });
      const row = rows[0];
      if (rows.length !== 1 || row === undefined || !row.scopeRootsPresent)
        return yield* Effect.fail(installedFailure("invalidAuthority"));
      // Complete installed JS validation before the separate compact statement
      // can acquire any session, lease, journal or execution-claim lock.
      return yield* acceptInstalledRow(tx, selection, row);
    });
    return Object.freeze({ lock, lockFiniteScope });
  });
}

export type PreparedInstalledAttemptScopeAuthority = Result.Result.Success<ReturnType<typeof prepareInstalledAttemptScopeAuthority>>;

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
