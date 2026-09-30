# Tentative local operations and checked database boundaries

Status: **delivered bounded private implementation; mixed latency goals
unmet.** Tentative finite-root local work retains fresh checks at every
database access and final validation. The
[accepted prepared-execution rule](../../design-notes/flarex-db-accepted-design.md#prepared-execution-integrity)
and [08 protected exception](./08-fundamental-latency-redesign-preflight.md)
remain current at those database boundaries. This approval does not broaden
the ten-table protected epoch or authorize a compact session kernel, a smaller
epoch attestation, or cross-transaction metadata grants. The
[10 slice](./10-fresh-admission-evidence-preflight.md) shares evidence only
within a checked transaction; it grants no later database admission.

## Connected outcome and decision

Keep the same private Product, selected Payload, finite mixed workflow, and
standalone control graphs. A finite root authenticates its exact attempt
and selected sources before entering native framework code. Its bounded local
evaluator may process tentative handle operations, pending writes,
cached results, and close without an empty PostgreSQL transaction for each
observable local step. Every actual database access and final validation
retains the **existing full exact-running kernel, selected source/readiness
checks and protected-epoch attestation** in a short checked transaction.
The aggregate seal and later publication reauthenticate their separate
authority and conflict evidence. No SQL transaction spans a callback,
hook, remote effect or workflow suspension; no child result becomes durable
or externally successful by local evaluation alone.

This **changes refusal timing**. Before this cutover, even a cached `get`,
handle lookup, pending write, event plan and close could refuse immediately after revocation:
`logicalDocuments/workingSet.ts` called the borrowed facade's admission,
which opened an exact-running transaction. Under the approved contract, a
revocation after the entry check may reach sandbox-visible *tentative* local
data and be discovered at the next database read or seal. The root must abort
on that discovery; already visible local data cannot be retracted. Local
handle, scope, closed/cancelled lifetime and budget checks still precede
foreign input capture. The old ordering between a foreign getter or malformed
input and a later persisted revocation is deliberately changed: that
revocation is learned at the next checked database boundary. Foreign getters
never run inside SQL. Cancellation and failure close the tentative lifetime;
no local step creates a durable child success.

The [10 quiet full series](../../packages/flarex-backend/benchmarks/mixed-mutation-core/fresh-admission-evidence/README.md)
has warm outer p50 **1,551.6 / 2,013.6 / 4,471.4 / 308.8 ms**, **2,256 /
3,018 / 5,872 / 452** SQL dispatches and **82 / 105 / 199 / 6** transaction
intervals for Product, Product plus Payload, mixed workflow and standalone
workflow. In that series, Product update had 49 checked intervals and mixed
workflow run had 94.
The proposed 100 / 200 / 500 ms mixed warm goals remain unmet. The 10 trace
shows one binding/Application head and activation pass per checked interval;
source/readiness and exact attempt checks still dominate repeated SQL. SQL
fingerprints plus call graph identify these owners, not a measured function
stack or a latency prediction.

## Baseline evidence and current integrity boundary

The [attempt kernel](../../packages/persistence-postgres/src/transactionSessionActivation.ts)
checks the target scope clock, session, snapshot lease, journal, execution
claim, server time and final protected epoch. [Participant admission](../../packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts)
and [source admission](../../packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts)
read the framework data-binding head, selected activation, candidate and
physical-lane sidecars; then authenticate the Application head, activation,
revision schema and selected logical storage readiness. The target-side
selected readiness graph includes physical-definition lifecycle, index build
state, scope/table frontiers, unique build state, search build state and a
live physical `pg_index` probe. The 10 warm mixed-workflow trace finds these
templates once per each of its 94 run-phase checked intervals, with two
scope-clock templates occurring 188 times. The protected-epoch tail query
also reattests runtime grants, function bodies, covered tables and triggers
through `pg_catalog` on every guarded interval; it is not yet a small epoch
read. Initial source preparation additionally reads published control schema,
table/index/unique/relation definitions and framework installation evidence.
These control reads are not claimed as 94 repeated target reads.

The repeated target templates include `fx_system_scope_clock`,
`fx_system_tx_session`, `fx_system_snapshot_lease`,
`fx_system_tx_journal`, `fx_system_tx_execution_claim`,
`fx_system_data_binding_head`, `fx_system_data_binding_activation`,
`fx_system_data_binding_candidate`, `fx_system_data_binding_physical_lane`,
`fx_system_application_active_head`, `fx_system_application_activation`,
`fx_system_application_revision_schema_v1`,
`fx_system_physical_definition_lifecycle`, `fx_system_index_build_state`,
`fx_system_unique_constraint_build`, and `fx_system_search_build_state`.
The selected frontier query also reads scope clock/table state; the physical
probe reads PostgreSQL index catalogs. The journal-root purity query tests
receipt, point, index range, relation dependency and write-event existence.
These are trace template observations for the selected graph, not a claim
that every operation reads every listed table.

The structural and mutable parts need different treatment. The following
protection expansion is a **later optimization gate**, not a prerequisite for
the approved local-operation cutover:

| Evidence and current writer | Candidate treatment |
| --- | --- |
| Target data-binding candidate and physical lanes: `frameworkSchema/binding/repository.ts` inserts a canonical candidate and its complete sidecars together; target binding activation is inserted and head upserted there on activation. | Candidate/sidecars can be prepared only with authenticated target invalidation including insert, update, delete, truncate and predicate entry/exit. Binding head and activation selection stay fresh. A compact identity check is valid only after the selected head/activation payloads have their own unchanged-digest tamper protection; otherwise keep full decode. A changed head refuses or requires new preparation. |
| Target Application candidate, analysis, revision, publication, functions/tasks, revision schema and readiness: `applicationReadiness.ts` and Application activation/publication owners write them. | Only the ten tables named in `preparedMetadataEpoch.ts` have today's protected exception. Reuse their bounded projection under its exact epoch and final guard; other Application selection and relation metadata stay live until their own writer proof exists. |
| Target Application active head/activation: `applicationActivation.ts` inserts activation and updates head; revision schema correlates selection. | Check selected head/activation freshly at each actual DB boundary and at terminalization. Keep full content verification unless its selected rows gain authenticated unchanged-digest tamper protection. A prepared digest is not current authority. |
| Target physical-definition lifecycle: `physicalDefinitionLifecycle.ts` inserts and updates state; index, unique and search build rows: `indexBuildReconciliation.ts`, `indexMaintenance.ts`, `applicationDocumentMaterialization/materialization.ts`, `appUniqueConstraintSetBuildV1.ts`, `logicalSearchBuild.ts`, `logicalDocuments/searchEntries.ts` and commit publication update them. | Structural identity/lifecycle may be protected only after every writer and repair path is covered. Coverage progress, maintenance/frontiers and `pg_index` remain fresh where a read relies on them. A coarse trigger on ordinary coverage updates would invalidate preparation for business publication and defeat the cost goal. No partially watched-column trigger without a complete reader and writer field inventory. |
| Control schema versions, table/index/unique/relation definitions, physical requirements and framework installation/availability: schema, index/unique/relation and framework repositories write them on the control side. | Keep the existing bounded preparation plus full owned checks at entry/terminal boundaries for this first proposal. The control and target databases have no joint atomic generation; a future control cache needs an explicit quarantine-first, resume-last barrier and independent writer/repair proof. |
| Scope clock, session, lease, journal, execution claim, binding/Application head, revocation, placement and physical/index readiness used by a read. | Retain their current full fresh checks in each actual database transaction. They are not immutable structural metadata and cannot be certified by the ten-table epoch; a narrower compact proof is a later gate. |

“Compact” does not mean checking only `sessionId`, fence and a stored hash.
The current per-read and aggregate-seal kernel validates session fences,
generation, revocation and expiries, request key, schema pin, lifecycle, lease
snapshot, journal root/profile, claim and post-lock database time. Its broad
session SELECT also fetches argument/grant bodies and hashes, but this kernel
does not authenticate or hash those bodies. Activation replay's
`sessionEvidenceMatches`, the `storedAttemptEvidence.ts` loader and executor
`storedAttemptAuthentication/commitAuthorityVerification.ts` own their
separate body verification. Publication's `lockPointCommitSession` checks
scalar pins and body lengths after authentication; that projection alone
does not prove rejection of a same-length, unchanged-digest body edit after
authentication. This is a static proof limitation, not a demonstrated incident
or an accepted tamper guarantee. Preserve the authentication witnesses and
trace that owner's contract before changing it. The [12 proposal](./12-compact-checked-access-preflight.md)
narrows unused transport while retaining the current ordered scalar checks;
it does not remove existing body-authentication checks or establish new body
protection. `transactionSessionActivation.ts` owns the checked kernel, and
`pointCommitTransaction.ts`, `sessionJournalStore.ts` and the activation owner
write or replace portions of the session/lease/journal/claim rows during
activation, retry, terminalization and recovery. Before replacing its full
authenticated proof with prepared evidence, inventory every immutable-on-running
field and every ordinary DML writer; either enforce true immutability or
authenticated invalidation of the selected bytes and JSON in the same writer
transaction. A projection keyed by an unchanged stored digest cannot detect
changed bytes if an ordinary writer can preserve that digest. Mutable
lifecycle, claim, expiry, lease, budgets and journal sequence still need live
checks. Wrong-scope reuse, old claims after
expiry, and same-fence replay must refuse even if a host retains an attempt
handle. Until that row-writer proof exists, current fresh validation remains
the read/seal boundary; “compact” is a measured goal, not a licensed shortcut.

The current runtime login is restricted for the ten protected target tables,
while migration and repair use a privileged connection. Migration
`0119_protected_metadata_epoch.sql` installs a target schema incarnation and
generation, `BEFORE STATEMENT` invalidation triggers and a final `FOR SHARE
NOWAIT` lock helper for precisely those tables. Expanding a target structural
projection requires exact table/field/descendant and writer coverage, runtime
grant and trigger attestation, same-transaction invalidation, and a new
migration or isolated-scope reset decision. It must also inventory raw SQL,
restore, admin repair, DDL, trigger replacement and new predicate entries.
Privileged owner/superuser changes can bypass the current trigger proof;
privileged structural repair must quiesce protected serving before change,
then reattest and resume after a new generation. Removing an immediate
physical check for unchanged-root privileged tamper requires an explicit
accepted-design amendment and disposition of its regression witnesses.

The current epoch guard's full `pg_catalog` attestation is itself material
cost. A smaller per-transaction epoch read is credible only if the exact
restricted login, database/schema incarnation and connection are bound to an
earlier installation attestation, and a privileged DDL/grant/trigger change is
excluded while serving by an enforceable quiescence contract. Pooled or
reconnected backends cannot silently inherit another connection's proof.
Until that threat model and connection binding are approved and proved, retain
the current full attestation. Do not use a TTL or a host-local authority flag.

## Approved bounded cutover

1. At finite-root entry, use the existing exact-running kernel and source
   owners to pin attempt/fence, scope, snapshot, selected source/head digest,
   table rights, existing structural preparation and budgets. Authenticate the
   existing ten-table preparation's target epoch before and after its reads. Root
   evaluator and borrowed facades receive only opaque bounded capabilities;
   no raw transaction or SQL-bound manager escapes the callback.
2. Keep local tentative evaluation and resource charging under the root's
   existing single lifetime. Local operations may consult pinned rights and
   values but cannot refresh a DB fact, mint authority or commit a child.
   Cache hits are still charged. Failure, cancellation, claim loss, host loss
   and uncertainty close the local evaluator under the existing finite-root
   recovery/fencing contract.
3. Before each local operation, check its handle, scope, closed/cancelled
   lifetime and budget before foreign input capture. Persisted revocation can
   be discovered at the next database boundary, so the old order between a
   foreign getter/malformed input and a later database revocation is the
   approved contract change. Capture foreign input outside SQL. Before every
   actual database access, run the existing full exact-running kernel and
   selected source/readiness proof in a short checked transaction, including
   current scope/placement, session, lease, claim, journal, revocation,
   selected binding/Application head, snapshot and relevant mutable readiness.
   Register the existing protected projection and finish its full guard at
   transaction tail. Reject a changed selected identity or preparation epoch;
   start a fresh attempt rather than reinterpret pinned framework rows. Keep
   historical point/index/search/relation dependencies and pending overlay
   semantics. No foreign getter runs inside SQL.
4. The finite aggregate seal transaction uses its existing full kernel and
   source/readiness/epoch checks to recheck exact authority, protected
   structure, physical evidence, budget and journal
   position before making provisional child evidence one durable terminal
   journal result. Its stored result is not yet a published application commit.
   The later authoritative publication transaction retains fresh authority,
   conflict/OCC validation, fencing, materialization and one committed outcome
   under its existing owner. Neither transaction spans framework callbacks.
   The existing
   [publisher](../../packages/persistence-postgres/src/pointCommitTransaction.ts)
   loops participant contributions through source admission in one locked
   transaction. Reuse its existing
   `withSharedLogicalSourceBindingChecks` scope around that loop so equivalent
   selected evidence is shared **inside that transaction**, while every
   source still checks its pinned head and contract. Do not share an earlier
   Application observation across lock upgrade or add a publication cache.
5. In the existing publication transaction, share and combine selected
   table-frontier reads and batch equivalent selected index/unique build
   coverage advances in
   [materialization](../../packages/persistence-postgres/src/applicationDocumentMaterialization/materialization.ts)
   and its current index/unique owners. Index/unique coverage updates use
   batches of at most 32 selected rows; selected table-frontier reads use
   their existing owner and at-most-64-table batches. Preserve the
   exact affected rows, ordered validation, lock order,
   status transitions and error mapping; do not mint a second materializer or
   skip maintenance for an unselected definition.

This is a connected finite-root profile change, not a generic admission
registry, row cache, universal transaction API, new framework operation or
hosted activation. Ordinary standalone and `durableOperations` callers retain
their current fresh admission and full selected checks until a named consumer
and equivalent proof justify migration. Root recovery, abort-only pristine
finite fences, stored conflict reconstruction and uncertain COMMIT handling
remain authoritative; no old journal is silently reinterpreted. The profile
marker and existing durable event/receipt formats remain unchanged. Displaced
empty local admission callbacks and their immediate database-revocation
expectations are replaced by tentative local and checked-boundary behavior.

## Private contract inventory

These implemented contracts connect tentative evaluation to the existing
checked seal and native framework boundary. None introduces a durable format
or public authoring contract.

| Contract and owner | Cutover and retained obligation |
| --- | --- |
| Tentative admitted-child record in [sessionJournalStore](../../packages/persistence-postgres/src/sessionJournalStore.ts) | Retain the issuer-owned admission capability only in the process-local finite-root record so aggregate seal can reauthenticate the exact selected sources and readiness. Do not clone or serialize that capability, derive authority from a stored digest, or reuse entry admission as the seal verdict. Stored receipt/event schemas, the `finiteRoot` marker and fresh-process recovery remain unchanged. |
| Private native Product invocation in [product-attempt](../../packages/medusa-adapter/src/product-attempt.ts) | Run input selection inside the existing `withinDeadline` gate and failure latch without another call charge. Route native `captureLocalEvent` through the framework-owned policy decoder inside one existing borrowed `lifetime.operation`, after context/root/call/bytes/event limit checks. Check the same lifetime after native execution and before existing journal result capture. Preserve the selected command, native Product lifecycle, event policy and failure order; every database access retains fresh core admission and `durableOperations` remains unchanged. |
| Root lifetime in [boundedRequestLifetime](../../packages/persistence-postgres/src/boundedRequestLifetime.ts) | Add a post-callback checkpoint of the same active borrowed context without a second call charge. Recheck deadline, closure/cancellation and the existing failure latch before accepting callback output; retain the one root budget and lifetime. This grants no database or settlement authority and does not open an admission transaction. |

Aggregate seal reauthenticates every admitted child's issuer capability,
request participant/method/profile and exact selected source pins under its
full exact-running kernel before staging tentative evidence. Seal and
publication each open their own `withSharedLogicalSourceBindingChecks`
scope: equivalent source/readiness IO may be shared within that transaction,
but each source still compares its own pinned head and contract. Scope exit
revokes the shared evidence; neither boundary inherits entry admission.

## Delivered cost and remaining gates

The [retained quiet traced and full untraced series](../../packages/flarex-backend/benchmarks/mixed-mutation-core/attempt-local-admission/README.md)
show lower endpoint medians for the unchanged private graphs. Warm outer
p50/p95 are **857.9/884.6**, **1,000.2/1,053.2**, **1,782.8/1,808.8** and
**286.5/339.8 ms** for Product, Product plus Payload, mixed workflow and
standalone workflow. Cold p50 is **817.4 / 1,055.7 / 1,797.9 / 280.2 ms**.
Warm traced SQL dispatches fall to **1,063 / 1,378 / 2,173 / 361** and
transaction intervals to **41 / 52 / 78 / 6**. Product update retains 16
checked intervals and mixed workflow run 22, down from 49 and 94.

The mixed p50 proposals of 100 / 200 / 500 ms and p95 proposals of
200 / 400 / 1,000 ms remain unmet. Standalone median meets its below-400-ms
and strict less-than-10% regression gates, while its p95 rises about 5.4%.
Its 698.6 ms warm maximum remains in the full record with zero exclusions;
its cause is unestablished. Retained business effects and durable formats
remain unchanged. Full database-boundary kernel, source/readiness, physical
and epoch checks remain repeated cost owners in the trace. This does not
establish hosted latency, arbitrary framework support or production capacity.

## Proof and completion gate

- PGlite and restricted-role ordinary PostgreSQL must prove entry, local
  sequence, cached reads, uncached point/index/search/relation reads, final
  seal and publication on the same graph. Inject revocation, source head or
  epoch change after entry and between local steps/read/seal; prove local
  results stay tentative, DB boundaries reject, no child receipt or committed
  effect escapes, and retry takes a fresh fence. Prove lock contention,
  cancellation, interruption, lost claim and unknown terminal COMMIT
  recovery. Prove local handle/scope/cancel/budget refusal before Proxy capture,
  and document its changed ordering against later database revocation; retain complete
  dependency/conflict evidence.
- On ordinary PostgreSQL, retain the existing ten-table restricted-role,
  trigger/function and final guard proofs, including contention and change.
  Keep current full selected-source, physical and session integrity checks;
  prove source/lifecycle change between local work and a database boundary
  refuses. Passing PGlite cannot establish these facts.
- Run affected typechecks, scoped lint, two standing reviews and both-driver
  connected Product, Payload and finite workflow regressions. Retain one
  quiet traced and matched full untraced series with identical source hashes,
  graph and host. The structural acceptance questions are whether pure local
  operations produce **zero admission-only transactions**, live database
  checks scale with actual batch reads rather than helper calls, one
  equivalent selected binding validation occurs per settlement transaction,
  and selected table-frontier reads are shared/combined through their existing
  bounded owner while index/unique coverage updates use bounded batches with
  identical effects. Report checked interval and SQL template counts by phase,
  full warm p50/p95, cold p50, standalone regression, retained growth and
  exclusions. A lower query count is not an endpoint gain or native ORM,
  hosted, throughput or scale proof; unmet latency goals remain open.

Broader protected framework/physical metadata, a compact session kernel and
a cheaper epoch attestation are **separate later gates**. Before any of them,
name the exact selected tables/fields and direct SQL, restore, migration,
repair and DDL writers; prove same-transaction invalidation or immutability
including unchanged-digest tamper, wrong-scope/reused-claim refusal and
privileged quiescence. Choose a migration with existing-data attestation or
an explicit isolated-scope reset. For a smaller guard, prove per-connection
login and installation binding, including pooled/reconnected backends. None
of those expansions is required to remove empty SQL from approved local
operations or to share equivalent evidence inside one publication transaction.
