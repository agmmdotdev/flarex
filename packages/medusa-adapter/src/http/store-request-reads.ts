import { Effect, Schema } from "effect";
import { apiKeyStaticResources } from "@medusajs/api-key/static-manifest";
import { currencyStaticResources } from "@medusajs/currency/static-manifest";
import { salesChannelStaticResources } from "@medusajs/sales-channel/static-manifest";
import { PublishableApiKeySalesChannel } from "@medusajs/link-modules";
import { executeCountedRemoteFetchRequest, executeRemoteFetchServiceRequest, hasRemoteFetchPagination } from "@medusajs/modules-sdk/remote-query";
import type { CoreDatabase, CoreNativeDefinition } from "@flarex/persistence-postgres/internal/core";
import type { PreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { commerceNativeRegistrations, makeCommerceNativeReadHost, type CommerceInitialization } from "@flarex/persistence-postgres/internal/commerce-native";
import { defineCommerceCommand, type CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileCurrencyCoreDefinition } from "../modules/currency/schema";
import { currencyCommands } from "../modules/currency/service";
import { currencyValueProfile } from "../modules/currency/value-profile";
import { captureApiKeyMetadata, compileApiKeyCoreDefinition } from "../modules/api-key/schema";
import { captureApiKeySalesChannelLinkMetadata, compileApiKeySalesChannelLinkCoreDefinition } from "../links/api-key-sales-channel-schema";
import { prepareLinkRepository } from "../links/repository";
import { prepareScalarRepository } from "../repository/scalar";
import { executeRead } from "../query/read";
import { QueryLimit, QueryOffset } from "../query/decoder";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";
import type { WherePolicy } from "../query/predicate";
import { makeReadCatalog } from "../query/catalog";
import { NativeQueryGraphResultSchema, makeNativeQueryBridge, type NativeQueryRead } from "../local-graph/native-bridge";

const Token = Schema.String.check(Schema.isMaxLength(4096));
const decodeToken = commerceDecoder(Schema.Struct({ token: Token, type: Schema.Literal("publishable") }), "unsupportedProfile");
const decodeNativeKeyFilter = commerceDecoder(Schema.Struct({ token: Token,
  type: Schema.optionalKey(Schema.Literal("publishable")) }), "unsupportedProfile");
const decodeNativeLinkFilter = commerceDecoder(Schema.Struct({ publishable_key_id: Schema.Unknown }), "unsupportedProfile");
const decodeIds = commerceDecoder(Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 256))).check(Schema.isMaxLength(256)), "unsupportedProfile");
const tokenWhere: WherePolicy = { decode: decodeToken, fields: new Map([
  ["token", { column: "token", decode: commerceDecoder(Token, "unsupportedProfile") }],
  ["type", { column: "type", decode: commerceDecoder(Schema.Literal("publishable"), "unsupportedProfile") }],
]) };
const apiKeyFields = ["id", "token", "revoked_at", "sales_channels_link.sales_channel_id"] as const;
const decodeGraph = commerceDecoder(Schema.Struct({ entity: Schema.Literal("api_key"),
  fields: Schema.Array(Schema.Literals(apiKeyFields)).check(Schema.isLengthBetween(4, 4), Schema.isUnique()),
  filters: Schema.Struct({ token: Token, type: Schema.Literal("publishable") }),
}), "unsupportedProfile");
const decodeGraphOptions = commerceDecoder(Schema.Struct({ cache: Schema.Struct({ enable: Schema.Literal(true) }) }), "unsupportedProfile");
const ScalarField = Schema.String.check(Schema.isLengthBetween(1, 256), Schema.isPattern(/^[a-zA-Z_][a-zA-Z0-9_]*$/));
const decodeRemote = commerceDecoder(Schema.Struct({ __value: Schema.Struct({ currency: Schema.Struct({
  fields: Schema.Array(ScalarField).check(Schema.isLengthBetween(1, 256), Schema.isUnique()),
  isServiceAccess: Schema.Literal(false), __args: Schema.Struct({ filters: Schema.optionalKey(Schema.JsonObject),
    skip: Schema.optionalKey(QueryOffset), take: Schema.optionalKey(QueryLimit),
    order: Schema.optionalKey(Schema.Record(ScalarField, Schema.Literals(["ASC", "DESC", "asc", "desc"]))),
  }),
}) }) }), "unsupportedProfile");
const decodeKeyRemote = commerceDecoder(Schema.Struct({ __value: Schema.Struct({ api_key: Schema.Struct({
  fields: Schema.Tuple([]), isServiceAccess: Schema.Literal(false),
  __args: Schema.Struct({ filters: Schema.Struct({ token: Token }) }),
  sales_channels: Schema.Struct({ fields: Schema.Tuple([Schema.Literal("id")]) }),
}) }) }), "unsupportedProfile");
const decodeRemoteEntity = commerceDecoder(Schema.Struct({ __value: Schema.Record(Schema.Literals(["currency", "api_key"]),
  Schema.optionalKey(Schema.JsonObject)) }), "unsupportedProfile");
