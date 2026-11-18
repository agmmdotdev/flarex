import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../support/postgresHelpers";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { commerceHostFixture, type CommerceHostTestFixture } from "../commerceTransaction/commerceHostFixture";
import { commerceInventory } from "../commerceTransaction/commerceInventory";
import { prepareNeutralCommerceProfile } from "../commerceTransaction/neutralCommerceProfile";
import { defineCommerceCommand } from "../../../src/frameworks/commerceTransaction/commands";
import { commerceError, type CommerceTransactionError } from "../../../src/frameworks/commerceTransaction/model";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant, type AtomicCommerceContext } from "../../../src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineCommerceEventContract, type CommerceEventContract } from "../../../src/frameworks/atomicCommerce/events";
import { fxSystemCommitEvents } from "../../../src/commit/events/schema";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let fixture: CommerceHostTestFixture;
const participant = defineAtomicCommerceParticipant("pending_events");
const decoder = Schema.decodeUnknownEffect(Schema.Struct({ id: Schema.String }), { onExcessProperty: "error" });
const decode = (input: unknown) => decoder(input).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)));
const revision = "a".repeat(64);
const cancel = defineCommerceEventContract({ name: "neutral.created", revision, internal: false, pendingCancellation: true, decode });
const moduleFact = defineCommerceEventContract({ name: "neutral.module", revision, internal: true, decode });
const sibling = defineCommerceEventContract({ name: "neutral.other", revision, internal: false, decode });
const lookalike = defineCommerceEventContract({ name: "neutral.created", revision, internal: false, pendingCancellation: true, decode });
const write = defineCommerceCommand("writePendingRecord", "write", Effect.fn(function* (ctx, id) {
  if (typeof id !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
  const rows = yield* ctx.store.write(ctx.manager, "insert", [{ id, value: 1 }]);
  yield* ctx.captureLocalEvent({ id }); return rows;
}));
const events = () => fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);

