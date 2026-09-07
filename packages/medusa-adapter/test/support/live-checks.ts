import { registerLiveBoundaryChecks } from "./live-boundary-checks";
import { it, expect } from "vitest";
import { Effect, Result } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { defineCommerceCommand, type CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { withCurrencyService, currencyCommands, makeCurrencyService } from "../../src/currency-service";
import { makeCommerceHost } from "../../../persistence-postgres/src/commerceTransaction/host";
import { commerceInventory } from "../../../persistence-postgres/test/commerceInventory";
import { commercePublicationScenario } from "../../../persistence-postgres/test/commercePublicationScenario";
import { runEffect, runEffectFailure } from "../../../persistence-postgres/test/effectTestRuntime";
import type { LiveCurrencyFixture } from "./live-fixture";

export function registerLiveCurrencyChecks(get: () => LiveCurrencyFixture): void {
  it("publishes one atomic Currency transaction, replays it, and rolls back caught nested failures", async () => {
    const fixture = get();
    const inventory = () => commerceInventory(fixture);
    const initial = await inventory();
    expect(initial.rows).toHaveLength(123);
    expect(initial.facts).toHaveLength(123);
    expect(initial.initialization).toHaveLength(1);
    expect(initial.commits[0]?.relationalChangeCount).toBe(123);
    for (const [ordinal, fact] of initial.facts.entries()) {
      expect(fact.changeOrdinal).toBe(ordinal);
      expect(fact.operation).toBe("insert");
      expect(fact.installationSha256).toBe(fixture.installation.installation.installationSha256);
      const key = JSON.parse(new TextDecoder().decode(fact.keyBytes));
      expect(key).toMatchObject({ format: "flarex.relational-primary-key", version: 1, keyId: "currency.primary", components: [{ columnId: "code", type: "text" }] });
    }
    let calls = 0;
    let escaped: CommerceCommandContext | undefined;
    const mutate = defineCommerceCommand("currencyProof", "write", Effect.fn("CurrencyProof.mutate")(function* (ctx, args) {
      if (!isNonArrayRecord(args) || typeof args.code !== "string" || typeof args.name !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
      const code = args.code;
      const name = args.name;
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
    const events = defineCommerceCommand("currencyEventProof", "write", ctx => ctx.rejectEvent.pipe(Effect.catchTag("CommerceTransactionError", () => Effect.succeed(null))));
    const host = await runEffect(makeCommerceHost({ ...fixture.hostInput, commands: [...Object.values(currencyCommands), mutate, lifecycle, events] }));
    const service = makeCurrencyService(host);
    const key = host.newRequestKey();
    const args = { code: "zzz", name: "Flarex test" };
    expect(await runEffect(host.run(key, mutate, args))).toMatchObject({ code: "zzz", name: args.name, rounding: 0.125 });
    const published = await inventory();
    expect(published.rows).toHaveLength(124);
    expect(published.commits).toHaveLength(initial.commits.length + 1);
    expect(published.outcomes).toHaveLength(initial.outcomes.length + 1);
    expect(published.wakes).toHaveLength(initial.wakes.length + 1);
    expect(published.facts).toHaveLength(124);
    expect(published.clocks[0]?.lastCommitSeq).toBe((initial.clocks[0]?.lastCommitSeq ?? 0n) + 1n);
    const fact = published.facts.at(-1);
    expect(fact).toMatchObject({ operation: "insert", changeOrdinal: 0 });
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
    expect(await runEffect(host.run(host.newRequestKey(), mutate, { ...args, name: "nested", nested: true }))).toMatchObject({ name: "nested" });
    await runEffect(host.run(host.newRequestKey(), lifecycle, { code: "zzz", operation: "softDelete" }));
    await expect(service.retrieveCurrency("zzz")).rejects.toThrow("was not found");
    await runEffect(host.run(host.newRequestKey(), lifecycle, { code: "zzz", operation: "restore" }));
    expect(await service.retrieveCurrency("ZZZ")).toMatchObject({ name: "nested" });
    const initialization = fixture.prepared.initialization.rows;
    if (initialization === undefined) throw new Error("Missing initialization");
    expect(await runEffect(host.initialize(initialization))).toEqual({ rowCount: 123 });
    expect(await service.retrieveCurrency("zzz")).toMatchObject({ name: "nested" });
    const beforeNoop = await inventory();
    await runEffect(host.run(host.newRequestKey(), lifecycle, { code: "zzz", operation: "noop" }));
    const afterNoop = await inventory();
    expect(afterNoop.facts).toEqual(beforeNoop.facts);
    expect(afterNoop.commits).toHaveLength(beforeNoop.commits.length + 1);
    expect(afterNoop.commits.at(-1)?.relationalChangeCount).toBe(0);
    await runEffect(host.run(host.newRequestKey(), lifecycle, { code: "zzz", operation: "delete" }));
    expect((await inventory()).rows.filter(row => row.code === "zzz")).toEqual([]);
  }, 120000);
  registerLiveBoundaryChecks(get);
  it("keeps all publication stages atomic, recovers a lost COMMIT reply, and retains initialization across compaction", async () => {
    let calls = 0;
    const command = defineCommerceCommand("currencyPublicationProof", "write", ctx => withCurrencyService(ctx, async ({ internal, service, context }) => {
      calls += 1;
      await internal.upsert([{ code: "zzz", name: "Publication proof", symbol: "T", symbol_native: "T", decimal_digits: 2, rounding: 0 }], context);
      return service.retrieveCurrency("zzz", {}, context);
    }));
    const fixture = get();
    await commercePublicationScenario(fixture, command, null);
    expect(calls).toBe("pool" in fixture.persistence ? 7 : 6);
  }, 120000);
}
