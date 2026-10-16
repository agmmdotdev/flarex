import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { makeLocalNotificationCommands, type LocalNotificationPhaseExecutor } from "../src/modules/notification/service";
import { isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { notificationLogger } from "./support/notification-logger";
const input = { to: "", channel: "feed", template: "admin-ui", data: { title: "Products imported" } };
const provider = { id: "local", handle: "local", name: "local", is_enabled: true, channels: ["feed"],
  created_at: "2026-10-16T00:00:00.000Z", updated_at: "2026-10-16T00:00:00.000Z", deleted_at: null };
const row = { ...input, id: "noti_phase", from: null, provider_data: null, trigger_type: null,
  resource_id: null, resource_type: null, receiver_id: null, original_notification_id: null,
  idempotency_key: null, external_id: null, status: "pending", provider_id: "local",
  created_at: "2026-10-16T00:00:00.000Z", updated_at: "2026-10-16T00:00:00.000Z", deleted_at: null };
const message = (action: "created" | "updated") => ({ name: `notification.notification.${action}`,
  metadata: { source: "notification", object: "notification", action }, data: { id: row.id } });
const deliver: LocalNotificationPhaseExecutor["deliver"] = (_input, send) => send();

describe("actual native Notification service over separately settled phase ports", () => {
  it("retains native scalar, singleton array, empty cardinality and real outer EmitEvents", async () => {
    const logger = notificationLogger();
    const runtime = await Effect.runPromise(makeLocalNotificationCommands(logger));
    let phaseOpen = false;
    vi.mocked(logger.info).mockImplementation(() => { expect(phaseOpen).toBe(false); });
    const prepare = vi.fn(async () => {
      phaseOpen = true;
      try { return { prepared: { notificationsToProcess: [{ provider, data: { ...input, id: row.id, provider_id: "local" } }],
        createdNotifications: [row] }, messages: [message("created")] }; }
      finally { phaseOpen = false; }
    });
    const finalize = vi.fn(async (updates: unknown) => {
      expect(updates).toEqual([{ ...input, id: row.id, provider_id: "local", status: "success" }]);
      return { rows: [{ ...row, status: "success" }], messages: [message("updated")] };
    });
    const emit = vi.fn(async () => undefined);
    const native = runtime.createService({ prepare, finalize, deliver, emit });
    expect(await native.createNotifications(input)).toEqual({ ...row, status: "success" });
    expect(emit).toHaveBeenLastCalledWith([message("created"), message("updated")], { internal: true });
    expect(await native.createNotifications([input])).toEqual([{ ...row, status: "success" }]);
    const calls = { prepare: prepare.mock.calls.length, finalize: finalize.mock.calls.length, emit: emit.mock.calls.length };
    expect(await native.createNotifications([])).toEqual([]);
    expect(prepare).toHaveBeenCalledTimes(calls.prepare);
    expect(finalize).toHaveBeenCalledTimes(calls.finalize);
    expect(emit).toHaveBeenCalledTimes(calls.emit);
    expect(logger.info).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, { ...provider, is_enabled: false }])("persists native provider-absence/disabled failure and skips the outer emit gate: %s", async selected => {
    const logger = notificationLogger();
    const runtime = await Effect.runPromise(makeLocalNotificationCommands(logger));
    const providerId = selected?.id;
    const finalize = vi.fn(async (updates: unknown) => {
      expect(updates).toEqual([{ ...input, id: row.id, ...(providerId === undefined ? {} : { provider_id: providerId }), status: "failure" }]);
      return { rows: [{ ...row, provider_id: providerId ?? null, status: "failure" }], messages: [message("updated")] };
    });
    const emit = vi.fn(async () => undefined);
    const native = runtime.createService({ prepare: async () => ({ prepared: {
      notificationsToProcess: [{ ...(selected === undefined ? {} : { provider: selected }),
        data: { ...input, id: row.id, ...(providerId === undefined ? {} : { provider_id: providerId }) } }],
      createdNotifications: [{ ...row, provider_id: providerId ?? null }] }, messages: [message("created")] }), finalize, deliver, emit });
    await expect(native.createNotifications(input)).rejects.toThrow();
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("rejects input getters and supplied identities before any phase", async () => {
    const runtime = await Effect.runPromise(makeLocalNotificationCommands(notificationLogger()));
    const prepare = vi.fn(), finalize = vi.fn(), emit = vi.fn();
    const native = runtime.createService({ prepare, finalize, deliver, emit });
    const getter = vi.fn(() => "feed");
    const forged = Object.defineProperty({ ...input }, "channel", { enumerable: true, get: getter });
    for (const invalid of [forged, { ...input, idempotency_key: "key" }, { ...input, provider_id: "foreign" }])
      await expect(native.createNotifications(invalid)).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  });

  it("refuses a foreign provider or a mismatched persisted preparation before provider delivery", async () => {
    const logger = notificationLogger();
    const runtime = await Effect.runPromise(makeLocalNotificationCommands(logger));
    for (const prepared of [
      { notificationsToProcess: [{ provider: { ...provider, id: "foreign" }, data: { ...input, id: row.id, provider_id: "local" } }], createdNotifications: [row] },
      { notificationsToProcess: [{ provider, data: { ...input, id: row.id, provider_id: "local" } }], createdNotifications: [{ ...row, to: "different" }] },
    ]) {
      const finalize = vi.fn(), emit = vi.fn();
      const native = runtime.createService({ prepare: async () => ({ prepared, messages: [message("created")] }), finalize, deliver, emit });
      await expect(native.createNotifications(input)).rejects.toThrow();
      expect(finalize).not.toHaveBeenCalled(); expect(emit).not.toHaveBeenCalled();
    }
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("keeps the native finalization failure ahead of a local provider failure", async () => {
    const logger = notificationLogger();
    vi.mocked(logger.info).mockImplementation(() => { throw new Error("provider rejected"); });
    const runtime = await Effect.runPromise(makeLocalNotificationCommands(logger));
    const failure = new Error("finalization rejected");
    const finalize = vi.fn(async (updates: unknown) => {
      expect(Array.isArray(updates) && isJsonObject(updates[0]) && updates[0].status).toBe("failure");
      throw failure;
    });
    const emit = vi.fn(async () => undefined);
    const native = runtime.createService({ prepare: async () => ({ prepared: {
      notificationsToProcess: [{ provider, data: { ...input, id: row.id, provider_id: "local" } }],
      createdNotifications: [row] }, messages: [message("created")] }), finalize, deliver, emit });
    await expect(native.createNotifications(input)).rejects.toBe(failure);
    expect(emit).not.toHaveBeenCalled();
  });
});
