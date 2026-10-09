import { it, expect } from "vitest";
import { Effect, Exit, Result } from "effect";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceLimits } from "@flarex/persistence-postgres/internal/commerce-values";
import { withCurrencyService } from "../../src/currency-service";
import { captureCurrencyInput } from "../../src/currency-values";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { runEffect } from "../../../persistence-postgres/test/support/effectTestRuntime";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";

function barrier() {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function waitWithin<Value>(promise: Promise<Value>, label: string): Promise<Value> {
  return runEffect(Effect.tryPromise({ try: () => promise, catch: cause => cause }).pipe(
    Effect.timeoutOrElse({ duration: 5_000,
      orElse: () => Effect.fail(new Error(`${label} did not settle`)) }),
  ));
}

async function expectRefusal<Value, Failure>(label: string, effect: Effect.Effect<Value, Failure>): Promise<Failure> {
  const outcome = await runEffect(Effect.result(effect));
  if (Result.isSuccess(outcome)) throw new Error(`${label} unexpectedly succeeded`);
  return outcome.failure;
}

export function registerLiveBoundaryChecks(get: () => LogicalCurrencyFixture) {
  it("rejects oversized stored payloads before hydration", async () => {
    const fixture = get();
    const before = await logicalCurrencyInventory(fixture);
    const current = before.rows[0];
    const revision = current === undefined ? undefined : before.revisions.find(row =>
      row.scopeUuid === current.scopeUuid && row.tableId === current.tableId &&
      row.commitSeq === current.commitSeq && Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
    if (revision === undefined || revision.valueBytes === null) throw new Error("Missing live Currency revision");
    const statements: string[] = [];
    const replaceBytes = (bytes: Uint8Array) => fixture.persistence.query(
      "update fx_app_row_rev set value_bytes = $1 where scope_uuid = $2 and table_id = $3 and row_id = $4 and commit_seq = $5",
      [Buffer.from(bytes), revision.scopeUuid, revision.tableId, Buffer.from(revision.rowId), revision.commitSeq]);
    try {
      fixture.observeSql?.(text => { statements.push(text); });
      await replaceBytes(Buffer.alloc(1_000_000, 120));
      statements.length = 0;
      await expect(fixture.service.listCurrencies()).rejects.toMatchObject({ reason: "limitExceeded" });
      if (fixture.observeSql !== undefined) expect(statements.some(text => text.includes("octet_length"))).toBe(true);
    } finally {
      await replaceBytes(revision.valueBytes);
      fixture.observeSql?.(undefined);
    }
    expect(await logicalCurrencyInventory(fixture)).toEqual(before);
  }, 30000);
  it.skipIf(process.env.MEDUSA_COMPARISON_DRIVER === "postgres")("joins interrupted PGlite publication before rollback and never dispatches a later atom", async () => {
    const fixture = get();
    if (fixture.observeSql === undefined) return; // Native session fencing has its own ordinary-role interruption proof below.
    const baseline = await logicalCurrencyInventory(fixture);
    const reached = barrier();
    const released = barrier();
    const statements: string[] = [];
    fixture.observeSql(async text => {
      statements.push(text);
      if (text.startsWith('insert into "fx_system_commit_app_row_change"')) { reached.resolve(); await released.promise; }
    });
    const command = defineCommerceCommand("publicationInterruptProof", "write", ctx => withCurrencyService(ctx, ({ repository, context }) =>
      repository.upsert([{ code: "zzz", name: "Interrupted", symbol: "T", symbol_native: "T", decimal_digits: 2, rounding: 0 }], context)));
    const host = await runEffect(makeCommerceHost({ ...fixture.hostInput, commands: [command] }));
    const controller = new AbortController();
    let settled = false;
    const pending = Effect.runPromiseExit(host.run(host.newRequestKey(), command, null), { signal: controller.signal }).then(exit => { settled = true; return exit; });
    try {
      await waitWithin(Promise.race([reached.promise, pending.then(exit => { if (Exit.isFailure(exit)) throw exit.cause; })]), "Interrupted publication entry");
      controller.abort();
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(settled).toBe(false);
      expect(statements).not.toContain("rollback");
      released.resolve();
      expect(Exit.isFailure(await waitWithin(pending, "Interrupted publication rollback"))).toBe(true);
      expect(statements).toContain("rollback");
      expect(statements.some(text => text.startsWith('insert into "fx_system_idempotency"'))).toBe(false);
      expect(statements.at(-1)).toBe("rollback");
    } finally {
      released.resolve();
      try { await waitWithin(pending, "Interrupted publication"); }
      finally { fixture.observeSql(undefined); await runEffect(host.close); }
    }
    expect(await logicalCurrencyInventory(fixture)).toEqual(baseline);
  }, 30000);
  it("refuses caught foreign-input, byte-budget and read-only violations without publishing", async () => {
    const fixture = get();
    const baseline = await logicalCurrencyInventory(fixture);
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
    // Medusa owns the numeric-to-DTO range. The generic store retains exact
    // decimal text, so exercise the native write boundary rather than raw DML.
    const numericExpansion = defineCommerceCommand("numericExpansionProof", "write", ctx => withCurrencyService(ctx,
      ({ repository, context }) => repository.upsert([{ code: "zzz", name: "Expansion", symbol: "T", symbol_native: "T", decimal_digits: 2, rounding: "1e100000" }], context)));
    const textInput = defineCommerceCommand("textIdentityProof", "write", (ctx, args) => ctx.store.delete(ctx.manager, args).pipe(Effect.as(null), Effect.catchTag("CommerceTransactionError", () => Effect.succeed(null))));
    const host = await runEffect(makeCommerceHost({ ...fixture.hostInput, commands: [emptyRead, nestedRead, echo, hugeNested, caught, badSerialize, textInput, caughtUpdate, caughtManager, numericExpansion, caughtOptions, caughtDelete] }));
    try {
    await expectRefusal("read command through write host", host.run(host.newRequestKey(), emptyRead, null));
    await expectRefusal("read-only write", host.read(emptyRead, null));
    await expectRefusal("nested read-only write", host.run(host.newRequestKey(), nestedRead, null));
    await expectRefusal("nested byte budget", host.run(host.newRequestKey(), hugeNested, null));
    for (const input of [...hostile, { where: { code: ["\ud800"] } }, { where: { code: Array.from({ length: 257 }, () => "usd") } }]) {
      selected = input;
      await expectRefusal("caught hostile selector", host.run(host.newRequestKey(), caught, null));
    }
    expect(await expectRefusal("numeric expansion", host.run(host.newRequestKey(), numericExpansion, null))).toMatchObject({ reason: "invalidInput" });
    await expectRefusal("caught serializer", host.run(host.newRequestKey(), badSerialize, null));
    await expectRefusal("caught update", host.run(host.newRequestKey(), caughtUpdate, null));
    await expectRefusal("caught manager", host.run(host.newRequestKey(), caughtManager, null));
    await expectRefusal("caught options", host.run(host.newRequestKey(), caughtOptions, null));
    await expectRefusal("caught delete", host.run(host.newRequestKey(), caughtDelete, null));
    await expectRefusal("invalid surrogate", host.run(host.newRequestKey(), textInput, ["\ud800"]));
    await expectRefusal("invalid NUL", host.run(host.newRequestKey(), textInput, ["\u0000"]));
    expect(await logicalCurrencyInventory(fixture)).toEqual(baseline);
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
    try {
      await runEffect(unicodeHost.run(unicodeHost.newRequestKey(), unicode, null));
      expect((await logicalCurrencyInventory(fixture)).rows).toEqual(baseline.rows);
    } finally { await runEffect(unicodeHost.close); }
    } finally { await runEffect(host.close); }
  }, 120000);

  it("joins cancelled DAL work and refuses a late nested framework continuation", async () => {
    const fixture = get();
    const baseline = await logicalCurrencyInventory(fixture);
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
    try {
      const controller = new AbortController();
      const pending = Effect.runPromiseExit(host.run(host.newRequestKey(), command, null), { signal: controller.signal });
      try {
        await waitWithin(Promise.race([entered.promise, pending.then(exit => { if (Exit.isFailure(exit)) throw exit.cause; })]), "Currency callback entry");
        controller.abort();
        // Hold the uncooperative callback through bounded cleanup. SQL ownership
        // must already be closed when it resumes after the transaction has ended.
        expect(Exit.isFailure(await waitWithin(pending, "Cancelled Currency request"))).toBe(true);
        expect(await logicalCurrencyInventory(fixture)).toEqual(baseline);
      } finally {
        controller.abort();
        held.resolve();
        await waitWithin(pending, "Cancelled Currency cleanup");
      }
      await waitWithin(finished.promise, "Late Currency continuation");
      expect(lateFailure).toBeDefined();
      expect(await logicalCurrencyInventory(fixture)).toEqual(baseline);
    } finally {
      held.resolve();
      await runEffect(host.close);
    }
  }, 30000);
}
