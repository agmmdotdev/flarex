import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Result } from "effect";
import type { Pool, PoolClient } from "pg";

export type TracePool = "control" | "target";
export type TraceMode = "measured" | "recon";

export interface TracePhaseSpan {
  readonly id: number;
  readonly parentId: number | null;
  readonly name: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly inclusiveMs: number;
  readonly exclusiveMs: number;
  readonly complete: boolean;
}

export interface TraceDispatchRecord {
  readonly pool: TracePool;
  readonly phasePath: readonly string[];
  readonly atMs: number;
  readonly awaitedMs: number | null;
  readonly outcome: "ok" | "error" | "unobserved";
  readonly fingerprint: string | null;
  /** SQL structure only. Literal values and parameter values are never retained. */
  readonly template: string | null;
  readonly statementCount: number | null;
  readonly transactionAction: "begin" | "commit" | "rollback" | null;
  readonly delegatedPoolQuery: boolean;
  readonly parameterCount: number | null;
  readonly scalarParameterBytes: number | null;
  readonly unknownEncodingParameters: number | null;
  readonly sqlUtf8Bytes: number | null;
  readonly returnedRowCount?: number | null;
  /** UTF-8 JSON encoding of decoded rows (BigInt as decimal strings, normal
   * Date/Buffer JSON forms). This is not wire traffic or heap allocation. */
  readonly decodedResultJsonUtf8Bytes?: number | null;
}

export interface TraceCheckoutRecord {
  readonly pool: TracePool;
  readonly phasePath: readonly string[];
  readonly atMs: number;
  readonly awaitedMs: number;
  readonly outcome: "ok" | "error";
}

export interface TraceTransactionInterval {
  readonly pool: TracePool;
  readonly phasePath: readonly string[];
  readonly startMs: number;
  readonly endMs: number;
  readonly durationMs: number;
  readonly outcome: "commit" | "rollback" | "commit-error" | "rollback-error" | "open-at-end";
}

export interface TraceDispatchGroup {
  readonly pool: TracePool;
  readonly phasePath: readonly string[];
  readonly fingerprint: string | null;
  readonly template: string | null;
  readonly dispatchCount: number;
  readonly statementCount: number;
  readonly unknownStatementDispatches: number;
  readonly awaitedMsSum: number;
  readonly awaitedMsMin: number | null;
  readonly awaitedMsMax: number | null;
  readonly errorCount: number;
  readonly unobservedCount: number;
  readonly returnedRowCount?: number;
  readonly decodedResultJsonUtf8Bytes?: number;
  readonly unknownResultEncodingDispatches?: number;
}

export interface TraceCheckoutGroup {
  readonly pool: TracePool;
  readonly phasePath: readonly string[];
  readonly checkoutCount: number;
  readonly awaitedMsSum: number;
  readonly awaitedMsMin: number;
  readonly awaitedMsMax: number;
  readonly errorCount: number;
}

export interface TraceTransactionGroup {
  readonly pool: TracePool;
  readonly phasePath: readonly string[];
  readonly outcome: TraceTransactionInterval["outcome"];
  readonly intervalCount: number;
  readonly durationMsSum: number;
  readonly durationMsMin: number;
  readonly durationMsMax: number;
}

export interface TraceInvocationRecord {
  readonly startedAtMs: number;
  readonly id: string;
  readonly mode: TraceMode;
  readonly durationMs: number;
  readonly outcome: "ok" | "error";
  readonly spans: readonly TracePhaseSpan[];
  /** Measured samples retain groups, while reconnaissance also retains individual records. */
  readonly dispatchGroups: readonly TraceDispatchGroup[];
  readonly checkoutGroups: readonly TraceCheckoutGroup[];
  readonly transactionGroups: readonly TraceTransactionGroup[];
  readonly dispatches: readonly TraceDispatchRecord[];
  readonly checkouts: readonly TraceCheckoutRecord[];
  readonly transactions: readonly TraceTransactionInterval[];
  /** Union of observed awaited intervals, avoiding concurrent double counting. */
  readonly dispatchAwaitedUnionMs: number;
  readonly checkoutAwaitedUnionMs: number;
  /** Pool.query is a delegation route; its calls are not a second dispatch. */
  readonly poolQueryCalls: number;
  readonly delegatedPoolQueryDispatches: number;
  /** Acquired-client dispatches lacking this invocation's ALS context while it was active. */
  readonly lostContextDispatches: number;
  readonly unobservedDispatches: number;
  readonly unknownStatementDispatches: number;
  readonly incompleteSpans: number;
}

