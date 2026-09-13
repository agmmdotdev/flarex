import { Effect, Schema } from "effect";
import { isJsonObject, JsonValue, type Json } from "flarex-protocol/json";
import { cmsError, type CmsCommandContext } from "@flarex/persistence-postgres/internal/cms-adapter";
import { payloadHasMany, type PayloadContentProfile } from "./contract";
import type { PayloadCollectionRuntime } from "./collectionRuntime";
import { UnsupportedPayloadCapability } from "./errors";
import { payloadJoinQuery } from "./joins";
import { payloadManyIds } from "./many";
import { decodePayloadPaging } from "./query";

// Envelopes check keys first. Native Payload validation and the ordered admission
// steps below still own field values, defaults, and their original error family.
const field = Schema.optional(Schema.Unknown);
const CreateEnvelope = Schema.Struct({ collection: field, data: field });
const UpdateEnvelope = Schema.Struct({ collection: field, id: field, data: field });
const IdEnvelope = Schema.Struct({ collection: field, id: field });
const CountEnvelope = Schema.Struct({ collection: field, where: field });
const ReadEnvelope = Schema.Struct({ depth: field, where: field, joins: field });
const findFields = { collection: field, where: field, page: field, limit: field, pagination: field, sort: field, depth: field };
const findByIdFields = { collection: field, id: field, depth: field };
const strict = { onExcessProperty: "error" } as const;
const decodeCreateEnvelope = Schema.decodeUnknownEffect(CreateEnvelope, strict);
const decodeUpdateEnvelope = Schema.decodeUnknownEffect(UpdateEnvelope, strict);
const decodeIdEnvelope = Schema.decodeUnknownEffect(IdEnvelope, strict);
const decodeCountEnvelope = Schema.decodeUnknownEffect(CountEnvelope, strict);
const decodeData = Schema.decodeUnknownEffect(Schema.Record(Schema.String, JsonValue));
const decodeId = Schema.decodeUnknownEffect(Schema.String);
const decodeDepth = Schema.decodeUnknownEffect(Schema.Literals([0, 1]));
const decodeOneRelation = Schema.decodeUnknownEffect(Schema.NullOr(Schema.String));

const envelope = Effect.fn("PayloadInput.envelope")(function* <A>(
  decode: (input: unknown) => Effect.Effect<A, Schema.SchemaError>, input: Json,
) {
  if (!isJsonObject(input)) return yield* Effect.fail(cmsError("invalidInput"));
  return yield* decode(input).pipe(Effect.mapError(cause => cmsError("unsupportedProfile", cause)));
});

