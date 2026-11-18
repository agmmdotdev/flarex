import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { DAL, Logger, ModulePersistenceAdapter } from "@medusajs/types";
import { Notification } from "@medusajs/notification/models";
import { NotificationModuleService, NotificationProviderService } from "@medusajs/notification/services";
import { LocalNotificationService } from "@medusajs/notification-local/services";
import { MedusaInternalService } from "@medusajs/utils/modules-sdk/medusa-internal-service";
import { Module } from "@medusajs/utils/modules-sdk/module";
import { NotificationStatus } from "@medusajs/utils/notification/common";
import { MessageAggregator } from "@medusajs/utils/event-bus/message-aggregator";
import { createDrizzleEventSubscriber, registerDrizzleEventSubscriber, dispatchCreatedMutations,
  dispatchDrizzleMutationRows } from "@medusajs/drizzle/mutation-events";
import { createNotificationsWithDelivery, deliverPreparedNotifications, prepareNotificationDelivery,
  type NotificationDeliveryData, type NotificationDeliveryProvider, type NotificationDeliveryUpdate, type PreparedNotificationDelivery,
} from "@medusajs/notification/delivery";

const message = { to: "", channel: "feed", template: "admin-ui", data: { title: "Products imported" } };
const provider = { id: "local", handle: "local", name: "local", channels: ["feed"], is_enabled: true };
const row = (id: string) => ({ id, status: NotificationStatus.PENDING });
const nativeRow = (id: string, status = NotificationStatus.PENDING): DAL.InferRepositoryReturnType<typeof Notification> => ({
  ...message, id, status, provider_id: "local", provider: { ...provider, notifications: [],
    created_at: new Date("2026-10-16T00:00:00Z"), updated_at: new Date("2026-10-16T00:00:00Z"), deleted_at: null },
  from: null, provider_data: null, trigger_type: null,
  resource_id: null, resource_type: null, receiver_id: null, original_notification_id: null,
  idempotency_key: null, external_id: null, created_at: new Date("2026-10-16T00:00:00Z"),
  updated_at: new Date("2026-10-16T00:00:00Z"), deleted_at: null,
});
const prepared = (providers: (NotificationDeliveryProvider | undefined)[] = [provider]) => ({
  notificationsToProcess: providers.map((current, index) => ({ provider: current,
    data: { ...message, id: `notification-${index}`, provider_id: current?.id },
  })), createdNotifications: providers.map((_, index) => row(`notification-${index}`)),
} satisfies PreparedNotificationDelivery<NotificationDeliveryProvider, ReturnType<typeof row>>);

function logger(): Logger {
  return { panic: vi.fn(), shouldLog: () => true, setLogLevel: vi.fn(), unsetLogLevel: vi.fn(),
    activity: () => "activity", progress: vi.fn(), error: vi.fn(), failure: vi.fn(), success: () => ({}),
    silly: vi.fn(), debug: vi.fn(), verbose: vi.fn(), http: vi.fn(), info: vi.fn(), warn: vi.fn(), log: vi.fn() };
}

/** Fixed DAL responses characterize the genuine service call closure. They do
 * not implement a database, selectors, lifecycle rules or business policy. */
