import { Cause, Effect, Exit, Result, Scheduler, Scope } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  abandonPreparedFiniteSessionJournalEntry,
  confirmPreparedFiniteSessionJournalEntry,
  preparedFiniteEntries,
  preparedFiniteSessionJournalEntryBrand,
  readConfirmedFiniteRootEntryCapture,
  runPreparedFiniteSessionJournalEntryEffect,
} from "../src/sessionJournalFiniteEntry";
import { createSessionJournalStorePersistence } from "../src/sessionJournalStore";
import { TEST_GRANT_RETENTION_POLICY_V1 } from "./transactionSessionActivationTestSupport";

type EntryState = NonNullable<ReturnType<typeof preparedFiniteEntries.get>>;
type Capture = Effect.Success<ReturnType<EntryState["run"]>>;
type RunArguments = Parameters<EntryState["run"]>;

// This tests only process-local installation and provenance. SQL correlation
// and canonical authentication are exercised by the connected entry fixture.
function lifecycleFixture(failure?: Error) {
  const capture = {
    applicationSelection: {}, issuedAdmissions: new Map(), finiteKey: "entry",
    preliminaryAuthority: { deploymentId: "deployment" }, state: {},
    context: { session: { bytes: new Uint8Array([1, 2]) } },
    rows: { session: { canonicalBytes: new Uint8Array([3, 4]) } }, finite: {},
  } as unknown as Capture;
  const entry = Object.freeze({ [preparedFiniteSessionJournalEntryBrand]: true as const });
  const install = vi.fn();
  const discard = vi.fn();
  const release = vi.fn();
  const state: EntryState = {
    issuer: {} as EntryState["issuer"], handle: {} as EntryState["handle"], status: "prepared",
    run: () => failure === undefined ? Effect.succeed(capture) : Effect.die(failure),
    install, discard, release,
  };
  preparedFiniteEntries.set(entry, state);
  const run = () => Effect.runPromise(runPreparedFiniteSessionJournalEntryEffect(entry,
    {} as RunArguments[0], {} as RunArguments[1], {} as RunArguments[2],
    {} as RunArguments[3], {} as RunArguments[4], undefined, Effect.void));
  return { entry, state, capture, install, discard, release, run };
}

