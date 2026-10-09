import { setTimeout as delay } from "node:timers/promises";
import { Effect, Result, Schema } from "effect";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { decodePointMutationExactRuntimeResultV1Effect } from "flarex-protocol/point-mutation-exact-runtime";
import { CommitSeqSchema, projectScopeIdUuidV1Result, projectScopeEpochUuidV1Result } from "flarex-protocol/storage-authority";
import { appRowIdHexV1ToBytes, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { OrderedIndexBoundHexV1Schema } from "flarex-protocol/ordered-index";
import { readFrozenFiniteAttempt } from "../../persistence-postgres/src/execution/sessionJournalStore";
import { inspectLogicalParticipantAdmissionBundle, inspectLogicalParticipantAttemptAdmission } from
  "../../persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission";
import { captureFiniteStorageEffect } from "../../persistence-postgres/src/execution/finiteStorageCapture";
import { decodeCapturedAppIndexSnapshotPageEffect } from "../../persistence-postgres/src/storage/indexes/appIndexEntries";
import { consumeCapturedAppRowsAtSnapshotEffect, prepareAppRowsSnapshotReadEffect } from "../../persistence-postgres/src/storage/documents/appRows";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";
import { fxAppIndexEntryRevisions, fxAppRowCurrent, fxAppRowRevisions,
  fxSystemCommits, fxSystemScopeClocks, fxSystemIndexBuildStates, fxSystemTransactionSessions } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { lockScopeClockForOrdinaryWriteInTransactionEffect, closeExactAttemptScopeClockObservation } from
  "../../persistence-postgres/src/scope/scopeClock";
import { closeInstallationAdmission } from "../../persistence-postgres/src/installation/installationLifecycle";
import { createPointMutationSessionAttemptTerminalizationPersistenceV1 } from
  "../../persistence-postgres/src/execution/transactionSessionActivation";

type Fixture = Awaited<ReturnType<typeof createMixedMutationProductFixture>>;
const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

async function nativeFrontier(fixture: Fixture) {
  const raw = await fixture.runExecution();
  const result = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
    result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(raw);
  const value = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(result.result.result))).value;
  const frozen = await Effect.runPromise(fixture.freeze(value));
  const data = readFrozenFiniteAttempt(frozen);
  if (data === undefined) throw new Error("Missing genuine frozen Product root");
  const participantOperation = data.operations.find(candidate => candidate.kind === "participant");
  if (participantOperation?.kind !== "participant") throw new Error("Missing actual Product receipt");
  const bundle = inspectLogicalParticipantAdmissionBundle(participantOperation.admission, data.attempt,
    participantOperation.participant, participantOperation.method, participantOperation.profileRevision);
  const admission = bundle?.admissions[0], method = bundle?.sourceMethods[0]?.[0];
  if (admission === undefined || method === undefined) throw new Error("Missing original source admission");
  const source = inspectLogicalParticipantAttemptAdmission(admission, data.attempt, method);
  const definition = source?.indexes[0];
  if (definition === undefined) throw new Error("Missing original located Product index");
  const target = data.resolvedTarget.target;
  const input = { selector: data.attemptState.selector, preliminaryAuthority: data.resolvedTarget.authority,
    executionClaim: data.attemptState.executionClaim, finiteAnchor: data.anchorCapture,
    finiteReadDemand: { admission, attempt: data.attempt, method, demand: {
      kind: "index" as const, tableId: definition.access.tableId, indexDefinitionId: definition.indexDefinitionId } } };
  const operation = { kind: "indexPage" as const, tableId: definition.access.tableId, input: {
    scopeId: input.selector.scopeId, definition, bounds: {}, limit: 1, snapshotCommitSeq: data.attemptState.snapshotToken.commitSeq,
  } };
  const read = () => captureFiniteStorageEffect(target, input, operation).pipe(Effect.flatMap(captured =>
    decodeCapturedAppIndexSnapshotPageEffect(captured.prepared, captured.rawRows)));
  return { input, target, definition, operation, read };
}