export interface TraceFingerprintOwner {
  readonly pool: TracePool;
  readonly fingerprint: string;
  readonly phasePath: readonly string[];
  readonly status: "single" | "ambiguous" | "unattributed";
  /** Set only when one mapped source site produced every observed dispatch. */
  readonly owner: string | null;
  readonly observedDispatches: number;
  readonly sourceSites: readonly Readonly<{
    readonly siteId: string;
    readonly owner: string | null;
    readonly sourceFrames: readonly string[];
    readonly dispatchCount: number;
  }>[];
}

export interface MixedMutationPerformanceTrace {
  withInvocation<T>(input: Readonly<{ id: string; mode: TraceMode }>, run: () => Promise<T>): Promise<T>;
  withPhase<T>(name: string, run: () => Promise<T>): Promise<T>;
  bindCurrent<Args extends unknown[], T>(run: (...args: Args) => Promise<T>): (...args: Args) => Promise<T>;
  records(): readonly TraceInvocationRecord[];
  drainRecords(): readonly TraceInvocationRecord[];
  ownerMappings(): readonly TraceFingerprintOwner[];
  close(): void;
}

interface MutableSpan {
  readonly id: number;
  readonly parentId: number | null;
  readonly name: string;
  readonly start: number;
  end?: number;
}

interface MutableInvocation {
  readonly id: string;
  readonly mode: TraceMode;
  readonly start: number;
  readonly spans: MutableSpan[];
  readonly dispatches: TraceDispatchRecord[];
  readonly checkouts: TraceCheckoutRecord[];
  readonly transactions: TraceTransactionInterval[];
  poolQueryCalls: number;
  delegatedPoolQueryDispatches: number;
  lostContextDispatches: number;
}

interface TraceContext {
  readonly invocation: MutableInvocation;
  readonly span: MutableSpan;
  readonly delegatedPoolQuery: boolean;
  readonly reconFrames?: readonly string[] | undefined;
}

interface ActiveTransaction {
  readonly invocation: MutableInvocation;
  readonly pool: TracePool;
  readonly phasePath: readonly string[];
  readonly start: number;
}

interface MutableOwnerSite {
  readonly siteId: string;
  readonly owner: string | null;
  readonly sourceFrames: readonly string[];
  dispatchCount: number;
}

interface MutableOwnerGroup {
  readonly pool: TracePool;
  readonly fingerprint: string;
  readonly phasePath: readonly string[];
  readonly sites: Map<string, MutableOwnerSite>;
  observedDispatches: number;
}

type MutableDispatchRecord = { -readonly [K in keyof TraceDispatchRecord]: TraceDispatchRecord[K] };

