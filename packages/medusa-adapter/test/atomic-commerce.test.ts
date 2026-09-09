import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import type { Json } from "flarex-protocol/json";
import { isJsonObject } from "flarex-protocol/json";
import { decodeCategoryProjection } from "../src/product-category-projection";
import { makeCategoryCurrencyAtomicCommand } from "../src/category-currency-atomic-command";
import { prepareCurrencyProfile } from "../src/currency-contract";
import { prepareLocalProductProfile } from "../src/product-profile";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productLocalEventPolicy } from "../src/product-local-events";
import { makeAtomicCommerceHost, type AtomicCommerceHostInput } from "../../persistence-postgres/src/atomicCommerce/host";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../persistence-postgres/test/commerceHostFixture";
import { commerceInventory, expireCommerceResult } from "../../persistence-postgres/test/commerceInventory";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../persistence-postgres/test/postgresHelpers";
import { issueRelationalSession, makePostgresRelationalSession, runRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/relationalTransaction/model";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant, getAtomicCommerceCommand, type AtomicCommerceHost, type AtomicCommerceContext } from "../../persistence-postgres/src/atomicCommerce/commands";
import { defineCommerceCommand, type CommerceCommandContext } from "../../persistence-postgres/src/commerceTransaction/commands";
import { commerceError, type CommerceTransactionError } from "../../persistence-postgres/src/commerceTransaction/model";
import { readRelationalCommitFactsInTransaction } from "../../persistence-postgres/src/commitPublication/relationalFacts";
import { assertAtomicProjectionRejectsOtherParticipantCorruption } from "../../persistence-postgres/test/atomicCommerceFactsScenario";
import { assertNativeCommandPublication } from "../../persistence-postgres/test/nativeCommandPublicationScenario";
import { postgresFailureCode } from "../../persistence-postgres/test/postgresFailureCode";
import { commerceBindings } from "../../persistence-postgres/src/frameworkSchema/binding/model";
import { dataBindingActivationRequest, makeDataBindingHost } from "../../persistence-postgres/src/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../persistence-postgres/src/frameworkSchema/binding/selection";
import { captureBindingValue, isDataBindingSetFrame } from "../../persistence-postgres/src/frameworkSchema/binding/canonical";

const cleanup: Array<() => Promise<void>> = [];
const driver = process.env.MEDUSA_COMPARISON_DRIVER ?? process.env.FLAREX_TEST_DRIVER ?? "pglite";
let proof: Effect.Success<ReturnType<typeof makeCategoryCurrencyAtomicCommand>>;
let currency: CommerceHostTestFixture;
let product: CommerceHostTestFixture;
let input: AtomicCommerceHostInput<unknown>;
let host: AtomicCommerceHost;
const args = (prefix: string) => ({ categoryPrefix: prefix,
  currency: { code: "zzz", name: prefix, symbol: "T", symbol_native: "T", decimal_digits: 2, rounding: 0 } });
const inventory = async () => ({ currency: await commerceInventory(currency), product: await commerceInventory(product) });
function required<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error("Missing test definition");
  return value;
}
const business = (context: AtomicCommerceContext, value: Json) => {
  const definition = getAtomicCommerceCommand(proof.command);
  if (definition === undefined) throw new Error("Missing trusted proof definition");
  return definition.run(context, value);
};
const withCommand = (name: string, run: (context: AtomicCommerceContext, value: Json) => Effect.Effect<Json, CommerceTransactionError>) => {
  const command = defineAtomicCommerceCommand(name, run);
  return { command, host: makeAtomicCommerceHost({ ...input, commands: [command] }) };
};

