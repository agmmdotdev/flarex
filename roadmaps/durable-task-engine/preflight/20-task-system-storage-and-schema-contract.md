# DTE04-P20: Task System Storage And Schema Contract

## Status

**Status:** Draft schema authority. No DDL or migration is authorized until the
open representation decisions and exact column/constraint table in this file
are closed.

## Objective

Define the minimum durable representation needed for idempotent run creation,
the DTE-IP01 lifecycle transaction, bounded due discovery, and ordered
requested effects without importing Trigger's schema or creating a second
lifecycle model in SQL.

## Authoritative Model

One decoded `TaskRunAttemptAggregateV1` is the semantic authority for a run.
Postgres additionally stores relational projections needed to locate, lock,
compare-and-swap, and discover the aggregate efficiently.

The two representations have an explicit relationship:

```text
validated aggregate
  -> deterministic persistence encoding
  -> derived relational projections
  -> one atomic row write

stored row
  -> owned driver snapshot
  -> persistence-envelope decode
  -> domain aggregate decode
  -> projection correlation
  -> decision input
```

Relational projections never override the aggregate. If the two disagree, the
row is corrupt and the operation fails before a decision or repair write.

## Candidate Tables

Names are provisional until DTE04-A admission, but responsibilities are fixed.

### `fx_system_durable_task_runs_v1`

One row per scope-bound durable run.

| Field group | Candidate representation | Contract |
| --- | --- | --- |
| identity | `scope_id`, `run_id` | Composite primary key; every lookup and foreign key includes scope. |
| immutable binding | definition-revision ID plus creation-authority receipt/envelope | Never retargeted after insert; decoded and correlated with aggregate. |
| creation idempotency | versioned opaque key/digest | Unique within scope; exact replay returns original receipt, conflict fails typed. |
| aggregate | explicit versioned JSON-safe envelope or canonical bytes | Sole lifecycle semantic authority; must round-trip big integers and digest bytes exactly. |
| compare-and-swap | `run_version` bigint | Derived from aggregate; update predicate and post-load correlation value. |
| phase projection | closed phase text | Derived and checked; used only for bounded discovery/query. |
| due projection | nullable due time plus due kind | Derived from `ready`/`retry_waiting` or current lease; never grants execution. |
| current authority | attempt ID, execution fence, lease version/expiry where present | Derived; enables index/constraint/correlation, not independent mutation. |
| effect cursor | requested-effect sequence bigint | Derived; correlated with aggregate and effect inserts. |
| database times | exact epoch-millisecond signed bigint or another closed lossless encoding | Preserve safe-integer millisecond semantics; no timezone or precision drift. |

### `fx_system_durable_task_requested_effects_v1`

One immutable intent row for every accepted requested effect.

| Field | Contract |
| --- | --- |
| `scope_id`, `run_id`, `sequence` | Composite primary key and idempotent delivery identity. |
| accepted run version | Correlates the effect to the aggregate acceptance that emitted it. |
| kind | Closed indexed discriminator for later Roadmap 05 consumers. |
| payload envelope | Exact versioned domain encoding, bounded and decoded before use. |
| not-before projection | Nullable database-time projection only for effect kinds that carry one. |

Roadmap 04 persists effect intents but does not add delivery attempts,
acknowledgements, queue message IDs, alarm state, or consumer ownership. Those
belong to Roadmap 05. A future delivery table may be justified there without
changing the immutable intent identity.

## Tables Not Yet Justified

Roadmap 04 does not create separate tables for attempts, heartbeats, leases,
accepted receipts, completion replays, evidence, or lifecycle events merely
because Trigger has them. The admitted aggregate already bounds and correlates
that history.

A separate immutable event/evidence ledger requires one of these proofs:

- an authenticated query/retention contract needs independent pagination;
- effect delivery needs a row that cannot be derived from requested effects;
- aggregate bounds cannot satisfy the first private vertical; or
- a database integrity constraint cannot be expressed or verified through the
  aggregate/projection model.

That proof belongs to a focused amendment and must not silently turn the first
schema into Trigger parity.

## Persistence Envelope Decision

The domain Schema encoding is not directly JSON-safe:

- branded Postgres-range big integers encode as canonical decimal strings;
- database times and other bounded counters use numbers; and
- result commitments retain a 32-byte `Uint8Array`.

Therefore these shortcuts are rejected:

- assigning `$type<TaskRunAttemptAggregateV1>()` to JSONB;
- `JSON.stringify`/`JSON.parse` without a versioned byte codec;
- trusting Drizzle's inferred TypeScript type as runtime validation; or
- serializing a typed array through its default object-key representation.

DTE04-A must choose exactly one of:

1. **versioned JSONB envelope:** a persistence-owned Schema converts every
   non-JSON member, including digest bytes, into a canonical JSON value before
   JSONB storage; or
2. **canonical byte envelope:** a versioned canonical JSON/binary encoding is
   stored as `bytea`, with relational projections providing queryability.

The choice must prove:

- deterministic encode/decode and version discrimination;
- exact bigint, safe-integer, byte, null, and omission semantics;
- byte-size ceilings before unbounded allocation;
- rejection of unknown keys and malformed/inconsistent values;
- owned input/output values and no caller or driver aliasing; and
- migration/forward-read policy for a future envelope version.

