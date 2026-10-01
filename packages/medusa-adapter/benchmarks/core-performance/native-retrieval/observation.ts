import { createRequire } from "node:module";
import { Client } from "pg";

export interface RetrievalObservation {
  readonly kind: "sql" | "call";
  readonly label: string;
  readonly connection?: number;
  readonly startedMs: number;
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

function observeRetrievalService(service: object, entries: RetrievalObservation[], observeRoot: boolean) {
  const cleanups: Array<() => void> = [];
  try {
    if (observeRoot) observeMethod(service, "retrieveProduct", "ProductModuleService.retrieveProduct", entries, cleanups);
    const internal: unknown = Reflect.get(service, "productService_");
    if (internal === null || typeof internal !== "object") throw new Error("Missing native Product internal service");
    observeMethod(internal, "retrieve", "MedusaInternalService.retrieve", entries, cleanups);
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

export const observeNativeRetrievalService = (service: object, entries: RetrievalObservation[]) =>
  observeRetrievalService(service, entries, true);

/** A promoted Product instance is constructed per real request. Observe its
 * actual instance at entry instead of constructing a benchmark-only service. */
export function observePromotedRetrievalPrototype(prototype: object,
  entries: RetrievalObservation[]) {
  const original: unknown = Reflect.get(prototype, "retrieveProduct");
  if (typeof original !== "function") throw new Error("Missing promoted retrieval method");
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "retrieveProduct");
  Object.defineProperty(prototype, "retrieveProduct", { configurable: true, writable: true,
    value: new Proxy(original, { apply(target, receiver: object, args) {
      const restore = observeRetrievalService(receiver, entries, false);
      const start: RetrievalObservation = { kind: "call", label: "ProductModuleService.retrieveProduct", startedMs: performance.now() };
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
    if (descriptor === undefined) Reflect.deleteProperty(prototype, "retrieveProduct");
    else Object.defineProperty(prototype, "retrieveProduct", descriptor);
  };
}

export function observeRetrievalPgClients(entries: RetrievalObservation[]) {
  const requirePinned = createRequire(new URL("../../../../../third_party/medusa/upstream/packages/medusa-test-utils/package.json", import.meta.url));
  const pinnedPg: unknown = requirePinned("@medusajs/framework/pg");
  // Framework versions exposing pg through a different export fail explicitly;
  // never silently omit the native driver from the dispatch ledger.
  if (pinnedPg === null || typeof pinnedPg !== "object" || !("Client" in pinnedPg) ||
    typeof pinnedPg.Client !== "function") throw new Error("Missing pinned pg Client export");
  const nativePrototype: unknown = Reflect.get(pinnedPg.Client, "prototype");
  if (nativePrototype === null || typeof nativePrototype !== "object") throw new Error("Missing pinned pg Client prototype");
  const cleanups: Array<() => void> = [];
  const clients = new WeakMap<object, number>();
  let clientSequence = 0;
  try { for (const prototype of new Set([Client.prototype, nativePrototype])) {
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
        const entry: RetrievalObservation = { kind: "sql", label: sql, connection, startedMs: performance.now() };
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
