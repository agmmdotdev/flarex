import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { Client, type Pool, type PoolClient } from "pg";
import { Tracer } from "effect";

const acceptingSpanNames = new Set([
  "ApplicationActivation.prepareBindingSelection",
  "ApplicationReadiness.captureRows",
  "ApplicationReadiness.prepareCapturedRows",
  "ApplicationActivation.withValidatedBindingBasis",
  "ApplicationActivation.withPreparedBindingBasis",
  "ApplicationActivation.validateBindingBasisOwned",
  "ApplicationReadiness.validateStoredIssuedReadiness",
  "ApplicationReadiness.withStoredForBindingInTransaction",
  "ApplicationReadiness.loadPhysicalReadiness",
  "PreparedMetadataEpoch.authenticateTargetSnapshot",
  "PreparedMetadataEpoch.guard",
  "ApplicationActivation.withStandaloneBinding",
  "ApplicationBindingProjection.withStandaloneEvidence",
  "LogicalReadAdmission.with",
  "LogicalReadMetadata.checkCurrent",
  "LogicalReadMetadata.authenticateAndRegister",
  "StandaloneReadTransaction.enter",
  "PreparedMetadataEpoch.acceptFinalBatch",
  "LogicalStorageReadiness.inspectReadDemand",
  "InstallationLifecycle.acquire",
]);

export interface RetrievalComponentSpan {
  readonly name: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly startedMs: number;
  readonly completedMs: number;
  readonly inclusiveElapsedMs: number;
  readonly outcome: "success" | "failure";
}

/** Selected existing owner spans only. Nested inclusive durations are separate
 * distributions, never an additive latency decomposition. Projection runs after
 * the complete request interval; the tracer retains no canonical/result bodies. */
export function observeRetrievalAcceptingComponents() {
  const spans: Tracer.NativeSpan[] = [];
  const tracer = Tracer.make({ span(options) {
    const span = new Tracer.NativeSpan(options);
    if (acceptingSpanNames.has(options.name)) spans.push(span);
    return span;
  } });
  return {
    tracer,
    snapshot(): readonly RetrievalComponentSpan[] {
      const origin = spans[0]?.status.startTime ?? 0n;
      return spans.map(span => {
        const status = span.status;
        if (status._tag !== "Ended") throw new Error(`Unclosed accepting component span: ${span.name}`);
        return { name: span.name, spanId: span.spanId,
          ...(span.parent._tag === "Some" ? { parentSpanId: span.parent.value.spanId } : {}),
          startedMs: Number(status.startTime - origin) / 1e6,
          completedMs: Number(status.endTime - origin) / 1e6,
          inclusiveElapsedMs: Number(status.endTime - status.startTime) / 1e6,
          outcome: status.exit._tag === "Success" ? "success" : "failure" };
      });
    },
  };
}

export interface RetrievalObservation {
  readonly kind: "sql" | "call";
  readonly label: string;
  readonly connection?: number;
  readonly startedMs: number;
  readonly component?: string;
  completedMs?: number;
  rows?: number;
  resultJsonBytes?: number;
  resultJsonBytesUnavailable?: "notJsonSerializable";
  outcome?: "success" | "failure";
}

/** Diagnostic observation of actual foreign results, not a data-contract decoder.
 * Unknown driver shapes remain unavailable. JSON bytes are not wire bytes. */
function recordResult(entry: RetrievalObservation, value: unknown) {
  entry.completedMs = performance.now();
  entry.outcome = "success";
  const rows = Array.isArray(value) ? value
    : value !== null && typeof value === "object" && "rows" in value && Array.isArray(value.rows)
      ? value.rows : undefined;
  if (rows !== undefined) {
    entry.rows = rows.length;
    // Foreign ORM entities may be cyclic or contain BigInt. Diagnostic encoding
    // failure must not turn a successful retrieval/query into a failed one.
    try { entry.resultJsonBytes = Buffer.byteLength(JSON.stringify(rows)); }
    catch { entry.resultJsonBytesUnavailable = "notJsonSerializable"; }
  }
}

function recordFailure(entry: RetrievalObservation) {
  entry.completedMs = performance.now();
  entry.outcome = "failure";
}

/** Inspect descriptors without invoking framework get traps. Native repositories
 * return dynamic wrappers that look up the method again at invocation; wrapping
 * a get-trap result would recurse after installation. Observe the actual defining
 * method while retaining the framework proxy and its error mapper unchanged. */
