# Concept 02: operation boundaries, deadlines and expiry

Status: **Accepted design policy; no implementation**. One bounded atomic
operation owns one snapshot and one deadline. Participating nested work shares
both. Numerical limits, concrete cancellation/acceptance interlocks and native
branch conformance remain open. Replication is **open and explicitly deferred**.

This refines [timestamped snapshots](./02-timestamped-snapshots.md) and the
[commit/recovery contract](./01-commit-coordination.md). The app DO and reusable
caches outlive individual operations; closing an operation releases its private
snapshot/working state rather than clearing the shared cache.

## Accepted operation boundary

An atomic operation is the group of admitted changes that must commit or roll
back together. Preserve actual native transaction boundaries when mapping that
group into the portable engine:

| Entry point | Snapshot owner |
| --- | --- |
| Application query | One query execution, without mutation or settlement capability |
| Application mutation | One mutation attempt, including its admitted nested participants |
| Payload | Its actual request transaction, including participating hooks and nested Local API calls |
| Medusa | The explicitly atomic command/composition, preserving its transaction grouping |

A repository method, HTTP request or workflow step does not automatically create
an independent snapshot. Nested work belonging to an existing operation borrows
its snapshot, private pending state and remaining deadline. Only the trusted
outer owner settles; nested failure preserves the profile's rollback-only rules.
Independent outer calls remain independent even when they share an app owner.

A long workflow may contain several separately committed operations. Do not hold
a snapshot or physical SQL transaction across customer interaction, remote effects
or workflow suspension. Do not split an atomic native group just to shorten its
deadline. A branch whose required visibility or effects conflict with this boundary
needs an explicit adaptation and conformance proof; it is not silently admitted.

