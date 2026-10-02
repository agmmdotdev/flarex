import { performance } from "node:perf_hooks";
import { openRetrievalServerObserver, retrievalServerDifference } from
  "../../../medusa-adapter/benchmarks/core-performance/native-retrieval/server";

type ServerObserver = Awaited<ReturnType<typeof openRetrievalServerObserver>>;
type Snapshot = Awaited<ReturnType<ServerObserver["snapshot"]>>;

export interface PublicationFailedServerWindow {
  readonly name: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly snapshotMs: number;
  readonly classification: "snapshotFailure" | "statisticsDifferenceRefused" | "duplicateWindow";
  readonly before: Snapshot | null;
  readonly after: Snapshot | null;
}

/** One publication diagnostic lane's file admission, before either log copy. */
export function admitPublicationServerLogCopies(input: Readonly<{
  appendBytes: number; selectedBytes: number; combinedCap: number;
  freeBytes: number; remainingArtifactReservation: number;
}>) {
  const combinedBytes = input.appendBytes + input.selectedBytes;
  const reason = ![input.appendBytes, input.selectedBytes, input.combinedCap, input.freeBytes,
    input.remainingArtifactReservation].every(value => Number.isSafeInteger(value) && value >= 0)
    ? "invalidByteBounds" : combinedBytes > input.combinedCap ? "combinedLogByteCap" :
      combinedBytes + input.remainingArtifactReservation > input.freeBytes ? "insufficientFreeCapacity" : null;
  return reason === null ? { kind: "allowed" as const, combinedBytes } :
    { kind: "refused" as const, reason, combinedBytes };
}

/** PostgreSQL's declared default stderr prefix. Continuation lines belong to
 * their preceding header; unknown prefixes refuse a coverage claim. */
export function filterPublicationServerLog(log: string, authenticatedPids: ReadonlySet<number>) {
  const retained: string[] = [];
  let selected = false;
  let recognizedHeaders = 0, excludedHeaders = 0, unrecognizedLines = 0;
  for (const line of log.split(/(?<=\n)/)) {
    const header = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+(?:[A-Z0-9:+-]+\s+)?\[(\d+)\]\s/.exec(line);
    if (header !== null) {
      recognizedHeaders++;
      selected = authenticatedPids.has(Number(header[1]));
      if (!selected) excludedHeaders++;
    } else if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:/.test(line) || recognizedHeaders === 0) {
      selected = false; unrecognizedLines++;
    }
    if (selected) retained.push(line);
  }
  return { log: retained.join(""), recognizedHeaders, excludedHeaders, unrecognizedLines,
    coverage: unrecognizedLines === 0 && recognizedHeaders > 0 ? "declaredPrefix" : "partialOrUnavailable" };
}

/** Benchmark-only brackets around the real owner. No authority, database writer,
 * transaction, or business callback crosses this diagnostic value. */
export class PublicationPerformanceServer {
  readonly windows: {
    name: string; startMs: number; endMs: number; snapshotMs: number;
    before: Snapshot; after: Snapshot; delta: ReturnType<typeof retrievalServerDifference>;
  }[] = [];
  readonly failedWindows: PublicationFailedServerWindow[] = [];
  private readonly open = new Map<string, { before: Snapshot; startMs: number; snapshotMs: number }>();
  private firstFailure: unknown;
  private failures = 0;
  constructor(private readonly observer: Pick<ServerObserver, "snapshot">) {}

  async begin(name: string): Promise<void> {
    const started = performance.now();
    // Only the foreign diagnostic driver operation is caught. Its failure
    // cannot replace the genuine business outcome or its cleanup Cause.
    let snapshot: Snapshot;
    try { snapshot = await this.observer.snapshot(); }
    catch (cause) {
      this.failed(cause);
      this.failedWindows.push({ name, startMs: started, endMs: performance.now(), snapshotMs: performance.now() - started,
        classification: "snapshotFailure", before: null, after: null });
      return;
    }
    if (this.open.has(name)) {
      this.failed(new Error("Duplicate server diagnostic window"));
      this.failedWindows.push({ name, startMs: started, endMs: performance.now(), snapshotMs: performance.now() - started,
        classification: "duplicateWindow", before: snapshot, after: null });
      return;
    }
    this.open.set(name, { before: snapshot, startMs: performance.now(), snapshotMs: performance.now() - started });
  }

  async end(name: string): Promise<void> {
    const endMs = performance.now();
    const opened = this.open.get(name);
    this.open.delete(name);
    if (opened === undefined) return;
    const started = performance.now();
    let after: Snapshot;
    try { after = await this.observer.snapshot(); }
    catch (cause) {
      this.failed(cause);
      this.failedWindows.push({ name, startMs: opened.startMs, endMs,
        snapshotMs: opened.snapshotMs + performance.now() - started,
        classification: "snapshotFailure", before: opened.before, after: null });
      return;
    }
    let delta: ReturnType<typeof retrievalServerDifference>;
    try { delta = retrievalServerDifference(opened.before, after); }
    catch (cause) {
      this.failed(cause);
      this.failedWindows.push({ name, startMs: opened.startMs, endMs,
        snapshotMs: opened.snapshotMs + performance.now() - started,
        classification: "statisticsDifferenceRefused", before: opened.before, after });
      return;
    }
    this.windows.push({ name, startMs: opened.startMs, endMs,
      snapshotMs: opened.snapshotMs + performance.now() - started, before: opened.before, after, delta });
  }

  beginPublication(): Promise<void> { return this.begin("publication"); }
  endPublication(): Promise<void> { return this.end("publication"); }
  status() { return { failures: this.failures, openWindows: this.open.size }; }
  compact() {
    const epoch = (snapshot: Snapshot | null) => snapshot?.info[0] === undefined ? null :
      { statsReset: snapshot.info[0].stats_reset, dealloc: snapshot.info[0].dealloc };
    return { status: this.status(), windows: this.windows.map(window => ({ name: window.name,
      startMs: window.startMs, endMs: window.endMs, snapshotMs: window.snapshotMs,
      before: epoch(window.before), after: epoch(window.after),
      beforeStatementEntries: window.before.statements.length, afterStatementEntries: window.after.statements.length })),
    failedWindows: this.failedWindows.map(window => ({ name: window.name,
      startMs: window.startMs, endMs: window.endMs, snapshotMs: window.snapshotMs,
      classification: window.classification, before: epoch(window.before), after: epoch(window.after),
      beforeStatementEntries: window.before?.statements.length ?? null,
      afterStatementEntries: window.after?.statements.length ?? null })) };
  }
  assertHealthy(): void {
    if (this.failures !== 0 || this.open.size !== 0)
      throw new Error("Publication server diagnostics failed", { cause: this.firstFailure });
  }
  private failed(cause: unknown): void {
    if (this.failures === 0) this.firstFailure = cause;
    this.failures++;
  }
}
