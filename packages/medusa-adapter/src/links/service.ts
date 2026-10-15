import { commerceModuleEventBus } from "../module/events";
import { Effect, Schema } from "effect";
import { LinkService, getModuleService } from "@medusajs/link-modules";
import { Link, type DeleteEntityInput } from "@medusajs/modules-sdk/link";
import { Modules } from "@medusajs/framework/utils/portable";
import { toPascalCase } from "@medusajs/utils/common/to-pascal-case";
import type { Context, ILinkModule, LoadedModule } from "@medusajs/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { captureLinkMetadata } from "./schema";
import { prepareLinkRepository } from "./repository";
import { withCommerceService } from "../module/service-bridge";
import type { CommercePromiseOwner } from "../module/promise-owner";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Ids = Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(256)).pipe(Schema.mutable)]);
const decodeCascade = commerceDecoder(Schema.Tuple([Schema.Null,
  Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Array(Id)))]), "adapterFailure");

export interface BoundLink { readonly link: Readonly<Pick<Link, "create" | "dismiss" | "delete" | "restore" | "list">>;
  readonly service: Readonly<Pick<ILinkModule, "list" | "listAndCount" | "create" | "dismiss" | "softDelete" | "restore">>; readonly context: Context;
  readonly cascade: (result: unknown) => Promise<Json> }

/** One prepared Link owns its repository, native services/router, read tokens
 * and borrowed context. Host assembly still explicitly selects all participants. */
export const prepareLinkService = Effect.fn("LinkAdapter.prepareService")(function* (
  metadata: Effect.Success<ReturnType<typeof captureLinkMetadata>>,
) {
  const joiner = structuredClone(metadata.joiner);
  const [primary, foreign] = joiner.relationships ?? [];
  const idPrefix = joiner.databaseConfig?.idPrefix;
  if (primary === undefined || foreign === undefined || idPrefix === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const prepared = yield* Effect.fromResult(prepareLinkRepository(metadata.frame, idPrefix));
  const decodeEndpoint = commerceDecoder(Schema.Union([
    Schema.Struct({ [primary.serviceName]: Schema.Struct({ [primary.foreignKey]: Ids }) }),
    Schema.Struct({ [foreign.serviceName]: Schema.Struct({ [foreign.foreignKey]: Ids }) }),
  ]), "unsupportedProfile");
  const serviceName = joiner.serviceName;
  const entityName = "Link" + toPascalCase(metadata.frame.name);
  if (serviceName === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const Service = getModuleService(joiner);
  const routing = { __joinerConfig: Service.prototype.__joinerConfig(), __definition: {
    key: serviceName, defaultPackage: "@medusajs/link-modules", label: entityName, isQueryable: true,
    defaultModuleDeclaration: { scope: "internal" as const },
  } };
  const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
    const bound = prepared.bind(ctx, owner);
    const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
      capture: message => bound.bridge.current().captureLocalEvent(message),
      check: work => bound.bridge.checked(bound.bridge.current(), work), refuse: bound.refuse,
    });
    const service = new Service({
      baseRepository: bound.repository, linkService: new LinkService({ linkRepository: bound.repository }),
      primaryKey: primary.foreignKey, foreignKey: foreign.foreignKey,
      extraFields: Object.keys(joiner.databaseConfig?.extraFields ?? {}), entityName, serviceName,
      [Modules.EVENT_BUS]: eventBus,
    }, { scope: "internal" });
    // The native router consumes loaded config values and actual bound methods.
    // Do not overwrite the service's __joinerConfig method with a data property.
    const loaded = { ...routing, create: service.create.bind(service), dismiss: service.dismiss.bind(service), list: service.list.bind(service),
      softDelete: service.softDelete.bind(service), restore: service.restore.bind(service),
    } satisfies LoadedModule & Pick<ILinkModule, "create" | "dismiss" | "list" | "softDelete" | "restore">;
    return { bound, service: {
      list: service.list.bind(service), listAndCount: service.listAndCount.bind(service),
      create: service.create.bind(service), dismiss: service.dismiss.bind(service), softDelete: service.softDelete.bind(service), restore: service.restore.bind(service),
    } satisfies BoundLink["service"], loaded };
  };
  const use = (ctx: CommerceCommandContext, work: (service: BoundLink) => Promise<unknown>) => withCommerceService(ctx, owner => {
    const { bound, service, loaded } = bind(ctx, owner);
    const router = new Link([loaded]);
    const endpoint = (input: unknown) => owner.run(bound.bridge.checked(ctx, Effect.gen(function* () {
      const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
      return structuredClone(yield* Effect.fromResult(decodeEndpoint(captured)));
    })));
    return {
      // Actual bound native methods, without mutable registration or routing
      // metadata capabilities escaping into command code.
      link: Object.freeze({ create: router.create.bind(router), dismiss: router.dismiss.bind(router),
        // Admission precedes native traversal even for a borrowed service call.
        delete: async (input: DeleteEntityInput, context?: Context) => router.delete(await endpoint(input), context),
        restore: async (input: DeleteEntityInput, context?: Context) => router.restore(await endpoint(input), context), list: router.list.bind(router) }),
      service: Object.freeze({ list: service.list.bind(service), listAndCount: service.listAndCount.bind(service),
        create: service.create.bind(service), dismiss: service.dismiss.bind(service), softDelete: service.softDelete.bind(service), restore: service.restore.bind(service) }),
      context: { manager: ctx.manager, transactionManager: ctx.manager },
      cascade: result => owner.run(bound.bridge.checked(ctx, Effect.gen(function* () {
        const captured = yield* Effect.fromResult(captureCommerceInput(result, ctx.resources));
        // Validate the entire native errors-as-data tuple before projecting it.
        return (yield* Effect.fromResult(decodeCascade(captured)))[1];
      }))),
    };
  }, work);
  const useService = (ctx: CommerceCommandContext, work: (service: Pick<BoundLink, "service" | "context">) => Promise<unknown>) =>
    withCommerceService(ctx, owner => ({ service: bind(ctx, owner).service,
      context: { manager: ctx.manager, transactionManager: ctx.manager } }), work);
  return { use, useService, bind, prepared, joiner, serviceName, entityName, routing };
});