type ConnectCallback = (error: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void;
const elapsed = (start: number, end: number): number => Math.max(0, end - start);

// PostgreSQL 18 numeric lexical forms: decimal/exponent and base 2/8/16,
// with single underscores only between digits (or after a base prefix).
const numericToken = /^(?:0[xX]_?[0-9a-fA-F]+(?:_[0-9a-fA-F]+)*|0[oO]_?[0-7]+(?:_[0-7]+)*|0[bB]_?[01]+(?:_[01]+)*|(?:(?:[0-9]+(?:_[0-9]+)*)(?:\.(?:[0-9]+(?:_[0-9]+)*)?)?|\.[0-9]+(?:_[0-9]+)*)(?:[eE][+-]?[0-9]+(?:_[0-9]+)*)?)/;

function numericEnd(sql: string, start: number): number | null {
  const token = numericToken.exec(sql.slice(start))?.[0];
  if (token === undefined) return null;
  const end = start + token.length;
  const next = sql[end];
  // A partial token would retain part of a literal as an identifier. Refuse it.
  if (next !== undefined && /[a-zA-Z_0-9$]/.test(next)) return null;
  if (/^0[xXoObB]/.test(token) && next === "." && /[0-9]/.test(sql[end + 1] ?? "")) return null;
  return end;
}

function phasePath(invocation: MutableInvocation, span: MutableSpan): readonly string[] {
  const path: string[] = [];
  let current: MutableSpan | undefined = span;
  while (current !== undefined) {
    path.push(current.name);
    current = current.parentId === null ? undefined : invocation.spans[current.parentId];
  }
  return path.toReversed();
}

function coveredChildDuration(parent: MutableSpan, children: readonly MutableSpan[], end: number): number {
  const intervals = children.filter(child => child.parentId === parent.id).map(child => ({
    start: Math.max(parent.start, child.start), end: Math.min(end, child.end ?? end),
  })).filter(interval => interval.end > interval.start).toSorted((a, b) => a.start - b.start);
  let total = 0;
  let mergedEnd = parent.start;
  for (const interval of intervals) {
    total += Math.max(0, interval.end - Math.max(mergedEnd, interval.start));
    mergedEnd = Math.max(mergedEnd, interval.end);
  }
  return total;
}

function finishSpans(invocation: MutableInvocation, end: number): readonly TracePhaseSpan[] {
  return invocation.spans.map(span => {
    const spanEnd = span.end ?? end;
    const inclusiveMs = elapsed(span.start, spanEnd);
    return { id: span.id, parentId: span.parentId, name: span.name,
      startMs: elapsed(invocation.start, span.start), endMs: elapsed(invocation.start, spanEnd),
      inclusiveMs, exclusiveMs: Math.max(0, inclusiveMs - coveredChildDuration(span, invocation.spans, spanEnd)),
      complete: span.end !== undefined };
  });
}

function intervalUnion(intervals: readonly Readonly<{ start: number; end: number }>[]): number {
  const ordered = intervals.toSorted((a, b) => a.start - b.start);
  let duration = 0;
  let coveredEnd = Number.NEGATIVE_INFINITY;
  for (const interval of ordered) {
    duration += Math.max(0, interval.end - Math.max(interval.start, coveredEnd));
    coveredEnd = Math.max(coveredEnd, interval.end);
  }
  return duration;
}

function dispatchGroups(records: readonly TraceDispatchRecord[]): readonly TraceDispatchGroup[] {
  const groups = new Map<string, { -readonly [K in keyof TraceDispatchGroup]: TraceDispatchGroup[K] }>();
  for (const record of records) {
    const key = JSON.stringify([record.pool, record.phasePath, record.fingerprint]);
    let group = groups.get(key);
    if (group === undefined) {
      group = { pool: record.pool, phasePath: record.phasePath, fingerprint: record.fingerprint,
        template: record.template, dispatchCount: 0, statementCount: 0, unknownStatementDispatches: 0,
        awaitedMsSum: 0, awaitedMsMin: null, awaitedMsMax: null, errorCount: 0, unobservedCount: 0,
        returnedRowCount: 0, decodedResultJsonUtf8Bytes: 0, unknownResultEncodingDispatches: 0 };
      groups.set(key, group);
    }
    group.dispatchCount++;
    if (record.statementCount === null) group.unknownStatementDispatches++;
    else group.statementCount += record.statementCount;
    if (record.awaitedMs !== null) {
      group.awaitedMsSum += record.awaitedMs;
      group.awaitedMsMin = Math.min(group.awaitedMsMin ?? record.awaitedMs, record.awaitedMs);
      group.awaitedMsMax = Math.max(group.awaitedMsMax ?? record.awaitedMs, record.awaitedMs);
    }
    if (record.outcome === "error") group.errorCount++;
    if (record.outcome === "unobserved") group.unobservedCount++;
    if (record.returnedRowCount == null || record.decodedResultJsonUtf8Bytes == null)
      group.unknownResultEncodingDispatches = (group.unknownResultEncodingDispatches ?? 0) + 1;
    else {
      group.returnedRowCount = (group.returnedRowCount ?? 0) + record.returnedRowCount;
      group.decodedResultJsonUtf8Bytes = (group.decodedResultJsonUtf8Bytes ?? 0) + record.decodedResultJsonUtf8Bytes;
    }
  }
  return [...groups.values()];
}

/** Diagnostic sizes only; keep original driver values and failures unchanged. */
export function decodedQueryResultSizes(value: unknown): Pick<TraceDispatchRecord,
  "returnedRowCount" | "decodedResultJsonUtf8Bytes"> {
  const measured = Result.try({
    try: () => {
      const results: unknown[] = Array.isArray(value) ? value : [value];
      const rows: unknown[] = [];
      for (const result of results) {
        if (!isRecord(result) || !Array.isArray(result.rows)) throw new Error("Unrecognized decoded query result");
        rows.push(...result.rows);
      }
      const encoded = JSON.stringify(rows, (_key, field: unknown) => typeof field === "bigint" ? field.toString() : field);
      return { returnedRowCount: rows.length, decodedResultJsonUtf8Bytes: Buffer.byteLength(encoded, "utf8") };
    }, catch: () => null,
  });
  return Result.getOrElse(measured, () => ({ returnedRowCount: null, decodedResultJsonUtf8Bytes: null }));
}

function checkoutGroups(records: readonly TraceCheckoutRecord[]): readonly TraceCheckoutGroup[] {
  const groups = new Map<string, { -readonly [K in keyof TraceCheckoutGroup]: TraceCheckoutGroup[K] }>();
  for (const record of records) {
    const key = JSON.stringify([record.pool, record.phasePath]);
    let group = groups.get(key);
    if (group === undefined) {
      group = { pool: record.pool, phasePath: record.phasePath, checkoutCount: 0,
        awaitedMsSum: 0, awaitedMsMin: Number.POSITIVE_INFINITY, awaitedMsMax: 0, errorCount: 0 };
      groups.set(key, group);
    }
    group.checkoutCount++;
    group.awaitedMsSum += record.awaitedMs;
    group.awaitedMsMin = Math.min(group.awaitedMsMin, record.awaitedMs);
    group.awaitedMsMax = Math.max(group.awaitedMsMax, record.awaitedMs);
    if (record.outcome === "error") group.errorCount++;
  }
  return [...groups.values()];
}

function transactionGroups(records: readonly TraceTransactionInterval[]): readonly TraceTransactionGroup[] {
  const groups = new Map<string, { -readonly [K in keyof TraceTransactionGroup]: TraceTransactionGroup[K] }>();
  for (const record of records) {
    const key = JSON.stringify([record.pool, record.phasePath, record.outcome]);
    let group = groups.get(key);
    if (group === undefined) {
      group = { pool: record.pool, phasePath: record.phasePath, outcome: record.outcome,
        intervalCount: 0, durationMsSum: 0, durationMsMin: Number.POSITIVE_INFINITY, durationMsMax: 0 };
      groups.set(key, group);
    }
    group.intervalCount++;
    group.durationMsSum += record.durationMs;
    group.durationMsMin = Math.min(group.durationMsMin, record.durationMs);
    group.durationMsMax = Math.max(group.durationMsMax, record.durationMs);
  }
  return [...groups.values()];
}

/** Conservative lexer: uncertain SQL is counted as unknown, never split on raw semicolons. */
export function structuralSql(input: unknown): Readonly<{ template: string; fingerprint: string; statementCount: number | null;
  transactionAction: TraceDispatchRecord["transactionAction"] }> | null {
  const sql = typeof input === "string" ? input : isRecord(input) && typeof input.text === "string" ? input.text : null;
  if (sql === null) return null;
  const tokens: string[] = [];
  let statements = 0;
  let inStatement = false;
  let i = 0;
  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];
    if (char === undefined) break;
    if (/\s/.test(char)) { i++; continue; }
    if (char === "-" && next === "-") {
      i += 2;
      while (i < sql.length && sql[i] !== "\n" && sql[i] !== "\r") i++;
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      let depth = 1;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; }
        else i++;
      }
      if (depth !== 0) return null;
      continue;
    }
    if (char === ";") {
      if (inStatement) statements++;
      inStatement = false;
      tokens.push(";");
      i++;
      continue;
    }
    if (char === "'") {
      const prefix = sql.slice(Math.max(0, i - 3), i);
      const escaped = /(?:^|[^a-z0-9_])(?:e|E|u&|U&)$/.test(prefix);
      i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === "\\") {
          // Backslash semantics depend on the literal prefix and server setting.
          if (!escaped) return null;
          i += 2; continue;
        }
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; closed = true; break; }
        i++;
      }
      if (!closed) return null;
      tokens.push("?"); inStatement = true;
      continue;
    }
    if (char === '"') {
      let identifier = '"';
      i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') { identifier += '""'; i += 2; continue; }
        if (sql[i] === '"') { identifier += '"'; i++; closed = true; break; }
        identifier += sql[i]; i++;
      }
      if (!closed) return null;
      tokens.push(identifier); inStatement = true;
      continue;
    }
    if (char === "$" && /[0-9]/.test(next ?? "")) {
      i += 2;
      while (i < sql.length && /[0-9]/.test(sql[i] ?? "")) i++;
      tokens.push("$?"); inStatement = true;
      continue;
    }
    if (char === "$") {
      const tag = /^\$[a-zA-Z_][a-zA-Z_0-9]*\$|^\$\$/.exec(sql.slice(i))?.[0];
      if (tag !== undefined) {
        const end = sql.indexOf(tag, i + tag.length);
        if (end < 0) return null;
        i = end + tag.length;
        tokens.push("?"); inStatement = true;
        continue;
      }
    }
    if (/[0-9]/.test(char) || char === "." && /[0-9]/.test(next ?? "")) {
      const end = numericEnd(sql, i);
      if (end === null) return null;
      i = end;
      tokens.push("?"); inStatement = true;
      continue;
    }
    if (/[a-zA-Z_]/.test(char)) {
      let word = char;
      i++;
      while (i < sql.length && /[a-zA-Z_0-9$]/.test(sql[i] ?? "")) { word += sql[i]; i++; }
      tokens.push(word.toLowerCase()); inStatement = true;
      continue;
    }
    tokens.push(char); inStatement = true; i++;
  }
  if (inStatement) statements++;
  const template = tokens.join(" ");
  const fingerprint = createHash("sha256").update(template).digest("hex");
  const words = tokens.filter(token => token !== ";");
  const first = words[0];
  const second = words[1];
  const chained = words.includes("chain");
  let transactionAction: TraceDispatchRecord["transactionAction"] = null;
  if (statements === 1 && !chained) {
    if (first === "begin" || first === "start" && second === "transaction") transactionAction = "begin";
    else if (first === "commit" || first === "end") transactionAction = "commit";
    else if (first === "rollback" && second !== "to" || first === "abort") transactionAction = "rollback";
  }
  return { template, fingerprint, statementCount: statements, transactionAction };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Diagnostic input sizes, without running pg converters or retaining values.
 * Arrays/objects/custom serializers remain unknown, not estimated wire bytes. */
