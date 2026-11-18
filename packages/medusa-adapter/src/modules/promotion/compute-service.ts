import { Effect, Result } from "effect";
import { Promotion, ApplicationMethod, Campaign, CampaignBudget, CampaignBudgetUsage, PromotionRule, PromotionRuleValue } from "@medusajs/promotion/models";
import { PromotionModuleService } from "@medusajs/promotion/services";
import { promotionStaticResources } from "@medusajs/promotion/static-manifest";
import { Modules } from "@medusajs/framework/utils/portable";
import { Module } from "@medusajs/utils/modules-sdk/module";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceModule } from "../../module/definition";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { moduleAliases } from "../../local-graph/module";
import { decodeGraphCount } from "../../local-graph/query";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { capturePromotionMetadata } from "./schema";
import { preparePromotionComputeRead } from "./compute-read";
import { capturePromotionComputedActions, decodePromotionComputeArguments, decodePromotionComputeInput, decodePromotionComputedActions, decodePromotionGraphRead } from "./compute-input";
import { promotionComputeReadPolicy } from "./compute-receipt";

Module(Modules.PROMOTION, { service: PromotionModuleService });

/** A genuine native calculation service over its same-manager, read-only
 * seven-model closure. Mutation methods and arbitrary Promotion DAL stay denied. */
export const makePromotionComputeCommands = Effect.fn("Promotion.computeCommands")(function* () {
  const metadata = yield* capturePromotionMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* preparePromotionComputeRead(metadata.frame), policy = promotionComputeReadPolicy(prepared);
    const module = yield* defineCommerceModule({ name: "flarex-promotion-compute", models: [Promotion, ApplicationMethod, Campaign,
      CampaignBudget, CampaignBudgetUsage, PromotionRule, PromotionRuleValue],
      profile: { name: "promotion.compute-actions", capabilities: [], bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { owner, baseRepository: { ...bound.denied, serialize: bound.repository.serialize }, repository: model => model === Promotion ? bound.repository : model === CampaignBudgetUsage ? bound.usageRepository : bound.denied,
          events: bound.mutationEvents, eventBus, prefilter: bound.prefilter };
      } }, extensions: {}, service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new PromotionModuleService(container, { scope: "internal" }, binding.prefilter);
        return { context, service: { computeActions: async (...args: Parameters<PromotionModuleService["computeActions"]>) =>
          binding.owner.run(capturePromotionComputedActions(await native.computeActions(...args))),
          listAndCountPromotions: async (...args: Parameters<PromotionModuleService["listAndCountPromotions"]>) =>
            binding.owner.run(Effect.fromResult(captureNativeNumericDto(await native.listAndCountPromotions(...args)))) } };
      } }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const compute = commerceServiceCommands(module.use).read("promotionComputeActions", commerceCommandPreparation("Promotion.prepareComputeActions")(decodePromotionComputeInput),
      // Native Cart forwards nullable graph members beyond the narrower DTO.
      // The named context schema retains those actual callable ABI values.
      ({ service, context }, input) => Reflect.apply(service.computeActions, service, [input.codes, input.context, input.options, context]));
    const computeActions = yield* defineWorkflowMethod({ command: compute, arguments: decodePromotionComputeArguments,
      encode: ([codes, context, options]) => ({ codes, context, ...(options === undefined ? {} : { options }) }), output: decodePromotionComputedActions });
    const read = commerceServiceCommands(module.use).read("promotionReadForCart", commerceCommandPreparation("Promotion.prepareCartRead")(decodePromotionGraphRead),
      ({ service, context }, input) => Reflect.apply(service.listAndCountPromotions, service, [input.filters, input.config, context]));
    const commands = [compute, read], joiner = promotionStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const graph = { aliases: (yield* moduleAliases(joiner)).filter(alias => alias.model === "Promotion"),
      reads: [{ model: "Promotion", command: read, table: prepared.table, paths: [], orderable: ["id"], uniqueOrder: ["id"],
        multipleOrder: false, decode: decodeGraphCount }] };
    const workflow = yield* defineWorkflowModule({ name: Modules.PROMOTION, source: module.description, methods: { computeActions },
      graph, logical: { ...policy, commands } });
    return { compute, read, commands, workflow, prepared, withService: module.use, description: module.description, logicalEventPolicy: () => policy };
  }));
});
