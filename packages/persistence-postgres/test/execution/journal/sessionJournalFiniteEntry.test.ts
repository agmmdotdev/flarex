import { Cause, Effect, Exit, Result, Scheduler, Scope } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  abandonPreparedFiniteSessionJournalEntry,
  confirmPreparedFiniteSessionJournalEntry,
  issuePreparedFiniteSessionJournalEntry,
  inspectPreparedFiniteSessionJournalEntry,
  runPreparedFiniteEntryCaptureEffect,
  type PreparedFiniteEntryInput,
  type PreparedFiniteSessionJournalEntry,
  type FiniteEntryRun,
  readConfirmedFiniteRootEntryCapture,
} from "../../../src/execution/journal/finiteEntry";
import { createSessionJournalStorePersistence } from "../../../src/execution/sessionJournalStore";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
} from "../session/support/activationEvidence";

type Capture = Effect.Success<ReturnType<FiniteEntryRun>>;
type RunArguments = Parameters<FiniteEntryRun>;

// This tests only process-local installation and provenance. SQL correlation
// and canonical authentication are exercised by the connected entry fixture.
function lifecycleFixture(failure?: Error) {
  const capture = {
    applicationSelection: {}, issuedAdmissions: new Map(), finiteKey: "entry",
    preliminaryAuthority: { deploymentId: "deployment" }, state: {},
    context: { session: { bytes: new Uint8Array([1, 2]) } },
    schemaManifest: { bytes: new Uint8Array([3, 4]) }, stableBindings: [], applicationEvidence: { manifest: {} }, finite: {},
  } as unknown as Capture;
  const install = vi.fn();
  const discard = vi.fn();
  const release = vi.fn();
  const issuer = {} as PreparedFiniteEntryInput["issuer"];
  const entry = issuePreparedFiniteSessionJournalEntry({
    issuer, attempt: {} as PreparedFiniteEntryInput["attempt"],
    run: () => failure === undefined ? Effect.succeed(capture) : Effect.die(failure),
    install, discard, release,
  });
  // This owner operation records the capture; accepting SQL belongs to the
  // connected database fixture rather than this process-local lifecycle proof.
  const run = () => Effect.runPromise(runPreparedFiniteEntryCaptureEffect(entry,
    {} as RunArguments[0], {} as RunArguments[1], {} as RunArguments[2],
    {} as RunArguments[3], {} as RunArguments[4], undefined, capture.canonicalExecutionAuthority, Effect.void)
    .pipe(Effect.map(value => value.capture)));
  return { entry, issuer, capture, install, discard, release, run };
}

