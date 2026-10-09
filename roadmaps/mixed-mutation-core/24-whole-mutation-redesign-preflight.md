# Whole Mutation Execution Redesign

Status: **connected replacement implemented; accepting-boundary corrections,
retirement and numerical acceptance remain open.** The owner approves complete replacement of mixed
mutation overhead and necessary breaking changes, including replay-safe whole-root
re-execution after proven precommit nonacceptance instead of durable-seal finish-only
recovery. Unknown COMMIT must be resolved before any callback replay. This is a
private runtime cutover under continued implementation, with no named-environment activation.

The [execution roadmap](./14-execution-redesign-roadmap.md) owns sequencing.
The delivered [finite execution contract](./23-finite-execution-contract-preflight.md)
is the correctness baseline; its numerical performance acceptance is incomplete.
This successor replaces the remaining entry, pending-state, contribution,
settlement and recovery topology. It is not another query-fusion package.

## Outcome, Scope And Evidence

Make an admitted mutation cost its actual business operations plus small explicit
platform work: authenticate entry, retain a snapshot, track real dependencies,
validate conflicts and constraints, and atomically commit its final effects.
Postgres remains the only commit authority. Framework business behavior stays
with native Medusa services/workflows and Payload Local API/hooks.

The connected runtime scope is the existing private Application/Product/Payload
and ordered finite workflow consumers, their executor/persistence owners,
retention and metadata writers/readers, recovery and decisive test consumers.
Future workflow profiles are an extension contract, not automatic admission of
new modules, parallelism, retries, locks, hooks or external effects. Public APIs,
host pooling/activation, arbitrary framework expansion and silent durable-data
reset remain outside this scope.

The predecessor [complete direct measurements](../../packages/executor/benchmarks/core-performance/finite-contract-cutover/README.md)
fail every mixed median/P95 target. They show 559/761/1,511 client SQL submissions
and 50/53/69 transactions for Product, Product plus Payload, and mixed workflow.
Those are request/control/read transactions, not independently committed business
mutations. SQL counts alone neither attribute CPU nor prove a latency cause.

The predecessor publication reconstructed complete table/index identity catalogues
once, three times and six times on those graphs. In that source,
[`pointCommitTransaction.ts`](../../packages/persistence-postgres/src/commit/pointCommitTransaction.ts)
iterates operation/source contributions; `readFiniteCommitClosure` in
[`sourceAdmission.ts`](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission.ts)
loads complete published physical requirements before selecting touched tables.
This is a responsibility/lifetime defect to replace, not merely batch.

The shared [`rootEvaluator.ts`](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/rootEvaluator.ts)
already owned native pending rows/dependencies. Application `finite.points`,
`appPoints` hydration seeds, detached native contributions, `finite.entries`,
`prepareFiniteRootRows` and sealed SQL journal reconstruction in
[`sessionJournalStore.ts`](../../packages/persistence-postgres/src/execution/sessionJournalStore.ts)
formed distinct representations. That source proves their duplication; it does
not establish its exclusive CPU share or quadratic growth.

## Convex Principle And Required Divergences

The checked-in Convex
[`retry_mutation`](../../../../crates/application/src/application_function_runner/mod.rs)
starts a logical transaction, checks a previously committed request, executes
the mutation, and stages successful result/logs in that same transaction.
OCC starts a new transaction and reruns admitted code. Its
[`SessionRequest`](../../../../crates/model/src/session_requests/types.rs)
has no incomplete-mutation record. The
[`committer`](../../../../crates/database/src/committer.rs)
validates a final transaction against committed history and pending writes,
persists its effects, and orders visibility.

Adopt one logical attempt and one final acceptance. Do not copy Convex's
in-process registry or storage implementation as a Postgres/Cloudflare guarantee.
Its transaction-level request deduplication does not itself establish exclusive
pre-execution ownership; outer dispatch exclusivity was not established by this
source audit. Flarex retains a compact durable anchor
for its selected exact-request ownership/fencing, snapshot/history and metadata
reservations, and uncertainty serialization. No SQL transaction spans callbacks,
sandbox execution, workflow waits or external effects.

## Selected Execution Contract

| Boundary | One owning responsibility | Work removed from this profile |
| --- | --- | --- |
| Installation and preparation | Existing managed installation/maintenance owner proves structure and interlock. Existing bounded preparation authenticates selected immutable executable/schema/binding metadata. | Rebuilding installation/catalogue proof or compiling unrelated definitions for every attempt or framework call. Live permission is never cached. |
| Entry | One trusted owner authenticates request/principal, profile, placement/incarnation, revocation, executable/source policy and snapshot; persists the exact fence/owner/deadline and history/metadata reservation. Only confirmed entry issues a usable attempt. | Separate finite session/lease/claim/journal-body construction where those rows only repeat the same authority. Full-source serving readiness is replaced by actual-demand readiness. |
| Execution | Extend the existing core evaluator into one owner of original observations, pending values, consumed metadata, ordered operation receipts, events and budgets. Application syscalls and native adapters use restricted views of it. | Application-to-native pending hydration and per-child exported global effects/dependency contributions. Child completion never commits. |
| Storage frontier | Fetch the captured native demand at the original snapshot plus pending work; freshly accept required authority, retention and demanded access-path lifecycle/coverage. | Empty admission transactions for local work and unrelated same-source index readiness. Fresh revocation/fencing and exact negative/range/page/relation evidence remain. |
| Operation close | Preserve native constraint/error timing, result, event policy, local replay identity, accounting and sticky failure; revoke the child view. | Re-projecting the complete global commit input for each operation. A caught staged failure remains rollback-only. |
| Freeze | Drain or interrupt owned runners, prohibit late work, and detach one immutable final graph. Existing planners derive final dependencies, rows, keys and relations outside SQL once. | Finite entry/point/range/event SQL projection and repeated healthy journal encoding, decoding and hashing. Canonical encoding remains at real wire and durable boundaries. |
| Final settlement | One short Postgres transaction freshly accepts exact authority, consumed metadata and data OCC; resolves affected write mechanics and constraints; commits data/history/indexes/relations, result/outcome and event intents; consumes the anchor/reservation. | Healthy finite durable seal, separate finishing, and their proof reconstruction. |

This replaces interfaces and their consumers, not just their implementations.
It does not add another global working set, framework-specific storage engine,
transaction-engine registry, generic CRUD interpreter or competing finalizer.
Core owners retain their actual responsibilities; new interfaces must remove a
proved duplicate responsibility.

The durable anchor binds the stable request/idempotency identity to exact
arguments, function/executable identity, principal and access policy across
attempt fences. Entry and final locked acceptance check the exact correlated
committed outcome before effects. Retry and takeover serialize on that same
identity: an old final transaction cannot race replacement execution, nor can
different request semantics reuse the key. Per-attempt snapshot and metadata
reservations remain distinct from this stable request identity.

Repeated writes retain the original snapshot preimage and only the final pending
value. Replacing journal projections must preserve the history/index/constraint
owners' ability to derive exact old-to-new effects.

Entry authenticates the selected metadata and capability envelope. An unused
unready index is not an entry or tentative-read prerequisite. Final acceptance
must still prove every currently affected write-maintenance obligation. These
refusal changes need witnesses; they do not weaken permissions or permit an
unready demanded path to return partial or false-empty data.

## Current Write Maintenance Once Per Touched Table

Extend the existing canonical metadata-contract observation owner to carry its
complete canonical table write-closure semantics alongside the existing identity
and digest. The final owner acquires distinct touched-table contract rows and
freshly checks their selected physical/build/coverage obligations. This replaces
per-contribution full-catalogue compilation rather than creating another schema
registry. Schema/backfill must obtain semantics from genuine canonical writers;
old digest-only rows cannot be treated as a complete closure.

Collect distinct touched tables from the final graph, irrespective of how many
framework operations wrote them. Resolve each table's **complete current** row,
ordered/unique/search/JSON/reverse-relation/reference maintenance closure once
for this final transaction. Untouched tables are not catalogue prerequisites.
Repeated business calls still cost native work and ordered receipts, not another
whole-schema identity pass.

Keep each receipt's method, domain, event and admission checks. Final native
document validation groups only the exact issued participant authority and its
authenticated table identities, so repeated receipts from that owner validate
each final live row once. Distinct issued authorities remain distinct validation
owners even when their source names match. Neither read-only receipts nor repeated
updates trigger another validation of the complete final graph.

Lower coalesced old-to-final row changes through the existing materialization
owners. Derive index/search/unique/relation deltas from those preimages and final
values, and avoid unchanged auxiliary writes only where their owner proves the
same history, constraint and coverage behavior. Do not persist intermediate
business values merely because several callbacks edited the same row. Native
storage bindings must also retain efficient bounded query demands; shared
business code alone does not establish native database performance.

An issued immutable closure can be reused only with a complete canonical
writer-owned projection and fresh semantic acceptance. Inventory every schema,
binding, definition, activation/retirement and maintenance writer before replacing
the current complete-catalogue loader. Each must atomically maintain the relevant
projection under the compatible authority/commit-lane protocol. A partial
consumer compilation, digest alone or TTL is insufficient.

The concrete writer split remains the one recorded in the
[finite metadata contract](./23-finite-execution-contract-preflight.md):

| Writer | Complete semantic responsibility |
| --- | --- |
| Application activation | Publish executable facts and the complete native Application schema projection, including tombstones for withdrawn owners. |
| Binding activation | Derive the complete candidate across sources and update all current and previous source owners in its activation transaction. Incoming foreign keys and global relation extensions update the affected target table closure even when that target source is otherwise unchanged. |
| Application and binding installation backfill | Authenticate genuine current retained artifacts and populate missing canonical semantics before runtime reopens. Request entry never repairs the projection. |
| Physical build, coverage and retirement owners | Preserve immutable selected definition identity and supply fresh mutable readiness and availability checks at final acceptance. A reused semantic projection cannot replace those checks. |

Per-source filtering belongs to read admission; it does not limit an activation
writer's projection. Historical null semantic bytes fail closed until the
canonical backfill completes. Existing digests and metadata sequence/tombstone
semantics retain their meanings.

Under the final lock order, accept current affected build/spec/coverage and
physical availability, and detect definitions activated during execution and
incoming relation/unique/reference obligations. Authenticate and revalidate the
prepared closure's exact semantic identity, consumed metadata and entry-watermark
ABA evidence. A relevant closure change after freeze causes conflict before
writes; final acceptance cannot substitute newly activated mechanics into the
frozen plan. Fresh mutable coverage/lifecycle checks do not themselves replace
that semantic acceptance. Preserve complete
operation provenance, domain write permissions and resource bounds.

## Complete Preparation And Acceptance Ownership

The compact-anchor and pending-graph cutover alone does not meet the fixed
latency targets. That direct baseline reconstructed Application
preparation for every request, repeated ordinary catalogue location during
publication, and entered checked SQL for a known pending Application patch.
The connected replacement corrects these ownership/lifetime connections through
the contracts below. They are part of this selected replacement, not a separate
compatibility path or a host-pooling proposal. Native source construction already
has a bounded prepared-host lifetime; Application construction must use that
same genuine lifetime through its existing issuer, charging and disposal owner.

The existing preparation owner must capture and authenticate immutable
executable/schema/binding/physical semantics once per bounded construction.
Function-specific admission derives from that issued capture, while current
head, semantic identity, installation/protection epoch and actual authority
remain accepting-boundary checks. A retained label or a fixture-local cache is
insufficient. Relevant change rejects or explicitly reprepares; no live
permission, placement, readiness or claim verdict becomes a cached value.

Move entry and initial-renewal acceptance to the existing installed scope
authority owner where the actual co-located profile permits a fresh check in
the target transaction. Its observation must authenticate current installation,
placement/receipt, namespace/incarnation and execution authority. Current
separate control preludes cannot simply be deleted: they presently supply
placement evidence. Named non-co-located profiles retain their real cross-store
proof obligations, without a fallback engine. Keep initial renewal before
expensive execution and preserve authority-before-sequencer/session lock order,
post-wait database time, revocation, retention and exact owner/fence/deadlines.

Finite final planning must consume genuine prepared definitions and the complete
canonical writer-owned table semantics through the existing definition owners.
Remove ordinary schema/unique/relation reconstruction, per-index repeated scope
location and per-table control definition transactions from this finite path.
Capture authentic candidate planning evidence in an already required owner
boundary, compile outside SQL, and recheck it under the final lock. Do not add a
second planning transaction, new schema registry or structural assertion that
impersonates an issued definition. Missing semantics and relevant metadata ABA
still fail closed; current physical build/spec/coverage and constraints remain
fresh final checks. Ordinary/durable consumers keep their actual preparation
contracts.

SessionJournalStore must execute issuer-authentic finite pending point planning
locally when the graph already contains the required original observation and
pending value. A storage miss enters the existing checked frontier. Preserve
the first fresh write-ownership acceptance per touched table in this finite
attempt; later local writes consume that acceptance and the exact entry policy
dependency, with current ownership checked again at final publication. A known
read does not itself grant write permission. Local validation consumes the
genuine immutable session schema and retains the catchable document-error rule.
Preserve
sequence/replay receipts, capacity, immediate document errors, sticky failure,
capability closure and final ownership/OCC; never fabricate a transaction or
clock context. The selected insert still keeps its genuine historical-ID
collision observation. Resolve immutable Application table identity from the
authentic capture rather than using an empty data transaction.

### Reconstruction After Managed Metadata Invalidation

Managed metadata DML advances the existing schema-wide protected epoch, including
an append for another scope. This is a preparation invalidation, not a permission
withdrawal. Installation admission does not establish row immutability: ordinary
metadata writers retain their actual DML grants. An original authenticated
capture cannot simply adopt a new epoch.

Extend the existing retained preparation lease with an explicit private
reconstruction operation. It supplies the original charging and lifetime owner
to the genuine Application constructor, holds the existing active-use reservation,
and replaces the retained Application preparation only after successful capture.
New grants and new entry use that fresh token. Existing requests retain their
original pins and evidence. Native source selections remain reusable where their
binding preparation is keyed by the new, genuinely issued Application selection;
relevant source-semantic changes still require their own acceptance.

Account reconstruction cumulatively within the same bounded lease until close.
Capacity rejection, cancellation and close must fail closed and drain through the
existing owner. Ordinary use does not become construction. This adds no healthy
request-side epoch probe or SQL, and creates no second lifetime, registry or
unbounded host cache. Prove authentic reconstruction after shared-scope setup,
same-target contention and independent-scope progress, exact retained charging,
close/cancellation/capacity behavior and corruption between capture and acceptance.

Replay keeps the complete originally signed execution authority, including its
historical activation sequence and active-head digest. Fresh entry acceptance
separately authenticates the current metadata head and requires the exact signed
runtime target and schema. Restoring the original revision after an intervening
activation may therefore admit a new attempt at the same data snapshot; a
different program must refuse before callbacks. The finite execution projection
must distinguish the immutable admitted executable from the newly accepted
metadata head, rather than compare their activation sequences or present current
head evidence as historical admission evidence. Preserve the positive
same-snapshot Application activation ABA witness and verify the complete stored
signed authority is unchanged. Neither reconstruction nor retry may silently
re-sign a grant, rebase the old capture or substitute another executable.

The finite runner receives only the authenticated manifest, trusted host identity
and compatibility date, original signed execution authority and runtime target.
Keep historical activation/readiness/head proof fields with the durable graph
owner. Authenticate the exact runtime-target digest and schema at the finite
materialization boundary as well as replacement acceptance. Initial admission
still checks the complete signed head; fresh metadata acceptance still checks
the current head and preparation protection. This private projection replacement
migrates finite entry, the runtime runner and cold grant-pin extraction without
weakening the full durable recovery evidence model.

At native frontiers, consume the live transaction-scoped authority already
returned by the installed scope owner rather than selecting it again. The anchor
owner must lend an exact frontier projection instead of transporting and
decoding the entire session/grant/argument representation for each demand.
Preserve canonical body/digest corruption detection, immutable request pins and
mutable claim/fence/deadline checks. Serving sequence and time must be observed
after the anchor wait; a preliminary installed sequence cannot substitute for
them. The ten actual Product storage demands remain independent boundaries until
a genuine captured query plan proves otherwise; no SQL spans native callbacks.

