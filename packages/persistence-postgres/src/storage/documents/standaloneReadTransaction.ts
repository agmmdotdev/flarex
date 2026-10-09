import { sql } from "drizzle-orm";
import type { PreparedQueryConfig } from "drizzle-orm/pg-core";
import type { SelectedFieldsOrdered } from "drizzle-orm/pg-core/query-builders/select.types";
import type { SelectResultFields } from "drizzle-orm/query-builders/select.types";
import { Data, Effect } from "effect";
import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { fxSystemApplicationActiveHeads as applicationHeads } from "../../application/applicationActivationSchema";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import { MAX_BINDING_BYTES } from "../../installation/frameworkSchema/binding/model";
import { fxSystemDataBindingHeads as bindingHeads } from "../../installation/frameworkSchema/binding/schema";
import { getCoLocatedReadInstallationReferences,
  type PreparedCoLocatedReadInstallation } from "../../installation/installationLifecycle";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { fxSystemLogicalSourceInitializations as sourceInitializations } from "../catalog/logicalStorageInitialization";
import { prepareInstalledPlacementAuthority, installedClockFields } from "../../scope/scopeAuthorityControlRead";
import type { ScopePhysicalLocator } from "../../scope/scopeMetadataTypes";
import { resolveTrustedScopeAuthoritySnapshotResult } from "../../scope/scopeAuthorityResolution";
import { closeExactAttemptScopeClockObservation, decodeScopeClockRecordResult,
  decodeScopeAuthorizationRevocationEpochResult, openExactAttemptScopeClockObservation } from "../../scope/scopeClock";
import { withStandaloneReadSnapshot } from "./standaloneReadSnapshot";

export class StandaloneReadTransactionError extends Data.TaggedError("StandaloneReadTransactionError")<{
  readonly reason: "invalidAuthority" | "resourceFailure";
  readonly cause?: unknown;
}> {}
const failure = (reason: StandaloneReadTransactionError["reason"], cause?: unknown) =>
  new StandaloneReadTransactionError({ reason, ...(cause === undefined ? {} : { cause }) });
const statementDigest = makeLivePrivateSha256V1({
  invalidBudget: () => failure("resourceFailure"), invalidBytes: () => failure("resourceFailure"),
  inputBytesExceeded: () => failure("resourceFailure"), unavailable: () => failure("resourceFailure"),
  nativeRejected: cause => failure("resourceFailure", cause), invalidDigestOutput: () => new Error("Invalid read statement digest"),
});


/** One fixed scope and two installed namespaces, without any catalog walk.
 * Current placement remains authoritative even when a route was retained. */