/** Compiled once per closed profile; instances coexist in rebinding proofs. */
export function makePayloadInputs(profile: PayloadContentProfile, collections: readonly PayloadCollectionRuntime[]) {
  const select = Effect.fn("PayloadInput.collection")(function* (slug: unknown) {
    const collection = collections.find(candidate => candidate.collectionSlug === slug);
    if (collection === undefined) return yield* Effect.fail(cmsError("unsupportedProfile"));
    return collection;
  });
  const decodeFindEnvelope = Schema.decodeUnknownEffect(Schema.Struct({ ...findFields,
    joins: profile === "payload.content-joins" ? field : Schema.optional(Schema.Never),
  }), strict);
  const decodeFindByIdEnvelope = Schema.decodeUnknownEffect(Schema.Struct({ ...findByIdFields,
    joins: profile === "payload.content-joins" ? field : Schema.optional(Schema.Never),
  }), strict);

  const writeData = Effect.fn("PayloadInput.writeData")(function* (context: CmsCommandContext, collection: PayloadCollectionRuntime, input: unknown) {
    const data = yield* decodeData(input).pipe(Effect.mapError(cause => cmsError("unsupportedProfile", cause)));
    if (Object.keys(data).some(key => !collection.writableNames.has(key))) {
      return yield* Effect.fail(cmsError("unsupportedProfile", new UnsupportedPayloadCapability("input fields")));
    }
    const relation = collection.oneRelationship;
    if (relation !== undefined && data[relation.name] !== undefined) yield* decodeOneRelation(data[relation.name]).pipe(
      Effect.mapError(cause => cmsError("relationInvalid", cause)));
    if (payloadHasMany(profile) && Object.hasOwn(data, "relatedPosts")) {
      const ids = yield* Effect.fromResult(payloadManyIds(data.relatedPosts));
      // This capability authenticates table identity; finalization owns liveness.
      if (ids.length > 0) yield* context.documents.getMany(context.context, context.transactionId, collection.logicalTableName, ids);
    }
    return data;
  });

  const readOptions = Effect.fn("PayloadInput.readOptions")(function* (context: CmsCommandContext, collection: PayloadCollectionRuntime, args: typeof ReadEnvelope.Type) {
    const depth = yield* decodeDepth(args.depth === undefined ? 0 : args.depth).pipe(
      Effect.mapError(cause => cmsError("unsupportedProfile", cause)));
    if (depth === 1 && (profile === "payload.scalar" || !context.standaloneRead)) {
      return yield* Effect.fail(cmsError("unsupportedProfile"));
    }
    const where = yield* Effect.fromResult(collection.query.decode(args.where === undefined ? {} : args.where)).pipe(
      Effect.mapError(() => cmsError("invalidInput", new UnsupportedPayloadCapability("where"))));
    const joinRead = profile === "payload.content-joins" && context.standaloneRead;
    if (args.joins !== undefined && !joinRead) return yield* Effect.fail(cmsError("unsupportedProfile"));
    const joins = yield* Effect.fromResult(payloadJoinQuery(joinRead ? args.joins : false));
    return { depth, where, joins, joinRead };
  });

  return {
    create: Effect.fn("PayloadInput.create")(function* (context: CmsCommandContext, input: Json) {
      const args = yield* envelope(decodeCreateEnvelope, input);
      const collection = yield* select(args.collection);
      return { collection, data: yield* writeData(context, collection, args.data) };
    }),
    update: Effect.fn("PayloadInput.update")(function* (context: CmsCommandContext, input: Json) {
      const args = yield* envelope(decodeUpdateEnvelope, input);
      const collection = yield* select(args.collection);
      const data = yield* writeData(context, collection, args.data);
      const id = yield* decodeId(args.id).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
      return { collection, id, data };
    }),
    delete: Effect.fn("PayloadInput.delete")(function* (_context: CmsCommandContext, input: Json) {
      const args = yield* envelope(decodeIdEnvelope, input);
      const collection = yield* select(args.collection);
      return { collection, id: yield* decodeId(args.id).pipe(Effect.mapError(cause => cmsError("invalidInput", cause))) };
    }),
    findByID: Effect.fn("PayloadInput.findByID")(function* (context: CmsCommandContext, input: Json) {
      const args = yield* envelope(decodeFindByIdEnvelope, input);
      const collection = yield* select(args.collection);
      const read = yield* readOptions(context, collection, args);
      const id = yield* decodeId(args.id).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
      return { collection, ...read, id };
    }),
    find: Effect.fn("PayloadInput.find")(function* (context: CmsCommandContext, input: Json) {
      const args = yield* envelope(decodeFindEnvelope, input);
      const collection = yield* select(args.collection);
      const read = yield* readOptions(context, collection, args);
      const paging = yield* Effect.fromResult(decodePayloadPaging({ page: args.page, limit: args.limit,
        pagination: args.pagination, sort: args.sort })).pipe(
        Effect.mapError(() => cmsError("unsupportedProfile", new UnsupportedPayloadCapability("query options"))));
      return { collection, ...read, ...paging };
    }),
    count: Effect.fn("PayloadInput.count")(function* (_context: CmsCommandContext, input: Json) {
      const args = yield* envelope(decodeCountEnvelope, input);
      const collection = yield* select(args.collection);
      const where = yield* Effect.fromResult(collection.query.decode(args.where === undefined ? {} : args.where)).pipe(
        Effect.mapError(() => cmsError("invalidInput", new UnsupportedPayloadCapability("where"))));
      return { collection, where };
    }),
  };
}

export type PayloadInputs = ReturnType<typeof makePayloadInputs>;
export type PayloadCreateInput = Effect.Success<ReturnType<PayloadInputs["create"]>>;
export type PayloadUpdateInput = Effect.Success<ReturnType<PayloadInputs["update"]>>;
export type PayloadDeleteInput = Effect.Success<ReturnType<PayloadInputs["delete"]>>;
export type PayloadFindInput = Effect.Success<ReturnType<PayloadInputs["find"]>>;
export type PayloadFindByIdInput = Effect.Success<ReturnType<PayloadInputs["findByID"]>>;
export type PayloadCountInput = Effect.Success<ReturnType<PayloadInputs["count"]>>;
