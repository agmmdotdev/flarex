import { Data, Result } from "effect";
import { decodeMeasurementEvidence, type MeasurementEvent, type MeasurementEvidence } from "./artifact";

export class InvalidMeasurementEvidence extends Data.TaggedError("InvalidMeasurementEvidence")<{
  readonly reason: "invalidEvidence" | "accountingMismatch";
  readonly detail: string;
}> {}

type IntervalEvent = Exclude<MeasurementEvent, { readonly kind: "work" }>;
export type AttributionStatus = "attributed" | "ambiguous" | "unattributed" | "observer";
export interface MeasurementPartition {
  readonly startMs: number;
  readonly endMs: number;
  readonly durationMs: number;
  readonly phaseIds: readonly string[];
  readonly spanIds: readonly string[];
  readonly driverAwaitIds: readonly string[];
  readonly checkoutAwaitIds: readonly string[];
  readonly transactionIds: readonly string[];
  readonly observerIds: readonly string[];
  readonly ownerCandidates: readonly string[];
  readonly attribution: AttributionStatus;
  readonly driverWaiting: boolean;
  readonly checkoutWaiting: boolean;
  readonly observerActive: boolean;
}

export interface MeasurementAnalysis {
  readonly evidence: MeasurementEvidence;
  readonly diagnostic: "complete" | "incomplete";
  readonly incompleteReasons: readonly string[];
  readonly requestOutcome: MeasurementEvidence["root"]["outcome"];
  readonly partitions: readonly MeasurementPartition[];
  /** Same root partition in two ledgers. These totals must never be added. */
  readonly phaseLedger: Readonly<Record<AttributionStatus, number>>;
  readonly waitLedger: Readonly<{ driverOnlyMs: number; checkoutOnlyMs: number; bothMs: number; neitherMs: number }>;
  readonly wall: Readonly<{ rootMs: number; partitionMs: number; phaseLedgerMs: number; waitLedgerMs: number;
    reconciliationErrorMs: number; roundingToleranceMs: number; driverAwaitUnionMs: number;
    checkoutAwaitUnionMs: number; observerUnionMs: number; observerAwaitOverlapMs: number;
    phaseOverlapMs: number; postRequestObserverUnionMs: number }>;
  readonly coverage: Readonly<{ attributedMs: number; ambiguousMs: number; unattributedMs: number;
    observerOnlyMs: number; attributedFraction: number | null }>;
  /** Inclusive owner wall is a union for that owner; entries can overlap each other. */
  readonly owners: readonly Readonly<{ owner: string; attributedWallMs: number; inclusiveObservedWallMs: number;
    phaseCount: number; spanCount: number; driverExchangeCount: number; workEventCount: number }>[];
  readonly work: readonly Readonly<{ owner: string | null; site: string | null; metric: string;
    unit: "count" | "bytes" | "milliseconds"; value: number; eventCount: number }>[];
  readonly database: Readonly<{ driverExchanges: number; checkouts: number; transactions: number;
    observedStatements: number; unknownStatementExchanges: number; observedReturnedRows: number;
    unknownRowExchanges: number; observedDecodedJsonBytes: number; unknownDecodedJsonByteExchanges: number }>;
}

function observerUnion(intervals: readonly Readonly<{ startMs: number; endMs: number | null }>[]): number {
  let end = 0;
  let total = 0;
  for (const interval of intervals.toSorted((a, b) => a.startMs - b.startMs)) {
    if (interval.endMs === null) continue;
    total += Math.max(0, interval.endMs - Math.max(interval.startMs, end));
    end = Math.max(end, interval.endMs);
  }
  return total;
}

/** A deterministic endpoint sweep. Overlapping observations survive in each
 * state; no duration is subtracted from instrumented wall to invent CPU cost. */
