import { Data, Effect, Result } from "effect";
import { sql } from "drizzle-orm";
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
          epochUuid: sql`fx_system_scope_clock.epoch_uuid`.mapWith(fxSystemScopeClocks.epochUuid), scopeId: sql`fx_system_scope_clock.${sql.identifier(fxSystemScopeClocks.scopeId.name)}`.mapWith(fxSystemScopeClocks.scopeId),
          storageGeneration: sql`fx_system_scope_clock.${sql.identifier(fxSystemScopeClocks.storageGeneration.name)}`.mapWith(fxSystemScopeClocks.storageGeneration),
          storageGenerationFence: sql`fx_system_scope_clock.${sql.identifier(fxSystemScopeClocks.storageGenerationFence.name)}`.mapWith(fxSystemScopeClocks.storageGenerationFence),
          lastCommitSeq: sql`fx_system_scope_clock.${sql.identifier(fxSystemScopeClocks.lastCommitSeq.name)}`.mapWith(fxSystemScopeClocks.lastCommitSeq),
          oldestAvailableCommitSeq: sql`fx_system_scope_clock.${sql.identifier(fxSystemScopeClocks.oldestAvailableCommitSeq.name)}`.mapWith(fxSystemScopeClocks.oldestAvailableCommitSeq),
          authorizationRevocationEpoch: sql`fx_system_scope_clock.${sql.identifier(fxSystemScopeClocks.authorizationRevocationEpoch.name)}`.mapWith(fxSystemScopeClocks.authorizationRevocationEpoch),
          epoch: sql`fx_system_scope_clock.${sql.identifier(fxSystemScopeClocks.epoch.name)}`.mapWith(fxSystemScopeClocks.epoch),
          updatedAt: sql`fx_system_scope_clock.${sql.identifier(fxSystemScopeClocks.updatedAt.name)}`.mapWith(fxSystemScopeClocks.updatedAt) });

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
    // These explicit fixed groups match select's insertion order. Drizzle's
    // session applies its own nested result mapping and column decoders.
    const orderedFields: SelectedFieldsOrdered = [
      { path: ["targetInstallation"], field: fields.targetInstallation },
      { path: ["controlInstallation"], field: fields.controlInstallation },
      { path: ["safePath"], field: fields.safePath },
      ...Object.entries(fields.scope).map(([key, field]) => ({ path: ["scope", key], field })),
      ...Object.entries(fields.receipt).map(([key, field]) => ({ path: ["receipt", key], field })),
      ...Object.entries(fields.clock).map(([key, field]) => ({ path: ["clock", key], field })),
      ...Object.entries(fields.targetEpoch).map(([key, field]) => ({ path: ["targetEpoch", key], field })),
      ...Object.entries(fields.controlEpoch).map(([key, field]) => ({ path: ["controlEpoch", key], field })),
    ];
    const shape = (protection: "share" | "attempt") => database.select(fields).from(sql`${coLocatedInstallationGateSource(refs)} as installed
      cross join lateral ${control}.fx_lock_read_scope_placement(${sql.placeholder("deploymentId")},
        case when installed.first_oid > 0 and installed.second_oid > 0 then ${sql.placeholder("scopeId")} else null end) as placement
      join lateral (select * from ${target}.fx_system_scope_clock where scope_id = placement.scope_id
        ${protection === "attempt" ? sql`for no key update` : sql`for share`}) as fx_system_scope_clock on true
      left join ${target}.fx_system_prepared_metadata_epoch as target_epoch on target_epoch.singleton_id = 1
      left join ${control}.fx_system_prepared_metadata_epoch as control_epoch on control_epoch.singleton_id = 1`).limit(2);
    const share = shape("share"), attempt = shape("attempt");
    const compiled = { share: share.toSQL(), attempt: attempt.toSQL() };
    const lock = Effect.fn("InstalledScopeAuthority.lockAttempt")(function* (tx: FlarexMetadataTransaction,
      selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>, protection: "share" | "attempt") {
      yield* Effect.fromResult(getCoLocatedReadInstallationReferencesResult(installation, database));
      const rows = yield* Effect.tryPromise({ try: () => tx._.session.prepareQuery<PreparedQueryConfig & {
        execute: typeof share._.result;
      }>(compiled[protection], orderedFields, undefined, true).execute(selection),
        catch: cause => installedFailure("resourceFailure", cause) });
      const row = rows[0];
      if (rows.length !== 1 || row === undefined) return yield* Effect.fail(installedFailure("invalidAuthority"));
      yield* acceptCoLocatedInstallationAdmission(installation, database, tx,
        { target: row.targetInstallation, control: row.controlInstallation });
      yield* recordManagedMetadataEpochSnapshot(tx, database, refs.targetInstallation, row.targetEpoch);
      yield* recordManagedMetadataEpochSnapshot(tx, database, refs.controlInstallation, row.controlEpoch);
      const scope = yield* Effect.try({ try: () => decodeScopeMetadataRecord(row.scope), catch: cause => installedFailure("invalidAuthority", cause) });
      const receiptScopeId = row.receipt.scopeId;
      const receipt = receiptScopeId === null ? null : yield* Effect.try({ try: () =>
        decodeScopeAuthorityProvisioningReceipt({ ...row.receipt, scopeId: receiptScopeId }), catch: cause => installedFailure("invalidAuthority", cause) });
      const clock = yield* Effect.fromResult(decodeScopeClockRecordResult(row.clock));
      const authority = yield* Effect.fromResult(resolveTrustedScopeAuthoritySnapshotResult(selection, scope, receipt, capturedLocator, clock));
      return Object.freeze({ authority, row: row.clock });
    });
    return Object.freeze({ lock });
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
