import { describe, expect, it } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { compilePayloadCollections } from "../../payload-adapter/src/collections";
import { makePayloadConformanceRuntime } from "../../payload-adapter/src/testing";
import { payloadScalarContentIdentity } from "../../payload-adapter/src/conformanceProfile";
import { defineCmsCommand } from "../../persistence-postgres/src/cmsTransaction/host";
import { makeCurrencyAnnouncementHost, type CurrencyAnnouncementHostInput } from "../../persistence-postgres/src/crossDomainCommand/host";
import type { CurrencyAnnouncementTestHooks } from "../../persistence-postgres/src/crossDomainCommand/testSupport";
import { preparedHostTestRuntime } from "../../persistence-postgres/test/preparedHostRuntimeTestSupport";
import { postgresUrl } from "../../persistence-postgres/test/postgresHelpers";
import { issueRelationalSession, makePostgresRelationalSession, runRelationalSession } from
  "../../persistence-postgres/src/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/relationalTransaction/model";
import { compositeError } from "../../persistence-postgres/src/crossDomainCommand/model";
import { currencyAnnouncementWrite } from "../src/currency-service";
import { defineCommerceCommand } from "../../persistence-postgres/src/commerceTransaction/commands";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { postgresFailureCode } from "../../persistence-postgres/test/postgresFailureCode";
import { prepareNativeApplicationJournalOnLogicalScope } from
  "../../persistence-postgres/test/nativeApplicationJournalOnLogicalScope";
import { PointCommitConflictV1Error } from "../../persistence-postgres/src/pointCommitTransaction";

const causedBy = (value: unknown, expected: Error): boolean => {
  for (let depth = 0; depth < 8; depth++) {
    if (value === expected) return true;
    if (typeof value !== "object" || value === null || !("cause" in value)) return false;
    value = value.cause;
  }
  return false;
};
const scalarPostsDeclaration = () => [{ slug: "posts", fields: [
  { name: "title", type: "text", required: true, unique: true },
  { name: "score", type: "number", required: true, defaultValue: 0 },
  { name: "enabled", type: "checkbox", required: true, defaultValue: false },
  { name: "publishedAt", type: "date", required: true },
] }];