Completion requires authentic lifetime/disposal/capacity and metadata-change
witnesses; fresh placement/installation/renewal refusal before callbacks;
candidate-head and canonical-closure changes before final writes; both-driver
insert-to-pending-patch zero-SQL/replay/collision/failure proofs; frontier body
tampering, revocation/expiry/retention and post-wait sequence proofs; connected
framework/recovery regressions; final reviews and complete quiet/native/scaling
measurements. Preserve the failed measurements and every sample. Fixed latency
targets and named-environment durable-data gates are unchanged.

## Recovery Decision And Workflow Profiles

**Selected:** finite database-only execution remains tentative until final
COMMIT. After a proven precommit abort or process loss whose old attempt can no
longer settle, admit a new fenced attempt and rerun the whole operation. This
removes the promise that a confirmed uncommitted seal can finish without rerunning
code. The owner's implementation approval selects this behavioral change.

| Authoritative observation | Required action |
| --- | --- |
| Confirmed COMMIT or exact correlated committed outcome | Return its stored result; preserve event/delivery identity; never rerun business callbacks. |
| Confirmed noncommit, with the old terminal transaction settled or conclusively fenced from acceptance | Check replay eligibility separately from the nonacceptance proof. An eligible replay-safe request may obtain fresh request/framework state and snapshot within its persisted budget. |
| Lost COMMIT response, failed outcome lookup, unproven absent outcome or interrupted cleanup | Resolve the exact old decision and fence further execution. Absence, timeout, host death and lease expiry alone do not prove rollback. |
| OCC | Preserve exact dependency/conflict evidence and admit a fresh whole-root attempt within its retry budget. Permanent business/authority failures do not become retries. |
| Cancellation racing settlement | Revoke local work, settle owned SQL/cleanup and report the actual durable outcome. Cancellation cannot undo a commit. |

Nonacceptance proves that replay cannot duplicate a commit; it does not make every
failure retryable. Permanent business, policy, authority, corruption, capacity and
nonretryable SQL failures durably terminalize the anchor after outcome-first
resolution. Cold redelivery must honor that terminal decision. A lost host with no
known permanent refusal may replace its fenced unaccepted attempt only after
fresh authorization and within the same persisted budget.

This disposition also covers permanent fresh-entry admission refusal during
replacement. The replacement primitive first rolls back its provisional entry;
the trusted outer retry and cold-recovery flow must then resolve the old outcome
and durably abort its exact fenced predecessor. Leaving that anchor `retrying`
would allow cold redelivery to ignore the known refusal. Extend the existing
resolver's issuer-authenticated terminal-refusal route for genuine permanent
replacement-admission failures, preserving the exact command/proof provenance.
Do not treat arbitrary error objects, uncertain COMMIT, failed rollback, defects
or interruption as that authority. Prove unchanged business data and events,
zero additional callbacks, committed terminal disposition and cold refusal;
keep the replacement primitive's complete rollback witness separately.

Retain the existing publication policy rather than inventing a universal retry
engine: confirmed PostgreSQL serialization/deadlock refusals (`40001`/`40P01`)
permit at most three attempts at the same frozen final command, with the existing
10/20 ms jitter policy. These retries do not rerun business callbacks. Eligible
whole-root OCC replay permits at most four reruns, persisted as five total attempt
fences, with the existing 100 ms exponential backoff capped at 2,000 ms outside
SQL. Warm execution and cold recovery share that limit. Always check the exact
committed outcome before reporting exhaustion, so a successful fifth attempt
still returns its stored result. Unknown final decisions resolve before either
retry policy can authorize replay.

Durable seal and callback-free finishing recovery remain only for named ordinary
or durable consumers that require them. They are displaced on the selected finite
path, not retained as its alternative or fallback.

Profiles follow execution behavior, not framework names:

- **Finite database-only attempt:** native business code/hooks may read/write
  admitted storage, transform results and capture supported event intents. The
  complete callback graph must be replay-safe under its available capabilities.
  A wrapper or method name does not prove arbitrary hooks safe.
- **Durable/effect workflow:** actual pauses, remote effects and non-replay-safe
  callbacks retain workflow-owned checkpoints, idempotency and compensation.
Its independently committed atomic database steps may use shared mechanics;
  the whole workflow does not become one atomic mutation or a SQL transaction.
- **Existing direct commands and ordinary durable operations:** keep their named
  settlement/recovery policies. They do not acquire the finite replay contract
  merely by sharing storage.

The finite profile continues to refuse relational `setNull` and
`referenceReplacement` intents. Borrowed Commerce interfaces expose methods
that can produce these intents, but the previous finite operation-close owner
refused them; this cutover does not make those Product operations newly
supported. Preserve the refusal at operation close and root rollback-only
behavior. Actual ordinary Commerce consumers retain their existing relational
finalizer. Likewise, the relation-generation Application entry remains with its
existing ordinary admission profile; old tests that constructed a bare finite
journal do not establish authenticated finite admission for that generation.

Resource coordination is orthogonal. A bounded root-scoped lease needs explicit
acquisition, renewal, fencing, release and abort/crash handling before admission;
a lock spanning commits or suspension belongs to durable coordination. Current
finite Medusa lock refusals remain until a real lock capability is proved. OCC
does not supply a resource lock, and a PostgreSQL advisory transaction lock cannot
be held across a native callback under this architecture.

Current finite SDK compensators must be `transactionCovered`. Those database
inverses do not run to undo discarded provisional writes. Lock release, resource
cleanup and compensation for externally visible or previously committed work
require their own admitted lifecycle and recovery contract. See the executing
[`definition.ts`](../../packages/medusa-workflows-sdk/src/definition.ts) and
[`runtime.ts`](../../packages/medusa-workflows-sdk/src/runtime.ts), and native
[`acquire-lock.ts`](../../third_party/medusa/upstream/packages/core/core-flows/src/locking/steps/acquire-lock.ts).

Payload validation, nested Local API calls and `afterChange` retain native order
before outer settlement. Medusa service/workflow event calls capture the admitted
intents. External delivery starts from committed intents. Moving all hooks after
commit would break business semantics and does not establish this redesign.

The actual native lifecycle and existing decisive consumers ground these gates:
[`Payload create`](../../packages/payload-adapter/node_modules/payload/dist/collections/operations/create.js),
[`nested hooks and rollback-only`](../../packages/flarex-backend/test/mixedMutationPayload.workerd.test.ts),
[`fresh whole-root Payload retry`](../../packages/flarex-backend/test/mixedMutationPayloadRetry.workerd.test.ts),
and [`workflow outcome/events and lost-COMMIT`](../../packages/flarex-backend/test/mixedMutationWorkflow.workerd.test.ts).
The pinned PostgreSQL
[`lock provider`](../../third_party/medusa/upstream/packages/modules/providers/locking-postgres/src/services/advisory-lock.ts)
also proves why its transaction-held callback cannot be reused directly.

## Breaking Contracts, Durable Data And Removal

The concrete anchor cutover evolves the existing `fx_system_tx_session` authority
row rather than adding another request-identity root. New finite rows carry direct
snapshot/owner/fence/deadline columns and a bounded canonical snapshot/metadata
reservation body. They do not create lease, journal or claim child rows. Ordinary
durable sessions retain their real children. Outcome correlation continues with
its existing stable request/session owner.

The new anchor body has a 128 KiB bound; live renewals update direct columns and
do not reencode the immutable reservation. Canonical metadata contract semantics
have their own 4 MiB bound. Prove these against the selected complete catalog
capacity and exact oversize/corruption cases; bounds are not a claim of arbitrary
schema or workload capacity. Existing digest-only contract rows require a genuine
canonical managed-writer backfill before new finite admission.

| Existing contract | Disposition and gate |
| --- | --- |
| Finite journal attempts/handles, confirmed-entry/seal captures and executor assembly | Replace with an issued finite attempt, restricted views, one frozen graph and final settlement/resolution. Migrate real Product/Payload/workflow and direct proof construction together. |
| `finite.points`, `appPoints` seeds, `finite.entries`, finite `SourceContribution`/global effect carriage and `prepareFiniteRootRows` | Replace/delete on the finite path after interleaved Application/native reads/writes, exact dependencies, local replay and constraint timing pass. |
| Finite seal/finishing verification, liveness, retry/redelivery and recovery formats | Replace together after the terminal choice, complete recovery witnesses and old-record disposition. Do not bypass finishing in an adapter. |
| Per-contribution complete-catalogue closure acquisition | Delete after the canonical distinct-table closure and complete writer/locking proofs; no retained comparison or fallback engine. |
| Finite session/claim/lease/journal correlation, metadata reservation and retirement readers | Consolidate only where one compact durable anchor supplies all real ownership/retention duties. Migrate pruning, physical retirement, claim renewal, abort and conflict/retry readers together. |
| Ordinary Application journal/syscall/seal and real durable-operation checkpoint consumers | Retain under their named profiles. Shared tables/code remain only for actual callers, not because an old finite test uses them. |
| Committed outcomes/results, event intents/delivery identity, history/tombstones and retained conflict evidence | Preserve or migrate explicitly. Breaking changes provide no deletion authority. |

Prefer a quiescent drain: stop old finite admission, settle active owners, drain
sealed/finishing/conflicted obligations through their current authenticated
recovery, terminalize lost running ownership safely, and inventory actual
scope/placement/fence/format/counts. Preserve committed evidence. Prove no remaining
old nonterminal obligations before activating the new profile and removing its
readers/routes/columns. If a real environment cannot drain, record a reviewed
exact migration; do not fabricate pending state or reset durable rows. There is
no named-environment activation authority in this preflight.

## Finite Delivery And Acceptance

### Complete Accepting Boundaries

The connected capture replacement and protocol parsing reuse meet workflow
median/P95 and mixed Payload P95, while Product median/P95 and Product/Payload
median still miss acceptance. Product tail spikes remain unexplained. Lower SQL
counts alone do not satisfy acceptance. Remaining measured orchestration belongs to initial binding
acceptance, repeated physical-target resolution, candidate preparation and
demanded serving checks. Replace these together through their actual owners:

- Finite entry authenticates the current binding, canonical Application/schema
  correlation, source identities, methods, principal and metadata projection.
  It does not require every unused index, unique or search definition to be
  serving-ready. Actual storage demands retain their selected readiness checks;
  final writes retain the complete current touched-table maintenance closure.
  Ordinary activation and durable profiles keep their existing full contract.
- The authentic finite entry lends its physical target and preliminary pins for
  the existing attempt lifetime. Application frontiers and final publication
  accept installation, current placement/receipt and execution authority inside
  that target transaction. A placement change refuses the original attempt; it
  does not silently route its provisional graph to a new target. This replaces
  ordinary control-plane lookup choreography, not current placement checks.
- Candidate-schema semantics and compiled validators belong to the existing
  charged preparation lifetime, selected by the exact captured candidate head.
  Final publication still checks the fresh locked head and protected metadata
  writers. A changed artifact or preparation epoch refuses or reconstructs
  through the genuine owner; a digest or fabricated cache entry is insufficient.
  Preparing the same complete candidate anew at every entry only moves cost.
- Installed publication acceptance uses the existing ordered installation and
  placement owner, execution-authority share lock and sequencer exclusion.
  Outcome-first acceptance must precede fallible planning. Unknown final COMMIT
  continues to resolve its exact outcome before any callbacks or replay.
  After exact clock identity, anchor, fence, reservation and liveness acceptance,
  the publication kernel issues the existing transaction-local write-clock
  observation for downstream native checks and writes. Its own settlement
  cleanup closes that observation. Share reads and native frontiers never gain
  the sequencer-excluding write permission.
  The same final owner opens the existing protected-metadata guard scope after
  live acceptance, flushes all registered guards inside the final transaction
  before COMMIT, and closes the scope on every exit. A failed final guard rolls
  back business writes, the stored outcome and event intents together; recovery
  still resolves an uncertain COMMIT through the original outcome owner.
  The Promise transaction owner retains installation admission and its exact
  accepting provenance through callback completion and settlement. The shared
  Effect bridge borrows that transaction and owns Exit/Cause reconciliation;
  it neither reacquires nor closes the outer owner's admission. Real raw-database
  Effect consumers retain an explicit installation-owning wrapper over the same
  settlement mechanics. No caller-selected installation bypass is introduced.
  Warm resolution of an authentic frozen attempt consults its original target
  before current placement resolution, including after a failed immediate
  uncertain-COMMIT lookup. Cold recovery retains its recorded routing contract;
  an invalid supplied frozen capability does not silently select that profile.
- Native storage frontiers retain separate installed acceptance and exact
  canonical-anchor acceptance. Demanded build locks may wait. Their compact
  post-wait observation must read database time, serving sequence and requested
  coverage after those waits, with a fresh Read Committed snapshot. A single
  joined statement's evaluation order does not prove snapshot freshness. Use a
  bounded installed VOLATILE database owner with separate internal commands
  where consolidation requires it, preserving liveness-before-readiness failure
  order and the existing transaction-scoped observation lifetime.
  This acceptance covers native ordered-index and unique demands and Application
  indexed demands. Every required build wait must precede fresh database-time
  and original anchor-liveness acceptance before storage work. Lending only the
  native ordered-index demand leaves the other read boundaries incomplete.
  Borrowed framework evaluators may select another genuine demand inside the
  same checked transaction. An unmatched later build lock also requires fresh
  database time and serving state before readiness or business data is released.
  The existing finite authority observation retains its authentic locked anchor
  for that owner-issued liveness check; matching initial demands reuse their
  exact observation. This adds neither another lifetime nor a cached permission.

These are private execution, target-lending and preparation-contract replacements.
They introduce no business-data reset or public developer API. Any required
installed-function migration preserves existing sessions, outcomes, event intents
and history, and follows the existing attestation/grant owners. Migrate affected
finite consumers and remove displaced choreography in the same cutover. Do not
add a general installation-bypass flag or cache a live permission/readiness verdict.

### Complete Dependency Validation

The accepting-boundary cutover still misses the complete Product and mixed
Payload targets. Final native dependency validation retains serial table,
unique-key and ordered-range reads despite existing bounded batch owners.
Replace that choreography inside the logical-document validation and index
owners; Application range-history OCC already has its own batch and stays there.

Retain phase order (scans, unique reads, ranges, search, pages) and consume each
ordinal's verdict before later ordinals. Batch initial range pages using the
recorded membership plus one, bounded by the existing page limit; finish any
continuation for that ordinal before comparing complete membership. This lets
small and empty ranges share a bounded command without truncating larger ranges.
Preserve exact key/row/revision equality, negative intervals, page cursors and
EOF, the existing settlement entry bound, and stored-corruption/limit failures
before conflict when the original complete read would produce them. Existing
batch owners retain deferred decoding and preparation failure ordering.

This replaces private validation choreography without changing durable graph
formats, snapshot semantics, sequencer ownership or framework callbacks. Migrate
the logical-document validator directly; retain ordinary scalar reads only for
their genuine remaining consumers. Prove conflicting and unchanged ranges,
empty predicates, continuation/limit/corruption ordering, both database drivers
and connected mixed settlement before the next complete quiet comparison.

### Finite Entry Ownership

The entry transaction creates the original empty anchor and immediately fills
its admitted metadata reservation. Reservation persistence currently reads that
same row again and authenticates it as recovered durable input. Replace this
with the existing entry owner's genuine transaction-held expectation. The
reservation update must match the exact original stored bytes and immutable
session correlation in its predicate and inspect the actual returned row.
Preserve the checks before source admission and after reservation persistence,
including trigger tampering, snapshot/request identity, original fence and
canonical body correlation. A caller-supplied session row is not an issuer.

This removes redundant materialization and recovery decoding of the transaction's
own created anchor without caching live authority or changing its durable format.
Genuine stored recovery retains full authentication. Validate the same creation,
replacement, tamper and rollback witnesses on both drivers and the existing
native/framework consumers; remove the displaced reservation reread in this slice.

### Owned Finite Start And Original Authority Capture

The finite caller currently activates a detached handle, then starts execution
through an initial renewal transaction. Replace that private finite contract
with an executor-owned start that accepts the genuine prepared mutation, verified
grant and captured request evidence. It owns construction, entry settlement,
callback admission, heartbeat supervision and teardown as one request lifetime.
It accepts neither an old activated handle nor caller-authored acceptance evidence.
Ordinary durable execution keeps its detached activation and initial renewal.