describe("finite entry confirmed installation", () => {
  it("admits exactly one concurrent reservation at the actual 1,024-owner boundary", async () => {
    const databaseAccess = vi.fn(() => { throw new Error("Capacity test must not access persistence"); });
    const ports = new Proxy({} as EntryState["issuer"], { get: databaseAccess });
    const store = createSessionJournalStorePersistence(ports, { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1 });
    const states: EntryState[] = [];
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const scope = yield* Effect.acquireRelease(Scope.make(), scope => Scope.close(scope, Exit.succeed(undefined)));
      const reserve = Scope.provide(store.prepareFiniteEntryEffect([]), scope).pipe(Effect.tap(entry => Effect.sync(() => {
        const state = preparedFiniteEntries.get(entry);
        if (state === undefined) throw new Error("Missing actual capacity reservation");
        states.push(state);
      })));
      for (let ordinal = 0; ordinal < 1_023; ordinal++) yield* reserve;
      // The installed interpreter checks this scheduler budget before every
      // primitive, including masked acquisition. Force the former check/increment
      // gap to yield while both fibers contend for the one remaining slot.
      const contenders = yield* Effect.all([Effect.exit(reserve), Effect.exit(reserve)], { concurrency: 2 }).pipe(
        Effect.provideService(Scheduler.MaxOpsBeforeYield, 8),
      );
      expect(contenders.filter(Exit.isSuccess)).toHaveLength(1);
      expect(contenders.filter(Exit.isFailure)).toHaveLength(1);
      for (const exit of contenders) if (Exit.isFailure(exit)) {
        expect(Result.isFailure(Cause.findDefect(exit.cause))).toBe(true);
        expect(String(exit.cause)).toContain("finite root owner capacity exhausted");
      }
      expect(states.filter(state => state.status === "prepared")).toHaveLength(1_024);
      const unavailable = yield* Effect.exit(reserve);
      expect(Exit.isFailure(unavailable)).toBe(true);
      const accepted = contenders.find(Exit.isSuccess);
      if (accepted === undefined) return yield* Effect.die("Missing accepted capacity contender");
      abandonPreparedFiniteSessionJournalEntry(accepted.value);
      yield* reserve;
      expect(states.filter(state => state.status === "prepared")).toHaveLength(1_024);
    })));
    expect(states.every(state => state.status === "abandoned")).toBe(true);
    expect(databaseAccess).not.toHaveBeenCalled();
  });

  it("releases actual store reservations on cancellation before persistence handoff without exhausting capacity", async () => {
    // No database capability is exercised by reservation or abandonment. This
    // test-only proxy fails immediately if the actual store crosses that cut.
    const databaseAccess = vi.fn(() => { throw new Error("Reservation cancellation must not access persistence"); });
    const ports = new Proxy({} as EntryState["issuer"], { get: databaseAccess });
    const store = createSessionJournalStorePersistence(ports, { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1 });
    for (let ordinal = 0; ordinal < 1_025; ordinal++) {
      let state: EntryState | undefined;
      let release: ReturnType<typeof vi.spyOn> | undefined;
      let preparation: Parameters<typeof abandonPreparedFiniteSessionJournalEntry>[0] | undefined;
      const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
        preparation = yield* store.prepareFiniteEntryEffect([]);
        state = preparedFiniteEntries.get(preparation);
        if (state === undefined) return yield* Effect.die("Missing acquired reservation");
        release = vi.spyOn(state, "release");
        // Deterministic cancellation after acquisition, before the accepting
        // persistence operation can install its own error cleanup.
        return yield* Effect.interrupt;
      })));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      expect(state?.status).toBe("abandoned");
      expect(release).toHaveBeenCalledOnce();
      if (preparation !== undefined) abandonPreparedFiniteSessionJournalEntry(preparation);
      expect(release).toHaveBeenCalledOnce();
    }
    const sentinel = new Error("defect before finite persistence handoff");
    const defect = await Effect.runPromiseExit(Effect.scoped(store.prepareFiniteEntryEffect([]).pipe(
      Effect.andThen(Effect.die(sentinel)),
    )));
    expect(Exit.isFailure(defect)).toBe(true);
    if (Exit.isFailure(defect)) expect(Cause.findDefect(defect.cause).pipe(Result.getOrElse(() => undefined))).toBe(sentinel);
    expect(databaseAccess).not.toHaveBeenCalled();
  });

  it("installs only the exact capture returned by its original preparation", async () => {
    const first = lifecycleFixture();
    const second = lifecycleFixture();
    expect(() => confirmPreparedFiniteSessionJournalEntry(first.entry, first.capture)).toThrow();
    const [firstCapture, secondCapture] = await Promise.all([first.run(), second.run()]);
    expect(first.install).not.toHaveBeenCalled();
    expect(() => confirmPreparedFiniteSessionJournalEntry(first.entry, secondCapture)).toThrow();
    expect(() => confirmPreparedFiniteSessionJournalEntry(first.entry, { ...firstCapture })).toThrow();
    expect(first.install).not.toHaveBeenCalled();
    const confirmed = confirmPreparedFiniteSessionJournalEntry(first.entry, firstCapture);
    expect(first.install).toHaveBeenCalledExactlyOnceWith(firstCapture);
    expect(first.release).toHaveBeenCalledOnce();
    expect(readConfirmedFiniteRootEntryCapture(confirmed, first.state.issuer)).toBeDefined();
    expect(() => confirmPreparedFiniteSessionJournalEntry(first.entry, firstCapture)).toThrow();
    abandonPreparedFiniteSessionJournalEntry(first.entry);
    expect(first.discard).not.toHaveBeenCalled();
    abandonPreparedFiniteSessionJournalEntry(second.entry);
  });

  it("discards captured work and releases once on rollback or uncertain COMMIT", async () => {
    const fixture = lifecycleFixture();
    const capture = await fixture.run();
    abandonPreparedFiniteSessionJournalEntry(fixture.entry);
    abandonPreparedFiniteSessionJournalEntry(fixture.entry);
    expect(fixture.install).not.toHaveBeenCalled();
    expect(fixture.discard).toHaveBeenCalledExactlyOnceWith(capture);
    expect(fixture.release).toHaveBeenCalledOnce();
    expect(() => confirmPreparedFiniteSessionJournalEntry(fixture.entry, capture)).toThrow();
  });

  it("preserves the source defect and never installs partially prepared work", async () => {
    const failure = new Error("source failed after a prior source bound");
    const fixture = lifecycleFixture(failure);
    const exit = await Effect.runPromiseExit(runPreparedFiniteSessionJournalEntryEffect(fixture.entry,
      {} as RunArguments[0], {} as RunArguments[1], {} as RunArguments[2],
      {} as RunArguments[3], {} as RunArguments[4], undefined, Effect.void));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain(failure.message);
    abandonPreparedFiniteSessionJournalEntry(fixture.entry);
    expect(fixture.install).not.toHaveBeenCalled();
    expect(fixture.discard).not.toHaveBeenCalled();
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it("refuses cloned and foreign-issuer captures and detaches every read", async () => {
    const fixture = lifecycleFixture();
    const confirmed = confirmPreparedFiniteSessionJournalEntry(fixture.entry, await fixture.run());
    expect(readConfirmedFiniteRootEntryCapture({ ...confirmed }, fixture.state.issuer)).toBeUndefined();
    expect(readConfirmedFiniteRootEntryCapture(confirmed, {} as EntryState["issuer"])).toBeUndefined();
    const first = readConfirmedFiniteRootEntryCapture(confirmed, fixture.state.issuer);
    const second = readConfirmedFiniteRootEntryCapture(confirmed, fixture.state.issuer);
    expect(first).toEqual(second);
    expect(first?.rows).not.toBe(second?.rows);
    // Alter every copied frame through its test-only shape; issuer facts stay intact.
    const altered = first as unknown as { context: { session: { bytes: Uint8Array } }; rows: { session: { canonicalBytes: Uint8Array } } };
    altered.context.session.bytes[0] = 9;
    altered.rows.session.canonicalBytes[0] = 9;
    expect(readConfirmedFiniteRootEntryCapture(confirmed, fixture.state.issuer)).toEqual(second);
  });
});