const decodeKeys = commerceDecoder(Schema.Array(Schema.Struct({ id: Schema.String, token: Schema.String,
  revoked_at: Schema.NullOr(Schema.String) })), "storedCorruption");
const decodeLinks = commerceDecoder(Schema.Array(Schema.Struct({ publishable_key_id: Schema.String,
  sales_channel_id: Schema.String })), "storedCorruption");
const decodeKeyGraphResult = commerceDecoder(Schema.Struct({ ...NativeQueryGraphResultSchema.fields,
  data: Schema.Array(Schema.JsonObject) }), "storedCorruption");

interface StoreReadSource {
  readonly definition: CoreNativeDefinition;
  readonly initialization: CommerceInitialization;
  readonly commands: readonly CommerceCommand[];
}
export interface StoreRequestReadCatalog {
  readonly currency: StoreReadSource;
  readonly apiKey: StoreReadSource;
  readonly apiKeySalesChannel: StoreReadSource;
}

/** Schema production/preparation only. The deployment owner must admit these
 * sources and commit the exact initialization receipts before serving requests. */
export const compileStoreRequestReadCatalog = Effect.fn("StoreRequestReads.compileCatalog")(function* (
  target: Readonly<{ scopeUuid: string; epochUuid: string }>,
  initialization: Readonly<{ currency: CommerceInitialization; apiKey: CommerceInitialization; apiKeySalesChannel: CommerceInitialization }>,
) {
  const metadata = yield* captureApiKeyMetadata();
  const table = metadata.frame.tables[0];
  if (table === undefined) return yield* commerceError("unsupportedProfile");
  const scalar = yield* Effect.fromResult(prepareScalarRepository(table, "ApiKey", tokenWhere));
  const keyCatalog = yield* Effect.fromResult(makeReadCatalog([scalar.table], new Map()));
  const keys = defineCommerceCommand("storePublishableApiKeyRead", "read", Effect.fn("StoreRequestReads.keys")(function* (ctx, args) {
    const selector = yield* Effect.fromResult(decodeToken(args));
    const plan = yield* Effect.fromResult(scalar.query({ where: selector, options: { fields: ["id", "token", "revoked_at"], limit: 256 } }));
    return (yield* executeRead(ctx, keyCatalog, plan, false)).rows;
  }));
  const linkMetadata = yield* captureApiKeySalesChannelLinkMetadata();
  const links = yield* Effect.fromResult(prepareLinkRepository(linkMetadata.frame, "pksc"));
  const linkCatalog = yield* Effect.fromResult(makeReadCatalog([links.table], new Map()));
  const associations = defineCommerceCommand("storePublishableApiKeySalesChannelsRead", "read", Effect.fn("StoreRequestReads.channels")(function* (ctx, args) {
    const ids = yield* Effect.fromResult(decodeIds(args));
    const plan = yield* Effect.fromResult(links.readPlan({ where: { publishable_key_id: ids },
      options: { fields: ["publishable_key_id", "sales_channel_id"], limit: 256 } }, 256));
    const selected = yield* executeRead(ctx, linkCatalog, plan, true);
    if (selected.count === undefined || selected.count !== selected.rows.length) return yield* commerceError("limitExceeded");
    const rows = selected.rows;
    return yield* Effect.fromResult(decodeLinks(rows.map(row => ({ publishable_key_id: row.publishable_key_id, sales_channel_id: row.sales_channel_id }))));
  }));
  return Object.freeze({
    currency: Object.freeze({ definition: yield* compileCurrencyCoreDefinition(target), initialization: Object.freeze({ ...initialization.currency }),
      commands: Object.freeze([currencyCommands.count]) }),
    apiKey: Object.freeze({ definition: yield* compileApiKeyCoreDefinition(target), initialization: Object.freeze({ ...initialization.apiKey }), commands: Object.freeze([keys]) }),
    apiKeySalesChannel: Object.freeze({ definition: yield* compileApiKeySalesChannelLinkCoreDefinition(target),
      initialization: Object.freeze({ ...initialization.apiKeySalesChannel }), commands: Object.freeze([associations]) }),
  } satisfies StoreRequestReadCatalog);
});

/** Each live Core generation constructs and owns fresh protected read hosts.
 * No schema installation, data seeding, initializer or write capability escapes. */