function analyze(evidence: MeasurementEvidence): Result.Result<MeasurementAnalysis, InvalidMeasurementEvidence> {
  const intervals = evidence.events.filter((event): event is IntervalEvent => event.kind !== "work");
  const parents = new Map(evidence.events.map(event => [event.id, event.parentId]));
  const starts = new Map<number, IntervalEvent[]>();
  const ends = new Map<number, IntervalEvent[]>();
  const endpoints = new Set([0, evidence.root.endMs]);
  for (const event of intervals) {
    const end = event.endMs ?? evidence.root.endMs;
    endpoints.add(event.startMs);
    endpoints.add(end);
    if (end === event.startMs) continue;
    const atStart = starts.get(event.startMs) ?? [];
    atStart.push(event);
    starts.set(event.startMs, atStart);
    const atEnd = ends.get(end) ?? [];
    atEnd.push(event);
    ends.set(end, atEnd);
  }
  const ordered = [...endpoints].toSorted((a, b) => a - b);
  const active = new Map<string, IntervalEvent>();
  const partitions: MeasurementPartition[] = [];
  const phaseLedger = { attributed: 0, ambiguous: 0, unattributed: 0, observer: 0 };
  const waitLedger = { driverOnlyMs: 0, checkoutOnlyMs: 0, bothMs: 0, neitherMs: 0 };
  const ownerRows = new Map<string, { owner: string; attributedWallMs: number; inclusiveObservedWallMs: number;
    phaseCount: number; spanCount: number; driverExchangeCount: number; workEventCount: number }>();
  const ownerRow = (owner: string) => {
    const retained = ownerRows.get(owner);
    if (retained !== undefined) return retained;
    const row = { owner, attributedWallMs: 0, inclusiveObservedWallMs: 0,
      phaseCount: 0, spanCount: 0, driverExchangeCount: 0, workEventCount: 0 };
    ownerRows.set(owner, row);
    return row;
  };
  let driverAwaitUnionMs = 0;
  let checkoutAwaitUnionMs = 0;
  let observerUnionMs = 0;
  let observerAwaitOverlapMs = 0;
  let phaseOverlapMs = 0;
  for (let index = 0; index < ordered.length - 1; index++) {
    const start = ordered[index];
    const end = ordered[index + 1];
    for (const event of ends.get(start) ?? []) active.delete(event.id);
    for (const event of starts.get(start) ?? []) active.set(event.id, event);
    const duration = end - start;
    const records = [...active.values()];
    const phases = records.filter(event => event.kind === "phase");
    const spans = records.filter(event => event.kind === "effectSpan");
    const operations = [...phases, ...spans];
    // An enclosing phase does not compete with its active child operation.
    const enclosingIds = new Set<string>();
    for (const event of operations) {
      let parentId: string | null | undefined = event.parentId;
      while (parentId !== null && parentId !== undefined) {
        enclosingIds.add(parentId);
        parentId = parents.get(parentId);
      }
    }
    const leaves = operations.filter(event => !enclosingIds.has(event.id));
    const candidates = new Set<string>();
    let unknownOwner = false;
    for (const event of leaves) {
      if (event.owner !== null) candidates.add(event.owner);
      for (const owner of event.ownerCandidates ?? []) candidates.add(owner);
      if (event.owner === null && (event.ownerCandidates?.length ?? 0) === 0) unknownOwner = true;
    }
    const drivers = records.filter(event => event.kind === "driverAwait");
    const checkouts = records.filter(event => event.kind === "checkoutAwait");
    const observers = records.filter(event => event.kind === "observer");
    const driverWaiting = drivers.length > 0;
    const checkoutWaiting = checkouts.length > 0;
    const observerActive = observers.length > 0;
    const attribution: AttributionStatus = candidates.size > 1 || (candidates.size > 0 && unknownOwner)
      ? "ambiguous" : candidates.size === 1 ? "attributed" : observerActive && leaves.length === 0 ? "observer" : "unattributed";
    partitions.push({ startMs: start, endMs: end, durationMs: duration,
      phaseIds: phases.map(event => event.id), spanIds: spans.map(event => event.id),
      driverAwaitIds: drivers.map(event => event.id), checkoutAwaitIds: checkouts.map(event => event.id),
      transactionIds: records.filter(event => event.kind === "transaction").map(event => event.id),
      observerIds: observers.map(event => event.id), ownerCandidates: [...candidates].toSorted(),
      attribution, driverWaiting, checkoutWaiting, observerActive });
    phaseLedger[attribution] += duration;
    if (driverWaiting && checkoutWaiting) waitLedger.bothMs += duration;
    else if (driverWaiting) waitLedger.driverOnlyMs += duration;
    else if (checkoutWaiting) waitLedger.checkoutOnlyMs += duration;
    else waitLedger.neitherMs += duration;
    if (driverWaiting) driverAwaitUnionMs += duration;
    if (checkoutWaiting) checkoutAwaitUnionMs += duration;
    if (observerActive) observerUnionMs += duration;
    if (observerActive && (driverWaiting || checkoutWaiting)) observerAwaitOverlapMs += duration;
    if (operations.length > 1) phaseOverlapMs += duration;
    const inclusiveOwners = new Set(operations.flatMap(event => event.owner === null ? [] : [event.owner]));
    for (const owner of inclusiveOwners) ownerRow(owner).inclusiveObservedWallMs += duration;
    if (attribution === "attributed") for (const owner of candidates) ownerRow(owner).attributedWallMs += duration;
  }
  const workRows = new Map<string, { owner: string | null; site: string | null; metric: string;
    unit: "count" | "bytes" | "milliseconds"; value: number; eventCount: number }>();
  const database = { driverExchanges: 0, checkouts: 0, transactions: 0, observedStatements: 0,
    unknownStatementExchanges: 0, observedReturnedRows: 0, unknownRowExchanges: 0,
    observedDecodedJsonBytes: 0, unknownDecodedJsonByteExchanges: 0 };
  for (const event of evidence.events) {
    if (event.owner !== null) {
      const row = ownerRow(event.owner);
      if (event.kind === "phase") row.phaseCount++;
      if (event.kind === "effectSpan") row.spanCount++;
      if (event.kind === "driverAwait") row.driverExchangeCount++;
      if (event.kind === "work") row.workEventCount++;
    }
    if (event.kind === "work") {
      const key = JSON.stringify([event.owner, event.site, event.metric, event.unit]);
      const row = workRows.get(key) ?? { owner: event.owner, site: event.site, metric: event.metric, unit: event.unit, value: 0, eventCount: 0 };
      row.value += event.value;
      if (!Number.isFinite(row.value) || (row.unit !== "milliseconds" && !Number.isSafeInteger(row.value))) {
        return Result.fail(new InvalidMeasurementEvidence({ reason: "invalidEvidence", detail: `Unrepresentable work total: ${event.metric}` }));
      }
      row.eventCount++;
      workRows.set(key, row);
    }
    if (event.kind === "checkoutAwait") database.checkouts++;
    if (event.kind === "transaction") database.transactions++;
    if (event.kind === "driverAwait") {
      database.driverExchanges++;
      if (event.statementCount === null) database.unknownStatementExchanges++;
      else database.observedStatements += event.statementCount;
      if (event.returnedRowCount === null) database.unknownRowExchanges++;
      else database.observedReturnedRows += event.returnedRowCount;
      if (event.decodedResultJsonUtf8Bytes === null) database.unknownDecodedJsonByteExchanges++;
      else database.observedDecodedJsonBytes += event.decodedResultJsonUtf8Bytes;
    }
  }
  const incompleteReasons: string[] = [];
  if (evidence.root.outcome === "unknown") incompleteReasons.push("unknownRequestOutcome");
  for (const event of [...intervals, ...evidence.postRequestObservers]) {
    if (event.endMs === null) incompleteReasons.push(`openInterval:${event.id}`);
    if (event.kind === "transaction" && event.settlement === "open-at-end") incompleteReasons.push(`openTransaction:${event.id}`);
    if ((event.kind === "driverAwait" || event.kind === "checkoutAwait" || event.kind === "effectSpan") && event.outcome === "unknown") incompleteReasons.push(`unknownOutcome:${event.id}`);
    if (event.kind === "observer" && event.outcome !== "success") incompleteReasons.push(`observerFailure:${event.id}`);
  }
  if (evidence.collection.droppedEvents > 0) incompleteReasons.push(`droppedEvents:${evidence.collection.droppedEvents}`);
  if (evidence.collection.lostContextEvents > 0) incompleteReasons.push(`lostContextEvents:${evidence.collection.lostContextEvents}`);
  incompleteReasons.push(...evidence.collection.failures.map(failure => `collectorFailure:${failure}`));
  const rootMs = evidence.root.endMs;
  if (![database.observedStatements, database.observedReturnedRows, database.observedDecodedJsonBytes].every(Number.isSafeInteger)) {
    return Result.fail(new InvalidMeasurementEvidence({ reason: "invalidEvidence", detail: "Unrepresentable database count total" }));
  }
  const partitionMs = partitions.reduce((sum, partition) => sum + partition.durationMs, 0);
  const phaseLedgerMs = Object.values(phaseLedger).reduce((sum, value) => sum + value, 0);
  const waitLedgerMs = Object.values(waitLedger).reduce((sum, value) => sum + value, 0);
  // Only floating-point accumulation is tolerated. Clock precision is disclosed
  // separately and must not conceal missing intervals or unmatched accounting.
  const roundingToleranceMs = Number.EPSILON * Math.max(1, rootMs) * Math.max(1, partitions.length) * 8;
  const reconciliationErrorMs = Math.max(Math.abs(rootMs - partitionMs), Math.abs(rootMs - phaseLedgerMs), Math.abs(rootMs - waitLedgerMs));
  if (reconciliationErrorMs > roundingToleranceMs) return Result.fail(new InvalidMeasurementEvidence({
    reason: "accountingMismatch", detail: `Root accounting differs by ${reconciliationErrorMs} ms`,
  }));
  const postRequestObserverUnionMs = observerUnion(evidence.postRequestObservers);
  if (!Number.isFinite(postRequestObserverUnionMs)) return Result.fail(new InvalidMeasurementEvidence({
    reason: "invalidEvidence", detail: "Unrepresentable post-request observer total",
  }));
  return Result.succeed({ evidence, diagnostic: incompleteReasons.length === 0 ? "complete" : "incomplete",
    incompleteReasons, requestOutcome: evidence.root.outcome, partitions, phaseLedger, waitLedger,
    wall: { rootMs, partitionMs, phaseLedgerMs, waitLedgerMs, reconciliationErrorMs, roundingToleranceMs,
      driverAwaitUnionMs, checkoutAwaitUnionMs, observerUnionMs, observerAwaitOverlapMs, phaseOverlapMs,
      postRequestObserverUnionMs },
    coverage: { attributedMs: phaseLedger.attributed, ambiguousMs: phaseLedger.ambiguous,
      unattributedMs: phaseLedger.unattributed, observerOnlyMs: phaseLedger.observer,
      attributedFraction: rootMs === 0 ? null : phaseLedger.attributed / rootMs },
    owners: [...ownerRows.values()].toSorted((a, b) => b.attributedWallMs - a.attributedWallMs || a.owner.localeCompare(b.owner)),
    work: [...workRows.values()], database });
}

