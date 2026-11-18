import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { projectNativeRow } from "../../repository/result";
import { captureCommerceInput } from "../../value/input";
import { captureExactNumericRow } from "../../value/exact-numeric";
import { captureNativeDateRecord, captureNativeRecord } from "../../value/native-record";
import { commerceDecoder } from "../../value/decoder";
import { decodeNativePaymentCreate, decodeNativeCaptureCreate, decodeNativeRefundCreate,
  decodeNativeSessionPatch, decodeNativePaymentPatch, NativeCollectionAccountingPatch } from "./lifecycle-input";
import { makeReadCatalog } from "../../query/catalog";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import { compileWhere } from "../../query/predicate";
import { executeRead, orderedCatalog, type ReadPlan } from "../../query/read";
import { bindCommerceRelationRows, populateCommerceRelations, type CommerceRelation } from "../../query/relations";
import type { capturePaymentMetadata } from "./schema";
import { compilePaymentContracts } from "./output";
import { PaymentId, PaymentSessionIds, PaymentSessionCreate } from "./input";
import { CollectionStoredPatch, CollectionCreates } from "./collection-input";
import { AccountHolderStoredCreate } from "./account-input";

const decodeQuery = commerceDecoder(Schema.Struct({ where: Schema.JsonObject, options: Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String)), populate: Schema.Array(Schema.String),
  limit: Schema.optionalKey(Schema.Literals([4, 15, 256])), offset: Schema.optionalKey(Schema.Literal(0)),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })) }) }), "unsupportedProfile");
const decodeNativeRows = Schema.decodeUnknownEffect(Schema.Array(Schema.Unknown).check(Schema.isLengthBetween(1, 1)));
const decodeDelete = commerceDecoder(Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: PaymentId })).check(Schema.isLengthBetween(1, 1)) }), "unsupportedProfile");
const decodeCollectionCreates = commerceDecoder(CollectionCreates, "unsupportedProfile");
const decodeHolderCreates = commerceDecoder(Schema.Array(AccountHolderStoredCreate).check(Schema.isLengthBetween(1, 1)), "unsupportedProfile");
const decodeSessionCreates = commerceDecoder(Schema.Array(PaymentSessionCreate).check(Schema.isLengthBetween(1, 1)), "unsupportedProfile");
const decodeCollectionPatch = commerceDecoder(Schema.Union([
  CollectionStoredPatch,
  NativeCollectionAccountingPatch,
]), "unsupportedProfile");
const scalarProjection: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map() };
const sessionCollectionWhere = { ...scalarIdWhere, fields: new Map([...scalarIdWhere.fields,
  ["payment_collection_id", { column: "payment_collection_id", decode: commerceDecoder(Schema.Union([PaymentId, PaymentSessionIds]), "unsupportedProfile") }] as const]) };

/** Two named repository extensions share scalar construction, one borrowed
 * manager and native event state. Other native Payment models stay denied. */
