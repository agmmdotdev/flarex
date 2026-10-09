import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { TraceFingerprintOwner, TraceInvocationRecord } from "../../../../../persistence-postgres/test/performance/mixedMutationPerformanceTrace";
import { MeasurementEventSchema, MeasurementObserverSchema, type MeasurementEvent } from "../artifact";
import { databaseEvents } from "./database";

const phasePath = ["invocation", "publication"];
const record: TraceInvocationRecord = {
  id: "synthetic-request", mode: "recon", detail: "full", startedAtMs: 1025, durationMs: 100, outcome: "ok",
  spans: [{ id: 0, parentId: null, name: "invocation", startMs: 0, endMs: 100,
    inclusiveMs: 100, exclusiveMs: 100, complete: true }],
  dispatchGroups: [], checkoutGroups: [], transactionGroups: [],
  dispatches: [{ eventId: 2, operationId: null, backendPid: 314, pool: "target", phasePath, connectionId: 3, checkoutId: 0, transactionId: 7,
    atMs: 10, awaitedMs: 7, outcome: "ok", fingerprint: "shared-structure", template: "select ?",
    statementCount: 1, transactionAction: null, delegatedPoolQuery: false, parameterCount: 0,
    scalarParameterBytes: 0, unknownEncodingParameters: 0, sqlUtf8Bytes: 8,
    returnedRowCount: null, decodedResultJsonUtf8Bytes: null }],
  checkouts: [{ eventId: 0, operationId: null, checkoutId: 0, connectionId: 3, pool: "target", phasePath,
    atMs: 2, awaitedMs: 3, outcome: "ok" }],
  transactions: [{ eventId: 1, transactionId: 7, connectionId: 3, checkoutId: 0, pool: "target", phasePath,
    startMs: 8, endMs: 98, durationMs: 90, outcome: "commit" }],
  observerIntervals: [
    { eventId: 3, kind: "preparation", startMs: 5, endMs: 7, durationMs: 2, dispatchEventId: 2, outcome: "ok" },
    { eventId: 4, kind: "finalization", startMs: 100, endMs: 104, durationMs: 4, dispatchEventId: null, outcome: "ok" },
  ],
  dispatchAwaitedUnionMs: 7, checkoutAwaitedUnionMs: 3, poolQueryCalls: 0, delegatedPoolQueryDispatches: 0,
  lostContextDispatches: 0, unobservedDispatches: 0, unknownStatementDispatches: 0, incompleteSpans: 0,
  operationCorrelation: "enabled", lostOperationContexts: 2,
  observationErrors: 0, droppedObservations: 0, observationLimit: 100, aggregationComplete: true,
};
const mappings: readonly TraceFingerprintOwner[] = [
  { pool: "control", fingerprint: "shared-structure", phasePath, status: "single", owner: "wrong-pool",
    observedDispatches: 1, sourceSites: [{ siteId: "wrong-pool-site", owner: "wrong-pool", sourceFrames: ["control.ts:1"], dispatchCount: 1 }] },
  { pool: "target", fingerprint: "shared-structure", phasePath: ["invocation", "admission"], status: "single",
    owner: "wrong-phase", observedDispatches: 1, sourceSites: [{ siteId: "wrong-phase-site", owner: "wrong-phase",
      sourceFrames: ["admission.ts:1"], dispatchCount: 1 }] },
  { pool: "target", fingerprint: "shared-structure", phasePath, status: "ambiguous", owner: null,
    observedDispatches: 2, sourceSites: [
      { siteId: "payload-site", owner: "payload", sourceFrames: ["payload.ts:10"], dispatchCount: 1 },
      { siteId: "storage-site", owner: "storage", sourceFrames: ["storage.ts:20"], dispatchCount: 1 },
    ] },
];

