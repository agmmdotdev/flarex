import { afterAll, expect, it } from "vitest";
import { Effect, Exit, Fiber } from "effect";
import { currencyAnnouncementWrite } from "../../medusa-adapter/src/currency-service";
import { prepareCurrencyProfile } from "../../medusa-adapter/src/currency-contract";
import { commerceHostFixture } from "../test/commerceHostFixture";
import { commerceInventory } from "../test/commerceInventory";
import { createRelationalPGliteFixture } from "../test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../test/postgresHelpers";
import { makePostgresRelationalSession, issueRelationalSession, runRelationalSession } from "../src/relationalTransaction/session";
import { RelationalSessionError } from "../src/relationalTransaction/model";
import { runEffect } from "../test/effectTestRuntime";
import { makePayloadScalarRuntime } from "../src/payloadScalar/runtime";
import { payloadScalarFields, payloadScalarContentIdentity } from "../src/payloadScalar/profile";
import { makeCurrencyAnnouncementHost } from "../src/crossDomainCommand/host";
import { compositeError } from "../src/crossDomainCommand/model";
import { createIntrinsicCreationTimeIndexDefinitionPortV1 } from "../src/intrinsicCreationTimeIndexBuildV1";
import { createAppDeveloperIndexDefinitionPortV1 } from "../src/appDeveloperIndexCommitV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../src/appUniqueConstraintCommitV1";
import { createAppSchemaCandidateWriteGuardPort } from "../src/appSchemaCandidateValidation";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppIndexEntryCurrent, fxAppUniqueKeys, fxSystemCommitAppRowChanges } from "../src/schema";
import { assertCurrencyAnnouncementNativeOverlap } from "./currencyAnnouncementNativeOverlap";
import { defineCommerceCommand } from "../src/commerceTransaction/commands";
import { defineCmsCommand } from "../src/cmsTransaction/host";
import type { CompositeBinding } from "../src/crossDomainCommand/binding";

function postgresCode(cause: unknown): unknown {
  const visited = new Set<object>();
  let current = cause;
  while (typeof current === "object" && current !== null && !visited.has(current)) {
    visited.add(current);
    const code: unknown = Reflect.get(current, "code");
    if (typeof code === "string") return code;
    current = Reflect.get(current, "cause");
  }
  return undefined;
}

