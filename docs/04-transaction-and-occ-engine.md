# Transaction And OCC Engine

> Status: alternative full-compatibility design, not the current primary
> Cloudflare-native partition design. See
> [Partitioned Data Model](./09-partitioned-data-model.md) and
> [Cross-Partition Workflow Mutations](./12-cross-partition-workflow-mutations.md).

This is the core of the port. Cloudflare can host the runtime, but Convex-like
behavior comes from the transaction engine.

## Interactive Transaction Model

The transaction engine is an interactive syscall engine. It must not rely on
recording a complete operation script in the Dynamic Worker and replaying it
later in the trusted executor.

The trusted executor owns the transaction session:

1. `/invoke/start` creates an invoke session with a stable `begin_ts`.
2. Each `ctx.db.*` call from the Dynamic Worker is an immediate syscall.
3. Reads are answered from the transaction view.
4. Writes are staged in executor-owned session state.
5. The user function can branch and run more deterministic logic between
   syscalls.
6. `/invoke/finish` validates the return value, runs OCC validation, and commits
   the staged writes.
7. `/invoke/abort` abandons staged writes when user code throws or validation
   fails.

The transaction view is:

```txt
persisted snapshot at begin_ts + staged write overlay for this invoke session
```

This view must provide read-your-own-writes:

- insert then get returns the staged inserted document
- patch then get returns the merged staged document
- replace then get returns the replaced staged document
- delete then get returns null
- table and index queries include staged inserts and patches
- table and index queries hide staged deletes

Long user logic between syscalls does not hold a Postgres transaction or row
lock. It does keep the logical transaction open longer, which increases the
chance that OCC validation will fail and the deterministic mutation will need
to retry from the beginning.

## Correctness Goal

Mutations must appear atomic and serializable to application developers:

- all writes in one mutation commit together
- partial writes are never visible
- concurrent writes that conflict with a mutation's reads cause retry
- retry reruns the whole deterministic mutation
- live queries are invalidated using the same read dependencies

Simple row-level `_version` checks are not enough. The engine must validate
document reads, index range reads, and empty query ranges.

## Logical Transaction Flow

```txt
begin logical transaction at begin_ts
  -> run user function in Dynamic Worker
  -> record read_set
  -> stage write_set
  -> validate read_set against writes after begin_ts
  -> if conflict, retry whole function
  -> if clean, assign commit_ts
  -> persist document/index/commit-log writes
  -> publish commit
```

The database transaction should be short. User JavaScript should not hold
Postgres row locks while it runs.

## Read Set

The read set records what the function depended on:

```ts
type ReadSet = {
  indexRanges: IndexRangeRead[];
  searchReads: SearchRead[];
  metadataReads: MetadataRead[];
};

type IndexRangeRead = {
  tableId: string;
  indexId: string;
  lower: Uint8Array;
  lowerInclusive: boolean;
  upper: Uint8Array;
  upperInclusive: boolean;
  source: "direct" | "derived";
};
```

Document reads are represented as point reads on the by-id index:

```txt
db.get(messages, doc_id)
  -> read index range [doc_id, doc_id]
```

Important details:

- empty query results still record the searched range
- `first()` records the consumed range, including enough boundary information
  to catch a new earlier matching row
- pagination records the page interval and cursor boundary
- table metadata reads must be recorded
- index metadata reads must be recorded
- missing document reads must still record a by-id point dependency

## Write Set

Writes are staged:

```ts
type WriteSet = {
  documents: Map<DocumentId, StagedDocumentWrite>;
  scheduledFunctions: StagedScheduledFunction[];
  storageWrites: StagedStorageWrite[];
};

type StagedDocumentWrite =
  | { op: "insert"; tableId: string; documentId: string; newValue: unknown }
  | { op: "replace"; documentId: string; oldValue?: unknown; newValue: unknown }
  | { op: "patch"; documentId: string; oldValue?: unknown; patch: unknown }
  | { op: "delete"; documentId: string; oldValue?: unknown };
```

Before commit:

1. coalesce multiple writes to the same document
2. fetch old document revisions when needed
3. compute final new document value
4. compute old index keys
5. compute new index keys
6. produce `index_write_log` rows

## OCC Validation

For every read range, check whether any committed write after `begin_ts`
overlaps the range:

```sql
select 1
from index_write_log
where deployment_id = $1
  and commit_ts > $2
  and index_id = $3
  and index_key >= $4
  and index_key < $5
limit 1;
```

For point reads, use the by-id index key as both boundary values.

If any row exists:

```txt
abort staged write_set
choose new begin_ts
rerun entire mutation
```

Do not retry only the commit statement. The user function may make a different
decision after seeing newer data.

## Pending Writes

Validation must include commits that have been assigned a `commit_ts` but are
not yet visible to readers.

For v1, use one commit coordinator per deployment:

```txt
CommitCoordinator(deployment)
  pendingWrites: ordered map commit_ts -> index key writes
```

Validation checks:

```txt
committed index_write_log in Postgres
pendingWrites in coordinator memory
```

This mirrors Convex's distinction between committed write log and pending
writes. It avoids a race where two commits both validate before either is
visible.

## Commit Coordinator

The commit coordinator owns:

- assigning monotonically increasing commit timestamps
- holding pending writes
- validating read-set overlap
- writing document revisions
- updating current documents
- writing index entries
- writing index write log
- publishing visible commit timestamp
- notifying subscription routers

Start as a per-deployment Durable Object unless proven too slow. A single
coordinator makes the correctness model easier. Throughput can be improved
later by sharding only across proven independent transaction boundaries.

## Retry Policy

Retry mutations only when:

- OCC conflict detected
- Postgres serialization failure occurs in the commit phase
- transient infrastructure error happens before commit visibility

Do not retry when:

- user code throws
- validation fails
- function exceeds limits
- non-deterministic action fails
- commit outcome is unknown after persistence write

If commit outcome is unknown, prefer conservative recovery by reading the
session request table or commit log before re-executing.

## Idempotence

Client mutations carry a session request identifier. Store mutation results in
a system table:

```ts
type SessionRequestRecord = {
  deploymentId: string;
  sessionId: string;
  requestId: string;
  status: "in_progress" | "completed" | "failed";
  result?: unknown;
  error?: unknown;
  commitTs?: bigint;
};
```

This supports reconnect and duplicate mutation handling.

## Postgres Serializable

Use Postgres `SERIALIZABLE` inside the short commit transaction as
defense-in-depth. It is not a substitute for read-set validation when reads
happened outside the transaction.

Commit transaction shape:

```sql
begin transaction isolation level serializable;
-- validate read-set against committed write log
-- insert commit metadata
-- insert document revisions
-- upsert current documents
-- insert index entries
-- insert index_write_log rows
commit;
```

If Postgres returns SQLSTATE `40001`, retry according to whether the mutation
can safely be rerun.

## Limits And Observability

Track:

- number of read intervals
- read-set byte size
- write-set byte size
- documents read
- documents written
- commit validation latency
- conflict rate by function
- retry count by function
- pending write queue length
- commit log retention lag

Large read sets are both a performance problem and a correctness risk if they
hit limits. The developer should get useful errors when a function reads too
much.
