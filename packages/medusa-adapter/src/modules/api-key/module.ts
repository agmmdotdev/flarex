import { Result } from "effect";
import { ApiKey } from "@medusajs/api-key/models";
import { ApiKeyModuleService } from "@medusajs/api-key/services";
import { Modules } from "@medusajs/framework/utils/portable";
import { Module } from "@medusajs/utils/modules-sdk/module";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceModule } from "../../module/definition";
import { commerceModuleEventBus } from "../../module/events";
import { prepareApiKeyRepository } from "./repository";

Module(Modules.API_KEY, { service: ApiKeyModuleService });

/** Each selected native profile borrows the existing command owner. The DAL
 * grants creation or lifecycle writes explicitly, with no authentication API. */
export function prepareApiKeyModule(metadata: Parameters<typeof prepareApiKeyRepository>[0], profile: "creation" | "lifecycle") {
  return Result.gen(function* () {
    const prepared = yield* prepareApiKeyRepository(metadata, profile);
    const module = yield* defineCommerceModule({ name: `flarex-api-key-${profile}`, models: [ApiKey],
      profile: { name: profile === "creation" ? "api-key.publishable-creation" : "api-key.publishable-lifecycle", capabilities: [], bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message),
          check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: () => bound.repository,
          events: bound.mutationEvents, eventBus, captureOutput: bound.captureOutput,
          capturePreimages: (input: unknown) => owner.run(prepared.contracts.capturePreimages(input, ctx.resources)),
          captureStored: (input: unknown) => owner.run(prepared.contracts.captureStored(input, ctx.resources)) };
      } }, extensions: {},
      service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        return { native: new ApiKeyModuleService(container, { scope: "internal" }), context,
          captureOutput: binding.captureOutput, capturePreimages: binding.capturePreimages, captureStored: binding.captureStored };
      },
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    return { prepared, module };
  });
}
