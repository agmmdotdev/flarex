import { Data, Effect, Result } from "effect";
import { and, desc, eq, sql } from "drizzle-orm";
import type { CatalogIndexId, CatalogTableId } from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, projectScopeIdUuidV1Result, type CommitSeq } from "flarex-protocol/storage-authority";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { readLogicalStorageRequirements, requirePreparedLogicalStorageRequirements, type PreparedLogicalStorageRequirements } from "../catalog/logicalStorageDefinitions";
import { fxAppRowCurrent, fxSystemSearchBuildStates } from "../../database/schema";
import { lockScopeClockForSnapshotReadInTransactionEffect, lockScopeClockForUpdateInTransactionEffect } from "../../scope/scopeClock";
import type { ScopeClockRecord } from "../../scope/scopeClock";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import { getStableLogicalIndexIdentityByNameEffect } from "../catalog/stableLogicalIndexCatalog";
import { readAppTableWriteFrontiersInTransactionEffect, type AppRowTableFrontierCorruptionError } from "../documents/appRows";
import { readPreparedIndexCoverageTableFrontiers, type IndexCoverageContext } from "../indexes/indexBuildStates";
import { runEffectTransaction } from "../../database/effectTransaction";
import { chargeHostPreparation } from "../../execution/preparation/preparedHostRuntime";
import { invalidateAcceptedApplicationBindingInTransaction } from "../../application/activation/acceptedBinding";
import { invalidateSharedLogicalSourceBindingChecks } from "../documents/logicalDocuments/sourceAdmission";
import { defineNativeMetadataRead } from "../../database/physicalSession/drizzle";
import { Schema } from "effect";

const physicalSearchIndexReady = (physical: Readonly<{
  index: string; table: string; column: string; operator: string;
}>) => sql<boolean>`exists (
  select 1 from pg_catalog.pg_index physical_index
  where physical_index.indexrelid = pg_catalog.to_regclass(
      pg_catalog.quote_ident(current_schema()) || '.' || pg_catalog.quote_ident(${physical.index}))
    and physical_index.indrelid = pg_catalog.to_regclass(
      pg_catalog.quote_ident(current_schema()) || '.' || pg_catalog.quote_ident(${physical.table}))
    and physical_index.indisvalid and physical_index.indisready
    and physical_index.indpred is null
    and physical_index.indnatts = 3
    and physical_index.indnkeyatts = 3
    and (select access_method.amname from pg_catalog.pg_class index_class
      join pg_catalog.pg_am access_method on access_method.oid = index_class.relam
      where index_class.oid = physical_index.indexrelid) = 'gin'
    and (select attribute.attname from pg_catalog.pg_attribute attribute
      where attribute.attrelid = physical_index.indrelid
        and attribute.attnum = physical_index.indkey[0]) = 'scope_uuid'
    and (select attribute.attname from pg_catalog.pg_attribute attribute
      where attribute.attrelid = physical_index.indrelid
        and attribute.attnum = physical_index.indkey[1]) = 'logical_index_id'
    and (select attribute.attname from pg_catalog.pg_attribute attribute
      where attribute.attrelid = physical_index.indrelid
        and attribute.attnum = physical_index.indkey[2]) = ${physical.column}
    and (select opclass.opcname from pg_catalog.pg_opclass opclass
      where opclass.oid = physical_index.indclass[0]) = 'uuid_ops'
    and (select opclass.opcname from pg_catalog.pg_opclass opclass
      where opclass.oid = physical_index.indclass[1]) = 'int4_ops'
    and (select opclass.opcname from pg_catalog.pg_opclass opclass
      where opclass.oid = physical_index.indclass[2]) = ${physical.operator}
)`;

