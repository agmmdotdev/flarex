import { AsyncLocalStorage } from "node:async_hooks";
import { APIError, ValidationError, type BaseDatabaseAdapter, type DatabaseAdapterObj,
  type PayloadRequest, type TypeWithID, type PaginatedDocs } from "payload";
import { Clock, Effect, Result } from "effect";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { capturePrivateJsonData } from "../privateJsonData";
import { cmsError, type CmsTransactionError, type CmsPresentedTransactionId } from "../cmsTransaction/model";
import type { CmsCommandContext } from "../cmsTransaction/host";
import type { PayloadContentProfile } from "./contract";

export class UnsupportedPayloadScalarCapability extends APIError {
  constructor(readonly capability: string) { super(`Unsupported private Payload scalar capability: ${capability}`, 400); }
}
interface RequestBridge {
  readonly context: CmsCommandContext;
  readonly request: Partial<PayloadRequest>;
  readonly signal: AbortSignal;
  live: boolean;
}

const transactionId = (state: RequestBridge): CmsPresentedTransactionId => {
  const id = state.request.transactionID;
  if (typeof id === "number") throw new UnsupportedPayloadScalarCapability("numeric transaction ID");
  // Payload declares Promise<number|string>; validate the resolved compatibility input.
  return id instanceof Promise ? id.then(value => {
    if (typeof value !== "string") throw new UnsupportedPayloadScalarCapability("numeric transaction ID");
    return value;
  }) : id;
};
const run = <Value>(state: RequestBridge, effect: Effect.Effect<Value, CmsTransactionError>): Promise<Value> =>
  Effect.runPromise(effect.pipe(Effect.mapError(error => error.reason === "uniqueConflict"
    ? new ValidationError({ collection: "posts", errors: [{ path: "title", tableName: "posts", message: state.request.t?.("error:valueMustBeUnique") ?? "Value must be unique" }], req: state.request }, state.request.t)
    : error)), { signal: state.signal });
// oxlint-disable-next-line flarex/no-result-get-or-throw-without-boundary -- REVIEW: compatibility - Payload requires a throwing parser over the owned Result decoder.
const capture = (value: unknown): Json => Result.getOrThrow(capturePrivateJsonData(value, 65_536, cmsError)).value;
type ScalarPredicate = { _id?: string; title?: string };
const where = (input: unknown): ScalarPredicate => {
  let value = input === undefined ? {} : capture(input);
  // Pinned Payload combineQueries wraps its caller's admitted flat predicate once.
  if (isJsonObject(value) && Object.keys(value).join() === "and" && Array.isArray(value.and) && value.and.length <= 1) value = value.and[0] ?? {};
  if (!isJsonObject(value)) throw new UnsupportedPayloadScalarCapability("where");
  const fields: ScalarPredicate = {};
  for (const [field, operator] of Object.entries(value)) {
    if (!["id", "title"].includes(field) || !isJsonObject(operator) || Object.keys(operator).join() !== "equals" || typeof operator.equals !== "string") {
      throw new UnsupportedPayloadScalarCapability("where operator");
    }
    fields[field === "id" ? "_id" : "title"] = operator.equals;
  }
  return fields;
};
const payloadDocument = (value: Json, profile: PayloadContentProfile): Record<string, Json> & { id: string } => {
  if (!isJsonObject(value) || typeof value._id !== "string") throw new Error("Invalid admitted CMS document");
  const { _id, _creationTime, ...fields } = value;
  return { ...fields, ...(profile === "payload.content-relations" ? { relatedPost: fields.relatedPost ?? null } : {}), id: _id };
};
const payloadFields = (profile: PayloadContentProfile, input: Record<string, unknown>, expectedId?: string, creationTimestamp?: string) => {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "id") {
      if (value !== undefined && value !== expectedId) throw new UnsupportedPayloadScalarCapability("caller-selected identity");
      continue;
    }
    if (key === "relatedPost" && profile === "payload.content-relations") {
      if (value === null || value === undefined) continue;
      if (typeof value !== "string") throw new UnsupportedPayloadScalarCapability("relation identity");
      normalized[key] = value;
      continue;
    }
    if (!["title", "score", "enabled", "publishedAt", "createdAt", "updatedAt"].includes(key)) throw new UnsupportedPayloadScalarCapability("document fields");
    if (value === undefined && ["createdAt", "updatedAt"].includes(key)) continue;
    if (["createdAt", "updatedAt", "publishedAt"].includes(key)) {
      if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new UnsupportedPayloadScalarCapability("date");
      normalized[key] = new Date(value).toISOString();
    } else normalized[key] = value;
  }
  if (creationTimestamp !== undefined) {
    normalized.createdAt ??= creationTimestamp;
    normalized.updatedAt ??= creationTimestamp;
  }
  const value = capture(normalized);
  if (!isJsonObject(value)) throw new Error("Invalid captured Payload fields");
  return value;
};

