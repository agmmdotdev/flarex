import { Schema } from "effect";
import { CpuEvidenceSchema, ResourceCountersSchema } from "./cpu";
import { ServerMeasurementEvidenceSchema } from "./server";

const Identity = Schema.String.check(Schema.makeFilter(value => value.length > 0 ? undefined : "Expected nonempty identity"));
const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const NullableCount = Schema.NullOr(Schema.Natural);
const NullableIdentity = Schema.NullOr(Identity);
const IntervalFields = {
  id: Identity,
  sequence: Schema.Natural,
  startMs: Milliseconds,
  endMs: Schema.NullOr(Milliseconds),
  owner: NullableIdentity,
  site: NullableIdentity,
  parentId: NullableIdentity,
  /** Retained only when source attribution observed competing owners. */
  ownerCandidates: Schema.optional(Schema.Array(Identity)),
};
const Outcome = Schema.Literals(["success", "failure", "typedFailure", "defect", "interruption", "mixed", "unknown"]);
const OperationRole = Schema.Literals(["operation", "coordination"]);
const DatabaseFields = {
  pool: Schema.Literals(["control", "target"]),
  phasePath: Schema.Array(Schema.String),
    connectionId: NullableCount,
  checkoutId: NullableCount,
  transactionId: NullableCount,
};
const orderedInterval = Schema.makeFilter<{ readonly startMs: number; readonly endMs: number | null }>(value =>
  value.endMs === null || value.endMs >= value.startMs ? undefined : "Interval ends before it starts");

export const MeasurementObserverSchema = Schema.Struct({
  ...IntervalFields, kind: Schema.Literal("observer"), name: Identity,
  outcome: Outcome,
}).check(orderedInterval);

export const MeasurementEventSchema = Schema.Union([
  Schema.Struct({ ...IntervalFields, kind: Schema.Literal("phase"), name: Identity, role: OperationRole,
    resources: Schema.optional(ResourceCountersSchema) }).check(orderedInterval),
  Schema.Struct({
    ...IntervalFields, kind: Schema.Literal("effectSpan"), name: Identity, role: OperationRole,
    traceId: NullableIdentity, spanId: Identity, fiberId: NullableIdentity,
    effectStartNanos: Schema.NullOr(Schema.String), effectEndNanos: Schema.NullOr(Schema.String),
    outcome: Outcome, cause: Schema.NullOr(Schema.String),
    resources: Schema.optional(ResourceCountersSchema),
  }).check(orderedInterval),
  Schema.Struct({
    ...IntervalFields, ...DatabaseFields, kind: Schema.Literal("driverAwait"),
    backendPid: NullableCount,
    fingerprint: Schema.NullOr(Schema.String), template: Schema.NullOr(Schema.String),
    statementCount: NullableCount, parameterCount: NullableCount, scalarParameterBytes: NullableCount,
    unknownEncodingParameters: NullableCount, sqlUtf8Bytes: NullableCount,
    returnedRowCount: NullableCount, decodedResultJsonUtf8Bytes: NullableCount,
    transactionAction: Schema.NullOr(Schema.Literals(["begin", "commit", "rollback"])),
    sourceFrames: Schema.optional(Schema.Array(Schema.String)),
    sourceSiteIds: Schema.Array(Identity), sourceOwnerCandidates: Schema.Array(Identity), outcome: Outcome,
  }).check(orderedInterval),
  Schema.Struct({ ...IntervalFields, ...DatabaseFields, kind: Schema.Literal("checkoutAwait"), outcome: Outcome }).check(orderedInterval),
  Schema.Struct({
    ...IntervalFields, ...DatabaseFields, kind: Schema.Literal("transaction"),
    settlement: Schema.Literals(["commit", "rollback", "commit-error", "rollback-error", "open-at-end"]),
  }).check(orderedInterval),
  MeasurementObserverSchema,
  Schema.Struct({
    id: Identity, sequence: Schema.Natural, kind: Schema.Literal("work"), atMs: Milliseconds,
    owner: NullableIdentity, site: NullableIdentity, parentId: NullableIdentity,
    metric: Identity, unit: Schema.Literals(["count", "bytes", "milliseconds"]), value: Milliseconds,
  }).check(Schema.makeFilter(value => value.unit === "milliseconds" || Number.isSafeInteger(value.value)
    ? undefined : "Count and byte work values must be safe integers")),
]);

