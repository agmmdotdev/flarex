import { commerceStorageBoundaryScenario } from "../../../persistence-postgres/test/commerceStorageBoundaryScenario";
import { it, expect } from "vitest";
import { Effect, Exit, Result } from "effect";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceLimits } from "@flarex/persistence-postgres/internal/commerce-values";
import { withCurrencyService } from "../../src/currency-service";
import { captureCurrencyInput } from "../../src/currency-values";
import { makeCommerceHost } from "../../../persistence-postgres/src/commerceTransaction/host";
import { commerceInventory } from "../../../persistence-postgres/test/commerceInventory";
import { runEffect, runEffectFailure } from "../../../persistence-postgres/test/effectTestRuntime";
import type { LiveCurrencyFixture } from "./live-fixture";

function barrier() {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

export function registerLiveBoundaryChecks(get: () => LiveCurrencyFixture) {
  it("rejects oversized stored payloads before hydration", async () => {
    const fixture = get();
    const statements: string[] = [];
    try {
      fixture.observeSql?.(text => { statements.push(text); });
      await commerceStorageBoundaryScenario(fixture, { column: "name", keyColumn: "code", key: "usd" }, async () => {
        statements.length = 0;
        try { return await fixture.service.listCurrencies(); } finally {
          if (fixture.observeSql !== undefined) expect(statements.some(text => text.includes("max(octet_length(payload::text))"))).toBe(true);
          expect(statements.some(text => text.startsWith('select "') && text.includes(' as "name"'))).toBe(false);
        }
      });
    } finally { fixture.observeSql?.(undefined); }
  }, 30000);
  it.skipIf(process.env.MEDUSA_COMPARISON_DRIVER === "postgres")("joins interrupted PGlite publication before rollback and never dispatches a later atom", async () => {
    const fixture = get();
    if (fixture.observeSql === undefined) return; // Native session fencing has its own ordinary-role interruption proof below.
    const baseline = await commerceInventory(fixture);
    const reached = barrier();
    const released = barrier();
    const statements: string[] = [];
    fixture.observeSql(async text => {
      statements.push(text);
      if (text.startsWith('insert into "fx_system_commit_relational_change"')) { reached.resolve(); await released.promise; }
    });
    const command = defineCommerceCommand("publicationInterruptProof", "write", ctx => withCurrencyService(ctx, ({ repository, context }) =>
      repository.upsert([{ code: "zzz", name: "Interrupted", symbol: "T", symbol_native: "T", decimal_digits: 2, rounding: 0 }], context)));
    const host = await runEffect(makeCommerceHost({ ...fixture.hostInput, commands: [command] }));
    const controller = new AbortController();
    let settled = false;
    const pending = Effect.runPromiseExit(host.run(host.newRequestKey(), command, null), { signal: controller.signal }).then(exit => { settled = true; return exit; });
    try {
      await Promise.race([reached.promise, pending.then(exit => { if (Exit.isFailure(exit)) throw exit.cause; })]);
      controller.abort();
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(settled).toBe(false);
      expect(statements).not.toContain("rollback");
      released.resolve();
      expect(Exit.isFailure(await pending)).toBe(true);
      expect(statements).toContain("rollback");
      expect(statements.some(text => text.startsWith('insert into "fx_system_idempotency"'))).toBe(false);
      expect(statements.at(-1)).toBe("rollback");
    } finally { released.resolve(); await pending; fixture.observeSql(undefined); }
    expect(await commerceInventory(fixture)).toEqual(baseline);
  }, 30000);
  it("refuses caught foreign-input, byte-budget and read-only violations without publishing", async () => {
    const fixture = get();
    const baseline = await commerceInventory(fixture);
    const emptyRead = defineCommerceCommand("readModeProof", "read", ctx => ctx.store.write(ctx.manager, "upsert", []).pipe(Effect.as(null), Effect.catchTag("CommerceTransactionError", () => Effect.succeed(null))));
    const echo = defineCommerceCommand("echoProof", "write", (_ctx, args) => Effect.succeed(args));
    const nestedRead = defineCommerceCommand("nestedReadProof", "write", ctx => ctx.nested(emptyRead, null).pipe(Effect.catchTag("CommerceTransactionError", () => Effect.succeed(null))));
    const hugeNested = defineCommerceCommand("nestedBudgetProof", "write", ctx => ctx.nested(echo, "x".repeat(commerceLimits.commandBytes)).pipe(Effect.catchTag("CommerceTransactionError", () => Effect.succeed(null))));
    let getterCalls = 0;
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const hostile: unknown[] = [revoked.proxy, new Proxy({}, { ownKeys() { throw new Error("ownKeys refused"); } }),
      Object.defineProperty({}, "where", { enumerable: true, get() { getterCalls += 1; throw new Error("Getter must not run"); } }),
      new Proxy([], { get() { throw new Error("Array property reads forbidden"); }, getOwnPropertyDescriptor() { throw new Error("Descriptor refused"); } })];
    for (const input of hostile) expect(Result.isFailure(captureCurrencyInput(input))).toBe(true);
    expect(getterCalls).toBe(0);
    let selected: unknown;
    const caught = defineCommerceCommand("caughtBoundaryProof", "write", ctx => withCurrencyService(ctx, async ({ repository, context }) => {
      await repository.find(selected as Parameters<typeof repository.find>[0], context).catch(() => undefined);
      await repository.upsert([], context).catch(() => undefined);
      return null;
    }));
    const badSerialize = defineCommerceCommand("serializerProof", "write", ctx => withCurrencyService(ctx, async ({ repository, context }) => {
      await repository.upsert([{ code: "zzz", name: "must roll back", symbol: "T", symbol_native: "T", decimal_digits: 2, rounding: 0 }], context);
      await repository.serialize({ rounding: "invalid" }).catch(() => undefined);
      return null;
    }));
    const caughtUpdate = defineCommerceCommand("caughtUpdateProof", "write", ctx => withCurrencyService(ctx, async ({ repository, context }) => {
      const change = Object.defineProperty({ entity: {}, update: {} }, "entity", { enumerable: true, get() { getterCalls += 1; throw new Error("Getter must not run"); } });
      await repository.update([change], context).catch(() => undefined);
      await repository.upsert([], context).catch(() => undefined);
      return null;
    }));
    const caughtManager = defineCommerceCommand("caughtManagerProof", "write", ctx => withCurrencyService(ctx, async ({ repository, context }) => {
      const shared = Object.defineProperty({}, "manager", { enumerable: true, get() { getterCalls += 1; throw new Error("Getter must not run"); } });
      await repository.find({ where: {} }, shared).catch(() => undefined);
      await repository.upsert([], context).catch(() => undefined);
      return null;
    }));
    const caughtOptions = defineCommerceCommand("caughtOptionsProof", "write", ctx => withCurrencyService(ctx, async ({ repository, context }) => {
      await repository.upsert([{ code: "zzz", name: "must roll back", symbol: "T", symbol_native: "T", decimal_digits: 2, rounding: 0 }], context);
      const options = Object.defineProperty({}, "transaction", { enumerable: true, get() { getterCalls += 1; throw new Error("Getter must not run"); } });
      await repository.transaction(async () => null, options).catch(() => undefined);
      await repository.upsert([], context).catch(() => undefined);
      return null;
    }));
    const caughtDelete = defineCommerceCommand("caughtDeleteProof", "write", ctx => withCurrencyService(ctx, async ({ repository, context }) => {
      await repository.delete(revoked.proxy, context).catch(() => undefined);
      await repository.upsert([], context).catch(() => undefined);
      return null;
    }));
    const numericExpansion = defineCommerceCommand("numericExpansionProof", "write", ctx => ctx.store.write(ctx.manager, "upsert", [{ code: "zzz", name: "Expansion", symbol: "T", symbol_native: "T", decimal_digits: 2, rounding: "1e100000", raw_rounding: { value: "1e100000", precision: 20 } }]).pipe(Effect.as(null)));
    const textInput = defineCommerceCommand("textIdentityProof", "write", (ctx, args) => ctx.store.delete(ctx.manager, args).pipe(Effect.as(null), Effect.catchTag("CommerceTransactionError", () => Effect.succeed(null))));
    const host = await runEffect(makeCommerceHost({ ...fixture.hostInput, commands: [emptyRead, nestedRead, echo, hugeNested, caught, badSerialize, textInput, caughtUpdate, caughtManager, numericExpansion, caughtOptions, caughtDelete] }));
    await runEffectFailure(host.run(host.newRequestKey(), emptyRead, null));
    await runEffectFailure(host.read(emptyRead, null));
    await runEffectFailure(host.run(host.newRequestKey(), nestedRead, null));
    await runEffectFailure(host.run(host.newRequestKey(), hugeNested, null));
    for (const input of [...hostile, { where: { code: ["\ud800"] } }, { where: { code: Array.from({ length: 257 }, () => "usd") } }]) {
      selected = input;
      await runEffectFailure(host.run(host.newRequestKey(), caught, null));
    }
    expect(await runEffectFailure(host.run(host.newRequestKey(), numericExpansion, null))).toMatchObject({ reason: "limitExceeded" });
    await runEffectFailure(host.run(host.newRequestKey(), badSerialize, null));
    await runEffectFailure(host.run(host.newRequestKey(), caughtUpdate, null));
    await runEffectFailure(host.run(host.newRequestKey(), caughtManager, null));
    await runEffectFailure(host.run(host.newRequestKey(), caughtOptions, null));
    await runEffectFailure(host.run(host.newRequestKey(), caughtDelete, null));
    await runEffectFailure(host.run(host.newRequestKey(), textInput, ["\ud800"]));
    await runEffectFailure(host.run(host.newRequestKey(), textInput, ["\u0000"]));
    expect(await commerceInventory(fixture)).toEqual(baseline);
    expect(getterCalls).toBe(0);

    const unicode = defineCommerceCommand("validUnicodeProof", "write", ctx => withCurrencyService(ctx, async ({ repository, context }) => {
      const values = ["\ufffd", "😀"];
      await repository.upsert(values.map(code => ({ code, name: code, symbol: code, symbol_native: code, decimal_digits: 2, rounding: 0 })), context);
      const found = await repository.find({ where: { code: values } }, context);
      expect(found.map(row => row.code).sort()).toEqual(values.sort());
      await repository.delete({ code: values }, context);
      return null;
    }));
    const unicodeHost = await runEffect(makeCommerceHost({ ...fixture.hostInput, commands: [unicode] }));
    await runEffect(unicodeHost.run(unicodeHost.newRequestKey(), unicode, null));
    expect((await commerceInventory(fixture)).rows).toEqual(baseline.rows);
  }, 120000);

  it("joins cancelled DAL work and refuses a late nested framework continuation", async () => {
    const fixture = get();
    const baseline = await commerceInventory(fixture);
    const held = barrier();
    const entered = barrier();
    const finished = barrier();
    let lateFailure: unknown;
    const command = defineCommerceCommand("cancelNestedProof", "write", ctx => withCurrencyService(ctx, ({ repository, context }) =>
      repository.transaction(async manager => {
        const child = { manager, transactionManager: manager };
        await repository.upsert([{ code: "zzz", name: "Interrupted", symbol: "T", symbol_native: "T", decimal_digits: 2, rounding: 0 }], child);
        entered.resolve();
        await held.promise;
        await repository.upsert([], child).catch(cause => { lateFailure = cause; });
        finished.resolve();
        return null;
      }, { transaction: context.transactionManager })));
    const host = await runEffect(makeCommerceHost({ ...fixture.hostInput, commands: [command] }));
    const controller = new AbortController();
    const pending = Effect.runPromiseExit(host.run(host.newRequestKey(), command, null), { signal: controller.signal });
    try {
      await Promise.race([entered.promise, pending.then(exit => { if (Exit.isFailure(exit)) throw exit.cause; })]);
      controller.abort();
      // Hold the uncooperative callback through bounded cleanup. SQL ownership
      // must already be closed when it resumes after the transaction has ended.
      expect(Exit.isFailure(await pending)).toBe(true);
      expect(await commerceInventory(fixture)).toEqual(baseline);
    } finally {
      held.resolve();
      await pending;
    }
    await finished.promise;
    expect(lateFailure).toBeDefined();
    expect(await commerceInventory(fixture)).toEqual(baseline);
  }, 30000);
}
