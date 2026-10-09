import { count, eq, sql } from "drizzle-orm";
import { Cause, Data, Deferred, Duration, Effect, Exit, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { createPostgresPersistence } from "../../persistence-postgres/src/database/postgres";
import { fxAppRowRevisions, fxSystemCommits, fxSystemSnapshotLeases, fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournals, fxSystemTransactionSessions } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { createMixedMutationProductFixture,
  type MixedMutationFinalEntryTestContext, type MixedMutationProductFixtureHooks } from "./support/mixedMutationWorkerdFixture";
import {
  inspectPreparedFiniteSessionJournalEntry,
} from "@flarex/persistence-postgres/internal/system-test/session-journal-inspection";
import type {
  PreparedFiniteSessionJournalEntry,
} from "@flarex/persistence-postgres/internal/session-journal";
import * as finiteEntryActivation from "../../persistence-postgres/src/execution/journal/finiteEntryActivation";
import { FiniteAttemptAnchorError } from "../../persistence-postgres/src/execution/finiteAttemptAnchor";
import { FiniteStorageCaptureError } from "../../persistence-postgres/src/execution/finiteStorageCapture";
import {
  InvalidSessionJournalCapabilityV1Error,
  SessionJournalPersistenceV1Error,
} from "@flarex/persistence-postgres/internal/session-journal";
import {
  LogicalParticipantAdmissionError,
} from "../../persistence-postgres/src/storage/documents/logicalDocuments/participantErrors";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import {
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
  PointMutationSessionAttemptTerminalizationV1Error,
} from "../../persistence-postgres/src/execution/transactionSessionActivation";
import { installOneEntryCommitResponseFault } from "./support/postgresCommitResponseFault";

type EntryParticipants = Parameters<NonNullable<MixedMutationProductFixtureHooks["transformFiniteEntrySources"]>>[0];
type EntrySourceBinder = EntryParticipants[number]["sources"][number]["selection"]["bindAttemptEffect"];

class DelayedEntryAckTestResourceError extends Data.TaggedError("DelayedEntryAckTestResourceError")<{
  operation: string;
  cause: unknown;
}> {}

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

async function entryInventory(context: Pick<MixedMutationFinalEntryTestContext, "currency">) {
  const database = context.currency.persistence.drizzle;
  return Promise.all([fxSystemTransactionSessions, fxSystemSnapshotLeases,
    fxSystemTransactionJournals, fxSystemTransactionExecutionClaims].map(async table =>
    (await database.select({ count: count() }).from(table))[0]?.count ?? 0));
}

async function committedBusinessInventory(context: Pick<MixedMutationFinalEntryTestContext, "currency">) {
  const database = context.currency.persistence.drizzle;
  return Promise.all([fxAppRowRevisions, fxSystemCommits, fxSystemCommitEvents].map(async table =>
    (await database.select({ count: count() }).from(table))[0]?.count ?? 0));
}

function withAddedFiniteAnchors(baseline: readonly number[], created: number) {
  const sessions = baseline[0];
  if (sessions === undefined || baseline.length !== 4) throw new Error("Missing complete entry inventory");
  return [sessions + created, ...baseline.slice(1)];
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
    const triggerStatement = `create trigger inflate_final_entry_bytes after insert on "${schema}".fx_system_tx_session
        for each row execute function "${schema}".inflate_final_entry_bytes()`;
    for (const statement of [functionStatement, triggerStatement]) {
      if (owner === undefined) await target.query(statement);
      else await owner.query(statement);
    }
  } finally { await owner?.close(); }
}

