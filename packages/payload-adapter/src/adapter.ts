import { payloadJoinQuery, type PayloadJoinQuery } from "./joins";
import { payloadHasMany, payloadJoins } from "./contract";
import { AsyncLocalStorage } from "node:async_hooks";
import { APIError, ValidationError, type BaseDatabaseAdapter, type DatabaseAdapterObj,
  type PayloadRequest, type TypeWithID, type PaginatedDocs } from "payload";
import { Clock, Effect, Result, Semaphore } from "effect";
import { isJsonObject, type Json } from "flarex-protocol/json";
import {
  capturePrivateJsonData,
  cmsError,
  type CmsCommandContext,
  type CmsPresentedTransactionId,
  type CmsTransactionError,
} from "@flarex/persistence-postgres/internal/cms-adapter";
import type { PayloadContentProfile } from "./contract";
import { makePayloadPopulation, payloadPopulationIds } from "./population";
import { payloadManyIds } from "./many";

export class UnsupportedPayloadCapability extends APIError {
  constructor(readonly capability: string) { super(`Unsupported private Payload capability: ${capability}`, 400); }
}
interface RequestBridge {
  readonly context: CmsCommandContext;
  readonly request: Partial<PayloadRequest>;
  readonly signal: AbortSignal;
  readonly population: ReturnType<typeof makePayloadPopulation> | null;
  readonly semaphore: Semaphore.Semaphore;
  readonly joins: PayloadJoinQuery;
  live: boolean;
}

const transactionId = (state: RequestBridge): CmsPresentedTransactionId => {
  const id = state.request.transactionID;
  if (typeof id === "number") throw new UnsupportedPayloadCapability("numeric transaction ID");
  // Payload declares Promise<number|string>; validate the resolved compatibility input.
  return id instanceof Promise ? id.then(value => {
    if (typeof value !== "string") throw new UnsupportedPayloadCapability("numeric transaction ID");
    return value;
  }) : id;
};
const run = <Value>(state: RequestBridge, effect: Effect.Effect<Value, CmsTransactionError>): Promise<Value> =>
  Effect.runPromise((state.population === null ? effect : state.semaphore.withPermits(1)(Effect.suspend(() =>
    state.live ? effect : Effect.fail(cmsError("closed"))))).pipe(Effect.mapError(error => error.reason === "uniqueConflict"
    ? new ValidationError({ collection: "posts", errors: [{ path: "title", tableName: "posts", message: state.request.t?.("error:valueMustBeUnique") ?? "Value must be unique" }], req: state.request }, state.request.t)
    : error)), { signal: state.signal });
// oxlint-disable-next-line flarex/no-result-get-or-throw-without-boundary -- REVIEW: compatibility - Payload requires a throwing parser over the owned Result decoder.
const capture = (value: unknown): Json => Result.getOrThrow(capturePrivateJsonData(value, 65_536, cmsError)).value;
type ScalarPredicate = { _id?: string; title?: string };
const where = (input: unknown): ScalarPredicate => {
  let value = input === undefined ? {} : capture(input);
  // Pinned Payload combineQueries wraps its caller's admitted flat predicate once.
  if (isJsonObject(value) && Object.keys(value).join() === "and" && Array.isArray(value.and) && value.and.length <= 1) value = value.and[0] ?? {};
  if (!isJsonObject(value)) throw new UnsupportedPayloadCapability("where");
  const fields: ScalarPredicate = {};
  for (const [field, operator] of Object.entries(value)) {
    if (!["id", "title"].includes(field) || !isJsonObject(operator) || Object.keys(operator).join() !== "equals" || typeof operator.equals !== "string") {
      throw new UnsupportedPayloadCapability("where operator");
    }
    fields[field === "id" ? "_id" : "title"] = operator.equals;
  }
  return fields;
};
const payloadDocument = (value: Json, profile: PayloadContentProfile): Record<string, Json> & { id: string } => {
  if (!isJsonObject(value) || typeof value._id !== "string") throw new Error("Invalid admitted CMS document");
  const { _id, _creationTime, ...fields } = value;
  const document = { ...fields, ...(profile !== "payload.scalar" ? { relatedPost: fields.relatedPost ?? null } : {}), id: _id };
  if (payloadHasMany(profile)) {
    // Payload populates array slots in place. Give it an owned copy, never the immutable CMS value.
    // oxlint-disable-next-line flarex/no-result-get-or-throw-without-boundary -- REVIEW: compatibility - The foreign document projection throws typed corruption for invalid stored relation values.
    return { ...document, relatedPosts: [...Result.getOrThrow(payloadManyIds(fields.relatedPosts).pipe(Result.mapError(cause => cmsError("storedCorruption", cause))))] };
  }
  return document;
};
const payloadFields = (profile: PayloadContentProfile, input: Record<string, unknown>, expectedId?: string, creationTimestamp?: string) => {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    // Payload may materialize absent virtual keys while traversing fields.
    if (profile === "payload.content-joins" && payloadJoins.some(join => join.name === key) && value === undefined) continue;
    if (key === "id") {
      if (value !== undefined && value !== expectedId) throw new UnsupportedPayloadCapability("caller-selected identity");
      continue;
    }
    if (key === "relatedPost" && profile !== "payload.scalar") {
      if (value === null || value === undefined) continue;
      if (typeof value !== "string") throw new UnsupportedPayloadCapability("relation identity");
      normalized[key] = value;
      continue;
    }
    if (key === "relatedPosts" && payloadHasMany(profile)) {
      // oxlint-disable-next-line flarex/no-result-get-or-throw-without-boundary -- REVIEW: compatibility - Payload's adapter requires a throwing parser over the owned array decoder.
      normalized[key] = Result.getOrThrow(payloadManyIds(value));
      continue;
    }
    if (!["title", "score", "enabled", "publishedAt", "createdAt", "updatedAt"].includes(key)) throw new UnsupportedPayloadCapability(`document field: ${key} (${typeof value})`);
    if (value === undefined && ["createdAt", "updatedAt"].includes(key)) continue;
    if (["createdAt", "updatedAt", "publishedAt"].includes(key)) {
      if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new UnsupportedPayloadCapability("date");
      normalized[key] = new Date(value).toISOString();
    } else normalized[key] = value;
  }
  if (creationTimestamp !== undefined) {
    if (payloadHasMany(profile)) normalized.relatedPosts ??= [];
    normalized.createdAt ??= creationTimestamp;
    normalized.updatedAt ??= creationTimestamp;
  }
  const value = capture(normalized);
  if (!isJsonObject(value)) throw new Error("Invalid captured Payload fields");
  return value;
};