The current recommendation is to prefer a versioned JSON-safe envelope if it
can reuse the domain Schema without duplicating aggregate validation. Use
`bytea` only if canonical bytes materially simplify exactness or size limits.
This recommendation is not a final representation decision.

## Projection Contract

Define one pure persistence-local projection function from the decoded
aggregate. It derives, at minimum:

- run version and phase;
- definition revision;
- current attempt/fence/lease identity or nulls;
- due kind and due time or nulls;
- cancellation generation; and
- requested-effect cursor.

The same function is used for insert/update derivation and load correlation.
Do not hand-maintain projection values in individual operation branches.

Projection comparison must preserve exact nullability and number/bigint
representations. A mismatch maps to the existing
`TaskSystemRunAttemptCorruptionError` reason that owns the contradicted domain
facet; if no existing reason can state the contradiction honestly, DTE03-E
reopens before implementation.

## Initial Aggregate Contract

Run creation, not a caller, constructs the initial aggregate. The row is valid
only when:

- the run and task-definition revision IDs are adapter-created/decoded domain
  identities;
- the immutable creation-authority receipt and task policy were supplied by a
  trusted upstream capability and pass their owning decoders;
- `createdAtMs` and initial `eligibleAtMs` use the same admitted database-time
  snapshot;
- phase is `ready` and `ready.kind` is `initial`;
- there is no attempt, lifecycle acceptance, terminal outcome, completion
  replay, cancellation request, or lease;
- run version and every counter use the exact admitted initial values; and
- any initial requested effects form the aggregate's exact contiguous history
  and are inserted atomically.

The precise run-creation request/receipt and idempotency digest remain an open
DTE02/Roadmap 04 contract. DTE04-A schema work cannot invent those values.

## Idempotency Representation

Creation idempotency is scope-local. The candidate row stores:

- a versioned idempotency identity suitable for a unique constraint;
- a canonical digest over every immutable caller-selectable creation input;
- the created run ID; and
- enough versioned receipt data to reconstruct the exact original result.

An identical key and digest returns the original receipt. The same key with a
different digest is a typed conflict. It never mutates the existing binding or
creates a second run.

Do not use tenant ID, environment ID, task ID alone, or a raw unbounded user
string as the unique authority. Retention/expiry cannot permit the same logical
request to create a second still-relevant run without a separately admitted
policy.

## Numeric And Time Representation

Lifecycle versions, fences, lease versions, cancellation generations, and
effect sequences fit signed Postgres `bigint` and are domain-validated against
that ceiling. Use Drizzle `mode: "bigint"` for those fields so JavaScript
number precision cannot erase authority.

Database times are nonnegative safe-integer epoch milliseconds. The DDL must
store them losslessly and the driver codec must reject values outside the
domain range. A `timestamptz` convenience conversion is not allowed to change
millisecond spelling, timezone behavior, or comparison semantics.

One transaction reads one database-clock value through the existing scope
clock/authority owner or an exact admitted extension. Caller time and
process-local `Date.now()` never enter lifecycle decisions.

## Keys, Constraints, And Indexes

The final DDL must include, at minimum:

- composite scope-qualified primary/foreign keys;
- nonblank/domain-format checks where SQL can state them without becoming a
  weaker competing decoder;
- positive/nonnegative checks for stored counters;
- closed phase and due-kind checks;
- nullability checks that reject impossible projection combinations;
- unique scope-local creation-idempotency identity;
- unique `(scope, run, effect sequence)` effect identity;
- an index supporting stable bounded due discovery by
  `(scope, due kind, due time, run ID)` or the final equivalent; and
- correlation/foreign-key constraints from effect rows to their run.

Indexes require compiled SQL and `EXPLAIN` evidence on real Postgres. A schema
that merely contains an index with a plausible name is not proof that the
planned query uses it.

## Corruption Policy

Stored input passes these gates in order:

1. driver-result shape normalization;
2. owned row snapshot where the helper contract applies;
3. primitive column/type/range validation;
4. persistence-envelope decode;
5. domain aggregate decode;
6. relational projection correlation; and
7. requested-effect correlation for the range needed by the operation.

Expected malformed/contradictory stored state maps once to
`TaskSystemRunAttemptCorruptionError`. Driver property-access exceptions,
allocation defects, impossible program branches, and unrelated foreign defects
remain defects. Reads never auto-repair corrupt state, skip a corrupt due row,
or fall back to an unvalidated projection.

## Migration Ownership

The migration lives in the existing `packages/persistence-postgres/drizzle`
tree and journal. DTE04-A must:

- generate/check it through the package's existing Drizzle commands;
- prove empty-database migration and upgrade from the previous journal;
- verify schema parity on PGlite and real Postgres;
- avoid hand-editing generated history except through the repository's
  established repair process; and
- contain no data backfill from Trigger tables, because none are authoritative
  Flarex state.

## Open Decisions Blocking DTE04-A

1. JSON-safe JSONB envelope versus canonical `bytea` envelope.
2. Exact run-creation request, digest, conflict, and receipt types.
3. Exact table/column/index names and constraint table.
4. Whether immutable creation-authority evidence is embedded in the aggregate
   envelope, stored beside it, or referenced through an already-owned durable
   record—with one authority and correlation rule.
5. Exact due-kind projection for initial ready, retry waiting, and lease expiry.
6. Whether initial creation emits any requested effects in Roadmap 04 or leaves
   the run discoverable with an empty cursor.

Until these close, this file is a design constraint, not DDL authorization.
