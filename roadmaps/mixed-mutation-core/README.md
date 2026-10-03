# Mixed Mutation Core

## Status And Scope

Status: the Application, Product, selected Payload Local API, and finite
Medusa workflow slices are implemented as a private, isolated-scope execution
profile. The finite-root redesign is delivered for that graph; its proposed
latency goal is unmet. The [mixed mutation design](../../design-notes/flarexdb-mixed-mutation-execution.md)
owns architecture and open contract questions. This roadmap owns current status,
sequencing and finite delivery gates. Numbered slice preflights own their
specific scope, decisions, affected contracts and remaining gates. The
[execution redesign](./14-execution-redesign-roadmap.md) owns the delivered
connected latency work and its remaining goal: [admission/protection](./15-admission-protection-preflight.md) is
delivered with its measured stage cost gate passed; [batched reads](./16-batched-read-execution-preflight.md)
is delivered with its measured stage cost gate passed;
[settlement](./17-batched-settlement-preflight.md) is delivered with its measured
structural stage cost gates passed. Delivered
[aggregate entry and prepared source graph](./19-aggregate-entry-preflight.md)
passes its stage gates, including atomic creation-plus-entry and complete initial
authentication. It precedes reserved
[host lifecycle](./18-host-lifecycle-preflight.md), which remains conditional on
attributable evidence. The selected successor is the
[execution foundation plan](./14-execution-redesign-roadmap.md#selected-foundation-replacement):
complete [query-required mixed reads](./20-query-required-read-execution-preflight.md)
first, then finite contribution/settlement/recovery under an explicit terminal
durability decision, and connected whole-request acceptance. Query-required
mixed reads have an incomplete implementation checkpoint from the verified,
committed standalone-read and framework-organization handoff. The owner resumed
its failing-consumer correction in slice 21. Its selected contract and fixed native budget
are recorded in slice 20; added latency and complete request performance fail
acceptance, and connected validation remains open. The predecessor's remaining standalone latency and hosted gates
stay with their owners.

The implemented [direct core performance harness](./21-core-performance-harness-preflight.md)
places daily framework/database measurement in executor test composition, with
an in-process driver and explicit full-sample/SQL modes. Worker integration remains
a separate host proof. The shared mixed source-preparation failure and catchable
pre-effect document-validation recovery are corrected at their persistence
owners. Bounded native seed-host reuse reduces fixture work. Cold readiness and
index construction remain significant; wider slice 20 acceptance remains open.
The [direct measurement ledger](../../packages/executor/benchmarks/core-performance/README.md)
owns observations and the remaining harness costs.

[Core performance](../core-performance/README.md) owns the standalone native-read
replacement and reusable measurement rules. Its earlier small checked-read,
publication, admission and seal sequence is historical for this mixed successor.
Local checks remain proportional; cross-component changes and package completion
require the connected mixed measurement. The new plan targets native demand plus
small, explicit platform overhead, rather than accepting fewer SQL submissions
alone. Current mixed authority and recovery contracts remain in force until their
named replacement and validation gates pass.
Slice 15 extends immutable target protection under existing full
attestation and privileged quiescence. Slice 16 accepts tentative finite native
construction after full root entry and fresh live checks at actual storage
frontiers. Later slices and new authority contracts remain gated. The implemented
[first Application and Product attempt](./01-application-product-attempt-preflight.md)
uses the real Worker, Product service and shared journal/commit owners. It is
not activated on a named durable environment and exposes no public authoring API.
The [Payload Local API attempt](./02-payload-local-api-attempt-preflight.md) adds
one pinned native create, update and find-by-ID lifecycle under the same root.
The [finite Medusa workflow preflight](./03-finite-medusa-workflow-preflight.md)
owns the implemented finite private workflow profile in isolated scopes.
The [performance baseline preflight](./04-performance-baseline-preflight.md)
owns the measurement package. Its original ordinary-PostgreSQL sample set
remains a partial historical record because a finite-workflow cold request
reached its existing deadline. The corrected, complete series closes that
private cold-workflow cost gate.
Named-environment activation and public authoring APIs remain separate gates.
The [core query cost preflight](./05-core-query-cost-preflight.md) owns the
implemented bounded persistence correction and its cost comparison. It does
not change the original baseline record or admit another framework operation.
The [low latency execution preflight](./06-low-latency-execution-preflight.md)
has completed its first connected package: a cheaper fresh physical-search
query shape and removal of redundant empty admission transactions before
checked reads. The [retained candidate series](../../packages/flarex-backend/benchmarks/mixed-mutation-core/admission-cost/README.md)
has 104/104 successful traced samples and 104/104 successful untraced samples
with unchanged business graphs. The [selected evidence admission preflight](./07-selected-evidence-admission-preflight.md)
owns the completed bounded Application activation/readiness query package and
its ordered-failure contract. Its [traced smoke and full untraced records](../../packages/flarex-backend/benchmarks/mixed-mutation-core/selected-evidence/README.md)
show fewer selected-metadata dispatches with unchanged transaction counts, but
no overall endpoint gain: the mixed warm untraced median is 6.699 s versus
6.761 s in the prior candidate, while Product and Product plus Payload rise.
The [fundamental latency redesign preflight](./08-fundamental-latency-redesign-preflight.md)
owns the delivered finite restartable root, first protected immutable
Application preparation under the amended writer/threat contract, fresh live
admission, and authoritative recovery/settlement. Its
[retained measurements](../../packages/flarex-backend/benchmarks/mixed-mutation-core/fundamental-latency/finite-root/README.md)
include clean traced smoke and 104/104 successful full untraced requests. Full
warm outer medians are 1.759 / 2.420 / 5.284 / 0.343 s for Product, Product
plus Payload, mixed workflow, and standalone workflow. The first traced smoke
overlapped a repository root inventory scan; its samples are retained but its
timings are excluded from latency conclusions. The three proposed mixed warm
latency goals remain unmet. The delivered bounded [checked operation composition
slice](./09-checked-operation-composition-preflight.md) now has
[retained quiet trace and full untraced evidence](../../packages/flarex-backend/benchmarks/mixed-mutation-core/checked-operation-composition/README.md):
Product and Payload preparation combines admission with working-set construction
and pending hydration; workflow keeps ordered member validation and combines
its bundle check with construction; primitive borrowed `get` combines admission
with its exact read. Later calls retain fresh checks. Unknown-input reads whose
capture could invoke foreign code retain separate checks, and workflow's
per-member source validation remains outside its final bundle transaction.
The quiet trace reduces selected SQL and transaction counts, while full warm
medians are 1.849 / 2.265 / 4.847 / 0.318 s. Product regresses against its
finite-root warm median; the three mixed latency goals remain unmet. The
[fresh admission evidence slice](./10-fresh-admission-evidence-preflight.md)
is delivered with [retained quiet trace and full untraced
evidence](../../packages/flarex-backend/benchmarks/mixed-mutation-core/fresh-admission-evidence/README.md).
Application binding, readiness, index and unique owners reuse freshly
authenticated head, schema and selected frontier evidence only inside the
same checked transaction; callback exit revokes it, missing heads are not
cached, and a later operation repeats live admission. The quiet trace reduces
SQL dispatches to 2,256 / 3,018 / 5,872 / 452 with transaction counts
unchanged at 82 / 105 / 199 / 6. Full warm medians are 1.552 / 2.014 /
4.471 / 0.309 s. The mixed latency proposals remain unmet. The delivered
[attempt-local admission slice](./11-attempt-admission-preflight.md) lets
finite-root local operations stay tentative without
an empty SQL admission, while every actual database access, aggregate seal and
later publication retains full fresh checks. A local step may learn about
persisted revocation at the next database boundary. The same connected slice
reuses selected source evidence inside the existing publication transaction
and batches equivalent selected index/unique coverage updates in groups of
at most 32. Selected table-frontier reads are shared and combined through
their existing owner, with batches of at most 64 tables. Its [retained measurements](../../packages/flarex-backend/benchmarks/mixed-mutation-core/attempt-local-admission/README.md)
show warm outer p50/p95 of 857.9/884.6, 1,000.2/1,053.2,
1,782.8/1,808.8 and 286.5/339.8 ms, with traced SQL counts
1,063 / 1,378 / 2,173 / 361 and transaction counts 41 / 52 / 78 / 6.
The mixed latency proposals remain unmet. Standalone median passes its
regression gate; its p95 rises about 5.4% and its 698.6 ms warm maximum is
retained with zero exclusions. Fresh checks at actual database boundaries
remain a measured cost owner. This previous checkpoint preceded slice 15's target
protection extension; cheaper epoch attestation remains separately gated.

The [compact checked-access preflight](./12-compact-checked-access-preflight.md)
is delivered for the existing connected private graphs: thirteen consumed
checked-session scalars, six rather than seven ordinary kernel SELECTs,
and a full selected binding prefix reduced from four SELECTs to two. Reload,
acquisition and recovery retain hidden-child eligibility checks; candidate
and complete lane reads also combine for their current standalone consumers.
Application, index, unique and search readers retain concrete ordered lock,
post-wait snapshot/time and refusal-order obligations recorded in the preflight.
The [retained compact-access measurements](../../packages/flarex-backend/benchmarks/mixed-mutation-core/compact-checked-access/README.md)
show **990 / 1,274 / 1,997 / 354** SQL dispatches, with transactions unchanged
at **41 / 52 / 78 / 6**. Full warm p50/p95 is **867.8/993.0,
1,067.8/1,212.1, 1,954.1/2,677.3 and 303.8/388.9 ms**. Medians rise
**1.2% / 6.8% / 9.6% / 6.0%** against the prior series: this delivers fewer
dispatches, with no endpoint latency improvement. Mixed goals remain unmet;
standalone passes its below-400-ms median and less-than-10% regression gate.
All outliers remain, including the mixed workflow 3,801.1 ms warm maximum.
The cutover expands neither metadata protection nor
connection attestation; mutable readiness, physical checks and the full epoch
guard stay fresh. The preflight also distinguishes the scalar checked kernel
from separately owned argument/grant body authentication and records its
publication proof limitation without claiming a new tamper guarantee.

The [dependency-validation preflight](./13-dependency-validation-preflight.md)
is delivered for the existing private finite graph. Checked internal reads
select complete source dependencies; multi-source workflows derive one union
from their actual issued states and share its common proof only inside the
same read transaction under the exact requested source set and existing common
identities. Every source still checks its own method/root authority and head
pin. Required readiness stays fresh; unrelated post-entry unready definitions
may permit tentative reads while full seal refuses durability. Full entry,
aggregate seal, publication, standalone and durable-operation checks remain
mandatory. Indexed historical hydration reuses the existing row query/decoder,
with bounded body transfer and sequential decode/observation/budget/state order;
point and seed hydration retain their paths.
The [previous bundled checkpoint](../../packages/flarex-backend/benchmarks/mixed-mutation-core/bundled-dependency-validation/README.md)
has SQL dispatches **988 / 1,252 / 1,979 / 354**, with transactions unchanged
at **41 / 52 / 78 / 6**. Warm p50/p95 is **940.7/1,166.4,
1,087.1/1,176.3, 1,787.7/1,960.0 and 319.8/403.4 ms**. Median changes versus
compact access are **+8.4% / +1.8% / −8.5% / +5.3%**. Latency does not improve
across all workloads: Product, Product + Payload and standalone medians rise;
mixed workflow falls. No cause for the distribution changes is established.
Mixed targets remain unmet; standalone retains its below-400-ms median and
strictly-below-10% regression gate. All outliers remain, including Product's
3,355.9 ms warm maximum. The
[separate-closure measurements](../../packages/flarex-backend/benchmarks/mixed-mutation-core/dependency-validation/README.md)
remain a distinct historical checkpoint, including their 2,501-dispatch workflow
and prior verified source receipt. Exact operation closure requires planner
completeness proofs, and further decode/hash or driver/server/wait cost work
requires attributable measurements. Reduced catalog attestation and privileged
maintenance enforcement retain explicit contract gates; neither a method grant
nor a stable digest supplies them.

The delivered [admission/protection slice](./15-admission-protection-preflight.md)
extends the existing epoch to **23 immutable target tables** and reuses protected
canonical Application activation, legacy revision-schema and selected binding
activation/candidate/complete-lane structures through their actual owners.
Exact accepting-transaction clock observations use the kernel's held strong lock
and expire on exit or a same-transaction clock mutation. Full restricted-login
and installation attestation, fresh heads/readiness/physical evidence and the
mandatory full tail guard remain. Current relation Fold callers retain full proof.
The [prepared-admission measurements](../../packages/flarex-backend/benchmarks/mixed-mutation-core/prepared-admission/README.md)
show **862 / 1,068 / 1,663 / 354** dispatches with **41 / 52 / 78 / 6** transactions,
meeting the original **871 / 1,081 / 1,688 / 354** stage ceilings. Warm p50/p95 is
**783.7/1,011.6, 973.8/1,006.0, 1,676.6/1,714.8 and 309.4/395.3 ms**.
Actual lazy fills add **3 / 4 / 7** full captures in the request/series-owned
benchmark lifetime. Standalone passes its median gate; the three final mixed
latency goals remain unmet. All maxima are retained, including mixed workflow's
**2,800.9 ms** sample, with zero exclusions.

Delivered [bounded read execution](./16-batched-read-execution-preflight.md)
retains source-wide readiness and moves repeated finite method/setup checks to
aggregate full entry and actual bounded storage frontiers. Local construction and
workflow source inspection authenticate the existing issued root; persisted changes
are detected at the next real storage frontier or final full gate. Captured
IN/disjunction, unique-owner hydration, residual windows and ordered write demands
share the existing working-set frontier. Relevant Application seeds still
authenticate original snapshot evidence before overlay membership is used.
Existing native DAL plans consume this owner without new framework APIs.

The [bounded-read measurements](../../packages/flarex-backend/benchmarks/mixed-mutation-core/bounded-read-execution/README.md)
retain all 120 successful samples with zero exclusions and setup failures. SQL
**643 / 670 / 1,034 / 354** and transactions **29 / 30 / 43 / 6** pass the
**798 / 924 / 1,439 / 354** and **33 / 34 / 50 / 6** stage ceilings. Warm p50/p95 is
**635.4/668.3, 690.0/751.7, 1,169.3/1,226.9 and 321.2/342.7 ms**. Mixed medians
fall **18.9% / 29.1% / 30.3%**; standalone rises **3.8%** and passes its median
and strict regression gates. Warm maxima **689.0 / 782.2 / 1,237.6 / 380.0 ms**
remain retained. Final mixed latency targets remain unmet.

Delivered [batched settlement](./17-batched-settlement-preflight.md) returns
authenticated body/authority/candidate-head capture after confirmed seal COMMIT,
verifies outside SQL, then performs separate fresh finishing and publication.
Scalar equality covers the actual root and all child projections before payload
capture. Healthy terminal transactions fall **7 to 3**. Existing persistence
owners batch OCC/index/unique/build and materialization input work; durable
formats and ordinary/standalone/recovery profiles remain intact.

The [full settlement measurements](../../packages/flarex-backend/benchmarks/mixed-mutation-core/batched-settlement/README.md)
show **562 / 585 / 888 / 309** SQL dispatches and **25 / 26 / 39 / 6** explicit
transactions, passing all slice 17 ceilings. Mixed terminal SQL is
**175 / 180 / 218**; nonterminal SQL remains **387 / 405 / 670**, including nine
initial admission transactions, ten Product data frontiers and thirteen
additional workflow frontiers. Original demand/definition/byte/chunk observations
are retained; unavailable reference and wire counts are not inferred from effects.
Warm untraced p50/p95 is **595.6/616.1, 627.4/784.6, 1,056.7/1,094.7 and
287.1/316.8 ms**. Standalone passes its strict median gates; Product + Payload
p95 rises from 751.7 to 784.6 ms. All outliers remain retained and every final
mixed latency goal remains unmet.

The separate Node diagnostic names readiness/index-build decoding, private JSON
capture and library/query work on actual calltrees. Idle/generated frames and
profiler overhead remain explicit. Existing metadata/admission/preparation work
supports delivered [aggregate entry and prepared source graph](./19-aggregate-entry-preflight.md)
before a host change. It connects existing private finiteRoot core entry and
genuine consumers with one bounded authenticated construction, atomic
creation-plus-full-entry, confirmed facts and exact-transaction coverage reuse.
Structural entry transaction topology is **9 to 3**. Complete initial
authentication preserves the fresh renewal omitted by the previous measured
fixture: admission is **97** SQL dispatches in **four** transactions.
The [aggregate-entry measurements](../../packages/flarex-backend/benchmarks/mixed-mutation-core/aggregate-entry/README.md)
retain **519 / 542 / 845 / 309** warm SQL dispatches and **20 / 21 / 34 / 6**
transactions, passing all-sample SQL ceilings **540 / 563 / 853 / 309** and the
complete-profile transaction gates. Warm terminal SQL is **173 / 178 / 216** in
three transactions. Untraced p50/p95 is **752.955/888.010, 678.637/695.351,
1,196.599/1,289.494 and 314.581/336.328 ms**. Standalone remains below 400 ms
median and passes its strict below-10% regression gate at **9.586912%**.
All mixed latency goals remain unmet. The prior private mixed fixture omitted
complete initial authentication and renewal; the distributions establish neither
profile equivalence nor a causal regression. Existing distribution changes and
all outliers remain retained, including the current **7,701.252 ms** Product maximum.
Root point bootstrap remains outside
those savings. Standard Application retains its distinct durableOperations
selection/activation/evidence/load/open contract and regression obligations; no
default profile or hosted cutover is proposed. Host slice 18 remains conditional
and unapproved, and the whole
latency goal remains unfinished.

The finite root has an immutable journal marker. Standalone selection and final
publication still perform full live checks. Complete
canonical unique closure/spec authentication uses the existing configured-control
preparation owner and detached snapshot; the accepting transaction checks fresh
target binding/Application, required builds, physical evidence and authority.
Neither full nor selected reads add a control-closure reread there, and no atomic
control/target coordination is implied. Privileged repair and structural
DDL require quiescence before protected preparation can resume. The local
PostgreSQL measurements do not establish native ORM parity, hosted latency,
throughput or production capacity.
The finite evaluator keeps child results local until one atomic aggregate
terminal journal transition: successful seal or an early relation conflict.
The latter stages preceding finite evidence with the existing
`relation_conflicted` receipt and state; durable conflict replacement and
crash recovery remain with their existing owners. A dedicated COMMIT-response
loss injection for this early conflict transition remains a targeted coverage
gap. Closed local claim tombstones retain exact
fencing without the pending graph; the bounded 1,024-claim registry can require
up to 1,024 checked transactions to sweep at saturation, so its bound does
not establish a low latency saturation path.
Payload's required unique `posts.title` field needs a retained ordered index for
historical uniqueness checks. Adding that compiler index changes the compiled
Payload source definition and digest. Isolated proof scopes can be reprovisioned;
named sources require an explicit upgrade and readiness decision before activation.

The other shared-storage session has reviewed, validated and committed its
active [exact-scope retained-history slice](../shared-logical-storage/56-same-deployment-scope-authority.md)
and confirmed a clean pause. The [shared-storage completion plan](../shared-logical-storage/03-completion-plan.md)
remains active with unfinished consumer migrations and retirement under its own
owner. The mixed core starts from the paused baseline after an audit; it takes
only a concrete storage blocker required by its first connected proof, with
ownership recorded in that preflight. Whole-goal storage completion is not a
prerequisite.

The goal is one private logical mutation attempt that can compose Application
operations, selected real Medusa services and finite workflows, and selected
Payload Local API operations under one authoritative outcome. It includes
snapshot-plus-pending evaluation, complete dependency/conflict evidence,
authenticated domain participation, journal/recovery, settlement and publication,
with profile-specific lifecycle rules. Public `ctx.commerce`/`ctx.cms`, generated
types, SDK/configuration, hosted activation, arbitrary Medusa/Payload support,
durable workflows containing waits/effects, and advanced schema evolution remain
separately gated.

## Working Method And Document Ownership

For this owner-authorized session, the root coordinates planning, discussion,
review and Git; explicitly assigned workers make disjoint edits and fixes,
serializing dependent changes and preserving unrelated work. Spawn every
subagent, including workers, explorers and both standing reviewers, with model
`gpt-6.1-sol` and `reasoning_effort: high`. Reviewers remain read-only.
The relevant numbered preflights own their implemented private scopes.

The [foundation plan](./14-execution-redesign-roadmap.md#selected-foundation-replacement)
owns the next mixed packages. The [component-first method](../core-performance/README.md)
still avoids automatic full end-to-end measurement after every local edit.
Each package delivers an evidenced real owner change with
affected consumer correctness, proportional PGlite/ordinary-role PostgreSQL,
both reviews, cleanup and commit. Setup/authentication costs remain reported and
every actual fresh check remains included. Declared group milestones,
cross-component/lifecycle contract changes and whole-goal acceptance retain full
mixed performance integration measurements; an owner improvement does not
automatically trigger the full graph benchmark. Bounded connected correctness
remains required during implementation. Connected packages are serial; inactive documents and
conditional host work do not approve a fixed runtime remedy.

The design note owns architecture; this README owns domain status, package order
and remaining cross-package gates. Create `NN-topic-preflight.md` when a
slice is ready for focused scope agreement. The user-requested successor drafts
15–19 are a specific exception: retain their explicit dependency/readiness gates
and unresolved decisions, without treating their existence as runtime approval
or making them simultaneously active. That numbered file owns the slice's
decisions, current status and remaining gates; update it in place as truth
changes. Do not create duplicate plan, status or checkpoint-log documents.

## Authorities And Baseline

- The [accepted database design](../../design-notes/flarex-db-accepted-design.md)
  governs current Postgres authority, execution profiles and trust boundaries.
  The [mixed mutation design](../../design-notes/flarexdb-mixed-mutation-execution.md)
  records the approved private admitted mixed profile for the first slice.
  Its remaining proposals need their own focused scope agreement.
- [Shared logical storage](../shared-logical-storage/README.md) owns logical
  data/index/relation storage, its unfinished cutovers and structural retirement.
  [Shared transaction core](../shared-transaction-core/README.md) owns existing
  settlement, publication and recovery foundations. [Package boundaries](../16-package-boundaries.md)
  determine placement.
- Current native attempt/journal and commit owners, logical working set,
  index/search/materialization owners, Payload adapter, Medusa repository and
  workflow runtime, and their decisive tests establish the implemented baseline.
  Their existence does not prove mixed snapshot, pending or retry semantics.
  The design note links these exact sources. Inspect the paused checkout and
  selected call graph before writing the first preflight; verify that owned
  test/runtime resources were stopped at handoff.

The existing private named Application/CMS/Currency command proves trusted
atomic composition for a fixed command. It does not admit arbitrary sandbox
interleaving or convert independently committing framework hosts into borrowed
attempt participants. Current framework commands remain supported for their
real callers until an approved slice migrates or deliberately retains them.

## Invariants And Replacement Rule

- Postgres alone settles data, retained result and event intents. The root
  attempt owns retry, cancellation, budgets, fencing and uncertain-outcome
  recovery. Child calls borrow it and cannot independently commit.
- Application, Payload and Medusa retain separate semantic authorities and
  execution profiles. Adapters translate; they cannot invent core guarantees
  or grant framework mutation rights from an Application grant.
- No SQL transaction spans sandbox/user execution, remote effects, resource
  waits or workflow suspension. Unsupported hooks, effects, locks, parallel
  constructs and query semantics fail admission.
- Snapshot reads include earlier pending changes and exact dependency evidence;
  participating writers preserve needed history and conflict facts. Index,
  search, relation, unique and locking correctness is proved with the package
  that admits each path, not deferred wholesale.
- Necessary internal breaking changes are accepted after scope agreement.
  Each numbered preflight inventories affected callers, durable data and formats,
  outstanding attempts, cutover, validation and removal. Migrate consumers and
  remove displaced mechanics in the same connected slice. Retain an old path
  only for a named supported caller or durable obligation with a removal gate;
  never silently delete or reinterpret durable evidence.

## Delivery Packages

These are connected outcomes, not a prescribed file count or a sequence of
helper-only commits. Before each package, create its numbered focused preflight
after inspecting the latest baseline. Record challenged alternatives, exact
operation/call graph, authority and trust, old/new contracts, affected consumers,
durable-data disposition, validation, cleanup and exit criteria. A material
change to those decisions returns to scope discussion. No runtime package starts
from this roadmap alone.

1. **[Application plus Product private atomic attempt](./01-application-product-attempt-preflight.md).** Agree the first real
   Product service method and field set from the paused baseline. Through the
   genuine sandbox/host boundary, compose Application write, admitted Product
   service call, pending Product read and dependent Application write. Connect
   attempt/snapshot/pending working set, authenticated journal evidence,
   complete point/predicate/constraint observations, OCC, short physical
   settlement, retained result, event intent and recovery under one root.
   Include late failure, authority refusal, cancellation, conflict/retry and
   lost-acknowledgement witnesses; concurrent standalone writers cannot escape
   conflict evidence. Select and prove the required index/search snapshot and
   lock behavior for that method. Refactor owner contracts and migrate affected
   native/framework callers together, removing displaced duplicate paths.
   Remaining storage work is imported only if this exact proof needs it.
2. **[Payload Local API lifecycle](./02-payload-local-api-attempt-preflight.md) (implemented private isolated proof).** Admit selected real Local API create, update and find-by-ID with
   access, validation, nested same-request calls and a database-only hook into
   the same attempt. Define hook location, permitted capabilities, first-failure
   order, rollback-only and retry behavior before admission. Prove pending
   cross-domain visibility and late Payload failure after Medusa work leaving
   no committed rows or event intent. Migrate adapter/request consumers and
   remove their displaced transaction, evidence or lifecycle mechanics while
   retaining independently supported standalone profiles.
3. **[Finite Medusa workflow](./03-finite-medusa-workflow-preflight.md) (implemented private isolated proof).** Admit one ordered private parent with
   the selected native-step Variant/Pricing/Link child and exact promoted
   Product Tag update child. Borrow the existing root across Product, Pricing
   and Link sources without independent settlement or callback replay. Prove
   pending graph reads, module and workflow events, the selected index, relation
   and uniqueness claims, late failure, whole-attempt conflict retry, replay,
   cancellation and uncertain COMMIT alongside Application and Payload. Refuse
   text/JSON search, effects, waits, parallelism and resource locks outside its
   selected graph. Migrate affected workflow/adapter consumers and remove
   displaced mixed paths in that package. Exact journal-format cutover and
   named-environment disposition are gates in its preflight.
4. **[Evidence-driven cost baseline](./04-performance-baseline-preflight.md) (original series partial; corrected cold gate closed).** After representative real
   integration and correctness work, measure equivalent workloads on ordinary-role
   PostgreSQL, attributing observed driver dispatches, SQL statements, awaited
   query time and request wall time to their owners. Record sealed-journal bytes,
   retained rows, indexes and events; mark unobserved inner phases and scope-clock
   lock intervals unavailable. Recommend numerical acceptance targets from that
   baseline. The linked preflight covers measurement only.
5. **[Core query cost correction](./05-core-query-cost-preflight.md) (implemented bounded private correction).**
   Batch selected source-readiness and table-frontier work at the persistence
   owner, loading physical proofs and frontiers only when ordered coverage
   checks need them. Group bounded working-set hydration under checked short
   SQL transactions. The selection follows authenticated tables and definitions,
   so future module, workflow and Payload sources can use the same core mechanics
   when separately admitted. Preserve each source's fresh authority check,
   transaction and publication obligations, then rerun the same correctness
   and cost workloads. Whole-goal completion audits profile boundaries,
   durable formats, retained callers, exports, tests and documentation; this
   confirms cleanup already done per slice rather than delaying retirement.

The original ordinary-PostgreSQL series exposed repeated source readiness
checks and table-frontier queries across native Product operations. Its cold
deadline failure remains in the historical record without an established
COMMIT-delay cause. The complete corrected series closes the current private
cold gate and shows lower median request cost for the selected workloads.
Fresh source readiness and historical row reads retain work; this result does
not establish native Medusa ORM parity, arbitrary future-framework support or
hosted capacity. The first packages retain their correctness checks.

The first preflight may revise package boundaries when a real call graph or
durable obligation requires it, but it must preserve a connected consumer proof
and state the changed scope for agreement.

## Validation And Completion Gates

Each significant code package needs focused owner and real-consumer tests,
type/build/lint/source guards, both `typescript-diff-reviewer` and
`code-quality-diff-reviewer`, and re-review after substantive fixes. Use PGlite
for fast behavioral coverage and ordinary-role PostgreSQL on distinct connections
for transaction, isolation, locking, index/search, migration and concurrency
claims; report their results separately. Include the applicable real Worker or
host boundary for private execution without claiming production deployment.

Completion requires the agreed private three-consumer scenario and its failure,
conflict, retry, event, cancellation and recovery witnesses; safe refusal of
unsupported behavior; explicit durable-data disposition; migrated consumers;
per-slice cleanup; and measured targets on the representative workload. A
passing bounded test does not prove arbitrary framework support, hosted capacity
or a developer API. Public authoring and deployment require later scope approval.
