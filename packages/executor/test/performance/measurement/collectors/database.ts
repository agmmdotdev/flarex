import type { TraceFingerprintOwner, TraceInvocationRecord } from "../../../../../persistence-postgres/test/mixedMutationPerformanceTrace";
import type { MeasurementEvent, MeasurementObserver } from "../artifact";

/** Translate the existing driver observer once, after settlement. No database
 * operation, owner lookup or serialization is added to the request here. */
export function databaseEvents(record: TraceInvocationRecord, mappings: readonly TraceFingerprintOwner[], origin: number,
  operations: readonly MeasurementEvent[]) {
  const offset = record.startedAtMs - origin;
  const events: MeasurementEvent[] = [];
  const operationById = new Map(operations.filter(event => event.kind === "effectSpan" || event.kind === "phase")
    .map(event => [event.id, event]));
  for (const dispatch of record.dispatches) {
    const source = mappings.find(mapping => mapping.pool === dispatch.pool && mapping.fingerprint === dispatch.fingerprint &&
      JSON.stringify(mapping.phasePath) === JSON.stringify(dispatch.phasePath));
    const sites = source?.sourceSites ?? [];
    const operation = dispatch.operationId === null ? undefined : operationById.get(dispatch.operationId);
    events.push({ kind: "driverAwait", id: `database:${dispatch.eventId}`, sequence: dispatch.eventId,
      startMs: offset + dispatch.atMs,
      endMs: dispatch.awaitedMs === null ? null : offset + dispatch.atMs + dispatch.awaitedMs,
      owner: operation?.owner ?? null, site: operation?.site ?? null,
      ownerCandidates: [], parentId: dispatch.operationId,
      pool: dispatch.pool, phasePath: dispatch.phasePath, connectionId: dispatch.connectionId,
      checkoutId: dispatch.checkoutId, transactionId: dispatch.transactionId,
      fingerprint: dispatch.fingerprint, template: dispatch.template, statementCount: dispatch.statementCount,
      parameterCount: dispatch.parameterCount, scalarParameterBytes: dispatch.scalarParameterBytes,
      unknownEncodingParameters: dispatch.unknownEncodingParameters, sqlUtf8Bytes: dispatch.sqlUtf8Bytes,
      returnedRowCount: dispatch.returnedRowCount ?? null, decodedResultJsonUtf8Bytes: dispatch.decodedResultJsonUtf8Bytes ?? null,
      transactionAction: dispatch.transactionAction, sourceFrames: sites.flatMap(site => site.sourceFrames),
      sourceSiteIds: sites.map(site => site.siteId),
      sourceOwnerCandidates: [...new Set(sites.flatMap(site => site.owner === null ? [] : [site.owner]))],
      outcome: dispatch.outcome === "ok" ? "success" : dispatch.outcome === "error" ? "failure" : "unknown" });
  }
  for (const checkout of record.checkouts) {
    const operation = checkout.operationId === null ? undefined : operationById.get(checkout.operationId);
    events.push({ kind: "checkoutAwait", id: `database:${checkout.eventId}`,
      sequence: checkout.eventId, startMs: offset + checkout.atMs, endMs: offset + checkout.atMs + checkout.awaitedMs,
      owner: operation?.owner ?? null, site: operation?.site ?? null, parentId: checkout.operationId,
      pool: checkout.pool, phasePath: checkout.phasePath,
      connectionId: checkout.connectionId, checkoutId: checkout.checkoutId, transactionId: null,
      outcome: checkout.outcome === "ok" ? "success" : "failure" });
  }
  for (const transaction of record.transactions) events.push({ kind: "transaction", id: `database:${transaction.eventId}`,
    sequence: transaction.eventId, startMs: offset + transaction.startMs,
    endMs: transaction.outcome === "open-at-end" ? null : offset + transaction.endMs,
    owner: null, site: null, parentId: null, pool: transaction.pool, phasePath: transaction.phasePath,
    connectionId: transaction.connectionId, checkoutId: transaction.checkoutId, transactionId: transaction.transactionId,
    settlement: transaction.outcome });
  const observers: MeasurementObserver[] = record.observerIntervals.map(observer => ({ kind: "observer",
    id: `database-observer:${observer.eventId}`, sequence: observer.eventId, name: observer.kind,
    startMs: offset + observer.startMs, endMs: offset + observer.endMs, owner: "measurement", site: "databaseCollector",
    parentId: null, outcome: observer.outcome === "ok" ? "success" : "failure" }));
  return { events, observers };
}
