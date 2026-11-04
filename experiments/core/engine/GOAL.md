# Single-owner core refactor goal

Status: **Active implementation goal; bounded Application transactions, snapshots,
caches, shared schema/index lifecycle, five-table physical maintenance and selected
native profiles implemented; broader native, retention, managed-hosting and
performance gates open**.
The owner has requested the complete single-owner refactor, delivered through
bounded connected milestones. This authorization supersedes earlier statements
that this work is documentation-only. It does not decide unresolved guarantees,
approve unspecified durable-data deletion or establish implemented support.

The [accepted architecture](../../../design-notes/flarex-db-accepted-design.md#portable-core-refactor-direction),
[replacement workflow](./REFACTOR.md#convex-guided-replacement-workflow),
[decision register](./DECISIONS.md) and [question queue](./OPEN-QUESTIONS.md)
remain the owning records for architecture, status and unresolved decisions.

Active source baseline: `db914cf06e2b06ee985646611b9e12ed7a770318`, with
[upgrade requirements](./CONVEX-REFERENCE-UPGRADE.md). Affected runtime slices
must refresh their independent source challenge and divergence assessment;
previous checks retain their original source identity and status.

## Finish line

Translate pinned Convex core logic and its physical persistence schema into
TypeScript/Drizzle through the [connected translation plan](./REFACTOR.md#core-and-physical-schema-translation-plan).
Depart only for a demonstrated DO/runtime or required native-behavior constraint,
with the reason, replacement and proof in its divergence record. Existing private
interfaces, physical layouts, optimizations or product-policy choices do not
supply an automatic exception; unresolved observable guarantees retain their
scoped decision gate. The current core in `packages/` and `apps/` is the
destination; the older `experiments/core/src` candidate is retained baseline
material, not a runtime dependency or a permanent second engine.

This is total rewrite scope for current core and integration internals. Existing
APIs, physical schemas, adapter/installer contracts and SQL/lifetime choreography
need no compatibility layer; retain code only where it fits the translated
mechanisms. Payload and Medusa remain schema producers and runtime adapters
above that engine, with intended native behavior and explicit execution profiles.
One shared lifecycle handles logical schema installation/evolution, builds,
validation, progress/recovery and activation. Platform Drizzle storage upgrades
and producer-defined data conversions have distinct responsibilities within the
[installation/migration plan](./REFACTOR.md#framework-adapters-and-shared-schema-installation).

The physical starting point is the Convex PostgreSQL adapter's five core tables:
`documents`, `indexes`, `leases`, `read_only` and `persistence_globals`. Payload/Medusa storage, private
schema/catalog records, logical installation/build/activation and migration
progress sit logically above them. Shared core owners supply required native
constraints; any additional physical family needs a proved DO/native divergence.
Platform Drizzle upgrades of the base storage remain physical maintenance.

Complete the existing core's supported Application, Medusa and Payload paths
through that engine with portable owners and injected Cloudflare Worker/DO adapters
and PostgreSQL as the sole durable authority. One independent app has one logical
owner shared by these profiles. Reuse native business behavior and sound core
logic, migrate consumers and remove the displaced machinery.

At the start, record the actual supported consumer/workload inventory, exact
executing source identities, affected data and applicable acceptance gates.
The [bounded supported-profile baseline](./baseline/README.md) now records
the executing consumer families, source identities and explicit support gaps.
Complete transitive closure and fresh runtime proofs remain slice gates.
Existing public or durable obligations
need evidence; an old fixture or helper alone does not create one. Unrelated
work in progress belongs to its current owner until a coordinated handoff.
Changes to the goal inventory must be explicit rather than silently expanding
coverage while the refactor proceeds.

The goal is complete only when:

- Transaction finalization, snapshot/metadata ownership, pending/committed conflict
  checks, index maintenance/hydration and physical persistence follow the pinned
  mechanisms or have a demonstrated DO/native divergence. Connected conformance
  traces and schema/data cutover prove the translation; a new facade over the
  displaced SQL-command engine does not complete it.
- Supported reads, indexed ranges, misses, absence and pending-state results
  obey their selected snapshot, ordering, authorization and dependency contracts.
- Relevant writers preserve integrity and accepted conflict/retry rules. Bounded
  accepted saves may finish out of order; normal publication and acknowledgement
  remain ordered. Uncertain outcomes are reconciled before unsafe reexecution.
- Shared caches have proven eligibility, coverage, concurrent-fill validation,
  publication invalidation, bounds and restart reconstruction. PostgreSQL remains
  authoritative after DO eviction, replacement or crash.
- Existing supported native services, Local API behavior, hooks, errors,
  workflow visibility, compensation and effects survive the migration. Native
  commands retain their explicit profiles; they do not silently become replayable
  Application OCC mutations or one universal transaction API.
- Core correctness is independent of Cloudflare bindings. Adapters supply host,
  local storage, transport and persistence mechanisms through responsible owners.
- Required schema compilers, native runtime adapters and installation/migration
  consumers use shared owners above/below the translated engine as specified.
  Physical upgrades, logical changes and admitted conversions retain explicit
  meaning and recovery; no old per-framework installer survives as a fallback.
- The five-table starting point and logical framework/lifecycle representation
  are proved through initial installation, index/build and constraint semantics,
  restart/recovery and required data cutover; extra physical storage has a named
  DO/native justification. A table-count reduction alone does not satisfy this.
- Every in-scope consumer uses the replacement path, and displaced code, exports,
  dependencies, fixtures and obsolete planning guidance are removed. Retained
  paths need a named obligation and removal gate.
- Required owner/consumer regressions, reviews and database/host proofs pass,
  applicable complete-request performance gates pass, scoped changes are committed,
  and documentation describes implemented evidence accurately.

An incomplete proof, unmet performance gate, unresolved required guarantee or
exhausted time/token budget does not make the goal complete.

## Milestones

These describe connected outcomes; source findings may change their dependency
order. Each milestone includes native consumer checks where its boundary reaches
those consumers.

| Milestone | Required outcome |
| --- | --- |
| Establish the baseline and challenge the first slice | Record supported consumers and compare current owners, the accepted direction and pinned Convex mechanisms; select the exact point/range path, writer connections and cleanup boundary. |
| Translate the core/persistence contract and physical schema | Map transaction finalization, versioned document/index logs, same-timestamp ordinary-index hydration, private metadata, fenced batches, outcomes and retention to current owners; resolve necessary DO/native adaptations and named-data disposition before connected cutover. |
| Snapshot reads and cache/index adapters | Replace a real existing point/range read with a portable snapshot owner, timestamp-preserving PostgreSQL misses and injected local storage; prove actual DO composition and cache coherence before enabling reuse. |
| Pending state, dependencies and acceptance | Preserve profile-correct read-your-writes, exact dependencies, native visibility and outer settlement while replacing the affected attempt/validation machinery. |
| Persistence, publication and recovery | Implement the accepted save/publication order, fencing, durable outcome reconciliation and cache/bootstrap recovery through the correct owners. |
| Required index lifecycle and integration migration | Prove the lifecycle/build/readiness paths required by the recorded inventory and migrate remaining Application, Medusa and Payload consumers without rewriting native business algorithms. |
| Shared installation/migrations and framework adapters | Rewrite schema producers and runtime translation over the shared engine; prove required physical upgrades, fresh logical installs/replay, builds/activation and named conversions/cutover migrations through common progress/recovery owners. General populated-data evolution keeps its sequencing boundary. |
| Retirement and complete-flow acceptance | Remove displaced paths, run the full relevant workload/host/scale comparisons and close every required correctness, performance, review and cleanup gate. |

The [starting-slice record](./REFACTOR.md#recommended-starting-slice) is the first
candidate. Its mechanism choices remain subject to the required source challenge;
authorization to implement the goal is not acceptance of every proposed detail.

The [bounded operation-local replacement](./slices/01-snapshot-reads.md) is
implemented. The [timestamped cache-transfer slice](./slices/02-timestamped-cache-transfer.md)
now connects exclusive query-cache handoff and guarded PostgreSQL refresh to
the existing Application query path. Neither closes the wider
snapshot/DO milestone or the complete goal. The bounded
[actual-DO query composition](./slices/03-application-query-do-host.md) now executes
the genuine query path with default local workerd and ordinary PostgreSQL.
The [mutation pending-state replacement](./slices/04-mutation-pending-state.md)
records independent source challenge and peer convergence. Its first
[range-evidence prerequisite](./slices/04a-range-completion-evidence.md) is
implemented for newly executed operations. The bounded
[incremental shared-root index replacement](./slices/04b-incremental-pending-indexes.md)
now connects accepted Application/native writes to ordered current positions and
written-ID suppression, preserving profile-specific interpretation and failure
order. The real Standard cutover and stored-profile disposition remain open;
these replacements do not repair older journal readsets or complete that milestone.
The [Standard cutover contract](./slices/04c-standard-mutation-cutover.md) records
the connected preparation, ordered admission, stored-request and recovery
requirements. Its genuine current nested-failure prerequisite is implemented;
the connected [operation-admission replacement](./slices/04c1-application-operation-admission.md)
is implemented. The ordinary Standard cutover is in progress; complete acceptance
remains open.
The [exact-original preparation prerequisite](./slices/04c2-exact-selection-preparation.md)
is implemented for existing finite Product/Payload consumers, including full
callable-catalog coverage and explicit installation reconciliation. Ordinary
Standard finite activation and recovery remain open.
The [ordinary Standard replacement](./slices/04c3-standard-finite-execution.md)
has completed independent challenge and peer exchange. Its connected runtime
implementation is in progress; the affected historical-data path requires the
[stored-attempt disposition](./05-stored-attempt-disposition.md).

The bounded [joint Application/Payload/Currency relation writer](./slices/04c3e-cross-domain-relation-maintenance.md)
uses one current preparation generation and the existing combined publisher.
It preserves native execution and maintains Application edges, adjacency and
facts. Like standalone source CMS, it corrects future writes without certifying
historical sidecar coverage or closing maintained-serving readiness.

The [fresh Application transaction/persistence cutover](./slices/06a-application-persistence-cutover.md)
now has a completed current-pin independent challenge and peer exchange, with
a bounded translated core and connected consumer implemented. It connects the real Standard
nested user Worker to the translated five-table owner on fresh data. Existing
scopes/native consumers remain named migration inputs. This does not complete
physical cutover, app-DO ownership or the broader goal.

The [Application SDK query extension](./slices/06b-application-sdk-queries.md)
connects the current Worker query builder and source-derived range/stream/cursor
mechanisms through the selected snapshot owner. Its independent challenge and
peer exchange are complete; the bounded fresh mutation path is implemented.
Standalone query functions, native predicate migration and actual app-DO
ownership remain separate gates.

The [shared Application owner](./slices/06c-shared-application-owner.md) has
completed independent source/current-owner/design challenge and peer exchange.
Its bounded implementation joins standalone query functions and fresh
mutations in one canonical app DO, with coherent metadata/snapshot selection and
read-only completion. Local actual-host and both-driver evidence cover the
selected configured app; managed-host, broader writer/profile and full goal
gates remain open. A second query database is not the destination.

The [snapshot and shared page translation](./slices/06d-snapshot-index-cache.md)
now connects retained snapshot selection, local leader retention validation,
versioned resident metadata, operation coverage and exact shared index pages to
this fresh owner. Normal points use ById singleton ranges; publication invalidates
pages before exposing the next snapshot. Standard invocation owns separately
bounded root query/mutation admission; the DO requires explicit workload settings.
The bounded implementation is validated in both database lanes and the actual local host. Retain-all mode has no live GC
writer; production memory/capacity, full GC, native/schema cutover and managed
hosting remain open gates. Its TypeScript weighted-cache maintenance and DO
resource configuration are recorded as focused necessary runtime adaptations.
The current acyclic internal-call profile remains a recorded translation item:
the pin permits depth-bounded recursive calls, while the existing kernel rejects
an active ordinal. Its current supported restriction is not a demonstrated
DO/native necessity or a permanent source-parity exception; follow its explicit
disposition in slice 06c before closing the overall translation goal.

The [shared schema lifecycle](./slices/07-shared-schema-lifecycle.md) is implemented
and validated locally after independent challenge: logical proposal/validation, versioned table
counts, full historical iteration/backfill, enabled/pending index generations
and atomic schema/index/program activation, with real Application caller and
Worker table-mapping migration. Its parallel platform lane consolidates the
five-table Drizzle definition and explicit physical maintenance. Native
activation still requires shared authenticated write ownership, exact values,
uniqueness and references; current producer representability is not cutover.

## Mandatory challenge before each slice

Before implementation, independent sub-agents inspect and challenge:

1. The current core's executing owners, callers, tests and actual costs: identify
   semantic obligations, reusable logic and replaceable choreography.
2. The pinned Convex owner, relevant callers and tests: establish the actual
   mechanism, invariants, concurrency order and failure/recovery behavior.
3. The proposed replacement against both: test assumptions with concrete
   counterexamples, identify retained bottlenecks, missing writer participation,
   unnecessary abstractions and changes to supported behavior.

Use Convex revision `db914cf06e2b06ee985646611b9e12ed7a770318`, the
[source map](../REFERENCES.md#convex-source-identity) and the actual source files;
do not substitute remembered behavior. Agents first form independent findings,
then exchange evidence and challenge each other's conclusions. The coordinator
records convergence, unresolved disagreements, current owner -> pinned mechanism
-> keep/adapt/replace -> correctness cases -> removed code, and the bounded
implementation contract before dispatching affected code work.

The coordinator resolves ordinary source/implementation questions with evidence.
An unresolved change to guarantees requires a recorded owner decision before the
affected path proceeds. Independent authorized work continues. Accepted choices
and routine TypeScript adaptation do not require repeated approval.

## Coordinated implementation

Use implementation sub-agents with explicit responsibility/file ownership,
consumer contracts and expected validation. Tell each worker that others share
the codebase; do not revert or overwrite their changes. Coordinate cross-owner
changes directly, sequence overlapping edits and integrate through the existing
semantic owner. Agents must not invent competing settlement, cache authority or
framework behavior to work around missing contracts.

Copy or translate the pinned Convex mechanism as closely as the host and native
contracts permit. Each necessary mechanism difference needs a dedicated
[divergence record](./divergences/README.md) before affected implementation,
including why it is necessary and how the replacement works. A record does not
itself accept a new guarantee change.

Significant code changes still require both root-mandated read-only project
reviewers after implementation: `typescript-diff-reviewer` and
`code-quality-diff-reviewer`, using the model/effort specified in
[AGENTS.md](../../../AGENTS.md). Pre-slice challenge does not replace these reviews.
Fix findings, rerun affected validation and reviews as required, and create
scoped commits without including unrelated work.

## Validation and exclusions

Apply [VALIDATION.md](../VALIDATION.md), including complete native business
graphs and separate Application evidence. Database semantics require PGlite and
focused ordinary-role real PostgreSQL lanes. DO storage, lifecycle, interleaving
and restart claims require the actual Cloudflare host; Node or local mock
conformance is insufficient. Keep quiet performance runs separate from competing
load and stop only resources owned by this work.

The owner's current compiler selection is installed Oxc
`tsrs@0.20.1-ts7.1.0-beta --fast` for scoped checks. Do not run native `tsc`/`tsgo`
or scripts that invoke them. A suspected checker false positive pauses the
affected path for a direct report with the exact command, diagnostic, source
identity and uncertainty; do not suppress it or change valid code merely to
silence it. Native comparison needs separate authorization. Compiler benchmarks
remain stopped. This selects validation tooling, not weaker runtime guarantees.

Use the recorded [performance gates](../VALIDATION.md#acceptance), the
[performance owner](../../../roadmaps/core-performance/README.md#acceptance-is-complete-request-cost)
and profile-specific contracts. Declare admitted workload sizes, concurrency and
throughput/tail targets before judging capacity; do not invent missing targets,
weaken existing ones or infer capacity from helper speed or fewer SQL calls.

Replication remains explicitly deferred. Arbitrary new framework coverage,
complete Convex feature parity and production rollout are outside this goal.
Single-owner correctness, required hosting proof and migration of the recorded
supported scope remain inside it.

The connected [numeric validator translation](./slices/08-validator-literal-parity.md)
implements Int64/signed-zero representations through protocol, SDK, analysis,
manifest compilation, stored metadata, hashing and real Worker execution. It also
shares ordered source record admission and bounded foreign capture. This does
not complete validator parity: explicit source-wire, search/vector and shape
gates remain open alongside supported-consumer and full-core acceptance.
The [source validator translation](./slices/09-source-validator-wire-parity.md)
implements Source DTO grammar, parser phases, document roots, Function/CommitTs
validators and fresh authenticated encoding 2 through current owners. Its narrow
stored CoreProgram reader preserves original identities and outcomes; the real
SDK/Worker and physical-row witnesses keep current transport separate. Remaining
external/native retained-store cutover, broader source features and full-goal
acceptance stay explicit; existing private wire layouts are not permanent
mechanism exceptions.

The [managed scalar Payload replacement](./slices/10-payload-native-core-cutover.md)
connects the existing fresh source-backed consumer after the three-way challenge.
Shared installation reserves native ownership; confined bindings, explicit native
observations, required-text uniqueness and tagged durable outcomes use the
translated core. Application snapshot semantics and its unsupported-native
manifest gate remain intact. Actual Local API, database reopen and cancellation
proofs cover this bounded path; remaining native profiles, multi-source and
retained-data cutover, native hosting and performance remain required goal gates.

The next connected [indexed scalar Payload slice](./slices/11-payload-indexed-scalar.md)
implements indexed queries, compound/null uniqueness and shared request capture
limits after its independent mechanism challenge and old-profile concurrency
characterization. Its bounded database/consumer verification, independent review
and selected fixture retirement are complete. This does not close broader
native, managed-host, retained-data or performance obligations.

The bounded [Currency/composition slice](./slices/12-medusa-currency-composition.md)
has completed independent current/source/design review, peer challenge,
existing-profile characterization and coordinated implementation handoff.
Its selected real consumer combines Currency, Payload Local API and a trusted
Application insert. Preserve demonstrated native first-observation reads,
source-bound child capabilities and one settlement. Shared source, value,
transaction and native host replacement executes the genuine consumer through
five-table persistence. Product/strong-reference and joint relation consumers
retain the named Legacy closure until their connected migration. This does not
activate the broader giant fixture or general mixed API.

The [transaction ID replacement](./slices/13-transaction-id-generation.md)
implements the pinned transaction-local generator, connected allocation/validation
order, metadata newness and batched previous-revision search. The selected callers
use trusted entropy rather than complete-ID injection. Stored IDs and secrets
retain their identity; construction cancellation and numeric history ordering
belong to their shared owners. Its bounded proof and displaced-allocator retirement
are complete. This is a Source-parity correction without a new DO/native algorithm
exception; broader goal gates remain open.

The [optional-one reference continuation](./slices/14-native-reference-integrity.md)
has completed independent current/source/design challenge and peer exchange.
It implements genuine Payload direct relations/population/preferences and the joint
Currency/Payload/trusted audit consumer, including the named populated
scalar-to-relation successor and compatible audit-only source evolution. It reuses
the shared index builder, preserves active native ownership during pending
preparation, and atomically activates complete policy/index/schema state.
Native late-integrity checks remain separate from semantic observations.
The selected replacement and connected two-driver proof are complete; its many/join
continuation is below. Product, developer-UDF borrowing, query-sync feed retirement
and broader goal gates remain named retained.

The [fresh many/join replacement](./slices/15-native-many-and-joins.md) implements
the genuine fixed producer and consumers after independent challenge and peer
exchange. It preserves fresh-only installation and upgrade refusal while replacing
physical occurrence machinery with authenticated private logical memberships and
ordinary Source indexes. ID-only admission, confined joins, native accounting,
source observations and late integrity have paired owner/consumer proof. The
connected relation workload construction uses the same current owner without
restarting performance measurements. Its selected replacement and bounded
regressions are complete; the remaining native, retained-data, hosting, package
boundary retirement and performance obligations keep the full goal open.

The [Product, Links and protected-reference continuation](./slices/16-native-product-links-and-references.md)
now supplies the complete admitted Product graph, logical relational integrity,
native query execution and same-root durable event storage through current Core
owners. The selected original/authored Product, Links, protected actual Worker
authorization/race/recovery and app DO paths have connected proof and independent
review. Selected obsolete helpers are removed; the slice names retained finite,
journal, workflow and performance consumers with their removal gates.
The [app-owner recovery prerequisite](./slices/16a-app-owner-recovery.md)
preserves Source's terminal committer stop through portable generation
supervision, whole-scope drain, all-inflight reconciliation and fresh services.
It is connected to the actual DO and native Product caller-retry path. These
bounded replacements do not close remaining modules/workflows, named data,
managed hosting, package retirement or paused performance obligations.

The [ordinary atomic workflow and Tax continuation](./slices/17-native-atomic-workflows-and-tax.md)
has completed independent current/design/Convex challenge and peer exchange.
Its connected implementation replaces the old relational-session workflow host
with one Core root, first through complete admitted Product-only/Currency
workflows, then through the complete Tax source and eight workflow families.
Native REAL, compound eligibility and flush/checkpoint phases belong to shared
owners. The selected replacement, complete admitted consumer closure and obsolete
fixture retirement have connected two-driver proof. Task, finite borrowed,
later multi-source graphs, retained data and actual Native17 managed hosting
keep their named migration gates; the complete rewrite remains active.

The [multi-source Product/Variant continuation](./slices/18-native-product-multi-source-workflows.md)
implements the complete eight existing create, update, delete and batch roots,
eight business participants and 30 business tables through Native17's shared
owner and fresh schema lifecycle. Complete paired consumer proof preserves
actual empty children, exact values, ownership races and original resource
policies. Shared equality-prefix lowering retains Pricing's full null-plus-text
index declaration and ordinary all-value index. Repository/event failure
observation and private origin equality preserve complete native Causes without
new operations or authority. Selected obsolete construction is removed; named
Legacy consumers retain explicit removal gates. Populated conversion, other
native/Task/finite consumers and wider hosting and performance acceptance remain
open; the complete rewrite remains active.

The [Inventory deletion and Variant read continuation](./slices/19-native-inventory-and-variant-read-workflows.md)
owns the complete three retained consumer families after independent challenge
and renewed peer exchange. Their implemented closure includes the authentic ninth
Channel/Location Link source and distinct native resource profiles. The shared
relational lowerer translates admitted composite-key suffix reverse access into
ordinary Source indexes, preserving authenticated identity and complete-history
selectivity. Paired owner and genuine native proof cover these mechanisms, and
the displaced standalone fixtures are retired. Complete consumer coverage passes
on both database lanes, and connected regressions are complete. Populated
conversion and other goal gates remain open.

Its genuine setup also requires the
[native scope-exclusion prerequisite](./slices/19a-native-scope-exclusion.md).
Trusted Core admission and settlement owners implement the admitted selected-
callback and competing-writer boundary after independent challenge, with paired
owner and genuine native proof. Ordinary OCC alone cannot replace that boundary;
complete consumer coverage and connected regressions are proved. Wider hosting
and other goal gates remain open.

The [complete Inventory maintenance continuation](./slices/20-native-inventory-maintenance-workflows.md)
replaces the remaining eleven admitted standalone workflow/read families after
independent current-core, accepted-direction and pinned-source challenge and peer
exchange. It preserves genuine two-source and neighboring five-source closures,
per-facade exclusion, queued-only batches, native inverses and original bounds.
Its [declared equality prerequisite](./slices/20a-native-declared-equality-indexes.md)
corrects the shared omission of authenticated unconditional text declarations
through ordinary Source indexes, preserving existing index identities. Paired
neutral owner and genuine producer/schema characterization cover the correction;
complete consumer coverage and connected fixture regressions pass on both database
lanes. Shared fixture hosts follow the existing lazy selection contract and
validate authority before callbacks. Selected obsolete fixture construction is
removed; named direct-service and paused Task consumers retain their own removal
gates. The full goal remains active.

The [complete Pricing maintenance continuation](./slices/21-native-pricing-maintenance-workflows.md)
is selected after independent current/design/pinned-source challenge and peer
reconciliation. Preserve all ten ordinary roots, their removal read and receipt
callers, original bounds and genuine retained native inverses. Its shared
prerequisites translate closed PostgreSQL predicates over captured Core rows and
authenticated native restoration through bounded index/canonical history with
historical schema proof. The [bounded physical-history prerequisite](./slices/21c-native-history-physical-pages.md)
extends the existing ordered index with timestamp and limits physical tuples
before time eligibility. Existing installations require an explicit data-preserving
platform upgrade after actual runtime/SQL drain. The five tables, Source
observations, fresh internal-ID rules and one settlement authority remain.
Native construction and caller retirement, corrected predicate/history owners,
the data-preserving upgrade and focused plan proof have scoped connected
acceptance and completed review. Named remaining consumers, paused
Task/finite/performance work and broader goal gates remain open.

The [Stock Location/Sales Channel continuation](./slices/22-native-stock-location-sales-channel.md)
has migrated the complete already-admitted ordinary consumer construction to
Core, including required Links, Location/Fulfillment Set creation and the existing
Fulfillment Set deletion forest. Source producers preserve logical storage and
data-only setup; native callbacks, retained inverses and exact publication retain
their existing owners. The [atomic admission correction](./slices/22a-native-atomic-admission.md)
preserves implicit and explicitly selected native identity limits in live and
recovery frames. Selected obsolete fixtures are retired after caller migration.
Bounded connected validation and review are complete; named remaining consumers,
Task-backed fulfillment, hosting, component-scope and performance gates remain open.

The [Store continuation](./slices/23-native-store-workflows.md) has replaced
complete admitted creation/update/deletion construction, including genuine
Pricing callbacks and retained inverses. Independent challenges identified and
translated same-root child reconstitution through existing Core pending/deleted/
original owners, preserving proven identity/creation time and its authenticated
timestamp policy. Recorded historical replay remains separate. Dedicated old
Store fixtures are retired; required scoped validation and review are complete.
API Key follows as a separate complete connected slice. Broader native, hosted,
Task and performance gates remain open; the full goal is unchanged.

The selected [API Key continuation](./slices/24-native-api-key-workflows.md) has
replaced all five admitted roots and retired their dedicated Legacy fixtures.
Core schema producers preserve exact source grants, durable Link operation
receipts and pair revisions. Trusted SDK invocation identity and native replay,
fencing and cancellation remain with their existing owners. The trusted deletion
facade selects a named allowance for the complete graph, with ordinary-budget
rollback preserved. Bounded connected validation and review are complete. The
full goal remains open; finite, Task and performance work remains paused.

The [Order Change continuation](./slices/25-native-order-change-workflows.md)
has replaced all four admitted ordinary workflow roots and retired their
dedicated Legacy fixtures. The complete 23-model source retains its 34
conditional declarations through the [shared index lowering](./slices/25a-native-non-null-indexes.md).
Authenticated bindings use ordinary Core field indexes. Paired acceptance for
this family is complete. Broader native and hosted gates remain open.

The [Order Archive and Completion continuation](./slices/26-native-order-status-workflows.md)
has moved both admitted status roots to the shared Core Order fixture and
retired their dedicated Legacy fixtures. Both preserve the full Order source,
retained status inverses, ordered events and callback-free recovery.
Completion retains its confined finite hook. Bounded paired acceptance is complete.

The [generated serial and Order creation continuation](./slices/27-native-order-generated-serials.md)
moves standalone Order creation and deletion and Order Change Action ordering
to Core. The ordinary descending query and existing commit validation preserve
native max-plus-one values. The neutral owner and both direct consumers passed
paired acceptance. The checkout participant remains a separate cutover.

The [checkout Order continuation](./slices/28-native-checkout-order.md) moves
the existing Order workflow participant onto Core, including native graph
accounting and the retained inverse. The paired Order cases passed. Full
Cart checkout and Payment finance retain their connected gates.

The [Cart completion and exact-price continuation](./slices/29-native-cart-completion-exact-price.md)
moves both workflows onto Core through the complete nine-model Cart source
and the existing Order participant. The Legacy PaymentCollection fixture
retired both profile switches. Paired acceptance is complete.

The [Cart creation and refresh continuation](./slices/30-native-cart-creation-refresh.md)
moves creation, refresh and ownership onto the same twelve-model Core Cart
source used by completion and exact-price checkout. Paired acceptance is
complete.

The [selected native Promotion related-predicate continuation](./slices/31-native-promotion-related.md)
uses the existing Core transaction and evaluator owners for the two related
cohorts required by automatic Promotion. Paired acceptance is complete.

The [Customer selection and Cart group read continuation](./slices/32-native-customer-selection.md)
moves both selected Customer consumers onto the complete four-model Core
source. Paired acceptance is complete.

The [native Cart context read continuation](./slices/33-native-cart-context.md)
uses the complete Region source with the existing Store and Sales Channel
sources under one Core root. Paired acceptance is complete.

The [Cart PaymentCollection continuation](./slices/34-native-cart-payment-collections.md)
moves genuine collection creation and linked refresh onto Core through the
complete Payment and Cart Link sources. Paired acceptance is complete.

The [full native Cart creation continuation](./slices/35-native-cart-creation.md)
moves the genuine eighteen-participant root and the dedicated Promotion Link
preimage workflows onto Core. Paired acceptance is complete.

The [full native checkout continuation](./slices/36-native-checkout.md) moves
the genuine ordinary and Customer checkout profiles and their connected native
callbacks onto Core. Paired acceptance is complete.
