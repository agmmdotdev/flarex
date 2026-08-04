# DTE04-P20: Task System Storage And Schema Contract

## Status

**Status:** **Complete: admit DTE04-A3.** Lifecycle representation,
run-creation, and Standard Application task-authority contracts are complete.
This file admits exactly the five-table Drizzle schema, generated migration,
constraints, indexes, and PGlite/real-Postgres migration proofs. It does not
admit registration, lifecycle adapters, run creation, discovery operations,
effect delivery, host composition, or routing.

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

## Admitted Tables

The first draft undercounted the model by naming only run and requested-effect
tables. DTE02 already requires durable definition registration and a separate
creation-authority receipt, while DTE02 requires a scope-local attempt-history
identity whose UUID collisions can be detected. The minimum complete topology
therefore has five
tables. DTE04-A3 fixes their physical names and responsibilities as follows.

### `fx_system_durable_task_definition_revision_v1`

One immutable definition/runtime binding accepted under a trusted scope.

| Field group | Physical representation | Contract |
| --- | --- | --- |
| identity | `scope_id`, `task_definition_revision_id` | Composite primary key; the ID is storage-issued `taskdef_` plus canonical UUIDv4. |
| logical task | canonical `task_id` | Display/lookup evidence only; never execution authority without the binding. |
| application binding | application revision ID and candidate digest | Scope-qualified foreign key to the admitted application revision. |
| semantic identity | binding codec/version, byte length, SHA-256, and canonical bytes | Unique scope-local semantic binding digest; identical bytes converge, digest/byte disagreement fails closed. |
| runtime evidence | bounded projection columns required to locate the immutable artifact objects | Derived from the decoded binding, not caller-selected runtime targets. |

The authoritative `TaskDefinitionRuntimeBindingV1` codec and canonical task
catalog are implemented by DTE04-A2b. The definition row stores its canonical
binding frame bytes and digest plus only relational correlation projections.
Singleton runtime-object digests are projected for lookup; the decoded binding
remains the authority for the complete bounded runtime-object list, including
repeated runtime-projection modules. No sixth runtime-object table is admitted.

### `fx_system_durable_task_run_v1`

One row per scope-bound durable run.

| Field group | Physical representation | Contract |
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

The run row also carries the immutable creation-authority receipt codec,
length, SHA-256, and bytes, plus the task-input reference digest/codec selected
by its owning payload-storage contract. Neither value is lifecycle state, so
neither is duplicated inside `TaskRunAttemptAggregateV1`.

### `fx_system_durable_task_run_request_v1`

One scope-local idempotency identity for new-run creation.

| Field | Contract |
| --- | --- |
| `scope_id`, versioned request-key digest | Composite primary key; raw keys are not query or log fields. |
| canonical creation-request digest | Covers every caller-selectable creation input and its codec version. |
| `run_id` | Scope-qualified foreign key to the one winning run. |
| receipt version and correlated replay fields | Reconstructs and verifies the original creation receipt without inventing a second receipt digest. |

The exact request-key grammar, payload reference, canonical digest algorithm,
stable receipt, and typed conflict are implemented by DTE04-A2a. The raw
request key is never stored. The row stores the key-preimage digest, request
digest, receipt version, and winning run reference; the definition revision,
database creation time, and creation-authority digest are reconstructed from
the immutable run row. There is no separately owned receipt canonical frame or
receipt digest in the admitted domain contract, so SQL must not invent one.

### `fx_system_durable_task_requested_effect_v1`

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

### `fx_system_durable_task_attempt_identity_v1`

One immutable row for each accepted execution grant.

| Field | Contract |
| --- | --- |
| `scope_id`, `attempt_id` | Composite primary key and scope-local collision authority. |
| `run_id`, `attempt_number` | Scope-qualified run foreign key and unique policy ordinal per run. |
| `execution_fence` | Unique monotonic fence per run, correlated with the accepted aggregate. |
| accepted run version | The exact lifecycle acceptance that created the attempt identity. |

This row is inserted only when a `start_attempt` decision commits. It is
immutable attempt-history identity and collision evidence, not a second current
attempt/heartbeat/lease/terminal state machine. Those mutable semantics remain
solely in the run aggregate.