These rules preserve distinct Application, Payload and Medusa execution profiles.
They do not introduce a universal transaction API or grant framework code raw
commit, database or finalizer capabilities. The
[existing profile contracts](../DESIGN.md#execution-profiles) and
[refactor direction](./REFACTOR.md) remain the baseline obligations.

## Accepted deadline and expiry policy

One absolute deadline bounds an operation. Nested calls inherit remaining time
and cannot reset the timer. CPU budgets, elapsed-time deadlines and retained
history windows are separate limits. Select their numerical values after measuring
representative native operations, accounting for the age of the admitted snapshot
and the required validation history. Convex's reference defaults are not selected
Flarex limits; its snapshot lookup window is not an operation timeout.

| Phase / operation | Required expiry behavior |
| --- | --- |
| Before commit acceptance | Close the operation, prevent later reads/writes or callbacks from making its proposal acceptable, and discard private pending changes. A Promise timeout alone is not sufficient enforcement. |
| Pure query, before exposing a result | An eligible whole query may restart at a fresh admitted snapshot under bounded retry rules. Never splice newer data into the expired execution or transparently restart after partial disclosure. |
| Replay-safe Application mutation | The outer owner may restart an eligible complete attempt at a fresh snapshot under bounded retry rules. Discard the old proposal; do not retry individual repository calls or resubmit old writes. |
| Medusa/Payload command | Initially return the profile's explicit failure rather than automatically replay. Whole-command eligibility, including hooks, native effects and compensation, must be separately proved before enabling retry. |
| After commit acceptance, or when persistence outcome is uncertain | The commit/recovery owner must finish or reconcile the durable outcome. A caller timeout or snapshot expiry is not evidence of noncommit and must not start a duplicate business operation. |

Cancellation must close the operation's capabilities and account for work that
may still be running. The acceptance boundary must serialize expiry/cancellation
with admission of the final proposal; its concrete representation remains open.
After acceptance, retain required pending/outcome state until normal settlement
or recovery establishes terminality. Snapshot reclamation does not discard that
separate obligation. This does not keep the business snapshot alive across an
external wait or turn accepted work into a successful result before publication.

The normal query/mutation retry rules do not imply that every `OutOfRetention`
error is retried by Convex or should be retried by every framework. Failure
classification and native eligibility belong to their real outer owners.

## Cart example

1. Reading a cart uses snapshot `100`, returns its result and closes that query.
2. An admitted atomic cart update uses a new snapshot for all its participating
   reads, calculations, hooks and private changes. Nested calls see the same base
   plus that operation's pending changes. Validate, save and publish once.
3. The customer or payment provider may take time to respond. No database snapshot
   is held across that wait; the native workflow owns its external-effect and
   compensation semantics.
4. A later database operation takes a fresh snapshot and rechecks the conditions
   needed for its changes. Its durable operation identity prevents blindly
   repeating an already committed effect during outcome recovery.

These illustrate lifetime boundaries, not a replacement checkout algorithm or a
claim that every Medusa step is an atomic operation. Existing native transaction
groups and admitted cross-framework compositions must retain their semantics.

## Pinned sources and necessary differences

Convex reference: `84fbb0e70b4e857913673871cb847ad11a55f3d5`, with the
[recorded source hashes and divergence rules](../REFERENCES.md#source-and-divergence-rules).

| Reference | What it establishes / adaptation |
| --- | --- |
| [Database::begin_with_repeatable_ts](../../../../../crates/database/src/database.rs) | One transaction constructs snapshot-backed state and persistence reads at a fixed timestamp. We preserve the ownership mechanism while mapping native framework groups explicitly. |
| [ApplicationFunctionRunner::retry_mutation and _retry_mutation](../../../../../crates/application/src/application_function_runner/mod.rs) | Eligible OCC failures trigger bounded whole-mutation retries; when available, the conflicting write timestamp is awaited before retry. This is not generic retry of every failure or external effect. |
| [SnapshotManager::snapshot and push](../../../../../crates/database/src/snapshot_manager.rs), [RetentionValidator](../../../../../crates/database/src/retention.rs) | Old unsupported views fail; retained snapshot objects do not grant indefinite durable history. |
| [Configuration knobs](../../../../../crates/common/src/knobs.rs): `MAX_TRANSACTION_WINDOW`, `DATABASE_UDF_USER_TIMEOUT`, `DATABASE_UDF_SYSTEM_TIMEOUT` | Snapshot lookup, user execution and system/syscall budgets are distinct. Neither an identical name nor copying one numerical default supplies our native operation deadline. |
| [Committer::publish_commit](../../../../../crates/database/src/committer.rs) and the [accepted recovery record](./01-commit-coordination.md) | Durable save, ordered publication and unresolved outcome ownership remain distinct from the caller's wait. Our explicit stable-operation outcome protocol remains required; it is not inferred from a tracing ID. |
| [Payload request transactions](../../../design-notes/flarexdb-payload-relational-adapter.md#request-transactions), [adapter transaction methods](../../../packages/payload-adapter/src/adapter.ts) | Same-transaction nested Local API work must preserve its shared state and settlement semantics. An arbitrary Local API hook is not automatically safe to replay. |
| [Medusa repository context](../../../packages/medusa-adapter/src/repository/context.ts), [workflow host](../../../packages/medusa-adapter/src/workflow/host.ts) | Existing manager borrowing and explicit composition expose reuse seams. They do not prove all native workflows can become one snapshot or adopt Application retry semantics. |

The necessary framework difference is explicit: Convex's function-level retry
model cannot silently replay Medusa/Payload lifecycle code. Retain native grouping
and initially refuse automatic native replay until whole-command evidence permits
it. Current SQL/adapter plumbing may be replaced; its interfaces are not frozen.
Every admitted native branch still needs visibility, hook and failure witnesses.

## Remaining decisions and proof

The next question is [index readiness](./OPEN-QUESTIONS.md#next-question-index-readiness).
Numerical deadlines/history budgets, exact expiry errors, cancellation fencing,
concrete client protocols and framework-specific compatibility remain open implementation
gates in the canonical queue. No code, schema or deployment change is authorized.

Required later witnesses include nested work inheriting the same snapshot and
remaining deadline, nested refusal making the root rollback-only, expiry racing
acceptance, late asynchronous completion after expiry, safe query/mutation
restart, a native hook executing only once, and caller timeout after acceptance
or a lost COMMIT response. Measure complete operations and preserve both database
validation lanes and actual host recovery gates from [VALIDATION.md](../VALIDATION.md).
