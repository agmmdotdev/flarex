import { fxSystemScopeExecutionAuthorities } from "./schema";
import { Data, Effect, Result, Schema } from "effect";
import { observeExecution } from "./executionDiagnostics/operation";
import { getTableName, sql, type SQL } from "drizzle-orm";
import type { PreparedQueryConfig } from "drizzle-orm/pg-core";
import type { SelectedFieldsOrdered } from "drizzle-orm/pg-core/query-builders/select.types";
import type { SelectResultFields } from "drizzle-orm/query-builders/select.types";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import { acceptCoLocatedInstallationFrontier, requireCoLocatedInstallationAdmissionResult, getCoLocatedReadInstallationReferencesResult,
  coLocatedInstallationFrontierSource, coLocatedInstallationFrontierFields,
  type PreparedCoLocatedReadInstallation } from "./installationLifecycle";
import { recordManagedMetadataFrontierSnapshot, hasProtectedMetadataFinalGuardScope,
  registerManagedMetadataSnapshotFinalGuard } from "./preparedMetadataEpoch";
import { fxControlScopes, fxControlScopeProvisioning, fxSystemScopeClocks } from "./schema";
import { decodeScopeMetadataRecord } from "./scopeMetadata";
import { decodeScopeAuthorityProvisioningReceipt } from "./scopeAuthorityProvisioningReceipt";
import { decodeScopeClockRecordResult, ScopeExecutionAuthoritySchema } from "./scopeClock";
import { resolveTrustedScopeAuthoritySnapshotResult, resolveTrustedScopePlacementSnapshotResult } from "./scopeAuthorityResolution";
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

function installedPlacementSource(refs: Result.Result.Success<ReturnType<typeof getCoLocatedReadInstallationReferencesResult>>) {
  const control = sql.identifier(refs.control.schemaName);
  return sql`(with accepted_placement as materialized (
    select ${control}.fx_accept_finite_placement_frontier(${refs.target.frontierExpected},
      ${refs.control.frontierExpected},${sql.placeholder("deploymentId")},${sql.placeholder("scopeId")}) as frontier)
    select (frontier).* from accepted_placement) placement`;
}

const installedPlacementFields = () => ({ reason: sql<string>`placement.reason`,
  scope: installedScopeFields(), receipt: installedReceiptFields(),
  targetMetadataGeneration: sql<string | null>`placement.target_metadata_generation::text`,
  controlMetadataGeneration: sql<string | null>`placement.control_metadata_generation::text` });
type InstalledPlacementRow = SelectResultFields<ReturnType<typeof installedPlacementFields>>;

/** Scope-less genuine paired admission reuses the same scalar/metadata owners.
 * The returned evidence has no placement, clock or head verdict. */
export function prepareInstalledPairAuthority(installation: PreparedCoLocatedReadInstallation, database: FlarexMetadataDatabase) {
  return Result.gen(function* () {
    const refs = yield* getCoLocatedReadInstallationReferencesResult(installation, database);
    const registerFinalGuards = Effect.fnUntraced(function* (tx: FlarexMetadataTransaction) {
      yield* registerManagedMetadataSnapshotFinalGuard(tx, database, refs.targetInstallation);
      yield* registerManagedMetadataSnapshotFinalGuard(tx, database, refs.controlInstallation);
    }, work => observeExecution("InstalledPair.registerFinalGuards", work));
    const accept = Effect.fnUntraced(function* (tx: FlarexMetadataTransaction,
      row: SelectResultFields<ReturnType<typeof coLocatedInstallationFrontierFields>>) {
      yield* Effect.fromResult(getCoLocatedReadInstallationReferencesResult(installation, database));
      if (row.reason === "resourceFailure") return yield* Effect.fail(installedFailure("resourceFailure"));
      if (row.reason !== "accepted") return yield* Effect.fail(installedFailure("invalidAuthority"));
      const generations = yield* acceptCoLocatedInstallationFrontier(installation, database, tx, row);
      const target = yield* recordManagedMetadataFrontierSnapshot(tx, database, refs.targetInstallation, generations.targetMetadataGeneration);
      const control = yield* recordManagedMetadataFrontierSnapshot(tx, database, refs.controlInstallation, generations.controlMetadataGeneration);
      if (hasProtectedMetadataFinalGuardScope(tx)) yield* registerFinalGuards(tx);
      return Object.freeze({ target, control });
    }, work => observeExecution("InstalledPair.accept", work));
    return Object.freeze({ source: sql`${coLocatedInstallationFrontierSource(refs)} installed`,
      fields: coLocatedInstallationFrontierFields(), accept, registerFinalGuards });
  });
}

/** One actual scoped placement observation. The issuer's expected identities
 * are immutable; admission and both metadata generations come from this query.
 * Actual scoped callers must provide a positive statement timeout <=30 seconds;
 * this owner never installs or overrides a session budget. */
