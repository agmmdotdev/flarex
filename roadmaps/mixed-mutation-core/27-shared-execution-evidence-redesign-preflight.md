# Shared execution evidence redesign

## Selected storage execution composition

Status: implemented connected composition; native-relative acceptance remains
unmet. The finite comparison shows lower quiet mixed-product latency without a
demonstrated reduction in paired thread CPU. Retain this partial improvement;
do not treat structural simplification as completion of the performance goal.
The root CPU attribution in
[the measurement preflight](./21-core-performance-harness-preflight.md#selected-root-cpu-attribution)
selects the working-set, finite capture, journal and physical-session execution
path. Repeated internal diagnostic construction occurs beneath named operations;
successful physical calls also construct errors for deadline branches that never
win. These are source-established removable mechanics, not exact removable CPU.

Retain the public document, journal, capture and physical-session boundaries.
Replace nested per-row and recursive diagnostic wrappers with lazy internal
composition beneath those boundaries. Combine synchronous observation, charging
and hydration only where the existing lazy consumer preserves row order,
short-circuit failure, interruption and charge-before-retain behavior. Capture
preparation and acceptance stay within the existing named operation;
non-ownership captures need one named capture operation rather than an outer
ownership-named wrapper. Ownership keeps its original pre-acquisition validation,
checkout ownership, successor captures and final fences. Journal planning and
metadata recording remain inside their current public operation and sticky
failure owner. This deliberately retires redundant private diagnostic frames;
affected timeline consumers must follow retained semantic operations rather than
depend on helper names. No public API, stored bytes, schema or data reset changes.

The physical owner constructs timeout refusals only when their timer branch
executes. Preserve the absolute authenticated deadline, exact error kind/phase,
race policy and interruption cleanup. Its callback Promise bridge is retained:
callback finalizers can require quarantine to occur first, so a direct joined
Effect timeout could block before quarantine. Track, cancel, drain and complete
the callback Cause under the existing resource budget. This is a genuine lifetime
boundary; it is not a resourceful runtime reconstructed on every call.
After the work fence closes, an already-settled drain consumes the same fresh
deadline check and returns the exact sticky work verdict directly. Pending work
keeps bounded waiting and quarantine. The existing Promise tracker removes its
pending entry in its settlement handler instead of scheduling a second cleanup
reaction; first refusal and drain visibility remain ordered together.

Do not cache live capture acceptance, merge independent commits, alter fresh
authority or dependency recording, remove required checks, or turn recursively
borrowed selection/frontier lifetimes into an outer eager loop. The selected
plain/Result or untraced internal factories must preserve lazy evaluation and
unexpected defects; blanket removal of Effect supervision is rejected.

The root owns the preflight, measurements and Git. Disjoint workers own the
working-set/capture/journal and physical/deadline edits plus directly affected
witnesses. Preserve the earlier dirty baseline and stage only this incremental
replacement. Remove the replaced wrappers rather than add a second execution
path. Existing ownership, byte/identity limits, uncached authority refusal,
first-row failure, rollback, uncertain outcome, cancellation, drain and complete
Cause witnesses remain correctness gates on PGlite and ordinary PostgreSQL.

Measurement is finite and answers whether this connected composition changes
complete mixed-product cost. Retain the preceding five root CPU profiles as
candidate evidence; run ten quiet native/Flarex pairs and five minimal-counter
pairs before and after, with five warmups per engine in each lane. Add five
alternating quiet/root-profiled pairs after implementation to check the selected
stacks. This reserves 115 new business calls, all retained, without implicit
retries or an automatic five-graph profiling matrix. Quiet latency, paired thread
CPU, process CPU, sampling uncertainty and observation perturbation remain
separate. The focused objective is a lower complete quiet median and lower paired
thread CPU at the available counter resolution, without a new correctness or
tail regression; unresolved or adverse results require a truthful disposition.
The existing complete native-relative latency/CPU gates remain unchanged and
unmet until their declared complete campaign passes. This internal composition
cut does not change transaction/lifetime contracts or finish the group milestone;
standalone and connected consumer correctness still run before both reviews,
cleanup and one scoped commit. Exceptional quiet workflow stalls remain a
separate unresolved attribution question.

Status: selected redesign plan; runtime cutover has not started. This is the
focused successor within the [foundation plan](./14-execution-redesign-roadmap.md#connected-packages),
covering CPU work and database exchanges together. The standing core-redesign
approval covers connected implementation, required private breaks, validation,
review, cleanup and scoped commits. Record concrete writer and lifetime contracts
before removing their current proofs. A materially different authority or
durability decision must be explained before dependent runtime changes.

## Outcome and real consumers

Retain authenticated immutable preparation and checked values at their actual
owners, then accept fresh mutable state at the profile's real database boundary.
Remove repeated construction, decoding, copying and proof transport between
trusted owners. Admission, readiness and publication keep different purposes;
their current choreography is replaceable.

Each connected cutover includes standalone Payload mutations, standalone Medusa
commands/workflows and mixed Application/Product/Payload/workflow execution.
Standalone is not a later optimization backlog. Medusa Product, Pricing and
Link remain distinct admitted sources even when common Application preparation
is shared. Independently committed commands retain independent outcomes; they
do not silently become one mixed transaction.

Native services, Payload access/validation/hooks and Medusa workflow sequencing,
locks and compensation inputs remain framework-owned. No SQL transaction spans
untrusted execution, workflow callbacks, pauses or remote effects. Postgres owns
settlement, history, facts and durable outcomes. No universal transaction facade,
adapter admission cache, fallback engine or compatibility wrapper is selected.

The selected standalone-read replacement is already implemented and locally
paused at owner-accepted latency. Keep its shared correctness regressions in
scope; this mutation plan does not restart read tuning or claim its targets pass.
Developer APIs, new framework capabilities, hosted activation, arbitrary
privileged-change detection and general schema evolution remain outside scope.

## Evidence and challenged alternatives

The [complete attribution inventory](../../packages/executor/benchmarks/core-performance/complete-attribution/README.md)
locates substantial work in preparation/admission, framework working-set execution
and final acceptance/publication. It identifies per-request CMS definition
construction, repeated common Application evidence in commerce, repeated value
captures and ordinary-versus-finite planning duplication. It also records genuine
distinct data demands, source closures and current limitations.

Diagnostic thread CPU includes observation overhead. It does not establish exact
quiet core CPU or Flarex-only CPU excess. Inclusive CPU, wall envelopes and driver
awaits overlap. Workflow frames waiting for sibling service fibers are not extra
workflow CPU. Result validation and freeze are small in the selected Product
graph; another freeze-only rewrite cannot explain the complete latency gap.
Effect-span counts do not quantify quiet Effect overhead.

Convex's checked values, immutable schema reuse, original/pending transaction
state and ordered commit acceptance support the direction. The inventory links
the checked-in primary sources. Flarex must separately prove its PostgreSQL role,
installation, framework evidence and AFTER-trigger guarantees. Copying Convex's
transaction engine or moving every framework hook after commit would change
those contracts without solving the measured ownership duplication.

SQL fusion alone can hide server work while preserving CPU reconstruction.
Removing validation alone can weaken source ownership, schema activation or
failure order. The replacement therefore changes preparation and handoff
contracts across their real consumers, rather than optimizing one adapter.

## Owner contracts and API shape

Extend existing owners with small source-private methods. Hosts construct their
profile once and consume genuine issued preparation; adapters do not assemble
proof graphs, own generic registries or import a collection of core construction
types. Retain separate framework profiles and Effect lifetimes. New abstractions
must replace a named owner contract, not wrap the displaced path.

| Boundary | Owning implementation | Replacement contract |
| --- | --- | --- |
| Bounded immutable preparation | [prepared host runtime](../../packages/persistence-postgres/src/preparedHostRuntime.ts), [source admission](../../packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts), definition issuers | Retain genuine definitions, validators and decoded immutable bodies. Account exact allocation and close/drain; preparation grants no permission, transaction or settlement. |
| Fresh accepting evidence | [active-head reader](../../packages/persistence-postgres/src/applicationActiveHeadRead.ts), [readiness fold](../../packages/persistence-postgres/src/applicationRelationReadinessFold.ts), CMS/commerce/finite admission | The actual outer owner issues one common Application basis for the exact accepting transaction and compatible requested sources. Source owners consume it and retain their own checked heads, permissions and closures. |
| Values and pending state | [logical working set](../../packages/persistence-postgres/src/logicalDocuments/workingSet.ts), protocol codecs, framework capture owners | Capture foreign values at real ownership crossings. Retain owned canonical values, measured limits and original/pending state; direct trusted handoff does not recapture the whole graph. |
| Final contributions | [Application participant](../../packages/persistence-postgres/src/applicationDocumentMaterialization/participant.ts), logical materialization, current profile publishers | Preparation consumes genuine retained definitions and owned contributions. Fresh acceptance, complete write maintenance and settlement remain with their actual owners. |

### Preparation identity and lifetime

Reuse requires the actual database/issuer, installation incarnation and generation,
deployment/scope, source/schema artifact and complete selected definition identity.
Record relevant membership, tombstones and last-changed metadata sequence through
the existing [finite metadata dependency owner](../../packages/persistence-postgres/src/finiteMetadataDependencies.ts).
Equal digests or copied definition records do not authenticate a capability.
Control and target databases retain separate evidence and fenced placement;
there is no implied joint snapshot.

Extend `PreparedHostRuntime` only where shared retained allocation is necessary.
Its current host/byte limits are not already a keyed cross-host preparation store.
Shared preparation needs one charged allocation, explicit borrowers and final
release, bounded keys/bytes, invalidation, eviction and close/drain. Never retain
transactions, connections, accepted permissions or an unbounded per-shop map.
Cold misses and activation/reprepare costs are visible and bounded.

### Common preparation is not common authority

`PreparedApplicationActiveHeadStructure` may retain immutable bodies.
`CheckedApplicationActiveHead` remains bound to the actual transaction and clock.
Ordinary commit-sequence, retained-floor or clock progress requests refresh;
wrong transaction, generation or epoch refuses. Finite execution consumes its
original snapshot and metadata watermark; standalone CMS and commerce use their
own accepting transaction. No checked verdict crosses transactions.

Replace reconstruction and repeated identity searches with explicit consumption
of one genuine common basis where complete identities and the transaction agree.
Product, Pricing and Link still supply three genuine source proofs and three
source-owned working sets. Nine workflow calls currently reuse those sets; this
plan does not diagnose nine new roots or promise to remove distinct source work.
The [relational admission issuer](../../packages/persistence-postgres/src/logicalDocuments/relationalAdmission.ts)
already prepares table/index/unique/access/foreign-key mechanics. Its full
standalone profile must carry these genuine mechanics to the working-set and
participant owners, rather than force them to reconstruct the same table profile.
Demanded read readiness and complete touched-table write maintenance remain
different obligations. Newly activated relevant definitions and metadata ABA
must invalidate the old basis or refuse final acceptance.

### Installation and framework evidence

[Managed installation lifecycle](../../packages/persistence-postgres/src/installationLifecycle.ts)
and [framework installation runtime](../../packages/persistence-postgres/src/frameworkSchema/installation/runtime.ts)
protect different evidence. The Application protected epoch does not automatically
protect the framework runtime's retained installation/migration evidence sections.
Mutable build coverage is not immutable metadata.

Before narrowing framework evidence replay, enumerate every writer of availability
heads, receipts, dependencies, terminal state, history and names. Prove atomic
invalidation or maintenance exclusion, generation/incarnation changes, ordinary-role
write denial, bounded drain and crash/reopen behavior at that owner. Installation
preparation must refuse changed evidence; it cannot refresh and bless it in a
serving call. Maintain complete fresh evidence until this replacement is proved.
This is a security obligation of real consumers, not a compatibility fallback.

The named read-only installation replacement cannot silently authorize broader
mutation reuse. Any needed extension must specify affected credentials, writers,
initial admission, each actual database access, final acceptance and replay/recovery
success paths. Amend the accepted design with that concrete contract before its
runtime cutover. Independently committed AtomicCommerce keeps its full-live
canonical profile unless that exact profile is included in the proved replacement;
its test label does not grant the CMS/Commerce Application tail or finite guard.

## Connected delivery sequence

These are implementation packages in the existing foundation goal. Internal
helpers, profiling, SDK changes and documentation are work inside a package.
Do not create a separate goal turn for each duplication or measurement.

| Order | Connected behavior and consumers | Removal and acceptance |
| --- | --- | --- |
| 1. Retained preparation and accepting admission | Definition/materialization issuers consume genuine retained artifacts; compatible participants consume one common accepting Application basis. Migrate standalone Payload scalar create, standalone Product command and the Product/Pricing/Link workflow, plus the finite mixed consumers. Resolve installation/writer protection at the owners before narrowing it. | Remove per-request immutable CMS definition acquisition and duplicated accepting reconstruction. Preserve source-specific closures and profile tails. Prove refresh, activation/ABA, installation drift/drain, revocation, mutable coverage and all successful return paths. Compare complete CPU, exchanges and latency across all five daily graphs. |
| 2. Owned values and ordered storage handoff | Connect foreign/native capture, workflow value handling, working sets, finite storage capture and contribution transfer. Retain one owned representation between trusted owners; mutations produce newly checked values. Migrate ordinary CMS/commerce and mixed callers together. | Remove redundant trusted graph walks, encodings, clones and size-only recaptures. Keep detached native inputs/outputs and workflow omission semantics. Preserve demand, charge and first-failure order, original-snapshot pins and negative dependencies. Compare small/large values and repeated calls without guessed prefetch. |
| 3. Shared contribution preparation and fresh publication | Current ordinary and finite finalizers consume retained definitions and prepared values through the same domain mechanics. Resolve immutable closure once where genuine identities agree; accept current touched-table obligations at their real barriers. | Remove duplicated ordinary/finite lowering preparation and proof transport, including obsolete exports and fixtures. Preserve OCC, unique/relation/candidate obligations, history, stored/AFTER-trigger proofs, atomic facts/results and uncertain-COMMIT recovery. Finish complete matched-native CPU/latency, tails, scaling and retirement gates. |

Package 1 starts with the concrete writer/issuer and accepting-basis contracts,
then implements their connected migration. It is not another open-ended tracing
campaign. Package 2 does not remove distinct Product relation/unique demands,
speculate about future workflow reads or move foreign callbacks into SQL. Exact
native immutable frontier pins remain necessary; replacing durable capture pins
requires their writer and retained-format migration in that same package.
Package 3 preserves existing sequential and post-trigger proof barriers until an
equivalent ordered proof is demonstrated. A healthy scalar fixture is insufficient
evidence to remove candidate, external coverage or strong-reference obligations.

## CPU is a separate acceptance obligation

Reduce unnecessary work at the owner, rather than disable production correctness
or remove Effect supervision. Retain checked sizes/bytes and immutable validators;
avoid re-decoding equivalent evidence; avoid clone/serialize/decode cycles between
trusted owners; keep pure deterministic transformations as direct helpers inside
the real Effect boundary. Do not replace typed failures, cancellation, Scope or
first-failure order with broad Promise catches or uninterruptible loops.

The concrete CPU replacements belong inside the connected packages:

- The [binding canonical owner](../../packages/persistence-postgres/src/frameworkSchema/binding/canonical.ts)
  currently constructs canonical bytes and then restores them through another
  validation/hash pass. Issue and retain its genuine checked frame directly;
  stored foreign bytes still require exact decoding and hashing. Mutable native
  data, copied hashes and shallow freezing cannot become retained evidence.
- Full standalone relational admission carries its already prepared write
  mechanics into the working set and [commerce logical participant](../../packages/persistence-postgres/src/commerceTransaction/logicalParticipant.ts).
  Remove duplicate table/foreign-key/profile construction while retaining each
  source's confinement, initialization rules and current acceptance.
- Replace whole-activity clones followed by per-call slices and another
  [closed-contribution copy](../../packages/persistence-postgres/src/logicalDocuments/detachChanges.ts)
  with immutable owner-issued activity ranges and one authenticated closed
  transfer. Preserve exact source/call observations, no-final-write decisions,
  dependency order and single consumption. The finite publisher's already
  removed final recanonicalization is not a new optimization opportunity.
- The [atomic commerce result](../../packages/persistence-postgres/src/atomicCommerce/execution.ts),
  [outcome encoder](../../packages/persistence-postgres/src/jsonOutcome.ts) and
  [workflow value owner](../../packages/medusa-adapter/src/workflow-value.ts)
  consume genuine captured-value evidence instead of reflectively walking the
  same unchanged trusted tree again. Every existing ordered accounting boundary
  still charges its required bytes/nodes/depth. Preserve remaining lifetime,
  rollback-only and seal-before-result semantics, omission restoration, error
  precedence and detached mutable hook inputs. Ordinary object identity grants
  no bypass; mutation requires new capture.

The first package extends the existing [measurement SDK](../../packages/executor/test/performance/measurement/README.md)
with a minimal root-counter lane for both the native and Flarex complete calls.
Read process/thread counters immediately around actual execution and attempt
cleanup, before report construction/readback. Reuse the current Node counter
adapter; no inspector, per-operation tracer, SQL observer, heap/GC collector or
production-core measurement import enters this lane. Counter faults invalidate
the CPU evidence while preserving business results and Cause/Exit settlement.
Even two counter reads have cost; report their calibration and platform resolution.

Keep fully quiet elapsed acceptance separate from counter-observed CPU evidence.
Control sibling/background work, alternate fresh matched calls and retain every
sample and failure. Report actual paired thread-CPU excess, process CPU separately,
resolution and complete call boundaries. Do not subtract a traced overhead estimate,
sum nested CPU or infer CPU from event-loop utilization. If granularity cannot
resolve a proposed CPU budget, report it unresolved rather than claim a zero.

Before the first package's runtime cutover, declare its native-relative CPU
allowance from the complete matched reference and counter resolution through
that minimal lane, within the same bounded implementation package. Require
demonstrated removal of the named work, lower added CPU and no connected-profile
regression. A lower SQL count or a faster wait cannot hide unchanged large CPU
overhead. Diagnostic profiles only answer a concrete remaining owner question.
Per-request allocation attribution remains a separate observation with an exact
call window; retained memory is bounded even when allocation sampling is absent.

## Issued ordered-index specification consumption

Status: **implemented, reviewed and component-validated.** Exact locally issued
specifications now avoid repeated static decoding and snapshotting in their three
consumers. Equivalent dynamic validation and current-membership behavior remain
supported on both database drivers. The retained-spec component uses less elapsed
and batch CPU time; this temporal result does not quantify complete workflow
savings or close the failed native latency gates. The protocol-only correction
is independent of the unfinished transaction cutovers and follows the existing
component delivery loop.

The physical-spec decoder already produces detached, deeply frozen metadata.
Canonical index definition issuance and located definitions retain that object.
Previously, key encoding, stored-key decoding and bounds compilation invoked
the complete spec decoder again for every operation. Existing sampled profiles
locate repeated spec decoding, cloning and freezing on these actual paths;
sample counts neither quantify quiet milliseconds nor establish dominance.

Keep the existing protocol decoder as the issuer. Register only its successfully
decoded, detached, deeply frozen output in a module-private weak identity set.
The three spec consumers may use that exact issued object directly. Raw inputs,
spreads, structured copies and foreign frozen objects still follow the complete
decoder. Explicit public decoding continues producing a distinct detached
snapshot even when passed a previously issued object. Weak identity membership
retains no additional metadata lifetime and grants no catalog, scope, admission,
installation or transaction authority.

The affected consumers are developer/intrinsic key materialization, index query
bounds, append capture and stored membership acceptance. Preserve all changing
component/value/creation-time checks, canonical encoding and reencoding, key and
bound size limits, field order, malformed-key refusals, digest comparisons and
fresh admission/readiness/storage proofs. Source inputs never acquire issued
status. Initialize identity ownership before the module's static intrinsic specs
are decoded. No API, wire bytes, schema, durable data, grants, transaction or host
lifetime changes are selected. Do not trust `Object.isFrozen`, cache by structure
or digest, short-circuit public decoding or modify persistence authority.

The coherent cutover belongs to `flarex-protocol/ordered-index`; persistence
consumers keep their existing contracts. Replace the three repeated spec
preparations at that owner and remove their displaced work in the same change.
Prove equivalent issued/raw/copied behavior, canonical-issuer handoff, continued
public detachment, mutable raw-input revalidation, malformed late fields,
accessors and dynamic data/key/bound refusals. An allocation witness must
distinguish eliminated immutable-spec snapshots from still-required dynamic
value snapshots. Preserve the full ordered-index and index-definition witnesses
and affected current-membership proofs on PGlite and ordinary-role PostgreSQL.

Record a focused before/after component experiment using actual retained specs
and the same key/bounds workload, with unchanged warmup/sample and batch policy.
Use standard elapsed and CPU counters without a collector in the measured body;
keep raw samples, source/harness fingerprints, counter-resolution limits and
setup separate. This is a temporal component comparison, not a native business
reference or exclusive whole-root attribution. Both reviews, affected strict
checks/lint/source guards and cleanup remain required. Full five-graph native
comparisons remain at connected milestones; do not repeat them automatically for
this pure metadata-owner iteration or claim their prior failed gates pass.

## Breaking contracts, data and completion

| Current contract | Disposition and cutover |
| --- | --- |
| CMS per-request definition construction and structurally transported preparations | Replace at definition/materialization issuers; migrate real CMS, commerce and finite callers, then delete the displaced constructors and duplicate fixtures. |
| Implicit common-bundle lookup and repeated detached head/closure reconstruction | Replace with genuine explicit accepting-basis consumption. Keep transaction-bound fresh heads and each source's own permission/readiness proof. |
| Repeated captures of already owned trusted values | Replace with private issued-value handoff and retained accounting. Foreign getters, mutable native values, durable decoding and escaping projections retain their actual validation/detachment. |
| Independent source working sets and outer profile settlement | Retain for their actual source permissions, native consumers and distinct transaction/recovery semantics; share lower mechanics, not mutable authority. |
| Existing full framework installation evidence and stored corruption proofs | Extend/prove the writer-owned replacement before deleting any replay. Until then these remain required integrity checks of named consumers. |
| Historical pins, journals, committed results and migration evidence | Preserve exact decoding and recovery. Any changed representation requires an explicit populated conversion/drain policy and removal gate before runtime; no silent reset or deletion. |

Use Drizzle tables, columns and relations for ordinary metadata/DML. Structural
SQL and installed primitives retain their exact schema, grant and body owners;
do not introduce hardcoded table names in framework adapters.

Every package includes real consumer migration and removal, affected typechecks,
source guards and lint, both final-diff reviewers and one scoped commit. Prove
fast PGlite and distinct-connection ordinary-role PostgreSQL separately. Include
cross-scope/issuer/transaction refusal, protected and unprotected profiles,
activation/source changes, ABA, installation drain/incarnation, post-wait expiry,
coverage changes, foreign getters and mutation, exact limits/failure order,
hooks/events/compensation inputs, rollback-only behavior, cancellation, replay
and uncertain COMMIT. Successful early returns pass their actual acceptance tail.

Use the [complete native business reference](./26-native-business-baseline-preflight.md)
for the five daily graphs. At cross-component/package milestones, run complete
final-source quiet matched pairs under its warmup/sample and durability policy;
the selected added elapsed budget remains 5 ms median / 10 ms P95 per complete
root. Report cold preparation/invalidation, retained memory, metadata/data scaling,
retry/concurrency and unavailable hosted evidence separately. Extended flows need
their own matched native graphs. New targets and source-proven command budgets
are engineering gates, not predictions. Architectural migration, measured CPU
improvement and complete latency acceptance remain distinct reported states.
