import { Effect, Result } from "effect";
import { Promotion, ApplicationMethod, Campaign, CampaignBudget, CampaignBudgetUsage, PromotionRule, PromotionRuleValue } from "@medusajs/promotion/models";
import { PromotionModuleService } from "@medusajs/promotion/services";
import { promotionStaticResources } from "@medusajs/promotion/static-manifest";
import { Module } from "@medusajs/utils/modules-sdk/module";
import { Modules } from "@medusajs/framework/utils/portable";
import type { FilterablePromotionProps, FindConfig, PromotionDTO } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceModule } from "../../module/definition";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { ScalarIdRead } from "../../repository/scalar-id-read";
import { prepareIdReadRepository } from "../../repository/id-read";
import { moduleAliases, scalarGraphDefinition } from "../../local-graph/module";
import { capturePromotionMetadata } from "./schema";

Module(Modules.PROMOTION, { service: PromotionModuleService });
/** Preserve the genuine constructor's default application_method relation.
 * Computation, campaigns, budgets and all promotion writes remain unselected. */
export const makePromotionCheckoutReadCommands = Effect.fn("Promotion.checkoutRead")(function* () {
  const metadata = yield* capturePromotionMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const table = metadata.frame.tables.find(table => table.name === "promotion"), method = metadata.frame.tables.find(table => table.name === "promotion_application_method");
    const native = table?.relationships.find(relation => relation.name === "application_method");
    const foreign = method?.foreignKeys.filter(key => key.referencedTable === table?.name);
    const key = foreign?.[0];
    if (table === undefined || method === undefined || native?.type !== "hasOne" || native.targetTable !== method.name ||
      foreign?.length !== 1 || key?.columns.length !== 1 || key.referencedColumns.length !== 1)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const relations = new Map([[table.name, new Map([[native.name, { name: native.name, sourcePrimaryKeys: key.referencedColumns,
      targetPrimaryKeys: ["id"], targetTable: method.name, join: { type: "hasOne" as const, foreignKeys: key.columns } }]])]]);
    const prepared = yield* prepareIdReadRepository(table, "Promotion", [table, method], relations, [native.name], "promotionCountForCheckout");
    const module = yield* defineCommerceModule({ name: "flarex-promotion-checkout-read",
      models: [Promotion, ApplicationMethod, Campaign, CampaignBudget, CampaignBudgetUsage, PromotionRule, PromotionRuleValue],
      profile: { name: "promotion.checkout-read", capabilities: [], bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { owner, baseRepository: bound.repository, repository: model => model === Promotion ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus };
      } }, extensions: {}, service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const service = new PromotionModuleService(container, { scope: "internal" });
        return { context, service: { listAndCountPromotions: async (...args: Parameters<PromotionModuleService["listAndCountPromotions"]>) =>
          binding.owner.run(Effect.fromResult(captureNativeNumericDto(await service.listAndCountPromotions(...args)))) } };
      } }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const count = commerceServiceCommands(module.use).read("promotionCountForCheckout",
      commerceCommandPreparation("PromotionCheckout.prepare")(commerceDecoder(ScalarIdRead, "invalidInput")),
      // SAFETY: native DTO/config interfaces are checked at the bounded DAL ABI.
      ({ service, context }, args) => service.listAndCountPromotions(args.filters as FilterablePromotionProps | undefined,
        args.config as FindConfig<PromotionDTO> | undefined, context));
    const joiner = promotionStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const graph = yield* scalarGraphDefinition((yield* moduleAliases(joiner)).filter(alias => alias.model === "Promotion"), "Promotion", count, prepared.table);
    const workflow = yield* defineWorkflowModule({ name: Modules.PROMOTION, source: module.description, methods: {}, graph,
      logical: { ...prepared.policy, commands: [count] } });
    return { prepared, workflow, count, commands: [count], logicalEventPolicy: () => prepared.policy };
  }));
});