describe("measurement database event translation", () => {
  it("aligns invocation intervals to the root and preserves identities, unknown sizes and ambiguous source owners", () => {
    const before = structuredClone(record);
    const translated = databaseEvents(record, mappings, 1000, []);
    expect(translated.events).toEqual([
      { kind: "driverAwait", id: "database:2", sequence: 2, startMs: 35, endMs: 42,
        backendPid: 314,
        owner: null, site: null, ownerCandidates: [], parentId: null,
        pool: "target", phasePath, connectionId: 3, checkoutId: 0, transactionId: 7,
        fingerprint: "shared-structure", template: "select ?", statementCount: 1,
        parameterCount: 0, scalarParameterBytes: 0, unknownEncodingParameters: 0, sqlUtf8Bytes: 8,
        returnedRowCount: null, decodedResultJsonUtf8Bytes: null, transactionAction: null,
        sourceFrames: ["payload.ts:10", "storage.ts:20"], sourceSiteIds: ["payload-site", "storage-site"],
        sourceOwnerCandidates: ["payload", "storage"], outcome: "success" },
      { kind: "checkoutAwait", id: "database:0", sequence: 0, startMs: 27, endMs: 30,
        owner: null, site: null, parentId: null, pool: "target", phasePath, connectionId: 3,
        checkoutId: 0, transactionId: null, outcome: "success" },
      { kind: "transaction", id: "database:1", sequence: 1, startMs: 33, endMs: 123,
        owner: null, site: null, parentId: null, pool: "target", phasePath, connectionId: 3,
        checkoutId: 0, transactionId: 7, settlement: "commit" },
    ]);
    expect(translated.observers).toEqual([
      { kind: "observer", id: "database-observer:3", sequence: 3, name: "preparation",
        startMs: 30, endMs: 32, owner: "measurement", site: "databaseCollector", parentId: null, outcome: "success" },
      { kind: "observer", id: "database-observer:4", sequence: 4, name: "finalization",
        startMs: 125, endMs: 129, owner: "measurement", site: "databaseCollector", parentId: null, outcome: "success" },
    ]);
    const requestEnd = record.startedAtMs - 1000 + record.durationMs;
    expect(translated.observers.at(-1)?.startMs).toBe(requestEnd);
    expect(translated.observers.at(-1)?.endMs).toBeGreaterThan(requestEnd);
    expect(record).toEqual(before);
    const decodeEvent = Schema.decodeUnknownResult(MeasurementEventSchema);
    const decodeObserver = Schema.decodeUnknownResult(MeasurementObserverSchema);
    expect(translated.events.every(event => Result.isSuccess(decodeEvent(event)))).toBe(true);
    expect(translated.observers.every(event => Result.isSuccess(decodeObserver(event)))).toBe(true);
  });

  it("keeps unobserved dispatches and open transactions incomplete and preserves failure outcomes", () => {
    const incomplete: TraceInvocationRecord = { ...record,
      dispatches: record.dispatches.map(dispatch => ({ ...dispatch, awaitedMs: null, outcome: "unobserved" })),
      checkouts: record.checkouts.map(checkout => ({ ...checkout, connectionId: null, outcome: "error" })),
      transactions: record.transactions.map(transaction => ({ ...transaction, outcome: "open-at-end" })),
      observerIntervals: record.observerIntervals.map(observer => ({ ...observer, outcome: "error" })),
      observationErrors: 2, unobservedDispatches: 1,
    };
    const translated = databaseEvents(incomplete, [], 1000, []);
    expect(translated.events.find(event => event.kind === "driverAwait")).toMatchObject({
      startMs: 35, endMs: null, outcome: "unknown", owner: null, site: null, ownerCandidates: [],
      returnedRowCount: null, decodedResultJsonUtf8Bytes: null,
    });
    expect(translated.events.find(event => event.kind === "checkoutAwait")).toMatchObject({
      connectionId: null, checkoutId: 0, transactionId: null, outcome: "failure",
    });
    expect(translated.events.find(event => event.kind === "transaction")).toMatchObject({
      startMs: 33, endMs: null, transactionId: 7, settlement: "open-at-end",
    });
    expect(translated.observers.every(observer => observer.outcome === "failure")).toBe(true);
  });

  it("correlates identical SQL with each actual operation and never infers ownership from source stacks", () => {
    const operations: MeasurementEvent[] = [
      { kind: "phase", role: "operation", id: "first-operation", sequence: 0, name: "first", startMs: 0,
        endMs: 100, owner: "logicalReadCapture", site: "first-operation-site", parentId: null },
      { kind: "phase", role: "operation", id: "second-operation", sequence: 1, name: "second", startMs: 0,
        endMs: 100, owner: null, site: "second-operation-site", parentId: null },
    ];
    const correlated: TraceInvocationRecord = { ...record, lostOperationContexts: 0,
      dispatches: [
        ...record.dispatches.map(dispatch => ({ ...dispatch, operationId: "first-operation" })),
        ...record.dispatches.map(dispatch => ({ ...dispatch, eventId: 5, operationId: "second-operation" })),
      ],
      checkouts: record.checkouts.map(checkout => ({ ...checkout, operationId: "first-operation" })),
    };
    const translated = databaseEvents(correlated, mappings, 1000, operations);
    expect(translated.events.filter(event => event.kind === "driverAwait")).toMatchObject([
      { parentId: "first-operation", owner: "logicalReadCapture", site: "first-operation-site", ownerCandidates: [],
        sourceSiteIds: ["payload-site", "storage-site"], sourceOwnerCandidates: ["payload", "storage"] },
      { parentId: "second-operation", owner: null, site: "second-operation-site", ownerCandidates: [],
        sourceSiteIds: ["payload-site", "storage-site"], sourceOwnerCandidates: ["payload", "storage"] },
    ]);
    expect(translated.events.find(event => event.kind === "checkoutAwait")).toMatchObject({
      parentId: "first-operation", owner: "logicalReadCapture", site: "first-operation-site",
    });
    expect(translated.events.find(event => event.kind === "transaction")?.parentId).toBeNull();
  });

  it("retains missing or foreign parent identities for artifact validation instead of guessing a replacement", () => {
    const dangling: TraceInvocationRecord = { ...record,
      dispatches: record.dispatches.map(dispatch => ({ ...dispatch, operationId: "unretained-or-foreign-operation" })),
      checkouts: record.checkouts.map(checkout => ({ ...checkout, operationId: "missing-checkout-operation" })),
    };
    const translated = databaseEvents(dangling, mappings, 1000, []);
    expect(translated.events.find(event => event.kind === "driverAwait")).toMatchObject({
      parentId: "unretained-or-foreign-operation", owner: null, site: null, ownerCandidates: [],
      sourceOwnerCandidates: ["payload", "storage"],
    });
    expect(translated.events.find(event => event.kind === "checkoutAwait")).toMatchObject({
      parentId: "missing-checkout-operation", owner: null, site: null,
    });
  });
});