describe.each(drivers)("genuine finite native frontier on %s", driver => {
  it("withholds all bodies for duplicate unique owners while preserving general hydration and lookahead", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(
        Effect.tryPromise({ try: () => createMixedMutationProductFixture({ driver, suffix: `finite-unique-hydration-${driver}` }),
          catch: cause => new Error("Acquire finite unique hydration fixture", { cause }) }),
        resource => Effect.tryPromise({ try: () => resource.close(), catch: cause => new Error("Close finite unique hydration fixture", { cause }) }).pipe(Effect.orDie));
      const frontier = yield* Effect.tryPromise({ try: () => nativeFrontier(fixture),
        catch: cause => new Error("Acquire authentic native frontier", { cause }) });
      const first = (yield* frontier.read()).entries[0];
      if (first === undefined) return yield* Effect.die("Missing real native index membership");
      const database = fixture.currency.persistence.drizzle;
      const ownerBytes = appRowIdHexV1ToBytes(first.rowId);
      const injected = ["6f000000000040008000000000000011", "6f000000000040008000000000000012"]
        .map(id => appRowIdHexV1ToBytes(decodeAppRowIdHexV1(id)));
      const indexInput = { ...frontier.operation.input, limit: 2, bounds: {
        startInclusive: OrderedIndexBoundHexV1Schema.make(first.encodedKey),
        endExclusive: OrderedIndexBoundHexV1Schema.make(`${first.encodedKey}00`),
      } };
      const capture = (unique: boolean) => captureFiniteStorageEffect(frontier.target, frontier.input, {
        kind: "indexRows", tableId: frontier.operation.tableId, input: indexInput, excludeRowIds: [],
        ...(unique ? { maximumHydratedOwners: 1 as const } : {}),
      });
      yield* Effect.tryPromise({ try: async () => {
        const [membership] = await database.select().from(fxAppIndexEntryRevisions).where(and(
          eq(fxAppIndexEntryRevisions.scopeUuid, first.scopeUuid),
          eq(fxAppIndexEntryRevisions.indexDefinitionId, first.indexDefinitionId),
          eq(fxAppIndexEntryRevisions.rowId, ownerBytes),
          eq(fxAppIndexEntryRevisions.commitSeq, first.commitSeq)));
        const [original] = await database.select().from(fxAppRowRevisions).where(and(
          eq(fxAppRowRevisions.scopeUuid, first.scopeUuid), eq(fxAppRowRevisions.tableId, first.tableId),
          eq(fxAppRowRevisions.rowId, ownerBytes),
          lte(fxAppRowRevisions.commitSeq, indexInput.snapshotCommitSeq)))
          .orderBy(desc(fxAppRowRevisions.commitSeq)).limit(1);
        if (membership === undefined || original === undefined || original.isTombstone)
          throw new Error("Missing genuine retained native row and membership");
        // Negative stored-state injection through typed tables. This deliberately
        // creates a second owner and a corrupt body, rather than publishing data.
        await database.transaction(async tx => {
          await tx.insert(fxAppRowRevisions).values({ ...original, rowId: injected[0]!, prevCommitSeq: null });
          await tx.insert(fxAppRowCurrent).values({ scopeUuid: first.scopeUuid, tableId: first.tableId,
            rowId: injected[0]!, commitSeq: original.commitSeq });
          await tx.insert(fxAppIndexEntryRevisions).values({ ...membership, rowId: injected[0]! });
          await tx.update(fxAppRowRevisions).set({ valueSha256: sql`decode(repeat('00',32),'hex')` }).where(and(
            eq(fxAppRowRevisions.scopeUuid, first.scopeUuid), eq(fxAppRowRevisions.tableId, first.tableId),
            eq(fxAppRowRevisions.rowId, ownerBytes), eq(fxAppRowRevisions.commitSeq, original.commitSeq)));
        });
        return { membership, original };
      }, catch: cause => new Error("Inject duplicate native membership", { cause }) }).pipe(Effect.flatMap(({ membership, original }) => Effect.gen(function* () {
        const unique = yield* capture(true);
        const page = yield* decodeCapturedAppIndexSnapshotPageEffect(unique.prepared, unique.rawIndexRows);
        expect(page.entries).toHaveLength(2);
        expect(page.isDone).toBe(true);
        expect(unique.rawRows).toHaveLength(0);
        const general = yield* capture(false);
        expect(general.rawIndexRows).toHaveLength(2);
        expect(general.rawRows).toHaveLength(2);
        const preparedRows = yield* prepareAppRowsSnapshotReadEffect({ scopeId: indexInput.scopeId,
          tableId: frontier.operation.tableId, rowIds: page.entries.map(entry => entry.rowId),
          snapshotCommitSeq: indexInput.snapshotCommitSeq });
        expect(yield* Effect.result(consumeCapturedAppRowsAtSnapshotEffect(preparedRows, general.rawRows,
          cause => cause, () => Effect.void))).toMatchObject({
          _tag: "Failure", failure: { _tag: "AppRowStorageCorruptionError" },
        });
        yield* Effect.tryPromise({ try: () => database.transaction(async tx => {
          await tx.insert(fxAppRowRevisions).values({ ...original, rowId: injected[1]!, prevCommitSeq: null });
          await tx.insert(fxAppRowCurrent).values({ scopeUuid: first.scopeUuid, tableId: first.tableId,
            rowId: injected[1]!, commitSeq: original.commitSeq });
          await tx.insert(fxAppIndexEntryRevisions).values({ ...membership, rowId: injected[1]! });
        }), catch: cause => new Error("Inject native lookahead membership", { cause }) });
        const lookahead = yield* capture(true);
        const lookaheadPage = yield* decodeCapturedAppIndexSnapshotPageEffect(lookahead.prepared, lookahead.rawIndexRows);
        expect(lookahead.rawIndexRows).toHaveLength(3);
        expect(lookaheadPage.entries).toHaveLength(2);
        expect(lookaheadPage.isDone).toBe(false);
        expect(lookahead.rawRows).toHaveLength(0);
      })));
    })));
  }, 180_000);

  it("captures the demanded original build and rejects a cloned admission before decoding", async () => {
    const fixture = await createMixedMutationProductFixture({ driver, suffix: `finite-frontier-${driver}` });
    try {
      const frontier = await nativeFrontier(fixture);
      const accepted = await Effect.runPromise(frontier.read());
      expect(accepted.entries.length).toBeLessThanOrEqual(frontier.operation.input.limit);
      expect(accepted.entries.every(entry => entry.commitSeq <= fixture.activation.anchor.snapshotToken.commitSeq)).toBe(true);
      let callbacks = 0;
      const verdict = await Effect.runPromise(captureFiniteStorageEffect(frontier.target,
        { ...frontier.input, finiteReadDemand: { ...frontier.input.finiteReadDemand,
          admission: structuredClone(frontier.input.finiteReadDemand.admission) } }, frontier.operation).pipe(
        Effect.tap(() => Effect.sync(() => { callbacks++; })), Effect.result));
      expect(verdict).toMatchObject({ _tag: "Failure", failure: { _tag: "FiniteStorageCaptureError", reason: "invalidAuthority" } });
      expect(callbacks).toBe(0);
    } finally { await fixture.close(); }
  }, 180_000);
});