export function prepareInstalledPlacementAuthority(installation: PreparedCoLocatedReadInstallation,
  database: FlarexMetadataDatabase, physicalLocator: ScopePhysicalLocator) {
  const capturedLocator = Object.freeze({ ...physicalLocator });
  return Result.gen(function* () {
    const refs = yield* getCoLocatedReadInstallationReferencesResult(installation, database);
    if (capturedLocator.schemaName !== refs.target.schemaName) return yield* Result.fail(installedFailure("invalidAuthority"));
    const pair = yield* prepareInstalledPairAuthority(installation, database);
    const registerFinalGuards = pair.registerFinalGuards;
    const observe = Effect.fnUntraced(function* (tx: FlarexMetadataTransaction, row: InstalledPlacementRow) {
      const { target, control } = yield* pair.accept(tx, row);
      const scope = yield* Effect.try({ try: () => decodeScopeMetadataRecord(row.scope), catch: cause => installedFailure("invalidAuthority", cause) });
      const receiptScopeId = row.receipt.scopeId;
      const receipt = receiptScopeId === null ? null : yield* Effect.try({ try: () =>
        decodeScopeAuthorityProvisioningReceipt({ ...row.receipt, scopeId: receiptScopeId }), catch: cause => installedFailure("invalidAuthority", cause) });
      return Object.freeze({ scope, receipt, target, control });
    }, work => observeExecution("InstalledPlacement.observe", work));
    const accept = Effect.fnUntraced(function* (tx: FlarexMetadataTransaction,
      selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>, row: InstalledPlacementRow) {
      const observed = yield* observe(tx, row);
      yield* Effect.fromResult(resolveTrustedScopePlacementSnapshotResult(selection, observed.scope, observed.receipt, capturedLocator));
      return observed;
    }, work => observeExecution("InstalledPlacement.accept", work));
    return Object.freeze({ source: installedPlacementSource(refs), fields: installedPlacementFields(), accept,
      // Clock-owning callers preserve their established decode/refusal order,
      // then resolve complete placement+clock authority with the existing owner.
      observe, registerFinalGuards });
  });
}

// These explicit fixed groups match select's insertion order. Drizzle's
// session applies its own nested result mapping and column decoders.
function orderInstalledFields(selected: Readonly<{
  reason: SQL<string>; targetMetadataGeneration: SQL<string | null>; controlMetadataGeneration: SQL<string | null>; safePath: SQL<string>;
  scope: ReturnType<typeof installedScopeFields>; receipt: ReturnType<typeof installedReceiptFields>;
  clock: ReturnType<typeof installedClockFields>;
}>): SelectedFieldsOrdered {
  return [
    { path: ["reason"], field: selected.reason },
    ...Object.entries(selected.scope).map(([key, field]) => ({ path: ["scope", key], field })),
    ...Object.entries(selected.receipt).map(([key, field]) => ({ path: ["receipt", key], field })),
    { path: ["targetMetadataGeneration"], field: selected.targetMetadataGeneration },
    { path: ["controlMetadataGeneration"], field: selected.controlMetadataGeneration },
    { path: ["safePath"], field: selected.safePath },
    ...Object.entries(selected.clock).map(([key, field]) => ({ path: ["clock", key], field })),
  ];
}

/** Pure installed SQL/projection topology. Query builders and sessions end at
 * compilation; every transaction observation remains with its fresh owner. */