function observeMethod(owner: object, key: string, label: string,
  entries: RetrievalObservation[], cleanups: Array<() => void>) {
  let definingOwner: object | null = owner;
  let descriptor: PropertyDescriptor | undefined;
  while (definingOwner !== null) {
    descriptor = Object.getOwnPropertyDescriptor(definingOwner, key);
    if (descriptor !== undefined) break;
    definingOwner = Object.getPrototypeOf(definingOwner);
  }
  if (definingOwner === null || descriptor === undefined)
    throw new Error(`Missing observed descriptor ${label}`);
  const method: unknown = descriptor.value;
  if (typeof method !== "function") throw new Error(`Missing observed method ${label}`);
  const installedOwner = definingOwner;
  const originalDescriptor = descriptor;
  Object.defineProperty(installedOwner, key, { ...originalDescriptor,
    value: new Proxy(method, { apply(target, receiver, args) {
      const entry: RetrievalObservation = { kind: "call", label, startedMs: performance.now() };
      entries.push(entry);
      try {
        const result: unknown = Reflect.apply(target, receiver, args);
        if (result instanceof Promise) return result.then(value => {
          recordResult(entry, value); return value;
        }, cause => { recordFailure(entry); throw cause; });
        recordResult(entry, result);
        return result;
      } catch (cause) { recordFailure(entry); throw cause; }
    } }),
  });
  cleanups.push(() => { Object.defineProperty(installedOwner, key, originalDescriptor); });
}

type ProductReadMethod = "retrieveProduct" | "listProducts";
function observeRetrievalService(service: object, entries: RetrievalObservation[], observeRoot: boolean,
  method: ProductReadMethod) {
  const cleanups: Array<() => void> = [];
  try {
    if (observeRoot) observeMethod(service, method, `ProductModuleService.${method}`, entries, cleanups);
    const internal: unknown = Reflect.get(service, "productService_");
    if (internal === null || typeof internal !== "object") throw new Error("Missing native Product internal service");
    const internalMethod = method === "retrieveProduct" ? "retrieve" : "list";
    observeMethod(internal, internalMethod, `MedusaInternalService.${internalMethod}`, entries, cleanups);
    const repository: unknown = Reflect.get(internal, "__productRepository__");
    if (repository === null || typeof repository !== "object") throw new Error("Missing native Product repository");
    observeMethod(repository, "find", "ProductRepository.find", entries, cleanups);
    // Serialization is invoked on the module's base repository, not necessarily
    // the Product entity repository. Observe it only when the actual owner exists.
    const base: unknown = Reflect.get(service, "baseRepository_");
    if (base !== null && typeof base === "object" && typeof Reflect.get(base, "serialize") === "function")
      observeMethod(base, "serialize", "BaseRepository.serialize", entries, cleanups);
    return () => { for (const close of cleanups.toReversed()) close(); };
  } catch (cause) {
    for (const close of cleanups.toReversed()) close();
    throw cause;
  }
}

export const observeNativeRetrievalService = (service: object, entries: RetrievalObservation[],
  method: ProductReadMethod = "retrieveProduct") => observeRetrievalService(service, entries, true, method);

/** A promoted Product instance is constructed per real request. Observe its
 * actual instance at entry instead of constructing a benchmark-only service. */
export function observePromotedRetrievalPrototype(prototype: object,
  entries: RetrievalObservation[], method: ProductReadMethod = "retrieveProduct") {
  const original: unknown = Reflect.get(prototype, method);
  if (typeof original !== "function") throw new Error("Missing promoted retrieval method");
  const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
  Object.defineProperty(prototype, method, { configurable: true, writable: true,
    value: new Proxy(original, { apply(target, receiver: object, args) {
      const restore = observeRetrievalService(receiver, entries, false, method);
      const start: RetrievalObservation = { kind: "call", label: `ProductModuleService.${method}`, startedMs: performance.now() };
      entries.push(start);
      try {
        const result: unknown = Reflect.apply(target, receiver, args);
        if (result instanceof Promise) return result.then(value => {
          recordResult(start, value); return value;
        }, cause => { recordFailure(start); throw cause; }).finally(restore);
        recordResult(start, result); restore(); return result;
      } catch (cause) { recordFailure(start); restore(); throw cause; }
    } }),
  });
  return () => {
    if (descriptor === undefined) Reflect.deleteProperty(prototype, method);
    else Object.defineProperty(prototype, method, descriptor);
  };
}

function retrievalPgPrototypes(): ReadonlySet<object> {
  const requirePinned = createRequire(new URL("../../../../../third_party/medusa/upstream/packages/medusa-test-utils/package.json", import.meta.url));
  const pinnedPg: unknown = requirePinned("@medusajs/framework/pg");
  // Framework versions exposing pg through a different export fail explicitly;
  // never silently omit the native driver from the dispatch ledger.
  if (pinnedPg === null || typeof pinnedPg !== "object" || !("Client" in pinnedPg) ||
    typeof pinnedPg.Client !== "function") throw new Error("Missing pinned pg Client export");
  const nativePrototype: unknown = Reflect.get(pinnedPg.Client, "prototype");
  if (nativePrototype === null || typeof nativePrototype !== "object") throw new Error("Missing pinned pg Client prototype");
  return new Set([Client.prototype, nativePrototype]);
}