const jsonPhysicalReady = physicalSearchIndexReady({
  index: "fx_app_json_entry_current_lookup_gin", table: "fx_app_json_entry_current",
  column: "value_json", operator: "jsonb_path_ops",
});
const textPhysicalReady = physicalSearchIndexReady({
  index: "fx_app_search_entry_current_lookup_gin", table: "fx_app_search_entry_current",
  column: "folded_text", operator: "gin_trgm_ops",
});
const SEARCH_STATE_BATCH_SIZE = 64;
const parameter=(name:string)=>sql`${sql.placeholder(name)}`;
const captureSearchBatch=defineNativeMetadataRead(db=>db.select({
  capture:sql<string>`observed.capture`,
}).from(sql`(select coalesce(jsonb_object_agg(state_row.table_id::text || '/' || state_row.logical_index_id::text,
    jsonb_build_array(state_row.lifecycle,state_row.source_sha256,state_row.covered_through_commit_seq::text)),'{}'::jsonb)::text as capture
    from ${fxSystemSearchBuildStates} state_row where state_row.scope_uuid=${parameter("scopeUuid")}::uuid
      and (state_row.table_id,state_row.logical_index_id) in (
        select requested.table_id,requested.logical_index_id
        from unnest(${parameter("tableIds")}::integer[],${parameter("logicalIndexIds")}::integer[])
          as requested(table_id,logical_index_id))) observed`));
const decodeSearchCapture = Schema.decodeUnknownEffect(Schema.Struct({capture:Schema.String}));
const OrdinarySearchProgressEnvelopeSchema = Schema.fromJsonString(Schema.Record(Schema.String,Schema.Unknown));
const decodeOrdinarySearchProgressEnvelope = Schema.decodeUnknownResult(OrdinarySearchProgressEnvelopeSchema);
const OrdinarySearchProgressSchema = Schema.Tuple([Schema.String,Schema.String,Schema.Unknown]);
const decodeOrdinarySearchProgress = Schema.decodeUnknownResult(OrdinarySearchProgressSchema);
const decodeOrdinarySearchCoverage = Schema.decodeUnknownResult(CommitSeqSchema);
// The original physical binding visited text before JSON, including getters.
const decodeSearchPhysical = Schema.decodeUnknownEffect(Schema.Struct({textReady:Schema.Boolean,jsonReady:Schema.Boolean}));
export class LogicalSearchBuildError extends Data.TaggedError("LogicalSearchBuildError")<{
  readonly reason: "definitionMissing" | "scopeMismatch" | "statementFailure";
  readonly cause?: unknown;
}> {}
const failure = (reason: LogicalSearchBuildError["reason"], cause?: unknown) =>
  new LogicalSearchBuildError({ reason, ...(cause === undefined ? {} : { cause }) });

/** Prepare source-complete definitions from the control catalog. The returned
 * closure is trusted build authority for exactly one deployment and schema. */
