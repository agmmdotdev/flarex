import { Effect, Result } from "effect";
import { Notification, NotificationProvider } from "@medusajs/notification/models";
import { NotificationModuleService, NotificationProviderService } from "@medusajs/notification/services";
import { Module } from "@medusajs/utils/modules-sdk/module";
import { Modules } from "@medusajs/framework/utils/portable";
import type { Logger } from "@medusajs/framework/types";
import { defineCommerceModule } from "../../module/definition";
import { commerceModuleEventBus } from "../../module/events";
import { captureCommerceInput } from "../../value/input";
import { prepareNotificationRepository } from "./repository";
import type { SchemaTable } from "../../schema/model";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommercePromiseOwner } from "../../module/promise-owner";

/** Native module identity/joiner naming, without its container/ORM loaders. */
Module(Modules.NOTIFICATION, { service: NotificationModuleService });

export function defineNotificationPersistenceModule(notification: SchemaTable, provider: SchemaTable, logger: Logger, registration = false) {
  return Result.gen(function* () {
    const prepared = yield* prepareNotificationRepository(notification, provider, registration);
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(ctx, owner);
      const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
        capture: message => bound.bridge.current().captureLocalEvent(message),
        check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
      return { baseRepository: bound.repository, repository: (model: typeof Notification | typeof NotificationProvider) =>
        model === Notification ? bound.repository : bound.providerRepository,
        events: bound.mutationEvents, eventBus, providerRepository: bound.providerRepository,
        capture: (value: unknown) => owner.run(Effect.fromResult(captureCommerceInput(value, ctx.resources))) };
    };
    const module = yield* defineCommerceModule({ name: "flarex-notification-local-feed", models: [Notification, NotificationProvider],
      profile: { name: "notification-local-feed-phases", capabilities: ["notificationProviderService"], bind },
      extensions: { notificationProviderService: { mode: "replace", requires: ["notificationProviderService"],
        create: ({ binding, persistence }) => {
          const container = { notificationProviderRepository: binding.providerRepository, modulePersistenceAdapter: persistence, logger };
          return new NotificationProviderService(container);
        },
      } },
      service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, logger, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new NotificationModuleService(container, { scope: "internal" });
        return { native, provider: dependencies.notificationProviderService, context, capture: binding.capture };
      },
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    return { module, prepared };
  });
}
