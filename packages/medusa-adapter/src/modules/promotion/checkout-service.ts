import { Effect, Result } from "effect";
import { Promotion, ApplicationMethod, Campaign, CampaignBudget, CampaignBudgetUsage, PromotionRule, PromotionRuleValue } from "@medusajs/promotion/models";
import { PromotionModuleService } from "@medusajs/promotion/services";
import { promotionStaticResources } from "@medusajs/promotion/static-manifest";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { Module } from "@medusajs/utils/modules-sdk/module";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceModule } from "../../module/definition";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { moduleAliases, relationPaths } from "../../local-graph/module";
import { withNativeGraphMetadata } from "../../local-graph/native-metadata";
import { decodeGraphCount } from "../../local-graph/query";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { capturePromotionMetadata } from "./schema";
import { preparePromotionUsageRepository } from "./usage-repository";
import { promotionUsagePolicy } from "./usage-receipt";
import { decodePromotionGraphRead } from "./compute-input";
import { decodePromotionUsageArguments, decodePromotionUsageInput, decodePromotionUsageOutput } from "./usage-input";

Module(Modules.PROMOTION, { service: PromotionModuleService });
/** Genuine native usage plus its retained native inverse, within checkout's
 * existing atomic owner. Calculation and administrative writes stay separate. */
export const makePromotionCheckoutCommands = Effect.fn("Promotion.checkoutCommands")(function* () {
  const metadata = yield* capturePromotionMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* preparePromotionUsageRepository(metadata.frame), policy = promotionUsagePolicy(prepared);
    const module = yield* defineCommerceModule({ name: "flarex-promotion-checkout", models: [Promotion, ApplicationMethod, Campaign,
      CampaignBudget, CampaignBudgetUsage, PromotionRule, PromotionRuleValue],
      profile: { name: "promotion.checkout-usage", capabilities: [], bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { owner, baseRepository: { ...bound.denied, serialize: bound.serialize }, repository: model => model === Promotion ? bound.promotionRepository
          : model === CampaignBudget ? bound.budgetRepository : model === CampaignBudgetUsage ? bound.usageRepository : bound.denied,
          events: bound.mutationEvents, eventBus };
      } }, extensions: {}, service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new PromotionModuleService(container, { scope: "internal" });
        return { context, service: {
          registerUsage: async (...args: Parameters<PromotionModuleService["registerUsage"]>) => { await native.registerUsage(...args); return null; },
          revertUsage: async (...args: Parameters<PromotionModuleService["revertUsage"]>) => { await native.revertUsage(...args); return null; },
          listAndCountPromotions: async (...args: Parameters<PromotionModuleService["listAndCountPromotions"]>) =>
            binding.owner.run(Effect.fromResult(captureNativeNumericDto(await native.listAndCountPromotions(...args)))),
        } };
      } }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const service = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("Promotion.prepareUsage")(decodePromotionUsageInput);
    const register = service.write("promotionRegisterUsage", prepare, ({ service, context }, input) =>
      Reflect.apply(service.registerUsage, service, [input.computedActions, input.registrationContext, context]));
    const revert = service.write("promotionRevertUsage", prepare, ({ service, context }, input) =>
      Reflect.apply(service.revertUsage, service, [input.computedActions, input.registrationContext, context]));
    const event = (objectName: string, action: string) => buildModuleResourceEventName({ prefix: Modules.PROMOTION, objectName, action });
    const registerUsage = yield* defineWorkflowMethod({ command: register, arguments: decodePromotionUsageArguments,
      encode: ([computedActions, registrationContext]) => ({ computedActions, registrationContext }), output: decodePromotionUsageOutput,
      moduleEvents: [event("promotion", "updated"), event("campaign_budget", "updated"), event("campaign_budget_usage", "created"), event("campaign_budget_usage", "updated")] });
    const revertUsage = yield* defineWorkflowMethod({ command: revert, arguments: decodePromotionUsageArguments,
      encode: ([computedActions, registrationContext]) => ({ computedActions, registrationContext }), output: decodePromotionUsageOutput,
      moduleEvents: [event("promotion", "updated"), event("campaign_budget", "updated"), event("campaign_budget_usage", "updated"), event("campaign_budget_usage", "deleted")] });
    const count = service.read("promotionReadForCheckout", commerceCommandPreparation("Promotion.prepareCheckoutRead")(decodePromotionGraphRead),
      ({ service, context }, input) => Reflect.apply(service.listAndCountPromotions, service, [input.filters, input.config, context]));
    const commands = [register, revert, count], joiner = promotionStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const graph = yield* withNativeGraphMetadata({ aliases: (yield* moduleAliases(joiner)).filter(alias => alias.model === "Promotion"),
      reads: [{ model: "Promotion", command: count, table: prepared.read.table,
        paths: yield* relationPaths(prepared.read.catalog, "promotion", ["application_method"], { nativeFields: true }),
        orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }] }, [joiner], metadata.frame.tables);
    const workflow = yield* defineWorkflowModule({ name: Modules.PROMOTION, source: module.description, methods: { registerUsage, revertUsage }, graph,
      logical: { ...policy, commands } });
    return { register, revert, count, commands, workflow, prepared, withService: module.use, description: module.description, logicalEventPolicy: () => policy };
  }));
});