export const prepareLogicalSearchBuild = Effect.fn("LogicalSearchBuild.prepare")(function* (
  controlDb: FlarexMetadataDatabase, deploymentId: string, schemaVersionId: CatalogSchemaVersionId,
  construction: Readonly<{ kind: "fresh" }> | Readonly<{ kind: "prepared"; requirements: PreparedLogicalStorageRequirements }>,
  reader?: FlarexMetadataTransaction,
) {
  const acquire = (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
  const requirements = yield* (construction.kind === "fresh" ? readLogicalStorageRequirements(controlDb, deploymentId, schemaVersionId, tx) :
    requirePreparedLogicalStorageRequirements(controlDb, deploymentId, schemaVersionId, construction.requirements));
  const definitions = [];
  for (const requirement of requirements.search) {
    const identity = yield* getStableLogicalIndexIdentityByNameEffect(tx, {
      deploymentId, tableId: requirement.tableId, descriptor: requirement.descriptor,
    }).pipe(Effect.mapError(cause => failure("definitionMissing", cause)));
    if (identity === null) return yield* Effect.fail(failure("definitionMissing"));
    definitions.push(Object.freeze({ tableId: requirement.tableId, logicalIndexId: identity.logicalIndexId,
      sourceSha256: requirement.sourceSha256, kind: requirement.kind }));
  }
  return Object.freeze(definitions);
  });
  const selected = yield* (reader === undefined ? runEffectTransaction<Effect.Success<ReturnType<typeof acquire>>,
    Effect.Error<ReturnType<typeof acquire>>, LogicalSearchBuildError, FlarexMetadataTransaction>(callback => controlDb.transaction(callback),
    "Logical search catalog acquisition rolled back", acquire, cause => failure("statementFailure", cause)) : acquire(reader));

  const inspectDefinitions = makeLogicalSearchReadinessInspector(deploymentId);

  /** Only an empty target table can be marked ready without a backfill. The
   * scope lock excludes writes until the coverage row is committed. */
  const advanceEmpty = Effect.fn("LogicalSearchBuild.advanceEmpty")(function* (
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority,
  ) {
    if (authority.deploymentId !== deploymentId) return yield* Effect.fail(failure("scopeMismatch"));
    invalidateAcceptedApplicationBindingInTransaction(tx);
    invalidateSharedLogicalSourceBindingChecks(tx);
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, authority.scopeId)
      .pipe(Effect.mapError(cause => failure("statementFailure", cause)));
    if (clock.epoch !== authority.epoch || clock.storageGeneration !== authority.storageGeneration ||
      clock.storageGenerationFence !== authority.storageGenerationFence)
      return yield* Effect.fail(failure("scopeMismatch"));
    const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(authority.scopeId))
      .pipe(Effect.mapError(cause => failure("scopeMismatch", cause)));
    const missing: typeof selected[number][] = [];
    for (const definition of selected) {
      const existing = yield* runDrizzleStatementEffect(tx.select().from(fxSystemSearchBuildStates).where(and(
        eq(fxSystemSearchBuildStates.scopeUuid, scope.scopeUuid),
        eq(fxSystemSearchBuildStates.tableId, definition.tableId),
        eq(fxSystemSearchBuildStates.logicalIndexId, definition.logicalIndexId),
      )).limit(1), cause => failure("statementFailure", cause));
      const frontier = yield* runDrizzleStatementEffect(tx.select({ commitSeq: fxAppRowCurrent.commitSeq })
        .from(fxAppRowCurrent).where(and(eq(fxAppRowCurrent.scopeUuid, scope.scopeUuid),
          eq(fxAppRowCurrent.tableId, definition.tableId)))
        .orderBy(desc(fxAppRowCurrent.commitSeq)).limit(1), cause => failure("statementFailure", cause));
      const tableFrontier = frontier[0]?.commitSeq ?? 0n;
      const state = existing[0];
      if (state !== undefined) {
        if (state.sourceSha256 !== definition.sourceSha256 || state.lifecycle !== "ready" ||
          state.coveredThroughCommitSeq < tableFrontier)
          return Object.freeze({ status: "not_ready" as const, reason: "uncovered" as const });
        continue;
      }
      if (tableFrontier !== 0n)
        return Object.freeze({ status: "not_ready" as const, reason: "populated" as const });
      missing.push(definition);
    }
    for (const definition of missing) {
      yield* runDrizzleStatementEffect(tx.insert(fxSystemSearchBuildStates).values({
        scopeUuid: scope.scopeUuid, tableId: definition.tableId, logicalIndexId: definition.logicalIndexId,
        sourceSha256: definition.sourceSha256, lifecycle: "ready", coveredThroughCommitSeq: clock.lastCommitSeq,
      }), cause => failure("statementFailure", cause));
    }
    return Object.freeze({ status: "ready" as const, definitionCount: selected.length });
  });
  const inspect = (tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    coverage?: IndexCoverageContext) => inspectDefinitions(selected, tx, authority, clock, coverage);
  const selectTables = (tables: readonly CatalogTableId[]) => {
    const tableSet = new Set(tables);
    const inspected = Object.freeze(selected.filter(definition => tableSet.has(definition.tableId)));
    return Object.freeze({ inspectSelected: (tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority,
      clock: ScopeClockRecord, coverage?: IndexCoverageContext) => inspectDefinitions(inspected, tx, authority, clock, coverage) });
  };
  const selectedById = new Map(selected.map(definition => [definition.logicalIndexId, definition]));
  // The selected definition bodies retain their existing catalog owner; the
  // extra lookup wrapper and keys consume this construction's allocation.
  yield* chargeHostPreparation({ searchLookup: { keys: [...selectedById.keys()], entryCount: selectedById.size } });
  return Object.freeze({ advanceEmpty, inspect, selectTables,
    selectedDefinition: (id: CatalogIndexId) => selectedById.get(id),
    definitionCount: selected.length });
});

