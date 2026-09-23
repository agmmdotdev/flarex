import { it, expect } from "vitest";
import { Effect, Result } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { defineCommerceCommand, type CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { withCurrencyService, currencyCommands, makeCurrencyService } from "../../src/currency-service";
import { makeCommerceHost } from "../../../persistence-postgres/src/commerceTransaction/host";
import { issueRelationalSession, runRelationalSession } from "../../../persistence-postgres/src/relationalTransaction/session";
import { RelationalSessionError } from "../../../persistence-postgres/src/relationalTransaction/model";
import { runEffect, runEffectFailure } from "../../../persistence-postgres/test/effectTestRuntime";
import { createRetainedHistoryMaintenancePort, runRetainedHistoryMaintenanceEffect,
  type RetainedHistoryMaintenanceContinuation, type RetainedHistoryMaintenanceReceipt } from
  "../../../persistence-postgres/src/retainedHistoryMaintenance";
import { createLocatedRetainedHistoryFloorTargetInternal } from
  "../../../persistence-postgres/src/retainedHistoryFloorObservation";
import { createDefaultLocatedReadCommittedTransactionRunnerV1 } from
  "../../../persistence-postgres/src/transactionSessionActivation";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { registerLiveBoundaryChecks } from "./live-boundary-checks";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";

export function registerLiveCurrencyChecks(get: () => LogicalCurrencyFixture): void {
  it("publishes native Currency changes through generic rows, replays and rolls back caught failures", async () => {
    const fixture = get();
    const inventory = () => logicalCurrencyInventory(fixture);
    const initial = await inventory();
    expect(initial.rows).toHaveLength(123);
    expect(initial.rowChanges).toHaveLength(123);
    expect(initial.physicalFacts).toEqual([]);
    expect(initial.initialization).toMatchObject([{ sourceKey: "medusa.currency", rowCount: 123 }]);
    let calls = 0;
    let escaped: CommerceCommandContext | undefined;
    const mutate = defineCommerceCommand("currencyProof", "write", Effect.fn("CurrencyProof.mutate")(function* (ctx, args) {
      if (!isNonArrayRecord(args) || typeof args.code !== "string" || typeof args.name !== "string")
        return yield* ctx.refuse(commerceError("invalidInput"));
      const { code, name } = args;
      calls += 1;
      escaped = ctx;
      return yield* withCurrencyService(ctx, async ({ internal, service, context, repository }) => {
        const rows = [{ code, name, symbol: "T", symbol_native: "T", decimal_digits: 2, rounding: "0.125" }];
        if (args.nested === true || args.catchInner === true) {
          const result = repository.transaction(async manager => {
            const child = { manager, transactionManager: manager };
            await internal.upsert(rows, child);
            const found = await service.retrieveCurrency(code, {}, child);
            if (args.catchInner === true) throw new Error("Inner Currency failure");
            return found;
          }, { transaction: context.transactionManager });
          if (args.catchInner === true) { await result.catch(() => undefined); return null; }
          return result;
        }
        await internal.upsert(rows, context);
        if (args.failAfter === true) throw new Error("Currency rollback proof");
        return service.retrieveCurrency(code, {}, context);
      });
    }));
    const lifecycle = defineCommerceCommand("currencyLifecycleProof", "write", (ctx, args) => withCurrencyService(ctx, async ({ repository, context }) => {
      if (!isNonArrayRecord(args) || typeof args.code !== "string") return Effect.runPromise(ctx.refuse(commerceError("invalidInput")));
      if (args.operation === "softDelete") return repository.softDelete({ code: args.code }, context);
      if (args.operation === "restore") return repository.restore({ code: args.code }, context);
      if (args.operation === "delete") return repository.delete({ code: args.code }, context);
      return repository.upsert([], context);
    }));
    const events = defineCommerceCommand("currencyEventProof", "write", ctx =>
      ctx.rejectEvent.pipe(Effect.catchTag("CommerceTransactionError", () => Effect.succeed(null))));
    const host = await runEffect(makeCommerceHost({ ...fixture.hostInput,
      commands: [...Object.values(currencyCommands), mutate, lifecycle, events] }));
    try {
      const service = makeCurrencyService(host);
      const key = host.newRequestKey();
      const args = { code: "zzz", name: "Flarex test" };
      expect(await runEffect(host.run(key, mutate, args))).toMatchObject({ code: "zzz", name: args.name, rounding: 0.125 });
      const published = await inventory();
      expect(published.rows).toHaveLength(124);
      expect(published.rowChanges).toHaveLength(initial.rowChanges.length + 1);
      expect(published.physicalFacts).toEqual([]);
      expect(published.commits).toHaveLength(initial.commits.length + 1);
      expect(published.outcomes).toHaveLength(initial.outcomes.length + 1);
      expect(published.wakes).toHaveLength(initial.wakes.length + 1);
      expect(published.clocks[0]?.lastCommitSeq).toBe((initial.clocks[0]?.lastCommitSeq ?? 0n) + 1n);
      expect(await runEffect(host.run(key, mutate, args))).toMatchObject({ code: "zzz" });
      expect(calls).toBe(1);
      expect(await inventory()).toEqual(published);
      await runEffectFailure(host.run(key, mutate, { ...args, name: "different" }));
      await runEffectFailure(host.run(host.newRequestKey(), mutate, { ...args, name: "rolled back", failAfter: true }));
      await runEffectFailure(host.run(host.newRequestKey(), mutate, { ...args, name: "inner rollback", catchInner: true }));
      await runEffectFailure(host.run(host.newRequestKey(), events, null));
      expect(await inventory()).toEqual(published);
      if (escaped === undefined) throw new Error("Missing escaped context");
      expect(Result.isFailure(await runEffect(Effect.result(escaped.store.find(escaped.manager, {}))))).toBe(true);
      expect(await runEffect(host.run(host.newRequestKey(), mutate, { ...args, name: "nested", nested: true })))
        .toMatchObject({ name: "nested" });
      await runEffect(host.run(host.newRequestKey(), lifecycle, { code: "zzz", operation: "softDelete" }));
      await expect(service.retrieveCurrency("zzz")).rejects.toThrow("was not found");
      await runEffect(host.run(host.newRequestKey(), lifecycle, { code: "zzz", operation: "restore" }));
      expect(await service.retrieveCurrency("ZZZ")).toMatchObject({ name: "nested" });
      expect(await runEffect(host.initialize(fixture.initialization.rows))).toEqual({ rowCount: 123 });
      const beforeNoop = await inventory();
      await runEffect(host.run(host.newRequestKey(), lifecycle, { code: "zzz", operation: "noop" }));
      const afterNoop = await inventory();
      expect(afterNoop.rowChanges).toEqual(beforeNoop.rowChanges);
      expect(afterNoop.commits).toHaveLength(beforeNoop.commits.length + 1);
      await runEffect(host.run(host.newRequestKey(), lifecycle, { code: "zzz", operation: "delete" }));
      await expect(service.retrieveCurrency("zzz")).rejects.toThrow("was not found");
      const deleted = await inventory();
      expect(deleted.rows).toHaveLength(afterNoop.rows.length);
      expect(deleted.revisions.filter(row => row.isTombstone))
        .toHaveLength(afterNoop.revisions.filter(row => row.isTombstone).length + 1);
    } finally { await runEffect(host.close); }
  }, 120_000);

  registerLiveBoundaryChecks(get);

  it("rolls back every generic publication stage and recovers a lost COMMIT reply", async () => {
    const fixture = get();
    let calls = 0;
    const command = defineCommerceCommand("currencyPublicationProof", "write", ctx => withCurrencyService(ctx, async ({ internal, service, context }) => {
      calls += 1;
      await internal.upsert([{ code: "zzz", name: "Publication proof", symbol: "T", symbol_native: "T", decimal_digits: 2, rounding: 0 }], context);
      return service.retrieveCurrency("zzz", {}, context);
    }));
    const hostInput = { ...fixture.hostInput, commands: [...fixture.hostInput.commands, command] };
    const host = await runEffect(makeCommerceHost(hostInput));
    try {
      const before = await logicalCurrencyInventory(fixture);
      for (const [table, operation] of [
        ["fx_app_row_rev", "insert"], ["fx_system_commit", "insert"],
        ["fx_system_commit_app_row_change", "insert"], ["fx_system_idempotency", "insert"],
        ["fx_system_commit_wake", "insert"], ["fx_system_scope_clock", "update"],
      ] as const) {
        await fixture.persistence.exec("create function fx_test_currency_failure() returns trigger language plpgsql as $$ begin raise exception 'currency publication failure'; end $$");
        try {
          await fixture.persistence.exec(`create trigger fx_test_currency_failure before ${operation} on "${table}" for each row execute function fx_test_currency_failure()`);
          await runEffectFailure(host.run(host.newRequestKey(), command, null));
          expect(await logicalCurrencyInventory(fixture)).toEqual(before);
        } finally {
          await fixture.persistence.exec(`drop trigger if exists fx_test_currency_failure on "${table}"`);
          await fixture.persistence.exec("drop function fx_test_currency_failure()");
        }
      }
      let loseAcknowledgement = true;
      const session = issueRelationalSession(fixture.persistence.drizzle,
        (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
          Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
          Effect.flatMap(value => {
            if (!loseAcknowledgement) return Effect.succeed(value);
            loseAcknowledgement = false;
            return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost COMMIT acknowledgement") }));
          })));
      const recovering = await runEffect(makeCommerceHost({ ...hostInput, session }));
      try {
        const key = recovering.newRequestKey();
        const result = await runEffect(recovering.run(key, command, null));
        expect(result).toMatchObject({ code: "zzz" });
        expect(calls).toBe(7);
        const committed = await logicalCurrencyInventory(fixture);
        expect(committed.rows).toHaveLength(before.rows.length + 1);
        expect(committed.commits).toHaveLength(before.commits.length + 1);
        expect(committed.rowChanges).toHaveLength(before.rowChanges.length + 1);
        expect(committed.outcomes).toHaveLength(before.outcomes.length + 1);
        expect(committed.physicalFacts).toEqual([]);
        expect(await runEffect(recovering.run(key, command, null))).toEqual(result);
        expect(calls).toBe(7);
        expect(await logicalCurrencyInventory(fixture)).toEqual(committed);
        expect(await runEffect(host.initialize(fixture.initialization.rows))).toEqual({ rowCount: 123 });
        const last = committed.commits.at(-1);
        const clock = committed.clocks[0];
        if (last === undefined || clock === undefined) throw new Error("Missing logical Currency history");
        await fixture.persistence.query(
          "update fx_system_scope_clock set oldest_available_commit_seq = $1 where scope_uuid = $2",
          [last.commitSeq, clock.scopeUuid],
        );
        const db = fixture.persistence.drizzle;
        const maintenance = Result.getOrThrow(createRetainedHistoryMaintenancePort({
          authority: { ...fixture.hostInput.authority, scopeClockTargets: {
            resolve: async locator => createLocatedRetainedHistoryFloorTargetInternal(db, locator,
              createDefaultLocatedReadCommittedTransactionRunnerV1(db)),
          } },
          policy: { maximumPages: 512, maximumElapsedMilliseconds: 30_000 },
        }));
        let continuation: RetainedHistoryMaintenanceContinuation | null = null;
        let deletedCommits = 0;
        for (let attempt = 0; attempt < 10; attempt++) {
          const receipt: RetainedHistoryMaintenanceReceipt = await runEffect(runRetainedHistoryMaintenanceEffect(
            maintenance, fixture.deploymentId, continuation));
          deletedCommits += receipt.deletedCommitCount;
          continuation = receipt.continuation;
          if (receipt.status === "maintenanceComplete") break;
          if (continuation === null) throw new Error(`Retention paused: ${receipt.stopReason}`);
        }
        if (continuation !== null) throw new Error("Logical Currency retention did not complete");
        expect(deletedCommits).toBeGreaterThan(0);
        const compacted = await logicalCurrencyInventory(fixture);
        expect(compacted.commits.length).toBeLessThan(committed.commits.length);
        expect(compacted.rows).toEqual(committed.rows);
        expect(compacted.indexEntries).toEqual(committed.indexEntries);
        expect(compacted.uniqueKeys).toEqual(committed.uniqueKeys);
        expect(compacted.initialization).toEqual(committed.initialization);
        expect(await fixture.service.retrieveCurrency("zzz")).toMatchObject({ code: "zzz" });
        expect(await runEffect(host.initialize(fixture.initialization.rows))).toEqual({ rowCount: 123 });
        expect(await logicalCurrencyInventory(fixture)).toEqual(compacted);
      } finally { await runEffect(recovering.close); }
    } finally { await runEffect(host.close); }
  }, 120_000);
}