export function observeRetrievalPgClients(entries: RetrievalObservation[], component?: () => string | undefined) {
  const cleanups: Array<() => void> = [];
  const clients = new WeakMap<object, number>();
  let clientSequence = 0;
  try { for (const prototype of retrievalPgPrototypes()) {
    const original: unknown = Reflect.get(prototype, "query");
    if (typeof original !== "function") throw new Error("Missing pg query method");
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "query");
    Object.defineProperty(prototype, "query", { configurable: true, writable: true,
      value: new Proxy(original, { apply(target, receiver: object, argumentsList) {
        const args: unknown[] = [...argumentsList];
        const first = args[0];
        const sql = typeof first === "string" ? first
          : first !== null && typeof first === "object" && "text" in first && typeof first.text === "string"
            ? first.text : "[unavailable query text]";
        let connection = clients.get(receiver);
        if (connection === undefined) { connection = ++clientSequence; clients.set(receiver, connection); }
        const selectedComponent = component?.();
        const entry: RetrievalObservation = { kind: "sql", label: sql, connection, startedMs: performance.now(),
          ...(selectedComponent === undefined ? {} : { component: selectedComponent }) };
        entries.push(entry);
        const callback = args.at(-1);
        if (typeof callback === "function") args[args.length - 1] = function(this: unknown, ...values: unknown[]) {
          if (values[0] !== null && values[0] !== undefined) recordFailure(entry);
          else recordResult(entry, values[1]);
          return Reflect.apply(callback, this, values);
        };
        try {
          const result: unknown = Reflect.apply(target, receiver, args);
          if (result instanceof Promise) return result.then(value => {
            recordResult(entry, value); return value;
          }, cause => { recordFailure(entry); throw cause; });
          return result;
        } catch (cause) { recordFailure(entry); throw cause; }
      } }),
    });
    cleanups.push(() => {
      if (descriptor === undefined) Reflect.deleteProperty(prototype, "query");
      else Object.defineProperty(prototype, "query", descriptor);
    });
  } } catch (cause) {
    for (const close of cleanups.toReversed()) close();
    throw cause;
  }
  return () => { for (const close of cleanups.toReversed()) close(); };
}

export interface RetrievalProtocolObservation {
  readonly method: "parse" | "bind" | "describe" | "execute" | "sync" | "query";
  readonly connection: number;
  readonly startedMs: number;
  readonly statementName?: string;
  readonly portalName?: string;
  readonly descriptionType?: "P" | "S";
  readonly sqlBytes?: number;
  readonly sqlSha256?: string;
  outcome?: "returned" | "threw";
}

/** Actual protocol method submissions, not completed server messages or wire
 * bytes. Separate opt-in diagnostics retain no bind values or SQL bodies. */
export function observeRetrievalPgProtocol(entries: RetrievalProtocolObservation[]) {
  const cleanups: Array<() => void> = [];
  const seen = new WeakSet<object>();
  let sequence = 0;
  const observeConnection = (client: object) => {
    const connection: unknown = Reflect.get(client, "connection");
    if (typeof connection !== "object" || connection === null) throw new Error("Missing pg protocol connection");
    if (seen.has(connection)) return;
    seen.add(connection);
    const identity = ++sequence;
    for (const key of ["parse", "bind", "describe", "execute", "sync", "query"] as const) {
      const original: unknown = Reflect.get(connection, key);
      if (typeof original !== "function") throw new Error(`Missing pg protocol method ${key}`);
      const descriptor = Object.getOwnPropertyDescriptor(connection, key);
      Object.defineProperty(connection, key, { configurable: true, writable: true,
        value: new Proxy(original, { apply(target, receiver, args) {
          const first: unknown = args[0];
          const text = key === "query" && typeof first === "string" ? first
            : key === "parse" && typeof first === "object" && first !== null && "text" in first && typeof first.text === "string"
              ? first.text : undefined;
          const descriptionType = key === "describe" && typeof first === "object" && first !== null &&
            "type" in first && (first.type === "P" || first.type === "S") ? first.type : undefined;
          const statementName = typeof first === "object" && first !== null
            ? key === "bind" && "statement" in first && typeof first.statement === "string" ? first.statement
              : (key === "parse" || descriptionType === "S") && "name" in first && typeof first.name === "string" ? first.name : undefined
            : undefined;
          const portalName = typeof first === "object" && first !== null
            ? (key === "bind" || key === "execute") && "portal" in first && typeof first.portal === "string" ? first.portal
              : descriptionType === "P" && "name" in first && typeof first.name === "string" ? first.name : undefined
            : undefined;
          const entry: RetrievalProtocolObservation = { method: key, connection: identity, startedMs: performance.now(),
            ...(statementName === undefined ? {} : { statementName }),
            ...(portalName === undefined ? {} : { portalName }),
            ...(descriptionType === undefined ? {} : { descriptionType }),
            ...(text === undefined ? {} : { sqlBytes: Buffer.byteLength(text),
              sqlSha256: createHash("sha256").update(text).digest("hex") }) };
          entries.push(entry);
          try { const result: unknown = Reflect.apply(target, receiver, args); entry.outcome = "returned"; return result; }
          catch (cause) { entry.outcome = "threw"; throw cause; }
        } }),
      });
      cleanups.push(() => {
        if (descriptor === undefined) Reflect.deleteProperty(connection, key);
        else Object.defineProperty(connection, key, descriptor);
      });
    }
  };
  try {
    for (const prototype of retrievalPgPrototypes()) {
      const original: unknown = Reflect.get(prototype, "query");
      if (typeof original !== "function") throw new Error("Missing pg query method for protocol diagnostics");
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "query");
      Object.defineProperty(prototype, "query", { configurable: true, writable: true,
        value: new Proxy(original, { apply(target, receiver: object, args) {
          observeConnection(receiver);
          return Reflect.apply(target, receiver, args);
        } }),
      });
      cleanups.push(() => {
        if (descriptor === undefined) Reflect.deleteProperty(prototype, "query");
        else Object.defineProperty(prototype, "query", descriptor);
      });
    }
  } catch (cause) { for (const close of cleanups.toReversed()) close(); throw cause; }
  return () => { for (const close of cleanups.toReversed()) close(); };
}

