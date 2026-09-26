import { Data, Effect } from "effect";
import { and, desc, eq, sql } from "drizzle-orm";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import type { FlarexMetadataDatabase } from "./deployments";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import { runDrizzleStatementEffect } from "./drizzleStatementEffect";
import { readLogicalStorageRequirements } from "./logicalStorageDefinitions";
import { fxAppRowCurrent, fxSystemSearchBuildStates } from "./schema";
import { lockScopeClockForSnapshotReadInTransactionEffect, lockScopeClockForUpdateInTransactionEffect } from "./scopeClock";
import type { ScopeClockRecord } from "./scopeClock";
import type { TrustedScopeAuthority } from "./scopeAuthorityResolution";
import { getStableLogicalIndexIdentityByNameEffect } from "./stableLogicalIndexCatalog";

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
) {
  const requirements = yield* readLogicalStorageRequirements(controlDb, deploymentId, schemaVersionId);
  const definitions = [];
  for (const requirement of requirements.search) {
    const identity = yield* getStableLogicalIndexIdentityByNameEffect(controlDb, {
      deploymentId, tableId: requirement.tableId, descriptor: requirement.descriptor,
    }).pipe(Effect.mapError(cause => failure("definitionMissing", cause)));
    if (identity === null) return yield* Effect.fail(failure("definitionMissing"));
    definitions.push(Object.freeze({ tableId: requirement.tableId, logicalIndexId: identity.logicalIndexId,
      sourceSha256: requirement.sourceSha256 }));
  }
  const selected = Object.freeze(definitions);

  /** A serving decision observes every declared search index and the current
   * row frontier. A missing or stale coverage row never grants search reads. */
  const inspect = Effect.fn("LogicalSearchBuild.inspect")(function* (
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
  ) {
    if (authority.deploymentId !== deploymentId || clock.scopeId !== authority.scopeId ||
      clock.epoch !== authority.epoch || clock.storageGeneration !== authority.storageGeneration ||
      clock.storageGenerationFence !== authority.storageGenerationFence)
      return yield* Effect.fail(failure("scopeMismatch"));
    const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(authority.scopeId))
      .pipe(Effect.mapError(cause => failure("scopeMismatch", cause)));
    let observedClock = clock;
    for (let refresh = 0; refresh < 3; refresh++) {
      let uncovered = false;
      for (const definition of selected) {
        const states = yield* runDrizzleStatementEffect(tx.select({
          sourceSha256: fxSystemSearchBuildStates.sourceSha256,
          lifecycle: fxSystemSearchBuildStates.lifecycle,
          coveredThroughCommitSeq: fxSystemSearchBuildStates.coveredThroughCommitSeq,
          physicalReady: sql<boolean>`exists (
            select 1 from pg_catalog.pg_class index_class
            join pg_catalog.pg_namespace index_namespace on index_namespace.oid = index_class.relnamespace
            join pg_catalog.pg_index physical_index on physical_index.indexrelid = index_class.oid
            join pg_catalog.pg_class source_table on source_table.oid = physical_index.indrelid
            join pg_catalog.pg_namespace source_namespace on source_namespace.oid = source_table.relnamespace
            join pg_catalog.pg_am access_method on access_method.oid = index_class.relam
            join pg_catalog.pg_attribute scope_attribute on scope_attribute.attrelid = source_table.oid
              and scope_attribute.attnum = physical_index.indkey[0]
            join pg_catalog.pg_attribute index_attribute on index_attribute.attrelid = source_table.oid
              and index_attribute.attnum = physical_index.indkey[1]
            join pg_catalog.pg_attribute text_attribute on text_attribute.attrelid = source_table.oid
              and text_attribute.attnum = physical_index.indkey[2]
            join pg_catalog.pg_opclass scope_opclass on scope_opclass.oid = physical_index.indclass[0]
            join pg_catalog.pg_opclass index_opclass on index_opclass.oid = physical_index.indclass[1]
            join pg_catalog.pg_opclass text_opclass on text_opclass.oid = physical_index.indclass[2]
            where index_namespace.nspname = current_schema()
              and source_namespace.nspname = current_schema()
              and index_class.relname = 'fx_app_search_entry_current_lookup_gin'
              and source_table.relname = 'fx_app_search_entry_current'
              and access_method.amname = 'gin'
              and physical_index.indisvalid and physical_index.indisready
              and physical_index.indpred is null
              and physical_index.indnatts = 3
              and physical_index.indnkeyatts = 3
              and scope_attribute.attname = 'scope_uuid'
              and index_attribute.attname = 'logical_index_id'
              and text_attribute.attname = 'folded_text'
              and scope_opclass.opcname = 'uuid_ops'
              and index_opclass.opcname = 'int4_ops'
              and text_opclass.opcname = 'gin_trgm_ops'
          )`,
        }).from(fxSystemSearchBuildStates).where(and(
          eq(fxSystemSearchBuildStates.scopeUuid, scope.scopeUuid),
          eq(fxSystemSearchBuildStates.tableId, definition.tableId),
          eq(fxSystemSearchBuildStates.logicalIndexId, definition.logicalIndexId),
        )).limit(1), cause => failure("statementFailure", cause));
        const state = states[0];
        if (state === undefined || !state.physicalReady || state.lifecycle !== "ready" || state.sourceSha256 !== definition.sourceSha256)
          return Object.freeze({ status: "not_ready" as const, reason: "uncovered" as const });
        const frontier = yield* runDrizzleStatementEffect(tx.select({ commitSeq: fxAppRowCurrent.commitSeq })
          .from(fxAppRowCurrent).where(and(eq(fxAppRowCurrent.scopeUuid, scope.scopeUuid),
            eq(fxAppRowCurrent.tableId, definition.tableId)))
          .orderBy(desc(fxAppRowCurrent.commitSeq)).limit(1), cause => failure("statementFailure", cause));
        if (state.coveredThroughCommitSeq > observedClock.lastCommitSeq ||
          state.coveredThroughCommitSeq < (frontier[0]?.commitSeq ?? 0n)) {
          uncovered = true;
          break;
        }
      }
      if (!uncovered) return Object.freeze({ status: "ready" as const, definitionCount: selected.length });
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

  /** Only an empty target table can be marked ready without a backfill. The
   * scope lock excludes writes until the coverage row is committed. */
  const advanceEmpty = Effect.fn("LogicalSearchBuild.advanceEmpty")(function* (
    tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority,
  ) {
    if (authority.deploymentId !== deploymentId) return yield* Effect.fail(failure("scopeMismatch"));
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
  return Object.freeze({ advanceEmpty, inspect, definitionCount: selected.length });
});