function compileInstalledAttemptScopePlan(database: FlarexMetadataDatabase,
  refs: Result.Result.Success<ReturnType<typeof getCoLocatedReadInstallationReferencesResult>>) {
  const target = sql.identifier(refs.target.schemaName);
  const authorityTable = sql.identifier(getTableName(fxSystemScopeExecutionAuthorities));
  const clockTable = sql.identifier(getTableName(fxSystemScopeClocks));
  const fields = {
    ...installedPlacementFields(),
    safePath: sql<string>`pg_catalog.set_config('search_path', pg_catalog.format('%I, pg_temp', ${refs.target.schemaName}::text), true)`,
    clock: installedClockFields(),
  };
  const orderedFields = orderInstalledFields(fields);
  const installedSource = (protection: "share" | "attempt") => sql`${installedPlacementSource(refs)}
    left join lateral (select * from ${target}.${authorityTable} where placement.reason = 'accepted'
      and ${sql.identifier(fxSystemScopeExecutionAuthorities.scopeId.name)} = ${fields.scope.scopeId} for share) as scope_authority on true
    left join lateral (select * from ${target}.${clockTable} where placement.reason = 'accepted'
      and ${sql.identifier(fxSystemScopeClocks.scopeId.name)} = scope_authority.${sql.identifier(fxSystemScopeExecutionAuthorities.scopeId.name)}
      ${protection === "attempt" ? sql`for no key update` : sql`for share`}) as fx_system_scope_clock on true
    `;
  const share = database.select(fields).from(installedSource("share")).limit(2);
  const attempt = database.select(fields).from(installedSource("attempt")).limit(2);
  const compiled = { share: Object.freeze(share.toSQL()), attempt: Object.freeze(attempt.toSQL()) };
  return Object.freeze({ compiled: Object.freeze(compiled), fields, orderedFields });
}
type InstalledAttemptScopePlan = ReturnType<typeof compileInstalledAttemptScopePlan>;
type InstalledAttemptScopeRow = SelectResultFields<InstalledAttemptScopePlan["fields"]>;
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
      deploymentId: string; scopeId: ScopeId; protection: "share" | "attempt";
    }>>();
    const { compiled, orderedFields } = plan;
    const placement = yield* prepareInstalledPlacementAuthority(installation, database, capturedLocator);
    const acceptInstalledRow = Effect.fnUntraced(function* (tx: FlarexMetadataTransaction,
      selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>, row: InstalledAttemptScopeRow) {
      const { scope, receipt } = yield* placement.observe(tx, row);
      const clock = yield* Effect.fromResult(decodeScopeClockRecordResult(row.clock));
      const authority = yield* Effect.fromResult(resolveTrustedScopeAuthoritySnapshotResult(selection, scope, receipt, capturedLocator, clock));
      const executionAuthority = yield* decodeExecutionAuthority(row.clock).pipe(
        Effect.mapError(cause => installedFailure("invalidAuthority", cause)));
      return Object.freeze({ authority, executionAuthority, row: row.clock });
    }, work => observeExecution("InstalledScopeAuthority.acceptRow", work));
    const lock = Effect.fnUntraced(function* (tx: FlarexMetadataTransaction,
      selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>, protection: "share" | "attempt") {
      yield* Effect.fromResult(getCoLocatedReadInstallationReferencesResult(installation, database));
      const rows = yield* Effect.tryPromise({ try: () => tx._.session.prepareQuery<PreparedQueryConfig & {
        execute: InstalledAttemptScopeRow[];
      }>(compiled[protection], orderedFields, undefined, true).execute(selection),
        catch: cause => installedFailure("resourceFailure", cause) });
      const row = rows[0];
      if (rows.length !== 1 || row === undefined) return yield* Effect.fail(installedFailure("invalidAuthority"));
      if (row.reason === "resourceFailure") return yield* Effect.fail(installedFailure("resourceFailure"));
      if (row.reason === "accepted" && row.clock.scopeId === null) return yield* Effect.fail(installedFailure("invalidAuthority"));
      const accepted = yield* acceptInstalledRow(tx, selection, row);
      acceptedTransactions.set(tx, Object.freeze({ ...selection, protection }));
      return accepted;
    }, work => observeExecution("InstalledScopeAuthority.lockAttempt", work));
    const requireAcceptedTransaction = (
      tx: FlarexMetadataTransaction, selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>, protection: "share" | "attempt",
    ) => Result.gen(function* () {
      yield* requireCoLocatedInstallationAdmissionResult(installation, database, tx);
      const accepted = acceptedTransactions.get(tx);
      if (accepted === undefined || accepted.deploymentId !== selection.deploymentId || accepted.scopeId !== selection.scopeId ||
        accepted.protection !== protection) return yield* Result.fail(installedFailure("invalidAuthority"));
    });
    const closeAcceptedTransaction = (tx: FlarexMetadataTransaction) => { acceptedTransactions.delete(tx); };
    const registerFinalGuards = Effect.fnUntraced(function* (tx: FlarexMetadataTransaction,
      selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>, protection: "share" | "attempt") {
      yield* Effect.fromResult(requireAcceptedTransaction(tx, selection, protection));
      yield* placement.registerFinalGuards(tx);
    }, work => observeExecution("InstalledScopeAuthority.registerFinalGuards", work));
    const requireDatabase = (candidate: FlarexMetadataDatabase) => candidate === database ? Result.succeed(undefined) :
      Result.fail(installedFailure("invalidAuthority"));
    return Object.freeze({ lock, requireAcceptedTransaction, closeAcceptedTransaction, registerFinalGuards, requireDatabase });
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
    const locator = sql`jsonb_build_object('kind', ${physicalLocator.kind}::text,
      'databaseKey', ${physicalLocator.databaseKey}::text, 'schemaName', ${physicalLocator.schemaName}::text)`;
    const source = installedPlacementSource(refs);
    const acceptedScope = sql`case when placement.reason = 'accepted' and placement.scope_id = ${sql.placeholder("scopeId")}
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
    return Object.freeze({ source, acceptedScope, schemaName: refs.target.schemaName, controlSchemaName: refs.control.schemaName,
      targetMetadataEpoch: sql<string | null>`placement.target_metadata_generation::text`,
      controlMetadataEpoch: sql<string | null>`placement.control_metadata_generation::text` });
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
