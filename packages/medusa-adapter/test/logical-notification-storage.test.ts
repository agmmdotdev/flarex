import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { logicalNotificationFixture } from "./support/logical-notification-fixture";
import { notificationLogger } from "./support/notification-logger";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Notification test driver");
const cleanup: (() => Promise<void>)[] = [];
const logger = notificationLogger();
let fixture: Awaited<ReturnType<typeof logicalNotificationFixture>>;
const input = { to: "", channel: "feed", template: "admin-ui", data: { title: "Products imported" } };

async function phaseHost() {
  const participant = defineAtomicCommerceParticipant("notification");
  const prepare = defineAtomicCommerceCommand("notificationPrepareRoot", (ctx, value) => ctx.call(participant, fixture.runtime.prepare, value));
  const finalize = defineAtomicCommerceCommand("notificationFinalizeRoot", (ctx, value) => ctx.call(participant, fixture.runtime.finalize, value));
  const register = defineAtomicCommerceCommand("notificationRegisterRoot", (ctx, value) => ctx.call(participant, fixture.runtime.registerLocalProvider, value));
  const policy = fixture.runtime.logicalEventPolicy();
  const revision = "1".repeat(64);
  const declared = ["created", "updated"].map(action => ({ name: `notification.notification.${action}`,
    token: defineCommerceEventContract({ name: `notification.notification.${action}`, revision, internal: true, decode: policy.capture }) }));
  const contracts = declared.map(contract => contract.token);
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.fixture.hostInput,
    identityAndAccessPolicy: { profile: "native-notification-phases" },
    participants: [{ participant, logicalStorage: fixture.hostInput.logicalStorage, commands: fixture.runtime.commands,
      validateLogicalCall: policy.validateLogicalCall, events: { contracts, select: (message: Json) => {
        const found = declared.find(contract => isJsonObject(message) && contract.name === message.name);
        return found === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(found.token);
      } } }], commands: [prepare, finalize, register],
    events: { producerRevision: revision, contracts, subscribers: [{ id: "notification-phase-witness", revision }],
      validate: messages => messages.some(message => !message.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  return { host, prepare, finalize, register };
}

describe("native Notification phases over admitted logical storage", () => {
  beforeAll(async () => { fixture = await logicalNotificationFixture(driver, close => cleanup.push(close), logger); }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("commits missing-provider failure, then real local delivery outside SQL and fresh finalization with exact native intents", async () => {
    const { host, prepare, finalize, register } = await phaseHost();
    let activePhase = 0;
    const finalized: unknown[] = [];
    const emit = vi.fn(async () => undefined);
    const native = fixture.runtime.createService({
      prepare: async value => {
        activePhase++;
        try { return await Effect.runPromise(host.run(host.newRequestKey(), prepare, value)); }
        finally { activePhase--; }
      },
      finalize: async value => {
        activePhase++;
        try { const packet = await Effect.runPromise(host.run(host.newRequestKey(), finalize, value)); finalized.push(packet); return packet; }
        finally { activePhase--; }
      }, deliver: (_input, send) => send(), emit,
    });
    vi.mocked(logger.info).mockImplementation(() => { expect(activePhase).toBe(0); });
    try {
      await expect(native.createNotifications(input)).rejects.toThrow(/Could not find a notification provider/);
      expect(Result.getOrThrow(fixture.runtime.decodeFinalizedPacket(finalized[0])).rows[0])
        .toMatchObject({ status: "failure", provider_id: null });
      expect(emit).not.toHaveBeenCalled(); expect(logger.info).not.toHaveBeenCalled();
      await Effect.runPromise(host.run(host.newRequestKey(), register,
        { id: "local", handle: "local", name: "local", is_enabled: true, channels: ["feed"] }));
      const before = await fixture.fixture.persistence.drizzle.select().from(fxSystemCommitEvents);
      const result = await native.createNotifications(input);
      expect(result).toMatchObject({ ...input, status: "success", provider_id: "local", external_id: null });
      expect(Array.isArray(result)).toBe(false);
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledTimes(1);
      const after = await fixture.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
        .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
      expect(after.slice(before.length).map(row => row.envelope.contract)).toEqual([
        "notification.notification.created", "notification.notification.updated",
      ]);
      expect(new Set(after.slice(before.length).map(row => row.commitSeq)).size).toBe(2);
      expect(await native.createNotifications([input])).toMatchObject([{ status: "success" }]);
      expect(await native.createNotifications([])).toEqual([]);
      vi.mocked(logger.info).mockImplementation(() => { expect(activePhase).toBe(0); throw new Error("local provider rejected"); });
      await expect(native.createNotifications(input)).rejects.toThrow();
      expect(Result.getOrThrow(fixture.runtime.decodeFinalizedPacket(finalized.at(-1))).rows[0]).toMatchObject({ status: "failure", provider_id: "local" });
      expect(emit).toHaveBeenCalledTimes(2);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);
});
