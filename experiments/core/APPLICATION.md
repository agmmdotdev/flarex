# Standalone Application construction slice

Status: bounded construction slice implemented. This file binds the Application
work to DESIGN/MODULES/IMPLEMENTATION/VALIDATION; it does not replace their wider
gates or declare the full Application profile supported.

## Consumer and reuse boundary

Use real registered Flarex query/mutation functions and the existing `ctx.db`
get/query/insert/patch/replace/delete contracts. Reuse SDK registration, validators,
ID encoding and query construction as portable developer-facing leaves. Do not
import the active evaluator, readiness/admission graph, journal or committer.
The authored corpus lives in `test/application-corpus.ts`, with no SQL, Payload or
Medusa imports. There is no matched active standalone baseline for its indexed
read graph yet; the old mixed benchmark's SQL surrogate is not that baseline.

The local host admits trusted, locally completing functions over required scalar
JSON fields. Numeric indexes, complete ascending bounded ranges and ordinary
point reads are the initial query shapes. Application documents expose `_id` and
`_creationTime`. Internal scalar rows retain the common neutral representation,
with separately decoded numeric `systemCreationTime` for Application identity.
Seed each attempt from database time, allocate each inserted identity with exact
binary64 `nextUp`, and preserve it across patch/replace. Equal numeric index keys
order by creation time and then document identity in physical and pending state.
ISO framework timestamps never supply Application creation identity.
The host is not deployed-function analysis or an isolation sandbox. Non-JSON
values (including negative zero, which JSON/JSONB cannot preserve), optional/nested document fields, general predicates, paginated/projected
queries, exact count/existence, nested function calls, actions/remote effects and
subscription hosting need separate connected work and remain unsupported.

Use the current integrations as requirements evidence under AGENTS.md. No
backward compatibility with their internal execution plumbing is required.

## Owners and protocol

- `persistence.ts` owns shared short Drizzle sessions, fresh installation/scope/
  grant/selected-definition checks, deadlines, opaque snapshot/command issuance,
  durable identity, abort and resolution. Snapshot authenticity is process-local;
  it is not a public capability or durable recovery token.
- `application-storage.ts` owns snapshot point/range reads and Application OCC.
  The framework profile in `storage.ts` retains its separate semantics.
- `changes.ts` owns coherent pending rows, unique ownership and ordered numeric
  membership. `pending-index.ts` maintains a balanced search tree. Both write
  profiles use this owner; a framework create does not acquire Application reads.
- `application-root.ts` owns read dependencies, read/write limits, pending overlay,
  serialization of concurrent operations, sticky failures and freeze. Query roots
  contain no pending journal or accepting capability.
- `materialization.ts` is the common atomic row/history/index/unique/event/outcome
  writer. `callback.ts` owns supervised foreign callback lifetime and full causes.
- `application.ts` translates the existing developer contracts and owns complete
  Application attempt retry. It has no SQL. Capture detached canonical JSON
  input/output at their validation boundaries and give every invocation a fresh
  argument copy. Retrying must not reuse guest-mutated arguments or change the
  data bound to a durable request digest.

Host construction captures the actual handler and native validator JSON through
the SDK's immutable validator owner. Preparation, execution and saved-result
validation use that same snapshot, even if caller-owned registration objects are
later changed. Strict descriptor-safe JSON capture refuses getters, unsupported
prototypes, undefined and oversized input before native field decoding.

Capture one authorized per-scope sequence and use it for every original read.
Historical index entries have `[fromSeq,untilSeq)` visibility and reference their
exact row revision. Read exact absence, including the distinction between no
revision and a tombstone. Keep original evidence when pending edits alter values
or membership. Never substitute current rows for the captured snapshot.

Every serving read freshly locks installation, authority, grant and selected
definition. A scope's protected `retainedFrom` floor refuses older snapshots;
its writer conflicts with the same authority lock. A complete query checks
fresh authority/retention/time again before returning to its caller. No physical
transaction spans authored function execution.