function nativeService() {
  let openTransactions = 0;
  const context = { manager: {} };
  const unavailableManager = (): never => { throw new Error("Native witness must borrow its supplied manager"); };
  const serialization = vi.fn<(input: object | object[]) => void>();
  Module("notification", { service: NotificationModuleService });
  const persistence = { name: "notification-fixed-dal-witness", prepareModels: models => [...models],
    createConnectionLoader: vi.fn<ModulePersistenceAdapter["createConnectionLoader"]>(),
    createBaseRepository: vi.fn<ModulePersistenceAdapter["createBaseRepository"]>(),
    createRepository: vi.fn<ModulePersistenceAdapter["createRepository"]>(),
    createEventSubscriber: createDrizzleEventSubscriber, registerEventSubscriber: registerDrizzleEventSubscriber,
  } satisfies ModulePersistenceAdapter;
  const repository: DAL.RepositoryService = {
    getFreshManager: unavailableManager,
    getActiveManager: unavailableManager,
    transaction: vi.fn<DAL.RepositoryService["transaction"]>().mockImplementation(async work => {
      openTransactions++;
      try { return await work({}); } finally { openTransactions--; }
    }),
    serialize: async <Output extends object | object[]>(input: Output) => { serialization(input); return input; },
    find: vi.fn<DAL.RepositoryService["find"]>().mockResolvedValue([]),
    findAndCount: vi.fn<DAL.RepositoryService["findAndCount"]>(), create: vi.fn<DAL.RepositoryService["create"]>(),
    update: vi.fn<DAL.RepositoryService["update"]>(), delete: vi.fn<DAL.RepositoryService["delete"]>(),
    softDelete: vi.fn<DAL.RepositoryService["softDelete"]>(), restore: vi.fn<DAL.RepositoryService["restore"]>(),
    upsert: vi.fn<DAL.RepositoryService["upsert"]>(), upsertWithReplace: vi.fn<DAL.RepositoryService["upsertWithReplace"]>(),
  };
  const Service = MedusaInternalService(Notification);
  const internal = new Service<object, typeof Notification>({ notificationRepository: repository, modulePersistenceAdapter: persistence });
  const providerRepository = { ...repository, find: vi.fn<DAL.RepositoryService["find"]>().mockResolvedValue([provider]) };
  const log = logger();
  const local = new LocalNotificationService({ logger: log }, { channels: ["feed"] });
  const delivery = vi.spyOn(local, "send").mockImplementation(async input => {
    expect(openTransactions).toBe(0);
    return await LocalNotificationService.prototype.send.call(local, input);
  });
  const providers = new NotificationProviderService({ notificationProviderRepository: providerRepository, np_local: local, logger: log });
  const emit = vi.fn(async () => undefined);
  const container = { baseRepository: repository, notificationService: internal,
    notificationProviderService: providers, modulePersistenceAdapter: persistence, event_bus: { emit } };
  const service = new NotificationModuleService(container, { scope: "internal" });
  return { service, repository, internal, providerRepository, providers, local, delivery, log, context, serialization,
    emit, openTransactions: () => openTransactions };
}

