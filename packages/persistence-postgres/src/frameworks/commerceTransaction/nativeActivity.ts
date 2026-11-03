import { Cause, Effect } from "effect";
import type { CoreNativeBindingMetadata, CoreNativeOperations } from "../../core/api";
import type { BoundedRequestLifetime } from "../../execution/preparation/boundedRequestLifetime";
import { useCapturedPrivateJsonData } from "../../values/privateJsonData";
import { commerceError, type CommerceTransactionError } from "./model";
import { projectCoreCommerceFailure } from "./nativeFailure";
import type { NativeCommerceReadObservation } from "./nativeStore";
import type { LogicalCommerceActivity } from "./logicalParticipant";

/** Semantic call evidence projects actual Core operations. It grants no writes,
 * snapshots or finalization and performs no second database read or validation. */
export function makeNativeCommerceActivity(operations: CoreNativeOperations, metadata: CoreNativeBindingMetadata,
  lifetime: BoundedRequestLifetime<CommerceTransactionError>) {
  const reads: LogicalCommerceActivity["relationalReads"][number][] = [];
  const localName = (table: string) => metadata.definition.tables.find(candidate => candidate.name === table)?.localName;
  const cursor = () => Object.freeze({ core: operations.nativeActivityCursor(), reads: reads.length });
  const onRead = Effect.fn("NativeCommerceActivity.read")(function* (observation: NativeCommerceReadObservation) {
    const table = localName(observation.table);
    if (table === undefined) return yield* commerceError("invalidAuthority");
    let related: NativeCommerceReadObservation["related"];
    if (observation.related !== undefined) {
      const childTable = localName(observation.related.childTable);
      if (childTable === undefined) return yield* commerceError("invalidAuthority");
      related = Object.freeze({ childTable, foreignKeyConstraintId: observation.related.foreignKeyConstraintId });
    }
    const read = { table, query: observation.query,
      total: observation.total, returned: observation.returned,
      ...(related === undefined ? {} : { related }),
      ...(observation.orderedIdentities === undefined ? {} : { orderedIdentities: observation.orderedIdentities }) };
    const captured = yield* lifetime.fromResult(useCapturedPrivateJsonData(read, lifetime.remainingBytes(), commerceError));
    yield* lifetime.fromResult(lifetime.charge(captured.bytes));
    // Keep the compiler's exact native query and already-owned identity values.
    reads.push(Object.freeze(read));
  });
  const since = Effect.fn("NativeCommerceActivity.since")(function* (position: ReturnType<typeof cursor>): Effect.fn.Return<LogicalCommerceActivity, CommerceTransactionError> {
    const activity = yield* operations.nativeActivitySince(position.core).pipe(Effect.catchCause(cause =>
      Effect.failCause(Cause.map(cause, projectCoreCommerceFailure))));
    const projectTable = (table: string) => {
      const local = localName(table);
      if (local === undefined) throw new Error("Source-confined native activity lost its declaration");
      return local;
    };
    return Object.freeze({ mutations: Object.freeze(activity.mutations.map(mutation => Object.freeze({ ...mutation,
      table: projectTable(mutation.table) }))),
    lifecycle: Object.freeze(activity.lifecycle.map(observation => Object.freeze({ ...observation, table: projectTable(observation.table) }))),
    observedRows: Object.freeze(activity.observedRows.map(observation => Object.freeze({ ...observation,
      table: projectTable(observation.table) }))),
    relationalReads: Object.freeze(reads.slice(position.reads)),
    setNull: Object.freeze(activity.setNull.map(selection => Object.freeze({ ...selection,
      sourceTable: projectTable(selection.sourceTable), targetTable: projectTable(selection.targetTable) }))),
    referenceReplacements: Object.freeze(activity.referenceReplacements.map(selection => Object.freeze({ ...selection,
      sourceTable: projectTable(selection.sourceTable), targetTable: projectTable(selection.targetTable) }))) });
  });
  return Object.freeze({ cursor, since, onRead });
}
