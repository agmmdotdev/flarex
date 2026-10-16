import { Effect, Result, Schema } from "effect";
import type { DAL, Logger } from "@medusajs/framework/types";
import type { Context, NotificationTypes } from "@medusajs/types";
import { NotificationModuleService } from "@medusajs/notification/services";
import { LocalNotificationService } from "@medusajs/notification-local/services";
import type { NotificationDeliveryUpdate } from "@medusajs/notification/delivery";
import { Modules } from "@medusajs/framework/utils/portable";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureNotificationMetadata } from "./schema";
import { defineNotificationPersistenceModule } from "./module";
import { notificationLogicalEventPolicy } from "./events";
import { LocalFeedNotificationInput, NotificationPhaseMessages, NotificationTerminalUpdates,
  decodeNotificationLocalProvider } from "./contracts";

const prepareInput = commerceDecoder(Schema.Array(LocalFeedNotificationInput).check(Schema.isMaxLength(1)), "invalidInput");
const finalizeInput = commerceDecoder(NotificationTerminalUpdates, "invalidInput");
const internalEmitOptions = commerceDecoder(Schema.Struct({ internal: Schema.Literal(true) }), "unadmittedEvent");
const prepareEnvelope = commerceDecoder(Schema.Struct({ prepared: Schema.Unknown, messages: NotificationPhaseMessages }), "storedCorruption");
const finalizeEnvelope = commerceDecoder(Schema.Struct({ rows: Schema.Unknown, messages: NotificationPhaseMessages }), "storedCorruption");

/** Root-owned phase calls may implement Task occurrence replay and held-event
 * eligibility. This module neither creates a Task nor retries a phase/provider. */
export interface LocalNotificationPhaseExecutor {
  readonly prepare: (input: Json) => Promise<unknown>;
  readonly finalize: (input: Json) => Promise<unknown>;
  /** The trusted interpreter may journal this exact real provider invocation.
   * The closure owns no SQL capability and is never invoked by replay here. */
  readonly deliver: (input: Json, send: () => Promise<NotificationTypes.ProviderSendNotificationResultsDTO>) =>
    Promise<NotificationTypes.ProviderSendNotificationResultsDTO>;
  /** Actual native outer EmitEvents success gate. This acknowledges already
   * held phase intents; the root must not persist a duplicate event family. */
  readonly emit: (messages: Json, options: { readonly internal: true }) => Promise<void>;
}

