import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { isJsonObject } from "flarex-protocol/json";
import { decodeCategoryProjection } from "../src/product-category-projection";
import { currencyAnnouncementWrite, currencyCommands } from "../src/currency-service";
import { defineAtomicCommerceCommand, getAtomicCommerceCommand } from
  "../../persistence-postgres/src/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { defineCommerceCommand } from "../../persistence-postgres/src/commerceTransaction/commands";
import { defineCommerceEventContract, type AtomicCommerceEvents } from
  "../../persistence-postgres/src/atomicCommerce/events";
import { commerceError } from "../../persistence-postgres/src/commerceTransaction/model";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";
import { logicalCategoryCurrencyFixture, logicalCategoryCurrencyInventory } from "./support/logical-category-currency-fixture";
import type { LocalGraphQuery } from "../src/local-graph/model";

const driver = process.env.FLAREX_TEST_DRIVER ?? process.env.MEDUSA_COMPARISON_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Medusa comparison driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: Awaited<ReturnType<typeof logicalCategoryCurrencyFixture>>;
const args = (prefix: string) => ({ categoryPrefix: prefix, currency: {
  code: "zzz", name: prefix, symbol: "T", symbol_native: "T", decimal_digits: 2, rounding: 0,
} });
const required = <Value>(value: Value | undefined): Value => {
  if (value === undefined) throw new Error("Missing mixed command definition");
  return value;
};
const inventory = () => logicalCategoryCurrencyInventory(fixture);