describe("atomic finite aggregate entry", () => {
  it.skipIf(postgresUrl === null)("acknowledges delayed entry at its transaction admission and refuses the subsequent expired storage frontier", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    let restore: (() => void) | undefined;
    let fired: (() => boolean) | undefined;
    let original: PreparedFiniteSessionJournalEntry | undefined;
    let originalDeadlines: { claim: Date; lease: Date; grant: Date; hard: Date } | undefined;
    let business: readonly number[] = [];
    const resource = <A>(operation: string, run: () => PromiseLike<A>) => Effect.tryPromise({
      try: run, catch: cause => new DelayedEntryAckTestResourceError({ operation, cause }),
    });
    const readDatabaseNow = async (context: Pick<MixedMutationFinalEntryTestContext, "currency">) => {
      const rows = await context.currency.persistence.drizzle.select({
        now: sql<Date>`clock_timestamp()`.mapWith(fxSystemTransactionSessions.createdAt),
      }).from(fxSystemTransactionSessions).where(eq(fxSystemTransactionSessions.executionProfile, "finiteRoot"));
      if (rows.length !== 1 || rows[0] === undefined) throw new Error("Missing exact committed finite entry clock");
      return rows[0].now;
    };
    const waitForDatabaseDeadline = async (context: Pick<MixedMutationFinalEntryTestContext, "currency">, deadline: Date) => {
      for (;;) {
        const now = await readDatabaseNow(context);
        if (now.getTime() >= deadline.getTime()) return now;
        await Effect.runPromise(Effect.sleep(Duration.millis(Math.min(1_000, Math.max(1, deadline.getTime() - now.getTime())))));
      }
    };
    yield* Effect.addFinalizer(() => Effect.sync(() => { restore?.(); }));
    // The scope retains the body's full Cause even if the fixture's native
    // initial-execution finalizer also refuses its expired abort capability.
    const fixture = yield* Effect.acquireRelease(resource("create delayed-ACK fixture", () => createMixedMutationProductFixture({ driver: "postgres", suffix: "entry-delayed-ack-expiry",
      includeUserNameIndex: true, hooks: {
        finiteGrantLifetimeMilliseconds: 30_000,
        onFiniteEntryPrepared: preparation => { original = preparation; },
        beforeFinalEntry: async context => {
          business = await committedBusinessInventory(context);
          const fault = installOneEntryCommitResponseFault(context, async () => {
            const rows = await context.currency.persistence.drizzle.select({
              claim: fxSystemTransactionSessions.finiteClaimExpiresAt,
              lease: fxSystemTransactionSessions.finiteLeaseExpiresAt,
              grant: fxSystemTransactionSessions.authorizationGrantExpiresAt,
              hard: fxSystemTransactionSessions.hardExpiresAt,
            })
              .from(fxSystemTransactionSessions).where(eq(fxSystemTransactionSessions.executionProfile, "finiteRoot"));
            const row = rows[0];
            if (rows.length !== 1 || row === undefined || row.claim === null || row.lease === null)
              throw new Error("Missing exact committed entry deadlines");
            originalDeadlines = { claim: row.claim, lease: row.lease, grant: row.grant, hard: row.hard };
            await waitForDatabaseDeadline(context, row.claim);
          });
          restore = fault.restore;
          fired = fault.fired;
        },
      } })), value => resource("close delayed-ACK fixture", () => value.close()).pipe(Effect.orDie));
      restore?.();
      expect(fired?.()).toBe(true);
      expect(original === undefined ? undefined : inspectPreparedFiniteSessionJournalEntry(original)?.status).toBe("confirmed");
      expect(fixture.activation.status).toBe("created");
      expect(yield* resource("read acknowledged business inventory", () => committedBusinessInventory(fixture))).toEqual(business);
      const before = yield* resource("read acknowledged entry inventory", () => entryInventory(fixture));
      const table = yield* fixture.store.resolvePointTableEffect(fixture.persistenceAttempt, "users");
      const index = yield* fixture.store.resolveDeveloperIndexEffect(table, "by_name");
      const refused = yield* fixture.store.runIndexedQueryEffect(index, {
        kind: "indexRange", syscallSequence: CommitSyscallSequenceV1Schema.make(1n), bounds: {}, limit: 1,
      }).pipe(Effect.result);
      expect(Result.isFailure(refused)).toBe(true);
      if (Result.isSuccess(refused)) throw new Error("Expired installed indexed frontier unexpectedly succeeded", { cause: refused.success });
      if (!(refused.failure instanceof SessionJournalPersistenceV1Error) || refused.failure.operation !== "runIndexedQuery" ||
        !(refused.failure.cause instanceof FiniteStorageCaptureError) || refused.failure.cause.reason !== "expired")
        throw new Error("Expected the installed indexed frontier's exact typed expiry refusal", { cause: refused.failure });
      expect(Object.fromEntries(fixture.nativeInvokeCount)).toEqual({});
      expect(yield* resource("read refused entry inventory", () => entryInventory(fixture))).toEqual(before);
      if (originalDeadlines === undefined) throw new Error("Missing original durable deadlines after COMMIT acknowledgement");
      const terminalDeadline = new Date(Math.min(originalDeadlines.lease.getTime(), originalDeadlines.grant.getTime(), originalDeadlines.hard.getTime()));
      const terminalization = createPointMutationSessionAttemptTerminalizationPersistenceV1(fixture.pointCommitPorts);
      const now = yield* resource("read terminalization database clock", () => readDatabaseNow(fixture));
      if (now.getTime() < terminalDeadline.getTime()) {
        // An expired execution claim permits takeover, not terminalization of
        // an otherwise live attempt. Check the real owner's typed refusal.
        const live = yield* terminalization.expireEffect(fixture.selector).pipe(Effect.result);
        expect(Result.isFailure(live)).toBe(true);
        if (Result.isSuccess(live)) throw new Error("Live original attempt unexpectedly terminalized", { cause: live.success });
        if (!(live.failure instanceof PointMutationSessionAttemptTerminalizationV1Error) || live.failure.issue.reason !== "attemptStillLive" ||
          live.failure.issue.effectiveExpiresAt !== terminalDeadline.toISOString())
          throw new Error("Expected the original live attempt's exact typed terminalization refusal", { cause: live.failure });
      }
      yield* resource("wait original terminal expiry", () => waitForDatabaseDeadline(fixture, terminalDeadline));
      const expired = yield* terminalization.expireEffect(fixture.selector);
      expect(expired).toMatchObject({ status: "terminalized", terminal: { lifecycle: "expired" } });
      expect(yield* resource("read expired business inventory", () => committedBusinessInventory(fixture))).toEqual(business);
  }))), 180_000);

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
      // Each new request enters through the original bounded preparation owner,
      // which refreshes its current generation after both scopes' metadata setup.
      // Already admitted initial requests keep their original signed pins.
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
      expect(independent.status).toBe("created");
      expect(replaySettled).toBe(false);
      expect(differentRequestSettled).toBe(false);
      await Effect.runPromise(Deferred.succeed(release, undefined));
      const [created, replayed, distinct] = await Promise.all([holding, replay, differentRequest]);
      expect(created.status).toBe("created");
      expect(replayed.status).toBe("busy");
      expect(distinct.status).toBe("created");
      expect(sourceBindings).toBe(baselineBindings + 2);
      expect(await entryInventory(first)).toEqual(withAddedFiniteAnchors(baseline, 3));
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
    let localEntry: PreparedFiniteSessionJournalEntry | undefined;
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
            localEntry = preparation;
          },
          onFinalEntryFailure: async (context, exit) => {
            restoreFault?.();
            expect(fired?.()).toBe(true);
            expect(String(exit)).toContain("entry COMMIT response lost");
            expect(await entryInventory(context)).toEqual(withAddedFiniteAnchors(baseline, 1));
            if (localEntry === undefined) throw new Error("Expected original entry preparation");
            const snapshot = inspectPreparedFiniteSessionJournalEntry(localEntry);
            if (snapshot === undefined) throw new Error("Missing original entry inspection");
            expect(snapshot).toMatchObject({ status: "abandoned", hasCapture: true, finiteStatus: "aborted" });
            const uninstalled = await Effect.runPromise(context.store.resolvePointTableEffect(snapshot.attempt, "users").pipe(Effect.result));
            expect(Result.isFailure(uninstalled)).toBe(true);
            if (Result.isFailure(uninstalled)) {
              expect(uninstalled.failure).toBeInstanceOf(InvalidSessionJournalCapabilityV1Error);
              expect(uninstalled.failure).toMatchObject({ capability: "attempt" });
            }
            observedFailure = true;
          },
        },
      }).then(async fixture => { await fixture.close(); throw new Error("Expected lost entry COMMIT response"); }, cause => cause);
      expect(observedFailure, String(failure)).toBe(true);
    } finally { restoreFault?.(); }
  }, 180_000);

  for (const driver of ["pglite", "postgres"] as const) {
    it.skipIf(driver === "postgres" && postgresUrl === null)(
      `terminalizes the exact acknowledged entry when cancelled before its callback on ${driver}`, async () => {
        let before: readonly number[] = [];
        let business: readonly number[] = [];
        let original: PreparedFiniteSessionJournalEntry | undefined;
        let cancelled = false;
        let observed = false;
        const failure = await createMixedMutationProductFixture({ driver, suffix: `entry-callback-cancel-${driver}`, hooks: {
          beforeFinalEntry: async context => {
            before = await entryInventory(context);
            business = await committedBusinessInventory(context);
          },
          onFiniteEntryPrepared: preparation => { original = preparation; },
          beforeFiniteCallback: () => Effect.sync(() => { cancelled = true; }).pipe(Effect.andThen(Effect.interrupt)),
          onFinalEntryFailure: async (context, exit) => {
            expect(cancelled).toBe(true);
            expect(Exit.isFailure(exit)).toBe(true);
            if (Exit.isFailure(exit)) expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
            const captured = original === undefined ? undefined : inspectPreparedFiniteSessionJournalEntry(original);
            expect(captured?.status).toBe("confirmed");
            if (captured?.context === undefined) throw new Error("Missing actual acknowledged entry capture");
            const [row] = await context.currency.persistence.drizzle.select().from(fxSystemTransactionSessions)
              .where(eq(fxSystemTransactionSessions.sessionId, captured.context.anchor.sessionId));
            expect(row).toMatchObject({ lifecycle: "aborted", attemptFence: captured.context.anchor.attemptFence,
              finiteClaimOwner: captured.context.executionClaim.claimOwner,
              finiteClaimFence: captured.context.executionClaim.claimFence,
              validatedArgsJson: null, validatedArgsCanonicalBytes: null,
              authorizationGrantJson: null, authorizationGrantCanonicalBytes: null,
              applicationExecutionAuthorityJson: null, applicationExecutionAuthorityCanonicalBytes: null });
            expect(captured.finiteStatus).toBe("aborted");
            expect(await entryInventory(context)).toEqual(withAddedFiniteAnchors(before, 1));
            expect(await committedBusinessInventory(context)).toEqual(business);
            observed = true;
          },
          beforeNative: () => Effect.die(new Error("Cancelled start must not invoke native business callbacks")),
        } }).then(async fixture => { await fixture.close(); throw new Error("Expected acknowledged continuation cancellation"); }, cause => cause);
        if (!observed) throw failure;
        expect(observed).toBe(true);
      }, 180_000);

    it.skipIf(driver === "postgres" && postgresUrl === null)(
      `rejects natural authority expiry after source binding before acknowledging entry on ${driver}`, async () => {
        let baseline: readonly number[] = [];
        let sourceAccepted = false;
        let observedFailure = false;
        let delayed = false;
        let originalContext: Parameters<typeof finiteEntryActivation.runPreparedFiniteSessionJournalEntryEffect>[2] | undefined;
        let runSpy: ReturnType<typeof vi.spyOn> | undefined;
        const bindings = interceptEntryBindings(original => (...args) => Effect.gen(function* () {
          const admission = yield* original(...args);
          if (!delayed) {
            delayed = true;
            sourceAccepted = true;
            const entry = args[5];
            if (entry === undefined) throw new Error("Expected genuine finite entry transaction");
            const rows = yield* Effect.tryPromise({ try: () => entry.tx.select({ sessionId: fxSystemTransactionSessions.sessionId })
              .from(fxSystemTransactionSessions).where(eq(fxSystemTransactionSessions.sessionId, args[2].sessionId)),
              catch: cause => new LogicalParticipantAdmissionError({ reason: "resourceFailure", cause }) });
            expect(rows).toEqual([]);
            const expiresAt = originalContext?.finiteAttempt.executionClaim.claimExpiresAt;
            if (expiresAt === undefined) throw new Error("Missing authentic provisional entry deadline");
            yield* Effect.sleep(Duration.millis(Math.max(1, Date.parse(expiresAt) - Date.now() + 100)));
          }
          return admission;
        }));
        try {
          const failure = await createMixedMutationProductFixture({ driver, suffix: `entry-final-expiry-${driver}`, hooks: {
            finiteGrantLifetimeMilliseconds: 30_000,
            transformFiniteEntrySources: bindings.transform,
            onFiniteEntryPrepared: preparation => {
              if (inspectPreparedFiniteSessionJournalEntry(preparation) === undefined) throw new Error("Missing original finite entry issuer");
              const nativeRun = finiteEntryActivation.runPreparedFiniteSessionJournalEntryEffect;
              runSpy = vi.spyOn(finiteEntryActivation, "runPreparedFiniteSessionJournalEntryEffect").mockImplementation((...args) => {
                originalContext = args[2];
                return nativeRun(...args);
              });
            },
            beforeFinalEntry: async context => { baseline = await entryInventory(context); },
            onFinalEntryFailure: async (context, exit) => {
              expect(sourceAccepted).toBe(true);
              expect(Exit.isFailure(exit)).toBe(true);
              if (Exit.isFailure(exit)) {
                expect(exit.cause.reasons.every(Cause.isFailReason)).toBe(true);
                const failure = Cause.findError(exit.cause);
                expect(Result.isSuccess(failure)).toBe(true);
                let nested: unknown = Result.isSuccess(failure) ? failure.success : undefined;
                while (nested !== null && typeof nested === "object" && !(nested instanceof FiniteAttemptAnchorError) && "cause" in nested)
                  nested = nested.cause;
                expect(nested).toBeInstanceOf(FiniteAttemptAnchorError);
                expect(nested).toMatchObject({ reason: "expired" });
              }
              expect(await entryInventory(context)).toEqual(baseline);
              observedFailure = true;
            },
          } }).then(async fixture => { await fixture.close(); throw new Error("Expected post-wait entry expiry"); }, cause => cause);
          expect(observedFailure, String(failure)).toBe(true);
        } finally { runSpy?.mockRestore(); bindings.restore(); }
      }, 180_000);

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
          expect(replay.status).toBe("busy");
          expect(refusedBindCalls).toBe(0);
          expect(await entryInventory(fixture)).toEqual(before);
        } finally { await fixture.close(); }
      }, 180_000);

    for (const failureMode of ["defect", "interruption"] as const) {
    it.skipIf(driver === "postgres" && postgresUrl === null)(
      `rolls back the compact anchor after the second source ${failureMode} on ${driver}`, async () => {
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
          const completeEntry = entrySql.findIndex(statement => /fx_complete_finite_entry/i.test(statement));
          expect(completeEntry).toBeGreaterThanOrEqual(0);
          const afterInsert = entrySql.slice(completeEntry + 1);
          // A complete scalar verdict fails before the stored evidence owner can
          // select the large canonical session payload.
          expect(afterInsert.some(statement => /^select .*validated_args_canonical_bytes.* from "fx_system_tx_session"/i.test(statement)
            && !/is not distinct from/i.test(statement))).toBe(false);
        }
      }, 180_000);
  }
});