describe("finite entry confirmed installation", () => {
  it("admits exactly one concurrent reservation at the actual 1,024-owner boundary", async () => {
    const databaseAccess = vi.fn(() => { throw new Error("Capacity test must not access persistence"); });
    const ports = new Proxy({} as PreparedFiniteEntryInput["issuer"], { get: databaseAccess });
    const store = createSessionJournalStorePersistence(ports, { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1 });
    const entries: PreparedFiniteSessionJournalEntry[] = [];
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const scope = yield* Effect.acquireRelease(Scope.make(), scope => Scope.close(scope, Exit.succeed(undefined)));
      const reserve = Scope.provide(store.prepareFiniteEntryEffect([]), scope).pipe(Effect.tap(entry => Effect.sync(() => {
        if (inspectPreparedFiniteSessionJournalEntry(entry) === undefined) throw new Error("Missing actual capacity reservation");
        entries.push(entry);
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
      expect(entries.filter(entry => inspectPreparedFiniteSessionJournalEntry(entry)?.status === "prepared")).toHaveLength(1_024);
      const unavailable = yield* Effect.exit(reserve);
      expect(Exit.isFailure(unavailable)).toBe(true);
      const accepted = contenders.find(Exit.isSuccess);
      if (accepted === undefined) return yield* Effect.die("Missing accepted capacity contender");
      abandonPreparedFiniteSessionJournalEntry(accepted.value);
      yield* reserve;
      expect(entries.filter(entry => inspectPreparedFiniteSessionJournalEntry(entry)?.status === "prepared")).toHaveLength(1_024);
    })));
    expect(entries.every(entry => inspectPreparedFiniteSessionJournalEntry(entry)?.status === "abandoned")).toBe(true);
    expect(databaseAccess).not.toHaveBeenCalled();
  });

  it("releases actual store reservations on cancellation before persistence handoff without exhausting capacity", async () => {
    // No database capability is exercised by reservation or abandonment. This
    // test-only proxy fails immediately if the actual store crosses that cut.
    const databaseAccess = vi.fn(() => { throw new Error("Reservation cancellation must not access persistence"); });
    const ports = new Proxy({} as PreparedFiniteEntryInput["issuer"], { get: databaseAccess });
    const store = createSessionJournalStorePersistence(ports, { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1 });
    for (let ordinal = 0; ordinal < 1_025; ordinal++) {
      let preparation: Parameters<typeof abandonPreparedFiniteSessionJournalEntry>[0] | undefined;
      const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
        preparation = yield* store.prepareFiniteEntryEffect([]);
        if (inspectPreparedFiniteSessionJournalEntry(preparation) === undefined) return yield* Effect.die("Missing acquired reservation");
        // Deterministic cancellation after acquisition, before the accepting
        // persistence operation can install its own error cleanup.
        return yield* Effect.interrupt;
      })));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      if (preparation === undefined) throw new Error("Missing acquired reservation");
      expect(inspectPreparedFiniteSessionJournalEntry(preparation)?.status).toBe("abandoned");
      abandonPreparedFiniteSessionJournalEntry(preparation);
      expect(inspectPreparedFiniteSessionJournalEntry(preparation)?.status).toBe("abandoned");
    }
    const sentinel = new Error("defect before finite persistence handoff");
    const defect = await Effect.runPromiseExit(Effect.scoped(store.prepareFiniteEntryEffect([]).pipe(
      Effect.andThen(Effect.die(sentinel)),
    )));
    expect(Exit.isFailure(defect)).toBe(true);
    if (Exit.isFailure(defect)) expect(Cause.findDefect(defect.cause).pipe(Result.getOrElse(() => undefined))).toBe(sentinel);
    // Repeated abandonment must neither leak nor underflow the actual capacity.
    // The callback lifecycle proof below independently asserts once-only release.
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      for (let ordinal = 0; ordinal < 1_024; ordinal++) yield* store.prepareFiniteEntryEffect([]);
      const unavailable = yield* Effect.exit(store.prepareFiniteEntryEffect([]));
      expect(Exit.isFailure(unavailable)).toBe(true);
      if (Exit.isFailure(unavailable)) expect(String(unavailable.cause)).toContain("finite root owner capacity exhausted");
    })));
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
    expect(readConfirmedFiniteRootEntryCapture(confirmed, first.issuer)).toBeDefined();
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
    const exit = await Effect.runPromiseExit(runPreparedFiniteEntryCaptureEffect(fixture.entry,
      {} as RunArguments[0], {} as RunArguments[1], {} as RunArguments[2],
      {} as RunArguments[3], {} as RunArguments[4], undefined, fixture.capture.canonicalExecutionAuthority, Effect.void));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.findDefect(exit.cause).pipe(Result.getOrElse(() => undefined))).toBe(failure);
    abandonPreparedFiniteSessionJournalEntry(fixture.entry);
    expect(fixture.install).not.toHaveBeenCalled();
    expect(fixture.discard).not.toHaveBeenCalled();
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it("refuses cloned and foreign-issuer captures and detaches every read", async () => {
    const fixture = lifecycleFixture();
    const confirmed = confirmPreparedFiniteSessionJournalEntry(fixture.entry, await fixture.run());
    expect(readConfirmedFiniteRootEntryCapture({ ...confirmed }, fixture.issuer)).toBeUndefined();
    expect(readConfirmedFiniteRootEntryCapture(confirmed, {} as PreparedFiniteEntryInput["issuer"])).toBeUndefined();
    const first = readConfirmedFiniteRootEntryCapture(confirmed, fixture.issuer);
    const second = readConfirmedFiniteRootEntryCapture(confirmed, fixture.issuer);
    expect(first).toEqual(second);
    expect(first?.schemaManifest).not.toBe(second?.schemaManifest);
    // Alter every copied frame through its test-only shape; issuer facts stay intact.
    const altered = first as unknown as { context: { session: { bytes: Uint8Array } }; schemaManifest: { bytes: Uint8Array } };
    altered.context.session.bytes[0] = 9;
    altered.schemaManifest.bytes[0] = 9;
    expect(readConfirmedFiniteRootEntryCapture(confirmed, fixture.issuer)).toEqual(second);
  });
});
