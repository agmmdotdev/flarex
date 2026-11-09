import { Effect, Schema } from "effect";
import type { CoreDatabase, CoreNativeDefinition } from "@flarex/persistence-postgres/internal/core";
import type { PreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { commerceNativeRegistrations, makeCommerceNativeReadHost, type CommerceInitialization } from "@flarex/persistence-postgres/internal/commerce-native";
import { defineCommerceCommand, type CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileCurrencyCoreDefinition } from "../modules/currency/schema";
import { currencyCommands } from "../modules/currency/service";
import { currencyColumns } from "../modules/currency/query-model";
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
import { projectExactNumericColumns } from "../value/exact-numeric";

const Token = Schema.String.check(Schema.isMaxLength(4096));
const decodeToken = commerceDecoder(Schema.Struct({ token: Token, type: Schema.Literal("publishable") }), "unsupportedProfile");
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
const decodeKeys = commerceDecoder(Schema.Array(Schema.Struct({ id: Schema.String, token: Schema.String,
  revoked_at: Schema.NullOr(Schema.String) })), "storedCorruption");
const decodeLinks = commerceDecoder(Schema.Array(Schema.Struct({ publishable_key_id: Schema.String,
  sales_channel_id: Schema.String })), "storedCorruption");

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
      commands: Object.freeze([currencyCommands.list, currencyCommands.count]) }),
    apiKey: Object.freeze({ definition: yield* compileApiKeyCoreDefinition(target), initialization: Object.freeze({ ...initialization.apiKey }), commands: Object.freeze([keys]) }),
    apiKeySalesChannel: Object.freeze({ definition: yield* compileApiKeySalesChannelLinkCoreDefinition(target),
      initialization: Object.freeze({ ...initialization.apiKeySalesChannel }), commands: Object.freeze([associations]) }),
  } satisfies StoreRequestReadCatalog);
});

/** Each live Core generation constructs and owns fresh protected read hosts.
 * No schema installation, data seeding, initializer or write capability escapes. */
export const makeStoreRequestReads = Effect.fn("StoreRequestReads.make")(function* (input: Readonly<{
  database: CoreDatabase; hostRuntime: PreparedHostRuntime; catalog: StoreRequestReadCatalog; identityAndAccessPolicy: Json;
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
  const remoteQuery = Effect.fn("StoreRequestReads.remoteQuery")(function* (inputQuery: unknown) {
    const captured = yield* Effect.fromResult(captureCommerceInput(inputQuery));
    const { fields: requestedFields, __args: args } = (yield* Effect.fromResult(decodeRemote(captured))).__value.currency;
    // Native MikroORM discards the HTTP FieldParser's implicit nonmodel id,
    // and always hydrates/serializes the actual DML primary key, code.
    const fields = [...new Set(["code" as const, ...currencyColumns.filter(field => requestedFields.includes(field))])];
    // Native numeric serialization exposes both authenticated companion fields
    // when either side is selected, including the ordinary Store defaults.
    if (fields.includes("rounding") && !fields.includes("raw_rounding")) fields.push("raw_rounding");
    if (fields.includes("raw_rounding") && !fields.includes("rounding")) fields.push("rounding");
    const counted = args.take !== undefined;
    const config: JsonObject = { select: [...fields], ...(args.take === undefined ? {} : { take: args.take }),
      ...(args.skip === undefined ? {} : { skip: args.skip }), ...(args.order === undefined ? {} : { order: args.order }) };
    const result = yield* currency.read(counted ? currencyCommands.count : currencyCommands.list, { filters: args.filters ?? {}, config });
    const [rows, count] = counted ? yield* Effect.fromResult(values.decodeCountResult(result))
      : [yield* Effect.fromResult(values.decodeProjections(result)), 0] as const;
    const projected: JsonObject[] = [];
    for (const row of rows) {
      const presented = yield* Effect.fromResult(values.decodeProjection(yield* projectExactNumericColumns(row, [{ name: "rounding" }], "nativeOrm")));
      const entries: [string, Json][] = [];
      for (const field of fields) {
        const value = presented[field];
        if (value === undefined) return yield* commerceError("storedCorruption");
        entries.push([field, value]);
      }
      projected.push(Object.fromEntries(entries));
    }
    return counted ? { rows: projected, metadata: { count, skip: args.skip ?? 0, take: args.take ?? 256 } } : projected;
  });
  const graph = Effect.fn("StoreRequestReads.graph")(function* (inputQuery: unknown, options?: unknown) {
    const captured = yield* Effect.fromResult(captureCommerceInput(inputQuery));
    const query = yield* Effect.fromResult(decodeGraph(captured));
    if (options !== undefined) yield* Effect.fromResult(decodeGraphOptions(yield* Effect.fromResult(captureCommerceInput(options))));
    const keys = yield* Effect.fromResult(decodeKeys(yield* apiKey.read(keyCommand, query.filters)));
    if (keys.length === 0) return { data: [] };
    // Pinned RemoteJoiner.query fetches its root before handleExpands; each
    // remote-fetch-data service call receives filters/options and no shared
    // Context. Preserve those independent native read groups. The Link lookup
    // uses the captured key identity, never a second token lookup. This graph
    // does not promise a snapshot shared across key and Link service calls.
    // third_party/medusa/upstream/packages/core/orchestration/src/joiner/remote-joiner.ts
    // third_party/medusa/upstream/packages/core/modules-sdk/src/remote-query/remote-fetch-data.ts
    const channels = yield* Effect.fromResult(decodeLinks(yield* links.read(linkCommand, keys.map(key => key.id))));
    return { data: keys.map(key => ({ ...key, sales_channels_link: channels.filter(link => link.publishable_key_id === key.id)
      .map(link => ({ sales_channel_id: link.sales_channel_id })) })) };
  });
  return Object.freeze({ remoteQuery, query: Object.freeze({ graph }),
    close: currency.close.pipe(Effect.andThen(apiKey.close), Effect.andThen(links.close)) });
});
export type StoreRequestReads = Effect.Success<ReturnType<typeof makeStoreRequestReads>>;
