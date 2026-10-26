# Atomic mixed construction contract

Status: bounded native connection implemented in `mixed.ts`: an authored
Application mutation, native Product update/retrieve/list-by-handle, and native Payload
CRUD and actual preference cleanup share the selected-table accepting owner.
Complete-request measurements and populated Product relations remain
pending. Nothing in this note authorizes active-core changes or production
promotion.

`group-root.ts` lends callback-scoped Application/framework operations with a
shared budget, sticky failure and supervised lifetime. `group-storage.ts` admits
the selected definitions once and publishes their plans once. Participants cannot
settle or extend the command. The mixed profile checks exact Application
dependencies; the direct framework group retains its distinct write-CAS profile.

Migration 0006 changes command identity from one table/version to an immutable
selected-definition array. It applies only to fresh disposable experiment
databases. Existing experiment fixtures must be reset; it is not an upgrade of
existing command rows or an active-core migration.

Application and Product preparation bind immutable inputs and native metadata to
their operation identity; execution borrows only the selected operations. Payload
retains real access/default/validation/change/read hooks, including pending reads
across Local API calls. Native nesting remains refused in this bounded profile.
Complete exposed adapter promises are owned through invocation completion;
unfinished work is revoked, drained and fails the group. A caught adapter error
still latches its original Cause. Each participant owns its native/metadata result
decoder, reused when checking saved outcomes. Saved mixed replay checks current
collection access without repeating business hooks.

Field access and user `beforeOperation` hooks are refused at Payload configuration
admission. Replaying those profiles needs captured native authorization inputs
and field authorization semantics; checking only collection access against the
original input is insufficient. These are declared missing capabilities, not
hooks silently disabled for a comparison.

## Connected operation

Run an authored Application mutation, a real native Product update/retrieve/list and
real Payload Local API operations under one explicitly named mixed command.
All participants borrow one scope snapshot and command lifetime. Only its
trusted outer owner accepts, resolves an uncertain outcome or aborts. Independent
standalone calls keep their existing distinct profiles and never join implicitly.
There is no automatic mixed replay of native hooks or services after a conflict.

The first connected operation inserts an Application task, updates a pre-existing
relation-free Product's title/handle/status, retrieves/lists its pending result
and creates/updates/reads a Payload document. It also deletes a different,
pre-existing Payload document identified by `payload.deleteId`, including that
document's actual native preference cleanup. The new document remains committed;
the existing document and matching preferences become tombstones at the same
sequence as the Application/Product/new-document changes. Preserve each
complete native result, local pending visibility, native access/validation/hooks
and the native Product event. A failure in any participant, even if caught by
the composition, must prevent every participant's publication. Native business
code receives neither physical sessions nor acceptance/recovery capabilities.

The [CRUD contract](./PAYLOAD-CRUD.md) supplies the shared deletion and preference
operations. Select the preference definition with the other three definitions
before native execution; include the prepared deletion identity and exact deleted
result in the saved mixed outcome. Replay checks current native delete access
without re-running business hooks. Payload update and deletion exercise same-request native reads and
preference cleanup. Cleanup is real core work over a selected preference table,
including empty results; the adapter cannot return a successful fabricated no-op.
Preference writers and cleanup share indexed identity and the accepting owner.

## Selection, state and authority

Select a bounded immutable set of definitions before executing callbacks. Bind
their exact versions and operation identity into the durable command identity.
Admission checks installation identity, scope permission/fence and only those
definitions. Do not visit every installed definition or reserve one command per
participant. Recheck the selected versions, fresh permission/fence, retention
floor and database deadline at acceptance. An unrelated definition change does
not invalidate the command.

The mixed profile owns exact Application dependencies and its pending journal.
Framework participants keep native lifecycle ownership; their point/query
observations must also contribute the conflict evidence required by this mixed
boundary. Row facts alone cannot prove missing-row, range or cleanup-predicate
consistency. Do not silently turn the standalone direct framework profile into
Application OCC or attach a universal transaction API to all callers.

Use per-table indexed pending state plus one combined root budget and sticky
failure/lifetime owner. Original observations and pending replacements are
detached; native projections are mutable copies. Read-your-writes crosses
participant calls through that same owner. Repeated reads must not construct
another host or database transaction. Query semantics and invalidation belong to
the selected query profile rather than generic adapter glue.

## Acceptance and publication

Preserve the lock order: fresh authority/selected-definition locks, command
ownership, then the scope clock. After waiting for the clock, recheck the
database deadline and all relevant conflict/constraint evidence. Build immutable
plans outside this serialized region where their guarantees permit it.

Separate per-table row/history/index/constraint materialization from the one
outer publication. Allocate one scope sequence, publish every participant's
changes and native intents at that sequence, persist one durable result, and
advance the clock once in the same PostgreSQL transaction. Event ordinals span
the whole command. Never call the existing per-table finalizer repeatedly and
label the result atomic. PostgreSQL remains commit authority.

No physical transaction spans Application execution, native services, Payload
hooks, remote effects or workflow suspension. Cancellation revokes participant
capabilities immediately and drains admitted completing work before release.
Retain native failures, defects, interruption and cleanup causes. Acceptance
response loss resolves the saved outcome before any possible reexecution.

## Proof and initial assessment

Prove complete outputs/readback, one outcome/sequence, no partial publication,
caught-failure poisoning, fresh revocation/version/retention/expiry checks,
point/missing/range conflicts and independent-writer controls on PGlite and
ordinary-role PostgreSQL. Include native preference cleanup and failure after
earlier participants changed pending state. Reuse the existing Application and
native framework witnesses rather than a benchmark-only business surrogate.

Measure native and experimental complete Payload CRUD, Product and mixed flows
with source/settings fingerprints, matched warmups/pairs and separate diagnostic
cost attribution. The native mixed reference consists of independently committed
native framework operations unless a genuine equivalent atomic installation is
available; state that semantic difference and do not claim equal atomicity.
Retain the active-core comparison's preparation blocker until its actual owner
fixes it; no experimental adapter workaround.

Include growing insert/update batches, indexed versus nonindexed edits, selected
queries with pending changes, unrelated definitions and independent concurrent
writers in one and multiple scopes. Those results support an initial keep/change/
reject decision for the tested design. Wider framework graphs, full Application
compatibility, reactivity, hosted Worker/Hyperdrive performance and production
cutover remain their recorded gates in VALIDATION.md.