describe("native Notification prepare, provider and final-update closure", () => {
  it("retains the empty guard without preparing, delivering or finalizing", async () => {
    const prepare = vi.fn(), send = vi.fn(), updateNotifications = vi.fn();
    expect(await createNotificationsWithDelivery([], { prepare, send, updateNotifications })).toEqual([]);
    expect(prepare).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled(); expect(updateNotifications).not.toHaveBeenCalled();
  });

  it("prepares in one transaction and delivers only after it has ended", async () => {
    let transactionOpen = false;
    const manager = {}, trace: string[] = [];
    let created: NotificationDeliveryData[] = [];
    const result = await createNotificationsWithDelivery([message], {
      prepare: input => prepareNotificationDelivery(input, {
        transaction: async work => { transactionOpen = true; trace.push("begin");
          try { return await work(manager); } finally { transactionOpen = false; trace.push("end"); } },
        listNotifications: async (filters, config, context) => {
          expect(filters).toEqual({ idempotency_key: [] }); expect(config).toEqual({});
          expect(context.transactionManager).toBe(manager); trace.push("list"); return [];
        },
        getProviderForChannels: async channels => { expect(channels).toEqual(["feed"]); trace.push("providers"); return [provider]; },
        createNotifications: async (data, context) => {
          expect(transactionOpen).toBe(true); expect(context.transactionManager).toBe(manager);
          created = data; trace.push("create"); return data;
        },
      }),
      send: async (current, input) => {
        expect(transactionOpen).toBe(false); expect(current).toBe(provider); expect(input).toBe(created[0]);
        trace.push("send"); return {};
      },
      updateNotifications: async data => {
        expect(transactionOpen).toBe(false); expect(data).toEqual([{ ...created[0], status: "success", external_id: undefined }]);
        trace.push("update"); return [{ ...created[0]!, status: NotificationStatus.SUCCESS }];
      },
    });
    expect(trace).toEqual(["begin", "list", "providers", "create", "end", "send", "update"]);
    expect(result).toEqual([{ ...created[0], status: "success", external_id: undefined }]);
    expect(created[0]?.id).toMatch(/^noti_/);
  });

  it("keeps created-input order after concurrent sends and reversed final rows", async () => {
    const current = prepared([provider, provider]);
    let releaseFirst: (() => void) | undefined;
    const first = new Promise<void>(resolve => { releaseFirst = resolve; });
    const completion: string[] = [];
    const result = await deliverPreparedNotifications(current, {
      send: async (_, input) => {
        if (input.id === "notification-0") await first;
        else releaseFirst?.();
        completion.push(input.id); return { id: `external-${input.id}` };
      },
      updateNotifications: async data => [...data].reverse().map(input => ({ id: input.id, status: NotificationStatus.SUCCESS })),
    });
    expect(completion).toEqual(["notification-1", "notification-0"]);
    expect(result.map(item => item.id)).toEqual(["notification-0", "notification-1"]);
  });

  it("exposes terminal status to a typed persistence projection while retaining native DTO identity and empty updates", async () => {
    expectTypeOf<NotificationDeliveryUpdate["status"]>().toEqualTypeOf<NotificationStatus | undefined>();
    for (const rejected of [false, true]) {
      const current = prepared();
      const projected: { id: string; status: NotificationStatus }[] = [];
      const delivery = deliverPreparedNotifications(current, {
        send: async () => { if (rejected) throw new Error("provider outcome unknown"); return { id: "external" }; },
        updateNotifications: async updates => {
          expect(updates).toHaveLength(1);
          expect(updates[0]).toBe(current.notificationsToProcess[0]?.data);
          expect(updates[0]).toMatchObject({ to: message.to, channel: message.channel, template: message.template });
          const rows = updates.map(update => {
            const status = update.status;
            if (status !== NotificationStatus.SUCCESS && status !== NotificationStatus.FAILURE)
              throw new Error("Native update lacks terminal status");
            return { id: update.id, status };
          });
          projected.push(...rows);
          return rows;
        },
      });
      if (rejected) await expect(delivery).rejects.toThrow("provider outcome unknown");
      else await expect(delivery).resolves.toEqual([{ id: "notification-0", status: "success" }]);
      expect(projected).toEqual([{ id: "notification-0", status: rejected ? "failure" : "success" }]);
    }
    const updateNotifications = vi.fn(async (updates: NotificationDeliveryUpdate[]) => updates.map(update => row(update.id)));
    expect(await deliverPreparedNotifications(prepared([]), { send: vi.fn(), updateNotifications })).toEqual([]);
    expect(updateNotifications).toHaveBeenCalledExactlyOnceWith([]);
  });

  it("finalizes every failure and aggregates native missing, disabled and rejected sends", async () => {
    const current = prepared([undefined, { ...provider, is_enabled: false }, provider]);
    const updateNotifications = vi.fn(async (data: NotificationDeliveryUpdate[]) => data.map(input => row(input.id)));
    await expect(deliverPreparedNotifications(current, { send: async () => { throw new Error("provider outcome unknown"); }, updateNotifications }))
      .rejects.toThrow(/Could not find a notification provider[\s\S]*not enabled[\s\S]*provider outcome unknown/);
    expect(updateNotifications).toHaveBeenCalledOnce();
    expect(updateNotifications.mock.calls[0]?.[0]).toEqual(current.notificationsToProcess.map(entry => expect.objectContaining({ id: entry.data.id, status: "failure" })));
  });

  it("lets a final-update failure supersede the native send failure", async () => {
    const finalError = new Error("final persistence failed");
    await expect(deliverPreparedNotifications(prepared(), {
      send: async () => { throw new Error("provider outcome unknown"); }, updateNotifications: async () => { throw finalError; },
    })).rejects.toBe(finalError);
  });

  it("retains native keyed-success suppression and keyed-failure generated-ID behavior without admission", async () => {
    for (const status of [NotificationStatus.SUCCESS, NotificationStatus.FAILURE]) {
      const createNotifications = vi.fn();
      const result = await prepareNotificationDelivery([{ ...message, idempotency_key: "native-key" }], {
        transaction: async work => work({}), listNotifications: async () => [{ id: "old", idempotency_key: "native-key", status }],
        getProviderForChannels: async () => [provider], createNotifications,
      });
      expect(createNotifications).not.toHaveBeenCalled(); expect(result.createdNotifications).toEqual([]);
      if (status === NotificationStatus.SUCCESS) expect(result.notificationsToProcess).toEqual([]);
      else expect(result.notificationsToProcess).toEqual([{ provider, data: { ...message, idempotency_key: "native-key", id: expect.stringMatching(/^noti_/), provider_id: "local" } }]);
    }
  });

  it("executes the promoted native class with a real local provider outside the preparation transaction", async () => {
    const fixture = nativeService();
    let pending: { id: string; status: NotificationStatus; provider_id: string; to: string; channel: string; template: string }[] = [];
    vi.mocked(fixture.repository.create).mockImplementation(async (input, context) => {
      expect(input).toEqual([{ ...message, id: expect.stringMatching(/^noti_/), provider_id: "local" }]);
      pending = [{ ...message, id: input[0].id, provider_id: "local", status: NotificationStatus.PENDING }];
      if (context === undefined) throw new Error("Missing genuine creation context");
      await dispatchCreatedMutations(pending.map(entity => ({ modelName: "Notification", entity })), context);
      return pending;
    });
    vi.mocked(fixture.repository.find).mockResolvedValueOnce([]).mockImplementation(async () => pending);
    vi.mocked(fixture.repository.update).mockImplementation(async (input, context) => {
      expect(input).toEqual([{ entity: pending[0], update: expect.objectContaining({ id: pending[0]?.id, status: "success", external_id: undefined }) }]);
      const output = [{ ...pending[0], status: NotificationStatus.SUCCESS }];
      if (context === undefined) throw new Error("Missing genuine final-update context");
      expect(fixture.emit).not.toHaveBeenCalled();
      await dispatchDrizzleMutationRows("afterUpdate", "Notification", output, context);
      return output;
    });
    const result = await fixture.service.createNotifications(message, fixture.context);
    expect(result).toMatchObject({ id: expect.stringMatching(/^noti_/), to: "", channel: "feed", status: "success", provider_id: "local" });
    expect(fixture.repository.transaction).toHaveBeenCalledTimes(2);
    expect(fixture.repository.create).toHaveBeenCalledOnce(); expect(fixture.repository.update).toHaveBeenCalledOnce();
    expect(fixture.delivery).toHaveBeenCalledOnce(); expect(fixture.openTransactions()).toBe(0);
    expect(fixture.emit).toHaveBeenCalledWith([
      expect.objectContaining({ name: "notification.notification.created", data: { id: result.id } }),
      expect.objectContaining({ name: "notification.notification.updated", data: { id: result.id } }),
    ], { internal: true });
    expect(fixture.log.info).toHaveBeenCalledWith("Attempting to send a notification to: '' on the channel: 'feed' with template: 'admin-ui' and data: '{\"title\":\"Products imported\"}'");
    expect(result.external_id).toBeUndefined();
  });

  it("executes native class array, empty-array and already-sent scalar/array return shapes", async () => {
    const fixture = nativeService();
    let created = nativeRow("not-created");
    vi.mocked(fixture.repository.create).mockImplementation(async input => {
      const id: unknown = input[0]?.id;
      if (typeof id !== "string") throw new Error("Native creation omitted its generated identity");
      created = nativeRow(id);
      return [created];
    });
    vi.mocked(fixture.repository.find).mockResolvedValueOnce([]).mockImplementation(async () => [created]);
    vi.mocked(fixture.repository.update).mockImplementation(async () => [nativeRow(created.id, NotificationStatus.SUCCESS)]);
    const array = await fixture.service.createNotifications([message], fixture.context);
    expect(array).toHaveLength(1);
    const before = vi.mocked(fixture.repository.transaction).mock.calls.length;
    expect(await fixture.service.createNotifications([], fixture.context)).toEqual([]);
    expect(fixture.repository.transaction).toHaveBeenCalledTimes(before);
    vi.mocked(fixture.repository.find).mockResolvedValue([{ id: "sent", idempotency_key: "key", status: "success" }]);
    expect(await fixture.service.createNotifications({ ...message, idempotency_key: "key" }, fixture.context)).toBeUndefined();
    expect(await fixture.service.createNotifications([{ ...message, idempotency_key: "key" }], fixture.context)).toEqual([]);
    expect(fixture.delivery).toHaveBeenCalledOnce();
  });

  it("executes genuine provider rejection followed by native final update in the class", async () => {
    const fixture = nativeService();
    let created = nativeRow("not-created");
    vi.mocked(fixture.repository.create).mockImplementation(async input => {
      const id: unknown = input[0]?.id;
      if (typeof id !== "string") throw new Error("Native creation omitted its generated identity");
      created = nativeRow(id);
      return [created];
    });
    vi.mocked(fixture.repository.find).mockResolvedValueOnce([]).mockImplementation(async () => [created]);
    vi.mocked(fixture.repository.update).mockImplementation(async () => [nativeRow(created.id, NotificationStatus.FAILURE)]);
    const update = vi.spyOn(fixture.internal, "update");
    fixture.delivery.mockRejectedValue(new Error("provider outcome unknown"));
    await expect(fixture.service.createNotifications(message, fixture.context)).rejects.toThrow("provider outcome unknown");
    expect(update).toHaveBeenCalledWith([expect.objectContaining({ status: "failure" })], expect.anything());
    expect(fixture.serialization).not.toHaveBeenCalled();
  });

  it("leaves genuine mutation intents un-emitted when the outer native method fails", async () => {
    const fixture = nativeService(), messageAggregator = new MessageAggregator();
    let generated = "";
    vi.mocked(fixture.repository.create).mockImplementation(async (input, context) => {
      generated = input[0].id;
      const output = [{ ...message, id: generated, provider_id: "local", status: NotificationStatus.PENDING }];
      if (context === undefined) throw new Error("Missing genuine creation context");
      await dispatchCreatedMutations(output.map(entity => ({ modelName: "Notification", entity })), context);
      return output;
    });
    vi.mocked(fixture.repository.find).mockResolvedValueOnce([]).mockImplementation(async () =>
      [{ ...message, id: generated, provider_id: "local", status: NotificationStatus.PENDING }]);
    vi.mocked(fixture.repository.update).mockImplementation(async (_, context) => {
      const output = [{ ...message, id: generated, provider_id: "local", status: NotificationStatus.FAILURE }];
      if (context === undefined) throw new Error("Missing genuine final-update context");
      await dispatchDrizzleMutationRows("afterUpdate", "Notification", output, context);
      return output;
    });
    fixture.delivery.mockRejectedValue(new Error("provider outcome unknown"));
    await expect(fixture.service.createNotifications(message, { ...fixture.context, messageAggregator })).rejects.toThrow("provider outcome unknown");
    expect(fixture.repository.transaction).toHaveBeenCalledTimes(2);
    expect(fixture.repository.update).toHaveBeenCalledOnce(); expect(fixture.emit).not.toHaveBeenCalled();
    expect(messageAggregator.getMessages()).toEqual({ default: [
      expect.objectContaining({ name: "notification.notification.created", data: { id: generated } }),
      expect.objectContaining({ name: "notification.notification.updated", data: { id: generated } }),
    ] });
  });

  it("retains local provider validation and returns no external identity", async () => {
    const log = logger();
    const local = new LocalNotificationService({ logger: log }, { channels: ["feed"] });
    expect(await local.send(message)).toEqual({});
    expect(log.info).toHaveBeenCalledOnce();
    // @ts-expect-error The native runtime guard also owns missing foreign input.
    await expect(local.send(undefined)).rejects.toMatchObject({ type: "invalid_data", message: "No notification information provided" });
  });
});