describe("Category/Currency on two logical participants", () => {
  beforeAll(async () => { fixture = await logicalCategoryCurrencyFixture(driver, close => cleanup.push(close)); }, 150_000);
  afterAll(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
    if (failures.length > 0) throw new AggregateError(failures, "Mixed commerce fixture cleanup failed");
  }, 120_000);

  it("publishes one commit with logical Currency and Category changes", async () => {
    const { proof, host } = fixture;
    const before = await inventory();
    const key = host.newRequestKey();
    const value = await runEffect(host.run(key, proof.command, args("mixed")));
    expect(value).toMatchObject({ currency: { code: "zzz", name: "mixed" },
      reread: { code: "zzz", name: "mixed" } });
    if (typeof value !== "object" || value === null || !("tree" in value))
      throw new Error("Missing Category projection");
    expect(await runEffect(Effect.fromResult(decodeCategoryProjection(value.tree))))
      .toMatchObject({ id: "mixed-parent", category_children: [{ id: "mixed-child" }] });
    if (!("counted" in value)) throw new Error("Missing counted Category projection");
    expect(await runEffect(Effect.fromResult(decodeCategoryProjection(value.counted))))
      .toMatchObject([[{ id: "mixed-child" }], 1]);
    const after = await inventory();
    expect(after.categories).toHaveLength(before.categories.length + 2);
    expect(after.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "mixed-parent" }), expect.objectContaining({ id: "mixed-child" }),
    ]));
    expect(after.logical.rows).toHaveLength(before.logical.rows.length + 3);
    expect(after.logical.rowChanges).toHaveLength(before.logical.rowChanges.length + 3);
    expect(after.logical.commits).toHaveLength(before.logical.commits.length + 1);
    expect(after.logical.outcomes).toHaveLength(before.logical.outcomes.length + 1);
    expect(after.logical.wakes).toHaveLength(before.logical.wakes.length + 1);
    expect(after.logical.physicalFacts).toEqual(before.logical.physicalFacts);
    expect(await runEffect(host.run(key, proof.command, args("mixed")))).toEqual(value);
    expect(await inventory()).toEqual(after);
  }, 120_000);

  it("refuses a Category receipt that changes a requested field and rolls back its row", async () => {
    const { input, proof } = fixture;
    const command = defineAtomicCommerceCommand("mixedExtraCategoryField", ctx =>
      ctx.call(proof.productParticipant, required(proof.productCommands[0]),
        [{ id: "extra-category", name: "Extra category", handle: "extra-category", is_active: true }]));
    const host = await runEffect(makeAtomicCommerceHost({ ...input, commands: [command],
      participants: input.participants.map(member => {
        const validate = member.validateLogicalCall;
        return member.participant !== proof.productParticipant || validate === undefined ? member
          : { ...member, validateLogicalCall: (call, activity, command) => validate(call, { ...activity,
            mutations: activity.mutations.map(mutation => ({ ...mutation,
              after: mutation.after === null ? null : { ...mutation.after, is_active: false } })),
          }, command) };
      }) }));
    try {
      const before = await inventory();
      expect(await runEffectFailure(host.run(host.newRequestKey(), command, null)))
        .toMatchObject({ reason: "receiptMismatch" });
      expect(await inventory()).toEqual(before);
    } finally { await runEffect(host.close); }
  }, 120_000);

  it("rolls back Product and logical Currency together after a late root refusal", async () => {
    const { input, proof } = fixture;
    const original = getAtomicCommerceCommand(proof.command);
    if (original === undefined) throw new Error("Missing Category/Currency command");
    const refused = defineAtomicCommerceCommand("lateMixedRefusal", Effect.fn("MixedAtomic.lateRefusal")(function* (ctx) {
      yield* original.run(ctx, args("refused"));
      return yield* ctx.refuse(commerceError("invalidInput"));
    }));
    const host = await runEffect(makeAtomicCommerceHost({ ...input, commands: [refused] }));
    try {
      const before = await inventory();
      expect(await runEffectFailure(host.run(host.newRequestKey(), refused, null)))
        .toMatchObject({ reason: "invalidInput" });
      expect(await inventory()).toEqual(before);
    } finally { await runEffect(host.close); }
  }, 120_000);

  it("keeps an original caught failure and rolls back both participants", async () => {
    const { input, proof } = fixture;
    const original = getAtomicCommerceCommand(proof.command);
    if (original === undefined) throw new Error("Missing Category/Currency command");
    const before = await inventory();
    const failure = commerceError("invalidInput");
    for (const caught of [false, true]) {
      const command = defineAtomicCommerceCommand("mixedCaughtRefusal", Effect.fn("MixedAtomic.caughtRefusal")(function* (ctx) {
        yield* original.run(ctx, args("caught"));
        if (!caught) return yield* ctx.refuse(failure);
        yield* ctx.refuse(failure).pipe(Effect.catchTag("CommerceTransactionError", () => Effect.void));
        return { swallowed: true };
      }));
      const host = await runEffect(makeAtomicCommerceHost({ ...input, commands: [command] }));
      try {
        const exit = await runEffect(Effect.exit(host.run(host.newRequestKey(), command, null)));
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) expect(exit.cause.reasons.some(reason =>
          Cause.isFailReason(reason) && reason.error === failure)).toBe(true);
        expect(await inventory()).toEqual(before);
      } finally { await runEffect(host.close); }
    }
  }, 120_000);

  it("reads pending Category and Currency graphs with one publication and no replay reads", async () => {
    const { input, proof } = fixture;
    const before = await inventory();
    let queries = 0;
    let escaped: LocalGraphQuery | undefined;
    const command = defineAtomicCommerceCommand("mixedPendingGraph", Effect.fn("MixedAtomic.pendingGraph")(function* (ctx) {
      yield* ctx.call(proof.productParticipant, required(proof.productCommands[0]),
        [{ id: "mixed-graph-parent", name: "Graph parent", handle: "mixed-graph-parent" }]);
      yield* ctx.call(proof.currencyParticipant, required(proof.currencyCommands[0]),
        { ...args("graph").currency, code: "xgg", rounding: 0.05 });
      yield* ctx.call(proof.productParticipant, required(proof.productCommands[0]),
        [{ id: "mixed-graph-child", name: "Graph child", handle: "mixed-graph-child", parent_category_id: "mixed-graph-parent" }]);
      const graph = proof.graph.bind({ ...ctx, call: (...call) => { queries++; return ctx.call(...call); } });
      escaped = graph;
      const category = yield* graph.graph({ entity: "product_category", fields: ["name", "category_children.*", "parent_category.id"],
        filters: { id: "mixed-graph-parent" }, pagination: { take: 1 } });
      const currency = yield* graph.graph({ entity: "currency", fields: ["code", "name", "rounding"],
        filters: { code: "xgg" }, pagination: { take: 1 } });
      return { category, currency };
    }));
    const host = await runEffect(makeAtomicCommerceHost({ ...input, commands: [command] }));
    try {
      const key = host.newRequestKey();
      const value = await runEffect(host.run(key, command, null));
      expect(value).toMatchObject({
        category: { data: [{ name: "Graph parent", category_children: [{ id: "mixed-graph-child", parent_category_id: "mixed-graph-parent" }] }],
          metadata: { count: 1, skip: 0, take: 1 } },
        currency: { data: [{ code: "xgg", name: "graph", rounding: 0.05,
          raw_rounding: { value: "0.050000000000000000000", precision: 20 } }], metadata: { count: 1, skip: 0, take: 1 } },
      });
      const after = await inventory();
      expect(after.logical.commits).toHaveLength(before.logical.commits.length + 1);
      expect(after.logical.rowChanges).toHaveLength(before.logical.rowChanges.length + 3);
      expect(after.logical.physicalFacts).toEqual(before.logical.physicalFacts);
      expect(after.categories).toHaveLength(before.categories.length + 2);
      expect(queries).toBe(2);
      expect(await runEffect(host.run(key, command, null))).toEqual(value);
      expect(queries).toBe(2);
      expect(await inventory()).toEqual(after);
      expect(await runEffectFailure(required(escaped).graph({ entity: "currency", fields: ["code"], pagination: { take: 1 } })))
        .toMatchObject({ reason: "invalidAuthority" });
    } finally { await runEffect(host.close); }
  }, 120_000);

  it("captures validated Currency call inputs and rejects a Product validator failure", async () => {
    const { currency, input, proof } = fixture;
    const supplied = { marker: { id: "original" } };
    let executions = 0;
    let validations = 0;
    const inner = defineCommerceCommand("mixedObservationInner", "read", ctx =>
      ctx.nested(currencyCommands.retrieve, { code: "usd" }));
    const outer = defineCommerceCommand("mixedObservationOuter", "read", Effect.fn("MixedAtomic.observation")(function* (ctx, captured) {
      expect(captured).toEqual({ marker: { id: "original" } });
      expect(Object.isFrozen(captured)).toBe(true);
      supplied.marker.id = "caller-mutated";
      executions++;
      return yield* ctx.nested(inner, { marker: "nested-input" });
    }));
    const command = defineAtomicCommerceCommand("mixedObserveCurrency", Effect.fn("MixedAtomic.observeCurrency")(function* (ctx) {
      const usd = yield* ctx.call(proof.currencyParticipant, outer, supplied);
      yield* ctx.call(proof.currencyParticipant, currencyCommands.retrieve, { code: "gbp" });
      return usd;
    }));
    const contract = defineCommerceEventContract({ name: "currency.observation", revision: "a".repeat(64),
      internal: false, decode: () => Effect.succeed(null) });
    const events = { producerRevision: "a".repeat(64), contracts: [contract],
      subscribers: [{ id: "observations", revision: "a".repeat(64) }],
      validate: Effect.fn("MixedAtomic.validateCalls")((_events: Parameters<AtomicCommerceEvents["validate"]>[0],
        calls: Parameters<AtomicCommerceEvents["validate"]>[1]) => Effect.sync(() => {
        validations++;
        expect(calls).toHaveLength(2);
        expect(calls.map(call => call.command)).toEqual([outer, currencyCommands.retrieve]);
        expect(calls[0]?.input).toEqual({ marker: { id: "original" } });
        expect(calls[0]?.input).not.toBe(supplied);
        expect(calls[0]?.result).toMatchObject({ code: "usd" });
        expect(calls[1]?.input).toEqual({ code: "gbp" });
        expect(calls[1]?.result).toMatchObject({ code: "gbp" });
        expect(Object.isFrozen(calls[0])).toBe(true);
        const first = calls[0]?.input;
        expect(first !== undefined && isJsonObject(first) && first.marker !== undefined &&
          isJsonObject(first.marker) && Object.isFrozen(first.marker)).toBe(true);
      })),
    };
    const selected = await runEffect(makeAtomicCommerceHost({ ...input, commands: [command], events,
      participants: [{ participant: proof.currencyParticipant, logicalStorage: currency.hostInput.logicalStorage,
        commands: [outer, inner, currencyCommands.retrieve] }] }));
    try {
      const key = selected.newRequestKey();
      const result = await runEffect(selected.run(key, command, null));
      expect(result).toMatchObject({ code: "usd" });
      expect(executions).toBe(1);
      expect(validations).toBe(1);
      expect(await runEffect(selected.run(key, command, null))).toEqual(result);
      expect(executions).toBe(1);
      expect(validations).toBe(1);
    } finally { await runEffect(selected.close); }
    const before = await inventory();
    const rejected = defineCommerceCommand("mixedRejectedObservation", "read", () => Effect.succeed(null));
    const failingRoot = defineAtomicCommerceCommand("mixedRejectObservation", ctx =>
      ctx.call(proof.productParticipant, rejected, null));
    const product = input.participants.find(member => member.participant === proof.productParticipant);
    if (product === undefined) throw new Error("Missing Product participant");
    const refused = await runEffect(makeAtomicCommerceHost({ ...input, commands: [failingRoot], events,
      participants: [{ ...product, commands: [rejected], validateLogicalCall: () => Effect.fail(commerceError("receiptMismatch")) }] }));
    try {
      expect(await runEffectFailure(refused.run(refused.newRequestKey(), failingRoot, null)))
        .toMatchObject({ reason: "receiptMismatch" });
      expect(validations).toBe(1);
      expect(await inventory()).toEqual(before);
    } finally { await runEffect(refused.close); }
  }, 120_000);

  it("rolls back both stores after caught graph rejection or a shared query limit", async () => {
    const { input, proof } = fixture;
    const before = await inventory();
    for (const mode of ["unsupported", "result", "limit"] as const) {
      const command = defineAtomicCommerceCommand("mixedGraphRefusal", Effect.fn("MixedAtomic.graphRefusal")(function* (ctx) {
        yield* ctx.call(proof.productParticipant, required(proof.productCommands[0]),
          [{ id: "mixed-graph-rollback", name: "Rollback", handle: "mixed-graph-rollback" }]);
        yield* ctx.call(proof.currencyParticipant, required(proof.currencyCommands[0]),
          { ...args("graph-rollback").currency, code: "xrr" });
        const graph = proof.graph.bind(mode === "result"
          ? { ...ctx, call: (...call) => ctx.call(...call).pipe(Effect.as([[], 1])) } : ctx);
        const read = Effect.gen(function* () {
          if (mode !== "limit") return yield* graph.graph({ entity: "currency",
            fields: [mode === "result" ? "code" : "secret"], pagination: { take: 1 } });
          for (let index = 0; index < 65; index++) yield* graph.graph({ entity: "currency",
            fields: ["code"], pagination: { take: 0 } });
          return null;
        });
        yield* read.pipe(Effect.catchTag("CommerceTransactionError", () => Effect.void));
        return { swallowed: true };
      }));
      const host = await runEffect(makeAtomicCommerceHost({ ...input, commands: [command] }));
      try {
        const exit = await runEffect(Effect.exit(host.run(host.newRequestKey(), command, null)));
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) expect(exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error))
          .toContainEqual(expect.objectContaining({ reason: mode === "limit" ? "limitExceeded"
            : mode === "result" ? "storedCorruption" : "unsupportedProfile" }));
        expect(await inventory()).toEqual(before);
      } finally { await runEffect(host.close); }
    }
  }, 120_000);

  it("cancels a pending mixed graph and refuses an unregistered Currency read", async () => {
    const { input, proof } = fixture;
    const before = await inventory();
    const reached = await runEffect(Deferred.make<void>());
    const command = defineAtomicCommerceCommand("mixedGraphCancel", Effect.fn("MixedAtomic.graphCancel")(function* (ctx) {
      yield* ctx.call(proof.productParticipant, required(proof.productCommands[0]),
        [{ id: "mixed-graph-cancel", name: "Cancel", handle: "mixed-graph-cancel" }]);
      yield* ctx.call(proof.currencyParticipant, required(proof.currencyCommands[0]),
        { ...args("graph-cancel").currency, code: "xcc" });
      const graph = proof.graph.bind({ ...ctx, call: (...call) => ctx.call(...call).pipe(
        Effect.tap(() => Deferred.succeed(reached, undefined)), Effect.andThen(Effect.never)) });
      return yield* graph.graph({ entity: "currency", fields: ["code"], pagination: { take: 1 } });
    }));
    const host = await runEffect(makeAtomicCommerceHost({ ...input, commands: [command] }));
    try {
      await runEffect(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(host.run(host.newRequestKey(), command, null));
        yield* Deferred.await(reached).pipe(Effect.timeout(5_000));
        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(exit.cause.reasons.length).toBeGreaterThan(0);
          expect(exit.cause.reasons.every(Cause.isInterruptReason)).toBe(true);
        }
      })));
      expect(await inventory()).toEqual(before);
    } finally { await runEffect(host.close); }
    const read = defineAtomicCommerceCommand("mixedUnregisteredGraphRead", ctx => proof.graph.bind(ctx)
      .graph({ entity: "currency", fields: ["code"], pagination: { take: 1 } }));
    const denied = await runEffect(makeAtomicCommerceHost({ ...input, commands: [read],
      participants: input.participants.map(member => ({ ...member,
        commands: member.participant === proof.currencyParticipant ? member.commands.slice(0, 2) : member.commands })) }));
    try {
      expect(await runEffectFailure(denied.run(denied.newRequestKey(), read, null)))
        .toMatchObject({ reason: "invalidAuthority" });
      expect(await inventory()).toEqual(before);
    } finally { await runEffect(denied.close); }
  }, 120_000);

  it("runs standalone and mixed native commands after a peer joins the deployment", async () => {
    const { currency, input, proof } = fixture;
    const peerScopeId = ScopeIdSchema.make(`scope_category_currency_peer_${driver}`);
    await currency.control.insertScopeMetadata({
      deploymentId: currency.deploymentId,
      scopeId: peerScopeId,
      physicalLocator: currency.application.active.basis.authority.physicalLocator,
    });
    const before = await inventory();
    const expectedPeerFailure = { reason: "invalidAuthority",
      cause: { failure: { reason: "splitProvisioningReceiptMissing", scopeId: peerScopeId } } };
    expect(await runEffectFailure(makeCommerceHost({ ...currency.hostInput, scopeId: peerScopeId })))
      .toMatchObject(expectedPeerFailure);
    expect(await runEffectFailure(makeAtomicCommerceHost({ ...input, scopeId: peerScopeId })))
      .toMatchObject(expectedPeerFailure);
    expect(await inventory()).toEqual(before);
    const standalone = await runEffect(makeCommerceHost(currency.hostInput));
    const mixed = await runEffect(makeAtomicCommerceHost(input));
    try {
      const single = await runEffect(standalone.run(standalone.newRequestKey(),
        currencyAnnouncementWrite,
        { code: "scp", name: "Scoped Currency", symbol: "S", symbol_native: "S" }));
      expect(single).toMatchObject({ code: "scp" });
      const key = mixed.newRequestKey();
      const mixedArgs = {
        ...args("scope-selected"), currency: { ...args("scope-selected").currency, code: "scm" },
      };
      const value = await runEffect(mixed.run(key, proof.command, mixedArgs));
      expect(value).toMatchObject({ currency: { code: "scm" } });
      expect(await runEffect(mixed.run(key, proof.command, mixedArgs))).toEqual(value);
      const after = await inventory();
      expect(after.logical.commits).toHaveLength(before.logical.commits.length + 2);
      expect(after.logical.outcomes).toHaveLength(before.logical.outcomes.length + 2);
      expect(after.logical.rows).toHaveLength(before.logical.rows.length + 4);
      expect(after.logical.physicalFacts).toEqual(before.logical.physicalFacts);
    } finally {
      await runEffect(mixed.close);
      await runEffect(standalone.close);
    }
  }, 120_000);
});
