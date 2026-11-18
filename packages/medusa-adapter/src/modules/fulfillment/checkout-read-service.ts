import { Effect, Result } from "effect";
import { ShippingOption, ShippingProfile } from "@medusajs/fulfillment/models";
import { fulfillmentStaticResources } from "@medusajs/fulfillment/static-manifest";
import { Modules } from "@medusajs/framework/utils/portable";
import type { FindConfig, FilterableShippingOptionProps, FilterableShippingProfileProps, ShippingOptionDTO, ShippingProfileDTO } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { ScalarIdRead } from "../../repository/scalar-id-read";
import { prepareIdReadRepository } from "../../repository/id-read";
import { moduleAliases, scalarGraphDefinition } from "../../local-graph/module";
import { captureFulfillmentCreationMetadata } from "./shipping-profile-schema";
import { defineFulfillmentPersistenceModule } from "./fulfillment-module";

/** One real Fulfillment source supplies checkout's ShippingOption and the
 * Product graph's ShippingProfile reads. No shipping writes are exposed. */
export const makeFulfillmentCheckoutReadCommands = Effect.fn("Fulfillment.checkoutRead")(function* () {
  const metadata = yield* captureFulfillmentCreationMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const optionTable = metadata.frame.tables.find(table => table.name === "shipping_option");
    const profileTable = metadata.frame.tables.find(table => table.name === "shipping_profile");
    if (optionTable === undefined || profileTable === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const option = yield* prepareIdReadRepository(optionTable, "ShippingOption", [optionTable], new Map(), [], "shippingOptionCountForCheckout");
    const profile = yield* prepareIdReadRepository(profileTable, "ShippingProfile", [profileTable], new Map(), [], "shippingProfileCountForCheckout");
    const module = yield* defineFulfillmentPersistenceModule({ name: "flarex-fulfillment-checkout-read", profile: "fulfillment.checkout-read",
      bind: (ctx, owner) => {
        const profiles = profile.bind(ctx, owner), options = option.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => profiles.bridge.current().captureLocalEvent(message), check: work => profiles.bridge.checked(ctx, work), refuse: profiles.refuse });
        return { baseRepository: profiles.repository, denied: profiles.denied,
          repository: model => model === ShippingProfile ? profiles.repository : model === ShippingOption ? options.repository : profiles.denied,
          events: profiles.mutationEvents, eventBus };
      }, service: native => ({ listAndCountShippingOptions: native.listAndCountShippingOptions.bind(native),
        listAndCountShippingProfiles: native.listAndCountShippingProfiles.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use);
    const prepare = commerceCommandPreparation("FulfillmentCheckout.prepare")(commerceDecoder(ScalarIdRead, "invalidInput"));
    // SAFETY: the actual bounded DAL decodes native fields and ID selectors.
    const countOptions = commands.read("shippingOptionCountForCheckout", prepare, ({ service, context }, args) =>
      service.listAndCountShippingOptions(args.filters as FilterableShippingOptionProps | undefined, args.config as FindConfig<ShippingOptionDTO> | undefined, context));
    const countProfiles = commands.read("shippingProfileCountForCheckout", prepare, ({ service, context }, args) =>
      service.listAndCountShippingProfiles(args.filters as FilterableShippingProfileProps | undefined, args.config as FindConfig<ShippingProfileDTO> | undefined, context));
    const joiner = fulfillmentStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const aliases = yield* moduleAliases(joiner);
    const options = yield* scalarGraphDefinition(aliases.filter(alias => alias.model === "ShippingOption"), "ShippingOption", countOptions, option.table);
    const profiles = yield* scalarGraphDefinition(aliases.filter(alias => alias.model === "ShippingProfile"), "ShippingProfile", countProfiles, profile.table);
    const policy = { capture: profile.policy.capture, validateLogicalCall: Effect.fn("FulfillmentCheckout.validateRead")(function* (
      call: Parameters<typeof profile.policy.validateLogicalCall>[0], activity: Parameters<typeof profile.policy.validateLogicalCall>[1],
    ) {
      if (call.commandName === "shippingProfileCountForCheckout") return yield* profile.policy.validateLogicalCall(call, activity);
      return yield* option.policy.validateLogicalCall(call, activity);
    }) };
    const admitted = [countOptions, countProfiles];
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description, methods: {},
      graph: { aliases: [...options.aliases, ...profiles.aliases], reads: [...options.reads, ...profiles.reads] }, logical: { ...policy, commands: admitted } });
    return { workflow, countOptions, countProfiles, commands: admitted, logicalEventPolicy: () => policy };
  }));
});