Construct the execution context before entry. After source admission, reservation,
final correlation and protected-metadata guards, obtain fresh database time after
every potentially waiting check. Require the original grant, claim and lease to
remain live and establish the existing configured heartbeat headroom without
reviving expired ownership. Preserve installed authority/placement, sequencer,
request/session and source/build/head/metadata lock order. Retain the actual
accepted returned row and context. Confirm the existing entry capture, mint and
consume the same-factory claim, and enter the private callback continuation only
after acknowledged COMMIT. No transaction crosses callback execution.
Retain the same issued attempt-state object used by native read callbacks and
the root registry. Its immutable claim owner/fence pins do not change when entry
renews deadlines; those fresh dates belong in the separately accepted context.
Attach exact cleanup while the acknowledged ownership handoff is masked, before
restoring callback cancellation. An operation wrapper must not defer that
construction past the handoff.

Callback admission linearizes at that final protected transaction acceptance.
Today's renewal also linearizes before COMMIT; neither claims lease freshness at
the arrival of a delayed acknowledgement. Revocation, takeover or expiry after
COMMIT remains subject to heartbeat, every actual storage frontier and final
settlement. Cancellation is owned before entry through teardown: no callback
after cancelled admission; an acknowledged committed entry is terminalized with
its exact claim, rather than treated as rolled back. Unknown entry COMMIT issues
no confirmed capability or callback permission and retains exact recovery.

Use the original canonical signed execution-authority capture already charged by
the genuine finite preparation. Initial entry must correlate complete stored
JSON, bytes, digest, grant, arguments, principal, function, request and session
identity against that capture and retain it through the existing confirmed-entry
owner. Warm replacement consumes that authenticated original program while fresh
Application admission independently accepts a compatible current head. It must
not substitute the current program for the signed original. Cold recovery keeps
full stored canonical, signature and argument authentication. A closed, cloned or
foreign preparation never supplies authority.

Migrate the shared finite fixture and warm replacement continuation, including
their failure and recovery consumers, and remove displaced private detached finite
execution entry points. Keep explicitly named cold recovery and ordinary durable
profiles. This changes private inputs and lifecycle APIs without changing durable
row/body formats, deleting retained data, altering framework semantics or adding
a permission registry. The shared liveness owner lends its supervision mechanics
to this trusted composition; its detached API always performs initial renewal.

Prove final-wait expiry, returned-row tamper, unknown COMMIT with zero callbacks,
delayed successful acknowledgement and subsequent expired-frontier refusal,
duplicate/fenced starts, revocation, closed preparation, original-program A-B-A,
cancellation before and during COMMIT/execution, exact cleanup and unchanged cold
authentication on both drivers. Preserve complete native results, events and
outcome atomicity. Complete-request CPU profiles are diagnostic; inspector startup,
idle, GC and actual sampling intervals remain visible, and cannot satisfy quiet
latency acceptance or establish exclusive CPU by subtracting SQL waits.

### Logical Metadata And Receipt Capture Ownership

Complete-request CPU evidence identifies repeated metadata witness decoding and
multiple detachment passes through the same receipt/graph owners. Replace those
chains inside the logical working set, metadata projection and existing frozen
attempt owner. Retain first-use and foreign-input validation, descriptor/getter
policy, native input/output capture and all byte, call and root capacity bounds.

The existing consumed-metadata record may reuse a decoded witness only for the
original authentic projection object, exact dependency key, entry watermark and
selected present/missing digest. Different provenance, content or watermark must
use the existing decoder and refusal semantics. Root closure, correlation,
capacity checks and final fresh metadata verification still run; a key alone is
not a reusable permission or witness.

Build activity data within its lexical owner. The exposed activity snapshot
detaches that data once; operation close passes owned data to its existing
logical-change detacher once. The root snapshot similarly delegates the observed
values to its existing final graph detacher. No mutable owned graph leaves either
boundary. The existing frozen registry supplies a narrow detached projection of
row intents and successful result for executor commit validation, avoiding a
whole graph/operation copy solely to inspect those fields. Publication keeps its
full detached read after outcome-first acceptance. It also retains authentic
original entry/preparation references privately for warm signed-authority reuse;
detached data readers cannot reconstruct or clone that capability pair.

Migrate the executor validation reader and warm replacement consumer together.
There is no new registry, lifetime or durable format. Prove exact repeated and
negative witnesses, foreign issuer/digest/watermark and closed-root refusal,
mutation isolation for returned activity, graph and frozen value/byte projections,
child ordinal/result/event semantics, actual Product/Payload settlement and
unknown-COMMIT recovery. Broad canonical-codec or private JSON capture changes are
not selected by this evidence.

### Selected Finite Storage Capture Replacement

The complete owned-start and logical capture comparison still misses Product
and mixed Payload acceptance. Its separate Product SQL diagnostic attributes
73 client commands and ten short transactions to storage work inside the native
update; entry and publication remain separately charged. The selected next cut
replaces installed finite storage callbacks with named bounded evidence captures. It
must not wrap arbitrary SQL or fabricate a transaction for existing callbacks.
The installed server owner would accept installation/placement, execution
authority and exact original canonical anchor bytes, digest, immutable pins,
snapshot/reservation and claim before any selected build lock. Separate VOLATILE
commands would then obtain post-wait liveness, serving sequence and coverage
before the existing storage owners capture bounded evidence. JavaScript would
retain canonical decoding, failure order, budgets, dependencies and overlays.
Compiled SQL/field maps may be retained by the existing located target; a
transaction-bound prepared object cannot outlive its real transaction.

The first complete capture comparison reduces commands and transactions but
regresses mixed latency. Its actual Product storage commands remain wide fixed
statements, and ordinary-role server evidence observes planning on each call;
JIT is unavailable on that measured server. Construction of a fixed client shape
does not reuse the server's protocol parsing. Name each fixed capture statement
by its exact SQL digest, within the existing database/pool owner, so PostgreSQL
can retain that parse across calls. Bind all request pins and installation
parameters afresh and execute all acceptance, post-wait liveness and readiness
work each time. This retains neither data nor permission and introduces no
transaction object, host lifetime, preparation registry or recovery fallback.
PostgreSQL invalidation and the existing physical cancellation/discard behavior
remain authoritative. The name is transport identity rather than durable or
public protocol identity. Verify real repeated execution with changing accepted
state, fresh refusal after a wait, pool discard and genuine target/control
isolation, then repeat the unchanged latency gates. Hyperdrive documents
[protocol-level named statement support](https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/);
local driver evidence still does not establish hosted activation or performance.

Native selection would capture complete historical membership before decoding
requested snapshot rows, including historical unique lookup through its ordered
index. Application pages should use membership capture followed by selected-row
capture after JavaScript merges its overlay: examined but unselected bodies must
not be decoded or charged. Keep native 256-identity/1 MiB row bounds, 1,000-entry
index pages, Application 128-entry pages and existing eight-row materialization
batches. The 1 MiB bound is a physical hydration window, not a replacement for
the existing 16 MiB native semantic read allowance. Reuse the row owner's bounded
window/consumed-count contract and freshly capture remaining selected identities
at the same original snapshot. Validate each consumed document in order before
requesting another window; a valid large query must not become a withheld-body
defect or acquire an invented business limit. Fresh inserts preserve write-ownership acceptance before UUID generation,
history-collision probing and document validation, even if that requires two
named captures. Unsupported activation-fenced finite validators still refuse.

Application write ownership is a canonical policy-history and successor proof,
not a current-table boolean. Its named capture retains the existing bounded
ownership, activation and readiness histories, coherent current head, successor
publication/analysis manifests and unique-definition closure. Extract raw
projections and deferred authoritative decoding through the existing ownership,
successor and catalogue owners; accept that complete evidence before UUID
generation. Combining its physical reads does not waive history, canonical
integrity, current-head coherence or first-verdict order.

Successor manifests and unique-definition closure are demanded only by an actual
policy transition, through additional fixed named captures charged to the same
remaining history budget. Correlate their immutable identities and metadata
epoch tuple with the captured ownership history before accepting the transition;
final publication still validates its metadata dependency. Do not eagerly read
an unused manifest or add an independent policy cache to make this proof cheap.
The installed catalogue capture uses its genuine compiled control namespace.
For a full-artifact profile with a separate control database, use the original
metadata issuer's actual control database in its own named short transaction.
Correlate its closed installation epoch and immutable definition identities
across demanded captures and final guards. A target-local catalogue read cannot
stand in for this owner, and no transaction is fabricated across databases.

Reachability governs this inventory. Current confirmed finite roots cannot enter
ordinary admission/seal or Application relation-resolution branches; remove
those displaced finite branches rather than adding capture APIs for them.
Ordinary/durable relation consumers remain real. Child preparation, checkpoints,
close and freeze already use local issuer/lifetime checks; newly demanded
references still cause actual storage reads. At the 1,024-owner capacity limit,
retirement must observe durable exact-claim death/fencing: local closure or an old
deadline cannot prove it, and frozen publication capabilities can survive local
evaluator closure. First requested transaction time remains a database business
value; subsequent requests may reuse its existing invocation-local capture. It
cannot silently become entry time or host time.

Such a replacement would need explicit installed and PGlite/full-artifact
construction profiles using the same named operations and authoritative decoders;
installed refusal must never choose another profile. An uncertain read response
creates no mutation outcome: discard its evidence, preserve root poisoning and
drain completion/cancellation before releasing resources. Combining physical
statements can move a SQL failure before an earlier deferred corruption/budget
verdict; record that private failure-precedence decision rather than claiming
unchanged physical failure order. Preserve domain decoding and first-verdict order.
This is the selected connected replacement, with no measured saving claimed.
It migrates the existing Product, Payload, finite workflow and Application
point/index consumers together before removing the finite transaction-callback
contract. Ordinary and durable consumers retain their real transaction profile.

Reuse the row and ordered-index owners' SQL and deferred decoders. Extract their
fixed historical reads into installation-owned storage functions, used by both
ordinary reads and finite captures. Preserve requested row ordinals, latest
revision at the original snapshot, tombstones/missing rows, complete index/page
lookahead, and the first complete body that crosses a byte budget. Later bodies
remain withheld. Native index membership and limit/corruption verdicts are
consumed before deferred row-body decoding; Application overlay selection stays
in JavaScript and requests only selected bodies. No second canonical codec or
framework query engine belongs in PostgreSQL.

The installed capture API is a fixed prepared SQL composition owned by the
genuine located-target preparation. Its compiled namespace identifiers invoke
the actual control placement, installation and scope owners, accept their
closed projections, then enter the target direct-session acceptor and named
storage read. A target helper supplied with a caller-authored placement boolean
or record is not this API. Bindings come only from the existing authenticated
control/target preparation; no caller supplies SQL, names or expressions, and
no new independent installation-pairing contract is introduced.

Project exact original anchor bytes, digest and immutable pins through the
existing confirmed entry/anchor issuer. All capture profiles require that
genuine expectation; storage capture is not cold recovery. Lock the session by
scope and session identity before interpreting its fence. Preserve original
immutable-pin corruption before attempt-replacement refusal, and compare date
pins using the existing millisecond projection. Read current lifecycle and
lease/claim deadlines under that lock. After selected build waits, use separate
VOLATILE commands for fresh time, serving sequence and coverage, then accept
lifecycle, expiry, generation/fence, epoch, revocation and retained-history floor
in their existing order before releasing bodies. Prepared metadata generation
correlation remains command-local; it must not become an unchanged-since-entry
permission cache.

Return a closed accepted/refused header and typed row/index envelopes with byte
columns and ordinals. Do not encode document bodies into a JSON envelope or
mint a transaction observation that survives statement completion. Native
installation, placement, anchor, authority and post-wait liveness refusals block
the business read. Fresh selected builds require the domain decoder's full typed
obligation, opening-pin, requirement and current-head agreement: bounded inert business bytes may be transferred
with that evidence, but must not be released, decoded, charged or observed by a
consumer before its readiness verdict. Native build guards may withhold bodies
only while preserving canonical corruption before an ordinary not-ready verdict.
A refused capture releases no business envelope. JavaScript retains authoritative decoding,
domain failure order, budgets, dependency recording and pending overlays. The
installed profile runs one implicit statement for each bounded named capture;
PGlite/full-artifact construction implements the same named operations through
its genuine short transaction. That construction must retain the original
trusted control-directory resolution ports, supplied by its genuine metadata
issuer or located-target owner. Resolve exact deployment/scope placement freshly
for each capture; never infer control authority from the target database or
substitute a stored authority row. Installed refusal never selects another profile.
Cancellation or an uncertain read discards evidence, preserves poisoning and
drains the actual driver work before its resource is released.

New storage and capture functions require the existing migration, installation
attestation/grant and maintenance inventories to move together. They change no
retained session, outcome, event, history or application-body format and require
no durable-data reset. The restricted installed control reader needs EXECUTE
only on the demanded bounded ownership unique-closure helper and SELECT on its
actual closure table, in addition to its existing definition/binding reads.
Grant and positively attest those exact permissions; keep target-only capture
and body functions denied on that control profile. Retire the displaced
`fx_observe_finite_storage_frontier` function through the guarded capture
migration and remove its grants and attestation inventory. Preserve historical
migrations and the still-used scope-observation owner. Remove displaced finite admission/relation branches that
have no genuine caller, callback exports/plumbing and duplicate ordinary storage
SQL after their named consumers migrate. Keep named ordinary/durable consumers
and fresh capacity-retirement observation; no compatibility wrapper is retained
for an unspecified consumer.

Prove both database construction profiles, real post-wait expiry/coverage,
installation/placement/fence/refusal ordering, immutable-anchor corruption,
membership/negative/page/unique/snapshot correctness, first-crossing byte bounds,
Application selection and insert ordering, cancellation/drain, exact cold/warm
replacement and complete native results/events. Then repeat the full quiet,
native 5/10 ms and 1/100 scaling gates. Client command consolidation does not
make nested server work free or establish the target latency in advance.

The frontier-function migration also protects the singular control schema-version
artifact table with the existing metadata invalidation trigger. It changes no
retained artifact content. Closed installation maintenance invalidates older
preparations through its existing incarnation and structural generation; the
migration does not update guarded runtime epoch rows while installation is closed.

The managed installed profile performs those fresh placement checks in its
original target transaction. Existing PGlite/uninstalled full-proof consumers
retain explicit fresh ordinary placement and artifact verification: they first
resolve a committed outcome on the original target, then accept current authority
only if the exact original locator/generation/fence still matches. They do not
reroute the pending graph. Installed failures never select that other profile.
Candidate construction selects an explicit installed or full-artifact-proof
profile; neither a missing configuration nor a caught reuse failure is permission
to weaken an installed consumer's checks.

Prove unused-unready admission versus demanded refusal, current binding and
placement changes, protected candidate-artifact mutation, genuine preparation
capacity/closure, exact anchor corruption, real PostgreSQL anchor/build waits,
post-wait expiry and coverage, outcome-first replay, unknown COMMIT, cancellation,
atomic native events and retained ordinary profiles. Then repeat the complete
quiet/native/scaling gates against the final connected implementation. Detached
ordinary activation retains initial renewal. The selected owned finite start
replaces its detached handoff through the admission contract above; it must not
introduce a renewal option flag or accept an old activated finite handle.

1. **Record the selected full contract.** The recovery choice is resolved; inventory owners,
   canonical metadata/maintenance writers and affected formats, and reconcile
   the accepted design before runtime changes. The contract above is the
   reviewable target; no helper experiment precedes it.
2. **Deliver the connected finite cutover.** Entry, one pending owner, operation
   close/freeze, current table closure, final transaction, retry/recovery,
   reservations and all existing private consumers migrate together. Workers
   own disjoint edits; root owns orchestration and Git. Preserve native code,
   migrate decisive tests, remove displaced finite paths, validate both database
   lanes, obtain both project reviews and commit one complete verified slice.
3. **Meet integrated acceptance.** Follow the selected
   [complete native reference](./26-native-business-baseline-preflight.md): at
   most 5/10 ms median/P95 paired excess for the complete matched root, charged
   once per root. The former mixed 100/200, 200/400 and 500/1,000 ms thresholds
   are historical intermediate milestones. Method comparisons remain diagnostic.
   Measure final-source quiet pairs with unchanged complete business results,
   stable tails and the declared sampling plan; architectural delivery and
   numerical acceptance remain separate.