/** Node-only, per-Payload-instance foreign Promise boundary; it owns no database. */
export function makePayloadDatabaseAdapter(profile: PayloadContentProfile = "payload.scalar") {
  const document = (value: Json) => payloadDocument(value, profile);
  const fields = (input: Record<string, unknown>, expectedId?: string, creationTimestamp?: string) => payloadFields(profile, input, expectedId, creationTimestamp);
  const current = new AsyncLocalStorage<RequestBridge>();
  const touched = new Set<string>();
  const unsupported = async (capability = "deferred adapter member"): Promise<never> => {
    const state = current.getStore();
    if (state?.live) await Effect.runPromise(state.context.rollback(state.context.transactionId).pipe(Effect.exit), { signal: state.signal });
    throw new UnsupportedPayloadCapability(capability);
  };
  const deferred = () => unsupported();
  const stateFor = (request?: Partial<PayloadRequest>, projected = false): RequestBridge => {
    const state = current.getStore();
    const exactProjection = state !== undefined && projected && request !== undefined &&
      Object.keys(request).join() === "transactionID" && request.transactionID === state.request.transactionID;
    if (state === undefined || !state.live || state.signal.aborted || (request !== state.request && !exactProjection)) {
      throw new UnsupportedPayloadCapability("unadmitted request");
    }
    return state;
  };
  const admit = (args: { collection: string; req?: Partial<PayloadRequest>; locale?: string; select?: unknown; joins?: unknown;
    returning?: boolean; draft?: boolean; draftsEnabled?: boolean }, projected = false) => {
    const state = stateFor(args.req, projected);
    if (args.collection !== "posts" || args.locale !== undefined || args.returning === false || args.draft || args.draftsEnabled ||
      [args.select, ...(profile === "payload.content-joins" ? [] : [args.joins])].some(value => value !== undefined && (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 0))) {
      throw new UnsupportedPayloadCapability("collection or projection");
    }
    if (profile === "payload.content-joins") {
      // oxlint-disable-next-line flarex/no-result-get-or-throw-without-boundary -- REVIEW: compatibility - Payload requires a throwing adapter argument parser.
      Result.getOrThrow(payloadJoinQuery(args.joins, true));
    }
    touched.add(args.collection);
    return state;
  };
  const roots = async (state: RequestBridge, values: ReturnType<typeof document>[], queryInput: unknown) => {
    const sanitized = profile === "payload.content-joins" ? await run(state, Effect.fromResult(payloadJoinQuery(queryInput, true))) : null;
    if (profile === "payload.content-joins") for (const value of values) for (const join of payloadJoins) {
      const query = state.joins[join.name];
      const admitted = sanitized?.[join.name];
      if (query === false || admitted === false) continue;
      if (admitted === undefined || admitted.limit !== query.limit) return unsupported("join query changed");
      const page = await run(state, state.context.relations.incoming(state.context.context, transactionId(state), join.on, value.id, query.limit));
      value[join.name] = { docs: [...page.docs], hasNextPage: page.hasNextPage };
    }
    if (state.population !== null) await run(state, Effect.fromResult(state.population.roots(values)));
    return values;
  };
  const one = async (args: Parameters<BaseDatabaseAdapter["findOne"]>[0]) => {
    const state = admit(args, true);
    const predicate = where(args.where);
    if (predicate._id !== undefined) {
      const value = await run(state, state.context.documents.get(state.context.context, transactionId(state), predicate._id));
      const found = value === null || (predicate.title !== undefined && value.title !== predicate.title) ? null : document(value);
      await roots(state, found === null ? [] : [found], args.joins);
      return found;
    }
    const result = await run(state, state.context.documents.find(state.context.context, transactionId(state), "posts", { where: where(args.where), offset: 0, limit: 1 }));
    const found = result.docs[0] === undefined ? null : document(result.docs[0]);
    await roots(state, found === null ? [] : [found], args.joins);
    return found;
  };
  const adapter: DatabaseAdapterObj = { name: "flarex-private-payload", defaultIDType: "text", init: ({ payload }) => ({
    name: "flarex-private-payload", packageName: "flarex-private-payload", defaultIDType: "text", payload, migrationDir: "",
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
      const state = stateFor(args.req);
      const batch = await run(state, Effect.fromResult(payloadPopulationIds(args.where)));
      // Pinned loader cache keys encode absent select as null before calling find.
      admit(batch !== null && state.population !== null && args.select === null ? { ...args, select: undefined } : args);
      if (batch !== null) {
        const population = state.population;
        if (population === null || args.pagination !== false || args.limit !== 0 || args.page !== 1 ||
          args.skip !== undefined || args.projection !== undefined || args.versions ||
          !(args.sort === "id" || (Array.isArray(args.sort) && args.sort.length === 1 && args.sort[0] === "id"))) return unsupported("population query");
        await run(state, Effect.fromResult(population.admit(batch)));
        const values = await run(state, state.context.documents.getMany(state.context.context, transactionId(state), "posts", batch));
        const docs = values.map(value => value === null ? null : document(value));
        const bytes = await run(state, Effect.fromResult(population.outputBytes(batch, docs)));
        await run(state, state.context.reserveOutput(bytes));
        // SAFETY: the closed profile and outputBytes prove every configured target document is present.
        return { docs: docs as T[], totalDocs: docs.length, limit: docs.length, totalPages: 1, page: 1, pagingCounter: 1,
          hasPrevPage: false, hasNextPage: false, prevPage: null, nextPage: null };
      }
      const limit = args.limit ?? 10; const page = args.page ?? 1;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32 || !Number.isSafeInteger(page) || page < 1 || page > 257 ||
        args.skip !== undefined || args.projection !== undefined || args.versions || (args.sort !== undefined && args.sort !== "id" && !(Array.isArray(args.sort) && args.sort.length === 1 && args.sort[0] === "id"))) {
        return unsupported("pagination or sort");
      }
      const found = await run(state, state.context.documents.find(state.context.context, transactionId(state), "posts", { where: where(args.where), offset: (page - 1) * limit, limit }));
      const paginated = args.pagination !== false;
      const totalDocs = paginated ? found.total : found.docs.length;
      const totalPages = paginated ? Math.max(1, Math.ceil(totalDocs / limit)) : 1;
      const values = await roots(state, found.docs.map(document), args.joins);
      // SAFETY: same closed Payload collection-generic boundary as findOne.
      const docs = values as T[];
      return { docs, totalDocs, limit, totalPages, page, pagingCounter: paginated ? (page - 1) * limit + 1 : 1,
        hasPrevPage: paginated && page > 1, hasNextPage: paginated && page < totalPages, prevPage: paginated && page > 1 ? page - 1 : null, nextPage: paginated && page < totalPages ? page + 1 : null };
    },
    count: async args => { const state = admit(args); const result = await run(state, state.context.documents.find(state.context.context, transactionId(state), "posts", { where: where(args.where), offset: 0, limit: 1 })); return { totalDocs: result.total }; },
    updateOne: async args => { const state = admit(args); const prior = args.id === undefined ? await one(args) : null;
      const id = args.id ?? prior?.id;
      if (typeof id !== "string") return unsupported("missing update identity");
      if (profile !== "payload.scalar" && args.data.relatedPost === null) {
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
  const within = async <Value>(context: CmsCommandContext, request: Partial<PayloadRequest>, signal: AbortSignal, work: () => Promise<Value>, populate = false, joins: PayloadJoinQuery = { referencedBy: false, referencedByMany: false }) => {
    if (populate && (!context.standaloneRead || profile === "payload.scalar")) throw new UnsupportedPayloadCapability("population request");
    const state: RequestBridge = { context, request, signal, joins, live: !signal.aborted,
      population: populate ? makePayloadPopulation(profile) : null, semaphore: Semaphore.makeUnsafe(1) };
    const abort = () => { state.live = false; };
    signal.addEventListener("abort", abort, { once: true });
    try { return await current.run(state, work); } finally { state.live = false; signal.removeEventListener("abort", abort); }
  };
  return { adapter, within, touched: () => [...touched], unsupported };
}