## Tables Not Yet Justified

Roadmap 04 does not create separate mutable tables for heartbeats, leases,
accepted receipts, completion replays, evidence, or lifecycle events merely
because Trigger has them. Apart from the immutable attempt-identity ledger
required by DTE02, the admitted aggregate already bounds and correlates that
history.

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

The decision is **versioned JSONB envelope** for the run aggregate and
requested-effect payload. The codec is domain-owned inside
`@flarex/durable-task`, while the JSONB adapter and size/row policy remain in
`@flarex/persistence-postgres`.

The domain codec first uses the existing aggregate/effect Schema, then maps its
encoded extended values to a JSON-safe envelope. Canonical decimal bigint
strings remain strings. Every `Uint8Array` is represented by one exact tagged
base64url value using Effect `Encoding`; decode must validate and canonically
re-encode the spelling. Unknown tags, unknown keys, sparse arrays, non-finite
numbers, cycles, accessors, and unsupported prototypes fail before storage or
domain decode.

The envelope is versioned independently from
`flarex.task-run-attempt-aggregate.v1`. JSONB key ordering is not semantic and
is never hashed after database round trip. Canonical request, definition, and
receipt digests use their owners' canonical byte frames, not PostgreSQL's JSONB
serialization.

The exact first-version envelopes are:

```ts
interface PersistedTaskRunAttemptAggregateJsonV1 {
  readonly codec: "flarex.task-run-attempt-persisted-json.v1";
  readonly aggregate: JsonObject;
}

interface PersistedTaskRequestedEffectJsonV1 {
  readonly codec: "flarex.task-requested-effect-persisted-json.v1";
  readonly effect: JsonObject;
}
```

Within those closed encoded objects, a byte array is represented only as the
one-key record `{ "$flarex.uint8array.v1": "<canonical-base64url>" }`. The
wrapper is recognized only at Schema-owned byte positions; it is not a generic
recursive convention for arbitrary future JSON payloads. Aggregate canonical
JSON is limited to 1 MiB and one requested-effect canonical JSON value to 64
KiB, measured with the protocol-owned canonical JSON encoder before the value
crosses the adapter. Decode captures caller/driver input once through data
descriptors, charges one global canonical-byte budget, and then measures and
decodes only the owned frozen snapshot. Envelope nesting is limited to 128
levels so hostile input cannot escape the typed boundary through call-stack
exhaustion. A future valid shape requiring a deeper graph needs a new envelope
codec decision rather than silently weakening this bound.

The choice must prove:

- deterministic encode/decode and version discrimination;
- exact bigint, safe-integer, byte, null, and omission semantics;
- byte-size ceilings before unbounded allocation;
- rejection of unknown keys and malformed/inconsistent values;
- owned input/output values and no caller or driver aliasing; and
- migration/forward-read policy for a future envelope version.

The persistence package stores the envelope as `jsonb` with `$type<unknown>()`
and always invokes the domain codec. The TypeScript annotation is deliberately
not treated as validation. A future byte envelope is a new codec/migration, not
an adapter-local fallback.

DTE04-A1 may add the lower-layer `flarex-protocol/json` dependency needed for
the shared `JsonObject` type and canonical byte-size measurement. It does not
add Drizzle, Postgres, Cloudflare, Node, or Trigger dependencies to the domain
package.

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

The closed lifecycle projection is:

- `run_version`;
- `phase`;
- `due_kind`: `start_attempt`, `handle_lease_expiry`, or null;
- `due_at_ms`;
- current attempt ID or null;
- execution-fence basis retained by the current/startable aggregate, or null;
- current lease version/expiry or null;
- cancellation generation; and
- requested-effect cursor, stored as zero when the aggregate cursor is
  `none`.

The domain-owned pure value is named
`TaskRunAttemptPersistenceProjectionV1`. It contains domain IDs/brands and
nullable domain values; it contains no column names, SQL null sentinel,
Drizzle type, scope ID, or row. The Postgres adapter alone translates it into
physical columns. Its `requestedEffectSequence` is a nonnegative bigint cursor
so the adapter can represent domain `none` as physical zero without teaching
the domain model that sequence zero is an issued effect.