Warm transaction structure targets one target-database entry, actual required
storage frontiers, and one final settlement. Charge control/preparation misses,
initial authentication, liveness and every fresh check explicitly; do not hide
them outside the request or count nested server work as free. The structural
target is not a measured SQL ceiling.

Overhead must scale with actual demands, consumed metadata, distinct touched
tables, final rows/keys/relations/events and compact operation receipts. Prove
no repeated complete-catalogue work as untouched schema grows or more operations
touch the same tables. Keep the 1/100 metadata matrix, complete ordered-catalogue
capacity and genuine late-activation/ABA witnesses. Native work may grow with
business calls; real maintenance may grow with affected keys/definitions.

Cold capacity acceptance includes the real logical preparation issuer and host
lease. At 512 ordered definitions, charge the complete manifest and definition
DTOs before issuing a usable catalog. A lease one byte below that actual payload
charge must refuse preparation, poison further use and release its reservation
and bytes. Closing a successful lease must invalidate the escaped catalog. The
513-definition reader and cold issuer must both refuse the definition bound.
These proofs do not replace the separate anchor and reservation byte limits.

Run PGlite and ordinary-role PostgreSQL for authority/installation, writer
serialization, snapshot and negative/range/page/unique/reference/relation OCC,
native constraint timing, rollback-only, retention/retirement, duplicate/fence,
precommit crash, unknown-COMMIT, cancellation and actual durable-profile regression
witnesses. Exercise real Worker Product, Payload access/hooks/nested calls, finite
workflow results/events and complete root retry. Run affected types/builds/source
guards/lint and both reviewers against the final owned checkpoint; fix and rerun
substantive changes. Stop owned runtime resources. No hosted/production or arbitrary
future-workflow readiness follows from these bounded proofs.

### Reuse Fixed Projection And Authenticated Original Evidence

Status: **implemented; numerical acceptance remains open.**
The [prepared capture comparison](../../packages/executor/benchmarks/core-performance/whole-mutation-cutover/prepared-storage-capture/README.md)
meets workflow latency gates but misses Product median/P95 and mixed Payload
median. SQL shape compilation already belongs to the lasting target; the actual
physical checkout only prepares/binds the existing shape. Complete Product CPU
sampling identifies repeated Drizzle field classification, capture mapping and
metadata handling. Sampling and instrumented awaits do not establish exclusive
CPU or the cause of Product tail spikes.

Deliver one connected reduction in immutable evidence reconstruction across
finite entry, actual storage captures and final settlement. Keep genuine fresh
acceptance at each existing authority cut. This changes private projection and
frozen-data contracts; it changes no durable format or named data disposition.

- **Entry acknowledgement:** replace whole-session `RETURNING` transport for
  reservation and post-preparation renewal with one actual complete-row SQL
  correlation verdict. Bind the owner-authored original row and changed fields
  once in a statement-local typed projection, compare the actual previous row,
  apply the update, and compare every actual resulting column with the expected
  result. Only a positive actual verdict may lend the authenticated projection.
  Preserve null/JSON/byte/date equality, exact scope/session/fence, before-trigger
  tampering refusal, post-wait time/liveness, final guard order and COMMIT ACK
  ownership. This is a compact transport of the existing complete proof, not
  permission to infer stored data from a planned write.
- **Capture mapping:** retain fixed SQL and parameter ownership. Compile the
  current scalar and one-level nested result slots once, and use pinned Drizzle's
  supported `customResultMapper` on the actual current physical session. Extract
  and check each genuine SQL expression's decoder once, invoke its actual receiver
  for fresh non-null values, and preserve encounter order and all-null nested
  objects. Restrict this private mapper to existing capture projections; do not
  copy a general Drizzle mapper or add a descriptor/codec layer. One documented
  positional construction assertion may retain the existing inferred query
  result type; it does not assert driver-value validity or replace the existing
  canonical header, build, ownership and body decoders. A malformed construction
  is a defect. Query failures retain their current physical/Effect boundaries.
- **Original predecessor evidence:** extend the existing root row entry with
  its actual original live revision; do not add another row registry. Native
  deferred row consumption and participant hydration retain the genuine revision
  and share its already charged canonical document allocation. Freeze projects
  only originals required by final writes. Missing, tombstone and coalesced-away
  rows retain their existing exact dependencies. An observed live original with
  missing or mismatched evidence fails closed; no finite reload fallback exists.
- **Fresh settlement continuity:** fold bounded demanded predecessor metadata,
  stored SHA and actual server body SHA into the existing current-head selection.
  Hash only demanded live bodies within the original bounded length. Compare
  identity, revision, schema/codec, creation time, lengths and digests at the
  existing predecessor-verification point, after metadata/graph/point/range/
  relation OCC and pre-write liveness. Then lend the original canonical document
  to the existing index/unique/relation lowering owner. Changed body bytes with
  unchanged stored SHA, changed SHA and oversized bodies must still refuse.
  Ordinary and durable profiles retain their genuine predecessor loader.

Root owns entry/roadmaps, assigned workers own disjoint capture and original-row/
settlement edits, and root owns validation and Git. Keep authority, claim, lease,
retention, serving/build lifecycle, protected metadata, lock order, rollback-only,
uncertain COMMIT and atomic publication behavior unchanged. Public APIs, new
framework capability, host pooling and activation remain outside this contract.

Validate actual PGlite and ordinary-role PostgreSQL mapping/date/byte/null behavior,
entry tampering and waiting, detached/counterfeit/cross-attempt originals,
point-conflict first-verdict ordering, damaged predecessor body/hash/length,
missing/tombstone and repeated-write lowering, unique/relation rollback, and native
result/event/recovery consumers. Verify bounded server hashing on both drivers.
Retire displaced finite mapping and predecessor reload calls in the same slice;
retain ordinary/durable owners by named profiles. Run affected types/lint, both
independent project reviews, then unchanged complete quiet/native/scaling gates.
No local transport or projection pass closes numerical acceptance.

### Implicit Capture Transport Admission

The implicit lane removes per-read server timeout configuration. Its physical
owner must therefore refuse a real node-postgres connection before starting work
unless the acquired connection supplies its genuine backend cancellation key and
the exact supported non-TLS cancellation configuration. Closing a TLS socket
does not prove that a statement waiting on a server lock stopped; the existing
driver deliberately cannot confirm authenticated cancellation over TLS. A local
deadline plus quarantine failure is insufficient to bound remote lock ownership.

This is an explicit private transport limit, not a new permission or a cached
authority check. The ordinary session-budget lane remains its existing owner;
there is no implicit fallback into that lane. Supported implicit reads retain
their exact cancellation, drain, client destruction and full-Cause behavior.
Unsupported TLS or missing cancellation identity refuses before callback/SQL,
releases the exact acquired resource, and lends no capture. Validate that refusal
and the genuine non-TLS interruption lane. TLS cancellation and hosted transport
activation remain deferred; these local proofs do not establish either.

Cancellation capability alone does not bound a lost CancelRequest or a terminated
executor. Require the selected finite runtime resource to start its actual
PostgreSQL connections with a positive `statement_timeout` no greater than
30 seconds, using the existing pool construction and protocol startup parameter.
Do not mutate an existing pool, create a second pool, or configure/reset each
read. The acquired connection must retain accepted startup evidence; missing,
zero or oversized settings refuse before implicit work. This breaks private
finite pool construction that relied on an unbounded server default. Migrate
only finite-selected runtime resources; control, administrative, ordinary and
durable selections retain their existing construction.
The finite PGlite process uses its supported PostgreSQL startup parameters for
the same setting and the same effective-setting guard. Do not infer admission
from a platform/version string or install a second acceptor body.

Startup configuration is not proof of a pooled session's current setting. The
existing named capture statement must check the actual effective server timeout
before installation/placement/authority/session/build waits or body access. A changed or unbounded
setting refuses within the same statement; there is no permission cache or extra
roundtrip. The timeout must already be armed when that statement starts; setting
it inside the helper cannot replace startup configuration. Keep cancellation and
full-Cause quarantine as the primary cleanup path, with the server bound covering
failed cancellation and process loss. Prove a real blocked backend releases its
locks within the bound after an intentionally failed cancellation, and that a
changed effective setting refuses before locks/body. No durable data or format
changes are required.

### Complete Finite Entry And Compact Metadata Acceptance

Status: **implemented connected replacement; complete numerical acceptance remains open.**
Immutable entry acknowledgement, fixed capture mapping and authenticated original
predecessor lending preserve their correctness boundaries, but the complete
request still fails Product median/P95 and Product/Payload median targets. The
displaced healthy entry retained twenty-one client statements, repeated complete-session
correlation and context reconstruction, and a large returned metadata observation
graph. The replacement uses six client statements and compares actual complete
canonical metadata bytes in the owning database before lending authenticated
originals. Final publication still reconstructs lowering context and submits
row/index/unique/search and terminal writes separately. The
[complete-entry comparison](../../packages/executor/benchmarks/core-performance/whole-mutation-cutover/complete-finite-entry/README.md)
retains the failed Product and Product/Payload latency gates and the failed native
positive-lookup overhead gate. These are remaining owner contracts to redesign;
the entry count does not close complete numerical acceptance.

Replace finite entry construction with three purpose-built database commands
inside its existing short transaction, targeting six client statements including
transaction control. Retain installed installation, placement, execution-authority
and sequencer acceptance as the first command, with its authentic client-side
acceptance complete before any session lock. The second command resolves the
request key first. Historical replay must still precede refusal of a newly supplied
source. For a new request it observes the complete Application and binding
head/activation/candidate/lane context and post-wait database time in the current
lock order. Existing preparation owners authenticate those observations.

The resulting provisional entry is private, inert and confined to that transaction.
It may prepare authenticated source bindings and the real metadata reservation;
it cannot execute, publish, renew independently or escape as a confirmed handle.
Keep its initial claim, lease, grant and hard-expiry bounds. Preparation that
outlives those bounds refuses without inserting an anchor. A fresh timestamp must
not revive an expired provisional owner.

The third command compares all expected metadata observations, accepts final
protected epochs and live deadlines, and inserts the complete anchor once. It
must check every actual stored column after insertion, including changes from
BEFORE and AFTER triggers. An INSERT RETURNING projection alone cannot prove an
AFTER-trigger modification. Keep complete byte, JSON, signed authority, argument,
grant, snapshot, reservation, owner/fence and deadline correlation. Return only
the compact genuine verdict and required scalar context. Acknowledged COMMIT is
still required before the existing owner confirms and issues the executable
attempt. Lost acknowledgement abandons local preparation and resolves the exact
durable outcome through the existing recovery owner.

This replaces the initial finite empty insertion, reservation update, continuation
update, their intermediate stored-row reads, and repeated context reconstruction.
Already-durable finite attempt replacement and retry remain the named consumers
of exact correlated anchor updates; they cannot fall back into initial entry or
issue a provisional owner. Ordinary and durable activation retain their named
contracts. The final finite anchor's
durable meaning and recovery identity remain unchanged; no named durable data is
deleted. Private provisional/context, observation and persistence seams may break;
migrate their executor, journal, preparation and framework consumers together.

Replace full returned metadata graphs with bounded owner-authored SQL comparisons.
Entry still validates its complete prepared projection; final settlement still
validates consumed keys against the original watermark and complete touched-table
writer semantics. Pass authentic expected values once, compare actual fields and
complete canonical bytes in Postgres, and return ordered typed verdicts. Digest
equality cannot replace full write-closure byte equality. Lend authentic immutable
originals only after positive actual comparison. Reuse the existing metadata
projection owner and transaction lifetime; add no permission/result cache, generic
SQL interpreter or second registry merely to reduce copying. Preserve missing/null
refusals, relevant-change/ABA behavior, first-failure order and current maintenance.

Drizzle's owned tables, columns, aliases and query methods remain the source of
runtime data identifiers and ordinary query construction. Derive fixed entry and
metadata SQL projections, parameters and identifiers from those schema owners
where practical. Installed procedural commands are a narrow persistence boundary
for ordered post-wait observation and complete post-trigger proof. Their migration
DDL is an explicit schema snapshot, checked against the current owner through
installation attestation; it must not become an independent handwritten runtime
schema or a generic SQL generation layer.

Assigned workers own disjoint finite-entry and metadata-owner edits; root owns
coordination, this contract, validation and Git. Dependent shared edits serialize.
Validate both database drivers with genuine complete-column/BEFORE/AFTER tampering,
natural preparation expiry, request-key replay before invalid source construction,
source defects/interruption with full Cause, scope contention and lock order,
delayed/lost COMMIT acknowledgement, cancellation after acknowledgement and exact
terminalization. Retain metadata corruption, binding B1/B2, late activation/ABA,
unused-unready versus demanded capability and ordered catalogue capacity proofs.
Exercise Product, Payload hooks/nested calls and finite workflow outcomes/events,
retry and uncertain publication. Remove displaced finite choreography in the same
cutover; run affected types, lint, guards and both final reviews. Re-run unchanged
quiet, matched-native and metadata-scaling gates. The healthy entry command target
is implemented and measured; neither it nor a passing local component establishes
the complete latency goal.

#### Ordered Completion And Typed Refusals

The final command must perform the actual complete metadata comparison before
acquiring the final protected-epoch locks. An unrelated scope can advance the
namespace epoch while this entry also has a missing metadata observation. Preserve
the earlier dependency-specific refusal, including its expected/current evidence,
before a changed epoch or its foreign NOWAIT failure. Reordering only returned
Boolean verdicts is insufficient if the epoch source still runs first.

Compose the existing metadata and final-guard owners in that order. The installed
path compares once, conditionally evaluates the existing bounded guard batch only
after accepted metadata, then checks original deadlines and performs complete
insertion and post-trigger proof. Keep namespace lock order, NOWAIT, original
epoch identities, transaction confinement and full Cause. The full-artifact
profile follows the same semantic order through its existing guard owner; it must
not duplicate a successful comparison merely to share the installed procedure.

The private completion submission/signature, installation attestation and runtime
grants may change together. Its metadata verdict is produced by an actual query
within this transaction, not a reusable admission flag or a new registry. No
stored anchor format, recovery identity, named durable data or framework business
contract changes. Remove the displaced internal comparison/parameter path rather
than retaining two completion protocols.

Expected lease-expiry and stable-authority refusals belong in pure Result helpers
with Effect consumers using their typed failure channel. Keep ordinary Promise
callers behind their existing conversion boundary. Prove pre-provisional expiry
after a real wait and relevant authority change without turning either refusal
into a defect. The natural preparation-expiry witness uses the authentic original
provisional deadline through an existing trusted test seam, proves no placeholder
row exists, then waits and asserts the exact expired refusal and no committed
effects. Add combined metadata/epoch-change and metadata/held-epoch witnesses for
the selected profiles, then rerun both reviews against the final replacement.

### Historical Selection And Original-Row Capture

Status: **implemented connected read replacement; numerical acceptance remains open.**
The frozen complete-entry baseline meets the matched negative unique-read overhead
gate but misses the positive gate. Its positive historical unique lookup read
membership and then entered a second complete captured demand to hydrate an
uncached original row. The replacement reuses general indexed selection's bounded
membership-plus-selected-rows demand without another capture procedure, registry
or framework database path. Recorded quiet
timings do not establish that this second command explains all positive excess.

Extend the existing private demand with the unique owner's at-most-one hydration
condition. Decode complete index evidence and reject multiple/wrong-table owners
before decoding or hydrating a row body. Retain negative membership, original
point dependencies, retained snapshot/revision and canonical key agreement,
missing/tombstone refusal, cached originals, pending overlays and identity/value
budgets. An original already retained by the working set is never replaced by a
new observation. One real submitted demand still freshly checks installation,
placement, authority, anchor, original claim/deadlines, protected epochs, demanded
readiness and retention. No accepted verdict becomes a cache.

The connected consistency correction covers Application's historical-ID lookup.
Its displaced outer EXISTS could retain a pre-wait statement snapshot even when
capture waited for authority or readiness. Preserve one client submission, but
perform the actual historical-row lookup in a fixed VOLATILE read operation
after accepted capture and post-wait liveness. Prove an exact generated identity
committed by a genuine writer during that wait is detected, including retained
and tombstoned history. First preserve the failing witness; do not treat this
source-derived gap as a measured latency cause.

