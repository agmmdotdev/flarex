# Finite Execution Contract

## Status And Purpose

Status: **selected architectural cutover delivered for the existing private finite profiles; performance acceptance remains incomplete.**
The owner wants the Convex-inspired admission/readiness/publication design,
not an indefinite sequence of optimizations to the existing protocol. The
[common-observation work](./20-query-required-read-execution-preflight.md) is
groundwork within that protocol. It does not implement the full architectural
replacement or satisfy its fixed native and metadata-scaling gates.

The implemented finite execution contract uses one authenticated attempt,
versioned metadata, one data snapshot plus pending state, demanded serving
requirements and one Postgres settlement. Decide which facts belong to that
attempt and which genuinely require a fresh storage-boundary check before
selecting SQL acquisition mechanisms. Fusing queries alone does
not make this a Convex-style redesign.

Apply the [architecture-first sequencing rule](./14-execution-redesign-roadmap.md#architecture-first-small-optimizations-afterward).
Complete this connected contract, consumer migration and removal of displaced
paths before a separate round of small optimizations. Each change must establish
a selected responsibility or lifetime and identify the old choreography it
replaces. SQL batching or fusion alone is not an architecture deliverable.
Correctness fixes and required validation continue; record unfinished architecture
and performance acceptance separately without weakening either gate or silently
starting the deferred terminal durability replacement.

The owner authorizes the connected replacement below. The inventory selects
existing immutable version owners, one live-authority relation and bounded
consumed-metadata observations. The current durable seal/finishing model remains;
this does not select package 2's terminal durability replacement. Developer APIs,
new framework capabilities and historical search remain gated.

## Concrete Selected Contract

### Entry And Immutable Metadata

Capture one authenticated tuple at full finite entry: original data snapshot,
scope/storage incarnation, exact Application revision/activation/schema,
framework binding candidate/activation and metadata watermark. Derive source pins
through their existing preparations and local validators. This context belongs
to the existing attempt, with no second lifetime. Only confirmed entry COMMIT
makes it usable; a callback or digest alone cannot issue authority.

Retained schema artifacts, revision/schema bindings, physical definitions and
binding candidates/activations represent this tuple. Flarex selects metadata at
authenticated entry; it does not reconstruct a registry from the data timestamp.
This divergence avoids inventing a metadata timeline. `snapshotCommitSeq` alone
cannot select the schema/binding version.

Finite frontiers require the genuine context, preparation and reservation, then
demanded serving availability for the original snapshot. They do not reread
current Application/binding heads or reject unrelated immutable publication
through a whole-version epoch. Installation identity, credential/maintenance
exclusion and live security remain fresh.

### Authority And Commit Sequencing

Keep the scope-clock identity/FK root and commit sequence. Move storage
generation/fence, epoch, authorization revocation and retained-history floor to
`fx_system_scope_execution_authority`, keyed to that root. Preserve existing
values through a forward migration and remove displaced writable columns.

Finite reads SHARE-lock authority, then compact session, lease, journal-state
and claim projections in the existing refusal order. Database time follows lock
waits. They do not lock commit sequencing or reconstruct full journal payloads.
Their nominal observation is distinct from stable/writable clock observations.

Qualified finite admission completes installation, placement, clock, receipt
and metadata epoch validation before acquiring running-attempt locks. A separate
compact running-attempt phase follows it. Fusing both phases would postpone
existing JavaScript refusals until after session, lease, journal or claim lock
waits, so statement count does not justify that composition. Historical row and index owners may
reuse that genuine transaction-local scope identity instead of issuing another
scope lookup; exact requested scope and transaction lifetime remain required.
Full/direct/durable profiles retain their declared observations and checks.

Every retained writer follows authority-before-sequencer ordering, including
Application task registration, relation task registration and relation
publication. A joined clock projection does not choose its lock order: acquire
the actual authority row first, then qualify the sequencer row lock. Their
existing authority refusals, retry classification and atomic catalog/publication
transactions remain with those owners. Real PostgreSQL contention must prove
ordered serialization across these callers.

Both phases use the same private SQL observation owner: SHARE-lock the actual
authority row, then read the actual sequencer in the volatile function after
any authority wait. This prevents an outer statement snapshot from combining
an updated retained-history floor with an older commit sequence. The installed
phase supplies these genuine rows to its existing combined-clock decoder and
finishes all existing placement, receipt and epoch validators. The compact
phase observes authority and sequence again before its declared attempt checks;
it accepts neither prelocked rows nor caller-asserted authority. These repeated
bounded reads remain charged to admission until an owner-correct replacement
preserves every early refusal. Missing paired roots retain the installed owner's
declared refusal. Full/direct/durable acquisition stays with its existing owner.
Function bodies, exact signatures, grants and installation attestation change
together. Genuine PostgreSQL witnesses must prove both installed corruption
refusal before a held claim and floor changes across an authority wait.

Effect-native scope-epoch and running-attempt transaction runners evaluate
admission and the callback in one runtime boundary. Admission failures, defects
and interruption belong to the same complete callback outcome as business work;
rollback failure must not replace or hide that outcome. Promise-only driver and
RPC callbacks retain their explicit adapters and resource cleanup.

Ordinary publication holds authority SHARE and sequence exclusivity. Revocation,
floor advancement and actual serving invalidation hold authority UPDATE first.
The barrier lasts through data SQL: if a lease expires during a read, the floor
writer still waits before enabling pruning. Lease-row locks alone are inadequate.
Actual full/direct/durable callers retain their stronger declared contracts.

Application and binding activation retain their stronger full-writer profile:
authority UPDATE precedes sequence UPDATE and fresh readiness, replay and CAS
checks. An activation can proceed between finite storage frontiers, but waits for
an already-open frontier. The selected hot read contract promises concurrency
with ordinary data publication, not with every cold metadata writer. Relaxing
activation would require owner-derived withdrawal classification from exact
incoming and expected predecessor artifacts before choosing the authority lock;
late lock upgrades after sequencing are not an acceptable shortcut.

An activation that withdraws a source must authenticate its resulting binding
after its own revocation write. New canonical binding activations use format
version 3 and record the authorization-revocation epoch actually accepted by
the writer transaction after withdrawal. The candidate's observed Application
reference remains immutable. Current binding admission compares its exact
Application selection and the activation's accepted epoch with fresh authority;
proposal admission still requires the candidate's exact current epoch. Later
external revocation continues to invalidate full current-binding admission and
old attempts. The writer must not predict a counter or weaken this check.
Existing retained version-2 activations keep their exact bytes and decoding,
using their original candidate-epoch contract. Their historical post-activation
epoch is not invented. Activation digests, retained-head verification, entry
reservation, retirement and recovery must agree on both concrete formats.

Initialization, shared/split provisioning, stored authority/recovery, build and
retirement, history readers, feeds and tasks migrate together. Paired-root
presence and `floor <= commitSequence` remain installed database invariants,
including ordinary-role SQL. Installation layout, privileges and exact function/
trigger attestation cover the changed relations and functions.

### Demanded Serving And Reservation

The working-set owner prepares one immutable unique-storage selection per actual
lookup. That selection carries the readiness demand and, for historical reads,
the exact captured definition, identity and compiled bounds used by storage.
The two private candidate/read and write-validation consumers share this value
within the same call. Metadata consumption remains at its existing first
evaluation point; cached validation paths do not evaluate unused preparation.
Pending overlays, negative observations, dependencies, budgets, fresh readiness
and authority checks, and original-snapshot coverage remain unchanged. There is
no selection registry, cache, new token, lifetime or exported API.

Private selection preparation and index preparation/decoding may use narrowly
documented `Effect.fnUntraced` boundaries beneath the existing named public read,
SQL, authority, kernel and transaction operations. These synchronous internal
steps retain their validations, hashing, typed failures and complete Cause
semantics. The shared digest helper and metadata-consumption operation retain
their tracing. This removes repeated internal span/stack construction rather
than disabling tracing globally. Its latency benefit remains an acceptance
question for the complete native hit/miss comparison, not a claim from call
counts or correctness tests.

Compile stable metadata decoders and seal encoders once in their existing
modules, preserving decoded/encoded representations, strict parse options and
error projections. This reuses codecs without retaining authority or metadata.
Remove the displaced finite current-head projection readers, their shared
projection registry and admission wrapper. Their only remaining callers are
tests. Preserve full-evidence preparation/retention and the actual full-source
live-check scope; migrate integrity, corruption, lease and failure coverage to
those owners and the selected retained finite metadata witnesses.

Ordered and unique demands use captured definitions and the original snapshot.
Fresh lifecycle, spec, first-readable bound, retained coverage and physical
availability must prove that snapshot. A later activation's maintenance
certificate cannot silently authenticate the old tuple. Closed coverage can
serve a pinned historical snapshot only where the existing owner proves it.
Unavailable/retiring paths refuse before data; historical search stays unsupported.

Extend the existing retirement reservation to finite framework sessions; its
Application-only authority-generation filter is insufficient. Persist/authenticate
the exact selector and watermark with the attempt/lease and seal. Retain required
versions through finish-only recovery and uncertain COMMIT. Local bytes alone
cannot establish a reservation.

The native Application schema and composed binding schema can differ. Retirement
must protect both, including definitions referenced only by the captured binding.
Authenticate the retained candidate and activation through their existing artifact
owner; do not substitute the current binding head. The current active binding also
pins its own logical schema independently of the active Application. Terminal
disposition and lease retirement release the attempt pins through their existing
owners. Missing or mismatched retained artifacts refuse retirement.

The connected retirement proof withdraws the Product source through a genuine
binding activation, retaining Application and Currency. Its old finite reservation
must continue to pin the withdrawn ordered and unique definitions until terminal
disposition. No Product callbacks run under the withdrawn binding. Replacing a
search-bearing source's schema changes its source digest; the current search
coverage owner refuses reuse of the old digest. General search replacement remains
deferred and is not inferred from this retirement proof.

### Consumed Metadata And Publication

Select relevant-change OCC, including ABA. Effective Application/binding
activation advances one monotonic metadata sequence under the sequence owner.
A private contract-observation relation records stable semantic keys,
presence/digest and last-changed sequence. Equal semantics preserve last-changed;
removal leaves a tombstone and re-addition advances it. Canonical version owners
remain authority; the relation is their atomic OCC projection.

Admission captures the watermark. Old metadata first used after activation still
uses that entry watermark; it cannot sample a newer key counter retrospectively.
Publication checks consumed expected semantics and
`lastChanged <= entryWatermark`, plus complete current write-maintenance and
constraint obligations for touched tables.

Read validation uses retained definitions for every consumed access path,
including tables that the attempt never writes. Current write-maintenance
definitions come from the authenticated current binding catalog for framework
sources. The native Application schema remains independently selected. The two
definition sets are explicit; a touched-table write closure cannot stand in for
the attempt's read dependencies.

Current write closure is required only for actual effects. An authenticated
source contribution with no touched tables keeps its retained read definitions
and consumed-metadata checks, but does not reconstruct the current binding
catalog to obtain an empty write set. Immediate source withdrawal still refuses
through live revocation; relevant metadata changes still conflict at settlement.
Contributions with writes authenticate the complete current maintenance and
constraint closure through its existing owner.

Record table/name contracts, selected definitions, source/profile policies,
function semantics and the authenticated execution-group projection. Do not
invent a per-function executable closure. The finite graph already plans through
retained write mechanics: record the ordered access-candidate family for each
demanded leading field, including empty families, and chosen definitions. This
covers positive/negative selection without another planner. Unrelated tables,
fields and source-set movement are not blanket conflict keys. Full native
program/policy identity remains a dependency where that contract consumes it.

Each projection has one writer. Application executable contracts use the private
`execution` namespace and the singleton Application owner; arbitrary source keys
cannot collide with it. Application schema activation owns its native schema
contracts. Binding activation owns its source contracts, including the Application
source and its complete cross-source write closure. A bound native Application
call consumes its original schema facts and the authenticated binding closure;
Application activation cannot replace that closure with a native-only one.
Application-only calls use their own complete native closure. Both are explicit
entry profiles derived from actual retained artifacts, with no failure fallback
or fabricated logical requirements.

The maintenance cutover initializes each current projection through its canonical
owner before reopening runtime access. Application backfill owns native schema
and executable facts; binding backfill authenticates its selected candidate and
the exact immutable catalog through the explicit catalog database. Repetition
preserves the watermark and tombstones. Repairing a missing current projection
can advance the current sequence, but cannot invent an older observation or occur
as a lazy request-path repair.

The signed principal/access policy stays exact. Permission/function/profile
withdrawal requiring immediate refusal advances scope revocation in its writer
transaction. Metadata counters do not revoke admission. Ordinary schema/index/
executable changes use the declared metadata OCC policy.

Revocation denies execution, claim acquisition and publication, while the trusted
terminal owner may still abort or expire that exact revoked attempt and release
its reservation. Terminalization retains exact session/attempt identity, fence,
claim, storage incarnation and scope epoch checks under the existing writer
locks; it grants no callback, business read or settlement capability. Sharing
the execution revocation comparison with cleanup otherwise leaves withdrawn
attempts permanently nonterminal. The two profiles select this rule explicitly,
with no permission restoration or fallback execution path.

Terminal cleanup evaluates clock-independent journal, lifecycle, required-row
and snapshot refusals before acquiring the abort claim. Only an exact
terminalizable abort needs that claim gate. Database time still follows its last
required lock wait; idempotent terminal observation does not acquire a claim.
This preserves refusal ordering alongside post-wait expiry and revoked cleanup.

Finite seal captures the trusted entry tuple and accumulated evidence without
current-head re-admission. It preserves exact attempt ownership, installation/
storage checks, journal integrity and confirmed durable settlement. Publication
alone validates conflicts/constraints and commits. Response-loss recovery,
rollback, whole-root retry and event-intent behavior stay with their owners.

A metadata-only conflict can have the same data commit sequence. Replacement
must observe a genuine metadata sequence beyond the captured watermark and at
least the witnessed relevant change, then authenticate its fresh entry projection.
The signed session's schema, function and executable pins remain exact. An ABA
change restored to compatible retained semantics can retry with the new
watermark; an incompatible current schema or executable refuses and requires
a newly admitted call. A counter alone cannot authorize changed business code.

The replacement transaction also owns the new finite entry. After correlating
its fresh session, lease, journal and claim under the full authority owner, it
runs the existing prepared entry capture in that same transaction. It persists
the fresh reservation and source observations before the final guards and COMMIT;
confirmed COMMIT installs the private journal entry used by the retry handoff.
Failure or uncertain entry settlement discards local capture according to the
existing entry owner. Reloading rows or passing participant selections to
`openAttempt` cannot recreate that authority. The actual executor and framework
retry compositions migrate to this lifecycle; a second entry transaction or
restoring the displaced finite constructor is not a replacement mechanism.

Cold replacement authenticates the existing sealed journal before changing
attempt state. Its reserved finite marker and exact entry evidence determine
the execution profile; clearing all lease reservation fields cannot downgrade
a sealed finite attempt into a direct attempt. Reuse this authenticated journal
for conflict reproduction within that replacement transaction. Hot frontiers
retain their confirmed attempt-owned capture and exact stored-reservation
comparison, rather than repeatedly decoding and hashing the durable seal.

### Original Native Application Evidence At Entry

Select retention of native Application A's original authenticated schema artifact
and published schema-authority row through the existing readiness and finite
preparation owners. Terminal preparation currently acquires these representations
again with four control reads. Reuse their original database projections; do not
reconstruct SQL JSON text or raw rows from semantic schema objects. Keep the
genuine stable-table membership acquisition and independently selected framework
binding B. B's Application reference must still match A exactly.

The artifact owner inserts or verifies exact replay. Application schema-authority
reservation correction applies only before publication; readiness either compares
an already published binding exactly or changes `reserved` to `published` by CAS.
These supported writers cannot mutate the retained published originals under the
same identity. Scope activation, withdrawal, maintenance, serving state and live
authority still use their existing accepting-transaction and final guards.
Arbitrary privileged corruption after capture is outside this bounded preparation
contract; corruption encountered at genuine acquisition still refuses. No cache,
additional lifetime, registry, nominal token or authority is introduced.

The schema-artifact owner acquires actual `manifest_json::text`, canonical bytes,
digests, identifiers, versions, timestamps and database byte lengths alongside
semantic authentication. Keep its canonical read limit and database-JSON
corroboration. Conditional scalar projection bounds original JSON transport by the
existing stored-commit-authority materialization limit. Semantic artifact reads
retain their own profile; an artifact too large for finite entry can remain valid
for an ordinary semantic caller. Do not fabricate original evidence for publication
results constructed from canonical input.

The private `ApplicationSchemaAuthorityPublisher.readPublished` contract becomes
`{ schema, originalArtifact }`; `publish` continues to return the semantic schema.
Migrate readiness, mutation admission, query snapshot, action admission, managed
schema planning and write-ownership history, with their affected tests and port
implementations. The readiness binding reader retains its actual authenticated
published row and database binding-byte length while preserving the existing
binding limit and full-byte comparisons. Preserve all selected nonsemantic row
scalars as originals too.

Existing readiness state and `PreparedFiniteActiveApplication` carry these inert
originals and exact control-database identity. Lending requires the genuine
preparation, open existing host lifetime and exact deployment/native schema tuple,
Application schema digest and binding digest. Detach mutable bytes and dates.
Initial entry and replacement entry both supply this evidence to the existing
terminal-control owner; absent evidence, copied preparation handles, closed
lifetimes, wrong databases and mismatched native selectors refuse. Finite entry
does not fall back to repeated queries. Full,
direct, durable-seal and recovery callers retain explicit genuine acquisition.
The target capture continues to authenticate the whole selected graph and apply
its aggregate admission. Callback execution does not confirm entry; only the
existing confirmed COMMIT path can install it.

Schema-evidence lending authenticates the immutable revision, program and native
schema identity; it does not authenticate a current activation counter. A genuine
metadata ABA restoration may prepare the original revision and schema under a
newer head sequence while replacement retains the original signed session
sequence. Keep exact runtime-target/schema compatibility with mutation admission
and fresh head acceptance with activation. Remove the lending helper's sequence
equality rather than introducing a replacement flag or weakening those owners.
The real ABA retry witness must pass on both database drivers, with all immutable
tuple, database, lifetime, budget and terminal graph checks retained.

Admit the original JSON, canonical and binding aggregate before terminal payload
use with the existing limit. An absent conditional payload or oversized aggregate
refuses explicitly rather than rereading or reconstructing it. Retain the later
whole-graph/session budget and all real session/claim/root correlation barriers.
Supported maintenance, activation and withdrawal cannot be bypassed by retained
immutable data.

Acquiring original SQL JSON text moves an acquisition SQL/resource failure into
the schema read, before subsequent readiness/lifecycle work. Adding database
binding-size projection moves its SQL failure into the binding read, before cold
authentication and preparation charging. Existing ordered semantic, canonical
integrity and binding refusals stay with their owners. Do not claim unchanged
precedence for simultaneous SQL and later semantic failures or relabel every
earlier failure as terminal persistence.

No persisted schema, journal, codec or protocol format changes for this retention.
Remove the displaced finite reacquisition and migrate all callers in the same
connected slice. Prove genuine original SQL representation, conditional transport
and aggregate bounds, semantic-only readability, issuer/lifetime/database/A-B
substitution refusal, supported writer interlocks, rollback and uncertain COMMIT
in PGlite and ordinary-role PostgreSQL. Run connected Application, Product, Payload,
workflow and retry proofs, both final reviews, the fixed native comparison and
declared integration milestone. Fewer reads are a mechanism; latency acceptance
remains incomplete until the fixed gates pass.

### Contracts, Callers And Durable Disposition

| Existing owner/contract | Selected disposition |
| --- | --- |
| Finite current-head correlation, source re-admission and transaction projection sharing | Replace with attempt metadata/source pins; remove displaced finite callers, exports and tests. |
| Scope-clock fields, SQL projections and installed clock functions | Move authority once; migrate every actual reader/writer/fixture, preserving stored values and identity FKs. |
| Finite current-clock/current-head ordered/unique readiness | Replace through the correct historical serving owners. |
| Canonical Application/binding activation | Extend with atomic semantic OCC projection; retain canonical identity and lifecycle ownership. |
| Root evaluator, working-set evidence and journal normalization | Extend strict bounded observations, ordering/deduplication, budgets and tamper refusal. |
| Finite evidence/seal/recovery | Encode selector/watermark explicitly; version changed canonical meanings; never fabricate historical watermarks. |
| Ordinary Application/direct/durable profiles | Retain precise declared contracts/formats for actual callers; no finite fallback or universal weakening. |
| Nonterminal finite records without new reservation/evidence | Drain through existing terminal/recovery owner before new finite activation, or refuse cutover; preserve records/outcomes and never silently reset/delete. |

Authority, construction, serving, dependency and recovery changes form one
connected replacement. Workers own disjoint files; dependent APIs serialize.
PGlite, ordinary PostgreSQL, both reviews and actual framework regressions remain
required. A completed sub-owner does not establish package acceptance.

The independent direct-core finite journal API has actual callers in the point/
index overlay, seeded-validator and Application-relation owner proofs. Those
callers have no Application/binding selection and retain their full exact
transaction contract. A reserved Application/framework finite root selects the
new contract explicitly through its genuine entry capture, including an
Application-only aggregate entry with zero participants. Missing or refused new
evidence never switches that root to the direct contract. This preserves distinct
execution profiles rather than making one universal transaction API. The forward
installation migration refuses any existing nonterminal finite root until its
existing owner drains it; it does not infer that an empty durable journal proves
there was no lost in-memory work.

Reserved Application/framework roots are constructed only by the aggregate
entry owner and become usable after confirmed entry COMMIT. Reopening can reuse
that owner's issued local state; it cannot reconstruct a reserved root from
participant selections after losing the state. The direct full-contract
constructor requires an actual legacy execution-authority session and a lease
without finite reservation evidence. Ordinary Application activation cannot
mint a finite root outside aggregate entry. Retirement authenticates the exact
journal profile and refuses an Application-authority finite root whose lease
or reservation is missing, including a coherently nullified reservation.

Native schema evolution after framework seeding has a separate existing gap:
the candidate-validation scan selects every current identity in the scope,
then treats tables absent from the native candidate as removed native tables.
Framework Product/Currency rows can therefore invalidate a changed native
schema without being part of its native table set. This belongs to the
candidate-validation owner and requires a focused native-membership correction
before that evolution is claimed. The selected executable ABA proof retains
the exact original native schema and uses genuine analyzed program changes;
it does not expand schema evolution or weaken candidate validation.

Logical Commerce initialization belongs to the committed source, not the whole
composed schema. The full host's current operation digest includes that schema
ID; comparing it with an earlier source-scoped seed receipt wrongly rejects an
unchanged source after an unrelated binding activation. Full-host initialization
therefore authenticates the exact committed scope/source/step, complete source
digest, dataset digest and row count. The source digest includes its owner,
write profile, evidence, definitions and bindings; changing those facts still
refuses before a callback. Current binding, serving and write-closure checks
remain separate requirements.

The schema-bound operation digest and its journal meaning remain unchanged.
Stored seed receipts retain their original digest and all data as provenance;
there is no receipt rewrite, reseeding or new historical digest. The actual
standalone reader additionally checks its explicitly supplied original installed
seed digest, preserving that distinct construction contract. The full Commerce,
atomic-Commerce and cross-domain command owners' internal initialization calls
lose the incorrect current-operation-digest argument. Connected rebinding
read/write and wrong source/dataset/count witnesses
must validate this separation before acceptance.

### Retained Historical Analysis Proofs

The displaced Application revision-registration, readiness and activation graph
is available only through `internal/system-test` exports, as recorded in
[Application Analysis migration](../49-application-analysis-migration.md) and
[Standard Application APIs](../42-standard-application-apis.md). Its pre-0064
fixtures cannot run the current installation-protected control reader or
transaction runner: those require installation admission introduced after that
historical schema. That mismatch already exists in the handed-off baseline.
The split authority relation introduces another incompatible current layout;
it does not justify a historical runtime fallback or invented authority rows.

Retain the named historical FSV harnesses and Task parent fixtures while their
coverage consumers remain. Their removal requires a connected migration of
meaningful current analysis, registration, Task-parent and activation coverage
to the unversioned Application Analysis/publication/readiness/activation owners.
Keep genuine historical migration refusal and foreign-key witnesses as
schema-only proofs. That test-consumer retirement is a separate focused scope;
the selected finite contract does not restore execution on the retired graph
or claim those historical runtime suites as passing current-consumer evidence.

## Primary Evidence

Convex [transaction construction](../../../../crates/database/src/database.rs)
at lines 1756–1840 captures a repeatable timestamp with table, schema, component
and index registries and its timestamped persistence reader. Its
[snapshot manager](../../../../crates/database/src/snapshot_manager.rs) supplies
the corresponding registry state. Concurrent committed metadata does not replace
that state in the middle of execution; the transaction can overlay its own updates.

[Index lookup](../../../../crates/database/src/transaction_index.rs) at lines
598–630 checks the captured registry and records index metadata dependencies.
Schema reads similarly record dependencies through the
[schema registry](../../../../crates/database/src/schema_registry.rs). Range
reads preserve negative intervals, examined ranges and EOF evidence, not only
returned IDs. Pending writes overlay those snapshot reads.

The [committer](../../../../crates/database/src/committer.rs) at lines 719–840
checks dependencies against committed history and pending writes before rebasing
conflict-free work. The [application runner](../../../../crates/application/src/application_function_runner/mod.rs)
at lines 875–1009 creates a fresh transaction/execution context for OCC retry.
An unavailable index in the captured registry can fail a query immediately;
a relevant concurrent metadata change can instead cause commit conflict.
Read-only transactions do not acquire mutation commit-conflict validation.

These facts do not prove identical authentication ingress, mid-execution user
revocation, search/vector behavior, distributed claims or retention-failure retry.
Do not copy an unexamined Convex policy into Flarex.

The predecessor combined historical data reads with live admission at every
storage frontier: scope/session/fence, lease, journal/claim and post-lock time,
Application/binding heads, then demanded readiness. Publication independently
checks conflicts and complete participant obligations. Its common-observation
candidate reduced repeated observations while retaining that topology. Its
[native measurements](../../packages/executor/benchmarks/core-performance/frontier-candidate-native/README.md)
still miss the fixed additive budget. Its
[scaling witness](../../packages/executor/benchmarks/core-performance/frontier-candidate-scaling/README.md)
also exposes a complete-catalog capacity limit. Neither fewer submissions nor a
passing native graph demonstrates an accepted architecture cutover.

## Recommended Boundaries And Required Decisions

| Owner/fact | Recommended contract | Proof needed before replacement |
| --- | --- | --- |
| Immutable schema, source membership, table/index definitions and executable metadata | Authenticate once, bind to the attempt's version and bounded preparation; record consumed metadata dependencies for settlement. | Concurrent activation/schema/index changes cannot mix versions. Retained versions either remain valid for that snapshot or cause the declared refusal/restart. |
| Row, absence, range, page and relation reads | One original data snapshot plus one attempt-owned pending overlay. | Exact negative/phantom dependencies, original seed evidence, moves/deletes/order changes, dynamic demands and cross-source queries survive settlement validation. |
| Index serving state and coverage | Check only demanded access paths for snapshot-compatible availability. | Backfill, retirement, missing coverage and compaction cannot produce partial or false-empty historical results. Immutable definition reuse is not cached mutable readiness. |
| Principal/revocation, placement, scope epoch and storage fence | Establish the outer context once; retain the explicit live security/ownership policy at actual boundaries. | A revoked, relocated or stale executor cannot perform forbidden reads or publish. Moving a before-data refusal to commit is a behavioral decision requiring explicit approval. |
| Attempt fence, claim and cancellation | One trusted execution lifetime with distributed fencing. | Stale ownership, successor takeover, cancellation and delayed calls cannot escape the selected lifetime or settle twice. |
| Snapshot and metadata retention | One bounded reservation covering every required history/version. | Expiry, stalled execution and pruning fail or restart explicitly; they never silently discard necessary evidence. |
| Installation/maintenance | Bounded authenticated immutable installation preparation plus a fresh maintenance interlock on real transactions. | Actual credentials/database/incarnation, reconnect/restore, writer coverage and maintenance drain remain enforceable. |
| Publication/recovery | One Postgres owner validates final dependencies and constraints and commits data, history/indexes, outcome and supported event intents. | Unknown COMMIT, response loss, conflict retry, duplicate delivery and callback/event behavior remain correct. |

The distinction between an attempt-fixed fact, query availability, live security
and final conflict validation is the architecture decision. Existing row loads,
exclusive locks and proof call chains are mechanisms, not authority definitions.
Replacing them requires preserving their necessary outcomes and identifying any
deliberate change in observable refusal timing.

Keep Application OCC, trusted direct framework commands, finite borrowed
participants and durable workflows as explicit profiles. Medusa and Payload own
native business ordering, hooks and supported workflow/lock semantics. The shared
core supplies snapshot, persistence and settlement mechanics; it does not replace
those framework engines or introduce one universal transaction API.

## Conditional Mechanisms

After selecting the contract, investigate the existing exact-running kernel and
checked-head issuers as construction owners. Do not add an adapter authority
cache, host-owned commit logic, permanent metadata cache or a second executor.

Ordered session/lease/tail acquisition or combined head observation may reduce
submissions **if those facts remain necessary fresh checks**. Such fusion is
conditional, not the selected architecture. It must preserve every earlier
refusal before acquiring later locks, post-lock database time, source preparation
checks and nominal issuer ownership. If a gate cannot be represented faithfully,
preserve its statement boundary.

Existing full/load/replay/durable/seal callers retain their concrete contracts
unless explicitly migrated. Their `afterLoadLock` suspension points cannot move
after a fused statement. A finite owner-private entry may instead use real
PostgreSQL held-lock, early-refusal, post-wait expiry and blocked-interruption
witnesses. Do not select implementations by callback presence.

Any new installed SQL function requires a forward migration and existing
installation attestation of body/signature/owner/namespace/privileges. Preserve
qualified relations, fixed `search_path` and `SECURITY INVOKER`. Native composites
must preserve timestamp, int8 and bytea precision. Returning raw row objects does
not issue a checked capability.

## Catalog Capacity Decision

The unchanged 100-table scaling fixture requires 279 complete ordered physical
definitions against the current 256 limit. Minimal relational primary keys imply
an ordered key index plus each table's creation-time index. Stripping keys,
substituting document tables or raising a local fixture limit invalidates the proof.

A selected core policy is **512 complete required ordered definitions**.
This requires aligned reconciliation, required-build readiness, Application
readiness projection, maintenance and CMS definition preparation. Replacement
can lock a sorted old/new union of 1,024 identities; overflow detection can read
513 rows. Reconciliation is currently one complete-set transaction, not a
resumable 256-item pass. Select any bounded-work replacement explicitly.

Keep independent table, unique, mutation, backfill and byte limits. 512 ordered
definitions does not promise 512 tables or unique constraints. Charge full
catalog/setup/entry/final retention separately from fixed-demand reads. The owner
approved this core policy with this preflight; it is not a fixture-local bypass.
The native schema publisher's independent 256 serial work-item limit remains;
the complete 512/513 boundary proof uses genuine logical catalog admission and
its actual immutable requirement reader.

## Cutover, Cleanup And Acceptance

Inventory every affected private admission/preparation/query/working-set/OCC
contract, installation object, durable journal/protocol format, retained outcome
and caller. Necessary breaks are accepted after scope approval; migrate consumers
and remove displaced paths in the same connected slice. Retain an old profile
only for a named real caller or durable obligation with a removal gate. Select
drain or reviewed migration for affected durable records; no silent deletion.

Use PGlite and ordinary-role PostgreSQL. Prove metadata activation/index retirement
during execution, snapshot/pending and phantom behavior, requested-path coverage,
retention/expiry, revocation/placement/fence, successor claim, interruption,
maintenance/reconnect, first-failure order, rollback and lost-COMMIT recovery.
Change an old test's observable expectation only with an explicit contract
decision and a stronger replacement witness.

Exercise actual Worker Product DTO/missing error, Payload access/hooks/nested
operations and whole-root retry, finite workflow results/events and cleanup.
Rerun the direct five-scenario milestone and fixed native comparison with three
warmups and thirty alternating pairs per branch. Retain the 5/10 ms additive
budget and the unchanged 1/100 metadata matrix. Keep outliers, setup/entry/final
cost, hidden server work and unsupported hosted claims explicit.

Complete proportional typechecks/builds/guards/lint, both project reviews and
substantive-fix reruns. Root owns Git; workers own assigned disjoint edits. Stop
owned runtimes, reconcile the accepted design and roadmaps, and commit only a
complete verified slice. The selected private architectural cutover migrates
finite consumers to confirmed attempt-owned evidence, demanded readiness and
consumed-metadata OCC, and removes the displaced finite choreography. Named
direct, ordinary and durable/recovery profiles retain their declared obligations.
This architectural delivery does not satisfy the fixed numerical performance
gates. Further tuning follows architecture completion; terminal durability
replacement and hosted activation remain separately gated.
