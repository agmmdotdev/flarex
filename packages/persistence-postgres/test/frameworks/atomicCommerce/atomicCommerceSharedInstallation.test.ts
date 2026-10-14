import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Option, Result } from "effect";
import { captureWorkflowValue } from "../../../../medusa-adapter/src/workflow/value";
import { eq } from "drizzle-orm";
import { commerceHostFixture, type CommerceHostTestFixture } from "../commerceTransaction/commerceHostFixture";
import { prepareNeutralCommerceProfile } from "../commerceTransaction/neutralCommerceProfile";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../support/postgresHelpers";
import { issueRelationalSession, makePostgresRelationalSession, runRelationalSession } from "../../../src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../../src/database/relationalTransaction/model";
import { registerLocalCommerceProfile } from "../../../src/frameworks/commerceTransaction/profile";
import type { CommerceProfile } from "../../../src/frameworks/commerceTransaction/profile";
import type { InstallationBindingReference } from "../../../src/installation/frameworkSchema/binding/model";
import { defineCommerceCommand, type CommerceCommandContext } from "../../../src/frameworks/commerceTransaction/commands";
import type { LocalCommerceEventPolicy } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { makeCommerceBinding } from "../../../src/frameworks/commerceTransaction/commerce";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../../src/installation/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../../src/installation/frameworkSchema/binding/selection";
import { commerceBindings } from "../../../src/installation/frameworkSchema/binding/model";
import { fxSystemFrameworkSchemaAvailabilityHeads as availabilityHeads } from "../../../src/installation/frameworkSchema/installation/schema";
import * as installationRuntime from "../../../src/installation/frameworkSchema/installation/runtime";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant, type AtomicCommerceContext } from "../../../src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost, type AtomicCommerceHostInput } from "../../../src/frameworks/atomicCommerce/host";
import { captureAtomicCommerceParticipants, prepareAtomicCommerceParticipants, type AtomicCommerceParticipantInput } from "../../../src/frameworks/atomicCommerce/participants";
import { commerceInventory } from "../commerceTransaction/commerceInventory";
import { readRelationalCommitFactsInTransaction } from "../../../src/commit/publication/relationalFacts";
import { assertAtomicProjectionRejectsOtherParticipantCorruption } from "./atomicCommerceFactsScenario";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid atomic installation driver");
const cleanup: Array<() => Promise<void>> = [];
const names = ["alpha", "beta", "gamma", "delta"] as const;
const definitions = names.map(name => ({ name, participant: defineAtomicCommerceParticipant(name),
  read: defineCommerceCommand(`read-${name}`, "read", Effect.fn(function* (ctx) {
    const table = yield* ctx.table(name);
    return [...yield* table.find(ctx.manager, { fields: ["id", "value"], take: 100, order: { column: "id", direction: "asc" } })];
  })),
  write: defineCommerceCommand(`write-${name}`, "write", Effect.fn(function* (ctx, id) {
    if (typeof id !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
    const table = yield* ctx.table(name);
    return [...yield* table.write(ctx.manager, "insert", [{ id, value: 1 }])];
  })),
}));
const commands = definitions.flatMap(value => [value.read, value.write]);
const events: LocalCommerceEventPolicy = {
  capture: () => Effect.fail(commerceError("unadmittedEvent")),
  validate: events => events.length ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void,
  deliver: events => events.length ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void,
};
let shared: CommerceHostTestFixture;
let separate: CommerceHostTestFixture;
type PhysicalParticipant = AtomicCommerceParticipantInput & { readonly profile: CommerceProfile; readonly installation: InstallationBindingReference };
let input: Omit<AtomicCommerceHostInput<unknown>, "participants"> & { participants: readonly PhysicalParticipant[] };
function required<A>(value: A | undefined): A {
  if (value === undefined) throw new Error("Missing neutral atomic fixture value");
  return value;
}
const writeAll = Effect.fn(function* (ctx: AtomicCommerceContext, id: string) {
  for (const member of definitions) yield* ctx.call(member.participant, member.write, id);
  return yield* ctx.call(required(definitions[0]).participant, required(definitions[0]).read, null);
});
const root = defineAtomicCommerceCommand("writeAll", (ctx, id) => typeof id === "string" ? writeAll(ctx, id) : ctx.refuse(commerceError("invalidInput")));
const inventory = async () => ({ shared: await commerceInventory(shared), separate: await commerceInventory(separate) });

beforeAll(async () => {
  const registerCleanup = (close: () => Promise<void>) => cleanup.push(close);
  const resource = driver === "pglite" ? await createRelationalPGliteFixture({ registerCleanup }) : await (async () => {
    const database = await createFileScopedPostgresFixture(); registerCleanup(database.dispose);
    return { persistence: database.persistence, session: makePostgresRelationalSession(database.persistence) };
  })();
  const control = driver === "pglite" ? await createMigratedPGlitePersistence(registerCleanup) : resource.persistence;
  shared = await commerceHostFixture(resource.persistence, resource.session, prepareNeutralCommerceProfile(names.slice(0, 3)), commands, control, () => events);
  separate = await commerceHostFixture(resource.persistence, resource.session, prepareNeutralCommerceProfile(["delta"], "separate-profile"), commands, control, () => events, {}, shared);
  const profiles = await Promise.all(names.slice(0, 3).map(name => runEffect(registerLocalCommerceProfile(shared.descriptor.artifact,
    shared.descriptor.layout, `test.${name}`, [{ tableId: name, keyId: `${name}.primary` }]))));
  const bindings = await runEffect(makeDataBindingHost({ ...separate.bindingsInput, commerceProfiles: [...profiles, separate.prepared.profile] }));
  const binding = await runEffect(makeCommerceBinding(shared.availability, profiles));
  const frame = { ...separate.candidate.frame, commerce: commerceBindings(separate.candidate.frame).map(value =>
    value.installation.installationSha256 === shared.installation.installation.installationSha256 ? binding : value) };
  const candidate = await runEffect(bindings.prepare(frame));
  const current = await runEffect(separate.bindings.withCurrent(readAdmittedDataBinding));
  await runEffect(bindings.activate(dataBindingActivationRequest(frame.application.scopeId, frame.application.storageGeneration, "shared-atomic", candidate.sha256, current.head)));
  input = { ...shared.hostInput, commands: [root], participants: definitions.map((value, index) => ({
    participant: value.participant, profile: index === 3 ? separate.prepared.profile : required(profiles[index]),
    installation: index === 3 ? separate.installation : shared.installation, commands, validate: events.validate,
  })) };
}, 120000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120000);

describe("atomic participants sharing physical installation", () => {
  it("refuses foreign workflow reflection on genuinely exhausted and closed atomic roots", async () => {
    const inspect = vi.fn();
    const getter = vi.fn(() => "unsafe");
    const foreign = new Proxy(Object.defineProperty({}, "value", { get: getter, enumerable: true }), {
      getPrototypeOf: target => { inspect(); return Reflect.getPrototypeOf(target); },
      ownKeys: target => { inspect(); return Reflect.ownKeys(target); },
      getOwnPropertyDescriptor: (target, key) => { inspect(); return Reflect.getOwnPropertyDescriptor(target, key); },
    });
    const budget = defineAtomicCommerceCommand("workflowCaptureBudget", Effect.fn(function* (ctx) {
      yield* ctx.checkpoint;
      yield* ctx.checkpoint;
      const exhausted = yield* Effect.exit(captureWorkflowValue(ctx, foreign));
      expect(Exit.isFailure(exhausted)).toBe(true);
      if (Exit.isFailure(exhausted)) {
        expect(exhausted.cause.reasons.find(Cause.isFailReason)?.error).toMatchObject({ reason: "limitExceeded" });
      }
      const sticky = yield* Effect.exit(captureWorkflowValue(ctx, foreign));
      if (Exit.isSuccess(sticky)) throw new Error("Expected sticky root refusal");
      expect(sticky.cause.reasons.find(Cause.isFailReason)?.error).toMatchObject({ reason: "rollbackOnly" });
      return null;
    }));
    const budgetHost = await runEffect(makeAtomicCommerceHost({ ...input, commands: [budget], requestCallLimit: 3 }));
    const before = await inventory();
    try {
      const result = await runEffect(Effect.exit(budgetHost.run(budgetHost.newRequestKey(), budget, null)));
      if (Exit.isSuccess(result)) throw new Error("Expected failed exhausted root");
      expect(result.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "limitExceeded")).toBe(true);
      expect(await inventory()).toEqual(before);
    } finally { await runEffect(budgetHost.close); }
    let escaped: AtomicCommerceContext | undefined;
    const borrow = defineAtomicCommerceCommand("workflowCaptureClosure", ctx => { escaped = ctx; return Effect.succeed(null); });
    const host = await runEffect(makeAtomicCommerceHost({ ...input, commands: [borrow] }));
    try {
      await runEffect(host.run(host.newRequestKey(), borrow, null));
      expect(await runEffectFailure(captureWorkflowValue(required(escaped), foreign))).toMatchObject({ reason: "invalidAuthority" });
    } finally { await runEffect(host.close); }
    expect(inspect).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });

  it("keeps the original full Cause after a refused normalization is caught", async () => {
    const defect = new Error("normalization defect witness");
    const inspect = vi.fn();
    const foreign = new Proxy({}, { ownKeys: () => { inspect(); return []; } });
    const command = defineAtomicCommerceCommand("workflowCaptureRefusedCause", Effect.fn(function* (ctx) {
      const refused = yield* Effect.exit(ctx.capture(null, () => { throw defect; }));
      if (Exit.isSuccess(refused)) throw new Error("Expected decoder defect");
      expect(refused.cause.reasons.find(Cause.isDieReason)?.defect).toBe(defect);
      const sticky = yield* Effect.exit(captureWorkflowValue(ctx, foreign));
      if (Exit.isSuccess(sticky)) throw new Error("Expected sticky decoder refusal");
      expect(sticky.cause.reasons.find(Cause.isFailReason)?.error).toMatchObject({ reason: "rollbackOnly", cause: refused.cause });
      return null;
    }));
    const host = await runEffect(makeAtomicCommerceHost({ ...input, commands: [command] }));
    try {
      const exit = await runEffect(Effect.exit(host.run(host.newRequestKey(), command, null)));
      if (Exit.isSuccess(exit)) throw new Error("Expected original decoder failure");
      expect(exit.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true);
      expect(inspect).not.toHaveBeenCalled();
    } finally { await runEffect(host.close); }
  });
  it("retains ordinary JSON arguments, results and policy without Application marker interpretation", async () => {
    const echo = defineAtomicCommerceCommand("echoJson", (_ctx, value) => Effect.succeed(value));
    const host = await runEffect(makeAtomicCommerceHost({ ...input, commands: [echo], identityAndAccessPolicy: { "$policy": { "မြန်မာ": true } } }));
    for (const value of [null, "scalar", [0, false], { "$ne": "x", "မြန်မာ": { "$integer": "1" }, zero: -0 }]) {
      const key = host.newRequestKey();
      const fresh = await runEffect(host.run(key, echo, value));
      expect(fresh).toEqual(JSON.parse(JSON.stringify(value)));
      expect(await runEffect(host.run(key, echo, value))).toEqual(fresh);
      expect(await runEffectFailure(host.run(key, echo, [value]))).toMatchObject({ reason: "requestConflict" });
    }
  });
  it("prepares and accepts each physical installation once, preserving every logical contribution and replay identity", async () => {
    const prepare = vi.spyOn(installationRuntime, "prepareInstallationRuntime");
    const accept = vi.spyOn(installationRuntime, "acceptPreparedInstallation");
    try {
      const host = await runEffect(makeAtomicCommerceHost({ ...input, participants: [...input.participants].reverse() }));
      expect(prepare).toHaveBeenCalledTimes(2);
      const order = prepare.mock.calls.map(call => call[2].installation.installationSha256);
      expect(order).toEqual([...order].sort());
      const key = host.newRequestKey();
      const before = await inventory();
      const value = await runEffect(host.run(key, root, "shared-success"));
      expect(value).toEqual([{ id: "shared-success", value: 1 }]);
      expect(accept).toHaveBeenCalledTimes(2);
      expect(accept.mock.calls.map(call => call[2].installation.installationSha256)).toEqual(order);
      const after = await inventory();
      const facts = after.shared.facts.slice(before.shared.facts.length);
      expect(after.shared.commits.length - before.shared.commits.length).toBe(1);
      expect(facts).toHaveLength(4);
      expect(facts.map(fact => fact.tableId).sort()).toEqual([...names].sort());
      expect(new Set(facts.map(fact => fact.changeOrdinal)).size).toBe(4);
      expect(new Set(facts.map(fact => fact.installationSha256)).size).toBe(2);
      for (const name of names) expect((name === "delta" ? after.separate : after.shared).tables[name]).toEqual([expect.objectContaining({ id: "shared-success", value: 1 })]);
      const permuted = await runEffect(makeAtomicCommerceHost(input));
      expect(await runEffect(permuted.run(key, root, "shared-success"))).toEqual(value);
      expect(await inventory()).toEqual(after);
      expect(await runEffectFailure(permuted.run(key, root, "different"))).toMatchObject({ reason: "requestConflict" });
      const changed = await runEffect(makeAtomicCommerceHost({ ...input, participants: input.participants.map((member, index) =>
        index === 0 ? { ...member, commands: [required(definitions[0]).write] } : member) }));
      expect(await runEffectFailure(changed.run(key, root, "shared-success"))).toMatchObject({ reason: "requestConflict" });
    } finally { prepare.mockRestore(); accept.mockRestore(); }
  });

  it("rejects duplicate names, table overlap, conflicting pins and forged tokens before physical preparation", async () => {
    const first = required(input.participants[0]);
    const second = required(input.participants[1]);
    const prepare = vi.spyOn(installationRuntime, "prepareInstallationRuntime");
    try {
      for (const participants of [
        [first, first],
        [first, { ...first, participant: second.participant }],
        [first, { ...second, installation: { ...second.installation, availabilitySequence: "999" } }],
        // SAFETY: the negative test supplies a forged participant token.
        [{ ...first, participant: {} as typeof first.participant }],
      ]) expect(await runEffectFailure(prepareAtomicCommerceParticipants(input.database, input.target,
        Result.getOrThrow(captureAtomicCommerceParticipants(participants)), undefined, { kind: "standalone" }))).toMatchObject({ reason: "invalidAuthority" });
      expect(prepare).not.toHaveBeenCalled();
    } finally { prepare.mockRestore(); }
  });

  it("keeps table authority confined and caught failures sticky across every participant", async () => {
    const first = required(definitions[0]); const second = required(definitions[1]);
    const refused = defineAtomicCommerceCommand("caughtCrossProfile", Effect.fn(function* (ctx) {
      yield* writeAll(ctx, "must-rollback");
      yield* ctx.call(first.participant, second.read, null).pipe(Effect.catch(error => {
        expect(error.reason).toBe("invalidAuthority"); return Effect.succeed(null);
      }));
      return null;
    }));
    const before = await inventory();
    const host = await runEffect(makeAtomicCommerceHost({ ...input, commands: [refused] }));
    expect(await runEffectFailure(host.run(host.newRequestKey(), refused, null))).toMatchObject({ reason: "rollbackOnly" });
    expect(await inventory()).toEqual(before);
  });

  it("shares root budgets even with unused members and revokes borrowed command contexts", async () => {
    let escaped = Option.none<CommerceCommandContext>();
    const first = required(definitions[0]);
    const borrow = defineCommerceCommand("borrowShared", "read", ctx => { escaped = Option.some(ctx); return Effect.succeed(null); });
    const borrowed = defineAtomicCommerceCommand("borrowSharedRoot", ctx => ctx.call(first.participant, borrow, null));
    const members = input.participants.map(member => ({ ...member, commands: [...member.commands, borrow] }));
    const host = await runEffect(makeAtomicCommerceHost({ ...input, participants: members, commands: [borrowed] }));
    await runEffect(host.run(host.newRequestKey(), borrowed, null));
    expect(await runEffectFailure(Option.getOrThrow(escaped).table("alpha"))).toBeDefined();
    const before = await inventory();
    const exhausted = await runEffect(makeAtomicCommerceHost({ ...input, requestCallLimit: 3 }));
    expect(await runEffectFailure(exhausted.run(exhausted.newRequestKey(), root, "budget-rollback"))).toMatchObject({ reason: "limitExceeded" });
    expect(await inventory()).toEqual(before);
  });

  it("does not grant a longer transaction deadline to physical participants", async () => {
    expect(await runEffectFailure(makeAtomicCommerceHost({ ...input, requestCommandMs: 30_000 })))
      .toMatchObject({ reason: "unsupportedProfile" });
    expect(await runEffectFailure(makeAtomicCommerceHost({ ...input, requestCommandMs: 30_001 })))
      .toMatchObject({ reason: "unsupportedProfile" });
  });

  it("rejects a physical-only fan-out above the shared fact allowance atomically", async () => {
    const bulk = definitions.map(member => defineCommerceCommand(`bulk-${member.name}`, "write", Effect.fn(function* (ctx) {
      const table = yield* ctx.table(member.name);
      return yield* table.write(ctx.manager, "insert", Array.from({ length: 65 }, (_, index) => ({
        id: `over-facts-${member.name}-${index}`, value: 1,
      })));
    })));
    const overFacts = defineAtomicCommerceCommand("overPhysicalFacts", Effect.fn(function* (ctx) {
      for (const [index, member] of definitions.entries())
        yield* ctx.call(member.participant, required(bulk[index]), null);
      return null;
    }));
    const participants = input.participants.map((member, index) => ({
      ...member, commands: [...member.commands, required(bulk[index])],
    }));
    const host = await runEffect(makeAtomicCommerceHost({ ...input, participants, commands: [overFacts] }));
    const before = await inventory();
    expect(await runEffectFailure(host.run(host.newRequestKey(), overFacts, null)))
      .toMatchObject({ reason: "limitExceeded" });
    expect(await inventory()).toEqual(before);
  });

  it("rolls back interruption and serializes concurrent same-key requests", async () => {
    const written = Deferred.makeUnsafe<void>();
    const waiting = defineAtomicCommerceCommand("waitShared", Effect.fn(function* (ctx) {
      yield* writeAll(ctx, "cancel-rollback"); yield* Deferred.succeed(written, undefined); return yield* Effect.never;
    }));
    const host = await runEffect(makeAtomicCommerceHost({ ...input, commands: [waiting, root] }));
    const before = await inventory();
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const fiber = yield* Effect.forkScoped(host.run(host.newRequestKey(), waiting, null));
      yield* Deferred.await(written).pipe(Effect.timeout(5000));
      yield* Fiber.interrupt(fiber);
      expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true);
    })));
    expect(await inventory()).toEqual(before);
    const key = host.newRequestKey();
    const values = await Promise.all([runEffect(host.run(key, root, "concurrent")), runEffect(host.run(key, root, "concurrent"))]);
    expect(values[0]).toEqual(values[1]);
    expect((await inventory()).shared.commits.length - before.shared.commits.length).toBe(1);
  });

  it("recovers uncertain settlement without repeating any shared participant write", async () => {
    let lose = true; let executions = 0;
    const session = issueRelationalSession(shared.persistence.drizzle, (profile, work) => runRelationalSession(shared.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => {
        if (!lose) return Effect.succeed(value);
        lose = false; return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost shared installation COMMIT acknowledgement") }));
      })));
    const counted = defineAtomicCommerceCommand("recoverShared", Effect.fn(function* (ctx) { executions++; return yield* writeAll(ctx, "recovered"); }));
    const host = await runEffect(makeAtomicCommerceHost({ ...input, session, commands: [counted] }));
    const before = await inventory(); const key = host.newRequestKey();
    const value = await runEffect(host.run(key, counted, null));
    expect(await runEffect(host.run(key, counted, null))).toEqual(value);
    expect(executions).toBe(1);
    const after = await inventory();
    expect(after.shared.commits.length - before.shared.commits.length).toBe(1);
    expect(after.shared.facts.length - before.shared.facts.length).toBe(4);
  });

  it("rejects stale physical evidence for the whole group without refreshing a prepared host", async () => {
    const host = await runEffect(makeAtomicCommerceHost(input));
    const db = shared.persistence.drizzle;
    const id = shared.availability.installation.storageId;
    const row = required((await db.select().from(availabilityHeads).where(eq(availabilityHeads.installationStorageId, id)))[0]);
    const before = await inventory();
    await db.update(availabilityHeads).set({ availabilityHeadSha256: new Uint8Array(32) }).where(eq(availabilityHeads.installationStorageId, id));
    try {
      expect(await runEffectFailure(host.run(host.newRequestKey(), root, "stale-installation"))).toMatchObject({ reason: "invalidAuthority" });
      expect(await inventory()).toEqual(before);
    } finally {
      await db.update(availabilityHeads).set({ availabilityHeadSha256: row.availabilityHeadSha256 }).where(eq(availabilityHeads.installationStorageId, id));
    }
  });

  it("rechecks each profile membership, including unused members, after binding revocation", async () => {
    const profiles = input.participants.map(member => member.profile);
    const bindings = await runEffect(makeDataBindingHost({ ...separate.bindingsInput, commerceProfiles: profiles }));
    const current = await runEffect(bindings.withCurrent(readAdmittedDataBinding));
    const sharedBinding = await runEffect(makeCommerceBinding(shared.availability, profiles.slice(0, 3)));
    const separateBinding = await runEffect(makeCommerceBinding(separate.availability, [required(profiles[3])]));
    const frame = { ...separate.candidate.frame, commerce: [sharedBinding, separateBinding].sort((a, b) =>
      a.installation.installationSha256 < b.installation.installationSha256 ? -1 : 1) };
    const empty = defineAtomicCommerceCommand("unusedSharedProfiles", () => Effect.succeed(null));
    const host = await runEffect(makeAtomicCommerceHost({ ...input, commands: [empty] }));
    try {
      const reduced = await runEffect(makeCommerceBinding(shared.availability, [required(profiles[0]), required(profiles[2])]));
      const candidate = await runEffect(bindings.prepare({ ...frame, commerce: frame.commerce.map(binding => binding === sharedBinding ? reduced : binding) }));
      await runEffect(bindings.activate(dataBindingActivationRequest(frame.application.scopeId, frame.application.storageGeneration, "revoke-shared-beta", candidate.sha256, current.head)));
      try {
        const before = await inventory();
        expect(await runEffectFailure(host.run(host.newRequestKey(), empty, null))).toMatchObject({ reason: "unsupportedProfile" });
        expect(await inventory()).toEqual(before);
      } finally {
        const selected = await runEffect(bindings.withCurrent(readAdmittedDataBinding));
        const application = await runEffect(bindings.readApplicationReference());
        const restoredFrame = { ...frame, application,
          payloadContent: frame.payloadContent === null ? null : { ...frame.payloadContent, application } };
        const restored = await runEffect(bindings.prepare(restoredFrame));
        await runEffect(bindings.activate(dataBindingActivationRequest(application.scopeId, application.storageGeneration,
          "restore-shared-beta", restored.sha256, selected.head)));
      }
      expect(await runEffect(host.run(host.newRequestKey(), empty, null))).toBeNull();
    } finally { await runEffect(host.close); }
  });

  it("validates another physical installation's facts before projecting the selected one", async () => {
    const host = await runEffect(makeAtomicCommerceHost(input));
    try {
      await runEffect(host.run(host.newRequestKey(), root, "cross-installation-facts"));
      const commit = (await commerceInventory(shared)).commits.at(-1);
      if (commit === undefined) throw new Error("Missing neutral atomic commit");
      const query = { scopeUuid: commit.scopeUuid, commitSeq: commit.commitSeq,
        installations: [shared, separate].map(fixture => ({
          installationSha256: fixture.installation.installation.installationSha256,
          layout: fixture.descriptor.layout,
        })),
        selectInstallationSha256: shared.installation.installation.installationSha256 };
      const db = shared.persistence.drizzle;
      const selected = await db.transaction(tx => runEffect(readRelationalCommitFactsInTransaction(tx, query)));
      expect(selected).toHaveLength(3);
      await assertAtomicProjectionRejectsOtherParticipantCorruption(db, query,
        separate.installation.installation.installationSha256);
      expect(await db.transaction(tx => runEffect(readRelationalCommitFactsInTransaction(tx, query))))
        .toEqual(selected);
      const profiles = input.participants.map(member => member.profile);
      const bindings = await runEffect(makeDataBindingHost({ ...separate.bindingsInput, commerceProfiles: profiles }));
      const current = await runEffect(bindings.withCurrent(readAdmittedDataBinding));
      const withoutShared = await runEffect(bindings.prepare({ ...current.frame,
        commerce: commerceBindings(current.frame).filter(binding =>
          binding.installation.installationSha256 !== shared.installation.installation.installationSha256) }));
      await runEffect(bindings.activate(dataBindingActivationRequest(current.frame.application.scopeId,
        current.frame.application.storageGeneration, "remove-shared-fact-binding", withoutShared.sha256, current.head)));
      try {
        expect(await runEffectFailure(host.run(host.newRequestKey(), root, "removed-binding")))
          .toMatchObject({ reason: "bindingChanged" });
        expect(await db.transaction(tx => runEffect(readRelationalCommitFactsInTransaction(tx, query))))
          .toEqual(selected);
      } finally {
        const absent = await runEffect(bindings.withCurrent(readAdmittedDataBinding));
        const application = await runEffect(bindings.readApplicationReference());
        const restoredFrame = { ...current.frame, application,
          payloadContent: current.frame.payloadContent === null ? null : { ...current.frame.payloadContent, application } };
        const restored = await runEffect(bindings.prepare(restoredFrame));
        await runEffect(bindings.activate(dataBindingActivationRequest(application.scopeId,
          application.storageGeneration, "restore-shared-fact-binding", restored.sha256, absent.head)));
      }
      expect(await db.transaction(tx => runEffect(readRelationalCommitFactsInTransaction(tx, query))))
        .toEqual(selected);
    } finally { await runEffect(host.close); }
  }, 30_000);
});