function dispatchInputSizes(args: readonly unknown[]): Pick<TraceDispatchRecord,
  "parameterCount" | "scalarParameterBytes" | "unknownEncodingParameters" | "sqlUtf8Bytes"> {
  const input = args[0];
  const textDescriptor = isRecord(input) ? Object.getOwnPropertyDescriptor(input, "text") : undefined;
  const text: unknown = typeof input === "string" ? input : textDescriptor !== undefined && "value" in textDescriptor ? textDescriptor.value : undefined;
  const valuesDescriptor = isRecord(input) ? Object.getOwnPropertyDescriptor(input, "values") : undefined;
  const values: unknown = Array.isArray(args[1]) ? args[1] : valuesDescriptor !== undefined && "value" in valuesDescriptor ? valuesDescriptor.value : undefined;
  const sqlUtf8Bytes = typeof text === "string" ? new TextEncoder().encode(text).byteLength : null;
  if (values === undefined && (typeof input === "string" || isRecord(input) && valuesDescriptor === undefined && typeof text === "string"))
    return { parameterCount: 0, scalarParameterBytes: 0, unknownEncodingParameters: 0, sqlUtf8Bytes };
  if (!Array.isArray(values)) return { parameterCount: null, scalarParameterBytes: null, unknownEncodingParameters: null, sqlUtf8Bytes };
  let scalarParameterBytes = 0;
  let unknownEncodingParameters = 0;
  for (let ordinal = 0; ordinal < values.length; ordinal++) {
    const descriptor = Object.getOwnPropertyDescriptor(values, ordinal);
    if (descriptor === undefined || !("value" in descriptor)) { unknownEncodingParameters++; continue; }
    const value: unknown = descriptor.value;
    if (value instanceof Uint8Array) scalarParameterBytes += value.byteLength;
    else if (typeof value === "string") scalarParameterBytes += new TextEncoder().encode(value).byteLength;
    else if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
      scalarParameterBytes += new TextEncoder().encode(String(value)).byteLength;
    else if (value !== null) unknownEncodingParameters++;
  }
  return { parameterCount: values.length, scalarParameterBytes, unknownEncodingParameters, sqlUtf8Bytes };
}