/** Node-only, per-Payload-instance foreign Promise boundary; it owns no database. */
export function makePayloadScalarAdapter(profile: PayloadContentProfile = "payload.scalar") {
  const document = (value: Json) => payloadDocument(value, profile);
  const fields = (input: Record<string, unknown>, expectedId?: string, creationTimestamp?: string) => payloadFields(profile, input, expectedId, creationTimestamp);
  const current = new AsyncLocalStorage<RequestBridge>();
  const touched = new Set<string>();
  const unsupported = async (capability = "deferred adapter member"): Promise<never> => {
    const state = current.getStore();
    if (state?.live) await Effect.runPromise(state.context.rollback(state.context.transactionId).pipe(Effect.exit), { signal: state.signal });
    throw new UnsupportedPayloadScalarCapability(capability);
  };
  const deferred = () => unsupported();
  const stateFor = (request?: Partial<PayloadRequest>, projected = false): RequestBridge => {
    const state = current.getStore();
    const exactProjection = state !== undefined && projected && request !== undefined &&
      Object.keys(request).join() === "transactionID" && request.transactionID === state.request.transactionID;
    if (state === undefined || !state.live || state.signal.aborted || (request !== state.request && !exactProjection)) {
      throw new UnsupportedPayloadScalarCapability("unadmitted request");
    }
    return state;
  };
  const admit = (args: { collection: string; req?: Partial<PayloadRequest>; locale?: string; select?: unknown; joins?: unknown;
    returning?: boolean; draft?: boolean; draftsEnabled?: boolean }, projected = false) => {
    const state = stateFor(args.req, projected);
    if (args.collection !== "posts" || args.locale !== undefined || args.returning === false || args.draft || args.draftsEnabled ||
      [args.select, args.joins].some(value => value !== undefined && (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 0))) {
      throw new UnsupportedPayloadScalarCapability("collection or projection");
    }
    touched.add(args.collection);
    return state;
  };
  const one = async (args: Parameters<BaseDatabaseAdapter["findOne"]>[0]) => {
    const state = admit(args, true);
    const result = await run(state, state.context.documents.find(state.context.context, transactionId(state), "posts", { where: where(args.where), offset: 0, limit: 1 }));
    return result.docs[0] === undefined ? null : document(result.docs[0]);
  };
  const adapter: DatabaseAdapterObj = { name: "flarex-private-scalar", defaultIDType: "text", init: ({ payload }) => ({
    name: "flarex-private-scalar", packageName: "flarex-private-scalar", defaultIDType: "text", payload, migrationDir: "",
    beginTransaction: () => { const state = current.getStore();
      if (state === undefined || !state.live || state.request.transactionID == null) return unsupported("begin without admitted ID");
      return run(state, state.context.begin(transactionId(state))); },
    commitTransaction: id => { const state = current.getStore(); return state === undefined ? unsupported("commit without host") :
      run(state, state.context.commit(typeof id === "number" ? "invalid" : id instanceof Promise ? id.then(String) : id)); },
    rollbackTransaction: id => { const state = current.getStore(); return state === undefined ? unsupported("rollback without host") :
      run(state, state.context.rollback(typeof id === "number" ? "invalid" : id instanceof Promise ? id.then(String) : id)); },
    create: async args => { const state = admit(args); if (args.customID !== undefined) return unsupported("custom ID");
      const timestamp = new Date(await run(state, Clock.currentTimeMillis)).toISOString();
      return document(await run(state, state.context.documents.insert(state.context.context, transactionId(state), "posts", fields(args.data, undefined, timestamp)))); },
    findOne: async <T extends TypeWithID>(args: Parameters<BaseDatabaseAdapter["findOne"]>[0]) => {
      // SAFETY: Payload's caller-selected generic describes its configured collection.
      // The closed profile validates the actual wire document; no generic grants authority.
      return await one(args) as T | null;
    },
    find: async <T>(args: Parameters<BaseDatabaseAdapter["find"]>[0]): Promise<PaginatedDocs<T>> => {
      const state = admit(args);
      const limit = args.limit ?? 10; const page = args.page ?? 1;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32 || !Number.isSafeInteger(page) || page < 1 || page > 257 ||
        args.skip !== undefined || args.projection !== undefined || args.versions || (args.sort !== undefined && args.sort !== "id" && !(Array.isArray(args.sort) && args.sort.length === 1 && args.sort[0] === "id"))) {
        return unsupported("pagination or sort");
      }
      const found = await run(state, state.context.documents.find(state.context.context, transactionId(state), "posts", { where: where(args.where), offset: (page - 1) * limit, limit }));
      const paginated = args.pagination !== false;
      const totalDocs = paginated ? found.total : found.docs.length;
      const totalPages = paginated ? Math.max(1, Math.ceil(totalDocs / limit)) : 1;
      // SAFETY: same closed Payload collection-generic boundary as findOne.
      const docs = found.docs.map(document) as T[];
      return { docs, totalDocs, limit, totalPages, page, pagingCounter: paginated ? (page - 1) * limit + 1 : 1,
        hasPrevPage: paginated && page > 1, hasNextPage: paginated && page < totalPages, prevPage: paginated && page > 1 ? page - 1 : null, nextPage: paginated && page < totalPages ? page + 1 : null };
    },
    count: async args => { const state = admit(args); const result = await run(state, state.context.documents.find(state.context.context, transactionId(state), "posts", { where: where(args.where), offset: 0, limit: 1 })); return { totalDocs: result.total }; },
    updateOne: async args => { const state = admit(args); const prior = args.id === undefined ? await one(args) : null;
      const id = args.id ?? prior?.id;
      if (typeof id !== "string") return unsupported("missing update identity");
      if (profile === "payload.content-relations" && args.data.relatedPost === null) {
        const priorDocument = await run(state, state.context.documents.get(state.context.context, transactionId(state), id));
        if (priorDocument === null) throw new Error("Payload update lost its admitted document");
        const { _id, _creationTime, relatedPost: _relatedPost, ...retained } = priorDocument;
        return document(await run(state, state.context.documents.replace(state.context.context, transactionId(state), id, { ...retained, ...fields(args.data, id) })));
      }
      return document(await run(state, state.context.documents.patch(state.context.context, transactionId(state), id, fields(args.data, id)))); },
    deleteOne: async args => { const state = admit(args); const prior = await one(args); if (prior === null) return unsupported("missing delete identity");
      await run(state, state.context.documents.delete(state.context.context, transactionId(state), prior.id)); return prior; },
    countGlobalVersions: deferred, countVersions: deferred, createGlobal: deferred, createGlobalVersion: deferred, createMigration: deferred,
    createVersion: deferred, deleteMany: async args => {
      const state = stateFor(args.req);
      if (args.collection !== "payload-preferences" || Object.keys(args).some(key => !["collection", "req", "where"].includes(key))) return unsupported(`deleteMany:${args.collection}`);
      await run(state, state.context.preferences.deleteForPendingPost(state.context.context, transactionId(state), args.where));
      touched.add(args.collection);
    }, deleteVersions: deferred, findDistinct: deferred, findGlobal: deferred,
    findGlobalVersions: deferred, findVersions: deferred, generateSchema: deferred, migrate: deferred, migrateDown: deferred,
    migrateFresh: deferred, migrateRefresh: deferred, migrateReset: deferred, migrateStatus: deferred, queryDrafts: deferred,
    updateGlobal: deferred, updateGlobalVersion: deferred, updateJobs: deferred, updateMany: deferred, updateVersion: deferred, upsert: deferred,
  } satisfies BaseDatabaseAdapter) };
  const within = async <Value>(context: CmsCommandContext, request: Partial<PayloadRequest>, signal: AbortSignal, work: () => Promise<Value>) => {
    const state: RequestBridge = { context, request, signal, live: true };
    try { return await current.run(state, work); } finally { state.live = false; }
  };
  return { adapter, within, touched: () => [...touched], unsupported };
}
