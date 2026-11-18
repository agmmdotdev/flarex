# CE1 Bounded Row Batch Application

Status: row batch application is implemented under standing owner authorization.
[Index batching](./16-ce1-index-batch-application.md) subsequently replaces scalar
index application; [unique batching](./17-ce1-unique-batch-application.md) replaces
scalar unique writes. [Statement reuse](./42-ce1-row-statement-reuse.md) compiles
repeated revision/pointer insert shapes once within each append operation.

## Outcome And Owner

Replace the prepared scalar row writer in `appRows.ts` with an Effect operation
for one admitted scope/epoch/commit and unique logical row identities. The shared
Application/CMS materializer supplies the complete prepared set. Keep the existing
schema, authoritative transaction, scope/index locks, publication and recovery.
Index and unique writes have their own subsequent slices; no new Medusa integration.

The preceding CE1 measurement attributes remaining linear SQL to scalar row and
index writes. Row application is an independent owner-local correction. Reuse
the existing row identity/scalar decoders, canonical documents and physical
families instead of a second intent format or concurrent SQL on one connection.

## Application Contract

Authenticate scope once, reject duplicate or mixed publication inputs, and keep
immutable creation-time checks against the exact predecessor revision. Group
revision inserts and current-pointer creates/conditional updates into bounded
statements. Verify the exact returned scope/table/row/sequence set independent
of return order. A missing revision insert is an existing-revision conflict;
a missing conditional pointer write is a chain conflict. Unexpected or duplicate
returned identities fail closed. Do not interpret affected count alone as proof.

Use at most 32 rows per statement and pack around a 256 KiB encoded-document
target; oversized single documents have an explicit 8 MiB encoded limit. Fixed
metadata and parameters are bounded by the row cap and existing scalar codecs.
No mid-batch commit or local recovery: any failure must escape to the existing
transaction owner and roll back the complete admitted operation.

## Breaks And Cleanup

Replace the private prepared scalar Result API with the batch Effect API; migrate
the shared materializer and direct tests and delete the displaced preparation
chain. Direct prepared callers in index, schema validation, unique-constraint,
compaction and row-reference fixtures use the replacement too. The unprepared
scalar writer remains for its actual storage fixture consumers, including its
existing locally reversible failure contract;
it is not the materializer's fallback. Its retirement belongs to those consumers.

Row writes now precede intrinsic/developer index writes. Private row hooks retain
one notification per row after successful row application, but no longer expose
per-row SQL completion interleaved with index writes. A later batch failure may
precede all row hooks. These hooks are observation/fault injection, not commit
authority. The batch API requires abort on failure; it does not promise local
undo followed by continued use of the same transaction. No public API, durable
format, physical schema or stored-data migration changes.

Private `rowBatchWriting`/`rowBatchWritten` observations bracket the complete row
operation. At this boundary inputs are trusted canonical prepared documents;
existing identity/scalar codecs retain validation ownership. The batch adds
publication-consistency and duplicate-identity checks, not another document
decoder or a new schema authority. Driver rejection has a typed persistence
failure projected by the materializer; unexpected query-construction throws
remain defects.

## Completion Gates

Prove batch boundaries, exact identities across tables, mixed insert/update/delete,
creation-time refusal, stale predecessor/current pointers, duplicate inputs,
byte-driven splitting and full rollback after later failure. Preserve historical
reads, unique swaps, index membership and no-row/replay behavior through actual
native/CMS consumers. Run PGlite and ordinary-role PostgreSQL, affected typecheck,
core/diff/staged lint and both required reviewers. Compare the same isolated
native publication workload with the preceding implementation; distinguish SQL
counts from local timings and leave broader CE0/CE1 acceptance open.