export const prepareStandaloneReadTransaction = Effect.fn("StandaloneReadTransaction.prepare")(
  function* (input: Readonly<{ database: FlarexMetadataDatabase; installation: PreparedCoLocatedReadInstallation;
    deploymentId: string; scopeId: ScopeId; physicalLocator: ScopePhysicalLocator;
    sourceInitialization?: Readonly<{ sourceKey: string; stepId: string }> }>) {
    const { database, installation, deploymentId, scopeId } = input;
    const physicalLocator = Object.freeze({ ...input.physicalLocator });
    const refs = yield* getCoLocatedReadInstallationReferences(installation, database);
    if (physicalLocator.schemaName !== refs.target.schemaName)
      return yield* Effect.fail(failure("invalidAuthority"));
    const placement = yield* Effect.fromResult(prepareInstalledPlacementAuthority(installation, database, physicalLocator));
    const target = sql.identifier(refs.target.schemaName);
    const sourceInitialization = input.sourceInitialization === undefined ? undefined : Object.freeze({ ...input.sourceInitialization });
    const entrySource = sql`${placement.source}
    left join lateral (select * from ${target}.fx_system_scope_execution_authority
      where placement.reason = 'accepted' and scope_id = placement.scope_id for key share) as scope_authority on true
    left join lateral (select * from ${target}.fx_system_scope_clock
      where scope_id = scope_authority.scope_id for key share) as fx_system_scope_clock on true
    left join lateral (select * from ${target}.fx_system_data_binding_head
      where scope_id = fx_system_scope_clock.scope_id and storage_generation = scope_authority.storage_generation
      for share) as fx_system_data_binding_head on true
    left join lateral (select activation_sequence, readiness_contract_version, revision_id, head_sha256,
      activation_sha256, readiness_sha256 from ${target}.fx_system_application_active_head
      where scope_id = coalesce(fx_system_data_binding_head.scope_id, fx_system_scope_clock.scope_id)
      for share) as fx_system_application_active_head on true
    ${sourceInitialization === undefined ? sql`` : sql`left join ${target}.fx_system_logical_source_initialization as source_initialization
      on source_initialization.scope_uuid = fx_system_scope_clock.scope_uuid
      and source_initialization.source_key = ${sourceInitialization.sourceKey}
      and source_initialization.step_id = ${sourceInitialization.stepId}`}`;
    const fields = {
        ...placement.fields,
        safePath: sql<string>`pg_catalog.set_config('search_path', pg_catalog.format('%I, pg_temp', ${refs.target.schemaName}::text), true)`,
        clock: installedClockFields(),
        applicationHead: { sequence: sql`fx_system_application_active_head.${sql.identifier(applicationHeads.activationSequence.name)}`.mapWith(applicationHeads.activationSequence),
          readinessContractVersion: sql`fx_system_application_active_head.${sql.identifier(applicationHeads.readinessContractVersion.name)}`.mapWith(applicationHeads.readinessContractVersion),
          revisionId: sql`fx_system_application_active_head.${sql.identifier(applicationHeads.revisionId.name)}`.mapWith(applicationHeads.revisionId),
          headSha256: sql`fx_system_application_active_head.${sql.identifier(applicationHeads.headSha256.name)}`.mapWith(applicationHeads.headSha256),
          activationSha256: sql`fx_system_application_active_head.${sql.identifier(applicationHeads.activationSha256.name)}`.mapWith(applicationHeads.activationSha256),
          readinessSha256: sql`fx_system_application_active_head.${sql.identifier(applicationHeads.readinessSha256.name)}`.mapWith(applicationHeads.readinessSha256) },
        bindingHead: { scopeId: sql`fx_system_data_binding_head.${sql.identifier(bindingHeads.scopeId.name)}`.mapWith(bindingHeads.scopeId),
          storageGeneration: sql`fx_system_data_binding_head.${sql.identifier(bindingHeads.storageGeneration.name)}`.mapWith(bindingHeads.storageGeneration),
          sha256: sql`fx_system_data_binding_head.${sql.identifier(bindingHeads.sha256.name)}`.mapWith(bindingHeads.sha256),
          canonicalByteLength: sql`fx_system_data_binding_head.${sql.identifier(bindingHeads.canonicalByteLength.name)}`.mapWith(bindingHeads.canonicalByteLength),
          sequence: sql`fx_system_data_binding_head.${sql.identifier(bindingHeads.sequence.name)}`.mapWith(bindingHeads.sequence),
          activationSha256: sql`fx_system_data_binding_head.${sql.identifier(bindingHeads.activationSha256.name)}`.mapWith(bindingHeads.activationSha256),
          candidateSha256: sql`fx_system_data_binding_head.${sql.identifier(bindingHeads.candidateSha256.name)}`.mapWith(bindingHeads.candidateSha256),
          canonicalBytes: sql<Uint8Array | null>`case when
          octet_length(fx_system_data_binding_head.${sql.identifier(bindingHeads.canonicalBytes.name)}) between 1 and ${MAX_BINDING_BYTES} then fx_system_data_binding_head.${sql.identifier(bindingHeads.canonicalBytes.name)} else null end` },
        ...(sourceInitialization === undefined ? {} : { sourceInitialization: {
          sourceKey: sql<string | null>`source_initialization.source_key`,
          stepId: sql<string>`source_initialization.step_id`, sourceSha256: sql<string>`source_initialization.source_sha256`,
          contractSha256: sql<string>`source_initialization.contract_sha256`,
          datasetSha256: sql<string>`source_initialization.dataset_sha256`,
          rowCount: sql`source_initialization.row_count`.mapWith(sourceInitializations.rowCount),
        } }),
      };
    const statement = Object.freeze(database.select(fields).from(entrySource).limit(2).toSQL());
    const orderedFields: SelectedFieldsOrdered = [
      { path: ["reason"], field: fields.reason },
      ...Object.entries(fields.scope).map(([name, field]) => ({ path: ["scope", name], field })),
      ...Object.entries(fields.receipt).map(([name, field]) => ({ path: ["receipt", name], field })),
      { path: ["targetMetadataGeneration"], field: fields.targetMetadataGeneration },
      { path: ["controlMetadataGeneration"], field: fields.controlMetadataGeneration },
      { path: ["safePath"], field: fields.safePath },
      ...Object.entries(fields.clock).map(([name, field]) => ({ path: ["clock", name], field })),
      ...Object.entries(fields.applicationHead).map(([name, field]) => ({ path: ["applicationHead", name], field })),
      ...Object.entries(fields.bindingHead).map(([name, field]) => ({ path: ["bindingHead", name], field })),
      ...(fields.sourceInitialization === undefined ? [] : Object.entries(fields.sourceInitialization)
        .map(([name, field]) => ({ path: ["sourceInitialization", name], field }))),
    ];
    const statementBytes = new TextEncoder().encode(statement.sql);
    const statementName = `fx_sr_${encodeBytesToLowercaseHex(yield* statementDigest(statementBytes,
      { maximumInputBytes: statementBytes.byteLength })).slice(0, 56)}`;
    const enter = Effect.fn("StandaloneReadTransaction.enter")(function* (tx: FlarexMetadataTransaction) {
      const rows = yield* Effect.tryPromise({ try: () => tx._.session.prepareQuery<PreparedQueryConfig & {
        execute: SelectResultFields<typeof fields>[];
      }>(statement, orderedFields, statementName, true).execute({ deploymentId, scopeId }),
        catch: cause => failure("resourceFailure", cause) });
      const row = rows[0];
      if (rows.length !== 1 || row === undefined)
        return yield* Effect.fail(failure("invalidAuthority"));
      if (row.reason === "resourceFailure") return yield* Effect.fail(failure("resourceFailure"));
      if (row.reason === "accepted" && row.clock.scopeId === null) return yield* Effect.fail(failure("invalidAuthority"));
      const { scope, receipt } = yield* placement.observe(tx, row).pipe(
        Effect.mapError(cause => failure("reason" in cause && cause.reason === "resourceFailure" ? "resourceFailure" : "invalidAuthority", cause)));
      const clock = yield* Effect.fromResult(decodeScopeClockRecordResult(row.clock));
      const authority = yield* Effect.fromResult(resolveTrustedScopeAuthoritySnapshotResult(
        { deploymentId, scopeId }, scope, receipt, physicalLocator, clock));
      const revocation = yield* Effect.fromResult(decodeScopeAuthorizationRevocationEpochResult(scopeId, row.clock.authorizationRevocationEpoch));
      return Object.freeze({ clock, authority, revocation,
        snapshot: { applicationHead: row.applicationHead.sequence === null ? null : row.applicationHead,
          bindingHead: row.bindingHead.scopeId === null ? null : row.bindingHead,
          ...(sourceInitialization === undefined ? {} : { sourceInitialization: { ...sourceInitialization,
            receipt: row.sourceInitialization?.sourceKey == null ? null : { ...row.sourceInitialization,
              sourceKey: row.sourceInitialization.sourceKey } } }) } });
    });
    const withSnapshot = Effect.fn("StandaloneReadTransaction.withSnapshot")(function* <Value, Failure, Requirements>(
      tx: FlarexMetadataTransaction, entry: Effect.Success<ReturnType<typeof enter>>,
      work: () => Effect.Effect<Value, Failure, Requirements>) {
      return yield* Effect.sync(() => openExactAttemptScopeClockObservation(tx, entry.clock, entry.revocation, "snapshot")).pipe(
        Effect.andThen(() => withStandaloneReadSnapshot(installation, database, tx, scopeId, entry.snapshot, work)),
        Effect.ensuring(Effect.sync(() => closeExactAttemptScopeClockObservation(tx))),
      );
    });
    return Object.freeze({ enter, withSnapshot, references: refs });
  },
);
