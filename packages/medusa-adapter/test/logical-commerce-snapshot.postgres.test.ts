import { Deferred, Effect, Fiber, Tracer } from "effect";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineCommerceCommand, makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { commerceError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { issueRelationalSession, runRelationalSession, type RelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { runDrizzleStatementEffect } from "../../persistence-postgres/src/database/drizzleStatementEffect";
import { runEffectTransaction } from "../../persistence-postgres/src/database/effectTransaction";
import type { FlarexMetadataTransaction } from "../../persistence-postgres/src/database/metadataTransaction";
import { advanceScopeAuthorizationRevocationEpochInTransactionEffect } from "../../persistence-postgres/src/scope/scopeClock";
import { fxSystemScopeClocks, fxSystemScopeExecutionAuthorities } from "../../persistence-postgres/src/database/schema";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../persistence-postgres/src/installation/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../persistence-postgres/src/installation/frameworkSchema/binding/selection";
import { fxSystemDataBindingHeads } from "../../persistence-postgres/src/installation/frameworkSchema/binding/schema";
import type { Json, JsonObject } from "flarex-protocol/json";
import { currencyAnnouncementWrite, currencyCommands } from "../src/currency-service";

describe.skipIf(postgresUrl === null)("logical commerce snapshots and publication", () => {
  const cleanup: Array<() => Promise<void>> = [];
  let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
  let template: JsonObject;
  let baselineName: string;
  let executions = 0;
  const insert = defineCommerceCommand("snapshotLogicalInsert", "write", Effect.fn(function* (ctx, id) {
    if (typeof id !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
    executions++;
    return [yield* ctx.nested(currencyAnnouncementWrite, { ...template, code: id, name: `Snapshot ${id}` })];
  }));
  const participant = defineAtomicCommerceParticipant("snapshotCurrency");
  const atomic = defineAtomicCommerceCommand("snapshotLogicalAtomicInsert", (ctx, id) => ctx.call(participant, insert, id));
  const readCommand = (between: Effect.Effect<void>) => defineCommerceCommand("snapshotLogicalRead", "read", Effect.fn(function* (ctx, id) {
    if (typeof id !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
    const options = (code: string) => ({ filters: { code }, config: { select: ["code", "name"] } });
    const first = yield* ctx.nested(currencyCommands.list, options("baseline"));
    yield* between;
    const second = yield* ctx.nested(currencyCommands.list, options(id));
    return { first, second };
  }));
  const local = (commands: Parameters<typeof makeCommerceHost>[0]["commands"], session: RelationalSession = fixture.session) =>
    Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, commands, session }));
  const writer = async (kind: "standalone" | "atomic", session: RelationalSession = fixture.session) => {
    if (kind === "standalone") {
      const host = await local([insert, currencyAnnouncementWrite], session);
      return { host, key: host.newRequestKey(), run: (key: string, id: string) => host.run(key, insert, id) };
    }
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput, session, commands: [atomic],
      participants: [{ participant, logicalStorage: fixture.hostInput.logicalStorage,
        commands: [insert, currencyAnnouncementWrite] }] }));
    return { host, key: host.newRequestKey(), run: (key: string, id: string) => host.run(key, atomic, id) };
  };
  const assertReadPinsScopeClock = async () => {
    if (fixture.resource.kind !== "postgres") throw new Error("PostgreSQL connection required");
    const scope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
    const client = await fixture.resource.target.pool.connect();
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '100ms'");
      await expect(client.query("select scope_uuid from fx_system_scope_clock where scope_uuid=$1 for update", [scope]))
        .rejects.toMatchObject({ code: "55P03" });
    } finally {
      await client.query("rollback");
      client.release();
    }
  };

  beforeAll(async () => {
    fixture = await logicalCurrencyFixture("postgres", close => cleanup.push(close));
    const first = fixture.initialization.rows[0];
    if (first === undefined) throw new Error("Missing Currency seed");
    const input: Record<string, Json> = { ...first };
    delete input.raw_rounding;
    template = input;
    baselineName = "Snapshot baseline";
    const host = await local([insert, currencyAnnouncementWrite]);
    try { await Effect.runPromise(host.run(host.newRequestKey(), insert, "baseline")); }
    finally { await Effect.runPromise(host.close); }
    const superuser = (await fixture.persistence.query<{ superuser: boolean }>(
      "select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser;
    expect(superuser).toBe(false);
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  for (const kind of ["standalone", "atomic"] as const) {
    it(`${kind} publishes while an earlier logical read retains its snapshot`, async () => {
      const entered = await Effect.runPromise(Deferred.make<void>());
      const release = await Effect.runPromise(Deferred.make<void>());
      const read = readCommand(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))));
      const reader = await local([read, currencyCommands.list]);
      const write = await writer(kind);
      try {
        const id = `${kind}-logical-reader`;
        const before = await logicalCurrencyInventory(fixture);
        const count = executions;
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const reading = yield* reader.read(read, id).pipe(Effect.forkScoped);
          yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"));
          yield* Effect.promise(assertReadPinsScopeClock);
          const result = yield* write.run(write.key, id);
          expect(result).toEqual([expect.objectContaining({ code: id, name: `Snapshot ${id}` })]);
          expect(yield* Deferred.isDone(release)).toBe(false);
          expect(yield* write.run(write.key, id)).toEqual(result);
          yield* Deferred.succeed(release, undefined);
          expect(yield* Fiber.join(reading)).toEqual({ first: [{ code: "baseline", name: baselineName }], second: [] });
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("25 seconds"))));
        const after = await logicalCurrencyInventory(fixture);
        expect(executions).toBe(count + 1);
        expect(after.rowChanges.length - before.rowChanges.length).toBe(1);
        expect(after.commits.length - before.commits.length).toBe(1);
        expect(after.outcomes.length - before.outcomes.length).toBe(1);
        expect(after.wakes.length - before.wakes.length).toBe(1);
        expect(after.clocks[0]?.lastCommitSeq).toBe((before.clocks[0]?.lastCommitSeq ?? 0n) + 1n);
        const freshRead = readCommand(Effect.void);
        const fresh = await local([freshRead, currencyCommands.list]);
        try { expect(await Effect.runPromise(fresh.read(freshRead, id))).toEqual({
          first: [{ code: "baseline", name: baselineName }], second: [{ code: id, name: `Snapshot ${id}` }],
        }); } finally { await Effect.runPromise(fresh.close); }
        expect(await logicalCurrencyInventory(fixture)).toEqual(after);
        await expect(fixture.service.retrieveCurrency(id)).resolves.toMatchObject({ code: id, name: `Snapshot ${id}` });
        if (fixture.resource.kind === "postgres")
          expect(fixture.resource.target.pool.idleCount).toBe(fixture.resource.target.pool.totalCount);
      } finally {
        await Effect.runPromise(reader.close);
        await Effect.runPromise(write.host.close);
      }
    }, 90_000);
  }

  for (const kind of ["standalone", "atomic"] as const) {
    it(`fresh logical Currency read completes while ${kind} publication awaits COMMIT`, async () => {
      const entered = await Effect.runPromise(Deferred.make<void>());
      const release = await Effect.runPromise(Deferred.make<void>());
      const heldSession = issueRelationalSession(fixture.persistence.drizzle, (profile, work, commandMs) =>
        runRelationalSession(fixture.session, profile, tx => work(tx).pipe(Effect.tap(() =>
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))))), commandMs).pipe(
          Effect.catchTag("RelationalTransactionError", cause =>
            Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause })))));
      const closeHosts: Array<() => Promise<void>> = [];
      try {
        const write = await writer(kind, heldSession);
        closeHosts.push(() => Effect.runPromise(write.host.close));
        const competing = await writer(kind);
        closeHosts.push(() => Effect.runPromise(competing.host.close));
        const read = readCommand(Effect.void);
        const reader = await local([read, currencyCommands.list]);
        closeHosts.push(() => Effect.runPromise(reader.close));
        const id = `${kind}-held-publication`;
        const before = await logicalCurrencyInventory(fixture);
        const count = executions;
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const writing = yield* write.run(write.key, id).pipe(Effect.forkScoped);
          yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"));
          expect(yield* reader.read(read, id).pipe(Effect.timeout("3 seconds"))).toEqual({
            first: [{ code: "baseline", name: baselineName }], second: [],
          });
          expect(yield* Effect.promise(() => logicalCurrencyInventory(fixture))).toEqual(before);
          const refused = yield* competing.run(competing.key, `${id}-competing`).pipe(Effect.result);
          expect(refused).toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure",
            cause: { operation: "lockForOrdinaryWrite", cause: { cause: { code: "55P03" } } } } });
          expect(executions).toBe(count + 2);
          yield* Deferred.succeed(release, undefined);
          const result = yield* Fiber.join(writing);
          expect(result).toEqual([expect.objectContaining({ code: id, name: `Snapshot ${id}` })]);
          expect(yield* competing.run(write.key, id)).toEqual(result);
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("20 seconds"))));
        const after = await logicalCurrencyInventory(fixture);
        expect(after.rows.length - before.rows.length).toBe(1);
        expect(after.commits.length - before.commits.length).toBe(1);
        expect(after.outcomes.length - before.outcomes.length).toBe(1);
        expect(after.rowChanges.length - before.rowChanges.length).toBe(1);
        expect(executions).toBe(count + 2);
        if (fixture.resource.kind === "postgres")
          expect(fixture.resource.target.pool.idleCount).toBe(fixture.resource.target.pool.totalCount);
      } finally {
        for (const close of closeHosts.reverse()) await close();
      }
    }, 90_000);
  }

  for (const kind of ["standalone", "atomic"] as const) {
    it.each([false, true])(`${kind} admits logical metadata during protected execution (duplicate=%s)`, async duplicate => {
      const held = await Effect.runPromise(Deferred.make<void>());
      const attempted = await Effect.runPromise(Deferred.make<void>());
      const secondEntered = await Effect.runPromise(Deferred.make<void>());
      const release = await Effect.runPromise(Deferred.make<void>());
      const firstId = `${kind}-logical-admission-${duplicate}-first`;
      const secondId = duplicate ? firstId : `${kind}-logical-admission-second`;
      let callbacks = 0;
      const command = defineCommerceCommand("snapshotLogicalAdmission", "write", Effect.fn(function* (ctx, id) {
        if (typeof id !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
        callbacks++;
        if (!duplicate && id === secondId) yield* Deferred.succeed(secondEntered, undefined);
        const row = yield* ctx.nested(currencyAnnouncementWrite, { ...template, code: id, name: `Snapshot ${id}` });
        if (id === firstId) {
          yield* Deferred.succeed(held, undefined);
          yield* Deferred.await(release);
        }
        return row;
      }));
      const atomicCommand = defineAtomicCommerceCommand("snapshotLogicalAdmission", (ctx, id) => ctx.call(participant, command, id));
      const selected = kind === "atomic"
        ? await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
          commands: [atomicCommand], participants: [{ participant, logicalStorage: fixture.hostInput.logicalStorage,
            commands: [command, currencyAnnouncementWrite] }] })).then(host => ({
          key: host.newRequestKey(), run: (requestKey: string, id: string) => host.run(requestKey, atomicCommand, id),
          close: host.close,
        }))
        : await local([command, currencyAnnouncementWrite]).then(host => ({
          key: host.newRequestKey(), run: (requestKey: string, id: string) => host.run(requestKey, command, id),
          close: host.close,
        }));
      try {
        const { key, run } = selected;
        const spans: string[] = [];
        const tracer = Tracer.make({ span(options) {
          spans.push(options.name);
          if (options.name === "CommerceHost.attempt" || options.name === "AtomicCommerce.attempt")
            Effect.runSync(Deferred.succeed(attempted, undefined));
          return new Tracer.NativeSpan(options);
        } });
        const before = await logicalCurrencyInventory(fixture);
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const first = yield* run(key, firstId).pipe(Effect.forkScoped);
          yield* Deferred.await(held).pipe(Effect.timeout("10 seconds"));
          const second = yield* run(duplicate ? key : `${key}/second`, secondId)
            .pipe(Effect.provideService(Tracer.Tracer, tracer), Effect.forkScoped);
          yield* Deferred.await(attempted).pipe(Effect.timeout("10 seconds"));
          if (!duplicate) {
            yield* Deferred.await(secondEntered).pipe(Effect.timeout("10 seconds"));
            expect(spans).toContain("LogicalSourceAdmission.withBinding");
            expect(spans).toContain("LogicalRelationalAdmission.withTransaction");
          } else {
            const requestLockKey = JSON.stringify(["flarex.commerce.request", fixture.application.authority.scopeId, key]);
            yield* Effect.promise(() => expect.poll(async () => {
              const result = await fixture.persistence.query<{ waiting: boolean }>(`
                select exists (
                  select 1 from pg_locks pending
                  join pg_locks holder using (locktype, database, classid, objid, objsubid)
                  join pg_stat_activity activity on activity.pid = pending.pid
                  where pending.locktype = 'advisory' and not pending.granted and holder.granted
                    and pending.pid <> holder.pid and pending.database = (
                      select oid from pg_database where datname = current_database())
                    and pending.classid::bigint = (hashtextextended($1, 0) >> 32) & 4294967295::bigint
                    and pending.objid::bigint = hashtextextended($1, 0) & 4294967295::bigint
                    and pending.objsubid = 1
                    and activity.usename = current_user
                    and activity.query like '%pg_advisory_xact_lock%'
                ) as waiting`, [requestLockKey]);
              return result.rows[0]?.waiting ?? false;
            }, { timeout: 10_000, interval: 25 }).toBe(true));
            expect(spans).not.toContain("LogicalRelationalAdmission.withTransaction");
            expect(spans).not.toContain("LogicalSourceAdmission.withBinding");
          }
          expect(callbacks).toBe(duplicate ? 1 : 2);
          expect(yield* Deferred.isDone(release)).toBe(false);
          yield* Deferred.succeed(release, undefined);
          const firstResult = yield* Fiber.join(first);
          const secondResult = yield* Fiber.join(second);
          if (duplicate) {
            expect(secondResult).toEqual(firstResult);
            expect(spans).toContain("LogicalRelationalAdmission.withTransaction");
            expect(spans).toContain("LogicalSourceAdmission.withBinding");
            expect(spans).toContain("DataBinding.verifyLogicalSchema");
          }
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("25 seconds"))));
        const after = await logicalCurrencyInventory(fixture);
        const publications = duplicate ? 1 : 2;
        expect(callbacks).toBe(publications);
        expect(after.rows.length - before.rows.length).toBe(publications);
        expect(after.commits.length - before.commits.length).toBe(publications);
        expect(after.outcomes.length - before.outcomes.length).toBe(publications);
        expect(after.rowChanges.length - before.rowChanges.length).toBe(publications);
        if (fixture.resource.kind === "postgres")
          expect(fixture.resource.target.pool.idleCount).toBe(fixture.resource.target.pool.totalCount);
      } finally {
        await Effect.runPromise(selected.close);
      }
    }, 120_000);
  }

  it.each(["binding", "revocation"] as const)(
    "rejects a %s change before a logical Currency read reaches native work", async transition => {
      const entered = await Effect.runPromise(Deferred.make<void>());
      const release = await Effect.runPromise(Deferred.make<void>());
      const bindingBase = { database: fixture.persistence.drizzle,
        selection: { deploymentId: fixture.deploymentId, scopeId: fixture.application.authority.scopeId },
        target: fixture.bindingTarget, authority: fixture.application.authorityPorts,
        application: fixture.application.activation };
      const bindingInput = { ...bindingBase,
        logicalStorage: { controlDb: fixture.control.drizzle, schemaVersionId: fixture.schemaVersionId,
          unique: fixture.application.uniqueConstraintEligibility } };
      const configured = await Effect.runPromise(makeDataBindingHost(bindingInput));
      const originalBinding = await Effect.runPromise(configured.withCurrent(readAdmittedDataBinding));
      const unconfigured = await Effect.runPromise(makeDataBindingHost(bindingBase));
      let bindingRemoved = false;
      let bindingRestored = false;
      const restoreBinding = async () => {
        const current = await Effect.runPromise(unconfigured.withCurrent(readAdmittedDataBinding));
        const original = await Effect.runPromise(configured.prepare(originalBinding.frame));
        await Effect.runPromise(configured.activate(dataBindingActivationRequest(current.frame.application.scopeId,
          current.frame.application.storageGeneration, "logical-snapshot-restore", original.sha256, current.head)));
        bindingRestored = true;
      };
      const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work, commandMs) =>
        runRelationalSession(fixture.session, profile, tx => Effect.gen(function* () {
          if (profile === "snapshotRead") {
            yield* runDrizzleStatementEffect(tx.select().from(fxSystemDataBindingHeads).limit(1), cause =>
              new RelationalSessionError({ reason: "resourceFailure", cause }));
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
          }
          return yield* work(tx);
        }), commandMs).pipe(Effect.catchTag("RelationalTransactionError", cause =>
          Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause })))));
      let nativeReads = 0;
      const read = defineCommerceCommand("snapshotLogicalBindingRead", "read", Effect.fn(function* (ctx) {
        nativeReads++;
        return yield* ctx.nested(currencyCommands.list,
          { filters: { code: "baseline" }, config: { select: ["code", "name"] } });
      }));
      const reader = await local([read, currencyCommands.list], session);
      const readScopeAuthority = async () => {
        const rows = await fixture.persistence.drizzle.select({
          lastCommitSeq: fxSystemScopeClocks.lastCommitSeq,
          authorizationRevocationEpoch: fxSystemScopeExecutionAuthorities.authorizationRevocationEpoch,
        }).from(fxSystemScopeClocks).innerJoin(fxSystemScopeExecutionAuthorities,
          eq(fxSystemScopeExecutionAuthorities.scopeId, fxSystemScopeClocks.scopeId))
          .where(eq(fxSystemScopeClocks.scopeId, fixture.application.authority.scopeId));
        const row = rows[0];
        if (rows.length !== 1 || row === undefined) throw new Error("Expected one paired Currency scope authority.");
        return row;
      };
      try {
        const before = await logicalCurrencyInventory(fixture);
        const beforeAuthority = await readScopeAuthority();
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const reading = yield* reader.read(read, null).pipe(Effect.result, Effect.forkScoped);
          yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"));
          if (transition === "binding") {
            const candidate = yield* unconfigured.prepare({ ...originalBinding.frame, logicalSchema: null });
            yield* unconfigured.activate(dataBindingActivationRequest(originalBinding.frame.application.scopeId,
              originalBinding.frame.application.storageGeneration, "logical-snapshot-unbind", candidate.sha256, originalBinding.head));
            bindingRemoved = true;
          } else {
            yield* runEffectTransaction(work => fixture.persistence.drizzle.transaction(work),
              "Advance logical Currency authorization epoch", (tx: FlarexMetadataTransaction) =>
                advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx,
                  fixture.application.authority.scopeId),
              cause => new Error("Advance logical Currency authorization epoch", { cause }));
          }
          yield* Deferred.succeed(release, undefined);
          expect(yield* Fiber.join(reading)).toMatchObject({ _tag: "Failure",
            failure: { reason: "invalidAuthority", cause: { cause: { cause: { code: "40001" } } } } });
          expect(nativeReads).toBe(0);
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("20 seconds"))));
        const after = await logicalCurrencyInventory(fixture);
        const afterAuthority = await readScopeAuthority();
        const { clocks: beforeClocks, ...beforeData } = before;
        const { clocks: afterClocks, ...afterData } = after;
        expect(afterData).toEqual(beforeData);
        expect(afterClocks.map(clock => clock.lastCommitSeq)).toEqual(beforeClocks.map(clock => clock.lastCommitSeq));
        expect(afterAuthority.lastCommitSeq).toBe(beforeAuthority.lastCommitSeq);
        expect(afterAuthority.authorizationRevocationEpoch).toBe(
          beforeAuthority.authorizationRevocationEpoch + (transition === "revocation" ? 1n : 0n));
        const fresh = await local([read, currencyCommands.list]);
        try {
          await expect(Effect.runPromise(fresh.read(read, null))).rejects.toMatchObject({
            reason: transition === "binding" ? "bindingChanged" : "invalidAuthority",
          });
          expect(nativeReads).toBe(0);
          if (transition === "binding") {
            await restoreBinding();
            expect(await Effect.runPromise(fresh.read(read, null))).toEqual([{ code: "baseline", name: baselineName }]);
            expect(nativeReads).toBe(1);
          }
        } finally { await Effect.runPromise(fresh.close); }
      } finally {
        await Effect.runPromise(Deferred.succeed(release, undefined));
        await Effect.runPromise(reader.close);
        if (bindingRemoved && !bindingRestored) await restoreBinding();
      }
    }, 90_000);
});