export function analyzeMeasurementEvidence(input: unknown): Result.Result<MeasurementAnalysis, InvalidMeasurementEvidence> {
  return decodeMeasurementEvidence(input).pipe(
    Result.mapError(error => new InvalidMeasurementEvidence({ reason: "invalidEvidence", detail: String(error) })),
    Result.flatMap(analyze),
  );
}

/** Inputs are the runner's already-retained matched pairs. These arithmetic
 * checks verify a comparison, not another unknown-input observation decoder. */
export function pairedSummary(pairs: readonly Readonly<{ index: number; nativeMs: number; flarexMs: number; addedMs: number }>[])
  : Result.Result<Readonly<{ samples: number; medianAddedMs: number; p95AddedMs: number }> | null, InvalidMeasurementEvidence> {
  if (pairs.length === 0) return Result.succeed(null);
  const indices = new Set<number>();
  const added: number[] = [];
  for (const pair of pairs) {
    if (!Number.isSafeInteger(pair.index) || pair.index < 0 || indices.has(pair.index)) {
      return Result.fail(new InvalidMeasurementEvidence({ reason: "invalidEvidence", detail: `Invalid or duplicate pair index: ${pair.index}` }));
    }
    indices.add(pair.index);
    if (!Number.isFinite(pair.nativeMs) || pair.nativeMs <= 0 || !Number.isFinite(pair.flarexMs) || pair.flarexMs <= 0 || !Number.isFinite(pair.addedMs)) {
      return Result.fail(new InvalidMeasurementEvidence({ reason: "invalidEvidence", detail: `Invalid pair timing: ${pair.index}` }));
    }
    const expectedAddedMs = pair.flarexMs - pair.nativeMs;
    const roundingToleranceMs = Number.EPSILON * Math.max(Math.abs(pair.nativeMs), Math.abs(pair.flarexMs), Math.abs(pair.addedMs)) * 8;
    if (Math.abs(pair.addedMs - expectedAddedMs) > roundingToleranceMs) {
      return Result.fail(new InvalidMeasurementEvidence({ reason: "invalidEvidence", detail: `Pair excess does not match complete request difference: ${pair.index}` }));
    }
    added.push(pair.addedMs);
  }
  const ordered = added.toSorted((a, b) => a - b);
  return Result.succeed({ samples: pairs.length, medianAddedMs: ordered[Math.ceil(pairs.length * 0.5) - 1],
    p95AddedMs: ordered[Math.ceil(pairs.length * 0.95) - 1] });
}