`ready` and `retry_waiting` project `start_attempt` using respectively
`eligibleAtMs` and `notBeforeMs`. `attempt_granted` and `executing` project
`handle_lease_expiry` using the current lease expiry. `terminal` projects no
due work. The fence basis is derivable for every startable state: initial ready
projects null, while immediate-retry ready and retry waiting retain the
previous attempt fence. Active states retain the current fence. The immutable
attempt ledger, not this projection, preserves scope-local attempt identity
after a terminal state no longer retains an attempt reference.

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
- the requested-effect cursor is `none`; and
- no initial requested effect row is emitted.

The initial run is made visible to bounded `start_attempt` discovery. Creating
a queue or wake intent before Roadmap 05 would add a delivery owner merely to
create a run and is rejected. The existing Schema's ability to decode a
nonempty initial cursor remains compatibility tolerance, not the Roadmap 04
creation policy.

The precise run-creation request/receipt and idempotency digest remain an open
DTE02/Roadmap 04 contract. DTE04-A3 schema work cannot invent those values.

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

The physical decision is a separate request table, not request columns on the
run row. The semantic request codec remains blocked on the task-input reference
owner. Roadmap 04 will not hash a placeholder or omit input identity merely to
make the unique constraint implementable.

## Numeric And Time Representation

Lifecycle versions, fences, lease versions, cancellation generations, and
effect sequences fit signed Postgres `bigint` and are domain-validated against
that ceiling. Use Drizzle `mode: "bigint"` for those fields so JavaScript
number precision cannot erase authority.

Database times are nonnegative safe-integer epoch milliseconds and use Drizzle
`bigint(..., { mode: "bigint" })`. The adapter converts to/from number only
after the value is proven within the safe-integer domain range. A `timestamptz`
convenience conversion is not allowed to change millisecond spelling, timezone
behavior, or comparison semantics.

One transaction reads one database-clock value through the existing scope
clock/authority owner or an exact admitted extension. Caller time and
process-local `Date.now()` never enter lifecycle decisions.

## Keys, Constraints, And Indexes

The final DDL must include, at minimum:

- composite scope-qualified primary/foreign keys, including run-to-definition
  and request/effect/attempt-to-run keys;
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
tree and journal. DTE04-A3 must:

- generate/check it through the package's existing Drizzle commands;
- prove empty-database migration and upgrade from the previous journal;
- verify schema parity on PGlite and real Postgres;
- avoid hand-editing generated history except through the repository's
  established repair process; and
- contain no data backfill from Trigger tables, because none are authoritative
  Flarex state.

## Decision Receipt And Upstream Closure

Closed on 2026-08-04:

1. domain-owned versioned JSON-safe envelope stored as JSONB;
2. five-table minimum topology: definition revision, run, creation request,
   immutable attempt identity, and requested effect;
3. creation-authority receipt beside the run, outside the lifecycle aggregate;
4. exact lifecycle due projection and startable fence basis;
5. signed-bigint storage for every lifecycle counter and epoch-millisecond
   time; and
6. an initial run with no requested effects and `requestedEffectCursor = none`.

The following Standard Application contracts were the final upstream blockers
and are now implemented by DTE04-A2b:

1. implemented canonical Standard Application task catalog and `TaskIdV1`;
2. implemented `TaskDefinitionRuntimeBindingV1` canonical frame/decoder and
   semantic digest;
3. implemented `TaskRunCreationAuthorityReceiptV1` frame/decoder; and
4. final correlation of those values with the completed DTE04-A2a input
   reference, request-key/request digest preimages, receipt, and conflict
   contract.

These are not Postgres representation choices. They land through the private
`@flarex/standard-application-definition/internal/task-definition-v1` surface
and Preflight 24. DTE04-A3 has implemented this preflight's five-table schema
and migration checkpoint. DTE04-B now implements the scope-bound lifecycle
adapter and a partial compatibility lane without widening this storage contract:
30 transition-reconstructable histories execute through the adapter and two
invalid commands stay at the decoder boundary, while 33 persisted histories
remain open before final admission.
Definition registration, run creation, discovery, effect delivery, and host
activation remain closed until their own checkpoints.