Private demand/result and installed-read signatures may break. Migrate the
working-set, capture compiler, journal collision consumer and exact installation
attestation/grants together; remove the displaced two-demand unique path and
outer-snapshot lookup. Retain ordinary/durable read profiles for their real
consumers. Stored anchors, document/index history, recovery identities and named
durable data retain their meaning; no reset or deletion is required. Runtime
identifiers and ordinary construction derive from Drizzle's schema owners;
procedural migration DDL remains an exactly attested fixed schema snapshot.

Do not reuse an earlier capture timestamp as the first-write timestamp merely
to remove a command. The current framework sampling boundary remains unchanged
until an explicit owner contract justifies replacement. Preserve existing
VOLATILE row/index readers and post-wait serving-sequence observation; outer CTE
ordering alone cannot establish a fresh READ COMMITTED snapshot.

Validate positive/negative/duplicate-owner/wrong-key and missing/tombstone unique
cases, index-before-row corruption order, cached/pending originals, byte and
identity refusal, genuine post-wait collision and expiry, placement/epoch/anchor
refusal, historical Product behavior and connected mixed outcomes. Require both
PGlite and ordinary-role PostgreSQL, unchanged matched native and complete-graph
gates, affected types/lint/guards, both reviews and removal. This correction and
the remaining publication redesign form the connected acceptance work; a local
read improvement alone does not finish the finite replacement.

### Complete Finite Publication Submissions

Status: **implemented connected replacement; numerical acceptance remains open.**
The frozen complete-entry comparison recorded fifty-five Product publication
commands. Its seventeen initial acceptance/OCC observations are not a minimum:
the confirmed entry and frozen graph already supply authentic complete expected
data, while separate current reads reconstruct or return that data again. The
selected outcome replaces publication observation, materialization and terminal
submission topology together. The initial bounded Product design budget is
nineteen to twenty-three publication commands, including transaction control and
the outside outcome lookup. It is a hypothesis for implementation, not the
complete native-relative root acceptance gate. The former complete 100/200 ms
threshold remains an intermediate milestone rather than a completion target.

Keep outside outcome lookup before new graph/definition construction and installed
installation/placement/authority acceptance before anchor locks. Replace the
finite anchor lock/read with one fixed ordered operation: lock stable identity,
observe outcome in a fresh post-wait snapshot, return replay first, then compare
actual complete immutable anchor/session data and sample fresh database time.
Prepare expectation through the authentic existing anchor and confirmed-entry
owners. Return actual mutable lifecycle, claim/fence, deadlines and update fields;
lend the original snapshot/reservation/session only after complete positive SQL
comparison. Compare all real canonical bytes, hashes, JSON/null distinctions and
immutable columns, not only digests or a returned length. Keep authority, claim,
session, retention and liveness refusal order. Cold recovery and already-durable
replacement retain their genuine stored-byte decoding obligations.

Compose consumed dependencies, Application write closures, current ownership
observations and selected source closures into a bounded owner-prepared publication
observation. Return named ordered actual verdicts/data, consumed through the
existing owners in their original order. A consumed mismatch precedes Application
closure refusal; ownership precedes source one; source-one closure/document/index
validation precedes source two. Later invalid tuple preparation remains deferred
to its original position. No aggregate approval Boolean, cached verdict or eager
later document validation replaces this contract. Rich ownership-history profiles
retain their actual bounded canonical/history/successor captures; the simple
current-status case does not justify removing those obligations.

Keep separate root unique and range proof decoders. Keep intrinsic build lock and
TypeScript authentication before acquiring developer locks: a later held developer
lock must not replace an earlier intrinsic corruption refusal. Developer lock and
fresh predecessor-head observation may share one fixed submission, consuming head
output only after developer authentication. Use separate internal VOLATILE commands
for outcome and heads after actual waits; static CTE ordering is insufficient.

Finite publication opens its existing protected-metadata final-guard scope before
installed acceptance. The accepting authority owner registers both actual target
and control epoch snapshots through the existing preparation and guard owner,
after admission, placement and snapshot identity checks. A transaction-local
preparation is issued only from the recognized admitted installation and its
actual fresh managed snapshot. This adds no healthy SQL and creates no alternate
permission registry. Retained source preparations keep their original epoch
checks; a conflicting registered generation refuses rather than overwrites them.
Every replay, failure, interruption and settled exit closes the existing scope.

This mandatory pair protection permits the installed finite materializer to read
current head, selected activation and selected schema in one coherent snapshot,
then consume genuine owner decoders in head/activation/schema order without
additional row locks. The metadata writer inventory is protected by the exact
epoch invalidation triggers and installation maintenance interlock, and final
NOWAIT guards reject concurrent changes and ABA before acknowledgement. An
unrelated activation may validly change the current head before acceptance; do
not compare it to the original entry head or manufacture a checked activation
from retained pins. Full-artifact and PGlite profiles retain their actual locking
context and complete proofs because their owner pools cannot mint installed
protection. They share the same decoders and domain write implementation.

Replace lowering reconstruction and scalar writes at the existing materialization
owners. Derive bounded fixed domain tuples for row revisions/current pointers,
membership transitions, unique releases/claims, coverage and search through the
genuine definitions, canonical codecs and original/final document planners. These
are domain data, never SQL instructions or an arbitrary CRUD interpreter. Capture
required current context through existing owners without rebuilding a catalogue.
Sample the second pre-write database time at the beginning of the first lowering
observation and reject actual expiry before subsequent lowering work. Earlier
entry/publication time cannot substitute for that check.

Apply bounded tuples beside their actual predecessor/membership/parent/unique
proofs. Preserve creation time and canonical key/byte agreement, missing/tombstone
refusal, all selected unique releases before claims, complete post-trigger write
proof, exact fences and actual search-build predicates. Later operations must see
earlier writes through ordered procedural statements. One data-modifying CTE cannot
replace those visibility rules. Preserve existing per-page bounds; the workflow's
forty-two index revisions legitimately require multiple bounded pages. Coverage
completes only after all pages, with failures rolling the entire transaction back.

The private unique batch contract changes with this replacement. An action with
genuine `previous` ownership authorizes that selected owner's release; the batch
verifies all selected previous owners and releases them before claiming its final
keys. A swap between those selected owners now succeeds atomically. The former
scalar choreography's rejection of that swap is displaced, not preserved as a
compatibility path. A claim-only action with `previous: null` grants no release
of an occupied destination. Its claim can use a key genuinely released by another
authenticated selected action in the same batch. A batch containing only claims
against occupied destinations still fails with the existing unique-conflict
error, leaving the entire prestate unchanged. Migrate the shared batch callers
and their swap, mixed-handoff and collision proofs together; canonical key
agreement, parent identity and complete stored-owner verification remain mandatory.

For a complete bounded append or apply input, the last page also verifies every
expected tuple owned by that invocation after its last write. The fixed procedure
receives those already prepared domain expectations in the same submission; no
additional client command or transaction-local SQL carrier is introduced. This
catches a later page's trigger changing an earlier page of the same input. Keep
actual row/index/unique bounds and the PostgreSQL parameter ceiling explicit.
Unique postconditions include negative ownership, not only old-slot absence and
positive final claims. Retain the authentic identity of every selected owner
expected to have no final claim, including release-only and omitted mutations.
The final page proves complete absence for those scope/constraint/locale/table/row
identities beside its existing exact claim and released-slot proofs. A trigger
that recreates a released owner under another valid canonical key, or creates a
claim for an omitted owner, must abort the real transaction even when the caller
catches the typed corruption refusal. These bounded identities belong to the
same fixed procedure and invocation lifetime; no dummy key, expected-row SQL
registry or second engine supplies this proof.
Coverage retains the fixed procedure's exact expected stored-row projection after
its actual full-row comparison. Its prior-page proof stays local to the bounded
invocation and carries the existing fence identities. Reconstructing timestamps
from JavaScript Dates would lose PostgreSQL sub-millisecond precision; final-page
comparison therefore uses the same database projection of every actual row.
This is data for the existing write proof, not a new authority or permission cache.
Scalar calls supply one tuple. Streamed callers with independent bounded append
invocations retain their named page lifetime and proof scope; this is not a claim
of global verification across unrelated domain writers or privileged DDL.

The shared private append/apply surface now has an explicit complete-input
ceiling of 512 row revisions, 4,096 membership revisions and 512 unique mutations.
Complete row input also has a 64 MiB canonical-document byte ceiling, checked
before its first page. This shared storage resource bound preserves the existing
finite canonical-evidence ceiling, ordinary 4 MiB logical batches and individual
canonical document limits; it confers no finite-session authority. The largest
membership proof uses 41,024 parameters, below PostgreSQL's 65,535 ceiling.
Its former aggregate-unbounded signature breaks; existing finite materialization
keeps its separate 128-row protocol limit. Ordinary/durable transaction owners
already admit installation before their business locks. The finite full-artifact
publisher acquires that existing full proof at transaction start using its
authenticated target locator, checks an existing admission against the same
target schema, and closes it on every exit. Raw test callers migrate to the real
transaction owner; materialization does not add a late admission or search-path
fallback. No stored history, recovery identity or named durable data changes.

Each profile retains one actual clock and installation lifetime. Full-artifact
clock locking already issues the exact writer observation, so publication does
not open it again. Installed acceptance lends its authenticated observation and
publication opens the corresponding clock scope once. The installed transaction
runner retains admission through its mandatory post-callback acceptance check
and closes it in its own finalizer. Publication closes its local clock and epoch
guard scopes on every exit; its full-artifact admission closes locally. This
preserves the outer settlement authority and complete failure cleanup without a
second scope or premature revocation of the outer runner's proof.

The final absent-owner proof uses one fixed owner composite containing the five
actual scope/constraint/locale/table/row columns and a parallel original-ordinal
array, bounded by the same 512 unique mutations. It extends the existing unique
procedure signature; the conservative complete binding ceiling is 11,264. A
nonempty invocation containing only omitted mutations uses that same procedure
for its absence proof, with no write tuples. Empty input performs no SQL. Update
the private type/signature, exact installation attestation and grants together;
no authoritative row table, stored history or recovery format changes.

Expected database application refusals use a private named SQLSTATE and strict
domain detail decoded at the narrow driver boundary into the existing typed error.
The SQL failure aborts the real transaction, including earlier pages, even if a
borrowed caller catches the library error. Successful submissions alone return
actual write proofs. Malformed or unrelated driver errors remain persistence
failures with their full Cause. Preserve the physical owner's actual COMMIT
command-tag check: an aborted transaction's ROLLBACK response cannot acknowledge
publication. No new savepoint lifetime or alternate recovery owner is introduced.

Submit fixed durable prefix facts, events/deliveries, outcome/wake and the finite
session transition together where they share a real bounded final contribution.
The complete bounded prefix verifies all its expected stored families after the
last outcome, wake and session write. Streamed prefixes use the same fixed
header, page and final primitives, retaining page proofs for facts no longer
held by their actual paged lifetime and final proofs for the retained terminal
families. Their named consumer and removal gate remain explicit; introducing a
second write engine or unbounded expected-row carrier is not a cutover shortcut.
The durable Application owner retains its journal/lease/session settlement, CMS
retains preference-deletion facts, and Commerce retains initialization records.
When those owners write after the prefix, they invoke its same stored-family
proof after their final lifecycle write and before clock advancement. The proof
retains the original bounded contribution once; streamed Commerce retains only
its terminal/header expectations and declared page proof scope. These checks do
not replace the later writers' own domain invariants or merge their lifecycles.
Retain the existing strong-reference TypeScript owner between completed fact prefix
and clock advancement; it authenticates bindings and probes actual final state,
including streamed contributions. Do not add a procedural reference interpreter.
Compose clock advancement and final protected-epoch guards only while preserving
clock-before-guard order and complete rollback on refusal. Require acknowledged
COMMIT and retain the current cancellation/drain/uncertain-decision bridge.

The proposed command budget is for the healthy profile without a transaction-step
callback. Existing genuine callbacks can act between durable prefix stages or
clock advancement and final guards. Preserve those declared boundaries through
the same fixed write primitives: do not delay all callbacks until a composed
submission is complete. A hooked call can therefore require additional submissions
without becoming a second acceptance or write engine. Inventory real callback
consumers and retain their actual behavior; observation-only SQL/phase recording
does not itself create an effectful transaction-step boundary.

| Contract or owner | Disposition and cutover |
| --- | --- |
| Finite publication lock/read and returned anchor graph | Replace with authentic expected immutable data and actual compact mutable observation. Migrate finite publisher; retain cold recovery and named replacement readers. |
| Metadata/source/ownership observation choreography | Replace bounded submission composition, retaining current issuer, canonical policy, ordered decoder and richer-history duties. |
| Materialization row/index/unique/search scalar application | Replace at the existing shared owners; migrate logical-document, finite and paged framework callers so there is one write implementation. Distinct ordinary/durable session lifecycles remain. |
| Private unique batch swap behavior | Replace scalar-order conflict with atomic release of genuinely selected previous owners before final claims, including mixed handoffs. Retain occupied-destination refusal without a genuine selected release and prove exact final claims plus complete absent owners; stored key/history formats do not change. |
| Terminal scalar prefix/session writes | Replace bounded complete contribution submission. Retain streamed prefix owner for its actual paged contribution lifetime until it is migrated through the same primitives. |
| Private procedures, parameter/results and installation | Replace coherently through exactly attested fixed operations, grants and migration. Runtime identifiers derive from current Drizzle tables/columns/builders. |
| Stored anchors, request identity, committed history/outcomes/events | Retain their meanings and cold recovery; no named durable data reset, dual writes or deletion is required. |

Assigned observation/terminal and materialization workers own disjoint runtime
edits. Shared installation, migration journal and dependent exports serialize with
the historical-read worker; root owns preflight, measurements, final validation,
both reviews and Git. Remove displaced callers/exports/tests/fixtures within the
connected replacement, with meaningful proofs moved to the current owners.

Require genuine PGlite and ordinary-role PostgreSQL outcome-after-wait, complete
anchor byte/JSON/null tampering, metadata ABA/full-byte mismatch, consumed versus
ownership/source refusal, source-one document versus source-two mismatch, intrinsic
corruption versus held developer lock, fresh head visibility, conflict versus
pre-write expiry, unique swaps/collisions, missing/tombstone parents, late write and
coverage rollback, BEFORE/AFTER tampering, final references and protected epochs.
Retain connected native framework outcomes/events/hooks, full Cause/cancellation,
uncertain COMMIT and replay. Types, lint, source guards, both final reviews,
unchanged native/scaling/capacity and complete quiet gates remain completion
requirements. Fewer submissions alone cannot finish this work.

### Immutable Preparation And Owned Evidence Through Execution

Status: **implemented connected correction; numerical acceptance remains unmet.**
The [publication-domain comparison](../../packages/executor/benchmarks/core-performance/whole-mutation-cutover/publication-domain/README.md)
met the former mixed Payload and workflow milestones. Product met its former
P95 milestone but missed its median milestone. Those absolute thresholds no
longer define completion. The complete native-relative root gates remain unmet;
method diagnostics do not substitute for complete-root comparison. The subsequent
iteration and method diagnostic demonstrate no accepted performance improvement.
Benchmark harness changes during the iteration prevent a controlled final-source
acceptance claim. These results do not establish exclusive CPU attribution. The
remaining metadata-scaling gates must use the final runtime.

Current source rebuilds immutable native repository/model wiring and default
read projections inside operation binding. The core constructs and detaches
operation activity before constructing it again at close, reconstructs a prepared
write-closure comparison when consuming it, and repeatedly detaches or reconstructs
canonical final data across the private freeze and publisher boundary. Application
selection readers also copy full prepared schema projections where a caller needs
only an authenticated subset. These are source-confirmed duplicate preparations,
not measured explanations for the entire remaining latency gap.

Correct their existing owners together. Native module preparation may retain
immutable model layout, generated classes and query plans, while every operation
still owns its repositories, persistence/event binding, manager tokens, Promise
owner and native service instance. Never retain a request context or globally
rebind a mutable service. Keep descriptor validation, native error timing,
projection policy and complete returned relations at their current boundaries.

