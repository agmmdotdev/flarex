import { Effect, Result, Schema } from "effect";
import type { ModuleJoinerConfig } from "@medusajs/types";
import { appendRemoteFetchMethodSuffix, executeCountedRemoteFetchRequest, executeRemoteFetchServiceRequest,
  hasRemoteFetchPagination, type RemoteFetchOptions, type RemoteQueryFetchRequest } from "@medusajs/modules-sdk/remote-query";
import { commerceError, commerceLimits, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { QueryLimit, QueryOffset } from "../query/decoder";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";
import { checkedCommerceValue } from "../value/checked";
import { graphNativeConfiguration } from "./native-metadata";
import { type NativeQueryMetadata, type NativeQueryRead } from "./native-bridge";
import type { GraphParticipant, GraphReadContext, GraphReadSelection } from "./model";

const Fields = Schema.Array(Schema.String.check(Schema.isBetweenLength(1, 256))).check(Schema.isMaxLength(256));
const ReadOptions = Schema.Struct({ select: Schema.optionalKey(Fields), relations: Fields,
  args: Schema.optionalKey(Schema.Record(Schema.String, Schema.Never)),
  take: Schema.optionalKey(Schema.NullOr(QueryLimit)), skip: Schema.optionalKey(QueryOffset),
  order: Schema.optionalKey(Schema.Record(Schema.String, Schema.Literals(["ASC", "DESC", "asc", "desc"]))),
  withDeleted: Schema.optionalKey(Schema.Boolean),
});
const decodeRead = commerceDecoder(Schema.Struct({ filters: Schema.JsonObject, options: ReadOptions }), "unsupportedProfile");

/** Native service/entity declarations select only already-issued read tokens.
 * The native fetch owner retains IDs, arguments, batching and result envelopes. */
export function prepareNativeReadRegistry(participants: readonly GraphParticipant[]) {
  return Result.gen(function* () {
    const servicesConfig: ModuleJoinerConfig[] = [];
    const seenConfigurations = new Map<string, string>();
    const entityRelations = new Map<string, Map<string, string>>();
    const services = new Map<string, Map<string, GraphReadSelection>>();
    const suffixes = new Map<string, Map<string, string>>();
    for (const { participant, module } of participants) {
      if (module.reads.length === 0) continue;
      if (module.native === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      const configuration = yield* graphNativeConfiguration(module.native);
      for (const config of configuration.servicesConfig) {
        const encoded = JSON.stringify(config);
        const key = config.serviceName ?? encoded;
        const existing = seenConfigurations.get(key);
        if (existing !== undefined && existing !== encoded) return yield* Result.fail(commerceError("unsupportedProfile"));
        if (existing === undefined) { seenConfigurations.set(key, encoded); servicesConfig.push(config); }
        if (config.serviceName === undefined || config.isReadOnlyLink === true) continue;
        const models = services.get(config.serviceName) ?? new Map<string, GraphReadSelection>();
        const methods = suffixes.get(config.serviceName) ?? new Map<string, string>();
        const aliases = Array.isArray(config.alias) ? config.alias : config.alias === undefined ? [] : [config.alias];
        for (const alias of aliases) {
          const read = module.reads.find(read => read.model === alias.entity);
          if (read === undefined) continue;
          const previous = models.get(read.model);
          if (previous !== undefined && (previous.participant !== participant || previous.read.command !== read.command))
            return yield* Result.fail(commerceError("unsupportedProfile"));
          models.set(read.model, { participant, read });
          const suffix: unknown = alias.args?.methodSuffix ?? config.args?.methodSuffix;
          if (typeof suffix === "string") {
            const previous = methods.get(suffix);
            if (previous !== undefined && previous !== read.model) return yield* Result.fail(commerceError("unsupportedProfile"));
            methods.set(suffix, read.model);
          }
        }
        services.set(config.serviceName, models); suffixes.set(config.serviceName, methods);
      }
      for (const [entity, relations] of configuration.entityRelations) {
        const previous = entityRelations.get(entity) ?? new Map<string, string>();
        for (const [property, target] of relations) {
          if (previous.has(property) && previous.get(property) !== target) return yield* Result.fail(commerceError("unsupportedProfile"));
          previous.set(property, target);
        }
        entityRelations.set(entity, previous);
      }
    }
    const metadata: NativeQueryMetadata = { servicesConfig, entitiesMap: new Map<string, unknown>(), entityRelations };
    const select = (request: RemoteQueryFetchRequest) => {
      const models = services.get(request.serviceName);
      const model = request.relationship?.entity ?? request.expand.serviceConfig.entity
        ?? (request.methodSuffix === undefined ? undefined : suffixes.get(request.serviceName)?.get(request.methodSuffix));
      const selected = model === undefined && models?.size === 1 ? models.values().next().value : model === undefined ? undefined : models?.get(model);
      if (selected === undefined || request.relationship?.entity !== undefined && request.expand.serviceConfig.entity !== undefined
        && request.relationship.entity !== request.expand.serviceConfig.entity || request.methodSuffix !== undefined
        && suffixes.get(request.serviceName)?.get(request.methodSuffix) !== selected.read.model
        || request.keyField.split(",").some(key => !selected.read.table.columns.includes(key)))
        return Result.fail(commerceError("invalidAuthority"));
      return Result.succeed(selected);
    };
    const bind = (context: GraphReadContext,
      observe?: (request: RemoteQueryFetchRequest, selected: GraphReadSelection, rows: readonly JsonObject[]) => Result.Result<void, CommerceTransactionError>,
    ): NativeQueryRead => Effect.fn("NativeGraph.fetch")(function* (request, owner) {
      const selected = yield* checkedCommerceValue(context, () => select(request));
      const read = selected.read;
      const invoke = Effect.fn("NativeGraph.read")(function* (filters: Record<string, unknown>, options: RemoteFetchOptions) {
        const args = yield* checkedCommerceValue(context, () => captureCommerceInput({ filters, options }).pipe(Result.flatMap(decodeRead)));
        const config = args.options;
        const order = Object.keys(config.order ?? {});
        if (order.some(field => !read.orderable.includes(field)) || !read.multipleOrder && order.length > 1)
          return yield* context.refuse(commerceError("unsupportedProfile"));
        // Null is the native complete-unpaged request, not an unlimited grant.
        // The existing command/cohort owner keeps its original row ceiling.
        const complete = !hasRemoteFetchPagination(options) && (config.take === undefined || config.take === null);
        const { args: _transportArguments, take: _nativeTake, ...plain } = config;
        const input = yield* checkedCommerceValue(context, () => captureCommerceInput({ filters: args.filters,
          config: { ...plain, ...(read.result === "list" ? {} : { take: config.take ?? commerceLimits.catalogRows, skip: config.skip ?? 0 }) } }));
        const value = yield* context.call(selected.participant, read.command, input);
        if (read.result === "list") {
          const rows = yield* checkedCommerceValue(context, () => read.decode(value));
          if (observe !== undefined) yield* checkedCommerceValue(context, () => observe(request, selected, rows));
          return structuredClone(rows);
        }
        const [rows, count] = yield* checkedCommerceValue(context, () => read.decode(value));
        const take = config.take ?? commerceLimits.catalogRows, skip = config.skip ?? 0;
        if (rows.length !== Math.min(take, Math.max(0, count - skip)))
          return yield* context.refuse(commerceError("storedCorruption"));
        if (complete && rows.length !== count) return yield* context.refuse(commerceError("limitExceeded"));
        if (observe !== undefined) yield* checkedCommerceValue(context, () => observe(request, selected, rows));
        // Native expansion mutates service DTOs; Core's captured rows remain owned.
        return structuredClone([rows, count]);
      });
      if (read.result !== "list") return yield* owner.invoke(() => executeCountedRemoteFetchRequest(request,
        (filters, options) => owner.run(invoke(filters, options))));
      if (hasRemoteFetchPagination(request.options)) return yield* context.refuse(commerceError("unsupportedProfile"));
      const service = { [appendRemoteFetchMethodSuffix("list", request.methodSuffix)]:
        (filters: Record<string, unknown>, options: RemoteFetchOptions) => owner.run(invoke(filters, options)) };
      return yield* owner.invoke(() => executeRemoteFetchServiceRequest({ ...request, service }));
    });
    return { metadata, bind };
  });
}