const cleanup: (() => Promise<void>)[] = [];
afterAll(async () => { for (const close of cleanup.reverse()) await close(); });
it("settles real Currency, Payload and Application participants once, with complete rollback and replay", async () => {
  const registerCleanup = (close: () => Promise<void>) => { cleanup.push(close); };
  const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
  if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid test driver");
  const resource = driver === "pglite" ? await createRelationalPGliteFixture({ registerCleanup }) : await (async () => {
    const fixture = await createFileScopedPostgresFixture(); registerCleanup(fixture.dispose);
    return { persistence: fixture.persistence, session: makePostgresRelationalSession(fixture.persistence) };
  })();
  const control = driver === "pglite" ? await createMigratedPGlitePersistence(registerCleanup) : resource.persistence;
  const fixture = await commerceHostFixture(resource.persistence, resource.session, prepareCurrencyProfile, [currencyAnnouncementWrite], control, undefined, { cmsFields: payloadScalarFields });
  const native = fixture.cms.fixture;
  const db = resource.persistence.drizzle;
  const inventory = async () => ({ commerce: await commerceInventory(fixture), rows: await db.select().from(fxAppRowCurrent), revisions: await db.select().from(fxAppRowRevisions),
    indexes: await db.select().from(fxAppIndexEntryCurrent), unique: await db.select().from(fxAppUniqueKeys), facts: await db.select().from(fxSystemCommitAppRowChanges) });
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePayloadScalarRuntime();
    const input = { database: db, controlDatabase: control.drizzle, session: resource.session, deploymentId: native.deploymentId,
      authority: native.authorityPorts, application: native.relationActivation, pointCommitAuthority: native.pointCommitAuthority,
      identityAndAccessPolicy: { subject: "composite-conformance" }, expectedContentIdentity: payloadScalarContentIdentity,
      materialization: { intrinsicCreationTimeIndexes: createIntrinsicCreationTimeIndexDefinitionPortV1(control.drizzle), developerIndexes: createAppDeveloperIndexDefinitionPortV1(control.drizzle),
        uniqueConstraints: createAppUniqueConstraintDefinitionPortV1(control.drizzle), candidateSchemaWriteGuard: createAppSchemaCandidateWriteGuardPort({ candidateValidation: native.candidateValidation, pointCommitAuthority: native.pointCommitAuthority }) },
      commerce: { target: fixture.hostInput.target, profile: fixture.hostInput.profile, installation: fixture.installation },
      currencyCommand: currencyAnnouncementWrite, cmsCommand: runtime.commands.create, applicationTable: "audit" };
    const host = yield* makeCurrencyAnnouncementHost(input);
    const args = (title: string, applicationTitle: string | number = title) => ({ currency: { code: "zzz", name: title, symbol: "T", symbol_native: "T", decimal_digits: 2, rounding: 0 },
      cms: { data: { title, publishedAt: "2026-01-01" } }, application: { title: applicationTitle } });
    yield* Effect.gen(function* () {
      const before = (yield* Effect.promise(inventory));
      const key = host.newRequestKey();
      const value = (yield* host.run(key, args("composite-success")));
      expect(value).toMatchObject({ currency: { code: "zzz" }, cms: { title: "composite-success" }, applicationId: expect.any(String) });
      const after = (yield* Effect.promise(inventory));
      expect(after.rows).toHaveLength(before.rows.length + 2);
      expect(after.revisions).toHaveLength(before.revisions.length + 2);
      expect(after.facts).toHaveLength(before.facts.length + 2);
      expect(after.commerce.rows).toHaveLength(before.commerce.rows.length + 1);
      expect(after.commerce.commits).toHaveLength(before.commerce.commits.length + 1);
      expect(after.commerce.outcomes).toHaveLength(before.commerce.outcomes.length + 1);
      expect(after.commerce.wakes).toHaveLength(before.commerce.wakes.length + 1);
      const commit = after.commerce.commits.at(-1);
      expect(commit).toMatchObject({ changeCount: 2, relationalChangeCount: 1 });
      expect(after.facts.every(fact => fact.commitSeq === commit?.commitSeq)).toBe(true);
      expect(after.commerce.facts.at(-1)?.commitSeq).toBe(commit?.commitSeq);
      const executions = runtime.executions();
      expect((yield* host.run(key, args("composite-success")))).toEqual(value);
      expect(runtime.executions()).toBe(executions);
      expect((yield* Effect.promise(inventory))).toEqual(after);
      expect((yield* Effect.flip(host.run(key, args("changed"))))).toMatchObject({ reason: "requestConflict" });
      expect((yield* Effect.flip(host.run(host.newRequestKey(), args("late-failure", 42))))).toMatchObject({ reason: "documentInvalid" });
      expect((yield* Effect.promise(inventory))).toEqual(after);
      for (const title of ["nested-caught", "id-foreign", "id-removed"]) {
        (yield* Effect.flip(host.run(host.newRequestKey(), args(title))));
        expect((yield* Effect.promise(inventory))).toEqual(after);
      }
      const nestedBefore = (yield* Effect.promise(inventory));
      (yield* host.run(host.newRequestKey(), args("nested-ok")));
      expect(((yield* Effect.promise(inventory))).rows).toHaveLength(nestedBefore.rows.length + 3);
      const stable = (yield* Effect.promise(inventory));
      const fail = () => Effect.fail(compositeError("invalidInput"));
      for (const hooks of [{ beforeApplication: fail }, { afterSteps: fail }, { receipts: (receipts: readonly object[]) => receipts.slice(0, 2) },
        { receipts: (receipts: readonly object[]) => receipts.map(receipt => ({ ...receipt })) },
        { bindingProof: (binding: CompositeBinding) => ({ ...binding }) }]) {
        const failing = (yield* makeCurrencyAnnouncementHost(input, hooks));
        (yield* Effect.flip(failing.run(failing.newRequestKey(), args("hook-failure"))));
        expect((yield* Effect.promise(inventory))).toEqual(stable);
      }
      for (const changedInput of [
        { ...input, applicationTable: "posts" },
        { ...input, expectedContentIdentity: { ...payloadScalarContentIdentity, configSha256: "0".repeat(64) } },
        { ...input, commerce: { ...input.commerce, installation: { ...input.commerce.installation, installationReceiptSha256: "0".repeat(64) } } },
      ]) {
        const refused = (yield* makeCurrencyAnnouncementHost(changedInput));
        (yield* Effect.flip(refused.run(refused.newRequestKey(), args("authority-refusal"))));
        expect((yield* Effect.promise(inventory))).toEqual(stable);
      }
      const event = defineCommerceCommand("currencyAnnouncementWrite", "write", ctx => ctx.captureLocalEvent({ name: "unadmitted" }).pipe(Effect.catch(() => Effect.void), Effect.as(null)));
      const noEvents = (yield* makeCurrencyAnnouncementHost({ ...input, currencyCommand: event }));
      (yield* Effect.flip(noEvents.run(noEvents.newRequestKey(), args("caught-event"))));
      expect((yield* Effect.promise(inventory))).toEqual(stable);
      const crossover = defineCmsCommand({ name: "payload-create", mode: "write", run: ctx => ctx.documents.insert(ctx.context, ctx.transactionId, "audit", { title: "denied" }) });
      const noCrossover = (yield* makeCurrencyAnnouncementHost({ ...input, cmsCommand: crossover }));
      (yield* Effect.flip(noCrossover.run(noCrossover.newRequestKey(), args("crossover"))));
      expect((yield* Effect.promise(inventory))).toEqual(stable);
      for (const step of ["commitHeaderWritten", "commitChangeWritten", "outcomeWritten", "wakeWritten", "clockAdvanced"]) {
        const failing = (yield* makeCurrencyAnnouncementHost({ ...input, materialization: { ...input.materialization,
          afterTransactionStep: async event => { if (event.step === step) throw new Error(`Injected ${step}`); } } }));
        (yield* Effect.flip(failing.run(failing.newRequestKey(), args("publication-failure"))));
        expect((yield* Effect.promise(inventory))).toEqual(stable);
      }
      let lost = true;
      const session = issueRelationalSession(db, work => runRelationalSession(resource.session, work).pipe(
        Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
        Effect.flatMap(value => { if (!lost) return Effect.succeed(value); lost = false; return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost composite COMMIT reply") })); })));
      const recovering = (yield* makeCurrencyAnnouncementHost({ ...input, session }));
      const recoveryExecutions = runtime.executions();
      const recoveryKey = recovering.newRequestKey();
      const recovered = (yield* recovering.run(recoveryKey, args("recovery")));
      expect(runtime.executions()).toBe(recoveryExecutions + 1);
      expect((yield* recovering.run(recoveryKey, args("recovery")))).toEqual(recovered);
      expect(runtime.executions()).toBe(recoveryExecutions + 1);
      yield* assertCurrencyAnnouncementNativeOverlap(fixture, host.run(host.newRequestKey(), args("native-overlap")));
      if ("pool" in resource.persistence) {
        const postgres = resource.persistence;
        const duplicatesBefore = (yield* Effect.promise(inventory));
        const duplicateCalls = runtime.executions();
        const duplicateKey = host.newRequestKey();
        const duplicates = yield* Effect.all([host.run(duplicateKey, args("concurrent-replay")), host.run(duplicateKey, args("concurrent-replay"))], { concurrency: 2 });
        expect(duplicates[0]).toEqual(duplicates[1]);
        expect(runtime.executions()).toBe(duplicateCalls + 1);
        expect(((yield* Effect.promise(inventory))).commerce.commits).toHaveLength(duplicatesBefore.commerce.commits.length + 1);

        const lockStable = (yield* Effect.promise(inventory));
        yield* Effect.scoped(Effect.gen(function* () {
          const blocker = yield* Effect.acquireRelease(Effect.promise(() => postgres.pool.connect()), client =>
            Effect.promise(() => client.query("rollback")).pipe(Effect.ensuring(Effect.sync(() => client.release()))));
          // This awaited session barrier runs after authority preparation and before
          // physical entry, so the command deterministically meets the competing lock.
          const contendedSession = issueRelationalSession(db, work => Effect.gen(function* () {
            yield* Effect.promise(() => blocker.query("begin"));
            yield* Effect.promise(() => blocker.query("select 1 from fx_system_scope_clock for update"));
            return yield* runRelationalSession(resource.session, work).pipe(
              Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))));
          }));
          const contended = yield* makeCurrencyAnnouncementHost({ ...input, session: contendedSession });
          const failure = yield* Effect.flip(contended.run(contended.newRequestKey(), args("blocked-command")));
          expect(postgresCode(failure)).toBe("55P03");
        }));
        expect((yield* Effect.promise(inventory))).toEqual(lockStable);

        const pendingBefore = runtime.pendingReads();
        const fiber = yield* Effect.forkScoped(host.run(host.newRequestKey(), args("id-unresolved")));
        try {
          const deadline = performance.now() + 5000;
          while (runtime.pendingReads() === pendingBefore && performance.now() < deadline) yield* Effect.sleep(10);
          expect(runtime.pendingReads()).toBe(pendingBefore + 1);
          (yield* Fiber.interrupt(fiber));
          expect(Exit.isFailure((yield* Fiber.await(fiber)))).toBe(true);
        } finally { (yield* Fiber.interrupt(fiber)); }
        expect((yield* Effect.promise(inventory))).toEqual(lockStable);

        let failedPid = 0;
        const pids: number[] = [];
        const physical = (yield* makeCurrencyAnnouncementHost({ ...input, session: makePostgresRelationalSession(postgres, { lifecycleFault: event => {
          const pid: unknown = Reflect.get(event.client, "processID");
          if (typeof pid !== "number") throw new Error("Missing backend PID");
          if (event.phase === "begin" && event.edge === "after") pids.push(pid);
          if (event.phase === "commit" && event.edge === "after" && failedPid === 0) { failedPid = pid; throw new Error("Lost real composite COMMIT acknowledgement"); }
        } }) }));
        const calls = runtime.executions();
        const physicalKey = physical.newRequestKey();
        const physicalResult = (yield* physical.run(physicalKey, args("physical-recovery")));
        expect(runtime.executions()).toBe(calls + 1);
        expect(pids.length).toBeGreaterThanOrEqual(2);
        expect(pids[1]).not.toBe(failedPid);
        expect((yield* physical.run(physicalKey, args("physical-recovery")))).toEqual(physicalResult);
        const beforeLoss = (yield* Effect.promise(inventory));
        let backendPid = 0;
        const terminated = (yield* makeCurrencyAnnouncementHost({ ...input, session: makePostgresRelationalSession(postgres, { lifecycleFault: event => {
          if (event.phase === "begin" && event.edge === "after") {
            const pid: unknown = Reflect.get(event.client, "processID");
            if (typeof pid !== "number") throw new Error("Missing backend PID");
            backendPid = pid;
          }
        } }) }, { afterSteps: () => Effect.promise(async () => {
          const terminated = await postgres.pool.query<{ terminated: boolean }>("select pg_terminate_backend($1) as terminated", [backendPid]);
          expect(terminated.rows[0]?.terminated).toBe(true);
        }) }));
        (yield* Effect.flip(terminated.run(terminated.newRequestKey(), args("backend-loss"))));
        expect((yield* Effect.promise(inventory))).toEqual(beforeLoss);
      }
    });
  })));
}, 240_000);