The working-set and frozen-attempt owners may retain their genuinely issued
canonical evidence through the existing private lifetime. Detach at actual foreign
or externally observable boundaries and validate full values/bytes when accepting
foreign evidence. Structural TypeScript types alone cannot authorize bypassing
canonical checks. No caller-provided object becomes trusted by shape. Preserve
sticky failure, operation-close revocation, exact dependency provenance, genuine
admission identity, final conflict/constraint checks and original refusal order.
Retain the prepared ordered closure plan within its existing consuming capability;
later invalid preparation must still fail at its original ordered position.

Application construction exposes narrow authenticated internal projections from
its existing issuer instead of returning the complete schema to every internal
caller. Preserve database identity, bounded preparation charging/disposal, fresh
head/epoch and installed authority acceptance, and detached data at the real
execution boundary. This introduces no new registry, verdict cache, storage
capture engine, transaction, host pool or permission lifetime.

The affected private construction and freeze interfaces may break together with
their actual callers. Replace and remove displaced per-call preparation and
duplicate private graph reconstruction in the same correction. Stored anchors,
history, journal/recovery formats, framework lifecycle and public API status retain
their meanings; no durable reset is required. Unrelated framework expansion and
host lifecycle changes remain outside scope.

The implemented native construction factory captures model layout once and binds
actual admitted repositories to fresh services. Prepared default Product projections
have immutable exposed field sets and arrays; custom selection/population retains
its actual compiler. Operation activity invalidates on real work/observations and
root changes, and close clears its retained cache. The frozen registry detaches at
ingress; publication borrows only its private owned graph and detaches returned
results. Full canonical row/result acceptance remains because their protocol types
alone do not establish issuer provenance. Final row intents retain their actual
fields without a redundant embedded canonical document.

Application runtime activation consumes narrow pins, while finite control lends
its genuinely prepared schema from the existing issuer. Existing entry state binds
the exact projection, original Application preparation/selection and open lifetime
at the former accepting boundary. The full detached inspection getter remains for
the actual test-host syscall-validator and tampering consumers; production activation
callers no longer use it. That inspection boundary retains full schema and byte
isolation rather than treating a caller-provided projection as authority.

Disjoint assigned workers own native preparation, working-set/frozen publication
evidence, and Application issuer projections. Root owns connected planning,
dependent edits, validation, measurements, both reviews and Git. Require focused
native result/error/context isolation, escaped-value tampering, sticky close,
ordered closure refusal and genuine preparation lifetime proofs, connected
Application/Product/Payload/workflow regression, affected types/lint/source
guards, both reviews, and unchanged quiet/native/scaling/capacity acceptance.
An individual local improvement does not complete this correction or authorize
a known-failing commit.

### Prepared Database, Logical Attempt And Authoritative Acceptance

Status: **pure prepared-database reuse and ordered shared materialization are
implemented; frozen settlement planning and domain-owned current acceptance
remain selected for replacement.** The owner reaffirms that clean core design and
complete native-relative results take priority over compatibility. Further small
preparation or command-count changes do not constitute the selected deliverable.

Replace the preparation, execution and settlement topology together at their
actual owners. A trusted prepared database owns reusable Drizzle statement
topology, codecs and immutable definition plans for its authentic database,
installation and namespace. An admitted logical attempt owns the genuine entry,
snapshot, claim, consumed dependencies, pending graph, operation receipts and
bounded lifetime. A single authoritative settlement owner consumes that graph,
accepts current authority and dependencies, applies actual final effects and
publishes the durable outcome atomically. Keep Application OCC and framework
relational profiles explicit; this is not a universal transaction API.

Pure compiled structure must not retain a live verdict, request capability,
manager, event subscriber or mutable service. Bind genuine current preparations
and fresh attempt parameters to that structure. Investigate the actual lifetime
of located-target and statement construction before choosing its reuse owner;
a nominally prepared helper rebuilt by every caller is not lasting preparation.
Remove displaced construction and adapters with their consumers rather than
adding another wrapper around them. Keep runtime hosts as adapters; Worker
pooling and broader compute changes remain outside this scope.

Reads consume the attempt's immutable selection and record exact data/metadata
dependencies through the existing historical storage owners. Preserve actual
negative observations, pending overlays, full returned relations, byte/identity
bounds and ordered failures. Actual Product capture evidence contains distinct
demands, including child reads that require preceding parent/pivot results.
Grouping is allowed only when the real owner already knows the exact selected
demands together and can retain their original ordered acceptance and failure
behavior; no speculative prefetch or extra OCC dependency is selected.

Live installation, placement, scope revocation, claim/deadline, retained-floor and
demanded build/coverage checks remain required before exposing a storage body.
The current installation interlock is transaction-local, and maintenance can
run between demands. Final OCC cannot retroactively repair unauthorized access,
pruned history or a false-empty index result. Convex's pinned registry and final
OCC support immutable selection reuse; they do not supply Flarex's separate
persisted-claim, maintenance and placement guarantees. Any replacement of those
guarantees requires an explicit writer, lifetime and withdrawal protocol; it is
not authorized by calling a cached observation a transaction snapshot.

The executor already submits one genuine frozen attempt to the persistence
publisher. Preserve that direct boundary; the replacement belongs inside the
publisher and shared materializer, where final observations and effects are
repeatedly constructed and correlated. Compose existing
metadata OCC, data dependencies, write-closure selection, materialization,
reference/coverage proof, outcome/events, clock and final guards in their correct
order. Reuse one write implementation for retained ordinary/durable profiles;
their distinct entry/recovery contracts remain. Genuine effectful transaction
callbacks retain their declared boundaries through the same primitives. Never
introduce a SQL carrier, second CRUD engine, second settlement authority or
weaker full-byte comparison to reduce submissions. Database transactions still
end before framework callbacks or untrusted execution resume.

| Current contract | Replacement and affected consumers |
| --- | --- |
| Located target and finite capture construction | Separate genuine database-owned compiled structure from fresh bindings. Migrate actual activation, executor and physical-driver callers; remove duplicated construction. |
| Borrowed Application/native operation assembly | Bind the one admitted attempt and fresh framework state directly. Preserve native service, Local API, hook and workflow order. |
| Historical demand acceptance | Keep one current owner of live acceptance and storage exposure; replace redundant preparation and transport without caching permission. |
| Finite publisher/domain observation choreography | Replace with one bounded authoritative acceptance surface composed from existing semantic owners. Migrate recovery and retained ordinary/durable callers where shared primitives change. |
| Durable anchors/history/outcomes and private installation contracts | Preserve data meanings until a concrete replacement needs a format/schema break. Inventory that break and its migration/drain policy before code; no implicit reset or silent deletion. |

Deliver one connected private graph through these boundaries, then migrate all
affected existing consumers and remove displaced APIs, exports, dependencies,
tests and fixtures. Preserve genuine issuer/database/lifetime isolation,
maintenance and post-wait revocation/expiry, demanded serving/retention, original
corruption refusal, metadata ABA, constraints, atomic events, cancellation,
rollback-only, unknown COMMIT resolution and replay. Require both database lanes,
affected type/lint/source checks and both final reviews. Complete-root matched
quiet excess, stable tails, metadata scaling and cold capacity remain final
gates; SQL counts and sampled stacks guide implementation rather than define
success. Native identifiers and table/column references derive from Drizzle
owners wherever possible, including fixed installed SQL generation.

#### Concrete Settlement Composition

The actual owner chain is finite publication, accepted point lowering, shared
Application materialization and complete publication prefix. Replace submission
choreography along that chain. Keep the fixed row, index, unique, search,
coverage and prefix write functions as the single implementation used by finite
and retained ordinary/durable callers; a compositor must invoke those primitives
and preserve their complete post-trigger proofs and first refusal. Domain tuples
derive from their existing Drizzle columns. Neither arbitrary SQL nor caller
selection of tables or operation expressions enters the accepting contract.

Prepare immutable final obligations from the authentic frozen graph: original
and new keys, row revisions, relation transitions, publication tuples and
validation plans. Retain each pure failure at its existing acceptance position.
Outcome replay must still precede new preparation refusal, and earlier current
authority or source-one refusal must still precede a later source's invalid
data. Gathering evidence together does not permit a later SQL error to preempt
an earlier ordered acceptor.

The small-submission design retains two concrete fresh JavaScript boundaries
until an equivalent replacement is established:

- Candidate acceptance reads the current head and predecessor progress before
  its validator can derive a canonical failure-frame transition.
- Strong-reference admission uses the actual completed fact prefix and current
  binding to select and validate final affected state. Finite input row intents
  cannot replace that shared contract, including paged Commerce publication.

Current source closure acceptance authenticates the validator and located
definitions already selected by the genuine participant issuer. It does not
construct a new validator from final SQL: `prepareFiniteOperationCommitObservation`
retains `selected.validateDocument` while accepting current index and unique
selection. Pure document validation can therefore be prepared from that authentic
selection. Its retained refusal is consumed only after current closure acceptance
and before the next source, preserving the existing ordered acceptance boundary.

Genuine awaited transaction callbacks retain their exact observation and pause
positions through the same primitives. Pure diagnostic recording does not create
another execution profile. Post-wait time/liveness precedes writes; complete
prefix and reference admission precede clock/final guards; installation admission
survives the runner's post-callback check. Unknown COMMIT resolves through the
original target and existing durable outcome owner before any rerun.

This selects a staged accepting implementation, not a proven literal one-SQL
settlement or an invented submission budget. Changed installed functions require
their actual structural installation, integrity and maintenance inventory to
move with the consumers. Existing history, anchors and outcome meanings remain;
a changed durable encoding still requires its explicit migration/drain policy.

The selected materialization cutover adds a fixed accepting compositor at the
shared Application materializer. Named inputs carry prepared row and index
tuples, genuine unique transitions, coverage obligations and search publications.
It invokes the existing domain write/proof routines in their current order;
bounded server pages preserve complete current-input and earlier-page proofs.
Canonical document, key and search planning remain with their existing
TypeScript owners. Intrinsic validation reset moves with its actual writer.
Coverage deferred by paged Commerce remains deferred until its existing
all-pages completion boundary.

Preparation retains each owner's genuine Result until its original execution
stage. The materializer submits the maximal contiguous successfully prepared
block, then reports a retained failure at its original position. Genuine awaited
callbacks split those same operations at their current barriers. No TypeScript
error, generic stage-stop packet, SQL instruction or alternate write engine is
transported. Physical parameter capacity may split successful blocks; it does
not introduce a new global refusal or reduce a supported multi-page command's
capacity. Existing row, index, unique and search limits remain at their owning
operation/page, including their original failure positions.

Finite search definition merging also has an existing ordered refusal: conflicting
source identities fail after rows, indexes, unique transitions and coverage, before
search maintenance. Its genuine pure Result travels with the search contribution
and is consumed only at that original stage. The shared materializer retains the
search owner's tagged failure; finite and ordinary callers keep their existing
distinct error projections at their own boundary.

Unique admission is a required correction at the unique owner. Its fresh
live-parent and locked slot/owner reads occur after preceding row/index writes.
Do not prepare those observations earlier: a newly inserted parent must already
exist, and actual destination refusal precedes previous-owner mismatch. A fixed
unique mutation packet carries actual owner identity and complete nullable
previous/next tuples in exact-length parallel arrays; the input position is its
original ordinal. Its installed admission routine validates current complete
stored values before delegating the existing release/claim/proof implementation.
All genuine releases precede claims; absent-owner proofs and full key bytes
remain. Ordinary and maintenance callers consume this same admission owner,
removing displaced TypeScript reads with their consumers.

Required parent and coverage lookup keys use equality over their authenticated,
non-null pins so shared physical families retain indexed lookups. Null-safe
comparison remains with nullable values and complete stored proofs. Selected
stored unique values retain their full scalar validation before byte comparison;
a malformed selected parent tombstone flag fails as corruption. Coverage uses
the same existing typed pin builders as the compositor, and statement preparation
occurs outside the foreign driver failure boundary.

This replaces one private failure behavior: parent, destination and previous-owner
admission refusals now originate in SQL and abort the borrowed transaction.
Their existing typed failure families and precedence remain. The current
materializer, unique definition-gap reconciliation/backfill and framework
finalizers already abort their outer transaction on these failures; none offers
catch-and-continue recovery inside that same transaction. Direct callers must
rollback and begin a new transaction before retrying. No savepoint, fallback
admission path, persisted failure-format migration or durable-data reset is added.

The installed surface uses the existing fixed composites and three named
functions, rather than adding another durable tuple format:

- `fx_apply_app_unique_mutations(fx_app_unique_owner[],
  fx_app_unique_write[], fx_app_unique_write[])` accepts the exact ordered
  owner, previous and next arrays. Its current admission precedes delegation to
  the existing unique write/proof routine. Owner-only no-op mutations retain
  their original validation; maximum invocation size remains 512.
- `fx_reset_app_index_validation(fx_app_index_coverage[])` owns the actual
  intrinsic validation reset before terminal coverage publication.
- `fx_apply_app_materialization` accepts fixed row tuples and row page counts;
  index tuples with predecessor and historical flags; the three unique arrays;
  intrinsic validation, index coverage and unique coverage pins; commit sequence;
  and search scope, exact definition identities, source/mode, selected-row counts
  and IDs, and text/JSON entry counts and tuples. Exact-length and segmentation
  checks authenticate each search packet. These are fixed stage inputs, with no
  caller-supplied operation selector. Empty arrays omit only stages with no
  genuine obligations. Deferred pages omit terminal coverage and retain their
  existing complete-batch closure.

The compositor catches only a recognized `FX001` proof from the fixed primitive
currently invoked. Its own strict refusal envelope carries the domain family,
actual page offset and unchanged primitive detail. The TypeScript owner decodes
both envelopes and authenticates local-write and complete-input verification
ordinals against that exact prepared operation. Other database failures propagate
unchanged. Unique admission has a separate strict current-state refusal containing
its authentic mutation ordinal and parent, stored-value, destination or previous
stage. These are database proof results, not transported JavaScript failures.

An unrecognized database failure belongs to the combined accepting command;
Postgres exception context does not authenticate a failed domain. The driver
retains that complete foreign cause in its narrow materialization persistence
error. Settlement reports the private `applyApplicationMaterialization` SQL
operation, replacing an inaccurate single-domain attribution for this combined
submission. Expected native proof refusals keep their original domain conversion.
This changes diagnostic error attribution, with no persisted error-format or
business-data migration.

The three new descriptors and the corrected existing coverage descriptor own
exact signatures, argument/output names, volatility,
invoker security, search path and full body/type attestation through the existing
domain installation owner. Function returns carry exact accepted effect counts;
the caller checks them against its prepared obligations. The compositor also
returns the actual number of delegated search builds advanced, so diagnostics
retain real effects rather than infer them from input definitions. The combined
database operation has one `materializationWrites` diagnostic phase; individual
domain counts remain, without overlapping exclusive write-phase claims.

Private accepting functions change structural
installation integrity, not durable row/history/anchor/outcome meanings. Their
structural migration follows 0133 and must move the canonical domain descriptor,
full-artifact and installed attestation, exact function/type grants, read-role
exclusion and maintenance interlock together. Existing descriptor consumers are
the scope installation, installation lifecycle and Postgres maintenance owners;
do not create another registry. No durable reset or data deletion is selected.
Shared search and unique-coverage preparation, retained ordinary/paged callers
and finite publication migrate in the same connected cutover. Existing failure,
trigger, handoff, coverage and final-reference proofs remain completion gates.

### Frozen Settlement Planning And Domain Acceptance

Status: **canonical preparation and index/unique acceptance implemented and
connected correctness verified for the selected consumers; coverage eligibility
replacement and numerical acceptance remain open.** The
[frozen settlement evidence](../../packages/executor/benchmarks/core-performance/whole-mutation-cutover/frozen-settlement/README.md)
retains the measured cost and its unmatched-native limits. The prepared SQL and
materialization compositor do not finish the
redesign. Replace the publisher/materializer contract that returns fresh state
to JavaScript to reconstruct already selected original-to-final changes.

The existing frozen attempt and genuine participant issuers supply original
documents, final values, exact observations, immutable definitions, permissions,
receipts and events. The persistence planner prepares canonical previous/final
keys, relation transitions, row/search content and publication obligations once
from that evidence. Expected pure failures retain their Result; an owning
preparation boundary retains unexpected defects in the complete Exit/Cause.
They are consumed at their original acceptance positions. Cancellation retains
its scoped cleanup and does not authorize further publication. This is a private
preparation owned by the existing frozen graph and
publisher, not another mutable working set or registry. It carries no current
permission, readiness, coverage or commit verdict and holds no live transaction.

