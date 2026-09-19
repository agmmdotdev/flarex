# Shared Prior Documents In The Commit Critical Section

Status: implemented for native and CMS materialization. Coordinated parallel
publication and broader CE3 acceptance remain open.

## Outcome And Ownership

Native and CMS materialization share prior row bodies across ordered indexes,
unique claims and outgoing relations. The Application document materializer
loads and authenticates the union of required prior documents once per command,
then shares that exact state among the three planners. This removes repeated
revision reads and canonical decoding for rows used by multiple derived families
while holding publication exclusion.

This shortens serial work without moving sequence-bearing DML or changing the
lock hierarchy. The coordinated execution/publication protocol remains open.
The earlier accepted pure/native OCC semantics remain unchanged.

## Contract

Build one exact document-to-head map from already validated dependencies. Load
only live predecessors of changed rows whose tables require ordered-index,
unique-key or outgoing-relation planning. Bind each lookup to scope, table,
row and exact revision; authenticate identity, creation time, canonical bytes
and digest with the existing decoder. Inserts and tombstone predecessors need
no prior body. Target-only relation transitions still carry no source body.

The shared reader owns a typed Effect failure contract. Decode the stored
projection with its named Schema and authenticate the body through the existing
Application document evidence decoder, including identity and creation time.
CMS yields this operation directly; native publication uses its existing
Promise transaction bridge. Only the foreign SQL call adapts rejected promises;
unexpected decoding defects remain defects.

Use the result only within the same protected transaction/command. It is not a
cache, new authority token, public API or persisted evidence format. Keep
relation target validation, membership checks, unique ownership and candidate
guards at their existing owners. CMS still prepares relation constraints before
lowering and applies derived changes only under its single outer publisher.

## Breaks And Alternatives

Replace the internal planner arguments with the shared prior-state result and
migrate both native and CMS callers together. Prior-state corruption now reports
`priorDocumentInvalid`, and SQL acquisition reports `loadPriorDocuments`; remove
the displaced family-specific document loaders and SQL-operation names. Family
transition errors still identify failures in their own index/constraint/relation
logic. Shared prior-state validation precedes those planners, deliberately
centralizing the first failure for damaged predecessor evidence.

Do not add a mutable cross-request cache or three lazy reader wrappers. Do not
weaken predecessor integrity to avoid decoding. No schema or durable-data change.

Active relation acceptance must use genuinely activated relation readiness and
its index maintenance evidence. Remove the obsolete test bridge that rewrote a
legacy active schema/readiness pair without rebuilding that evidence. The current
proof requires rejection of detached readiness-digest updates by database
constraints, refusal of a published but inactive schema before writes, and
successful publication through the real active relation fixture. The inactive
schema is stale authority, not corrupt stored evidence.

## Completion Gates

Cover existing-row updates, key movement and reuse, deletion, relation changes,
missing/corrupt prior evidence and rollback on both PGlite and ordinary-role
PostgreSQL. Prove bounded shared predecessor acquisition through an actual CMS
command with ordered and unique definitions, retaining exact row/index/claim
and replay behavior. Run native point/relation and CMS regressions, affected
typechecks, lint and both reviews. Remove displaced code, stop owned resources,
reconcile roadmaps and commit. Fewer reads do not alone prove latency/capacity.