Settlement locks protected metadata, selected definition, command, then the scalar
scope clock. Check database time after waits. Any newer row revision conflicts
with a consumed point/missing read. Index entry creation or closure intersecting
a consumed predicate conflicts with its range, including updates into/out of it.
All successful writers maintain these structures in the common materializer.
Non-overlapping row/range writes must not conflict merely because the clock moved.

Publish final rows, unique claims, tombstones/revisions, historical membership,
event intent, command result and clock advancement in one transaction. Pending
insert followed by delete has no durable row revision. Aborted attempts publish
none of those effects. There is no event delivery or automatic history GC service.

Only the outer host may retry a specifically admitted local mutation after a
known accepting conflict. Limit to three attempts within the original command's
database deadline. Rotate the token/snapshot under the same durable identity;
old attempt capabilities cannot publish. Guest errors, denied/expired/invalid
work, defects, interruption, failed cleanup and uncertain COMMIT never authorize
retry. Resolve a possibly committed outcome before any re-execution.

Invalid document schema input is recoverable before it changes root state and
uses the existing native validation error projection. Other integrity/authority/
budget/unsupported-operation failures latch the root even when a function catches
the Promise rejection. Preserve full failure, defect, interruption and cleanup
causes. Track complete exposed database Promises, including native SDK query
projections. Returning with unfinished calls refuses publication and drains those
calls; ignored rejections remain handled, and owned defects retain their Cause.
Cancellation revokes callback use, signals and drains admitted completing work
before close/release.

## Bounds and dependency consumers

Limit historical candidate entries before visibility filtering, refusing on
budget exhaustion. Selection order matches the physical index, including revision
direction. The high-revision EXPLAIN witness checks the actual serving-role plan
for an index-backed limit without an unbounded sort below it. This is a bounded
plan witness, not proof of every planner distribution or server-work cost.
Apply byte bounds before transferring bodies. Limits are 256 read entries,
256 pending rows, 256 dependencies and
262,144 read/retained/result bytes, with the existing database timeouts. An
exhausted budget must never become an empty or exhausted query answer.

Queries return their exact point/range observations. Also project point/table keys
through the existing Scope Sync decoder/normalizer; numeric range invalidation is
conservatively table-wide in that consumer format. Exact OCC predicates are not
replaced by those coarse keys. Connected reactivity registration, delivery and
retained-history GC are still separate gates; codec acceptance alone is not a
working subscription host.

## Connected contract witnesses

The local suite runs fresh PGlite and restricted ordinary-role PostgreSQL through
registered functions, complete values and actual committed state. Its plan test
seeds an administrative high-revision fixture and explains the actual query
builder; it does not substitute fixture SQL for authored Application execution.

1. Point/missing/range query, snapshot stability during concurrent commits and
   query lifetime without durable mutation machinery.
2. Pending insert/update/delete visibility, index membership repair, unique
   release/reclaim, atomic data/history/event/outcome and fresh readback.
3. Row/missing/phantom conflicts, changes into/out of a predicate, and independent
   controls; whole-attempt eligible retry, exhaustion and later terminal failure.
4. Caught document validation recovery versus sticky authority/budget failure,
   read-only capability refusal, foreign IDs, malformed args/returns and bounds.
5. Revocation/fence/selected-definition/retention refusal, deadline after lock
   wait, cancellation/late use/drain, rollback and durable uncertain-result replay.
6. Ordered pending-state scaling and shared-owner regressions for Payload. Actual
   query plans and ordinary-role privilege denial need database evidence.

PGlite does not model concurrent connection lock waits; the post-clock-wait
deadline witness runs on PostgreSQL. Fault injection for response loss and an
unresolved accepting outcome is at the transport boundary; it is not a real
network-partition proof. Publication prefixes, deployed runtime admission,
durable cross-process attempt recovery and maintenance/GC services are unproved.

Local correctness is not performance acceptance. Preserve the full comparison,
modularity replacement, scaling/contention and private Worker/Hyperdrive gates
before promotion. These requirements must not disappear when the first tests pass.