The accepting transaction owns current decisions. Its installed domain operations
validate actual authority, metadata and data dependencies, original predecessor
agreement, selected build state, membership, unique owners, relation targets and
coverage. They choose the same repair, insertion, deletion, no-op or refusal
branches and invoke the existing write/proof primitives. Commit sequence,
publication time and current maintenance fences derive from the accepted
transaction rather than from fabricated final inputs.

Sequence-free canonical obligations are distinct from existing prepared-write
objects that require an allocated commit sequence or current membership issuer.
Those objects bind only after actual acceptance. Reuse the existing transaction,
mutation-epoch and clock-bound membership evidence issuer for native selected
transitions. The actual emitted-action ceiling remains at the ordered-index
owner; potential previous/final key positions do not establish that count.
Current build decoding verifies the actual joined typed obligation against its
opening pins, selected requirement and coherent current activation. Canonical
head and activation bytes retain their existing owners; SQL JSON equivalence
cannot replace those proofs. Such current evidence is an explicit acceptance
boundary rather than a reason to reconstruct original business content again.

Two installed accepting functions make this boundary explicit:

- `fx_accept_app_index_transitions` takes the exact scope, parallel arrays of
  definition/access-kind/table/codec/specification identities, row IDs, canonical
  previous/final keys and digests, observed row revisions and current build
  fences, plus the existing emitted-action maximum. It proves all selected
  current memberships before choosing branches, returns only fixed pair/key
  ordinals, live/tombstone kinds and current predecessor evidence, and finishes
  with the actual action count. The existing membership issuer binds those
  selected results to the protected transaction and write epoch.
  Access kind comes from the genuine immutable located definition. Intrinsic
  creation-time transitions retain their original later acceptance position:
  initial live rows require no existing membership, including tombstones;
  enabled/building update, repair and deletion rules remain their intrinsic
  rules. A shared fixed owner does not merge intrinsic and developer semantics
  or move intrinsic acceptance ahead of candidate and coverage decisions.
- `fx_accept_app_unique_owners(fx_app_unique_owner[], bytea[], bigint[])`
  proves the complete selected stored owner and canonical previous claim before
  candidate acceptance. It does not admit destinations or parent rows; the
  existing later unique mutator still reads those after provisional row/index
  writes, with destination refusal before previous-owner refusal.

An issued finite deletion has a present observation and matching original live
revision, including its genuine creation time. Deleting an absent document is
refused by the working-set owner; an insert followed by delete coalesces to no
material row. Ordinary durable planning likewise removes never-visible deletes
and rejects tombstone dependencies. Intrinsic preparation uses this evidence
without a null-key fallback or invented timestamp. Ordinary durable acquisition
still reads its actual current live head at its existing predecessor boundary.

The functions retain exact descriptor, body, security, search-path and overload
attestation through the existing installation owner. Migration 0135 installs
these private functions without changing durable business formats. Ordinary
Application, finite framework settlement and recovery consumers migrate together.
Native expected refusals abort the real transaction and retain their owning
typed domain conversion; an unrecognized foreign failure retains its full cause.

The inner Effect-to-Promise bridge must retain that same outcome contract. A
single typed failure may keep its existing scalar Result projection; combined
failure, defect and interruption outcomes cross the Promise callback as their
actual Effect Cause and re-enter the owning Effect adapter before scalar error
classification. `Effect.result` cannot project a complete retained Cause. Correct
finite publication, ordinary settlement/recovery, logical materialization and
session activation re-entry together; keep the existing located transaction and
full-Cause settlement owners. Do not introduce a sentinel, second transaction,
new recovery authority or public/durable error format. Native Promise append
consumers preserve the rejection for their real outer owner.

Runtime-boundary source guards attest the actual Exit bridge and shared
transaction settlement owner. Remove displaced runtime sites and retain exact
named counts, generated-source checks and rejection of unaudited aliases; moving
to a complete Exit must not bypass the boundary guard.

Intrinsic build selection is by actual table identity. Index-definition allocation
is independent of table allocation; definition ID lock order does not prove table
order. The consumer must locate each row's intrinsic build without a forward
cursor over another ordering, retain required scope/definition proofs and avoid
silently losing a table's membership while advancing its coverage. Prove this
with genuine differently ordered two-table definitions and complete membership,
coverage and committed readback.

The shared materializer receives one named input with mandatory canonical unique
pairs alongside its accepted actions. Ordinary preparation returns both from its
real acquired originals; finite preparation supplies its accepted retained pairs;
paged consumers supply their actual page pairs. Remove actions-only reconstruction
and positional optional-argument compatibility paths. Plans retain canonical
previous/next claims; actions retain only phase, definition, row and ordering key.
Remove displaced raw projection fields instead of maintaining a second write
representation. Awaited unique callbacks
split the same native mutator: real releases precede their callbacks, and the
final phase proves every selected retained, released or omitted owner. Emit
callbacks only for actual release/claim actions, including no callback for a
no-op owner. Raw unique mutation APIs remain with their named reconciliation and
backfill consumers, rather than as a fallback for migrated materialization.

Remove the estimated minimum developer-index fan-out refusal from ordinary and
finite publication. The existing 128 changed-row and 512 selected-definition
bounds can produce 65,536 key pairs even when none needs a write. Only the actual
emitted 256-action ceiling refuses the transition, after complete current
membership and branch validation. Preserve all other row, definition and byte
bounds. Fixed named arrays use one bind each with Drizzle's PostgreSQL array
encoder and actual column codecs; byte arrays use canonical hex text and ordered
native decoding. This avoids PostgreSQL's scalar-bind limit without introducing
a smaller potential-pair budget, custom array escaping or synthetic tables.
Within one accepting invocation, identical keys and contiguous definition pins
reuse their already selected current proof; no proof is retained across
transactions, and later current-state or transition failures keep their order.

| Boundary being replaced | Required current owner behavior |
| --- | --- |
| Fresh original-row projection returned for key reconstruction | Prepare from authentic original rows; prove current pointer, latest revision, creation time, scope, schema/codec, complete stored digest and actual bounded document digest before applying the prepared transition. |
| Developer membership returned to JavaScript for action selection | Prepare canonical previous/final key pairs; let the ordered-index owner accept actual membership/build state and choose its existing repair/tombstone/live branch. Enabled and building behavior remain distinct. |
| Unique-owner read returned for transition reconstruction | Prepare exact nullable previous/next claims. Preserve the early stored-owner proof before relation and candidate acceptance, and the separate fresh parent/destination admission after row/index writes. |
| Coverage transported as reconstruction state | Keep fresh build/maintenance eligibility, complete fence identity and stored-row proofs with the coverage owner, including deferred all-pages completion. |
| Source validation after fresh closure observation | Prepare through the original issuer's validator; consume its Result after complete current closure agreement and before a later source or data OCC. |

Coverage current eligibility remains an open replacement boundary. The current
finite begin operation samples fresh database time and captures raw current
head/activation/schema rows under the same transaction and clock. The coverage
owner still verifies their canonical bytes/digests, typed obligation and opening-pin
agreement, and current schema/definition/frontier correlation in JavaScript before selecting
coverage rows. The native coverage primitive already accepts actual complete
write fences, enabled/unmaintained state and post-trigger/prior-page stored-row
proofs; it does not yet own that whole eligibility decision. Installing the new
index/unique acceptors does not complete coverage cutover. Retain the genuine
canonical owner barriers and ordinary/durable, CMS, mixed-command and paged
Commerce acquisition/completion lifetimes while replacing avoidable full-row
transport and eligibility reconstruction. Deferred source-bound baseline
acceptance stays before provisional writes; terminal coverage stays behind the
actual complete-batch boundary.

The settlement owner submits maximal contiguous named stages. A retained pure
failure permits only its genuine preceding stages to execute, then is reported
at the original boundary and rolls back. No JavaScript error, generic stop packet,
SQL expression, caller-selected table or instruction list enters the installed
contract. Real awaited callbacks split the same primitives at their declared
positions. The replacement is one authoritative settlement contract; a literal
one-statement implementation for every supported profile is not selected.

### Typed Activation-Bound Maintenance Obligations

Status: **connected typed-maintenance cutover implemented and verified;
complete native-relative performance acceptance remains open.** Actual
activation-role exclusion, strict source conversion, public installers and
connected consumers are verified. The
[retained measurement](../../packages/executor/benchmarks/core-performance/whole-mutation-cutover/typed-maintenance/README.md)
establishes no performance improvement and retains the predecessor's complete
request command count. This does not complete coverage eligibility replacement.
The predecessor's held-source correctness and Product measurement are complete;
complete native-relative acceptance remains open. This replaces the internal ordered-index
and unique maintenance certificates together with their writers, protection and
read/coverage consumers. It is part of the existing coverage-eligibility cutover,
not a second readiness system.

The predecessor certificates duplicate build opening pins inside canonical bytes and
digests. Consumers repeatedly decode those bytes and compare them with the build,
selected immutable requirements and coherent current activation. Their independent
agreement checks are real invariants; JSON serialization is not one. Inspected
consumers have no public wire, executor recovery or framework-format obligation
to preserve these private certificate codecs. Canonical active-head, activation,
schema, journal and outcome formats have separate obligations and do not become
replaceable merely because this certificate representation changes.

The predecessor installation admission trigger only interlocks ordinary build DML
with maintenance. Runtime roles retain broad build INSERT/UPDATE/DELETE grants,
and build coverage is outside immutable metadata invalidation. Replacing bytes
with mutable columns would therefore lose the independent pin checks. A digest
is not writer authorization, and a schema epoch does not freeze a build tuple.

Use separate typed ordered-index and unique opening obligations with the existing
domain maintenance owners. An obligation records the authenticated activation
and requirement binding plus the exact opening pin. It does not copy mutable
cursors, timestamps or the complete build state. The existing nullable maintenance
activation sequence on the mutable build selects its obligation. A validated
compound foreign key points **from the build to the immutable obligation** and
includes its scope/definition, activation, generation fence, epoch, attempt,
sealed/opening frontier and ordered first-readable or unique start sequence.
Presence and enabled-lifecycle checks prevent a NULL member from bypassing the
compound key. Supported storage generation retains its existing literal contract.
The current `coveredThroughCommitSeq` is the sealed opening H while maintained;
pin that existing field rather than adding another opening column. Coverage
advances only after authorized close under its actual lifecycle rules. Other
permitted mutable fields retain their existing writer contracts.

This direction permits inactive builds to progress after genuine close clears
the binding; retained old obligations do not permanently pin a future build.
A reverse reference from retained evidence to the mutable build is rejected.
An identity-only reference would require another field-specific transition
guard; the selected compound pin expresses those invariants declaratively.
The small repeated opening scalars preserve an independent integrity witness;
they are not another current-build snapshot or schema registry.

Requirement identity must remain independently authenticated. The pin alone
does not prove the current head, deployment/schema, table/specification or exact
closed-set membership. The genuine activation writer consumes its current
catalog/readiness lease, validates every outgoing obligation, seals removed
definitions at H and opens or carries the complete incoming requirements in
the same activation transaction. An immutable definition identity and its exact
specification binding replace repeated manifest copies only after that owner
has proved their full equivalence. Accepting readers compare the typed obligation
with the actual selected requirement and coherent current activation. A valid
historical obligation cannot authorize current writes. A missing obligation
retains the existing active-writer refusal and bounded unmaintained semantics.

For split catalogs, the target database cannot authenticate control-catalog
membership through a local foreign key. Preserve the actual issued repository
and catalog lease and its borrowed control transaction. The target publisher
records only the binding authenticated by that trusted outer writer. It cannot
mint authority from arbitrary caller-supplied arrays. Historical activation replay
does not create or retarget current maintenance obligations.

Installation lifecycle owns the new enforcement and attestation. Revoke broad
build INSERT/UPDATE grants before granting the exact permitted columns; a column
revoke cannot negate a table grant. Ordinary roles cannot set or clear the
maintenance binding or mutate obligations. A maintained-build DELETE guard
prevents removing the referencing row. Actual lifecycle INSERT/UPDATE consumers
must omit the protected binding columns and use their normal build fields;
they do not gain obligation-creation capability.

Omitting a property from Drizzle's insert values does not omit its column from
the generated INSERT: the current driver emits DEFAULT for it. The lifecycle
owner therefore uses two fixed ordered/unique build insertion projections that
name only permitted columns, deriving identifiers, parameters and returned-value
codecs from the actual Drizzle schema. Preserve conflict and transaction behavior;
do not weaken column grants or publish a generic caller-selected insertion API.
Finite capture likewise qualifies both joined obligation projections explicitly
through their actual Drizzle alias and column identifiers, retaining the existing
CASE guards and codecs when the query's FROM is a composed SQL source.

Fixed ordered and unique maintenance publishers replace the current activation
open/carry/close DML. They derive opening pins from the actual locked build rows
inside the existing activation transaction. Their constrained privileged access
has qualified relations, restricted search paths and PUBLIC execution revoked.
They accept named domain inputs, not table selectors, SQL bodies, another
database handle or an instruction list. The existing privileged-publisher
installation policy, exact whitelist and runtime-login verification apply.
Do not put a privileged publisher into the current invoker-only application
domain descriptor inventory or weaken that inventory's security contract.

The predecessor installation profiles are only `dataRuntime` and `controlRead`; neither
is a distinct activation issuer. The migration/maintenance connection is a
draining installation capability. The current constrained read-binding publisher
is granted to `dataRuntime`, so its privilege machinery does not establish the
required split-catalog issuing boundary by itself.

Add an explicit private `activationWriter` installation profile and authenticated
restricted login, held only by trusted Application activation composition.
Application activation is the sole runtime caller of both maintenance writers.
Framework binding activation publishes its own binding head and finite metadata
projection; it does not acquire maintenance-issuing authority. Installation
verifies its exact grants, login posture, namespace,
incarnation and protection identity. Grant the fixed maintenance publishers only
to that capability; deny ordinary `dataRuntime`, `controlRead`, PUBLIC and inherited
access, including memberships permitting role escalation. The activation login
also lacks raw obligation/binding DML. A direct ordinary-role call with forged or
omitted membership must fail before the publisher body. SQL trusts the verified
activation principal for remote catalog provenance while proving actual local
locked rows. The trusted outer owner must authenticate the complete remote
requirement/lease and reject forged or omitted requirements before invoking it;
SQL does not verify a JavaScript WeakMap lease.

Select that authenticated target before the existing activation transaction opens.
Reuse its current admission, lock, Effect/Cause and settlement owners; do not
elevate an open data transaction with SET ROLE, use the installer connection for
normal activation or create another settlement transaction/request lifetime.
Serving/read targets retain their actual data capabilities. Distinct activation
and serving database objects must prove the same exact physical installation
through the installation owner; they are not interchangeable by object assertion,
connection label or copied preparation token. Issue preparation against the real
owner that will use it. This explicitly breaks the current shared activation/read
target construction and installation-policy profile contract. Hosted credential
activation remains within its existing separate gate.

The existing installation owner issues a nominal activation/serving pair against
the exact genuine preparations and database objects. Authenticate both installed
profiles through their actual logins and require the same database, namespace,
incarnation, structural generation and metadata protection incarnation. Preserve
each login's independent provenance; the read-colocation capability requires
different namespaces and cannot issue this same-installation relationship.
Connection labels and caller-supplied physical identity strings are insufficient.
This pair is bounded preparation, not an activation verdict. Each activation still
enters fresh admission through its actual login; rotation invalidates preparation.

Keep Application's registered serving authority, `readActive` and all binding and
standalone preparation readers attached to their real serving context. CMS,
Commerce and cross-domain construction continue consuming that genuine identity.
Only `activate` selects the separately authenticated activation target before
opening its accepting transaction. Extend the existing located runner to admit
that genuine installation directly; do not fabricate a read-colocation token or
add another runner. Target-specific activation preparation is issued by the
existing readiness owner and correlated through the installation pair. Preserve
the original ready result, requirement issuer and borrowed control-catalog lease;
do not copy a serving preparation or construct a second readiness graph to obtain
another pool. The activation principal also needs the existing Application
read-binding publisher grant for the artifact that activation already publishes.
This does not give framework binding activation a new principal or API.

