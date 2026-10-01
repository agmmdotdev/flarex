import { count } from "drizzle-orm";
import { Cause, Deferred, Effect, Exit, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { postgresUrl } from "../../persistence-postgres/test/postgresHelpers";
import { createPostgresPersistence } from "../../persistence-postgres/src/postgres";
import { fxSystemSnapshotLeases, fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournals, fxSystemTransactionSessions } from "../../persistence-postgres/src/schema";
import { createMixedMutationProductFixture,
  type MixedMutationFinalEntryTestContext, type MixedMutationProductFixtureHooks } from "./support/mixedMutationProductFixture";
import { inspectActivatedPointMutationSessionV1 } from "../../executor/src/pointMutationSessionActivation";
import { preparedFiniteEntries } from "../../persistence-postgres/src/sessionJournalFiniteEntry";
import { installOneEntryCommitResponseFault } from "./support/postgresCommitResponseFault";

type EntryParticipants = Parameters<NonNullable<MixedMutationProductFixtureHooks["transformFiniteEntrySources"]>>[0];
type EntrySourceBinder = EntryParticipants[number]["sources"][number]["selection"]["bindAttemptEffect"];

function interceptEntryBindings(wrap: (original: EntrySourceBinder) => EntrySourceBinder) {
  const intercepted = new WeakSet<EntrySourceBinder>();
  const restorers: Array<() => void> = [];
  return {
    transform: (participants: EntryParticipants): EntryParticipants => {
      for (const participant of participants) for (const source of participant.sources) {
        const binder = source.selection.bindAttemptEffect;
        if (intercepted.has(binder)) continue;
        intercepted.add(binder);
        const original = binder.bind(source.selection);
        const previous = Object.getOwnPropertyDescriptor(binder, "bind");
        const injected = wrap(original);
        // Intercept the store's call capture, preserving the genuine source
        // selection passed to the issuer and its callback-local observation.
        Object.defineProperty(binder, "bind", { configurable: true, value: (receiver: unknown) => {
          if (receiver !== source.selection) throw new Error("Finite entry captured the wrong source receiver");
          return injected;
        } });
        restorers.push(() => {
          if (previous === undefined) Reflect.deleteProperty(binder, "bind");
          else Object.defineProperty(binder, "bind", previous);
        });
      }
      return participants;
    },
    restore: () => { for (const restore of restorers.toReversed()) restore(); },
  };
}

async function entryInventory(context: MixedMutationFinalEntryTestContext) {
  const database = context.currency.persistence.drizzle;
  return Promise.all([fxSystemTransactionSessions, fxSystemSnapshotLeases,
    fxSystemTransactionJournals, fxSystemTransactionExecutionClaims].map(async table =>
    (await database.select({ count: count() }).from(table))[0]?.count ?? 0));
}

async function installLateByteInflation(context: MixedMutationFinalEntryTestContext) {
  const target = context.currency.persistence;
  const schema = (await target.query<{ schema: string }>("select current_schema() as schema")).rows[0]?.schema;
  if (schema === undefined || !/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new Error("Invalid isolated test schema");
  // DDL is installed by the ordinary schema owner; the entry itself still runs
  // on the genuine restricted login in the PostgreSQL lane.
  if (context.currency.resource.kind === "postgres" && postgresUrl === null) throw new Error("Missing PostgreSQL owner URL");
  const owner = context.currency.resource.kind === "postgres" && postgresUrl !== null
    ? await createPostgresPersistence({ connectionString: postgresUrl }) : undefined;
  try {
    const functionStatement = `create function "${schema}".inflate_final_entry_bytes() returns trigger language plpgsql as $function$
      begin
        update "${schema}".fx_system_tx_session set validated_args_canonical_bytes = decode(repeat('78', 524288), 'hex')
          where scope_uuid = new.scope_uuid and session_id = new.session_id;
        return new;
      end $function$`;
    const triggerStatement = `create trigger inflate_final_entry_bytes after insert on "${schema}".fx_system_tx_execution_claim
        for each row execute function "${schema}".inflate_final_entry_bytes()`;
    for (const statement of [functionStatement, triggerStatement]) {
      if (owner === undefined) await target.query(statement);
      else await owner.query(statement);
    }
  } finally { await owner?.close(); }
}

describe("atomic finite aggregate entry", () => {
  it.skipIf(postgresUrl === null)("serializes same-scope entry contenders while a different scope completes on distinct PostgreSQL connections", async () => {
    const entered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    let holdNext = false;
    let sourceBindings = 0;
    const bindings = interceptEntryBindings(original => (...args) => Effect.suspend(() => {
      const wait = holdNext;
      holdNext = false;
      return (wait ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))) : Effect.void).pipe(
        Effect.andThen(original(...args)), Effect.tap(() => Effect.sync(() => { sourceBindings += 1; })));
    }));
    let firstFixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>> | undefined;
    let other: Awaited<ReturnType<typeof createMixedMutationProductFixture>> | undefined;
    const operations: Array<Promise<unknown>> = [];
    try {
      const first = await createMixedMutationProductFixture({ driver: "postgres", suffix: "entry-contention-base", hooks: {
        transformFiniteEntrySources: bindings.transform,
      } });
      firstFixture = first;
      other = await createMixedMutationProductFixture({ driver: "postgres", suffix: "entry-contention-other",
        resource: first.currency.resource, fixtureIdentity: { deploymentId: "entry-contention-other",
          projectId: "entry-contention-other-project", uuidOffset: 600_000 } });
      if (first.currency.resource.kind !== "postgres") throw new Error("Expected PostgreSQL runtime");
      const baseline = await entryInventory(first);
      const baselineBindings = sourceBindings;
      const elapsed: Record<string, number> = {};
      holdNext = true;
      const holdingStarted = Date.now();
      const holding = Effect.runPromise(first.activateCompetingFiniteRequest("entry-contention-held"))
        .finally(() => { elapsed.holding = Date.now() - holdingStarted; });
      operations.push(holding);
      await Effect.runPromise(Deferred.await(entered));
      let replaySettled = false, differentRequestSettled = false;
      const replayStarted = Date.now();
      const replay = Effect.runPromise(first.activateCompetingFiniteRequest("entry-contention-held"))
        .finally(() => { replaySettled = true; elapsed.replay = Date.now() - replayStarted; });
      const distinctStarted = Date.now();
      const differentRequest = Effect.runPromise(first.activateCompetingFiniteRequest("entry-contention-distinct"))
        .finally(() => { differentRequestSettled = true; elapsed.distinct = Date.now() - distinctStarted; });
      operations.push(replay, differentRequest);
      const pool = first.currency.resource.target.pool;
      const runtimeIdentity = await pool.query<{ name: string }>("select current_setting('application_name') as name");
      const name = runtimeIdentity.rows[0]?.name;
      if (name === undefined) throw new Error("Missing runtime connection identity");
      const deadline = Date.now() + 15_000;
      type Waiter = { pid: number; blockers: number[]; inTransaction: boolean;
        waitType: string; queryMilliseconds: number; transactionMilliseconds: number };
      let waiters: readonly Waiter[] = [];
      while (Date.now() < deadline) {
        const reading = await pool.query<Waiter>(`
          select pid, pg_blocking_pids(pid) as blockers, xact_start is not null as "inTransaction",
            wait_event_type as "waitType",
            (extract(epoch from (clock_timestamp() - query_start)) * 1000)::double precision as "queryMilliseconds",
            (extract(epoch from (clock_timestamp() - xact_start)) * 1000)::double precision as "transactionMilliseconds"
          from pg_stat_activity where application_name = $1 and query ilike '%fx_system_scope_clock%'
            and cardinality(pg_blocking_pids(pid)) > 0`, [name]);
        waiters = reading.rows;
        if (waiters.length >= 2) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(new Set(waiters.map(waiter => waiter.pid)).size).toBeGreaterThanOrEqual(2);
      expect(waiters.every(waiter => waiter.inTransaction && waiter.blockers.length > 0)).toBe(true);
      expect(waiters.every(waiter => waiter.waitType === "Lock" && Number.isFinite(waiter.queryMilliseconds)
        && waiter.queryMilliseconds >= 0 && Number.isFinite(waiter.transactionMilliseconds)
        && waiter.transactionMilliseconds >= waiter.queryMilliseconds)).toBe(true);
      expect(replaySettled).toBe(false);
      expect(differentRequestSettled).toBe(false);
      const independentStarted = Date.now();
      const independent = await Effect.runPromise(other.activateCompetingFiniteRequest("entry-contention-independent"));
      elapsed.independent = Date.now() - independentStarted;
      expect(inspectActivatedPointMutationSessionV1(independent).status).toBe("created");
      expect(replaySettled).toBe(false);
      expect(differentRequestSettled).toBe(false);
      await Effect.runPromise(Deferred.succeed(release, undefined));
      const [created, replayed, distinct] = await Promise.all([holding, replay, differentRequest]);
      expect(inspectActivatedPointMutationSessionV1(created).status).toBe("created");
      expect(inspectActivatedPointMutationSessionV1(replayed).status).toBe("busy");
      expect(inspectActivatedPointMutationSessionV1(distinct).status).toBe("created");
      expect(sourceBindings).toBe(baselineBindings + 2);
      expect(await entryInventory(first)).toEqual(baseline.map(value => value + 3));
      expect(Object.values(elapsed).every(value => Number.isFinite(value) && value >= 0 && value <= 240_000)).toBe(true);
      console.info(JSON.stringify({ profile: "finite aggregate entry contention", elapsedMilliseconds: elapsed,
        blockedTransactions: waiters.map(waiter => ({ waitType: waiter.waitType,
          queryMilliseconds: waiter.queryMilliseconds, transactionMilliseconds: waiter.transactionMilliseconds })),
        sameScopeSourceBindings: sourceBindings - baselineBindings, outcomes: ["created", "busy", "created", "created"] }));
    } finally {
      try {
        await Effect.runPromise(Deferred.succeed(release, undefined));
        await Promise.allSettled(operations);
      } finally {
        try { await other?.close(); }
        finally { try { await firstFixture?.close(); } finally { bindings.restore(); } }
      }
    }
  }, 240_000);

  it.skipIf(postgresUrl === null)("abandons all local entry facts after a lost actual PostgreSQL COMMIT response", async () => {
    let baseline: readonly number[] = [];
    let observedFailure = false;
    let restoreFault: (() => void) | undefined;
    let fired: (() => boolean) | undefined;
    let localState: ReturnType<typeof preparedFiniteEntries.get>;
    let installed: ReturnType<typeof vi.spyOn> | undefined;
    let discarded: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const failure = await createMixedMutationProductFixture({ driver: "postgres", suffix: "entry-commit-response",
        hooks: {
          beforeFinalEntry: async context => {
            baseline = await entryInventory(context);
            const fault = installOneEntryCommitResponseFault(context, () => { throw new Error("entry COMMIT response lost"); });
            restoreFault = fault.restore;
            fired = fault.fired;
          },
          onFiniteEntryPrepared: preparation => {
            localState = preparedFiniteEntries.get(preparation);
            if (localState === undefined) throw new Error("Expected original entry preparation");
            installed = vi.spyOn(localState, "install");
            discarded = vi.spyOn(localState, "discard");
          },
          onFinalEntryFailure: async (context, exit) => {
            restoreFault?.();
            expect(fired?.()).toBe(true);
            expect(String(exit)).toContain("entry COMMIT response lost");
            expect(await entryInventory(context)).toEqual(baseline.map(value => value + 1));
            expect(localState?.status).toBe("abandoned");
            expect(localState?.capture).toBeDefined();
            expect(installed).not.toHaveBeenCalled();
            expect(discarded).toHaveBeenCalledOnce();
            observedFailure = true;
          },
        },
      }).then(async fixture => { await fixture.close(); throw new Error("Expected lost entry COMMIT response"); }, cause => cause);
      expect(observedFailure, String(failure)).toBe(true);
    } finally { restoreFault?.(); }
  }, 180_000);

  for (const driver of ["pglite", "postgres"] as const) {
    it.skipIf(driver === "postgres" && postgresUrl === null)(
      `resolves replay before binding a newly invalid source on ${driver}`, async () => {
        let refuseSource = false;
        let refusedBindCalls = 0;
        const fixture = await createMixedMutationProductFixture({ driver, suffix: `entry-replay-${driver}`, hooks: {
          transformFiniteEntrySources: participants => refuseSource ? participants.map(participant => ({ ...participant,
            sources: participant.sources.map(source => ({ ...source, selection: { ...source.selection,
              bindAttemptEffect: () => Effect.sync(() => { refusedBindCalls += 1; }).pipe(
                Effect.andThen(Effect.die(new Error("replay must precede source binding")))),
            } })),
          })) : participants,
        } });
        try {
          const before = await entryInventory(fixture);
          refuseSource = true;
          const replay = await Effect.runPromise(fixture.replayFiniteActivation());
          expect(inspectActivatedPointMutationSessionV1(replay).status).toBe("busy");
          expect(refusedBindCalls).toBe(0);
          expect(await entryInventory(fixture)).toEqual(before);
        } finally { await fixture.close(); }
      }, 180_000);

    for (const failureMode of ["defect", "interruption"] as const) {
    it.skipIf(driver === "postgres" && postgresUrl === null)(
      `rolls back all four row families after the second source ${failureMode} on ${driver}`, async () => {
        const sentinel = new Error("second aggregate source defect");
        let baseline: readonly number[] = [];
        let firstSucceeded = false;
        let sourcesPrepared = 0;
        let observedFailure = false;
        const bindings = interceptEntryBindings(original => {
          const ordinal = sourcesPrepared++;
          return (...args) => ordinal === 1
            ? failureMode === "defect" ? Effect.die(sentinel) : Effect.interrupt : original(...args).pipe(Effect.tap(() =>
              Effect.sync(() => { if (ordinal === 0) firstSucceeded = true; })));
        });
        try {
        const failure = await createMixedMutationProductFixture({ driver, suffix: `entry-source-${failureMode}-${driver}`,
          payloadProfile: "success", hooks: {
            beforeFinalEntry: async context => { baseline = await entryInventory(context); },
            transformFiniteEntrySources: bindings.transform,
            onFinalEntryFailure: async (context, exit) => {
              expect(firstSucceeded).toBe(true);
              expect(Exit.isFailure(exit)).toBe(true);
              if (Exit.isFailure(exit)) {
                if (failureMode === "interruption") expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
                else {
                  const defect = Cause.findDefect(exit.cause);
                  expect(Result.isSuccess(defect) ? defect.success : undefined).toBe(sentinel);
                }
              }
              expect(await entryInventory(context)).toEqual(baseline);
              observedFailure = true;
            },
          },
        }).then(async fixture => { await fixture.close(); throw new Error("Expected source defect"); }, cause => cause);
        expect(sourcesPrepared).toBeGreaterThanOrEqual(2);
        expect(observedFailure, String(failure)).toBe(true);
        } finally { bindings.restore(); }
      }, 180_000);
    }

    it.skipIf(driver === "postgres" && postgresUrl === null)(
      `refuses actual late inflated bytes with unchanged digest before payload capture on ${driver}`, async () => {
        let baseline: readonly number[] = [];
        let observedFailure = false;
        let watchingEntry = false;
        const entrySql: string[] = [];
        const failure = await createMixedMutationProductFixture({ driver, suffix: `entry-late-bytes-${driver}`, hooks: {
          beforeFinalEntry: async context => {
            baseline = await entryInventory(context);
            await installLateByteInflation(context);
            watchingEntry = true;
          },
          observeSql: (_phase, sql) => { if (watchingEntry) entrySql.push(sql); },
          onFinalEntryFailure: async (context, exit) => {
            expect(String(exit)).toContain("sessionRecordInvalid");
            expect(await entryInventory(context)).toEqual(baseline);
            observedFailure = true;
          },
        } }).then(async fixture => { await fixture.close(); throw new Error("Expected final entry refusal"); }, cause => cause);
        expect(observedFailure, String(failure)).toBe(true);
        if (driver === "pglite") {
          const finalInsert = entrySql.findIndex(statement => /insert into "fx_system_tx_execution_claim"/i.test(statement));
          expect(finalInsert).toBeGreaterThanOrEqual(0);
          const afterInsert = entrySql.slice(finalInsert + 1);
          expect(afterInsert.some(statement => /is not distinct from/i.test(statement))).toBe(true);
          // A complete scalar verdict fails before the stored evidence owner can
          // select the large canonical session payload.
          expect(afterInsert.some(statement => /^select .*validated_args_canonical_bytes.* from "fx_system_tx_session"/i.test(statement)
            && !/is not distinct from/i.test(statement))).toBe(false);
        }
      }, 180_000);
  }
});
