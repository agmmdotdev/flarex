import { Cause, Effect, Exit, Result, Tracer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { isPreparedApplicationBinding, prepareApplicationBindingSelection, withPreparedApplicationBindingBasisInTransaction } from
  "../../persistence-postgres/src/application/applicationActivation";
import { readCheckedApplicationActiveHead, type CheckedApplicationActiveHead } from
  "../../persistence-postgres/src/application/applicationActiveHeadRead";
import { fxSystemApplicationActivations } from "../../persistence-postgres/src/application/applicationActivationSchema";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../../persistence-postgres/src/scope/scopeClock";
import { defineCommerceCommand, makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { commerceError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { runDrizzleStatementEffect } from "../../persistence-postgres/src/database/drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../../persistence-postgres/src/database/metadataTransaction";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { currencyCommands } from "../src/currency-service";
import { assertProtectedGuardFailure } from "./support/protected-acceptance-observation";

describe.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
  "fresh protected Application acceptance", () => {
    const cleanup: Array<() => Promise<void>> = [];
    let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
    const spanNames: string[] = [];
    const guardsObserved: Tracer.NativeSpan[] = [];
    const tracer = Tracer.make({ span(options) {
      spanNames.push(options.name);
      const span = new Tracer.NativeSpan(options);
      if (options.name === "PreparedMetadataEpoch.guard") guardsObserved.push(span);
      return span;
    } });
    const traced = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.withTracer(tracer)));
    const prepare = async () => {
      const prepared = await Effect.runPromise(prepareApplicationBindingSelection(fixture.application.activation));
      if (!isPreparedApplicationBinding(prepared)) throw new Error("Expected original legacy request preparation");
      return prepared;
    };
    const invalidate = "update fx_system_application_function_v1 set function_path = function_path where false";
    beforeAll(async () => {
      fixture = await logicalCurrencyFixture("postgres", close => cleanup.push(close), { protectedRuntime: true });
    }, 180_000);
    afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

    it("refuses a changed initial epoch before the callback", async () => {
      const prepared = await prepare();
      await fixture.persistence.drizzle.execute(invalidate);
      let calls = 0;
      const before = await logicalCurrencyInventory(fixture);
      const result = await fixture.persistence.drizzle.transaction(tx => traced(Effect.gen(function* () {
        const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, fixture.application.authority.scopeId);
        return yield* Effect.exit(withPreparedApplicationBindingBasisInTransaction(prepared, tx, clock,
          () => Effect.sync(() => { calls++; return "must not escape"; })));
      })));
      expect(Exit.isFailure(result)).toBe(true);
      expect(calls).toBe(0);
      expect(await logicalCurrencyInventory(fixture)).toEqual(before);
    });

    it.each(["login", "trigger"] as const)("refuses changed %s attestation before the callback", async kind => {
      const prepared = await prepare();
      const identity = (await fixture.persistence.query<{ database: string; schema: string; login: string }>(
        "select current_database() as database, current_schema() as schema, session_user as login")).rows[0];
      if (identity === undefined) throw new Error("Missing protected fixture identity");
      const adminUrl = new URL(process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL!);
      adminUrl.pathname = `/${identity.database}`;
      const admin = new Pool({ connectionString: adminUrl.toString() });
      const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
      const alter = kind === "login"
        ? `alter role ${identifier(identity.login)} bypassrls`
        : `alter table ${identifier(identity.schema)}.fx_system_application_function_v1 disable trigger fx_prepared_metadata_invalidate`;
      const restore = kind === "login"
        ? `alter role ${identifier(identity.login)} nobypassrls`
        : `alter table ${identifier(identity.schema)}.fx_system_application_function_v1 enable trigger fx_prepared_metadata_invalidate`;
      let altered = false;
      let calls = 0;
      try {
        await admin.query(alter);
        altered = true;
        const result = await traced(Effect.exit(runRelationalSession(fixture.session, "snapshotRead", tx =>
          Effect.gen(function* () {
            const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, fixture.application.authority.scopeId);
            return yield* withPreparedApplicationBindingBasisInTransaction(prepared, tx, clock,
              () => Effect.sync(() => { calls++; return null; }));
          }))));
        expect(Exit.isFailure(result)).toBe(true);
        expect(calls).toBe(0);
      } finally {
        try { if (altered) await admin.query(restore); }
        finally { await admin.end(); }
      }
    });

    it("still authenticates an activation row corrupted before the request captured its fresh epoch", async () => {
      const activations = await fixture.persistence.drizzle.select().from(fxSystemApplicationActivations);
      expect(activations).toHaveLength(1);
      const activation = activations[0];
      if (activation === undefined) throw new Error("Missing activation row");
      const corrupt = Uint8Array.from(activation.activationBytes);
      corrupt[0] = 32;
      await fixture.persistence.drizzle.update(fxSystemApplicationActivations).set({ activationBytes: corrupt });
      let calls = 0;
      try {
        // The intact trigger advances E. Preparation captures that new E and
        // valid head/readiness; E cannot authenticate the uncaptured bad row.
        const prepared = await prepare();
        const result = await traced(Effect.exit(runRelationalSession(fixture.session, "snapshotRead", tx =>
          Effect.gen(function* () {
            const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, fixture.application.authority.scopeId);
            return yield* withPreparedApplicationBindingBasisInTransaction(prepared, tx, clock,
              () => Effect.sync(() => { calls++; return null; }));
          }))));
        expect(Exit.isFailure(result)).toBe(true);
        expect(calls).toBe(0);
      } finally {
        await fixture.persistence.drizzle.update(fxSystemApplicationActivations)
          .set({ activationBytes: activation.activationBytes });
      }
    });

    it.each(["success", "failure", "defect", "interruption"] as const)(
      "releases the exact checked observation after %s", async ending => {
        const prepared = await prepare();
        const failure = new Error("body first failure");
        await fixture.persistence.drizzle.transaction(tx => traced(Effect.gen(function* () {
          const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, fixture.application.authority.scopeId);
          let checked: CheckedApplicationActiveHead | undefined;
          const before = spanNames.filter(name => name === "PreparedMetadataEpoch.guard").length;
          const result = yield* Effect.exit(withPreparedApplicationBindingBasisInTransaction(prepared, tx, clock,
            (_accepted, issued) => Effect.gen(function* () {
              checked = issued;
              if (checked === undefined) throw new Error("Missing checked Application head");
              expect(Result.isSuccess(readCheckedApplicationActiveHead(checked, tx, clock))).toBe(true);
              // SAFETY: deliberately forged transaction identity must refuse.
              expect(Result.isFailure(readCheckedApplicationActiveHead(checked, { ...tx } as typeof tx, clock))).toBe(true);
              if (ending === "failure") return yield* Effect.fail(failure);
              if (ending === "defect") return yield* Effect.die(failure);
              if (ending === "interruption") return yield* Effect.interrupt;
              return "tentative local value";
            })));
          expect(result._tag).toBe(ending === "success" ? "Success" : "Failure");
          expect(spanNames.filter(name => name === "PreparedMetadataEpoch.guard").length - before)
            .toBe(ending === "success" ? 1 : 0);
          if (checked === undefined) throw new Error("Missing escaped checked observation");
          expect(Result.isFailure(readCheckedApplicationActiveHead(checked, tx, clock))).toBe(true);
          if (ending === "failure" && Exit.isFailure(result))
            expect(result.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === failure)).toBe(true);
          if (ending === "defect" && Exit.isFailure(result))
            expect(result.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === failure)).toBe(true);
        })));
      });

    it.each(["committed", "inFlight"] as const)(
      "refuses %s metadata after valid snapshot admission without returning its local value", async mode => {
      const prepared = await prepare();
      let calls = 0;
      let checkReleased: (() => boolean) | undefined;
      const before = await logicalCurrencyInventory(fixture);
      const guards = spanNames.filter(name => name === "PreparedMetadataEpoch.guard").length;
      let writer: PoolClient | undefined;
      try {
      const result = await traced(Effect.exit(runRelationalSession(fixture.session, "snapshotRead", tx =>
        Effect.gen(function* () {
          const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, fixture.application.authority.scopeId);
          return yield* withPreparedApplicationBindingBasisInTransaction(prepared, tx, clock,
            (_accepted, checked) => Effect.gen(function* () {
              if (checked === undefined) throw new Error("Missing checked Application head");
              checkReleased = () => Result.isFailure(readCheckedApplicationActiveHead(checked, tx, clock));
              calls++;
              // This independent writer touches no head or clock; it commits
              // after initial admission and before the reader's final guard.
              if (mode === "committed") yield* Effect.promise(async () => { await fixture.persistence.drizzle.execute(invalidate); });
              else yield* Effect.promise(async () => {
                if (fixture.resource.kind !== "postgres") throw new Error("Expected PostgreSQL writer");
                writer = await fixture.resource.target.pool.connect();
                await writer.query("begin");
                await writer.query("update fx_system_application_function_v1 set function_path = function_path where false");
              });
              return "must remain tentative";
            }));
        }))));
      expect(Exit.isFailure(result)).toBe(true);
      expect(calls).toBe(1);
      expect(spanNames.filter(name => name === "PreparedMetadataEpoch.guard").length - guards).toBe(1);
      assertProtectedGuardFailure(guardsObserved.at(-1), mode === "inFlight" ? ["busy"] : ["changed", "serialization"]);
      expect(checkReleased?.()).toBe(true);
      expect(await logicalCurrencyInventory(fixture)).toEqual(before);
      } finally {
        if (writer !== undefined) {
          try { await writer.query("rollback"); }
          finally { writer.release(); }
        }
      }
      // The next request captures the committed epoch and can enter normally.
      await traced(fixture.host.read(currencyCommands.list,
        { filters: {}, config: { select: ["code", "name"] } }));
    });

    it("rejects a command's own covered write at the original epoch and rolls back publication", async () => {
      let activeTx: FlarexMetadataTransaction | undefined;
      const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work, commandMs) =>
        runRelationalSession(fixture.session, profile, tx => {
          activeTx = tx;
          return work(tx).pipe(Effect.ensuring(Effect.sync(() => { activeTx = undefined; })));
        }, commandMs).pipe(Effect.catchTag("RelationalTransactionError", cause =>
          Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause })))));
      let calls = 0;
      const command = defineCommerceCommand("coveredApplicationWrite", "write", Effect.fn(function* (ctx) {
        calls++;
        if (activeTx === undefined) return yield* ctx.refuse(commerceError("invalidAuthority"));
        yield* runDrizzleStatementEffect(activeTx.execute(invalidate), cause => commerceError("statementFailure", cause));
        return "tentative metadata writer";
      }));
      const host = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, session, commands: [command] }));
      try {
        const before = await logicalCurrencyInventory(fixture);
        const guards = spanNames.filter(name => name === "PreparedMetadataEpoch.guard").length;
        const result = await traced(Effect.exit(host.run(host.newRequestKey(), command, null)));
        expect(Exit.isFailure(result)).toBe(true);
        expect(calls).toBe(1);
        expect(spanNames.filter(name => name === "PreparedMetadataEpoch.guard").length - guards).toBe(1);
        assertProtectedGuardFailure(guardsObserved.at(-1), ["changed"]);
        expect(await logicalCurrencyInventory(fixture)).toEqual(before);
        expect(activeTx).toBeUndefined();
      } finally { await Effect.runPromise(host.close); }
    });

    it("passes the final guard on initialization, read, command and committed replay", async () => {
      let calls = 0;
      const command = defineCommerceCommand("protectedNoOp", "write", () => Effect.sync(() => { calls++; return null; }));
      const host = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, commands: [command, currencyCommands.list] }));
      try {
        const key = host.newRequestKey();
        for (const work of [host.initialize(fixture.initialization.rows),
          host.read(currencyCommands.list, { filters: {}, config: { select: ["code", "name"] } }),
          host.run(key, command, null), host.run(key, command, null)]) {
          const guards = spanNames.filter(name => name === "PreparedMetadataEpoch.guard").length;
          await traced(work);
          expect(spanNames.filter(name => name === "PreparedMetadataEpoch.guard").length - guards).toBe(1);
        }
        expect(calls).toBe(1);
      } finally { await Effect.runPromise(host.close); }
    });
  });