Policy-bearing activation also authenticates retained Application ownership
history under the existing scope-clock lock. Its actual activation transaction
therefore needs the existing bounded ownership snapshot and manifest readers.
Grant those two fixed `SECURITY INVOKER` functions to `activationWriter` and
attest their effective privileges alongside `dataRuntime`; retain `controlRead`
and PUBLIC denial, canonical function attestation and activation's denial of
the separate unique closure reader. This corrects the installation profile's dependency
inventory without changing transaction ownership or exposing new raw DML.

Specify outgoing-head validation and the inserted incoming activation separately.
The current writer inserts that activation, changes maintenance and only then
publishes the new head. The fixed publisher must accept the original expected head
and exact inserted incoming activation, prove both actual rows under the existing
locks and derive the incoming binding from that authorized transition. It cannot
validate new openings only against the old installed head or publish maintenance
before authenticating the outgoing complete set. Both publishers and final head
publication settle in that one transaction. Exact input, lock/order, same-installation
construction and ordinary-role/split-catalog refusal proofs are prerequisites to
accepting this connected cutover. The selected access profile is implemented;
remaining consumer and installation-path validation must prove its composition.

The fixed domain inputs name the scope, the nullable expected outgoing
`{ activationSequence, headSha256 }`, the exact inserted incoming
`{ activationSequence, activationSha256, nextHeadSha256 }` and the complete
outgoing/incoming requirements authenticated by the existing outer issuer.
Ordered requirement headers carry deployment/schema identity and manifest digest;
unique headers carry their domain deployment/schema identity. Bounded, distinct,
sorted members carry definition identity, table identity and physical specification
digest. Complete unique-set count/digest authentication remains with its existing
closure owner. Derive clock and build opening pins from the actual locked rows.

`nextHeadSha256` comes from Application's actual canonical active-head construction:
the activation frame does not contain that digest. SQL proves the inserted
activation, predecessor and local readiness roots, and records the trusted writer's
issued next-head binding. It does not independently derive that canonical digest,
introduce another JSON encoder or authorize an ordinary caller's digest. Omitting
the next-head binding would require a separate equivalence proof and is not
selected here.

Prove that normal orchestration supplies the same genuinely constructed next-head
digest to both maintenance publishers, head publication and read-binding
publication. Existing post-head authentication proves the published head's actual
bytes/digest and semantic roots; it does not inspect a maintenance obligation's
recorded digest. An authorized test that records a different maintenance head
digest must therefore reach the accepting consumer's obligation/head mismatch
refusal. Do not claim that the maintenance publisher cryptographically refuses
that authorized input. Ordinary-role invocation still refuses before the body.
Adding a post-head obligation equality guard would be a separate explicit contract
change, not an existing proof or a reason to invent another canonical encoder.

The existing catalog deployment lock and genuine lease precede target settlement.
Inside it, preserve scope-clock/readiness acceptance, outgoing-head lock/decode,
`alreadyActive` and expected-head refusal order. Historical replay returns before
maintenance. Insert and authenticate the incoming activation before the ordered
publisher enumerates every currently bound build and locks its union with incoming
definitions in ascending identity order. Validate all ordered outgoing obligations,
then all ordered incoming coverage before any ordered binding write. Close removed
definitions and open/carry incoming definitions at actual H. The unique publisher
then preserves its own per-build outgoing/incoming checks before unique writes.
Do not move unique validation before the existing ordered effects and completion
fault point. Later unique refusal or head publication failure rolls back the inserted
activation and both domains in the same transaction.

The activation maintenance callbacks are private test fault injection, with no
inspected business or durable consumer. Replace their per-build partial-write
points with `indexMaintenanceWritten` and `uniqueMaintenanceWritten`, each once
after its actual domain publisher completes. Each fixed domain publisher validates
its complete selected set and publishes atomically inside the existing transaction.
Migrate fault consumers to those domain boundaries and remove displaced point
names. This intentionally breaks the private partial-prefix observation contract;
it does not manufacture per-row notifications after a batch. Preserve actual
rollback, interruption, ordered-before-unique failure precedence and final head
publication proofs. Framework hooks and business workflow callbacks are unaffected.

Authenticate the complete outgoing requirement set without assuming every outgoing
definition has a maintenance obligation. Enumerate actual bound rows; preserve
genuinely absent-evidence builds, bounded unmaintained reads and active-writer
refusal. A later activation may certify a physically covered unbound build.

Attest the actual obligation columns, unique keys, FK direction/actions and
validation, presence checks, admission/immutability/delete guards, publisher
bodies and effective table/column permissions including inherited and PUBLIC
access. New obligation tables receive the existing installation-admission
interlock explicitly. Ordered and unique domains retain their distinct lifecycle
and frontier meanings; no universal transaction or maintenance API is added.

The writer cutover includes activation's ordered and unique open/carry/close
owners, index reconciliation, ordered/intrinsic builders, unique builders and
reclaimers, domain installation and reverse-reference progress writers.
Their normal lifecycle DML already omits maintenance columns; preserve that
omission under exact column grants. Installed coverage's current certificate-
absence predicates become typed binding-absence predicates. Reverse-reference
coverage already leaves a maintained build's sealed frontier unchanged and keeps
that behavior without gaining obligation-creation authority.
The consumer cutover includes current build decoders, finite storage capture,
materialization and coverage, ordinary readiness/query/journal/reference readers
and the real Application, Payload and Medusa consumers. Native coverage retains
its actual complete fences, post-trigger/prior-page proofs and unmaintained
reset rules. Its normalized presence projection does not alone complete the
remaining canonical current-head eligibility boundary.

This breaks private certificate codecs, columns and mutation permissions.
Existing maintained data is converted under the installation maintenance
interlock after draining real users. Strictly decode the old canonical bytes,
verify their digest and complete build agreement, authenticate their genuine
activation and closed requirement, then write the typed obligation and binding.
Corruption, an unresolved split catalog or incomplete authority blocks conversion
and reopening; do not invent evidence or reset business data. Preserve absent
certificate semantics, historical frontiers, installation incarnation, rows,
history, claims, heads, receipts and outcomes. Remove the old certificate columns,
runtime codecs, hashes, exports, representation-only fixtures and stale documentation
in the same connected cutover. The explicitly named `Legacy...` codecs remain only
for the strict predecessor converter and its conversion tests; retiring supported
legacy maintenance inventories is their removal gate. Serving has no dual reader,
and no silent durable deletion is selected.

Conversion uses bounded units owned by the existing maintenance command lane,
which can settle units independently. Keep the legacy evidence through complete
conversion and final migration settlement while runtime stays drained. On retry,
an existing typed obligation and binding must equal the fully authenticated old
evidence and actual build pins exactly; existence alone is not success and an
upsert cannot overwrite disagreement. Resolve an uncertain target COMMIT through
that exact durable agreement before replaying the unit. A corrupt later unit
does not permit reopening a partially converted installation. Reopening requires
the complete maintained/unmaintained build inventory, validated constraints,
all converted bindings and final structural/privilege attestation. The final
canonical migration validates agreement, removes legacy columns, installs the
native bodies and records completion atomically; structural/privilege attestation
then precedes reopening. A rollback of that migration retains legacy evidence.
An attestation failure after its COMMIT keeps the converted installation drained
and does not restore removed columns. Retained old obligations
follow the existing activation-history lifetime; their eventual pruning must
prove no current binding or retained-history obligation, and must not reference
the mutable build tuple in the reverse direction.

The current Drizzle migrator is one journaled operation and cannot declare a
stage-only migration complete before data conversion. Use fixed stage DDL under
the existing installation maintenance owner, outside the canonical migration
journal, then its fixed authenticated conversion command. Only the final canonical
migration validates the complete converted inventory and foreign keys, removes
legacy columns and installs the final native bodies before recording completion.
Use actual borrowed control transactions and existing canonical requirement loaders
under their real deployment locks. A catalog on the exact genuine maintenance-owner
database object borrows its backend; a split catalog must supply its genuine source.
The supported populated source is the exact canonical predecessor migration 135
and its actual journal digest. Older populated sources without that provenance
are refused with their retained evidence intact. The public Postgres and PGlite
installers invoke the fixed conversion before final migration under their existing
draining owner. Tests reconstruct only the private predecessor representation and
receipt from genuinely activated current Application openings; they do not claim
a complete historical installation replay.
Metadata backfill belongs to that same fenced maintenance owner. Its per-head
units use the existing settlement bridge rather than ordinary live runtime
admission, which correctly refuses a drained installation. Preserve genuine
external catalog admission and the borrowed backend for that exact owner database;
no second lifetime, installation bypass flag or fabricated admission is selected.
PGlite's full-proof public installer must own the complete command on its actual
single backend. Its provider serializes individual queries/transactions, and
session advisory locks are reentrant on that backend; neither excludes a second
maintenance command between settled units. Refuse overlapping public migrations
across wrappers sharing the actual PGlite instance before SQL. Retain the exact
generated maintenance owner, incarnation and structural generation, and require
one matching row at reopening in addition to backend PID/start. Decode foreign
gate and lock rows at the installation boundary. Failure keeps the installation
drained; command cleanup releases only its own in-process exclusion.
No caller-supplied requirement arrays, fabricated readiness lease or generic
migration callback enters this command lane. Quiescent bootstrap must inspect the
actual legacy inventory: an empty/unmaintained installation may complete directly;
populated evidence without authenticated conversion authority fails closed and
remains intact. No journal marker or typed-row existence substitutes for strict
retained-data authentication.

Completion requires both database lanes for ordinary-role write denial and exact
installation attestation, every certified pin drift, unauthorized clear/delete,
wrong selected requirement/head, missing obligation, A/B activation gaps, outgoing
validation and close/open rollback, historical replay, builders/reconciliation,
unique swaps and paged completion, cancellation and unknown COMMIT. Preserve
failure precedence and complete Cause/Exit settlement with the current owners.
Run the real Application/Product/Payload/workflow regressions, both project
reviews, cleanup and component measurements against the held predecessor. Only
measured work and latency reduction justify a performance claim; the complete
matched-native, tail, metadata-scaling and cold-capacity gates remain independent.

Typed maintenance removes no complete-request client commands. Coverage's
remaining eligibility boundary is still an architectural completion obligation,
but current diagnostic CPU evidence does not identify its canonical reconstruction
as the dominant cost. Do not justify another representation-only rewrite as the
solution to the complete latency gap. The next focused preflight must challenge
the existing working-set/data-capture boundary and publication observation/
acceptance handoffs together: identify genuinely repeated graph work, actual
framework/untrusted ownership crossings and removable database roundtrips.
Preserve canonical owners and real semantic barriers until their replacement
proves equivalent authentication, failure order and settlement. Distributed
Effect costs are evidence to simplify the flow at its owners, not permission to
remove Effect lifetime or failure semantics. A single diagnostic COMMIT outlier
does not attribute the retained latency distribution to durability.

Candidate progress and completed-prefix strong references keep their genuine
canonical JavaScript boundaries. A candidate failure frame depends on the actual
current predecessor; reference admission can require external rows, reverse-index
repair and actual paged facts. A healthy sample with no affected references or
candidate transition does not establish permission to omit these owners. Framework
hooks, native service execution and workflow steps remain outside the database
settlement transaction.

This breaks private finite lowering, predecessor/action assembly and transported
coverage contracts. Existing ordinary Application publication, durable recovery,
CMS/Commerce finalizers, unique reconciliation/backfill and paged materialization
consume the same domain primitives while retaining their actual acquisition,
callback and recovery lifetimes. A cold durable consumer that must obtain original
documents keeps that real read obligation; it does not retain a duplicate finite
write engine. Remove displaced finite observation/lowering exports and tests with
their migrated callers. Fixed installed descriptors, grants, full attestation,
maintenance interlock and read-role exclusion move in the same structural
migration. No business row, history, anchor, candidate frame, journal or committed
outcome format reset is required by this contract.

The native Product graph also exposes a scalar relation-population seam, but its
remaining captures mostly select distinct required historical data. Root identity,
nested options/values, tag/category pivots and targets, final variants/images,
historical handle ownership and database time are real demands. Existing pending
and original observations already suppress repeats. An ordered shaped population
contract is a separate core option only if it proves that earlier body corruption,
budget or consumer refusal still wins before later storage/readiness/transport
work. An eager SQL union, guessed prefetch or concurrent transaction execution
does not meet that gate. Do not replace actual native normalization or final
projection with a scalar-update shortcut.

Require both database lanes for ordered multi-source refusals, post-wait authority
and expiry, replay precedence, metadata ABA, full original-predecessor corruption,
enabled/building index repair, unique handoffs and negative owners, relation and
candidate failures, complete post-trigger/prior-page proofs, deferred coverage,
full-prefix references, cancellation and unknown-COMMIT resolution. Migrate and
verify the real Application/Product/Payload/workflow consumers, then perform both
project reviews, cleanup and connected final-source measurements. Complete matched
native excess, stable tails, metadata scaling and cold capacity remain the final
acceptance gates; no command budget or predicted speedup substitutes for them.

### Selected Retained Settlement And Ordered Stored Proofs

This connected replacement is implemented for the selected private finite
profile. Complete native-relative latency acceptance remains unmet. Its outcome
is one owned canonical finite document graph through settlement and
one fresh relational row/index stored proof at each existing page barrier. The
finite root, frozen-attempt issuer, publication preparation and installed
Application materialization owner change together. This is an implementation
slice of the existing redesign, not completion of native-relative acceptance.

The finite working set already produces complete codec values. The displaced
freeze retained a graph plus parallel raw intents, and publication normalized,
encoded and hashed those values again. Structural closed-root transfer is
replaced with an issued, attempt-bound capability. The issuer retains one detached
graph and derives prepared row intents from that owned graph. Publication borrows
the complete canonical values after genuine issuer/origin/dependency checks.
Validator and inspection projections remain detached; ordinary/cold foreign
commands retain their canonical acceptance. No caller-owned record or copied
capability may become retained canonical evidence.

The displaced installed row and index primitives reconstructed and queried each
expected revision and pointer separately after their writes. Those loops are
replaced with one ordered joined query over the same expected typed tuples. The first
refusal remains the first proof ordinal. Preserve predecessor, revision RETURNING,
pointer and page barriers; the later VOLATILE proof must observe actual AFTER
trigger effects, including corruption of earlier pages. Sequential writes remain
where an earlier returned-tuple refusal must outrank a later trigger exception.
For 512 rows in 32-row pages this replaces 1,984 proof SELECTs with 16 queries
checking the same 992 expected tuples. That is a topology claim, not a predicted
latency result or fewer client commands.

Private closed-root and frozen issuer inputs break; migrate their actual callers
and tests and remove parallel finite intent capture/recanonicalization. Installed
row/index function signatures remain stable but their bodies and exact
installation attestation change in one structural migration. Drizzle owns table
and column names. Business rows, history, anchors, journals and outcomes require
no reset, backfill or deletion. Installation maintenance remains the migration
and runtime privilege owner.

The [shared execution evidence redesign](./27-shared-execution-evidence-redesign-preflight.md)
now owns the connected remaining preparation/admission, value/capture and
publication handoffs across standalone CMS/commerce and mixed consumers, including
CPU reduction. Its runtime cutover has not started. Compact historical capture
is part of that replacement, rather than a separate finite-only optimization.
Exact native immutable frontier pins remain necessary: current anchor bytes contain only the
snapshot/reservation. A byte-only identity shortcut would weaken existing
request/policy drift witnesses. Do not replace these checks without their writer
contract and durable-format cutover. This slice also leaves genuine external
coverage proof transport, prefix representation, standalone CMS admission,
relation population, candidate failure frames and strong-reference admission
with their recorded owners and gates. It introduces no universal compositor.

Completion requires genuine/foreign/wrong-attempt/consumed closed-root proofs,
mutated detached canonical projections, exact final value/dependency semantics,
same-page RETURNING-versus-trigger refusal order, existing prior-page AFTER
corruption and row-before-index/search refusal witnesses, both PGlite and
ordinary-role PostgreSQL, actual Application/Product/Payload/workflow consumers,
lint, both reviews, cleanup and a scoped commit. A quiet warmed matched-native
comparison answers whether this connected cutover reduces complete latency;
diagnostics separately verify removed work. The complete 5 ms median / 10 ms
P95 added-latency, stable-tail, scaling and cold-capacity gates remain open until
they pass on final source.