describe("selected logical Currency announcement", () => {
  for (const driver of ["pglite", "postgres"] as const) {
    it.skipIf(driver === "postgres" && postgresUrl === null)(`publishes and replays one three-source commit on ${driver}`, async () => {
      const cleanup: Array<() => Promise<void>> = [];
      try {
        const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close));
        await Effect.runPromise(Effect.scoped(Effect.fn("LogicalCurrencyAnnouncement.scenario")(function* () {
          const acquireHost = <Failure>(hostInput: CurrencyAnnouncementHostInput<Failure>,
            hooks?: CurrencyAnnouncementTestHooks) => Effect.acquireRelease(
              makeCurrencyAnnouncementHost(hostInput, hooks), host => host.close);
          const compiled = yield* (compilePayloadCollections([{ slug: "news", fields: [
            { name: "title", type: "text", required: true, unique: true },
          ] }]));
          let cmsExecutions = 0;
          const cmsCommand = defineCmsCommand({ name: "payload-create", mode: "write", run: (ctx, args) => {
            cmsExecutions++;
            return ctx.documents.insert(ctx.context, ctx.transactionId, "news", args);
          } });
          const input = { hostRuntime: preparedHostTestRuntime(fixture.persistence.drizzle),
            database: fixture.persistence.drizzle, controlDatabase: fixture.control.drizzle,
            session: fixture.session, deploymentId: fixture.deploymentId,
            authority: fixture.application.authorityPorts, application: fixture.application.activation,
            identityAndAccessPolicy: { profile: "logical-currency-announcement" }, materialization: {},
            expectedContentIdentity: compiled.contentIdentity, currency: fixture.hostInput.logicalStorage,
            applicationSource: fixture.applicationSource, payloadSource: compiled.sourceContract,
            currencyCommand: currencyAnnouncementWrite, cmsCommand, applicationTable: "users" };
          const before = yield* Effect.promise(() => logicalCurrencyInventory(fixture));
          const host = yield* (acquireHost(input));

          const args = { currency: { code: "zzz", name: "Joint announcement", symbol: "Z", symbol_native: "Z" },
            cms: { title: "Joint announcement", createdAt: "2026-09-23T00:00:00.000Z",
              updatedAt: "2026-09-23T00:00:00.000Z" }, application: { name: "Joint announcement" } };
          const key = host.newRequestKey();
          const value = yield* (host.run(key, args));
          expect(value).toMatchObject({ currency: { code: "zzz" }, cms: { title: "Joint announcement" },
            applicationId: expect.any(String) });
          const after = yield* Effect.promise(() => logicalCurrencyInventory(fixture));
          expect(after.rows).toHaveLength(before.rows.length + 3);
          expect(after.rowChanges).toHaveLength(before.rowChanges.length + 3);
          expect(after.commits).toHaveLength(before.commits.length + 1);
          expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
          expect(after.wakes).toHaveLength(before.wakes.length + 1);
          expect(after.physicalFacts).toEqual(before.physicalFacts);
          expect(after.rowChanges.slice(-3).every(row => row.commitSeq === after.commits.at(-1)?.commitSeq)).toBe(true);
          expect(yield* (host.run(key, args))).toEqual(value);
          expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(after);
          expect(yield* (Effect.result(host.run(key, { ...args,
            application: { name: "different" } })))).toMatchObject({ _tag: "Failure",
              failure: { reason: "requestConflict" } });
          expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(after);
          let reachedLate = false;
          const lateFault = new Error("Late announcement publication fault");
          const late = yield* (acquireHost({ ...input,
            materialization: { afterTransactionStep: async ({ step }) => {
              if (step === "clockAdvanced") { reachedLate = true; throw lateFault; }
            } } }));

          const lateFailure = yield* (Effect.flip(late.run(late.newRequestKey(), { ...args,
            currency: { ...args.currency, code: "yyy" }, cms: { ...args.cms, title: "Late announcement" } })));
          expect(reachedLate).toBe(true);
          expect(causedBy(lateFailure, lateFault)).toBe(true);
          expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(after);
          for (const [index, [step, code]] of ([
            ["commitHeaderWritten", "baa"], ["commitChangeWritten", "bab"],
            ["outcomeWritten", "bac"], ["wakeWritten", "bad"], ["clockAdvanced", "bae"],
          ] as const).entries()) {
            let reached = false;
            const fault = new Error(`Injected ${step}`);
            const failing = yield* (acquireHost({ ...input,
              materialization: { afterTransactionStep: async event => {
                if (event.step === step) { reached = true; throw fault; }
              } } }));

            const failedArgs = { ...args, currency: { ...args.currency, code },
              cms: { ...args.cms, title: `Publication failure ${index}` } };
            const failure = yield* (Effect.flip(failing.run(failing.newRequestKey(), failedArgs)));
            expect(reached).toBe(true);
            expect(causedBy(failure, fault)).toBe(true);
            expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(after);
          }
          const swallowedEvent = defineCommerceCommand("currencyAnnouncementWrite", "write", context =>
            context.captureLocalEvent({ name: "unadmitted" }).pipe(Effect.catch(() => Effect.void), Effect.as(null)));
          const noEvents = yield* (acquireHost({ ...input,
            currencyCommand: swallowedEvent }));

          expect((yield* (Effect.exit(noEvents.run(noEvents.newRequestKey(), { ...args,
            currency: { ...args.currency, code: "eee" }, cms: { ...args.cms, title: "Caught event" } }))))._tag)
            .toBe("Failure");
          expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(after);
          const crossover = defineCmsCommand({ name: "payload-create", mode: "write", run: context =>
            context.documents.insert(context.context, context.transactionId, "users", { name: "denied" }) });
          const noCrossover = yield* acquireHost({ ...input, cmsCommand: crossover });
          expect((yield* Effect.exit(noCrossover.run(noCrossover.newRequestKey(), { ...args,
            currency: { ...args.currency, code: "xxx" }, cms: { ...args.cms, title: "Crossover" } })))._tag)
            .toBe("Failure");
          expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(after);
          for (const hooks of [{ beforeApplication: () => Effect.fail(compositeError("invalidInput")) },
            { afterSteps: () => Effect.fail(compositeError("invalidInput")) },
            { receipts: (receipts: readonly object[]) => receipts.slice(0, 2) },
            { receipts: (receipts: readonly object[]) => receipts.map(receipt => ({ ...receipt })) }]) {
            const failing = yield* (acquireHost(input, hooks));

            expect((yield* (Effect.exit(failing.run(failing.newRequestKey(), { ...args,
              currency: { ...args.currency, code: "fff" }, cms: { ...args.cms, title: "Receipt failure" } }))))._tag)
              .toBe("Failure");
            expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(after);
          }
          for (const changed of [{ ...input, applicationTable: "news" },
            { ...input, expectedContentIdentity: { ...compiled.contentIdentity, configSha256: "0".repeat(64) } },
            { ...input, currency: { ...input.currency,
              initialization: { ...input.currency.initialization, datasetSha256: "0".repeat(64) } } }]) {
            const refused = yield* (acquireHost(changed));

            expect((yield* (Effect.exit(refused.run(refused.newRequestKey(), { ...args,
              currency: { ...args.currency, code: "ggg" }, cms: { ...args.cms, title: "Authority refusal" } }))))._tag)
              .toBe("Failure");
            expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(after);
          }
          let lostReply = true;
          const session = issueRelationalSession(input.database, (profile, work) =>
            runRelationalSession(fixture.session, profile, work).pipe(
              Effect.catchTag("RelationalTransactionError", cause =>
                Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
              Effect.flatMap(value => {
                if (!lostReply) return Effect.succeed(value);
                lostReply = false;
                return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain",
                  cause: new Error("Lost logical announcement COMMIT reply") }));
              })));
          const recovering = yield* (acquireHost({ ...input, session }));

          const recoveryArgs = { ...args, currency: { ...args.currency, code: "rrr" },
            cms: { ...args.cms, title: "Recovered announcement" } };
          const recoveryKey = recovering.newRequestKey();
          const beforeRecoveryExecutions = cmsExecutions;
          const recovered = yield* (recovering.run(recoveryKey, recoveryArgs));
          expect(cmsExecutions).toBe(beforeRecoveryExecutions + 1);
          expect(yield* (recovering.run(recoveryKey, recoveryArgs))).toEqual(recovered);
          expect(cmsExecutions).toBe(beforeRecoveryExecutions + 1);
          const recoveredInventory = yield* Effect.promise(() => logicalCurrencyInventory(fixture));
          expect(recoveredInventory.commits).toHaveLength(after.commits.length + 1);
          expect(recoveredInventory.outcomes).toHaveLength(after.outcomes.length + 1);
          expect(recoveredInventory.rows).toHaveLength(after.rows.length + 3);
          const concurrentArgs = { ...args, currency: { ...args.currency, code: "ccc" },
            cms: { ...args.cms, title: "Concurrent replay" } };
          const concurrentKey = host.newRequestKey();
          const beforeConcurrentExecutions = cmsExecutions;
          const concurrent = yield* (Effect.all([
            host.run(concurrentKey, concurrentArgs), host.run(concurrentKey, concurrentArgs),
          ], { concurrency: 2 }));
          expect(concurrent[0]).toEqual(concurrent[1]);
          expect(cmsExecutions).toBe(beforeConcurrentExecutions + 1);
          const concurrentInventory = yield* Effect.promise(() => logicalCurrencyInventory(fixture));
          expect(concurrentInventory.commits).toHaveLength(recoveredInventory.commits.length + 1);
          expect(concurrentInventory.rows).toHaveLength(recoveredInventory.rows.length + 3);
          yield* (Effect.scoped(Effect.gen(function* () {
            const entered = yield* Deferred.make<void>();
            const held = yield* acquireHost(input, {
              beforeApplication: () => Deferred.succeed(entered, undefined)
                .pipe(Effect.andThen(Effect.never)),
            });

            const interrupted = yield* held.run(held.newRequestKey(), { ...args,
              currency: { ...args.currency, code: "iii" },
              cms: { ...args.cms, title: "Interrupted announcement" } }).pipe(Effect.forkScoped);
            yield* Deferred.await(entered).pipe(Effect.timeout("5 seconds"));
            yield* Fiber.interrupt(interrupted);
            const interruptedExit = yield* Fiber.await(interrupted);
            expect(Exit.isFailure(interruptedExit)).toBe(true);
            if (Exit.isFailure(interruptedExit)) expect(Cause.hasInterruptsOnly(interruptedExit.cause)).toBe(true);
          })));
          expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(concurrentInventory);
          if ("pool" in fixture.persistence) {
            const postgres = fixture.persistence;
            const entered = yield* Deferred.make<void>();
            const admitted = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            const heldHost = yield* acquireHost(input, { beforeApplication: () =>
              Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))) });
            const admittedHost = yield* acquireHost(input, { beforeApplication: () =>
              Deferred.succeed(admitted, undefined).pipe(Effect.asVoid) });
            const overlapBefore = yield* Effect.promise(() => logicalCurrencyInventory(fixture));
            yield* Effect.scoped(Effect.gen(function* () {
              const first = yield* heldHost.run(heldHost.newRequestKey(), { ...args,
                currency: { ...args.currency, code: "hhh" },
                cms: { ...args.cms, title: "Held admission" } }).pipe(Effect.forkScoped);
              yield* Deferred.await(entered).pipe(Effect.timeout("5 seconds"));
              const second = yield* admittedHost.run(admittedHost.newRequestKey(), { ...args,
                currency: { ...args.currency, code: "jjj" },
                cms: { ...args.cms, title: "Overlapping admission" } })
                .pipe(Effect.forkScoped);
              yield* Deferred.await(admitted).pipe(Effect.timeout("5 seconds"));
              expect(yield* Deferred.isDone(release)).toBe(false);
              yield* Deferred.succeed(release, undefined);
              expect(yield* Fiber.join(first)).toMatchObject({ cms: { title: "Held admission" } });
              expect(yield* Fiber.join(second)).toMatchObject({ cms: { title: "Overlapping admission" } });
            }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("20 seconds")));
            const overlapAfter = yield* Effect.promise(() => logicalCurrencyInventory(fixture));
            expect(overlapAfter.commits).toHaveLength(overlapBefore.commits.length + 2);
            expect(overlapAfter.rows).toHaveLength(overlapBefore.rows.length + 6);
            const lockStable = yield* Effect.promise(() => logicalCurrencyInventory(fixture));
            yield* (Effect.scoped(Effect.gen(function* () {
              const blocker = yield* Effect.acquireRelease(Effect.promise(() => postgres.pool.connect()), client =>
                Effect.promise(() => client.query("rollback")).pipe(Effect.ensuring(Effect.sync(() => client.release(true)))));
              const contendedSession = issueRelationalSession(input.database, (profile, work) => Effect.gen(function* () {
                yield* Effect.promise(() => blocker.query("begin"));
                yield* Effect.promise(() => blocker.query("select 1 from fx_system_scope_clock for update"));
                return yield* runRelationalSession(fixture.session, profile, work).pipe(
                  Effect.catchTag("RelationalTransactionError", cause =>
                    Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))));
              }));
              const contended = yield* acquireHost({ ...input, session: contendedSession });

              const failure = yield* Effect.flip(contended.run(contended.newRequestKey(), { ...args,
                currency: { ...args.currency, code: "lll" },
                cms: { ...args.cms, title: "Lock contention" } }));
              expect(postgresFailureCode(failure)).toBe("55P03");
              yield* Effect.promise(() => blocker.query("rollback"));
            })));
            expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(lockStable);
            let failedPid = 0;
            const pids: number[] = [];
            const physical = yield* (acquireHost({ ...input,
              session: makePostgresRelationalSession(postgres, { lifecycleFault: event => {
                const pid: unknown = Reflect.get(event.client, "processID");
                if (typeof pid !== "number") throw new Error("Missing PostgreSQL backend PID");
                if (event.phase === "begin" && event.edge === "after") pids.push(pid);
                if (event.phase === "commit" && event.edge === "after" && failedPid === 0) {
                  failedPid = pid;
                  throw new Error("Lost physical logical announcement COMMIT acknowledgement");
                }
              } }) }));

            const physicalArgs = { ...args, currency: { ...args.currency, code: "ppp" },
              cms: { ...args.cms, title: "Physical recovery" } };
            const physicalKey = physical.newRequestKey();
            const beforePhysicalExecutions = cmsExecutions;
            const physicalResult = yield* (physical.run(physicalKey, physicalArgs));
            expect(cmsExecutions).toBe(beforePhysicalExecutions + 1);
            expect(pids.length).toBeGreaterThanOrEqual(2);
            expect(pids[1]).not.toBe(failedPid);
            expect(yield* (physical.run(physicalKey, physicalArgs))).toEqual(physicalResult);
            expect(cmsExecutions).toBe(beforePhysicalExecutions + 1);
            const physicalInventory = yield* Effect.promise(() => logicalCurrencyInventory(fixture));
            expect(physicalInventory.commits).toHaveLength(lockStable.commits.length + 1);
            expect(physicalInventory.rows).toHaveLength(lockStable.rows.length + 3);
            let backendPid = 0;
            const terminated = yield* acquireHost({ ...input,
              session: makePostgresRelationalSession(postgres, { lifecycleFault: event => {
                if (event.phase === "begin" && event.edge === "after") {
                  const pid: unknown = Reflect.get(event.client, "processID");
                  if (typeof pid !== "number") throw new Error("Missing PostgreSQL backend PID");
                  backendPid = pid;
                }
              } }),
            }, { afterSteps: () => Effect.promise(async () => {
              const response = await postgres.pool.query<{ terminated: boolean }>(
                "select pg_terminate_backend($1) as terminated", [backendPid]);
              expect(response.rows[0]?.terminated).toBe(true);
            }) });
            const beforeTermination = yield* Effect.promise(() => logicalCurrencyInventory(fixture));
            yield* Effect.flip(terminated.run(terminated.newRequestKey(), { ...args,
              currency: { ...args.currency, code: "ttt" },
              cms: { ...args.cms, title: "Backend termination" } }));
            expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(beforeTermination);
          }
        })()));
      } finally {
        const failures: unknown[] = [];
        for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
        if (failures.length > 0) throw new AggregateError(failures, "Logical announcement cleanup failed");
      }
    }, 180_000);
    it.skipIf(driver === "postgres" && postgresUrl === null)(`executes native Payload Local API and hooks on ${driver}`, async () => {
      const cleanup: Array<() => Promise<void>> = [];
      try {
        const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close),
          { includeUserNameIndex: true, payloadCollections: scalarPostsDeclaration() });
        await Effect.runPromise(Effect.scoped(Effect.fn("LogicalCurrencyAnnouncement.nativePayload")(function* () {
          const native = yield* makePayloadConformanceRuntime();
          const compiled = yield* compilePayloadCollections(scalarPostsDeclaration());
          expect(compiled.contentIdentity).toEqual(payloadScalarContentIdentity);
          const input = { hostRuntime: preparedHostTestRuntime(fixture.persistence.drizzle),
            database: fixture.persistence.drizzle, controlDatabase: fixture.control.drizzle,
            session: fixture.session, deploymentId: fixture.deploymentId,
            authority: fixture.application.authorityPorts, application: fixture.application.activation,
            identityAndAccessPolicy: { profile: "logical-native-payload-announcement" }, materialization: {},
            expectedContentIdentity: compiled.contentIdentity, currency: fixture.hostInput.logicalStorage,
            applicationSource: fixture.applicationSource, payloadSource: compiled.sourceContract,
            currencyCommand: currencyAnnouncementWrite, cmsCommand: native.runtime.commands.create,
            applicationTable: "users" };
          const host = yield* Effect.acquireRelease(makeCurrencyAnnouncementHost(input), value => value.close);
          const args = (title: string, code: string) => ({
            currency: { code, name: title, symbol: "N", symbol_native: "N" },
            cms: { collection: "posts", data: { title, publishedAt: "2026-09-23" } },
            application: { name: title },
          });
          const before = yield* Effect.promise(() => logicalCurrencyInventory(fixture));
          const nativeJournal = yield* prepareNativeApplicationJournalOnLogicalScope(fixture.application);
          const key = host.newRequestKey();
          const result = yield* host.run(key, args("native-payload", "nnn"));
          expect(result).toMatchObject({ currency: { code: "nnn" }, cms: { title: "native-payload" },
            applicationId: expect.any(String) });
          const after = yield* Effect.promise(() => logicalCurrencyInventory(fixture));
          expect(after.rows).toHaveLength(before.rows.length + 3);
          expect(after.commits).toHaveLength(before.commits.length + 1);
          expect(after.rowChanges).toHaveLength(before.rowChanges.length + 3);
          expect(native.observations.executions()).toBe(1);
          expect(native.observations.touched()).toContain("posts");
          const conflict = yield* Effect.flip(nativeJournal.publish);
          expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
          expect(conflict).toMatchObject({ conflict: { kind: "appIndexRange", reason: "overlap" } });
          yield* nativeJournal.verifyUnchanged;
          expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(after);
          expect(yield* host.run(key, args("native-payload", "nnn"))).toEqual(result);
          expect(native.observations.executions()).toBe(1);
          expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(after);
          const invalidApp = { ...args("invalid-application", "aaa"), application: { name: 42 } };
          expect(yield* Effect.flip(host.run(host.newRequestKey(), invalidApp)))
            .toMatchObject({ reason: "documentInvalid" });
          expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(after);
          for (const [title, code] of [["nested-caught", "bbb"], ["id-foreign", "ccc"],
            ["id-removed", "ddd"]] as const) {
            yield* Effect.flip(host.run(host.newRequestKey(), args(title, code)));
            expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(after);
          }
          const nestedResult = yield* host.run(host.newRequestKey(), args("nested-ok", "eee"));
          expect(nestedResult).toMatchObject({ cms: { title: "nested-ok" } });
          const nested = yield* Effect.promise(() => logicalCurrencyInventory(fixture));
          expect(nested.rows).toHaveLength(after.rows.length + 4);
          expect(nested.commits).toHaveLength(after.commits.length + 1);
          const pendingBefore = native.observations.pendingReads();
          yield* Effect.scoped(Effect.gen(function* () {
            const fiber = yield* host.run(host.newRequestKey(), args("id-unresolved", "fff"))
              .pipe(Effect.forkScoped);
            yield* Effect.gen(function* () {
              while (native.observations.pendingReads() === pendingBefore) yield* Effect.sleep(10);
            }).pipe(Effect.timeout("5 seconds"));
            expect(native.observations.pendingReads()).toBe(pendingBefore + 1);
            yield* Fiber.interrupt(fiber);
            const interrupted = yield* Fiber.await(fiber);
            expect(Exit.isFailure(interrupted)).toBe(true);
            if (Exit.isFailure(interrupted)) expect(Cause.hasInterruptsOnly(interrupted.cause)).toBe(true);
          }));
          expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(nested);
        })()));
      } finally {
        const failures: unknown[] = [];
        for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
        if (failures.length > 0) throw new AggregateError(failures, "Native Payload announcement cleanup failed");
      }
    }, 180_000);
  }
});