/** This is the single normalized persisted observation contract. Source collectors
 * keep their own live interfaces; the SDK translates those once at settlement. */
export const MeasurementEvidenceSchema = Schema.Struct({
  requestId: Identity,
  clock: Schema.Struct({ id: Identity, unit: Schema.Literal("milliseconds"), precisionMs: Schema.NullOr(Milliseconds),
    originMonotonicMs: Milliseconds }),
  root: Schema.Struct({ startMs: Schema.Literal(0), endMs: Milliseconds, outcome: Outcome }),
  events: Schema.Array(MeasurementEventSchema),
  cpu: Schema.optional(CpuEvidenceSchema),
  server: Schema.optional(ServerMeasurementEvidenceSchema),
  /** Observer finalization after settlement is retained, never charged to root wall. */
  postRequestObservers: Schema.Array(MeasurementObserverSchema),
  collection: Schema.Struct({ capacity: Schema.Natural, droppedEvents: Schema.Natural,
    lostContextEvents: Schema.Natural, failures: Schema.Array(Schema.String) }),
}).check(Schema.makeFilter(evidence => {
  const identities = new Set<string>();
  const requestEvents = new Map(evidence.events.map(event => [event.id, event]));
  let previousSequence = -1;
  let previousStart = -1;
  if (evidence.events.length + evidence.postRequestObservers.length > evidence.collection.capacity) return "Retained events exceed declared buffer capacity";
  for (const event of [...evidence.events, ...evidence.postRequestObservers]) {
    if (identities.has(event.id)) return `Duplicate event identity: ${event.id}`;
    identities.add(event.id);
  }
  for (const event of evidence.events) {
    if (event.sequence <= previousSequence) return "Request events must retain strictly ordered unique sequence numbers";
    previousSequence = event.sequence;
    const start = event.kind === "work" ? event.atMs : event.startMs;
    const end = event.kind === "work" ? event.atMs : event.endMs;
    if (start < previousStart) return "Request events must retain monotonic start ordering";
    previousStart = start;
    if (start > evidence.root.endMs || (end !== null && end > evidence.root.endMs)) return `Event outside request root: ${event.id}`;
    if (event.parentId !== null && !requestEvents.has(event.parentId)) return `Missing request parent event: ${event.id}`;
    if ((event.kind === "driverAwait" || event.kind === "checkoutAwait") && event.parentId !== null) {
      const operation = requestEvents.get(event.parentId);
      if (operation?.kind !== "phase" && operation?.kind !== "effectSpan") return `Database parent is not an operation: ${event.id}`;
    }
    if (event.parentId === event.id) return `Self-parent event: ${event.id}`;
    const visited = new Set([event.id]);
    let parentId = event.parentId;
    while (parentId !== null) {
      if (visited.has(parentId)) return `Cyclic parentage: ${event.id}`;
      visited.add(parentId);
      const parent = requestEvents.get(parentId);
      if (parent === undefined) return `Missing request parent event: ${event.id}`;
      if (parent.kind === "work") return `Scalar work cannot enclose an event: ${event.id}`;
      if (start < parent.startMs || (end ?? evidence.root.endMs) > (parent.endMs ?? evidence.root.endMs)) return `Event outside parent interval: ${event.id}`;
      parentId = parent.parentId;
    }
  }
  for (const event of evidence.postRequestObservers) {
    if (event.startMs < evidence.root.endMs) return `Post-request observer overlaps request: ${event.id}`;
    if (event.parentId !== null && !requestEvents.has(event.parentId)) return `Missing post-request observer parent: ${event.id}`;
  }
  return undefined;
}));

export type MeasurementEvidence = typeof MeasurementEvidenceSchema.Type;
export type MeasurementEvent = typeof MeasurementEventSchema.Type;
export type MeasurementObserver = typeof MeasurementObserverSchema.Type;
export const decodeMeasurementEvidence = Schema.decodeUnknownResult(MeasurementEvidenceSchema, { onExcessProperty: "error" });
