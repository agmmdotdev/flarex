import { and, eq, sql } from "drizzle-orm";
import { Data, Deferred, Effect, Exit, Result, Schema } from "effect";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { isNonArrayRecord } from "@flarex/utils/records";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1ToBytes, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import { lockFiniteAttemptAnchorRowByIdentityInTransaction } from "../../persistence-postgres/src/finiteAttemptAnchor";
import { fxAppRowRevisions, fxControlTables, fxSystemTransactionSessions } from "../../persistence-postgres/src/schema";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";

const generatedUuid = "6f000000-0000-4000-8000-000000000001";
const generatedRowId = decodeAppRowIdHexV1(generatedUuid.replaceAll("-", ""));
class HistoricalIdentityTestResourceError extends Data.TaggedError("HistoricalIdentityTestResourceError")<{
  operation: string; cause: unknown;
}> {}
const testResource = <A>(operation: string, work: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: work, catch: cause => new HistoricalIdentityTestResourceError({ operation, cause }) });
const Inserted = Schema.Struct({ kind: Schema.Literal("inserted"), documentId: Schema.String });

describe.skipIf(process.env.FLAREX_POSTGRES_DATABASE_URL === undefined)("finite Application historical identity after PostgreSQL waits", () => {
  for (const disposition of ["live", "tombstone"] as const) {
    it(`detects an exact generated identity committed as ${disposition} during its actual session wait`, () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(testResource("prepare exact identity fixture", () =>
        createMixedMutationProductFixture({ driver: "postgres", suffix: `historical-id-${disposition}`,
          hooks: { journalRandomUuid: () => generatedUuid } })), fixture => testResource("close exact identity fixture", () => fixture.close()).pipe(Effect.orDie));
      const writer = yield* Effect.acquireRelease(testResource("prepare competing genuine writer", () =>
        fixture.openCompetingFiniteFixture(`historical-id-${disposition}-writer`)), writer => testResource("close genuine writer", () => writer.close()).pipe(Effect.orDie));
      if (fixture.currency.resource.kind !== "postgres") throw new Error("Expected genuine PostgreSQL resource");
      const persistence = fixture.currency.resource.target;
      const [table] = yield* testResource("read actual Application table", () => fixture.currency.control.drizzle.select({ tableId: fxControlTables.tableId }).from(fxControlTables)
        .where(and(eq(fxControlTables.deploymentId, fixture.currency.deploymentId), eq(fxControlTables.logicalName, "users"))));
      if (table === undefined) throw new Error("Missing actual Application users table");
      const scopeUuid = Result.getOrThrow(projectScopeIdUuidV1Result(fixture.selector.scopeId)).scopeUuid;
      const documentId = appDocumentIdV1FromRowIdentity({ tableId: table.tableId, rowId: generatedRowId });
      const pinnedTable = yield* fixture.bound.resolvePointTable("users");
      const writerTable = yield* writer.bound.resolvePointTable("users");
      const entered = yield* Deferred.make<number>();
      const release = yield* Deferred.make<void>();
      let holding: Promise<void> | undefined;
      let reading: Promise<Exit.Exit<Effect.Success<ReturnType<typeof fixture.bound.runPointOperation>>,
        Effect.Error<ReturnType<typeof fixture.bound.runPointOperation>>>> | undefined;
      let readObserved = false;
      const arrivingStatements: string[] = [];
      let observingArrival = false;
      const patched = new Map<PoolClient, PoolClient["query"]>();
      const onAcquire = (client: PoolClient) => {
        const original = client.query;
        client.query = new Proxy(original, { apply(query, receiver, args: unknown[]) {
          const first = args[0];
          const statement = typeof first === "string" ? first : isNonArrayRecord(first) && typeof first.text === "string" ? first.text : "";
          const bindings: readonly unknown[] = isNonArrayRecord(first) && Array.isArray(first.values) ? first.values :
            Array.isArray(args[1]) ? args[1] : [];
          if (observingArrival && bindings.includes(fixture.selector.sessionId) && /fx_accept_finite_storage_capture/.test(statement) &&
              /fx_read_historical_row_identity|exists \([\s\S]*?fx_app_row_rev/.test(statement)) {
            arrivingStatements.push(statement);
            // Let every earlier authentic ownership command finish. Start the
            // unchanged historical command only once its real session blocker
            // is held, preserving a genuine pre-wait statement snapshot.
            holding = persistence.drizzle.transaction(async tx => {
              await Effect.runPromise(lockFiniteAttemptAnchorRowByIdentityInTransaction(tx, fixture.selector));
              const [backend] = await tx.select({ pid: sql<number>`pg_backend_pid()` }).from(fxSystemTransactionSessions)
                .where(eq(fxSystemTransactionSessions.sessionId, fixture.selector.sessionId));
              if (backend === undefined) throw new Error("Missing actual session holder PID");
              await Effect.runPromise(Deferred.succeed(entered, backend.pid));
              await Effect.runPromise(Deferred.await(release));
            });
            const holder = holding;
            return Effect.runPromise(Effect.raceFirst(Deferred.await(entered), testResource("observe session holder readiness", () => holder)
              .pipe(Effect.andThen(Effect.die("Holder missed its lock barrier"))))).then(() => Reflect.apply(query, receiver, args));
          }
          return Reflect.apply(query, receiver, args);
        } });
        patched.set(client, original);
      };
      const onRelease = (_error: Error | undefined, client: PoolClient) => {
        const original = patched.get(client);
        if (original !== undefined) client.query = original;
        patched.delete(client);
      };
      persistence.pool.on("acquire", onAcquire); persistence.pool.on("release", onRelease);
      yield* Effect.addFinalizer(() => Effect.sync(() => {
        persistence.pool.off("acquire", onAcquire); persistence.pool.off("release", onRelease);
        for (const [client, original] of patched) client.query = original;
      }));
      return yield* Effect.gen(function* () {
        observingArrival = true;
        reading = Effect.runPromiseExit(fixture.bound.runPointOperation(pinnedTable, {
          kind: "insert", syscallSequence: CommitSyscallSequenceV1Schema.make(1n), fields: { name: "generated attempt" },
        }));
        const arriving = reading;
        const pid = yield* Effect.raceFirst(Deferred.await(entered), testResource("observe arriving operation readiness", () => arriving)
          .pipe(Effect.flatMap(exit => Exit.isFailure(exit) ? Effect.failCause(exit.cause) : Effect.die("Arriving operation completed before its historical gate"))));
        const deadline = Date.now() + 5_000;
        let waited = false;
        while (Date.now() < deadline) {
          const rows = yield* testResource("observe actual identity capture wait", () => persistence.pool.query<{ waited: boolean }>(`select exists(select 1 from pg_stat_activity
            where datname=current_database() and $1=any(pg_blocking_pids(pid))) as waited`, [pid]));
          if (rows.rows[0]?.waited === true) { waited = true; break; }
          yield* Effect.sleep("25 millis");
        }
        expect(waited).toBe(true);
        observingArrival = false;
        expect(arrivingStatements).toHaveLength(1);
        expect(arrivingStatements[0]).toMatch(/fx_read_historical_row_identity|exists \([\s\S]*?fx_app_row_rev/);
        const inserted = yield* writer.bound.runPointOperation(writerTable, {
          kind: "insert", syscallSequence: CommitSyscallSequenceV1Schema.make(1n), fields: { name: "concurrent identity writer" },
        });
        if (inserted.kind !== "completed") throw new Error("Genuine writer insert did not complete");
        expect(yield* Schema.decodeUnknownEffect(Inserted)(inserted.outcome)).toEqual({ kind: "inserted", documentId });
        expect(yield* testResource("publish genuine concurrent insert", () => writer.publish(null))).toMatchObject({ kind: "published" });
        if (disposition === "tombstone") {
          // A distinct new request observes the inserted predecessor before
          // the existing outer owner publishes its genuine tombstone.
          const currentDeleting = yield* Effect.acquireRelease(testResource("prepare fresh deleting snapshot", () =>
            fixture.openCompetingFiniteFixture("historical-id-tombstone-delete-fresh")), current => testResource("close fresh deleting writer", () => current.close()).pipe(Effect.orDie));
          const deletingTable = yield* currentDeleting.bound.resolvePointTable("users");
          expect(yield* currentDeleting.bound.runPointOperation(deletingTable, {
            kind: "delete", syscallSequence: CommitSyscallSequenceV1Schema.make(1n), documentId,
          })).toMatchObject({ kind: "completed", outcome: { kind: "unit", operation: "delete" } });
          expect(yield* testResource("publish genuine concurrent tombstone", () => currentDeleting.publish(null))).toMatchObject({ kind: "published" });
        }
        yield* Deferred.succeed(release, undefined);
        const holder = holding;
        if (holder === undefined) throw new Error("Missing actual original session holder");
        yield* testResource("settle original session holder", () => holder);
        const pendingRead = reading;
        const readExit = yield* testResource("observe exact identity capture Exit", () => pendingRead);
        readObserved = true;
        const outcome = yield* readExit;
        expect(outcome, JSON.stringify(outcome)).toMatchObject({ kind: "rejected", delivery: "executed",
          issue: { reason: "documentIdCollision", documentId } });
        expect(yield* testResource("read committed exact identity history", () => persistence.drizzle.select({ tombstone: fxAppRowRevisions.isTombstone }).from(fxAppRowRevisions)
          .where(and(eq(fxAppRowRevisions.scopeUuid, scopeUuid), eq(fxAppRowRevisions.tableId, table.tableId),
            eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(generatedRowId)))).orderBy(fxAppRowRevisions.commitSeq)))
          .toEqual(disposition === "live" ? [{ tombstone: false }] : [{ tombstone: false }, { tombstone: true }]);
        expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual({});
        expect(fixture.getOpenTransactionDepth()).toBe(0);
      }).pipe(Effect.onExit(() => Deferred.succeed(release, undefined).pipe(
        Effect.onExit(() => {
          const pending = holding;
          return pending === undefined ? Effect.void : testResource("drain original session holder", () => pending);
        }),
        Effect.onExit(() => {
          const pending = reading;
          return pending === undefined ? Effect.void : testResource("drain exact identity capture", () => pending).pipe(
            Effect.flatMap(exit => !readObserved && Exit.isFailure(exit) ? Effect.failCause(exit.cause) : Effect.void));
        }), Effect.asVoid, Effect.uninterruptible,
      )));
    }))), 240_000);
  }
});