describe("private atomic commerce command", () => {
  beforeAll(async () => {
    const register = (close: () => Promise<void>) => { cleanup.push(close); };
    const resource = driver === "pglite" ? await createRelationalPGliteFixture({ registerCleanup: register }) : await (async () => {
      const value = await createFileScopedPostgresFixture(); register(value.dispose);
      return { persistence: value.persistence, session: makePostgresRelationalSession(value.persistence) };
    })();
    const control = driver === "pglite" ? await createMigratedPGlitePersistence(register) : resource.persistence;
    proof = await runEffect(makeCategoryCurrencyAtomicCommand());
    const catalog = await runEffect(captureProductSchema("atomic-commerce").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    currency = await commerceHostFixture(resource.persistence, resource.session, prepareCurrencyProfile, proof.currencyCommands, control);
    product = await commerceHostFixture(resource.persistence, resource.session, prepareLocalProductProfile, proof.productCommands, control,
      descriptor => productLocalEventPolicy(descriptor, catalog, () => Effect.void), {}, currency);
    input = { ...currency.hostInput, commands: [proof.command], participants: [
      { participant: proof.productParticipant, profile: product.prepared.profile, installation: product.installation,
        commands: proof.productCommands, validate: productLocalEventPolicy(product.descriptor, catalog, () => Effect.void).validate },
      { participant: proof.currencyParticipant, profile: currency.prepared.profile, installation: currency.installation, commands: proof.currencyCommands },
    ] };
    host = await runEffect(makeAtomicCommerceHost(input));
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("reads pending relations across real services and publishes one ordered outcome", async () => {
    const before = await inventory();
    const key = host.newRequestKey();
    const start = performance.now();
    const value = await runEffect(host.run(key, proof.command, args("atomic")));
    process.stdout.write(JSON.stringify({ driver, atomicCommandMs: Math.round(performance.now() - start) }) + "\n");
    expect(value).toMatchObject({ currency: { code: "zzz", name: "atomic" }, reread: { code: "zzz", name: "atomic" } });
    if (!isJsonObject(value)) throw new Error("Expected atomic result object");
    expect(await runEffect(Effect.fromResult(decodeCategoryProjection(required(value.tree)))))
      .toMatchObject({ id: "atomic-parent", category_children: [{ id: "atomic-child", parent_category_id: "atomic-parent" }] });
    expect(await runEffect(Effect.fromResult(decodeCategoryProjection(required(value.counted)))))
      .toMatchObject([[{ id: "atomic-child" }], 1]);
    const after = await inventory();
    expect(after.currency.commits).toHaveLength(before.currency.commits.length + 1);
    expect(after.currency.outcomes).toHaveLength(before.currency.outcomes.length + 1);
    expect(after.currency.wakes).toHaveLength(before.currency.wakes.length + 1);
    const facts = after.currency.facts.slice(before.currency.facts.length);
    expect(new Set(facts.map(fact => fact.installationSha256)).size).toBe(2);
    expect(facts.map(fact => fact.changeOrdinal)).toEqual(facts.map((_, index) => index));
    const currencyOrdinal = required(facts.find(fact => fact.installationSha256 === currency.installation.installation.installationSha256)).changeOrdinal;
    const productOrdinals = facts.filter(fact => fact.installationSha256 === product.installation.installation.installationSha256).map(fact => fact.changeOrdinal);
    expect(Math.min(...productOrdinals)).toBeLessThan(currencyOrdinal);
    expect(Math.max(...productOrdinals)).toBeGreaterThan(currencyOrdinal);
    expect(facts.every(fact => fact.commitSeq === after.currency.commits.at(-1)?.commitSeq)).toBe(true);
    expect(after.currency.commits.at(-1)?.relationalChangeCount).toBe(facts.length);
    expect(await runEffect(host.run(key, proof.command, args("atomic")))).toEqual(value);
    expect(await inventory()).toEqual(after);
  }, 30_000);

  it("rolls back both participants on late failure, including a caught refusal", async () => {
    const before = await inventory();
    const failure = commerceError("invalidInput");
    for (const caught of [false, true]) {
      const test = withCommand("lateFailure", Effect.fn("AtomicTest.lateFailure")(function* (ctx, value) {
        yield* business(ctx, value);
        if (!caught) return yield* ctx.refuse(failure);
        yield* ctx.refuse(failure).pipe(Effect.catchTag("CommerceTransactionError", () => Effect.void));
        return { swallowed: true };
      }));
      const selected = await runEffect(test.host);
      const exit = await runEffect(Effect.exit(selected.run(selected.newRequestKey(), test.command, args("late"))));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === failure), JSON.stringify(exit)).toBe(true);
      expect(await inventory()).toEqual(before);
    }
  }, 30_000);

  it("authenticates participant definitions, tables, binding sets and profile coverage", async () => {
    const before = await inventory();
    const currencyRead = proof.currencyCommands[1];
    if (currencyRead === undefined) throw new Error("Missing currency read command");
    const alien = defineAtomicCommerceParticipant("currency");
    const test = withCommand("foreignParticipant", ctx => ctx.call(alien, currencyRead, { code: "usd" }));
    const selected = await runEffect(test.host);
    expect(await runEffectFailure(selected.run(selected.newRequestKey(), test.command, null))).toMatchObject({ reason: "invalidAuthority" });
    const first = required(input.participants[0]);
    expect(await runEffectFailure(makeAtomicCommerceHost({ ...input, participants: [first, first] })))
      .toMatchObject({ reason: "invalidAuthority" });
    const missingPolicy = input.participants.map(member => {
      const { validate: _validate, ...withoutPolicy } = member;
      return member.participant === proof.productParticipant ? withoutPolicy : member;
    });
    expect(await runEffectFailure(makeAtomicCommerceHost({ ...input, participants: missingPolicy }))).toMatchObject({ reason: "unsupportedProfile" });
    const binding = commerceBindings(product.candidate.frame);
    for (const commerce of [[...binding].reverse(), [binding[0], binding[0]], Array.from({ length: 9 }, () => binding[0])]) {
      expect(await runEffectFailure(captureBindingValue({ ...product.candidate.frame, commerce }, isDataBindingSetFrame))).toMatchObject({ reason: "invalidInput" });
    }
    const profiles = await runEffect(makeDataBindingHost({ ...product.bindingsInput, commerceProfiles: [currency.prepared.profile] }));
    expect(await runEffectFailure(profiles.prepare(product.candidate.frame))).toMatchObject({ reason: "unsupportedProfile" });
    const foreignTable = required(product.descriptor.tables[0]).tableId;
    const probe = defineCommerceCommand("foreignTable", "read", ctx => ctx.table(foreignTable).pipe(Effect.as(null)));
    const tableTest = withCommand("wrongInstallation", ctx => ctx.call(proof.currencyParticipant, probe, null));
    const tableHost = await runEffect(makeAtomicCommerceHost({ ...input, commands: [tableTest.command],
      participants: input.participants.map(member => member.participant === proof.currencyParticipant ? { ...member, commands: [...member.commands, probe] } : member) }));
    expect(await runEffectFailure(tableHost.run(tableHost.newRequestKey(), tableTest.command, null))).toMatchObject({ reason: "invalidAuthority" });
    expect(await inventory()).toEqual(before);
  }, 30_000);

  it("shares aggregate call and byte budgets and revokes borrowed contexts", async () => {
    const before = await inventory();
    let capturedContext: CommerceCommandContext | undefined;
    const probe = defineCommerceCommand("captureContext", "read", ctx => Effect.sync(() => { capturedContext = ctx; return null; }));
    const command = defineAtomicCommerceCommand("sharedBudget", Effect.fn("AtomicTest.sharedBudget")(function* (ctx, value) {
      if (value === "bytes") {
        for (let index = 0; index < 12; index++) yield* ctx.call(index % 2 ? proof.productParticipant : proof.currencyParticipant, probe, "x".repeat(100_000));
      } else {
        for (let index = 0; index < 65; index++) yield* ctx.call(index % 2 ? proof.productParticipant : proof.currencyParticipant, probe, null);
      }
      return null;
    }));
    const selected = await runEffect(makeAtomicCommerceHost({ ...input, commands: [command], participants: input.participants.map(member => ({ ...member, commands: [...member.commands, probe] })) }));
    for (const value of ["calls", "bytes"]) {
      expect(await runEffectFailure(selected.run(selected.newRequestKey(), command, value))).toMatchObject({ reason: "limitExceeded" });
      if (capturedContext === undefined) throw new Error("Probe never borrowed a context");
      expect(await runEffectFailure(capturedContext.store.count(capturedContext.manager, { order: { column: "code", direction: "asc" } })))
        .toMatchObject({ reason: "invalidAuthority" });
    }
    expect(await inventory()).toEqual(before);
  }, 30_000);

  it("shares the SQL statement budget across stores and rolls back a caught limit", async () => {
    const before = await inventory();
    const completed = { currency: 0, product: 0 };
    const probe = (name: "currency" | "product", table: string, column: string) => defineCommerceCommand(`${name}StatementProbe`, "read",
      Effect.fn("AtomicTest.statementProbe")(function* (ctx) {
        const store = yield* ctx.table(table);
        for (let index = 0; index < 17; index++) {
          // Even an empty result performs a catalog bound and a SELECT. These
          // calls stay below the call/byte limits but exceed 64 SQL statements.
          expect(yield* store.find(ctx.manager, { take: 0, order: { column, direction: "asc" } })).toEqual([]);
          completed[name]++;
        }
        return null;
      }));
    const currencyProbe = probe("currency", "currency", "code");
    const productProbe = probe("product", "product_category", "id");
    const command = defineAtomicCommerceCommand("statementBudget", Effect.fn("AtomicTest.statementBudget")(function* (ctx) {
      const id = "statement-budget-parent";
      yield* ctx.call(proof.productParticipant, required(proof.productCommands[0]), [{ id, name: id, handle: id }]);
      yield* ctx.call(proof.currencyParticipant, required(proof.currencyCommands[0]), args("statement-budget").currency);
      yield* ctx.call(proof.currencyParticipant, currencyProbe, null);
      // Catching the second participant's limit cannot commit the earlier writes.
      yield* Effect.result(ctx.call(proof.productParticipant, productProbe, null));
      return null;
    }));
    const selected = await runEffect(makeAtomicCommerceHost({ ...input, commands: [command], participants: input.participants.map(member => ({
      ...member, commands: [...member.commands, member.participant === proof.currencyParticipant ? currencyProbe : productProbe],
    })) }));
    const exit = await runEffect(Effect.exit(selected.run(selected.newRequestKey(), command, null)));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error))
      .toContainEqual(expect.objectContaining({ reason: "limitExceeded", cause: expect.objectContaining({ boundary: "statements", attempted: 65 }) }));
    expect(completed.currency).toBe(17);
    expect(completed.product).toBeGreaterThan(0);
    expect(completed.product).toBeLessThan(17);
    expect(await inventory()).toEqual(before);
  }, 30_000);

  it("refuses overlapping calls and preserves cancellation after both modules write", async () => {
    const before = await inventory();
    const reached = await runEffect(Deferred.make<void>());
    const probe = defineCommerceCommand("pendingRead", "read", () => Deferred.succeed(reached, undefined).pipe(Effect.andThen(Effect.never)));
    const parallel = defineAtomicCommerceCommand("overlap", Effect.fn("AtomicTest.overlap")(function* (ctx) {
      return yield* Effect.scoped(Effect.gen(function* () {
        yield* Effect.forkScoped(ctx.call(proof.currencyParticipant, probe, null));
        yield* Deferred.await(reached);
        return yield* ctx.call(proof.productParticipant, required(proof.productCommands[1]), { id: "missing" });
      }));
    }));
    const concurrent = await runEffect(makeAtomicCommerceHost({ ...input, commands: [parallel], participants: input.participants.map(member => ({ ...member, commands: [...member.commands, probe] })) }));
    expect(await runEffectFailure(concurrent.run(concurrent.newRequestKey(), parallel, null))).toMatchObject({ reason: "overlappingOperation" });
    const written = await runEffect(Deferred.make<void>());
    const waiting = withCommand("cancelAfterWrites", Effect.fn("AtomicTest.cancel")(function* (ctx, value) {
      yield* business(ctx, value);
      yield* Deferred.succeed(written, undefined);
      return yield* Effect.never;
    }));
    const cancel = await runEffect(waiting.host);
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const fiber = yield* Effect.forkScoped(cancel.run(cancel.newRequestKey(), waiting.command, args("cancel")));
      yield* Deferred.await(written).pipe(Effect.timeout(5_000));
      yield* Fiber.interrupt(fiber);
      expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true);
    })));
    expect(await inventory()).toEqual(before);
  }, 30_000);

  it("recovers a lost commit acknowledgement without repeating business work", async () => {
    let executions = 0;
    const counted = withCommand("retained", Effect.fn("AtomicTest.retained")(function* (ctx, value) { executions++; return yield* business(ctx, value); }));
    let lose = true;
    const session = issueRelationalSession(currency.persistence.drizzle, work => runRelationalSession(currency.session, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => {
        if (!lose) return Effect.succeed(value);
        lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost atomic COMMIT acknowledgement") }));
      })));
    const selected = await runEffect(makeAtomicCommerceHost({ ...input, session, commands: [counted.command] }));
    const key = selected.newRequestKey();
    const before = await inventory();
    const value = await runEffect(selected.run(key, counted.command, args("recover")));
    expect(executions).toBe(1);
    const committed = await inventory();
    expect(committed.currency.commits).toHaveLength(before.currency.commits.length + 1);
    expect(await runEffect(selected.run(key, counted.command, args("recover")))).toEqual(value);
    expect(executions).toBe(1);
    expect(await runEffectFailure(selected.run(key, counted.command, args("different")))).toMatchObject({ reason: "requestConflict" });
    expect(await inventory()).toEqual(committed);
    await expireCommerceResult(currency, key);
    expect(await runEffectFailure(selected.run(key, counted.command, args("recover")))).toMatchObject({ reason: "resultUnavailable" });
    expect(executions).toBe(1);
  }, 30_000);

  it("rolls back every publication stage after both modules have written", async () => {
    const before = await inventory();
    for (const table of ["fx_system_commit", "fx_system_commit_relational_change", "fx_system_idempotency", "fx_system_outbox", "fx_system_scope_clock"]) {
      await currency.persistence.exec("create function fx_test_atomic_failure() returns trigger language plpgsql as $$ begin raise exception 'atomic publication failure'; end $$");
      try {
        await currency.persistence.exec(`create trigger fx_test_atomic_failure before ${table === "fx_system_scope_clock" ? "update" : "insert"} on "${table}" for each row execute function fx_test_atomic_failure()`);
        await runEffectFailure(host.run(host.newRequestKey(), proof.command, args("publication")));
        expect(await inventory()).toEqual(before);
      } finally {
        await currency.persistence.exec(`drop trigger if exists fx_test_atomic_failure on "${table}"`);
        await currency.persistence.exec("drop function fx_test_atomic_failure()");
      }
    }
  }, 60_000);

  it("validates the full commit before projection and reads original layouts after binding movement", async () => {
    await runEffect(host.run(host.newRequestKey(), proof.command, args("history")));
    const state = await commerceInventory(currency);
    const commit = state.commits.at(-1);
    if (commit === undefined) throw new Error("Missing committed proof");
    const query = { scopeUuid: commit.scopeUuid, commitSeq: commit.commitSeq, installations: [currency, product].map(fixture => ({
      installationSha256: fixture.installation.installation.installationSha256, layout: fixture.descriptor.layout })),
      selectInstallationSha256: currency.installation.installation.installationSha256 };
    const db = currency.persistence.drizzle;
    expect(await db.transaction(tx => runEffect(readRelationalCommitFactsInTransaction(tx, query)))).toHaveLength(1);
    await assertAtomicProjectionRejectsOtherParticipantCorruption(db, query, product.installation.installation.installationSha256);
    const current = await runEffect(product.bindings.withCurrent(readAdmittedDataBinding));
    const candidate = await runEffect(product.bindings.prepare({ ...product.candidate.frame, commerce: [commerceBindings(product.candidate.frame)
      .find(binding => binding.installation.installationSha256 === currency.installation.installation.installationSha256)] }));
    await runEffect(product.bindings.activate(dataBindingActivationRequest(candidate.frame.application.scopeId, candidate.frame.application.storageGeneration,
      "atomic-remove-product", candidate.sha256, current.head)));
    expect(await runEffectFailure(host.run(host.newRequestKey(), proof.command, args("stale")))).toMatchObject({ reason: "bindingChanged" });
    expect(await db.transaction(tx => runEffect(readRelationalCommitFactsInTransaction(tx, query)))).toHaveLength(1);
    const moved = await runEffect(product.bindings.withCurrent(readAdmittedDataBinding));
    await runEffect(product.bindings.activate(dataBindingActivationRequest(candidate.frame.application.scopeId, candidate.frame.application.storageGeneration,
      "atomic-restore-product", product.candidate.sha256, moved.head)));
  }, 30_000);

  it("coexists with a native journal and publishes consecutive scope sequences", async () => {
    const before = await commerceInventory(currency);
    await runEffect(assertNativeCommandPublication(currency, host.run(host.newRequestKey(), proof.command, args("native")), "disjoint"));
    const after = await commerceInventory(currency);
    expect(after.commits).toHaveLength(before.commits.length + 2);
    const commands = after.commits.slice(before.commits.length);
    expect(commands[1]?.commitSeq).toBe(required(commands[0]).commitSeq + 1n);
    expect(commands[1]?.relationalChangeCount).toBe(0);
  }, 30_000);

  it.runIf(driver === "postgres")("reconciles a real PostgreSQL commit on a new connection", async () => {
    const postgres = currency.persistence;
    if (!("pool" in postgres)) throw new Error("Expected real Postgres fixture");
    let failedPid = 0;
    let executions = 0;
    const pids: number[] = [];
    const counted = withCommand("physicalRecovery", Effect.fn("AtomicTest.physicalRecovery")(function* (ctx, value) { executions++; return yield* business(ctx, value); }));
    const selected = await runEffect(makeAtomicCommerceHost({ ...input, commands: [counted.command],
      session: makePostgresRelationalSession(postgres, { lifecycleFault: event => {
        const pid: unknown = Reflect.get(event.client, "processID");
        if (typeof pid !== "number") throw new Error("Missing backend PID");
        if (event.phase === "begin" && event.edge === "after") pids.push(pid);
        if (event.phase === "commit" && event.edge === "after" && failedPid === 0) { failedPid = pid; throw new Error("Lost atomic physical COMMIT acknowledgement"); }
      } }),
    }));
    const before = await inventory();
    const key = selected.newRequestKey();
    const value = await runEffect(selected.run(key, counted.command, args("physical")));
    expect(executions).toBe(1);
    expect(pids.length).toBeGreaterThanOrEqual(2);
    expect(pids[1]).not.toBe(failedPid);
    expect(await runEffect(selected.run(key, counted.command, args("physical")))).toEqual(value);
    expect(executions).toBe(1);
    expect((await inventory()).currency.commits).toHaveLength(before.currency.commits.length + 1);
  }, 30_000);

  it.runIf(driver === "postgres")("shares one outcome for concurrent keys and refuses bounded scope-lock contention", async () => {
    const postgres = currency.persistence;
    if (!("pool" in postgres)) throw new Error("Expected real Postgres fixture");
    let executions = 0;
    const counted = withCommand("concurrentReplay", Effect.fn("AtomicTest.concurrentReplay")(function* (ctx, value) { executions++; return yield* business(ctx, value); }));
    const selected = await runEffect(counted.host);
    const key = selected.newRequestKey();
    const before = await inventory();
    const results = await Promise.all([runEffect(selected.run(key, counted.command, args("concurrent"))), runEffect(selected.run(key, counted.command, args("concurrent")))]);
    expect(results[0]).toEqual(results[1]);
    expect(executions).toBe(1);
    const stable = await inventory();
    expect(stable.currency.commits).toHaveLength(before.currency.commits.length + 1);
    const blocker = await postgres.pool.connect();
    try {
      const session = issueRelationalSession(postgres.drizzle, work => Effect.gen(function* () {
        yield* Effect.promise(() => blocker.query("begin"));
        yield* Effect.promise(() => blocker.query("select 1 from fx_system_scope_clock for update"));
        return yield* runRelationalSession(currency.session, work).pipe(Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))));
      }));
      const contended = await runEffect(makeAtomicCommerceHost({ ...input, session, commands: [counted.command] }));
      const start = performance.now();
      const failure = await runEffectFailure(contended.run(contended.newRequestKey(), counted.command, args("contended")));
      expect(postgresFailureCode(failure)).toBe("55P03");
      expect(executions).toBe(1);
      process.stdout.write(JSON.stringify({ driver, scopeLockRefusalMs: Math.round(performance.now() - start) }) + "\n");
    } finally {
      await blocker.query("rollback");
      blocker.release();
    }
    expect(await inventory()).toEqual(stable);
  }, 30_000);
});