describe.skipIf(process.env.FLAREX_POSTGRES_DATABASE_URL === undefined)("PostgreSQL finite build wait", () => {
  it("refuses an expired compact owner before callback after the demanded build wait", async () => {
    const fixture = await createMixedMutationProductFixture({ driver: "postgres", suffix: "finite-build-expiry" });
    try {
      const frontier = await nativeFrontier(fixture);
      if (fixture.currency.resource.kind !== "postgres") throw new Error("Expected genuine PostgreSQL resource");
      const persistence = fixture.currency.resource.target;
      const scopeUuid = Result.getOrThrow(projectScopeIdUuidV1Result(frontier.input.selector.scopeId)).scopeUuid;
      const committedBefore = await persistence.drizzle.select().from(fxSystemCommits)
        .where(eq(fxSystemCommits.scopeUuid, scopeUuid)).orderBy(fxSystemCommits.commitSeq);
      const eventsBefore = await persistence.drizzle.select().from(fxSystemCommitEvents)
        .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid)).orderBy(fxSystemCommitEvents.commitSeq);
      const productBefore = await fixture.readCurrentProduct();
      await persistence.query(`update fx_system_tx_session
        set finite_claimed_at=least(finite_claimed_at,statement_timestamp()-interval '1 second'),
          finite_claim_expires_at=least(hard_expires_at,statement_timestamp()+interval '2 seconds'),
          finite_lease_expires_at=least(hard_expires_at,statement_timestamp()+interval '2 seconds') where session_id=$1`,
        [frontier.input.selector.sessionId]);
      const holder = await persistence.pool.connect();
      let reading: Promise<unknown> | undefined;
      let callbacks = 0;
      try {
        await holder.query("begin");
        const pid = (await holder.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid;
        if (pid === undefined) throw new Error("Missing actual build lock holder PID");
        await holder.query("select scope_id from fx_system_scope_execution_authority where scope_id=$1 for share",
          [frontier.input.selector.scopeId]);
        await holder.query("select index_definition_id from fx_system_index_build_state where scope_id=$1 and index_definition_id=$2 for update",
          [frontier.input.selector.scopeId, frontier.definition.indexDefinitionId]);
        reading = Effect.runPromise(captureFiniteStorageEffect(frontier.target, frontier.input, frontier.operation).pipe(
          Effect.tap(() => Effect.sync(() => { callbacks++; })), Effect.result));
        const deadline = Date.now() + 5_000;
        let waited = false, expired = false;
        while (Date.now() < deadline) {
          const rows = await persistence.pool.query<{ waited: boolean; expired: boolean }>(`select
            exists(select 1 from pg_stat_activity where datname=current_database()
              and $1=any(pg_blocking_pids(pid))) as waited,
            exists(select 1 from fx_system_tx_session where session_id=$2
              and finite_lease_expires_at<=clock_timestamp()) as expired`, [pid, frontier.input.selector.sessionId]);
          waited ||= rows.rows[0]?.waited === true;
          expired = rows.rows[0]?.expired === true;
          if (waited && expired) break;
          await delay(25);
        }
        expect(waited).toBe(true);
        expect(expired).toBe(true);
        await holder.query("commit");
        expect(await reading).toMatchObject({ _tag: "Failure", failure: { _tag: "FiniteStorageCaptureError", reason: "expired" } });
        expect(callbacks).toBe(0);
        const terminal = await Effect.runPromise(createPointMutationSessionAttemptTerminalizationPersistenceV1(
          fixture.pointCommitPorts).expireEffect(fixture.selector));
        expect(terminal).toMatchObject({ status: "terminalized", terminal: { lifecycle: "expired" } });
        const [closed] = await persistence.drizzle.select().from(fxSystemTransactionSessions)
          .where(eq(fxSystemTransactionSessions.sessionId, frontier.input.selector.sessionId));
        expect(closed).toMatchObject({ lifecycle: "expired", attemptFence: frontier.input.selector.attemptFence,
          validatedArgsJson: null, validatedArgsCanonicalBytes: null, authorizationGrantJson: null,
          authorizationGrantCanonicalBytes: null, applicationExecutionAuthorityJson: null,
          applicationExecutionAuthorityCanonicalBytes: null });
        expect(await persistence.drizzle.select().from(fxSystemCommits)
          .where(eq(fxSystemCommits.scopeUuid, scopeUuid)).orderBy(fxSystemCommits.commitSeq)).toEqual(committedBefore);
        expect(await persistence.drizzle.select().from(fxSystemCommitEvents)
          .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid)).orderBy(fxSystemCommitEvents.commitSeq)).toEqual(eventsBefore);
        expect(await fixture.readCurrentProduct()).toEqual(productBefore);
      } finally { await holder.query("rollback"); holder.release(); await reading?.catch(() => undefined); }
    } finally { await fixture.close(); }
  }, 180_000);

  it("observes serving sequence in a fresh internal command after the demanded build lock wait", async () => {
    const fixture = await createMixedMutationProductFixture({ driver: "postgres", suffix: "finite-build-wait" });
    try {
      const frontier = await nativeFrontier(fixture);
      const originalPage = await Effect.runPromise(frontier.read());
      if (fixture.currency.resource.kind !== "postgres") throw new Error("Expected genuine PostgreSQL resource");
      const persistence = fixture.currency.resource.target;
      const originalStatements = await persistence.pool.query<{ name: string; statement: string }>(
        `select name, statement from pg_prepared_statements
          where name like 'fx_finite_%' and statement like '%fx_read_snapshot_index_page%'
            and statement not like '%fx_read_snapshot_rows%'`);
      expect(originalStatements.rows).toHaveLength(1);
      const originalStatement = originalStatements.rows[0];
      if (originalStatement === undefined) throw new Error("Missing actual prepared frontier index-page statement");
      let enter: (pid: number) => void = () => undefined;
      const entered = new Promise<number>(resolve => { enter = resolve; });
      let release: () => void = () => undefined;
      const released = new Promise<void>(resolve => { release = resolve; });
      const writing = persistence.drizzle.transaction(async tx => {
        try {
          const clock = await Effect.runPromise(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, frontier.input.selector.scopeId));
          const held = await tx.select({ pid: sql<number>`pg_backend_pid()` }).from(fxSystemIndexBuildStates)
            .where(and(eq(fxSystemIndexBuildStates.scopeId, frontier.input.selector.scopeId),
              eq(fxSystemIndexBuildStates.indexDefinitionId, frontier.definition.indexDefinitionId))).for("update");
          const pid = held[0]?.pid;
          if (held.length !== 1 || pid === undefined) throw new Error("Missing genuine demanded build");
          enter(pid);
          await released;
          const sequence = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
          await tx.insert(fxSystemCommits).values({
            scopeUuid: Result.getOrThrow(projectScopeIdUuidV1Result(clock.scopeId)).scopeUuid,
            epochUuid: Result.getOrThrow(projectScopeEpochUuidV1Result(clock.epoch)).epochUuid,
            commitSeq: sequence, changeCount: 0, committedAt: sql`clock_timestamp()`,
          });
          await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: sequence }).where(eq(fxSystemScopeClocks.scopeId, clock.scopeId));
          await tx.update(fxSystemIndexBuildStates).set({ coveredThroughCommitSeq: sequence })
            .where(and(eq(fxSystemIndexBuildStates.scopeId, clock.scopeId),
              eq(fxSystemIndexBuildStates.indexDefinitionId, frontier.definition.indexDefinitionId)));
          return sequence;
        } finally { closeExactAttemptScopeClockObservation(tx); closeInstallationAdmission(tx); }
      });
      void writing.catch(() => undefined);
      let reading: Promise<Effect.Success<ReturnType<typeof frontier.read>>> | undefined;
      try {
        const pid = await Promise.race([entered, writing.then(() => { throw new Error("Writer completed before its lock barrier"); })]);
        reading = Effect.runPromise(frontier.read());
        void reading.catch(() => undefined);
        const deadline = Date.now() + 5_000;
        let waited = false;
        while (Date.now() < deadline) {
          const rows = await persistence.pool.query<{ waited: boolean }>(`select exists(select 1 from pg_stat_activity
            where datname=current_database() and $1=any(pg_blocking_pids(pid))) as waited`, [pid]);
          if (rows.rows[0]?.waited === true) { waited = true; break; }
          await delay(25);
        }
        expect(waited).toBe(true);
        release();
        const sequence = await writing;
        // Updated coverage exceeds the statement's initial serving sequence.
        // Only a fresh post-wait sequence can admit this unchanged snapshot page.
        expect(await reading).toEqual(originalPage);
        expect(await Effect.runPromise(frontier.read())).toEqual(originalPage);
        const preparedStatements = await persistence.pool.query<{ name: string; from_sql: boolean; executions: string }>(
          `select name, from_sql, (generic_plans + custom_plans)::text as executions
            from pg_prepared_statements where name=$1 and statement=$2`,
          [originalStatement.name, originalStatement.statement]);
        expect(preparedStatements.rows).toHaveLength(1);
        expect(preparedStatements.rows[0]).toMatchObject({ name: originalStatement.name, from_sql: false });
        expect(Number(preparedStatements.rows[0]?.executions)).toBeGreaterThanOrEqual(2);
        expect(await persistence.drizzle.select({ coverage: fxSystemIndexBuildStates.coveredThroughCommitSeq })
          .from(fxSystemIndexBuildStates).where(and(eq(fxSystemIndexBuildStates.scopeId, frontier.input.selector.scopeId),
            eq(fxSystemIndexBuildStates.indexDefinitionId, frontier.definition.indexDefinitionId))))
          .toEqual([{ coverage: sequence }]);
        expect(await persistence.drizzle.select({ commitSeq: fxSystemCommits.commitSeq }).from(fxSystemCommits)
          .where(and(eq(fxSystemCommits.scopeUuid, Result.getOrThrow(projectScopeIdUuidV1Result(frontier.input.selector.scopeId)).scopeUuid),
            eq(fxSystemCommits.commitSeq, sequence)))).toEqual([{ commitSeq: sequence }]);
      } finally { release(); await writing.catch(() => undefined); await reading?.catch(() => undefined); }
    } finally { await fixture.close(); }
  }, 180_000);
});