export function preparePaymentSessionRepository(metadata: Effect.Success<ReturnType<typeof capturePaymentMetadata>>["frame"]) {
  return Result.gen(function* () {
    const contracts = yield* compilePaymentContracts(metadata), { collection, session, payment, capture, refund, reason, holder } = contracts;
    const collectionScalar = yield* prepareScalarRepository(collection, "PaymentCollection", scalarIdWhere);
    const sessionScalar = yield* prepareScalarRepository(session, "PaymentSession", scalarIdWhere);
    const paymentScalar = yield* prepareScalarRepository(payment, "Payment", scalarIdWhere);
    const captureScalar = yield* prepareScalarRepository(capture, "Capture", scalarIdWhere);
    const refundScalar = yield* prepareScalarRepository(refund, "Refund", scalarIdWhere);
    const holderScalar = yield* prepareScalarRepository(holder, "AccountHolder", scalarIdWhere);
    const many = collection.relationships.find(relation => relation.name === "payment_sessions");
    if (many?.type !== "hasMany" || many.targetTable !== session.name) return yield* Result.fail(commerceError("unsupportedProfile"));
    const declaredRelations = new Map<string, Map<string, CommerceRelation>>([
      [collection.name, new Map([["payment_sessions", { name: "payment_sessions", sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"],
        targetTable: session.name, join: { type: "hasMany", foreignKeys: ["payment_collection_id"] } }],
        ["payments", { name: "payments", sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"], targetTable: payment.name,
          join: { type: "hasMany", foreignKeys: ["payment_collection_id"] } }]])],
      [session.name, new Map([["payment_collection", { name: "payment_collection", sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"],
        targetTable: collection.name, join: { type: "belongsTo", foreignKeys: ["payment_collection_id"] } }],
        ["payment", { name: "payment", sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"], targetTable: payment.name,
          join: { type: "hasOne", foreignKeys: ["payment_session_id"] } }]])],
      [payment.name, new Map([
        ["payment_collection", { name: "payment_collection", sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"], targetTable: collection.name,
          join: { type: "belongsTo", foreignKeys: ["payment_collection_id"] } }],
        ["payment_session", { name: "payment_session", sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"], targetTable: session.name,
          join: { type: "belongsTo", foreignKeys: ["payment_session_id"] } }],
        ["captures", { name: "captures", sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"], targetTable: capture.name,
          join: { type: "hasMany", foreignKeys: ["payment_id"] } }],
        ["refunds", { name: "refunds", sourcePrimaryKeys: ["id"], targetPrimaryKeys: ["id"], targetTable: refund.name,
          join: { type: "hasMany", foreignKeys: ["payment_id"] } }],
      ])],
    ]);
    for (const [source, members] of declaredRelations) for (const [name, descriptor] of members) {
      const declared = metadata.tables.find(table => table.name === source)?.relationships.find(relation => relation.name === name);
      if (declared?.type !== descriptor.join.type || declared.targetTable !== descriptor.targetTable)
        return yield* Result.fail(commerceError("unsupportedProfile"));
    }
    const catalog = yield* makeReadCatalog([collection, session, payment, capture, refund, reason, holder].map(table => ({ name: table.name,
      columns: table.columns.map(column => column.name), primaryKeys: ["id"], foreignKeys: table.foreignKeys.flatMap(key => key.columns),
      companions: Object.fromEntries(table.columns.filter(column => column.type === "bigNumber").map(column => [column.name, "raw_" + column.name])) })), declaredRelations);
    const relations = catalog.relations;
    const paymentProjection: ProjectionPolicy = { ...scalarProjection, selectableRelations: ["captures", "refunds", "payment_session", "payment_collection"],
      nested: new Map([["captures", scalarProjection], ["refunds", scalarProjection], ["payment_session", scalarProjection], ["payment_collection", scalarProjection]]) };
    const sessionProjection: ProjectionPolicy = { ...scalarProjection, selectableRelations: ["payment", "payment_collection"],
      nested: new Map([["payment", paymentProjection], ["payment_collection", scalarProjection]]) };
    const collectionProjection: ProjectionPolicy = { ...scalarProjection, selectableRelations: ["payment_sessions", "payments"],
      nested: new Map([["payment_sessions", scalarProjection], ["payments", paymentProjection]]) };
    const query = (table: typeof collection, input: unknown) => Result.gen(function* () {
      const value = yield* captureCommerceInput(input).pipe(Result.flatMap(decodeQuery)), paths: string[] = [];
      // Native loadRelationsFromTree ignores a terminal scalar population node.
      // Admit only declared scalar leaves, while retaining every relation prefix.
      for (const path of [...value.options.populate, ...(value.options.fields ?? []).filter(field => field.includes("."))]) {
        let source = table.name; const parts = path.split("."), prefix: string[] = [];
        for (const [index, name] of parts.entries()) {
          const relation = relations.get(source)?.get(name);
          if (relation === undefined) {
            const selected = yield* catalog.table(source);
            if (index !== parts.length - 1 || prefix.length === 0 || !selected.columns.includes(name)) return yield* Result.fail(commerceError("unsupportedProfile"));
          } else { prefix.push(name); paths.push(prefix.join(".")); source = relation.targetTable; }
        }
      }
      const selectedPaths = [...new Set(paths)];
      const allowed = table === collection ? ["payment_sessions", "payments", "payments.captures", "payments.refunds"] :
        table === session ? ["payment_collection", "payment", "payment.captures", "payment.refunds"] :
          table === payment ? ["payment_collection", "payment_session", "captures", "refunds"] : [];
      if (selectedPaths.some(path => !allowed.includes(path))) return yield* Result.fail(commerceError("unsupportedProfile"));
      const projection = yield* compileProjection(catalog, table.name, value.options.fields, selectedPaths,
        table === collection ? collectionProjection : table === session ? sessionProjection : table === payment ? paymentProjection : scalarProjection);
      const predicate = yield* compileWhere(value.where, table === session ? sessionCollectionWhere : scalarIdWhere);
      return { table: table.name, projection, paths: selectedPaths, relationFilters: [], ordering: new Map(), withDeleted: false,
        query: { skip: 0, order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [predicate, { kind: "isNull", column: "deleted_at" }] } },
        window: { kind: "catalog", order: "id", select: orderedCatalog("asc") } } satisfies ReadPlan;
    });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const collections = collectionScalar.bind(root, owner), sessions = sessionScalar.bind(root, owner, collections.events, collections.bridge);
      const { bridge, events } = collections, denied = deniedCommerceRepository(collections.repository, collections.refuse);
      const payments = paymentScalar.bind(root, owner, events, bridge), captures = captureScalar.bind(root, owner, events, bridge),
        refunds = refundScalar.bind(root, owner, events, bridge), holders = holderScalar.bind(root, owner, events, bridge);
      // Serialization receives no native model argument. Retain the origin of
      // this command's detached DAL values, including empty/partial selections.
      const origins = new WeakMap<object, string>();
      const remember = (table: string, rows: JsonObject[]) => {
        origins.set(rows, table);
        for (const row of rows) {
          origins.set(row, table);
          for (const name of declaredRelations.get(table)?.keys() ?? []) {
            const relation = relations.get(table)?.get(name);
            if (relation === undefined) continue;
            const child = row[name];
            if (Array.isArray(child) && child.every(isJsonObject)) {
              const children: JsonObject[] = child; remember(relation.targetTable, children);
            } else if (child !== undefined && isJsonObject(child)) remember(relation.targetTable, [child]);
          }
        }
        return rows;
      };
      const find = (table: typeof collection, input: unknown, shared: Parameters<DAL.RepositoryService["find"]>[1], count: boolean) =>
        bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const plan = yield* Effect.fromResult(query(table, captured));
          return yield* executeRead({ ...ctx, admitSelection: (name, rows) => Result.gen(function* () {
            if (rows.length > 4) return yield* Result.fail(commerceError("limitExceeded"));
            const decode = name === collection.name ? contracts.decodeCollection : name === session.name ? contracts.decodeSession :
              name === payment.name ? contracts.decodePayment : name === capture.name ? contracts.decodeCapture : name === refund.name ? contracts.decodeRefund :
                name === holder.name ? contracts.decodeHolder : contracts.decodeReason;
            for (const row of rows) yield* decode(projectNativeRow(row));
          }) }, catalog, plan, count);
        })));
      const serialize: DAL.RepositoryService["serialize"] = <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> =>
        owner.run(bridge.checked(root, Effect.gen(function* () {
          if (options !== undefined) return yield* root.refuse(commerceError("unsupportedProfile"));
          const value = yield* Effect.fromResult(captureCommerceInput(input, root.resources));
          let table = input !== null && typeof input === "object" ? origins.get(input) : undefined;
          // Native upsert flattens its operation arrays. Authenticate every
          // retained row of that new container, never infer a model from JSON.
          if (table === undefined && Array.isArray(input) && Array.isArray(value) && value.length > 0 && value.length <= 4) {
            const properties = yield* Effect.try({ try: () => Object.getOwnPropertyDescriptors(input),
              catch: cause => commerceError("storedCorruption", cause) });
            for (let index = 0; index < value.length; index++) {
              const property = properties[String(index)];
              const row: unknown = property !== undefined && "value" in property ? property.value : undefined;
              const origin = row !== null && typeof row === "object" ? origins.get(row) : undefined;
              if (origin === undefined || table !== undefined && table !== origin)
                return yield* root.refuse(commerceError("storedCorruption"));
              table = origin;
            }
          }
          if (table === undefined) return yield* root.refuse(commerceError("storedCorruption"));
          // SAFETY: native DAL's selected DTO generic is checked against complete
          // metadata projections and exact-number companions before returning.
          const output = yield* contracts.present(value, table);
          if (output !== null && typeof output === "object") origins.set(output, table);
          return output as Output;
        })));
      const readMethods = (table: typeof collection): Pick<DAL.RepositoryService, "find" | "findAndCount"> => ({
        find: async (input, shared) => remember(table.name, structuredClone((await find(table, input, shared, false)).rows)),
        findAndCount: async (input, shared) => { const value = await find(table, input, shared, true);
          return [remember(table.name, structuredClone(value.rows)), value.count ?? 0]; },
      });
      const deleteRows = (table: typeof collection,
        decode: typeof contracts.decodeSession): DAL.RepositoryService["delete"] => (input, shared) =>
        bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const selection = yield* Effect.fromResult(decodeDelete(captured));
          const rows = yield* (yield* ctx.table(table.name)).delete(ctx.manager, selection.$or);
          const ids: string[] = [];
          for (const row of rows) ids.push((yield* Effect.fromResult(decode(projectNativeRow(row)))).id);
          return ids;
        })));
      const updateRows = (table: typeof collection, model: "PaymentSession" | "Payment" | "PaymentCollection"): DAL.RepositoryService["update"] =>
        (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const patches: JsonObject[] = [];
          const numbers = model === "PaymentCollection" ? contracts.collectionNumbers : model === "Payment" ? contracts.paymentNumbers : contracts.sessionNumbers;
          const decode = model === "PaymentCollection" ? contracts.decodeCollection : model === "Payment" ? contracts.decodePayment : contracts.decodeSession;
          for (const value of yield* decodeNativeRows(input).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)))) {
            const pair = yield* captureNativeRecord(value), entity = yield* Effect.fromResult(captureCommerceInput(pair.entity).pipe(Result.flatMap(decode)));
            const dates = model === "PaymentCollection" ? ["completed_at"] : model === "Payment" ? ["captured_at", "canceled_at"] : ["authorized_at"];
            const data = yield* captureNativeDateRecord(pair.update, dates);
            const encoded = yield* captureExactNumericRow(data, numbers, false, model === "PaymentCollection" ? "nativeRaw" : "scalar");
            const patch = model === "PaymentCollection" ? yield* Effect.fromResult(decodeCollectionPatch(encoded)) :
              model === "Payment" ? yield* Effect.fromResult(decodeNativePaymentPatch(encoded)) : yield* Effect.fromResult(decodeNativeSessionPatch(encoded));
            if (entity.id !== patch.id || model !== "PaymentCollection" && entity.provider_id !== "pp_system_default")
              return yield* ctx.refuse(commerceError("unsupportedProfile"));
            patches.push(patch);
          }
          const rows = yield* (yield* ctx.table(table.name)).write(ctx.manager, "update", patches);
          for (const row of rows) yield* Effect.fromResult(decode(projectNativeRow(row)));
          if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.rows("afterUpdate", model, [...rows], shared);
          return remember(table.name, [...rows]);
        })));
      const collectionRepository: DAL.RepositoryService = { ...denied, serialize, ...readMethods(collection),
        update: updateRows(collection, "PaymentCollection"),
        delete: deleteRows(collection, contracts.decodeCollection),
        create: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const data = yield* Effect.fromResult(decodeCollectionCreates(captured));
          const rows = [];
          for (const row of data) rows.push(yield* captureExactNumericRow(row, contracts.collectionNumbers, true, "nativeRaw"));
          const inserted = yield* collections.createRows(ctx, rows, shared);
          return remember(collection.name, inserted.map(row => ({ ...row, payment_providers: [], payment_sessions: [], payments: [] })));
        }))),
      };
      const sessionRepository: DAL.RepositoryService = { ...denied, serialize, ...readMethods(session),
        create: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
          const data = yield* Effect.fromResult(decodeSessionCreates(captured));
          const rows = [];
          for (const row of data) rows.push(yield* captureExactNumericRow(row, contracts.sessionNumbers, true, "nativeRaw"));
          return remember(session.name, [...yield* sessions.createRows(ctx, rows, shared)]);
        }))),
        update: updateRows(session, "PaymentSession"),
        delete: deleteRows(session, contracts.decodeSession),
      };
      const paymentRepository: DAL.RepositoryService = { ...denied, serialize, ...readMethods(payment), update: updateRows(payment, "Payment"),
        create: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const rows: JsonObject[] = [];
          for (const value of yield* decodeNativeRows(input).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)))) {
            const row = yield* Effect.fromResult(decodeNativePaymentCreate(yield* captureExactNumericRow(value, contracts.paymentNumbers)));
            const { payment_session, ...scalar } = row; rows.push({ ...scalar, payment_session_id: payment_session });
          }
          const inserted = yield* payments.createRows(ctx, rows, shared);
          return remember(payment.name, (yield* populateCommerceRelations(bindCommerceRelationRows(ctx), payment.name, inserted, ["payment_session"], relations, new Map()))
            .map(row => ({ ...row, captures: [], refunds: [] })));
        }))),
      };
      const captureRepository: DAL.RepositoryService = { ...denied, serialize, ...readMethods(capture),
        delete: deleteRows(capture, contracts.decodeCapture),
        create: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const rows: JsonObject[] = [];
          for (const value of yield* decodeNativeRows(input).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)))) {
            const row = yield* Effect.fromResult(decodeNativeCaptureCreate(yield* captureExactNumericRow(value, contracts.captureNumbers)));
            // Native SQL insertion ignores captured_by: Capture declares
            // created_by, while PaymentModuleService submits captured_by.
            const { payment, captured_by: _actor, ...scalar } = row; rows.push({ ...scalar, payment_id: payment });
          }
          return remember(capture.name, [...yield* captures.createRows(ctx, rows, shared)]);
        }))),
      };
      const refundRepository: DAL.RepositoryService = { ...denied, serialize, ...readMethods(refund),
        delete: deleteRows(refund, contracts.decodeRefund),
        create: (input, shared) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          const rows: JsonObject[] = [];
          for (const value of yield* decodeNativeRows(input).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)))) {
            const row = yield* Effect.fromResult(decodeNativeRefundCreate(yield* captureExactNumericRow(value, contracts.refundNumbers, false, "nativeRaw")));
            const { payment, ...scalar } = row; rows.push({ ...scalar, payment_id: payment });
          }
          return remember(refund.name, [...yield* refunds.createRows(ctx, rows, shared)]);
        }))),
      };
      const reasonRepository: DAL.RepositoryService = { ...denied, serialize, ...readMethods(reason) };
      const holderRepository: DAL.RepositoryService = { ...denied, serialize, ...readMethods(holder), delete: deleteRows(holder, contracts.decodeHolder),
        create: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const data = yield* Effect.fromResult(decodeHolderCreates(captured));
          return remember(holder.name, [...yield* holders.createRows(ctx, data, shared)]);
        }))),
      };
      return { bridge, mutationEvents: collections.mutationEvents, refuse: collections.refuse, denied, collectionRepository, sessionRepository,
        paymentRepository, captureRepository, refundRepository, reasonRepository, holderRepository };
    };
    return { bind, contracts, catalog, query, relations };
  });
}