export const makeStoreRequestReads = Effect.fn("StoreRequestReads.make")(function* (input: Readonly<{
  database: CoreDatabase; hostRuntime: PreparedHostRuntime; catalog: StoreRequestReadCatalog; identityAndAccessPolicy: Json;
  readSalesChannels?: NativeQueryRead;
}>) {
  const bind = Effect.fn("StoreRequestReads.bind")(function* (source: StoreReadSource) {
    const commands = [...source.commands];
    const registrations = yield* Effect.fromResult(commerceNativeRegistrations(commands, { readOnly: true }));
    const binding = yield* input.database.bindNative({ definition: source.definition, commands: registrations });
    return yield* Effect.acquireRelease(makeCommerceNativeReadHost({ database: input.database, binding,
      hostRuntime: input.hostRuntime, commands, initialization: source.initialization,
      identityAndAccessPolicy: input.identityAndAccessPolicy }), host => host.close);
  });
  const currency = yield* bind(input.catalog.currency), apiKey = yield* bind(input.catalog.apiKey), links = yield* bind(input.catalog.apiKeySalesChannel);
  const keyCommand = input.catalog.apiKey.commands[0], linkCommand = input.catalog.apiKeySalesChannel.commands[0];
  if (keyCommand === undefined || linkCommand === undefined) return yield* commerceError("invalidAuthority");
  const values = yield* Effect.fromResult(currencyValueProfile);
  const currencyJoiner = currencyStaticResources.joinerConfig, apiKeyJoiner = apiKeyStaticResources.joinerConfig,
    salesChannelJoiner = salesChannelStaticResources.joinerConfig;
  if (currencyJoiner === undefined || apiKeyJoiner === undefined || salesChannelJoiner === undefined)
    return yield* commerceError("unsupportedProfile");
  const native = makeNativeQueryBridge({ servicesConfig: [currencyJoiner, apiKeyJoiner, PublishableApiKeySalesChannel, salesChannelJoiner],
    entitiesMap: new Map(), entityRelations: new Map(),
    read: (request, owner) => {
      if (request.serviceName === salesChannelJoiner.serviceName)
        return input.readSalesChannels === undefined ? Effect.fail(commerceError("unsupportedProfile")) : input.readSalesChannels(request, owner);
      if (request.serviceName === currencyJoiner.serviceName)
        return owner.invoke(() => executeCountedRemoteFetchRequest(request, (filters, options) => owner.run(Effect.gen(function* () {
          const complete = !hasRemoteFetchPagination(options);
          const config = { ...options, ...(options.take === null || options.take === undefined ? { take: commerceLimits.catalogRows } : {}) };
          const args = yield* Effect.fromResult(captureCommerceInput({ filters, config }));
          const result = yield* Effect.fromResult(values.decodeCountResult(yield* currency.read(currencyCommands.count, args)));
          if (complete && result[0].length !== result[1]) return yield* commerceError("limitExceeded");
          return structuredClone(result);
        }))));
      if (request.serviceName === apiKeyJoiner.serviceName)
        return owner.invoke(() => executeRemoteFetchServiceRequest({ ...request, service: {
          listApiKeys: (filters: unknown) => owner.run(Effect.gen(function* () {
            const captured = yield* Effect.fromResult(captureCommerceInput(filters));
            const query = yield* Effect.fromResult(decodeNativeKeyFilter(captured));
            return structuredClone(yield* Effect.fromResult(decodeKeys(yield* apiKey.read(keyCommand, { ...query, type: "publishable" }))));
          })),
        } }));
      if (request.serviceName === PublishableApiKeySalesChannel.serviceName)
        return owner.invoke(() => executeRemoteFetchServiceRequest({ ...request, service: {
          list: (filters: unknown) => owner.run(Effect.gen(function* () {
            const query = yield* Effect.fromResult(decodeNativeLinkFilter(filters));
            const ids = yield* Effect.fromResult(decodeIds(query.publishable_key_id));
            // The existing Link command counts the complete bounded cohort and
            // refuses truncation, admitting native unpaged ID-array fetching.
            return structuredClone(yield* Effect.fromResult(decodeLinks(yield* links.read(linkCommand, ids))));
          })),
        } }));
      return Effect.fail(commerceError("invalidAuthority"));
    },
  });
  const remoteQuery = Effect.fn("StoreRequestReads.remoteQuery")(function* (inputQuery: unknown) {
    const captured = yield* Effect.fromResult(captureCommerceInput(inputQuery));
    const envelope = yield* Effect.fromResult(decodeRemoteEntity(captured));
    if (envelope.__value.api_key !== undefined) {
      yield* Effect.fromResult(decodeKeyRemote(captured));
    } else {
      yield* Effect.fromResult(decodeRemote(captured));
    }
    return yield* native.query(captured);
  });
  const graph = Effect.fn("StoreRequestReads.graph")(function* (inputQuery: unknown, options?: unknown) {
    const captured = yield* Effect.fromResult(captureCommerceInput(inputQuery));
    yield* Effect.fromResult(decodeGraph(captured));
    if (options !== undefined) yield* Effect.fromResult(decodeGraphOptions(yield* Effect.fromResult(captureCommerceInput(options))));
    return yield* Effect.fromResult(decodeKeyGraphResult(yield* native.graph(captured, options)));
  });
  return Object.freeze({ remoteQuery, query: Object.freeze({ graph }),
    close: currency.close.pipe(Effect.andThen(apiKey.close), Effect.andThen(links.close)) });
});
export type StoreRequestReads = Effect.Success<ReturnType<typeof makeStoreRequestReads>>;
