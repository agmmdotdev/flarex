import { Effect, Schema } from "effect";
import { LinkService, getModuleService } from "@medusajs/link-modules";
import { Link, type DeleteEntityInput } from "@medusajs/modules-sdk/link";
import { Modules } from "@medusajs/framework/utils/portable";
import { toPascalCase } from "@medusajs/utils/common/to-pascal-case";
import type { Context, IEventBusModuleService, ILinkModule, LoadedModule } from "@medusajs/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { captureLinkMetadata } from "./link-schema";
import { prepareLinkRepository } from "./link-repository";
import { withCommerceService } from "./commerce-service-bridge";
import { commerceDecoder } from "./commerce-decoder";
import { captureCommerceInput } from "./commerce-input";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Ids = Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(256)).pipe(Schema.mutable)]);
const decodeEventOptions = commerceDecoder(Schema.Struct({ internal: Schema.Literal(true) }), "unadmittedEvent");
const decodeEvents = commerceDecoder(Schema.Array(Schema.Json), "unadmittedEvent");
const decodeCascade = commerceDecoder(Schema.Tuple([Schema.Null,
  Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Array(Id)))]), "adapterFailure");

export interface BoundLink { readonly link: Readonly<Pick<Link, "create" | "dismiss" | "delete" | "restore" | "list">>;
  readonly service: Readonly<Pick<ILinkModule, "list" | "listAndCount" | "create" | "dismiss" | "restore">>; readonly context: Context;
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
  const use = (ctx: CommerceCommandContext, work: (service: BoundLink) => Promise<unknown>) => withCommerceService(ctx, owner => {
    const bound = prepared.bind(ctx, owner);
    const eventBus: IEventBusModuleService = {
      emit: (input, options) => owner.run(bound.bridge.checked(bound.bridge.current(), Effect.gen(function* () {
        yield* Effect.fromResult(decodeEventOptions(yield* Effect.fromResult(captureCommerceInput(options))));
        const events = yield* Effect.fromResult(decodeEvents(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
        for (const event of events) yield* bound.bridge.current().captureLocalEvent(event);
      }))),
      subscribe: () => owner.reject(commerceError("unsupportedProfile")), unsubscribe: () => owner.reject(commerceError("unsupportedProfile")),
      releaseGroupedEvents: bound.refuse, clearGroupedEvents: bound.refuse,
    };
    const service = new Service({
      baseRepository: bound.repository, linkService: new LinkService({ linkRepository: bound.repository }),
      primaryKey: primary.foreignKey, foreignKey: foreign.foreignKey, extraFields: [], entityName, serviceName,
      [Modules.EVENT_BUS]: eventBus,
    }, { scope: "internal" });
    // The native router consumes loaded config values and actual bound methods.
    // Do not overwrite the service's __joinerConfig method with a data property.
    const loaded = { __joinerConfig: service.__joinerConfig(), __definition: {
      key: serviceName, defaultPackage: "@medusajs/link-modules", label: entityName, isQueryable: true,
      defaultModuleDeclaration: { scope: "internal" as const },
    }, create: service.create.bind(service), dismiss: service.dismiss.bind(service), list: service.list.bind(service),
      softDelete: service.softDelete.bind(service), restore: service.restore.bind(service),
    } satisfies LoadedModule & Pick<ILinkModule, "create" | "dismiss" | "list" | "softDelete" | "restore">;
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
        create: service.create.bind(service), dismiss: service.dismiss.bind(service), restore: service.restore.bind(service) }),
      context: { manager: ctx.manager, transactionManager: ctx.manager },
      cascade: result => owner.run(bound.bridge.checked(ctx, Effect.gen(function* () {
        const captured = yield* Effect.fromResult(captureCommerceInput(result, ctx.resources));
        // Validate the entire native errors-as-data tuple before projecting it.
        return (yield* Effect.fromResult(decodeCascade(captured)))[1];
      }))),
    };
  }, work);
  return { use, prepared, joiner, serviceName, entityName };
});