beforeAll(async () => {
  const registerCleanup = (close: () => Promise<void>) => cleanup.push(close);
  const resource = driver === "pglite" ? await createRelationalPGliteFixture({ registerCleanup }) : await (async () => {
    const database = await createFileScopedPostgresFixture(); registerCleanup(database.dispose);
    return { persistence: database.persistence, session: makePostgresRelationalSession(database.persistence) };
  })();
  const control = driver === "pglite" ? await createMigratedPGlitePersistence(registerCleanup) : resource.persistence;
  fixture = await commerceHostFixture(resource.persistence, resource.session, prepareNeutralCommerceProfile(["pending_record"]), [write], control,
    () => ({ capture: () => Effect.fail(commerceError("unadmittedEvent")),
      validate: events => events.length ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void,
      deliver: events => events.length ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void }));
  cleanup.push(() => runEffect(fixture.host.close));
}, 120_000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

describe.each(["inline", "queued"] as const)("pending event cancellation through the real %s atomic owner", scheduling => {
  const createHost = (commands: Parameters<typeof makeAtomicCommerceHost>[0]["commands"]) => runEffect(makeAtomicCommerceHost({
    ...fixture.hostInput, commands, ...(scheduling === "queued" ? { operationScheduling: "queued" as const } : {}),
    participants: [{ participant, profile: fixture.prepared.profile, installation: fixture.installation, commands: [write],
      events: { contracts: [moduleFact], select: () => Effect.succeed(moduleFact) }, validate: () => Effect.void }],
    events: { producerRevision: revision, contracts: [cancel, moduleFact, sibling],
      subscribers: [{ id: "neutral-pending", revision }], validate: () => Effect.void },
  }));

  it("settles surviving intents with module facts, preserves prior committed roots and replays once", async () => {
    let executions = 0, escaped: AtomicCommerceContext | undefined;
    const root = defineAtomicCommerceCommand("pendingRoundtrip" + scheduling, Effect.fn(function* (ctx, id) {
      executions++; escaped = ctx;
      const rows = yield* ctx.call(participant, write, id);
      yield* ctx.emit(cancel, { id: "prior" }); yield* ctx.emit(sibling, { id: "other" });
      yield* ctx.clearPendingEvents(cancel); yield* ctx.emit(cancel, { id: "future" });
      return rows;
    }));
    const next = defineAtomicCommerceCommand("pendingNextRoot" + scheduling, Effect.fn(function* (ctx) {
      if (!escaped) return yield* ctx.refuse(commerceError("invalidAuthority"));
      expect(yield* Effect.result(escaped.clearPendingEvents(cancel))).toMatchObject({ _tag: "Failure",
        failure: { reason: scheduling === "queued" ? "closed" : "invalidAuthority" } });
      yield* ctx.clearPendingEvents(cancel); return null;
    }));
    const host = await createHost([root, next]);
    try {
      const before = await events(), key = host.newRequestKey();
      const result = await runEffect(host.run(key, root, "pending-" + scheduling));
      const inventory = await commerceInventory(fixture), retained = await events();
      expect(retained.slice(before.length).map(item => [item.envelope.contract, item.envelope.message])).toEqual([
        ["neutral.module", { id: "pending-" + scheduling }], ["neutral.other", { id: "other" }], ["neutral.created", { id: "future" }],
      ]);
      expect(new Set(retained.slice(before.length).map(item => item.commitSeq)).size).toBe(1);
      expect(await runEffect(host.run(key, root, "pending-" + scheduling))).toEqual(result);
      expect(executions).toBe(1); expect(await commerceInventory(fixture)).toEqual(inventory); expect(await events()).toEqual(retained);
      await runEffect(host.run(host.newRequestKey(), next, null));
      expect(await events()).toEqual(retained);
    } finally { await runEffect(host.close); }
  });

  it.each([["unadmitted lookalike", lookalike], ["internal fact", moduleFact], ["ordinary external contract", sibling]] as const)(
    "latches a caught refusal of %s and rolls back writes and events", async (_label, token: CommerceEventContract) => {
      let immediate: CommerceTransactionError | undefined;
      const root = defineAtomicCommerceCommand("pendingCaughtRefusal" + scheduling, Effect.fn(function* (ctx) {
        yield* ctx.call(participant, write, "pending-refused-" + scheduling);
        yield* ctx.emit(cancel, { id: "pending" });
        const refused = yield* Effect.exit(ctx.clearPendingEvents(token));
        if (Exit.isSuccess(refused)) throw new Error("Expected immediate pending cancellation refusal");
        immediate = refused.cause.reasons.find(Cause.isFailReason)?.error;
        expect(immediate).toMatchObject({ reason: "unadmittedEvent" });
        return null;
      }));
      const host = await createHost([root]);
      try {
        const before = await commerceInventory(fixture), priorEvents = await events();
        const settled = await runEffect(Effect.exit(host.run(host.newRequestKey(), root, null)));
        if (Exit.isSuccess(settled)) throw new Error("Expected poisoned atomic root rollback");
        expect(settled.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === immediate)).toBe(true);
        if (scheduling === "inline") expect(settled.cause.reasons.some(reason =>
          Cause.isFailReason(reason) && reason.error.reason === "rollbackOnly")).toBe(true);
        expect(await commerceInventory(fixture)).toEqual(before); expect(await events()).toEqual(priorEvents);
      } finally { await runEffect(host.close); }
    });

  it("rolls back a late failure after valid cancellation", async () => {
    const root = defineAtomicCommerceCommand("pendingLateFailure" + scheduling, Effect.fn(function* (ctx) {
      yield* ctx.call(participant, write, "pending-late-" + scheduling); yield* ctx.emit(cancel, { id: "pending" });
      yield* ctx.clearPendingEvents(cancel); return yield* ctx.refuse(commerceError("invalidInput"));
    }));
    const host = await createHost([root]);
    try {
      const before = await commerceInventory(fixture), priorEvents = await events();
      expect(await runEffectFailure(host.run(host.newRequestKey(), root, null))).toMatchObject({ reason: "invalidInput" });
      expect(await commerceInventory(fixture)).toEqual(before); expect(await events()).toEqual(priorEvents);
    } finally { await runEffect(host.close); }
  });
});