/** Destroy only idle physical pg clients between requests. Acquisition plus
 * release(true) uses the owning Pool API and never retains a client in work. */
export async function destroyIdleRetrievalPoolClients(pool: Pool): Promise<number> {
  if (pool.waitingCount !== 0 || pool.totalCount !== pool.idleCount)
    throw new Error("Cold retrieval requires an idle pool with no waiting or held clients");
  const count = pool.idleCount;
  const clients: PoolClient[] = [];
  try { for (let index = 0; index < count; index++) clients.push(await pool.connect()); }
  finally { for (const client of clients) client.release(true); }
  if (pool.totalCount !== 0) throw new Error("Cold retrieval did not empty the physical pool");
  return count;
}

/** Capture the actual runner-owned Knex client while its manager is live.
 * Later resets retain only that shared client, including after module disposal.
 * Knex destroys idle sockets and creates an empty pool; authentication remains
 * inside the next measured request. */
export function prepareNativeRetrievalConnectionReset(manager: object): () => Promise<number> {
  const getConnection: unknown = Reflect.get(manager, "getConnection");
  if (typeof getConnection !== "function") throw new Error("Missing native connection accessor");
  const connection: unknown = Reflect.apply(getConnection, manager, []);
  if (connection === null || typeof connection !== "object") throw new Error("Missing native connection");
  const getKnex: unknown = Reflect.get(connection, "getKnex");
  if (typeof getKnex !== "function") throw new Error("Missing native Knex accessor");
  const knex: unknown = Reflect.apply(getKnex, connection, []);
  if ((typeof knex !== "object" && typeof knex !== "function") || knex === null) throw new Error("Missing native Knex");
  const client: unknown = Reflect.get(knex, "client");
  if (client === null || typeof client !== "object") throw new Error("Missing native Knex client");
  const count = (name: string) => {
    const pool: unknown = Reflect.get(client, "pool");
    if (pool === null || typeof pool !== "object") throw new Error("Missing native pool");
    const method: unknown = Reflect.get(pool, name);
    if (typeof method !== "function") throw new Error(`Missing native pool ${name}`);
    const result: unknown = Reflect.apply(method, pool, []);
    if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0) throw new Error("Invalid native pool count");
    return result;
  };
  return async () => {
    if (count("numUsed") !== 0 || count("numPendingAcquires") !== 0 || count("numPendingCreates") !== 0)
      throw new Error("Native reconnect requires an idle pool");
    const destroyed = count("numFree");
    const destroy: unknown = Reflect.get(client, "destroy");
    const initialize: unknown = Reflect.get(client, "initializePool");
    if (typeof destroy !== "function" || typeof initialize !== "function") throw new Error("Missing native pool lifecycle");
    await Reflect.apply(destroy, client, []);
    Reflect.apply(initialize, client, []);
    if (count("numFree") !== 0 || count("numUsed") !== 0 || count("numPendingCreates") !== 0)
      throw new Error("Native reset created a physical connection outside the request");
    return destroyed;
  };
}