export const makeLocalNotificationCommands = Effect.fn("NotificationAdapter.commands")(function* (logger: Logger) {
  const metadata = yield* captureNotificationMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const notification = metadata.frame.tables.find(table => table.name === "notification");
    const provider = metadata.frame.tables.find(table => table.name === "notification_provider");
    if (notification === undefined || provider === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const { module, prepared } = yield* defineNotificationPersistenceModule(notification, provider, logger);
    const registration = yield* defineNotificationPersistenceModule(notification, provider, logger, true);
    const contracts = prepared.contracts;
    const commands = commerceServiceCommands(module.use);
    const registrationCommands = commerceServiceCommands(registration.module.use);
    const prepare = commands.write("notificationPrepare", commerceCommandPreparation("Notification.prepareInput")(prepareInput),
      async ({ native, context, capture }, input) => await capture(await native.prepareNotificationsForDelivery([...input], context)));
    const finalize = commands.write("notificationFinalize", commerceCommandPreparation("Notification.finalizeInput")(finalizeInput),
      async ({ native, context, capture }, input) => await capture(await native.finalizeNotificationsDelivery([...input], context)));
    const registerLocalProvider = registrationCommands.write("notificationRegisterLocalProvider",
      commerceCommandPreparation("Notification.registerInput")(decodeNotificationLocalProvider),
      async ({ provider, context, capture }, input) => await capture(await provider.create(input, context)));

    const decodePreparedPacket = (input: unknown) => prepareEnvelope(input).pipe(Result.flatMap(packet => Result.gen(function* () {
      const delivery = yield* contracts.decodePrepared(packet.prepared);
      if (packet.messages.length !== delivery.createdNotifications.length || packet.messages.some((message, index) =>
        message.name !== "notification.notification.created" || message.metadata.action !== "created" ||
        message.data.id !== delivery.createdNotifications[index]?.id)) return yield* Result.fail(commerceError("storedCorruption"));
      return { prepared: delivery, messages: packet.messages };
    })));
    const decodeFinalizedPacket = (input: unknown) => finalizeEnvelope(input).pipe(Result.flatMap(packet => Result.gen(function* () {
      const rows = yield* contracts.decodeRows(packet.rows);
      if (packet.messages.length !== rows.length || packet.messages.some((message, index) =>
        message.name !== "notification.notification.updated" || message.metadata.action !== "updated" ||
        message.data.id !== rows[index]?.id) || rows.some(row => row.status !== "success" && row.status !== "failure"))
        return yield* Result.fail(commerceError("storedCorruption"));
      return { rows, messages: packet.messages };
    })));

    /** A fresh native invocation spans no SQL lifetime. Each phase call returns
     * plain captured data; native provider delivery occurs only between them. */
    const createService = (executor: LocalNotificationPhaseExecutor) => {
      const carrier = Object.freeze({});
      const refuse = (): never => { throw commerceError("unsupportedProfile"); };
      const repository: DAL.RepositoryService = {
        // SAFETY: a detached native decorator carrier, never a commerce manager.
        // All DAL operations refuse; phase commands acquire their own managers.
        getFreshManager: <Manager>() => carrier as Manager,
        getActiveManager: <Manager>() => carrier as Manager,
        transaction: refuse, find: refuse, findAndCount: refuse, create: refuse, update: refuse, delete: refuse,
        softDelete: refuse, restore: refuse, upsert: refuse, upsertWithReplace: refuse,
        serialize: async <Output extends object | object[]>(input: unknown, options?: unknown) => {
          if (options !== undefined) return refuse();
          // Native Promise/DAL boundary: complete DML-derived row validation
          // precedes the generic native serializer's declared DTO projection.
          const rows = Result.getOrThrow(contracts.decodeRows(Result.getOrThrow(captureCommerceInput(input))));
          // SAFETY: only the genuine native createNotifications array reaches
          // this confined serializer; full admitted Notification rows were checked.
          return structuredClone(rows) as Output;
        },
      };
      const local = new LocalNotificationService({ logger }, { channels: ["feed"] });
      const container = { baseRepository: repository,
        [Modules.EVENT_BUS]: { emit: async (messages: unknown, options: unknown) => {
          const flags = Result.getOrThrow(internalEmitOptions(options));
          const batch = Result.getOrThrow(captureCommerceInput(messages));
          await executor.emit(batch, flags);
        } },
        notificationDeliveryPhases: (context: Context) => ({
          prepare: async input => {
            const packet = Result.getOrThrow(decodePreparedPacket(await executor.prepare(Result.getOrThrow(captureCommerceInput(input)))));
            context.messageAggregator?.save(structuredClone([...packet.messages]));
            return { notificationsToProcess: packet.prepared.notificationsToProcess.map(entry => ({
              provider: entry.provider === undefined ? undefined : { ...entry.provider, channels: [...entry.provider.channels] },
              data: { ...entry.data, provider_id: entry.data.provider_id },
            })), createdNotifications: [...packet.prepared.createdNotifications] };
          },
          send: async (provider, input) => {
            if (provider.id !== "local") return refuse();
            const data = Result.getOrThrow(contracts.decodeDispatch(Result.getOrThrow(captureCommerceInput(input))));
            return await executor.deliver(Result.getOrThrow(captureCommerceInput(data)), () => local.send(data));
          },
          updateNotifications: async (updates: NotificationDeliveryUpdate[]) => {
            const packet = Result.getOrThrow(decodeFinalizedPacket(await executor.finalize(Result.getOrThrow(captureCommerceInput(updates)))));
            context.messageAggregator?.save(structuredClone([...packet.messages]));
            return structuredClone([...packet.rows]);
          },
        }),
      } satisfies Pick<ConstructorParameters<typeof NotificationModuleService>[0], "baseRepository" | "notificationDeliveryPhases"> & {
        readonly [Modules.EVENT_BUS]: { readonly emit: (messages: unknown, options: unknown) => Promise<void> } };
      const native = new NotificationModuleService(container, { scope: "internal" });
      return Object.freeze({ createNotifications: async (input: unknown): Promise<NotificationTypes.NotificationDTO | NotificationTypes.NotificationDTO[]> => {
        const data = Result.getOrThrow(contracts.decodeInput(Result.getOrThrow(captureCommerceInput(input))));
        return "to" in data ? await native.createNotifications(data) : await native.createNotifications([...data]);
      } });
    };
    return { prepare, finalize, registerLocalProvider, commands: [prepare, finalize, registerLocalProvider],
      source: module.description, tables: [prepared.table, prepared.providerTable],
      contracts, decodePreparedPacket, decodeFinalizedPacket, createService, logicalEventPolicy: notificationLogicalEventPolicy };
  }));
});