export type LogicalSearchReadDefinition = Readonly<{ tableId: CatalogTableId; logicalIndexId: CatalogIndexId; sourceSha256: string; kind: "text" | "jsonContainment" }>;

/** The existing physical/build/frontier proof, shared by full and demanded search. */
export function makeLogicalSearchReadinessInspector(deploymentId: string) {
  /** A serving decision observes every declared search index and the current
   * row frontier. A missing or stale coverage row never grants search reads. */
  const inspectDefinitions = Effect.fn("LogicalSearchBuild.inspectDefinitions")(function* (
    inspected: readonly LogicalSearchReadDefinition[], tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    coverage?: IndexCoverageContext,
  ) {
    const tableIds = Object.freeze([...new Set(inspected.map(definition => definition.tableId))]);
    const needsJsonPhysical = inspected.some(definition => definition.kind === "jsonContainment");
    const needsTextPhysical = inspected.some(definition => definition.kind !== "jsonContainment");
    if (authority.deploymentId !== deploymentId || clock.scopeId !== authority.scopeId ||
      clock.epoch !== authority.epoch || clock.storageGeneration !== authority.storageGeneration ||
      clock.storageGenerationFence !== authority.storageGenerationFence)
      return yield* Effect.fail(failure("scopeMismatch"));
    const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(authority.scopeId))
      .pipe(Effect.mapError(cause => failure("scopeMismatch", cause)));
    let observedClock = clock;
    for (let refresh = 0; refresh < 3; refresh++) {
      let uncovered = false;
      if (inspected.length === 0) return Object.freeze({ status: "ready" as const, definitionCount: 0 });
      let physical: Readonly<{ jsonReady: boolean; textReady: boolean }> | undefined;
      let frontiers: ReadonlyMap<CatalogTableId,
        Result.Result<CommitSeq | null, AppRowTableFrontierCorruptionError>> | undefined;
      for (let offset = 0; offset < inspected.length; offset += SEARCH_STATE_BATCH_SIZE) {
        const batch = inspected.slice(offset, offset + SEARCH_STATE_BATCH_SIZE);
        const [rawCapture] = yield* runDrizzleStatementEffect(captureSearchBatch(tx,{scopeUuid:scope.scopeUuid,
          tableIds:batch.map(definition=>definition.tableId),logicalIndexIds:batch.map(definition=>definition.logicalIndexId)}),
          cause=>failure("statementFailure",cause));
        const captured = yield* decodeSearchCapture(rawCapture).pipe(Effect.mapError(cause=>failure("statementFailure",cause)));
        const progress = yield* Effect.fromResult(decodeOrdinarySearchProgressEnvelope(captured.capture).pipe(
          Result.mapError(cause=>failure("statementFailure",cause))));
        const states=new Map<string,ReturnType<typeof decodeOrdinarySearchProgress>>();
        const coverageSequences=new Map<string,ReturnType<typeof decodeOrdinarySearchCoverage>>();
        const consume=(startAt:number)=>Result.gen(function* () {
          for (let index=startAt;index<batch.length;index++) {
            const definition=batch[index];
            if (definition===undefined) return yield* Result.fail(failure("statementFailure"));
            const key=`${definition.tableId}/${definition.logicalIndexId}`;
            let decoded=states.get(key);
            if (decoded===undefined) {
              const rawState=progress[key];
              if (rawState===undefined) return {status:"uncovered" as const};
              decoded=decodeOrdinarySearchProgress(rawState);
              states.set(key,decoded);
            }
            const state=yield* decoded.pipe(Result.mapError(cause=>failure("statementFailure",cause)));
            if (state[0]!=="ready" || state[1]!==definition.sourceSha256) return {status:"uncovered" as const};
            if (physical===undefined) return {status:"physicalRequired" as const,index};
            if (!(definition.kind==="jsonContainment" ? physical.jsonReady:physical.textReady))
              return {status:"uncovered" as const};
            if (frontiers===undefined) return {status:"frontiersRequired" as const,index};
            const capturedFrontier=frontiers.get(definition.tableId);
            if (capturedFrontier===undefined) throw new Error("Search table frontier lost an inspected member");
            const frontier=yield* capturedFrontier.pipe(Result.mapError(cause=>failure("statementFailure",cause)));
            // This member's sequence is consumed only after its genuine physical
            // acceptance and frontier Result. Repeated pairs retain one decode.
            let coverageSequence=coverageSequences.get(key);
            if (coverageSequence===undefined) {
              coverageSequence=decodeOrdinarySearchCoverage(state[2]);
              coverageSequences.set(key,coverageSequence);
            }
            const covered=yield* coverageSequence.pipe(Result.mapError(cause=>failure("statementFailure",cause)));
            if (covered>observedClock.lastCommitSeq || (frontier!==null && covered<frontier))
              return {status:"clockRefresh" as const};
          }
          return {status:"accepted" as const};
        });
        let startAt=0;
        for (;;) {
          const accepted=yield* Effect.fromResult(consume(startAt));
          if (accepted.status==="accepted") break;
          if (accepted.status==="uncovered") return Object.freeze({status:"not_ready" as const,reason:"uncovered" as const});
          if (accepted.status==="clockRefresh") { uncovered=true;break; }
          startAt=accepted.index;
          if (accepted.status==="physicalRequired") {
            const [observed]=yield* runDrizzleStatementEffect(tx.select({
              jsonReady:needsJsonPhysical ? jsonPhysicalReady:sql<boolean>`true`,
              textReady:needsTextPhysical ? textPhysicalReady:sql<boolean>`true`,
            }).from(sql`(select 1) as search_index_probe`),cause=>failure("statementFailure",cause));
            if (observed===undefined) return yield* Effect.fail(failure("statementFailure"));
            physical=yield* decodeSearchPhysical(observed).pipe(Effect.mapError(cause=>failure("statementFailure",cause)));
          } else {
            const prepared=coverage===undefined ? null:yield* Effect.fromResult(
              readPreparedIndexCoverageTableFrontiers(tx,observedClock,coverage,tableIds))
              .pipe(Effect.mapError(cause=>failure("statementFailure",cause)));
            frontiers=prepared??(yield* readAppTableWriteFrontiersInTransactionEffect(tx,authority.scopeId,tableIds)
              .pipe(Effect.mapError(cause=>failure("statementFailure",cause))));
          }
        }
        if (uncovered) break;
      }
      if (!uncovered) return Object.freeze({ status: "ready" as const, definitionCount: inspected.length });
      // READ COMMITTED may see a publication between the admitted clock and
      // the coverage/frontier reads. Refresh only when that clock advanced;
      // persistent or structurally invalid coverage remains a refusal.
      const afterMissClock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, clock.scopeId)
        .pipe(Effect.mapError(cause => failure("statementFailure", cause)));
      if (afterMissClock.epoch !== clock.epoch || afterMissClock.storageGeneration !== clock.storageGeneration ||
        afterMissClock.storageGenerationFence !== clock.storageGenerationFence ||
        afterMissClock.lastCommitSeq < observedClock.lastCommitSeq)
        return yield* Effect.fail(failure("scopeMismatch"));
      if (refresh < 2 && afterMissClock.lastCommitSeq > observedClock.lastCommitSeq) {
        observedClock = afterMissClock;
        continue;
      }
      return Object.freeze({ status: "not_ready" as const, reason: "uncovered" as const });
    }
    return Object.freeze({ status: "not_ready" as const, reason: "uncovered" as const });
  });

  return inspectDefinitions;
}
