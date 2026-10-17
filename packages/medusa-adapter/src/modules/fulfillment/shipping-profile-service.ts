import { deniedCommerceRepository } from "../../repository/denied";
import { commerceModuleEventBus } from "../../module/events";
import { Effect, Result, Schema } from "effect";
import { ShippingProfile } from "@medusajs/fulfillment/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { fulfillmentStaticResources } from "@medusajs/fulfillment/static-manifest";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { moduleAliases, scalarGraphDefinition } from "../../local-graph/module";

import type { FindConfig, ShippingProfileDTO, CreateShippingProfileDTO, FilterableShippingProfileProps } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceDecoder } from "../../value/decoder";

import { prepareShippingProfileRepository } from "./shipping-profile-repository";
import { shippingProfileLogicalEventPolicy } from "./shipping-profile-events";
import { captureShippingProfileMetadata } from "./shipping-profile-schema";
import { QueryLimit, QueryOffset } from "../../query/decoder";
import { defineFulfillmentPersistenceModule, type FulfillmentPersistenceModel } from "./fulfillment-module";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const SimpleShippingProfileInput = Schema.Struct({ id: Schema.optionalKey(Id), name: Schema.String, type: Schema.String });
const decodeCreateArguments = commerceDecoder(Schema.Tuple([
  Schema.Array(SimpleShippingProfileInput).check(Schema.isMaxLength(256)),
]), "invalidInput");
const decodeCreatedProfiles = commerceDecoder(Schema.Array(Schema.StructWithRest(
  Schema.Struct({ id: Id, name: Schema.String, type: Schema.String }), [Schema.Record(Schema.String, Schema.Json)],
)).check(Schema.isMaxLength(256)), "storedCorruption");
const Create = Schema.StructWithRest(Schema.Struct({ name: Schema.String, type: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]);
const decodeCreate = commerceDecoder(Schema.Union([Create, Schema.Array(Create).check(Schema.isMaxLength(256))]), "invalidInput");
const Filters = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(256)), Schema.Struct({ $ne: Id })])),
  name: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))])),
  type: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))])),
});
const Config = Schema.Struct({
  select: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
  relations: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(0))),
  skip: Schema.optionalKey(QueryOffset), take: Schema.optionalKey(QueryLimit),
  order: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
  withDeleted: Schema.optionalKey(Schema.Boolean),
});
const decodeRead = commerceDecoder(Schema.Struct({
  filters: Schema.optionalKey(Filters), config: Schema.optionalKey(Config),
}), "invalidInput");
const decodeRetrieve = commerceDecoder(Schema.Struct({ id: Id, config: Schema.optionalKey(Config) }), "invalidInput");

/** One definition per prepared model snapshot; each invocation borrows a fresh
 * command-owned service. There is no global container or second runtime owner.
 * The host supplies settlement, source admission and the event destination. */
export const makeLocalShippingProfileCommands = Effect.fn("ShippingProfileAdapter.commands")(function* () {
  const metadata = yield* captureShippingProfileMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const { bind, table } = yield* prepareShippingProfileRepository(metadata.frame);
    const bindModule = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = bind(ctx, owner);
      const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
        capture: message => bound.bridge.current().captureLocalEvent(message),
        check: work => work.pipe(Effect.catchTag("CommerceTransactionError", error => bound.bridge.current().refuse(error))), refuse: bound.refuse,
      });
      // Real internal services retain the same borrowed manager/persistence owner.
      // No unselected model is mapped to the ShippingProfile repository.
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      return { baseRepository: bound.repository, repository: (model: FulfillmentPersistenceModel) =>
        model === ShippingProfile ? bound.repository : denied, events: bound.mutationEvents, eventBus, denied };
    };
    const module = yield* defineFulfillmentPersistenceModule({
      name: "flarex-shipping-profile-local", profile: "shipping-profile", bind: bindModule,
      service: native => Object.freeze({
        createShippingProfiles: native.createShippingProfiles.bind(native),
        retrieveShippingProfile: native.retrieveShippingProfile.bind(native),
        listShippingProfiles: native.listShippingProfiles.bind(native),
        listAndCountShippingProfiles: native.listAndCountShippingProfiles.bind(native),
      }),
    }).pipe(Result.mapError(error => commerceError("unsupportedProfile", error)));
    const commands = commerceServiceCommands(module.use);
    const prepare = commerceCommandPreparation("ShippingProfileCommand.prepare");
    // SAFETY: framework DTOs/configuration are compile-time interfaces; the
    // selected DAL validates native-normalized inputs before any storage call.
    const create = commands.write("shippingProfileCreate", prepare(decodeCreate), ({ service, context }, data) =>
      Array.isArray(data) ? service.createShippingProfiles(data as CreateShippingProfileDTO[], context) : service.createShippingProfiles(data as CreateShippingProfileDTO, context));
    const list = commands.read("shippingProfileList", prepare(decodeRead), ({ service, context }, args) => service.listShippingProfiles(args.filters as FilterableShippingProfileProps | undefined, args.config as FindConfig<ShippingProfileDTO> | undefined, context));
    const count = commands.read("shippingProfileCount", prepare(decodeRead), ({ service, context }, args) => service.listAndCountShippingProfiles(args.filters as FilterableShippingProfileProps | undefined, args.config as FindConfig<ShippingProfileDTO> | undefined, context));
    const retrieve = commands.read("shippingProfileRetrieve", prepare(decodeRetrieve), ({ service, context }, args) => service.retrieveShippingProfile(args.id, args.config as FindConfig<ShippingProfileDTO> | undefined, context));
    const joiner = fulfillmentStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const graph = yield* scalarGraphDefinition(yield* moduleAliases({ ...joiner, alias: (Array.isArray(joiner.alias) ? joiner.alias : joiner.alias === undefined ? [] : [joiner.alias]).filter(alias => alias.entity === "ShippingProfile") }), "ShippingProfile", count, table);
    const createShippingProfiles = yield* defineWorkflowMethod({ command: create, arguments: decodeCreateArguments,
      encode: ([profiles]) => profiles, output: decodeCreatedProfiles,
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: "shipping_profile", action: "created" })] });
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description, methods: { createShippingProfiles }, graph, logical: { ...shippingProfileLogicalEventPolicy(), commands: [create, list, count, retrieve] } });
    return { create, list, count, retrieve, graph, workflow,
      commands: [create, list, count, retrieve],
      withService: module.use,
      logicalEventPolicy: shippingProfileLogicalEventPolicy,
    };
  }));
});