function stackFrames(): readonly string[] {
  return (new Error().stack ?? "").split("\n").slice(1)
    .map(line => line.trim()).filter(line => !/[\\/]mixedMutationPerformanceTrace\.ts[:)]/.test(line)
      && !line.includes("node_modules/pg") && !line.includes("node_modules\\pg"))
    .slice(0, 8);
}

export function createMixedMutationPerformanceTrace(input: Readonly<{ controlPool: Pool; targetPool: Pool }>): MixedMutationPerformanceTrace {
  const storage = new AsyncLocalStorage<TraceContext>();
  const records: TraceInvocationRecord[] = [];
  const owners = new Map<string, MutableOwnerGroup>();
  const usedIds = new Set<string>();
  const restores: Array<() => void> = [];
  const activeTransactions = new WeakMap<PoolClient, ActiveTransaction>();
  const activeTransactionClients = new Set<PoolClient>();
  const activeInvocations = new Set<MutableInvocation>();
  // Hash keys avoid retaining raw SQL text (which could contain inlined values).
  const sqlCache = new Map<string, ReturnType<typeof structuralSql>>();
  let closed = false;
  let inFlight = 0;

  function parsedSql(value: unknown): ReturnType<typeof structuralSql> {
    const text = typeof value === "string" ? value : isRecord(value) && typeof value.text === "string" ? value.text : null;
    if (text === null) return null;
    const key = createHash("sha256").update(text).digest("hex");
    if (sqlCache.has(key)) return sqlCache.get(key) ?? null;
    const parsed = structuralSql(text);
    if (sqlCache.size >= 4_096) sqlCache.clear();
    sqlCache.set(key, parsed);
    return parsed;
  }

  function restoreOwnMethod<T extends object, K extends keyof T>(object: T, key: K, wrapper: T[K]): void {
    const own = Object.getOwnPropertyDescriptor(object, key);
    Object.defineProperty(object, key, { configurable: true, writable: true, value: wrapper });
    restores.push(() => {
      if (object[key] !== wrapper) throw new Error(`Trace lost ownership of ${String(key)} wrapper.`);
      if (own === undefined) Reflect.deleteProperty(object, key);
      else Object.defineProperty(object, key, own);
    });
  }

  function install(pool: Pool, poolName: TracePool): void {
    const originalConnect = pool.connect;
    const originalPoolQuery = pool.query;
    const wrappedClients = new WeakSet<PoolClient>();

    function wrapClient(client: PoolClient): void {
      if (wrappedClients.has(client)) return;
      wrappedClients.add(client);
      const originalQuery = client.query;
      // SAFETY: pg query overloads share this runtime argument and return protocol.
      const tracedQuery = function (this: PoolClient, ...args: unknown[]): unknown {
        const context = storage.getStore();
        if (context === undefined || context.invocation.spans[0]?.end !== undefined) {
          // The client boundary is the only dispatch counter: pool.query delegates here.
          // Without context we cannot assign its SQL, pool time or phase to an invocation.
          // A synchronous pg validation throw is not a submitted dispatch.
          const result = Reflect.apply(originalQuery, this, args);
          for (const active of activeInvocations) active.lostContextDispatches++;
          return result;
        }
        const invocation = context.invocation;
        const sql = parsedSql(args[0]);
        const path = phasePath(invocation, context.span);
        const record: MutableDispatchRecord = {
          pool: poolName, phasePath: path, atMs: 0, awaitedMs: null,
          outcome: "unobserved", fingerprint: sql?.fingerprint ?? null, template: sql?.template ?? null,
          statementCount: sql?.statementCount ?? null, transactionAction: sql?.transactionAction ?? null,
          delegatedPoolQuery: context.delegatedPoolQuery,
          returnedRowCount: null, decodedResultJsonUtf8Bytes: null,
          ...dispatchInputSizes(args),
        };
        invocation.dispatches.push(record);
        if (context.delegatedPoolQuery) invocation.delegatedPoolQueryDispatches++;
        if (invocation.mode === "recon" && sql !== null) {
          const key = JSON.stringify([poolName, sql.fingerprint, path]);
          let group = owners.get(key);
          if (group === undefined) {
            group = { pool: poolName, fingerprint: sql.fingerprint, phasePath: path,
              sites: new Map(), observedDispatches: 0 };
            owners.set(key, group);
          }
          group.observedDispatches++;
          const frames = context.reconFrames ?? stackFrames();
          const siteId = createHash("sha256").update(frames.join("\n")).digest("hex");
          let site = group.sites.get(siteId);
          if (site === undefined) {
            site = { siteId, owner: frames.find(frame => /packages[\\/][^\\/]+[\\/]src[\\/]/.test(frame)) ?? null,
              sourceFrames: frames, dispatchCount: 0 };
            group.sites.set(siteId, site);
          }
          site.dispatchCount++;
        }
        const action = record.transactionAction;
        const callbackIndex = typeof args[args.length - 1] === "function" ? args.length - 1 : -1;
        let finished = false;
        let start = 0;
        const finish = (outcome: "ok" | "error", result?: unknown): void => {
          if (finished) return;
          finished = true;
          const end = performance.now();
          record.awaitedMs = elapsed(start, end);
          record.outcome = outcome;
          if (outcome === "ok") Object.assign(record, decodedQueryResultSizes(result));
          if (action === "begin" && outcome === "error") {
            activeTransactions.delete(client);
            activeTransactionClients.delete(client);
          }
          if (action === "commit" || action === "rollback") {
            const active = activeTransactions.get(client);
            if (active !== undefined) {
              active.invocation.transactions.push({ pool: active.pool, phasePath: active.phasePath,
                startMs: elapsed(active.invocation.start, active.start), endMs: elapsed(active.invocation.start, end),
                durationMs: elapsed(active.start, end),
                outcome: outcome === "ok" ? action : action === "commit" ? "commit-error" : "rollback-error" });
              activeTransactions.delete(client);
              activeTransactionClients.delete(client);
            }
          }
        };
        if (callbackIndex >= 0) {
          const callback = args[callbackIndex];
          if (typeof callback === "function") {
            args[callbackIndex] = function (this: unknown, ...callbackArgs: unknown[]) {
              finish(callbackArgs[0] == null ? "ok" : "error", callbackArgs[1]);
              return storage.run({ ...context, delegatedPoolQuery: false, reconFrames: undefined },
                () => Reflect.apply(callback, this, callbackArgs));
            };
          }
        }
        try {
          // The timed interval starts at driver submission, after trace preparation.
          start = performance.now();
          record.atMs = elapsed(invocation.start, start);
          if (action === "begin") {
            activeTransactions.set(client, { invocation, pool: poolName, phasePath: path, start });
            activeTransactionClients.add(client);
          }
          const result = Reflect.apply(originalQuery, this, args);
          if (callbackIndex < 0 && isPromiseLike(result)) {
            void result.then(value => finish("ok", value), () => finish("error"));
          }
          return result;
        } catch (error) {
          finish("error");
          throw error;
        }
      } as typeof client.query;
      restoreOwnMethod(client, "query", tracedQuery);
    }

    // SAFETY: This test-only wrapper preserves both pg connect overloads and their original result form.
    const tracedConnect = function (this: Pool, callback?: ConnectCallback): Promise<PoolClient> | void {
      const context = storage.getStore();
      const start = performance.now();
      const finish = (outcome: "ok" | "error", client?: PoolClient): void => {
        if (client !== undefined) wrapClient(client);
        if (context !== undefined) context.invocation.checkouts.push({ pool: poolName,
          phasePath: phasePath(context.invocation, context.span), atMs: elapsed(context.invocation.start, start),
          awaitedMs: elapsed(start, performance.now()), outcome });
      };
      if (callback !== undefined) {
        Reflect.apply(originalConnect, this, [(error: Error | undefined, client: PoolClient | undefined,
          done: (release?: unknown) => void) => {
          finish(error === undefined ? "ok" : "error", client);
          return context === undefined ? callback(error, client, done)
            : storage.run(context, () => callback(error, client, done));
        }]);
        return;
      }
      const acquired: unknown = Reflect.apply(originalConnect, this, []);
      if (!isPromiseLike(acquired)) throw new Error("pg Pool.connect did not return a Promise.");
      return Promise.resolve(acquired).then(client => {
        if (!isPoolClient(client)) throw new Error("pg Pool.connect returned no client.");
        finish("ok", client);
        return client;
      }, error => {
        finish("error");
        throw error;
      });
    } as typeof pool.connect;
    restoreOwnMethod(pool, "connect", tracedConnect);

    // SAFETY: pg pool query overloads share this runtime argument and return protocol.
    const tracedPoolQuery = function (this: Pool, ...args: unknown[]): unknown {
      const context = storage.getStore();
      if (context === undefined) return Reflect.apply(originalPoolQuery, this, args);
      context.invocation.poolQueryCalls++;
      // Capture the source callsite before pg-pool's internal callback frames.
      const reconFrames = context.invocation.mode === "recon" ? stackFrames() : undefined;
      return storage.run({ ...context, delegatedPoolQuery: true,
        ...(reconFrames === undefined ? {} : { reconFrames }) },
        () => Reflect.apply(originalPoolQuery, this, args));
    } as typeof pool.query;
    restoreOwnMethod(pool, "query", tracedPoolQuery);
  }

  // A standalone CMS host may use one pool for both authorities. Observe that
  // pool once as target so delegated calls and disposal are never duplicated.
  if (input.controlPool !== input.targetPool) install(input.controlPool, "control");
  install(input.targetPool, "target");

  return {
    async withInvocation<T>(details: Readonly<{ id: string; mode: TraceMode }>, run: () => Promise<T>): Promise<T> {
      if (closed) throw new Error("Trace is closed.");
      if (usedIds.has(details.id)) throw new Error(`Duplicate trace invocation ID: ${details.id}`);
      usedIds.add(details.id);
      const start = performance.now();
      const root: MutableSpan = { id: 0, parentId: null, name: "invocation", start };
      const invocation: MutableInvocation = { id: details.id, mode: details.mode, start, spans: [root],
        dispatches: [], checkouts: [], transactions: [], poolQueryCalls: 0, delegatedPoolQueryDispatches: 0,
        lostContextDispatches: 0 };
      inFlight++;
      activeInvocations.add(invocation);
      let outcome: TraceInvocationRecord["outcome"] = "ok";
      try {
        return await storage.run({ invocation, span: root, delegatedPoolQuery: false }, run);
      } catch (error) {
        outcome = "error";
        throw error;
      } finally {
        root.end = performance.now();
        activeInvocations.delete(invocation);
        inFlight--;
        for (const client of activeTransactionClients) {
          const active = activeTransactions.get(client);
          if (active?.invocation !== invocation) continue;
          invocation.transactions.push({ pool: active.pool, phasePath: active.phasePath,
            startMs: elapsed(start, active.start), endMs: elapsed(start, root.end),
            durationMs: elapsed(active.start, root.end), outcome: "open-at-end" });
          activeTransactions.delete(client);
          activeTransactionClients.delete(client);
        }
        const spans = finishSpans(invocation, root.end);
        const dispatchAwaitedUnionMs = intervalUnion(invocation.dispatches.flatMap(dispatch => dispatch.awaitedMs === null
          ? [] : [{ start: dispatch.atMs, end: dispatch.atMs + dispatch.awaitedMs }]));
        const checkoutAwaitedUnionMs = intervalUnion(invocation.checkouts.map(checkout => ({
          start: checkout.atMs, end: checkout.atMs + checkout.awaitedMs,
        })));
        records.push({ id: invocation.id, mode: invocation.mode, startedAtMs: invocation.start, durationMs: elapsed(start, root.end), outcome,
          spans, dispatchGroups: dispatchGroups(invocation.dispatches), checkoutGroups: checkoutGroups(invocation.checkouts),
          transactionGroups: transactionGroups(invocation.transactions),
          dispatches: invocation.mode === "recon" ? [...invocation.dispatches] : [],
          checkouts: invocation.mode === "recon" ? [...invocation.checkouts] : [],
          transactions: invocation.mode === "recon" ? [...invocation.transactions] : [],
          dispatchAwaitedUnionMs, checkoutAwaitedUnionMs, poolQueryCalls: invocation.poolQueryCalls,
          delegatedPoolQueryDispatches: invocation.delegatedPoolQueryDispatches,
          lostContextDispatches: invocation.lostContextDispatches,
          unobservedDispatches: invocation.dispatches.filter(dispatch => dispatch.outcome === "unobserved").length,
          unknownStatementDispatches: invocation.dispatches.filter(dispatch => dispatch.statementCount === null).length,
          incompleteSpans: spans.filter(span => !span.complete).length });
      }
    },
    async withPhase<T>(name: string, run: () => Promise<T>): Promise<T> {
      const context = storage.getStore();
      if (context === undefined) throw new Error("Trace phase requires an invocation.");
      if (name.length === 0) throw new Error("Trace phase name must be nonempty.");
      const span: MutableSpan = { id: context.invocation.spans.length, parentId: context.span.id,
        name, start: performance.now() };
      context.invocation.spans.push(span);
      try { return await storage.run({ ...context, span, delegatedPoolQuery: false, reconFrames: undefined }, run); }
      finally { span.end = performance.now(); }
    },
    bindCurrent<Args extends unknown[], T>(run: (...args: Args) => Promise<T>): (...args: Args) => Promise<T> {
      const context = storage.getStore();
      if (context === undefined) throw new Error("Trace callback binding requires an invocation.");
      const bound: TraceContext = { invocation: context.invocation, span: context.span, delegatedPoolQuery: false };
      return (...args: Args) => storage.run(bound, () => run(...args));
    },
    records: () => [...records],
    drainRecords: () => records.splice(0),
    ownerMappings: () => [...owners.values()].map(group => {
      const sourceSites = [...group.sites.values()].map(site => ({ ...site }));
      const only = sourceSites.length === 1 ? sourceSites[0] : undefined;
      return { pool: group.pool, fingerprint: group.fingerprint, phasePath: group.phasePath,
        status: only === undefined ? "ambiguous" as const : only.owner === null ? "unattributed" as const : "single" as const,
        owner: only?.owner ?? null, observedDispatches: group.observedDispatches, sourceSites };
    }),
    close(): void {
      if (closed) return;
      if (inFlight !== 0) throw new Error("Cannot close trace while an invocation is active.");
      for (const restore of restores.toReversed()) restore();
      closed = true;
    },
  };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value.then === "function";
}

function isPoolClient(value: unknown): value is PoolClient {
  return isRecord(value) && typeof value.query === "function" && typeof value.release === "function";
}
