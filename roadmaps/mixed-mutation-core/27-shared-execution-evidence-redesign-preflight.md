# Shared execution evidence redesign

## Full document-pipeline redesign

Status: **both the initial checkpoints and the connected isolated-document
replacement were implemented, measured and rejected by the performance gate;
original runtime retained**. The [full replacement evidence](../../work/validation/shared-execution-evidence/full-cpu-differential/owned-pipeline-results.md)
records 106.9625 ms baseline versus 109.9375 ms replacement added mean thread CPU.
The selected codec ownership, producer/consumer migration and local-composition
candidate is preserved as a reproducible patch, not active runtime. It did not
establish a material saving; this design is no longer pending implementation.
The [checkpoint evidence](../../work/validation/shared-execution-evidence/full-cpu-differential/pipeline-results.md)
establishes no CPU reduction from those initial changes. Do not continue stacking
helper changes or present either experiment as an accepted performance redesign.
The subsequent [operation-correlated CPU evidence](../../work/validation/shared-execution-evidence/full-cpu-differential/operation-results.md)
locates the largest combined family in 43 relational selections and 38 finite
captures: approximately 45 ms of observed Flarex CPU, excluding double counting.
Publication and workflow work are also substantial. These are execution costs,
not proved removable savings; no further runtime redesign is selected.
The [read repetition evidence](../../work/validation/shared-execution-evidence/full-cpu-differential/read-results.md)
prices the identified duplicate pure preparation at about 0.3 ms in warm replay,
with no exact repeated input among 26 index-page and eight row captures. That
does not establish a large safe removal or an end-to-end CPU saving.
The [candidate/command investigation](../../work/validation/shared-execution-evidence/full-cpu-differential/candidate-results.md)
places 56–63% of checked-command cycles in launch/completion and only about 3%
in drain/release. Candidate processing is spread across selection composition,
decoding, keys and live metadata. It establishes no dominant safe removal;
the disposable cancellation-client allocation costs about 0.4 ms in warm replay.
Keep the redesign gate closed: operation cost is not an achievable saving.
Use the current checkout. This proposal does not reopen completed cutovers
below or change accepted authority, failure, storage or framework contracts.

The rejected replacement extended the existing codec ownership record with an isolated
canonical projection: its byte/digest getters and binary runtime loans detach
mutable storage. Only the issuing codec can construct it. Persistence retains
that projection through validation, pending state and private root closure;
public snapshots still detach, and raw carriers keep their corruption checks.
The fresh stored decoder and document canonicalizer issue these projections
before any callback escape. Existing table-semantic evidence remains distinct
from codec ownership. Complete-operation composition and connected consumer
migration preceded the whole-replacement performance gate. The design below
records the tested hypothesis and preserved contracts, not a new implementation
authorization or a claim that the profile concentration is removable.

### Outcome and evidence boundary

The [complete differential profile](../../work/validation/shared-execution-evidence/full-cpu-differential/results.md)
reproduces 110.20 ms mean added thread CPU in the unprofiled mixed workflow.
Two independent profile cohorts locate about 94.83 ms of their 113.71 ms gap in
persistence, protocol and Effect/Result/Schema execution. That is a source-owner
concentration, not 94.83 ms of proved redundant work. The interpreter is the
largest individual module; no single document helper explains the gap.

Redesign the complete admitted document operation from captured input through
row selection, accepted storage observations, ordered validation, pending state,
result projection and closure. The intended removals are intermediate execution
objects and avoidable representation transitions throughout that connected path.
Keep the actual checks, observations, accounting, interruption and publication.
Do not reapply the unsuccessful bounded row-comparison, query-handoff or capture-
header candidates merely because their owners appear in the profile.

Convex's current transaction/read/write owners are the semantic reference:
`crates/database/src/transaction.rs`, `reads.rs` and `writes.rs` at the repository
root retain snapshot/read dependencies and original-to-pending write consistency.
The transferable rule is one owned observation/current value with precise read
dependencies. Flarex's short PostgreSQL transactions, explicit framework profiles,
canonical transport and atomic durable publication remain necessary divergences;
this is not a port of Convex's Rust engine or a replacement storage engine.

### Existing owners and target path

The existing `workingSet.ts` remains the document-operation owner. Extend the
codec's existing canonical-value ownership and `relationalRows.ts`'s existing
table-semantic evidence, rather than introduce a new validator, registry, VM,
opcode interpreter, generic CRUD service or adapter-local fast path.

The intended execution shape is:

1. Existing request/operation admission and lifetime checks.
2. Lazy, ordered local preparation using the existing input/metadata owners.
3. Actual storage acquisition, capture and acceptance at the existing cut.
4. Bounded local interpretation of one accepted row/operation segment.
5. Existing asynchronous validator, uniqueness frontier, callback or next-row
   boundary whenever the operation requires it; repeat 3–4 in original order.
6. Ordered pending-state update, return accounting and native projection.
7. Existing contribution/root closure, OCC, settlement and publication owners.

Within a local segment, use one existing authoritative Result composition and
one necessary Effect handoff. Total established-value calculations stay plain.
Do not replace Schema with handwritten field validators or Result with exception
control flow. Effect continues to own async work, typed failure, injected
capabilities, interruption, scopes, callbacks and finalizers. Preserve each
profile's real `state.validateDocument` callback: CMS has a transaction-backed
validator as well as pure native cases. A common signature is not proof that
all validation can be made synchronous.

The core already retains prepared table mechanics, query interpretation,
metadata selector facts, private JSON trees, canonical semantic verdicts,
derived index/unique keys and activity projections. Root closure already creates
one detached graph with original provenance. Preserve these owners and bounds;
none is a new proposed cache or a fresh savings claim.

### What can be removed, and the condition for removal

| Current work / concrete owner | Proposed replacement and removal | Checks and limits retained |
| --- | --- | --- |
| Per-member `Effect.fromResult` / generator composition around identity decoding, observation, hydration, projection and charging in `getMany`, `readFiniteBase`, `readRelationalSelection`, `executeRelationalPage` | Let one local Result operation sequence adjacent synchronous work at the existing row/packet position; remove the displaced per-scalar Effect factories and helper-only continuations. `chargeResult`, observation and hydration Result owners remain authoritative. | No eager traversal of later raw rows; preserve callback, row-consumption, cancellation and packet boundaries. Any loop with those boundaries keeps Effect sequencing. |
| `relationalChange` round trip: normalized native fields -> canonical document -> captured runtime/native views -> `output` -> strip `_id`/`_creationTime` -> recapture native wrapper | Carry the existing issuer's checked row and named runtime/native/policy projections through `withInsertedRecord` / `withWrittenDocument` and `afterWrite`; remove reconstructed intermediate wrappers and walks whose exact value/projection ownership is proved. | Normalize at the same position; preserve negative zero, codec tags, managed fields, optional/undefined/null, complete row validation, output byte limits and every original charge. Stored rows gain table semantics only at their original inspection point. |
| Repeated full-buffer comparisons protect externally mutable `CanonicalFlarexValueV1` carriers in protocol ownership and `relationalRows.ts` | Evolve the existing codec ownership record so internal loans never expose backing bytes/digest or mutable binary leaves. Migrate actual internal consumers to that owner-held representation, then remove defensive rescans only between genuinely non-escaping loans. | **Conditional removal**, not permission to skip current checks. Every raw/foreign/exported carrier retains its original integrity/descriptor checks, error order and detached bytes. If an alias can still mutate data, the comparison stays. No Boolean trust flag, unchecked entry point or cross-call integrity cache. |
| Helper-only tracing/stack/context construction and conversion chains beneath the named document operation | Compose directly in that operation after its pure segments are consolidated; delete only redundant private boundaries made unnecessary by the new owner path. | Preserve required public/semantic diagnostic operations and configured tracing, lazy factories, exact A/E/R and Cause. Do not rename helpers and count that as a CPU improvement. Existing untraced helpers are not new savings. |
| Whole-row projection used only to hand the same value between trusted activity/closure consumers | Use existing issued activity contribution and closed-root loans with their exact source/cursor/generation; let each real escape create its required projection. Remove a conversion only after its consumer moves. | Current activity caching and one root-close copy already exist. No new elimination is assumed there. Public inspection, framework-mutable outputs, native event snapshots and durable encodings retain their required detachment. |
| SQL, OCC, materialization and publication work | Preserve the prepared-query/fixed-OCC owners and existing durable write path; pass the accepted value through their existing private contracts. | No fewer observations or durable facts are promised. Preserve immediate returned-tuple checks and final stored proofs; no bulk-write/aggregate-validation substitution. |

The main new structural change is that the internal operation carries the
accepted row instead of repeatedly leaving and re-entering its value owner.
Local composition is then changed around that representation, across complete
read/write operations. Applying a few more `fnUntraced` substitutions, replacing
Result generators mechanically, or adding another WeakMap to current wrappers
would not deliver this redesign.

### Representation and lifetime contract

Reuse and extend the existing `canonicalValueOwnership` and `canonicalRows`
records by responsibility: the protocol owner proves value/encoding identity;
persistence proves the exact table/source-generation semantics. Neither proves
current admission or committed state. Do not merge those claims into one token.

Internal byte/digest storage must be unreachable through a returned object,
closure, typed-array view, driver parameter retained past its borrowing scope,
or runtime binary leaf. Exporting bytes or a mutable framework object creates
the owner's detached projection. Re-entry from an exported carrier is a checked
boundary, including when that carrier was originally issued here. A raw carrier
and a private loan must not accidentally share mutable backing storage.

Keep runtime, policy JSON and native framework views distinct. `valueJson` can
contain codec tags where runtime has negative zero or other non-JSON values;
one view cannot silently replace another. Carry intrinsic sizes as facts, while
each consuming request still applies its current bound and charges in order.
Do not collapse physical allocation accounting and existing logical charges.

The existing attempt/root owns pending revisions, originals and derived keys.
Prepared mechanics retain only immutable generation-scoped interpretation.
Release replaced values/derived state at the current invalidation points and
closure; no global request, observation, permission or negative-result cache.
Canonical-format, digest, stored row/journal/outcome encodings and database
schemas stay unchanged. No data migration or reset is part of this proposal.

### Failure-order contract to preserve

These are source-derived operation-specific cuts, not a new universal order.
The implementation must retain all branches inside each cut and add witnesses
for any changed composition before removing the corresponding old helper.

| Operation/cut | Required sequence and observable behavior |
| --- | --- |
| Operation entry | `lifetime.operation` then `state.requireAdmission`, closed/root/intent checks, then activity-generation invalidation and operation body. Foreign input work stays lazy. Even a later failed operation may already invalidate activity. |
| Ordinary point read | The no-root/no-transaction `get` branch acquires live read admission before identity inspection. Finite/local and borrowed-transaction branches retain their distinct order. Do not force them through one prevalidation routine. |
| Insert versus edit | Insert selects the table before `captureFields`; edit captures fields before `locate`. Generated insertion records intent, not a fabricated observed absence. Keep identity generation, dependency charges and creation-time ordering. |
| Batched relational input | Operation/table/mechanics checks precede captured input and its charge. The complete existing input array shape/key/duplicate validation runs before per-row changes. This is different from the later lazy storage-row consumer. |
| Each relational row | Identity selection/current-row acceptance precedes normalization and canonicalization. Missing-row, insert conflict, upsert reactivation, managed timestamps and unchanged restore retain their existing branch behavior. Later row values are not normalized or encoded before earlier row continuation completes. |
| Write acceptance | Canonicalization -> document byte bound -> table metadata consumption -> `state.validateDocument` -> each unique definition in current order. Unique lowering/storage lookup/pending-row checks and their error kinds remain ordered. |
| Unique continuation | For each definition, fresh storage selection and ordered pending membership precede the next definition and final consume callback. `withUniqueValidation` and `withAccessCandidates` can retain a borrowed frontier through later continuations. Do not release it early by turning recursion into an outer loop. |
| Pending mutation and returned value | Identity bound -> document charge -> `recordAttempt` (write-closure metadata, attempt charge, append) -> replace/set pending row -> output capture/return charge -> consumer. A return-budget failure can follow tentative mutation today. Preserve this state and first Cause; do not move all checks before mutation or invent a new rollback point. |
| Finite indexed read | Index/page membership and lookahead are accepted before body permission. Preserve completeness, exact table/unique-membership checks, membership charge, identity limits and row-body demands in the branch's current order. Keep cursor, range, limit, EOF/empty-page and negative-gap witnesses. |
| Row/packet consumption | Original ordinal/columns -> row decode -> consumer acceptance/observation/charge/hydration -> next raw slot. Current bounded packets complete their required decode phase before hydration; next packets use remaining budget after actual prior charges. Preserve missing/tombstone and withheld-body branches. |
| Pure predicates | Actual candidate lowering still precedes a bound's first eligible lowering. Earlier false/missing comparisons suppress later malformed bounds exactly as today; no failed derivation is retained. |
| Mutable canonical input | Keep the specific authority/bounds/corruption precedence of each entry function. In particular `nativeLogicalRelationalCanonicalRow` and `validateLogicalRelationalCanonicalRow` intentionally have different orders. Buffer getters, inherited getters and Proxy defects remain observable at the same positions. |
| Close/contribution | Check closing/ownership, fresh admission, relational references and activity before marking closed/releasing state. Source filtering, cursor offsets, attempt/lifecycle ordinals, original revision and closed-root pins remain exact. |
| Materialization/publication | Preserve locks, validation/write family order, each write's immediate returned evidence and final stored proof. Earlier row/index RETURNING corruption wins over a later trigger failure. Publication facts, outcome, wake and uncertain-COMMIT resolution remain with the current outer owner. |

Do not call this preservation based only on matching final errors. Witnesses
must also establish which later input/SQL/callback was never reached, the last
budget/state mutation, held scope, full Cause and cleanup. Preserve partial
tentative state after failure wherever it is observable before the existing
owner closes or marks rollback-only. Unexpected getter throws remain defects;
do not convert them to ordinary input failures.

Fusion is limited to bounded local work that has no required interruption or
resource boundary. Keep the existing next-row/callback checks, not merely one
check at the end of a long synchronous loop. Do not increase uninterruptible
work with input size, replace scope finalizers with `try/finally` around foreign
Promises, parallelize checks, or retain a SQL transaction across user execution.

### Connected delivery and deletion gates

1. **Freeze the contract and baseline.** Use the existing harness and profile
   artifacts; before implementation collect a fresh counter-only baseline on the
   exact source revision. Expand existing tests with paired-fault/order witnesses
   at the cuts above. Use real owners and observable hooks/getters, not a second
   implementation of document semantics in the harness. Record source hashes and
   preserve unrelated checkout changes. No new measurement API is needed.
2. **Replace the internal row handoff end to end.** Start with relational
   normalization/canonical issuance, then working-set reads/writes, activity and
   the existing root/materialization handoffs. Preserve the full Application
   value domain as well as JSON framework rows. Carry existing owner-issued
   projections; seal backing storage before removing any alias-defense check.
   Migrate every touched ordinary/finite consumer in the checkpoint. Remove the
   superseded internal raw-carrier/projection adapters after their last caller
   moves; retain raw decoders only for real foreign/durable/public boundaries.
3. **Replace internal execution composition across those same operations.**
   Consolidate adjacent Result work, retain Effect at actual async/callback/row/
   scope cuts, and remove displaced per-scalar wrappers and helper-only diagnostic
   construction. Keep the core source/table validator callback and recursive
   borrowed frontiers intact where necessary. This is one operation-path change,
   not a series of isolated helper experiments.
4. **Close consumers and remove obsolete internals.** Exercise ordinary Commerce,
   CMS/Payload, finite mixed roots and Application reads/writes through their real
   entry points. Framework hooks/access, native normalization, lifecycle events,
   compensation and serialization keep their existing owners. Use existing
   `LogicalDocumentChanges`, activity contributions and closed-root contracts;
   change a private contract only when the actual ownership transition requires
   it. Remove displaced exports, factories and representation-only fixtures;
   preserve behavioral tests and migrate diagnostic consumers to retained events.

These are independently measurable checkpoints of one connected design, not
permission to keep permanent old/new engines or a production feature-flag fork.
No new package is needed. Protocol value changes belong in `flarex-protocol`;
working-set, stored evidence, metadata, capture and materialization remain in
`persistence-postgres`. The existing CMS/Commerce caller sites and framework
adapters translate only their current contracts. Executor tests own measurements.

### Correctness and measurement gates

Extend the existing witnesses rather than build another test harness:

* `storage/documents/logicalRelationalCanonicalRows.test.ts` and
  `logicalCanonicalDocumentSemantics.test.ts`: exact issuer/generation,
  foreign clone/getter, buffer alias/tampering, full runtime domain,
  detachment, byte bounds and distinct entry refusal orders.
* `values/privateJsonData.test.ts`, `logicalQueryPredicate.test.ts` and
  `logicalPreparedWriteMechanics.test.ts`: descriptor/Unicode/negative-zero
  behavior, lazy bounds, no failed reuse, preparation disposal and retained bytes.
* `execution/finiteStorageReads.test.ts` and the logical working-set read
  transaction scenarios: first row refusal before later access, interruption,
  missing/tombstone, withheld body, membership-before-body, packet charge cuts,
  current/snapshot reads, overlay generations and original dependencies.
* Materialization composition scenarios on both PGlite and ordinary-role
  PostgreSQL: immediate RETURNING corruption before later failure, final stored
  proof after later corruption, unique ownership, rollback and atomic publication.
* Existing real Product/Pricing/Link workflow, Payload Local API and Application
  consumers: result parity, hooks/events/access, nested failure, closed state,
  cancellation/drain and uncertain-outcome/recovery behavior. Use separate
  PostgreSQL connections for the existing concurrency/freshness witnesses.

For each implementation checkpoint, measure fresh complete native/Flarex roots
with five warmups and 40 alternating matched pairs in the unprofiled root-counter
lane, repeated in an independent process. Preserve all pairs, workload/size,
data, source/variant hashes and verification/cleanup gates. Report absolute
native/Flarex CPU, paired mean and median, block uncertainty, process versus
thread counters and deltas from both baseline and prior checkpoint. Measure
quiet wall latency separately; keep profiles out of savings measurements.
Use the existing complete dual-lane CPU profile only to confirm that removed
work disappeared, with the corrected marker admission and observer control.

Proposed material-progress gate for the connected redesign: at least **25% lower
mean added CPU** in repeated matched cohorts (about 27.6 ms against the current
110.2 ms baseline), with no correctness or meaningful tail regression. This is
a proposed intermediate decision threshold, **not a savings forecast or relaxed
completion target**. If reductions remain a few milliseconds or within variation,
stop stacking helper changes and report that the redesign hypothesis failed.
Do not retain a speculative private representation break solely because its
microbenchmark or factory counts improve.

Final acceptance remains the existing **<=16 ms median added thread CPU** and
**<=5/10 ms paired quiet added median/P95 latency** policy on all selected
complete native graphs; this proposal does not claim either target is feasible
or achieved. Validate small and typical/multi-row cases where a complete native
reference exists, and label missing comparisons without substituting SQL-only
baselines. Track retained memory/large-value behavior as well as CPU.

Before retaining runtime changes, require affected typechecks, source/compatibility
guards, both database lanes, configured lint checks and both required read-only
reviews. Report those independently of performance. Measure the row handoff and
execution composition independently before retaining the connected change.
The rejected initial candidates are preserved only as diagnostic patches; they
do not create an alternate runtime, supported API or accepted architecture.

## Issued metadata selection and ordered consumption

Status: implemented. Complete native-relative CPU acceptance remains unmet.
The existing finite metadata
projection owns retained selector tuples and identity strings for exact issued
immutable facts. Reuse those facts inside its original consumers; retain the
generic protocol encoder and complete foreign/missing-selector validation.
Selector indexes are bounded by admitted present contracts and end with the
projection. Escaped immutable facts may retain their encoding while referenced.
It grants no serving, database or settlement authority. Root closure, watermark,
issuer/observation equality, dependency consistency and budgets stay live per
consumption; final database metadata comparison stays authoritative.

Simplify adjacent pure table/access consumption within the existing Result
owner. Preserve lazy first-failure sequencing: table consumption precedes
source-policy selection, and access families/unique fields retain their order.
Keep the Effect lifetime and all checks around these pure steps. Measure selector
reuse and consumption composition independently in complete matched roots;
elapsed owner envelopes are not CPU savings or complete acceptance.
The table helper uses lazy Result.flatMap; the ordered access loop keeps its
Result.gen interpreter and yields unused Result values directly, preserving
immediate refusal without delegated success iterators or eager traversal.

## Mixed measurement runner diagnostic policy

Unconfigured mixed performance requests must use the existing execution
diagnostic defaults at each independent fixture runner. Plain work previously
enabled default Effect spans in business/publication runners and in nested
signed-evidence preparation and in-process request decoding. The shared default
located-transaction runner and installation-protected scope control reader also
start unconfigured installation-admission runtimes; apply the same defaults at
those owners without changing admission locks or transaction settlement. Correct
the test owners by reusing the policy and lending only the selected diagnostic
composition through their existing runner boundaries. Configured tracing stays
explicit and request-local; no business service, Clock, transaction, resource
owner or settlement capability is inherited implicitly. Preserve every original
codec, database check, failure channel and cleanup sequence.

This is a measurement-policy correction, not evidence of a large CPU saving or
complete performance acceptance. Measure the quiet policy independently from
row-path changes. Ordered row acceptance/projection remains an investigation:
identify a witnessed removable frontier and preserve existing immutable-value
issuers, foreign capture, mutable-buffer checks, membership/decode/hydration
order and per-consumption charges before selecting an implementation.

## Approved Correction: Transaction Binding Selection Reuse

Status: implemented. All six duplicate standalone head/evidence reads are
removed; mixed publication retains its fresh pair. Complete native-relative
performance acceptance remains unmet for all five graphs.

The owner authorizes removal of the six duplicate standalone binding reads.
Atomic commerce admission lends its repository-authenticated positive binding
selection to coverage acceptance in the same guarded transaction. The repository
owns the selection, exact transaction/location identity, prepared metadata guard
and live preparation lease. Capture ends before business callbacks; its lifetime
continues through publication and closes on every Exit. Evidence acquired inside
business savepoints cannot enter this scope. Binding replacement invalidates the
selection before writing. Absence, failure and source/readiness permission are
not retained. Current authority, build/obligation/lifecycle/frontier acceptance
remains fresh; coverage contexts are independently issued for each phase.

This extends private evidence lending only: no schema, durable format or public
contract changes. The three coverage phases borrow the source admission's first
locked and authenticated selection instead of rereading head/body. Mixed finite
publication retains its fresh head/evidence pair because entry and publication
use different transactions. The distinct final reference-publication check also
remains. Remove displaced standalone rereads without cross-transaction lending.

Require scope exit/rollback/interruption, preparation closure, own binding change,
savepoint rollback and concurrent activation witnesses, PGlite and ordinary-role
PostgreSQL consumer regressions, strict/lint/source guards and both reviews. The
structural target is six fewer standalone exchanges with unchanged mixed fresh
publication and maintained business work. Repeat all five complete matched native
graphs in database, CPU and quiet lanes with frozen sources; keep fixed CPU and
latency acceptance and report failed gates. The owner explicitly requests a
checkpoint commit while complete performance acceptance remains open.

## Current Decision: Binding-Owned Maintenance Cutover

Status: **implemented; complete performance acceptance remains unmet**. The selected outcome is
removal of recurring index and unique coverage-marker updates for genuinely
maintained framework-bound builds. The measured mixed request advances 49 index
and 16 unique markers for nine document revisions. Definition selection already
uses touched tables; merely filtering unrelated tables or batching the 97 final
coverage verification reads does not remove this multiplier.

Extend the existing typed index/unique maintenance owner to distinguish genuine
Application activation from genuine framework binding activation. Binding
activation authenticates the complete immutable requirement set, proves build
coverage under publication exclusion, and opens protected obligations tied to
the exact binding, physical specification, generation, epoch and build attempt.
Separate issuer identities prevent equal activation sequence numbers from
colliding. Framework adapters do not gain obligation creation or commit authority.
Binding activation borrows the existing Application repository's authenticated
activation target profile, with exact serving/activation installation and locator
agreement. Its fixed maintenance publishers are available only to the activation
principal; ordinary request credentials cannot install obligations. Preparation
and reads retain the serving target. Application-owned shared physical views keep
Application maintenance and their existing write-ownership restrictions.

Every supported subsequent writer accepts the complete current maintenance
closure and applies actual document/index/unique changes atomically with the
outer publication. Readers verify the genuine current obligation and retain
fresh authority, binding, lifecycle, retention and snapshot checks. Healthy
serving builds retain their sealed opening frontier instead of rewriting it
on each commit. Backfill, validation and genuinely unmaintained builds retain
their explicit progress contracts. Missing maintenance is refusal, not a
fallback to a second serving protocol.

Binding replacement, withdrawal, Application activation, epoch changes and
build retirement must preserve ownership, lock order and uninterrupted coverage.
Carry or close outgoing obligations before opening replacements in the same
authoritative lifecycle transaction. A physical build cannot acquire conflicting
maintenance owners. Historical evidence remains immutable. Unknown COMMIT uses
existing durable resolution before replay; failed transitions roll back together.

Affected owners are binding activation, typed maintenance schema/permissions and
installation integrity, shared publication, ordinary/native finite readiness,
builders and recovery. Private storage and runtime contracts may break within
this cutover. Convert populated installations under the existing maintenance
interlock using authenticated current bindings and exact build coverage; reject
inconsistent evidence without inventing authority or deleting application data.
Preserve rows, history, claims, outcomes and activation history. Migrate consumers
and remove displaced serving-path advancement and representation-only fixtures
in the same cutover. Candidate/build progress remains only for its actual owners.

The steady-state structural target for the measured converted graph is zero of
the 65 marker updates and their existing 227 internal SELECTs. This is removal
of the old 292-statement loop, not a net latency prediction: replacement fresh
acceptance still has cost. Actual index revisions, uniqueness, search maintenance,
events, outcomes, immediate actual-write proofs and final guards remain required.
Search coverage redesign, new framework capabilities and unrelated capture/CPU
changes are not selected by this approval.

The converted mixed graph now has zero recurring index/unique coverage updates,
while retaining nine document revisions, 42 index revisions, two unique releases
and ten claims. The three ordinary coverage phases borrow authenticated binding
evidence within the same protected transaction; mixed publication retains its
fresh head/evidence pair in its distinct settlement transaction. The
complete native-relative CPU and latency gates still fail for all five graphs.
The [cost ledger](../../packages/medusa-adapter/benchmarks/core-performance/native-business/cost-inventory-proposal.md#transaction-binding-reuse-result)
owns the measured result and its limits. Structural work removal does not close
the complete performance outcome or authorize the separate capture/CPU proposals.

Validate missing/forged obligations, incomplete maintenance, equal issuer
sequences, concurrent binding changes/publication, shared definitions, rebuilds,
old snapshots, retention, rollback, interruption and uncertain outcomes. Require
populated migration and ordinary-role permission proofs on PGlite and PostgreSQL,
affected standalone/mixed consumers, strict/source/lint checks and both final
reviews. Freeze the complete checkpoint for matched native measurements; report
counts, complete latency and CPU separately and retain the fixed acceptance
gates. Failed performance acceptance remains open after the correctness checkpoint.

## Cost Inventory And Discussion Basis

The owner requested an exact work inventory and ranked proposal covering
publication, repeated finite captures and client CPU, followed by discussion
before implementation. That discussion selected the binding-owned maintenance
cutover above; repeated captures and client CPU remain investigation proposals.
The preceding connected replacement is
committed; complete native-relative performance acceptance remains unmet.

The [cost inventory and ranked proposal](../../packages/medusa-adapter/benchmarks/core-performance/native-business/cost-inventory-proposal.md)
owns measured counts, source-derived internal work, fresh CPU evidence and its
limits. The selected direction is the connected maintenance cutover above.
Ordered final coverage verification batching was the initial alternative and
is not the selected primary mechanism. Retain full stored
proofs, immediate post-write checks, failure order, locks and durable records.
Reduced internal statement executions are a hypothesis to validate, not a
complete performance deliverable or a claim of saved milliseconds.

Finite rows and complete index selections already have root-owned reuse. A
bounded demand identity/frontier ledger must establish actual duplicates or
independent demands before assigning capture savings. CPU profiles identify
sampled locations; neither an Effect/Drizzle percentage nor a repeated value
visitor proves redundant work. Other runtime changes await discussion of the
concrete contract, consumers, validation and removal gates. Existing native
CPU/latency targets and the separate standalone-read pause remain unchanged.

## Connected Root, Storage Frontier And Contribution Replacement

Status: selected for implementation under standing core-redesign approval.
Complete native-relative performance acceptance remains unmet; the mechanisms
below are concrete source-established repeated work, not exclusive latency
attribution or a prediction that the fixed targets will pass.

Deliver one connected replacement across ordinary Application/source admission,
finite storage acceptance and root-owned pending/contribution handoff. Existing
standalone Payload and Medusa commands/workflows and mixed Product/Payload/workflow
roots are affected. Framework business methods, hooks/events, independent outcomes,
finite OCC/replay and ordinary/durable finish-only recovery retain their owners.
No new framework capability, public API, host lifecycle or speculative read demand
is selected. Preserve unrelated unfinished runtime work separately.

### Concrete Contracts And Private Breaks

- Extend the existing genuine `AcceptedApplicationBinding` issuer with full
  current-command versus finite-entry acceptance and a pre-lowering lending phase.
  A source consumes an already accepted basis only with the exact selection and
  transaction, open issuer/protection, complete authority/clock fingerprint and
  an actual coherent checked head. A `refresh` result is never positive readiness.
  Clock progress requires genuine fresh acceptance; changed selection refuses.
  Weak finite-entry evidence cannot satisfy full ordinary readiness. Preserve
  fresh revocation and each source's selected head, correlation, permissions and
  physical eligibility. Ordinary initial full readiness remains required once;
  this cutover does not silently change unrelated-definition refusal semantics.
- Close lending before materialization/publication and sanctioned same-transaction
  lifecycle or rebuild transitions. These writes can change readiness without
  changing the caller's clock object. Carry the genuine token through existing
  prepared Application/Atomic/CMS/Commerce callbacks; delete repeated full basis
  acceptance for the same valid lent observation. No second authority cache or
  adapter-local bypass is introduced.
- Replace finite capture's repeated installation/control JSON and set-returning
  composition with a typed scalar fresh frontier. Installed owners acquire the
  actual target/control installation latches in the existing lexical order,
  authenticate the actual login's current installed policies and exact permitted
  helper, then accept current scope/placement/receipt and metadata epochs once.
  Qualified helper selection is fixed by genuine installed identity. Authenticate
  the original login's EXECUTE on the outer placement routine and dynamically
  selected target helper; static control-helper delegation remains owned by the
  placement routine. Both current installed runtime policies remain mandatory.
  Caller-authored flags, SQL or a cached verdict cannot establish admission.
  Before the privileged helper invocation, a bounded unlocked lookup
  authorizes the exact target namespace from actual scope/deployment placement.
  This lookup supplies no final freshness verdict; the later locked placement
  rechecks that namespace after both lexical installation latches. A same-named
  granted helper in a foreign namespace must never execute. Preserve least
  privilege, both latches and the maintenance interlock.
  The finite owner still accepts session/anchor identity, claim/fence, revocation,
  expiry, retention, demanded build/coverage/history and post-wait time/head in
  their current refusal order. Materialize one scalar invocation; remove the
  displaced finite SQL composition rather than retain another engine.
  Retire the unreferenced installed `lockFiniteScope` preparation and its
  `fx_lock_finite_scope_observation` routine in the replacement migration.
  Its historical migrations remain immutable; current installation integrity
  requires its absence. The ordinary share/attempt protections still serve
  initial entry, renewal and settlement and retain those actual callers.
- Keep pending canonical values and observations with the existing authenticated
  root/evaluator. Journal planning consumes its private owned point view without
  detached inspection round-trips. Ingress and escaping public/syscall projections
  retain their byte/value detachment. Root close transfers one detached graph and
  original-row provenance set together. The existing materialization compiler
  consumes indexed closed evidence and retained canonical plans, preserving
  source/definition/page/error order, byte budgets, dependencies and every touched
  table's maintenance. Remove duplicate graph/command/maps and original projections
  only after their consumers migrate. The trusted outer owner still settles once.
- Compose developer-index, unique-index, relation, reset and row materialization
  directly in the existing Effect owner. Remove private Promise orchestrators
  that start nested runtimes, migrate the ordinary and finite commit consumers,
  and retain the actual outer framework/Drizzle Promise boundary. Preserve the
  complete Cause, flush/prefix ordering and deferred coverage maintenance.

Affected private contracts are Application prepared-callback token propagation,
finite installation/placement/capture composites and routines, journal/root closed
evidence, and materialization preparation. Update actual callers and tests in the
same cutover; no compatibility wrappers or dual readers. Existing ordinary
placement and durable journal readers remain for their named profile obligations,
not as finite fallback paths.

No application row, history, journal/result byte or durable-outcome format is
changed or deleted. New installed routine/type signatures require managed
maintenance, grant/integrity inventory reconciliation and stale-host refusal.
Drain existing borrowers and install the replacement under the existing interlock;
do not silently reset populated data or mutate live installation structure outside
that owner. Any additional durable representation change needs explicit disposition
before dependent runtime changes.

### Validation And Result Gate

Prove exact issuer/selection/transaction/clock and callback lifetime; refresh and
same-transaction writer invalidation; three-source common readiness acceptance
with separate source eligibility; forged/foreign namespace and restricted-role
refusal; installation drain/epoch changes; original/pending/tombstone and historical
membership/coverage; post-wait revocation/expiry; byte alias isolation and original
provenance; ordered failures/budgets; rollback-only, interruption, AFTER-trigger
verification, atomic publication and uncertain-COMMIT resolution. Run affected
PGlite and distinct-connection ordinary-role PostgreSQL scenarios, real standalone
and mixed framework consumers, strict/source/lint checks and both final reviewers.
Remove displaced code, exports and fixtures within this connected replacement.

Freeze the actual complete checkpoint for matched native comparisons of the five
existing graphs. Report paired complete latency and thread/process CPU, actual
SQL/protocol work, setup, tails and counter limits separately. Preserve the fixed
5 ms added median / 10 ms added P95 latency gates and existing CPU gates. A faster
helper or structural count is supporting evidence; it cannot finish performance.
Reuse the previously prepared measurement SDK's counter-only paired mode and
owner observation support in both the comparison baseline and candidate. This is
acceptance instrumentation, not a runtime performance improvement. Quiet calls
install no diagnostic collector; paired counter calls take only boundary counter
readings, retain calibration and availability limits, and never evaluate quiet
latency acceptance. Validate and review the adopted SDK with the connected diff.
If substantial excess remains, continue the connected redesign at its evidenced
cost owners rather than end delivery after a component saving.

## Connected Entry Preparation, Payload Lifetime And Placement Cutover

Status: selected continuation of the same connected performance deliverable.
The first complete mixed Product comparison still fails the native-relative
targets. Continue through these remaining repeated owners; do not treat the
preceding source replacement as completion.

The existing Application issuer owns one current preparation slot within its
existing bounded prepared-host lifetime. Immutable schema, source, decoder and
compiled-plan construction may be reused only after fresh compact placement,
Application head, authority and both protected metadata epochs select that exact
compatible graph. The key authenticates the issuer, deployment, scope, physical
database/schema, activation revision/digests, fixed source/profile identities,
authority generation/fence and target/control metadata identities. A changing
commit sequence remains a fresh command observation, not an immutable graph key.
Ordinary managed relational entry acquires the genuine installed target/control
pair before clock/head locks. Unprotected `fullProof` callers keep fresh proofs;
the Product performance consumer explicitly migrates to the managed pair and
reports installation/setup separately. Do not cache an unprotected full proof.

Compatible replacement constructs before business execution; incompatible fixed
schema/source/profile refuses. A head race after observation retains the existing
concurrent-head outcome and never retries a business callback. PreparedHostRuntime
accounts for static, current, borrowed retired and staged generations. Failed or
canceled stages release their capacity; retirement occurs after the last borrower,
and existing host close drains all borrowers. This replaces cumulative reconstruction
charges, without introducing a new host lifetime, global cache or second authority.

The Payload adapter owns one native BasePayload resource in the existing parent
Scope, with initialization and destruction once. Its private mixed runtime creates
a fresh scoped attempt facade bound to the exact live journal attempt. Each outer
Local API operation still creates a fresh admitted request/dataloader; nested hooks
reuse that exact request. Attempt closure aborts its borrowed CMS ownership and
revokes the facade; foreign attempts, late work and closed parents refuse. Retry
reexecutes the complete root with fresh attempt/request/hook state and Product
manager, while reusing the parent's native instance. Fixed test hooks select their
attempt state from the genuine request context, rather than closing over mutable
factory counters or installing a new global/AsyncLocalStorage registry. Migrate the
mixed comparison fixture and retry/cleanup witnesses to this real adapter owner.
The prior per-attempt native-instance requirement in preflight 02 is superseded;
no arbitrary hook API or production capability is added.

Installed initial entry, renewal, running-attempt transactions, settlement and
standalone snapshot reads consume the same fresh scalar placement owner. Replace
their duplicated JSON installation projections and epoch joins together with the
genuine-pair lifecycle acceptance API. Transaction admission is recorded only after
the scalar accepted result and exact registered pair/selector/protection checks.
Immutable expected identity supplies no live verdict; both returned metadata
generations remain fresh. Preserve each caller's actual authority/clock lock mode,
scope/receipt decoding and refusal order, post-wait sampling, session/claim/anchor
locks and final NOWAIT metadata guards. Preserve explicit resourceFailure rows
through gated lateral joins. The scalar contract requires a positive statement
timeout no greater than 30 seconds; verify and migrate genuine installed callers'
actual startup/transaction budgets, without weakening that bound or silently
changing scope-less timeout semantics. Retire the old placement routine only
after all named scoped callers and tests migrate.

Scope-less genuine-pair admission also replaces its paired JSON projection with
two direct MATERIALIZED installation-frontier calls in the same lexical latch
order; the second runs only after the first accepts. The actual runtime login's
EXECUTE permissions, both current policies/identities and maintenance latches
remain mandatory. Return only acceptance and fresh target/control generations to
the same lifecycle and managed-metadata evidence owner. It supplies no scope,
placement or clock verdict and adds no placement timeout rule. Migrate the located
read and default nonaccepting runner, ordinary paired entry and direct paired test
consumers; remove paired JSON construction/acceptance afterward. Single-installation
admission and issuer construction retain their named current obligations.

These are private construction, attempt and installation contract replacements.
Migrate affected callers, grant/integrity inventories and installation helpers in
the same cutover. No application/history/journal/result bytes or durable outcomes
change or reset. Keep existing maintenance/drain and stale-host refusal. Validate
stable construction with fresh admission on every call, compatible/ABA/head races,
both namespace maintenance and revocation, capacity retirement and full Cause on
failure/cancellation, parent/attempt cleanup, real hooks/retry/replay and paged
Medusa work on PGlite and ordinary PostgreSQL. The five complete native graphs,
latency/CPU gates, cleanup and both final reviews remain the completion criteria.

### Retained issuer disposal and fresh-command ownership

The existing host lease and its generation own disposal as well as byte charging.
An expired opaque key must not keep a charged metadata graph alive after its owner
returns that capacity. Register total private issuer-state deletion with the actual
preparation lifetime; reclaim it only after retired borrowers drain. Failed or
cancelled construction releases its issued states and charges, and a closed
lifetime refuses registration. Apply this to the actual Application, readiness,
relation, candidate, physical-definition and source preparation owners. Keep one
lifetime and one charge owner; do not introduce a second retention registry.

The retained physical framework installation owner also captures its actual host
allocation before the native transaction bridge. That bridge carries tracing
context, so ambient preparation charging inside its callback cannot account for
retained evidence. Charge the completed evidence payload through the captured
allocation at its original ordered boundary, and delete the private token state
on actual disposal after borrower drain. Physical Commerce, physical Atomic
participants and CMS preference lifecycles keep their full fresh installation
evidence replay. The daily logical source graphs do not use this replay owner;
correcting its accounting and disposal is not a claimed latency reduction.

Static source definitions remain with their source host. Per-Application-token
selected structures belong to that Application generation. A fresh full-proof
command uses a temporary generation under its existing host lease, borrows it
through the actual command and settlement, then retires it. It still performs its
complete fresh compatibility proof. A request without a preparation lifetime uses
only callback/transaction-local selected structures; it does not add dynamic
token-dependent graphs to the static source host. Prove churn, escaped retired
keys, active borrowers, cancellation and exact capacity reconciliation.

## Connected Contribution And Publication Composition

Status: selected within the active connected redesign; complete native-relative
acceptance remains unmet. The genuine Application and source issuers already own
immutable definitions, but settlement reconstructs definition maps, ordering and
scalar comparison pages from them. Final-reference publication also starts an
internal Effect runtime beneath an existing transaction bridge. Replace this
repeated preparation and runtime choreography across real finite and compatible
ordinary consumers.

- Compile per-table definition order, lookup maps and immutable scalar expectation
  fragments at the genuine definition/source issuer. Charge retained structures
  and encoded page fragments to its actual preparation lifetime and dispose them
  with that issuer. Structural equality, a digest, copied records or a frozen
  foreign object never substitute for issuer identity.
- Closing a genuine contribution selects its actual touched membership, merges
  colliding source definitions in the existing order and creates its private
  settlement plan. Scope, transaction, current watermark, checked head and fresh
  acceptance callbacks remain settlement-local. Retained expectations supply no
  permission, readiness, coverage, OCC or publication verdict.
- Make the existing final-reference and clock owners canonical Effect operations.
  Finite, CMS, Commerce and cross-domain publication compose directly beneath the
  existing outer transaction bridge. Preserve exact typed failure, defect and
  interruption outcomes, rollback, deferred original Cause and uncertain-COMMIT
  recovery. A real foreign Promise transaction boundary remains at its owner;
  internal Promise wrappers and nested runtimes are removed after migration.

The owners are `pointCommitTransaction`, `finiteMetadataDependencies`,
`finitePublicationObservation`, the genuine Application/source/participant
issuers and `commitPublication` with its actual final-tail consumers. Coordinate
issuer edits with retained-preparation disposal rather than create another
compiler or cache authority. Private signatures may break; migrate all real
callers and remove displaced exports in the same connected cutover. No schema,
canonical bytes, stored outcomes, journal formats or durable-data disposition
changes are selected here.

Preserve the current ordered SQL acceptance barriers, lock modes and waits,
canonical decoders, exact refusal order, original-row correlation, mutable build
and coverage checks, candidate validation, proofs after AFTER triggers, strong
references and final metadata guards. Combining observations cannot acquire a
later lock before an earlier decoder has accepted. Moving any such acceptance
into an installed owner requires its concrete stage/ordinal and decoder contract
to be recorded before that runtime change; this is not a generic SQL command
engine. Validate affected ordinary and finite success, rollback, replay,
cancellation, source collisions, deferred failures and corrupted observations on
PGlite and ordinary-role PostgreSQL. Complete matched native measurements and both
final reviews assess the connected outcome; this compilation step is not a
separate performance deliverable.

## Connected Ordinary Mechanics And Output Ownership

Status: selected within the same connected outcome. Full relational and document
admission already prepares genuine immutable write mechanics, but ordinary and
durable borrowed working sets reconstruct their tables, foreign keys and access
maps because mechanics lending is tied to finite readiness. Separate those two
responsibilities in the existing working-set input. Full ordinary participants
lend the original compiled mechanics and exact table/capability/search/index/
unique arrays; the existing private issuer and its lifetime authenticate them.
Finite execution still requires its genuine root, original snapshot, retained
host lifetime and exact finite capture mechanics. Query-required read mechanics
remain their separate read profile. Request-owned ordinary mechanics supply no
retained acceptance evidence; every actual operation keeps its current source
and transaction admission. Preserve the existing ordered full table checks.

The working-set activity owner selects and renumbers the actual cursor suffix
before its single escaping detachment. Migrate ordinary commerce, borrowed
logical commerce and borrowed workflows from whole-history clones followed by
independent slices. Keep complete observed rows, mutation and lifecycle order,
null restore ordinals and set-null/reference-replacement suffixes. Snapshots
remain detached from pending/original state and stable after later calls; no
public borrowed canonical view is introduced.

For selected rows and pages, keep complete candidate capture and byte charging
before filtering or window decisions. Build the selected projection from that
already detached checked tree, then measure and charge its projected bytes at
the original boundary without capturing another tree whose value is discarded.
Projection cannot increase its source tree's depth. Final write arrays can add
depth, so they retain their full capture/depth check and return that detached
result. Framework-owned foreign result capture before projection, escaping
native normalization and mutable hook inputs keep their actual owners.

The owners are `logicalDocuments/model` and `workingSet`, ordinary and borrowed
commerce participants, and ordinary and borrowed CMS documents. Reuse existing
admission issuers and mechanics; add no registry, generic transaction profile or
compatibility path. Private input contracts and cursor consumption may change;
migrate actual consumers and remove repeated construction/slicing/capture in the
same cutover. Canonical formats, stored documents, journals and publication
semantics do not change.

Prove genuine/foreign/copied mechanics, exact-array mismatch, closed lifetime,
ordinary versus finite/read profile requirements, current source admission,
multi-call cursor order and stable detached snapshots. Preserve hidden-invalid
field failures, full candidate charging before filtering, exact projection byte
limits, Unicode ordering, nested/byte-value mutation isolation, final array depth
limits and native getter/oversized-result failures. Use affected PGlite and
ordinary-role PostgreSQL owner and real framework proofs. A root CPU diagnostic
may choose further cost reductions; no source duplication establishes exclusive
latency or CPU attribution. The complete five-graph native gates, final reviews
and cleanup still govern the connected performance result.

## Active Delivery Direction

The owner selects substantial connected performance redesign and authorizes
continued implementation under the standing core approval. The earlier capture
projection's approximately 0.20 ms saving is retained diagnostic evidence; it is
not the requested result and does not justify another independent helper delivery.
The former component delivery loop and stop-for-discussion instruction below are
superseded. Continue with the dominant complete-request cost multipliers across
their actual owners, including necessary private breaking changes, migrated real
standalone/mixed mutation consumers and removal of displaced choreography.

Record the concrete connected replacement, authoritative writer/lifetime contracts
and durable-data disposition before runtime changes. Use existing complete matched
native latency and CPU gates, with SQL/protocol counts explaining cost. Local
experiments support the implementation; they do not close the goal. Preserve
fresh authority, framework lifecycle, Postgres settlement, rollback/cancellation,
uncertain-outcome recovery, both driver proofs and both final reviews. The
separate standalone-read tuning pause and unrelated capability/host gates remain.

## Historical capture result handoff preflight

Status: the client projection replacement and fixture close correction are
implemented and connected correctness validation passes. The finite capture owner
now supplies one header and final storage bodies. The isolated client comparison
shows approximately 0.20 ms saved per nine-demand batch; this is much smaller than
the request latency still under investigation. Complete native-relative acceptance
remains unmet. The earlier incomplete instrumented campaign remains retained.
The corrected fixture completes a separate eighteen-window strict diagnostic.
Delivery must validate the replacement against the committed inline ownership
and installation topology, rather than importing the preceding unfinished
cutovers. The private result handoff does not require those topology changes.

The owner authorizes closing this delivery: audit the exact prerequisite hunks,
resolve the committed capture/test boundary without importing unrelated lifecycle
or failed publication work, and validate the actual commit checkpoint. One final
strict instrumented run is selected on the corrected frozen source: two serial
passes of nine original demands, at most eighteen capture submissions, zero
automatic retries and no additional native/business graph. Preserve the earlier
failed campaign and use separate artifacts. Its result must include successful
read-root close, stable sources/settings, complete windows and cleanup. This
completion work does not select a SQL/cardinality change or lower the complete
native-relative latency gates. Executing-source proof includes already-loaded
promoted Medusa compiled modules as well as authored packages and the existing
upstream source island. Their contents must participate in the source fingerprint;
an unchanged authored source inventory alone does not prove compiled stability.
Final committed-topology validation uses a separate eighteen-capture diagnostic
after the source and setup-lifetime corrections. Retain failed earlier artifacts;
there is no automatic retry.

The SDK arms diagnostics, verifies the actual runtime pools and fingerprints the
loaded source island through the existing fixture preparation callback, after
native module/seed preparation and before initial finite admission starts its
lease supervisor. Diagnostic preparation must not consume that active lifetime.
The real renewal interval and database checks remain unchanged. If a measured
read window itself overlaps renewal or any other nonselected submission, the
diagnostic still fails closed. The retained committed-topology failure shows
seventeen clean windows and a final window containing the genuine renewal
transaction followed by its successful capture; it is not evidence of extra
capture SQL or permission to exclude renewal from a complete request measurement.
Construction failure before resource handoff reports cleanup as unverified and
retains the original complete cause; the SDK must not certify releases it could
not observe. Explicit owned release failure still reports failed cleanup.

### Current evidence disposition

The implementation comparison is bounded before execution: one ordinary-role
PostgreSQL fixture with server diagnostics disabled supplies two passes of the
nine genuine captures, at most eighteen target capture submissions. Test-local
projection parity observation validates the handoff; it is not a fully quiet
request comparison. The fixture validates successful close and retains
the actual driver arrays and compiled Drizzle fields in local memory. The frozen
preceding mapper and its raw-envelope assembly are compared with the replacement
on those same arrays: three warmup rounds and twelve alternating paired rounds,
each processing 1,000 nine-demand batches. Report elapsed and process CPU per
batch, distributions and structural object counts. This isolates client projection;
it does not estimate transport or claim a complete-request latency improvement.
Setup, database execution and diagnostics are outside that timed comparison.
Existing genuine PGlite and ordinary-role PostgreSQL correctness lanes, connected
consumer regressions and both final reviews remain required. SQL/cardinality
changes and a full mixed/native campaign remain outside this slice.

The isolated first and second passes each contain nine genuine target commands
and 173 nested server calls. All inputs reuse one retained named statement and
structural template on one observed backend. First-input initialization differs
from first use of each logical demand; the latter does not mean nine cold SQL
templates. Second-pass root server planning remains observed despite named reuse.
All eighteen input windows of the earlier instrumented campaign pass their
source/settings, submission, plan-ID and continuity checks; that campaign's final
read-root settlement does not pass. Its artifact retains that failure.

The earlier fixture closed its borrow inside `withinDeadline`; the bounded
lifetime's seal correctly refused that active-call overlap.
The normal Product consumer completes deadline-wrapped native/read work before
checking and closing the borrow. The fixture now returns both passes and their
result validation from the deadline body, then performs its final check and single
close. Its isolated ordinary-role execution completes all eighteen captures and
aborts the read root with zero changes or events. It retains the same admitted
borrow, normal deadline, capture closures and abort/discard cleanup. The corrected
strict diagnostic also completes the read-root close and cleanup. No automatic
diagnostic rerun is selected.

The retained instrumented server windows distinguish initial envelope cost,
repeated outer planning and nested SQL execution. They do not establish quiet
request latency, exact client CPU, transport cost, asynchronous log-flush
completeness or removable allocation cost. The corrected isolated fixture proves the
close topology separately. The final committed-topology diagnostic must retain
the complete executing-source fingerprint. Production performance acceptance
remains a separate gate.

The observed outer plan has a source-established cardinality mismatch: the
single-row placement and accepted-capture headers are `RETURNS TABLE` functions
without explicit `ROWS` declarations, each estimated at 1,000 rows despite one
actual row. Their multiplication with the storage append estimate produces an
outer estimate of two billion rows for two or four actual records. All observed
inputs share the same 59-node envelope; retained node/statistics evidence shows
small actual outputs and no disk/temp traffic. This establishes a planner-contract
candidate, not its latency contribution, an index defect or a selected SQL
replacement. Node timing/function tracking are disabled and server instrumentation
cost remains inseparable in these windows. Keep that candidate distinct from the
existing client projection work until a focused decision uses complete evidence.

### Evidence, outcome and limits

The projection-only contract below describes the earlier capture shape. The
[connected native-acceptance handoff](#connected-canonical-value-and-read-acceptance-handoff)
supersedes its retained broad header and combined `indexRows` operation. These
are private executor contracts; they do not establish a public compatibility
obligation. Retain the evidence below for attribution, not as authority to keep
displaced shapes after their consumers migrate.

The retained Product diagnostic identifies six candidate captures and three
historical unique-owner captures beneath relational selection. A fourth unique
capture belongs to write validation, outside that nine. These are distinct real
demands, not demonstrated duplicates. Ordinary physical drain/release is a small
part of the successful graph; query awaits still combine server, lock, transport,
queue and client work. Resources mode retained no statement templates, statement
counts, row counts or result-byte sizing. It cannot retrospectively supply them.

The measured starting owner already retained SQL, positional fields, native Drizzle decoders
and statement names by genuine database/installation identity. Root-owned row,
unique and index observations already avoid repeat storage requests. Historical
`indexRows` already materializes membership and hydrates its uncached original
rows in one submission. Rebuilding those caches or promising fewer exchanges is
not the selected direction.

The displaced source-established repetition was in
[`finiteStorageCapture.ts`](../../packages/persistence-postgres/src/execution/finiteStorageCapture.ts):
the generic result mapper restored every slot of a query row. The
genuine `indexRows` projection has 138 positional columns, including first-row
authority/build/frontier groups and both index and document fields. Conditional
header slots are null on later rows, yet each row still receives their assignments
and group objects. Other slots legitimately repeat: full-artifact metadata epochs
and the inactive `exists=false` projection. Acceptance then filtered/mapped raw rows and
split prefixed index/document
fields through `Object.entries` and `Object.fromEntries`. This is concrete client
assembly work. On the same actual second-pass arrays, median nine-demand projection
elapsed falls from approximately 0.259 ms to 0.056 ms and process CPU from 0.266 ms
to 0.062 ms. These component measurements exclude database execution, transport,
canonical acceptance and setup; they cannot establish request latency savings.

The original projection-only replacement delivered the same accepted private capture
envelopes through one retained per-operation projection, removing the repeated
assembly. It does not select a historical SQL, index, locking or authority
redesign. A server-owner change requires the bounded evidence below first.
Standalone read tuning remains paused at its separate owner checkpoint.

### Contract and actual owners

- The finite capture compiler retains the existing SQL, aliases, column order,
  named statement identity, parameters and cache lifetime initially. Compile a
  header descriptor and operation-specific storage descriptor from the actual
  Drizzle projection and its native decoders. Its per-profile/per-operation
  layout distinguishes first-row-only fields, valid repeats and storage fields.
  Decode the first header once and each present storage record once into the
  existing consumer shape. `indexRows`
  partitions its real group discriminator directly into index and document
  arrays; it does not restore a combined prefixed record and regroup it later.
  Keep this pure transport assembly with its existing issuer, not a new service,
  query compositor, generic utility or SDK type hierarchy. Do not duplicate
  table/column names or replace real Drizzle mapping with handwritten coercions.
- Canonical capture acceptance still owns reason and replacement-frontier
  validation, database time, serving sequence, retained floor, demanded build/
  maintenance and metadata-epoch agreement. Working-set consumers still validate
  complete membership/lookahead before canonical row bodies, charge before
  retention and preserve ordered failure and interruption. Native conversion of
  present supported scalar values retains its current transport boundary and
  Cause; no new broad catch, speculative decode or re-execution is introduced.
- Public `FiniteStorageCaptureEnvelopes` and their working-set and journal
  consumers keep their contracts. Migrate all installed finite operation shapes,
  including point rows, index pages, identity/time/retirement and ownership
  manifest/closure siblings, through the replacement in one coherent slice.
  The separate foreign-control epoch/catalog mapper retains its real current
  callers and separate snapshot contract; it is not a fallback finite mapper.
  Remove generic whole-row restoration and raw regrouping from finite captures,
  with no dual finite path or compatibility wrapper.
- SQL functions, installation proof, grants, source-demand issuers, physical
  checkout/deadline/cancel/drain/release owners and outer settlement are retained.
  Every real capture still freshly accepts genuine source/method/table/definition
  demand, installation/placement, scope/session/claim/fence, original snapshot,
  revocation/deadlines, history retention and selected mutable readiness. Post-wait
  time and serving observations remain fresh internal commands. No transaction
  spans a framework callback and no accepted live verdict is cached.

Historical unique selection must retain its matching developer-index membership,
at-most-one owner, original row and canonical key agreement, including absence.
Current unique slots cannot reconstruct a moved historical owner. Preserve
negative index/unique observations, exact page gaps/EOF, tombstone versus missing
row evidence, pending overlays and original dependencies through final OCC. The
checked-in Convex `TransactionReadSet` and index-range reader record missing
documents and consumed/empty intervals; that supports these semantics, not
Flarex-specific installation or fencing choreography.

### Breaks, cleanup and rejected alternatives

The private positional result handoff changes. It is nondurable and has no public
developer or framework contract. No document/index history, attempt anchor,
outcome/recovery bytes, SQL signature, migration, data reset or durable deletion
is needed for this candidate. Ordinary and durable profiles retain their genuine
contracts; Application, Product/workflow and Payload finite consumers receive
the same accepted envelopes and require connected regressions.

Malformed transport is an explicit private contract tightening. Today later
header values are ignored after transport mapping, and unknown index/document
groups can be dropped by filtering. The replacement refuses non-null values in
later first-row-only slots, invalid presence/group markers and populated inactive
body slots as `storedCorruption`. Valid repeated epoch/constant fields follow the
compiled profile's layout; they are not required to be null. For storage-producing
results, layout refusal follows the existing first-header reason/frontier/time/
readiness/epoch acceptance and precedes storage envelopes. Retirement retains its
earlier conclusive terminal-reason return after replacement-frontier validation;
it does not require accepted time/build/epoch evidence to return `retired=true`.
Earlier authority refusal retains priority; unsupported layouts do not receive
an old-error-precedence guarantee.
Supported native scalar-conversion failures retain execute-owned `resourceFailure`
and the original Cause before canonical authority/layout acceptance. Do not
introduce a fallback decoder to imitate malformed layouts.
No returned rows remains `invalidAuthority`; a left-join sentinel remains a real
header with no storage; empty membership retains its negative witness.

Reject replacing historical selection with current slots, caching readiness or
permission, eager relation prefetch, batching distinct demands without an ordered
failure/resource proof, and widening a transaction across business execution.
Also reject shortening/reencoding the SQL projection in this first client
candidate: it would mix wire/server changes with allocation changes before actual
server plans are attributed. A query count or large function body alone cannot
choose a server redesign. No host pooling or compute-lifecycle change is selected.

### Bounded server evidence before a SQL decision

Reuse the existing measurement SDK server resource and capture collectors; their
statement deltas, planning, nested execution, bounded actual plans and PID/wait
sampling already exist. The missing work is a focused seeded fixture/runner, not
another measurement framework. Do not use the full `mixed-product` mutation
runner to answer an isolated historical-read question.
SDK orchestration owns resource/collector construction, arming, observation,
report/export and cleanup. The fixture supplies seeded read-owner callbacks and
actual serving pools, without constructing collectors in core or fixture code.
Its checked initial observation skips the read if counters or log-window
acquisition fails. SDK collection faults remain diagnostic evidence and cancel
the owned isolated read program; they are not forged storage refusals or defects.
Actual capture failure/defect/interruption Causes retain their original owner.

The resources trace did not retain literal parameters. Freeze nine newly seeded,
source-equivalent demand instances and their actual compiled shape/name, owner
and ancestry; do not claim literal replay of the previous trace. Their first
observed pass uses the real borrowed working-set selection and records its actual
capture operations. The second pass repeats those operations through the same
genuine capture closure while that admitted scope remains open, avoiding local
observation-cache hits. Preserve differing bounds/cardinality cases when
deduplicating shapes for analysis. Prepare equivalent bounded revision/index history, installed
metadata and genuine fresh finite authority through existing fixture owners
outside observation. Invoke actual uncached read/capture owners; a cache hit is
not a capture measurement, and saved expired pins cannot be replayed.

The diagnostic budget is two serial passes of nine inputs: at most eighteen
capture executions, zero complete measured business graphs, zero measured native
or native-comparison calls and no
automatic retries. Complete evidence requires all eighteen actual uncached
submissions with fresh pins verified per execution. A cache hit or missing capture
cannot replace an input; early stops remain incomplete. First observed use and the
second pass stay separate. Claim
backend warmth only with actual PID/session continuity and named-query reuse.
Per-input windows retain top-level and nested planning/execution separately,
exact direct-root plan IDs, operators/cardinality/buffers and sampled waits.
Capture the complete installed envelope, not only its inner historical function.
Retain trusted shape details locally; exported plans omit SQL, predicates and
parameters. No business write is replayed through EXPLAIN. Before the first
capture, require a verified owned bounded log source with the exact
`FXPLAN[%p][%d][%c][%Q]` prefix. Keep existing limits: 25 ms polls, 1,200 polls,
128 rows per poll, 20,000 statements, a 30-second observation window, one-second
observer queries, 8 MiB log windows, 512 KiB per plan and 4,096 plans. Missing
expected plan evidence is unavailable/incomplete, never zero work. Plan coverage
refers only to parsed observed-window bytes; asynchronous flush completeness
remains unproven.

Each selected installed capture submits exactly one underlying target command;
its nested functions are server executions. Reject any additional target or
control command in that window, including activity on a reused capture PID.
The existing plan owner retains log identity, offset and a bounded anchor across
windows, refusing replacement, truncation or anchor changes before the next read.

Reuse the existing Product fixture's untimed seed owner: native Tag, Category and
Product creation plus populated retrieval. Report these setup calls separately;
do not execute the mixed business runner for admission or demand derivation.
One genuine admitted borrow owns both passes and its normal close/abort. Preserve
the real claim/lease, command deadline and supervisor renewal; never mute liveness
or raise deadlines for observation. Renewal or other nonselected activity within
an observed window invalidates that window and stops this campaign.

Source/settings drift, unexpected shapes/counts, foreign activity, wrong serving
role, expired/refused authority, reset/evicted statistics, collection/log capacity
faults, incomplete required plan evidence, result mismatch or failed cleanup stop
the campaign with partial evidence. Do not expand the budget or restart it.
Join observers, close fixture pools and remove only the owned generated database/
roles, including both target and observer databases and their roles. Retain reset,
deallocation and entry-epoch guards. Report then stop. Server elapsed intervals
overlap, sampled absence is not
zero lock cost, and driver minus server elapsed is not network time. Exact client
CPU, queue and transport attribution remains unavailable unless separately proved.

### Connected implementation and acceptance gates

The evidence report chooses the next owner: client projection, an evidenced server
access/plan correction, or an explicit unresolved attribution gap. It must state
what is measured and what remains hypothetical before changing runtime behavior.
The client projection is a justified cleaner contract, not a promise of a large
latency gain. A materially different SQL/installation/authority or durable-data
decision requires its own recorded contract before implementation.

For the projection candidate, add focused supported-envelope and malformed-layout
witnesses: sentinel/empty/index-only/row-only/mixed results, cached-owner
exclusions, null versus absent fields, moved historical unique owners, duplicate/
lookahead body withholding, valid repeated installed/full-artifact profile fields,
conclusive retirement
headers/replacement frontiers, and competing converter/authority/layout/body
failures.
Preserve existing lazy first-failure, byte-budget, ownership/control-epoch,
rollback-only, actual post-lock expiry/fresh-serving, interruption and complete
cleanup-Cause witnesses. Validate genuine captures in PGlite and ordinary-role
PostgreSQL, plus connected Application, Product/workflow and Payload regressions,
affected strict checks, lint/source guards and both final-diff reviews.

Use one frozen before/after component comparison to decide actual allocation/CPU
and quiet-latency benefit; define its call budget before running it. Complete
mixed/native acceptance remains its distinct group milestone with unchanged
added-latency gates. Reduced allocation, successful correctness and performance
acceptance are separate verdicts. Migrate all affected private consumers, remove
displaced finite assembly, preserve unrelated dirty work and make one scoped
commit; do not turn helpers or repeated measurements into separate goal turns.

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
| Bounded immutable preparation | [prepared host runtime](../../packages/persistence-postgres/src/execution/preparation/preparedHostRuntime.ts), [source admission](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission.ts), definition issuers | Retain genuine definitions, validators and decoded immutable bodies. Account exact allocation and close/drain; preparation grants no permission, transaction or settlement. |
| Fresh accepting evidence | [active-head reader](../../packages/persistence-postgres/src/application/applicationActiveHeadRead.ts), [readiness fold](../../packages/persistence-postgres/src/application/relations/applicationRelationReadinessFold.ts), CMS/commerce/finite admission | The actual outer owner issues one common Application basis for the exact accepting transaction and compatible requested sources. Source owners consume it and retain their own checked heads, permissions and closures. |
| Values and pending state | [logical working set](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts), protocol codecs, framework capture owners | Capture foreign values at real ownership crossings. Retain owned canonical values, measured limits and original/pending state; direct trusted handoff does not recapture the whole graph. |
| Final contributions | [Application participant](../../packages/persistence-postgres/src/storage/materialization/participant.ts), logical materialization, current profile publishers | Preparation consumes genuine retained definitions and owned contributions. Fresh acceptance, complete write maintenance and settlement remain with their actual owners. |

### Preparation identity and lifetime

Reuse requires the actual database/issuer, installation incarnation and generation,
deployment/scope, source/schema artifact and complete selected definition identity.
Record relevant membership, tombstones and last-changed metadata sequence through
the existing [finite metadata dependency owner](../../packages/persistence-postgres/src/execution/finiteMetadataDependencies.ts).
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
The [relational admission issuer](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalAdmission.ts)
already prepares table/index/unique/access/foreign-key mechanics. Its full
standalone profile must carry these genuine mechanics to the working-set and
participant owners, rather than force them to reconstruct the same table profile.
Demanded read readiness and complete touched-table write maintenance remain
different obligations. Newly activated relevant definitions and metadata ABA
must invalidate the old basis or refuse final acceptance.

### Installation and framework evidence

[Managed installation lifecycle](../../packages/persistence-postgres/src/installation/installationLifecycle.ts)
and [framework installation runtime](../../packages/persistence-postgres/src/installation/frameworkSchema/installation/runtime.ts)
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

- The [binding canonical owner](../../packages/persistence-postgres/src/installation/frameworkSchema/binding/canonical.ts)
  currently constructs canonical bytes and then restores them through another
  validation/hash pass. Issue and retain its genuine checked frame directly;
  stored foreign bytes still require exact decoding and hashing. Mutable native
  data, copied hashes and shallow freezing cannot become retained evidence.
- Full standalone relational admission carries its already prepared write
  mechanics into the working set and [commerce logical participant](../../packages/persistence-postgres/src/frameworks/commerceTransaction/logicalParticipant.ts).
  Remove duplicate table/foreign-key/profile construction while retaining each
  source's confinement, initialization rules and current acceptance.
- Replace whole-activity clones followed by per-call slices and another
  [closed-contribution copy](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/detachChanges.ts)
  with immutable owner-issued activity ranges and one authenticated closed
  transfer. Preserve exact source/call observations, no-final-write decisions,
  dependency order and single consumption. The finite publisher's already
  removed final recanonicalization is not a new optimization opportunity.
- The [atomic commerce result](../../packages/persistence-postgres/src/frameworks/atomicCommerce/execution.ts),
  [outcome encoder](../../packages/persistence-postgres/src/values/jsonOutcome.ts) and
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

## Connected native value and capture execution replacement

Status: **selected for the continuing connected implementation; not delivered.**
The complete mixed root still performs substantial distributed client work after
the preparation, root ownership and publication composition changes. Genuine
root profiles locate physical-session construction, logical working-set factories,
finite capture, safe JSON transport and metadata decoding on the actual path.
They do not establish exclusive per-owner CPU time or predict this replacement's
savings. Eliminate the connected multipliers before assessing the complete
five-graph outcome; individual wrapper or decoder changes are internal steps.

Use the existing root, source issuer, storage capture and physical-session owners:

- Native ingress keeps its descriptor, prototype, omission, node, depth and byte
  checks. A successfully captured immutable value may travel through the trusted
  native DAL/core path with private issued evidence and its existing accounting.
  Untrusted identity, an ordinary frozen object, a copy or mutation cannot obtain
  that evidence. Schema normalization, current policy and operation budgets
  remain at their ordered owners. Mutable hook inputs and escaping result values
  retain their required detachment. Combine native activity validation and root
  consumption around one authentic contribution, without a second pending graph
  or a second authority/settlement owner.
  Binding ingress explicitly normalizes canonical JSON numbers during its first
  descriptor-safe capture; other native capture policies retain their current
  numeric behavior. Local binding capture issues its checked immutable canonical
  frame and bytes directly instead of parsing and hashing those same issued bytes
  again. Its private guard contract is a pure shape predicate invariant under
  canonical numeric representation and object-key order. Repository frame guards
  follow that contract; stateful, object-identity or insertion-order predicates
  are displaced private behavior. Foreign stored restoration retains full
  canonical, hash, envelope and corruption validation. Encoded durable frames,
  existing historical versions and their recovery remain unchanged.
- Compile a finite capture basis from the actual root/attempt and original source
  issuer. Retain immutable anchor bytes, selector/pins and shaped request mechanics
  once under that existing lifetime, rather than projecting and reconstructing
  them at every storage access. Bind changing query parameters only after their
  authentic demand and actual limits pass. Each database command still accepts
  current scope/placement, claim/fence, expiry, protected epochs and demanded
  serving facts. The basis conveys immutable mechanics, never a cached live
  verdict. Keep exact snapshot/history, negative observations and refusal order.
  The original anchor issuer owns the retained basis and immutable snapshot:
  public byte projections detach, scalar snapshot fields are frozen, and the
  reservation remains the exact frozen value from its real issuer. Check the
  original registry and established entry pins before each basis reuse; renewal
  cannot replace those pins. Retain physical mechanics under the actual pool,
  with optional observation isolated by its real resolver identity. Each use
  still acquires and releases a connection; a closed pool grants no new use.
- Root/issuer-bound metadata observations may reuse their genuinely captured
  contracts across borrowed views. Preserve the original watermark and exact
  identity, charge first registration through the current root owner, retain
  conflicting-observation refusal and compare consumed semantics at publication.
  Do not turn a same-manifest head move into an artificial metadata conflict.
- Reuse stable physical-driver operations and typed statement mechanics at their
  existing owner. The physical owner still acquires, supervises, drains,
  quarantines when required and releases every actual connection. Do not retain
  a connection/transaction across native or untrusted code, bypass confinement,
  add a parallel physical engine or change uncertain-COMMIT recovery. Shaped
  sequential reads may share execution only when earlier corruption, budget and
  native refusals still prevent all later work; no eager union/prefetch.

Production and quiet requests must not construct SDK observation spans. In the
installed Effect release, named `fn` also constructs diagnostic definition/call
stack frames and default native spans without a measurement collector. Turning
off its tracer alone retains no-op span lifecycle and call-stack construction.
For the selected repeatedly constructed owner operations, use genuinely untraced
stable operations and apply named observation only through an optional trusted
diagnostic binding composed by the SDK. This is a deliberate internal diagnostic
contract change, not removal of Effect's cancellation, failure or resource
machinery. Keep names and complete Cause/Exit observations when diagnostics are
enabled. Do not create a replacement Effect API or put this policy in generic
utilities. Core consumes one internal diagnostic capability; SDK constructs its
Layer/composition and retains no production import dependency in core.

Independent Promise runtimes must preserve the explicit diagnostic policy,
tracer and current parent while continuing to exclude unrelated business services
and Clock where that boundary already requires exclusion. Migrate actual
Application, physical-session, transaction, Medusa and Payload bridges together.
Opt-in observations must survive those bridges; absent observations take their
direct path. Stack/span changes affect only private diagnostic behavior, not
encoded outcomes, durable data, identities, authority or framework callbacks.

Replace the repeated constructors/captures and migrate their real ordinary,
finite, workflow and SDK consumers in the same connected cutover. Retain no
structural/digest cache, dual path or legacy transport without a named remaining
consumer. No database schema/data reset, new host lifetime, public capability or
durability change is selected by this replacement. Installed publication-stage
fusion remains a separate concrete contract if complete evidence selects it.

Prove authentic/copied/foreign and retired issuer behavior, byte/node/depth and
operation-close failure order, mutable native values and hidden getters, complete
activity/cursor contributions, wrong root/attempt/source and conflicting metadata,
fresh post-wait refusal, cancellation/drain/full Cause, and replay/unknown COMMIT.
Prove default-off and SDK opt-in behavior through every changed runtime bridge,
including parent propagation and unrelated service/Clock exclusion. Keep PGlite
and ordinary-role PostgreSQL proofs distinct. Both final reviews, applicable
strict/source guards/lint, displaced-path removal and the complete matched native
latency/CPU comparison govern completion. Sampling counts justify investigating
the owners; they are not a savings estimate or a smaller substitute goal.

## One Ordinary Entry And Generation-Owned CMS Mechanics

Status: selected connected continuation. The complete comparisons still exceed
the native-relative gates; this replacement crosses the actual preparation,
relation-readiness, CMS materialization and ordinary transaction consumers.

The current managed path observes placement, clock and Application head in a
separate preparation transaction, repeats that probe inside the command, then
reads the clock again in the host. CMS also constructs definition/participant
mechanics independently of the relation fold that already owns their inputs.
Replace that choreography rather than add another cache around it.

Borrow the existing immutable generation without a pre-command observation
transaction. Authenticate installation, placement, protected target/control
epochs, authority and current head in the actual request transaction before
native execution. That single entry supplies its authentic clock and authority
directly to admission. Reuse no live verdict between transactions. The original
generation issuer, source/profile identity, preparation accounting, semaphore,
borrow and retirement lifetime remain authoritative.

Preserve the host's actual accepting order: admitted installation, statement
budgets and request exclusion precede its clock lock and Application observation.
CMS and Atomic retain their snapshot-read clock lock; Commerce bootstrap retains
its update lock. The sole entry lends a checked head from the original issuer,
not an already accepted readiness verdict. That issuer records its incomplete
phase privately and restores activation/schema coherence only at the framework's
original admission point. Admission may consume an existing checked head or an
already accepted binding only through their original registries; a foreign,
copied, expired or closed binding cannot fall back to fresh acceptance. Business
callbacks receive only a fully accepted binding.

A compatible preparation change produces an internal entry verdict before
business callbacks. Drain that transaction and borrow, stage replacement outside
the transaction, then retry entry within a bounded refresh count and the original
request deadline. Incompatible schema/source/profile refuses. This entry-only
refresh is separate from uncertain-outcome recovery and never reruns a native
callback. Defects, interruption, mixed Causes, corruption and ordinary refusals
do not become refresh. Finite execution keeps its original snapshot/reservation
and cannot adopt ordinary refresh after callbacks.

Build CMS validators, selected table maps, located intrinsic/developer/unique and
relation mechanics, and static participant plans inside the existing preparation
generation. Extend the relation fold's original private issuer to lend those
exact owned inputs; remove independent CMS acquisitions and compilation. Keep
fresh ownership-history budgets and mutable serving/coverage eligibility in the
accepting transaction. Source-bound CMS already retains its schema and validator;
only its remaining repeated materialization-template assembly is replaced.

Candidate planning is mutable independently of the active Application head.
Retain its guard only when a sanctioned writer proves protected-epoch invalidation
or the actual entry accepts the genuine planning-head identity. Planning changes
rebuild the guard before business execution. The active-head key alone is
insufficient. Unprotected `fullProof` keeps fresh installation, schema and physical
catalog acceptance and its actual per-entry scope/placement/receipt resolution,
including recovery. Resolve that authority before its target transaction and
verify the fixed genuine target; a construction-time located authority is not a
live verdict. The protected path obtains those fresh facts from its actual
installed entry instead. The ephemeral full-proof generation assembles dependent CMS mechanics
once from that genuine basis. Selecting a different fixture profile is not this
replacement and supplies no proof for the full-proof route.

Migrate `applicationActivation`, the actual relational session entry, CMS,
Commerce and Atomic hosts, relation-readiness input lending, CMS admission and
publication, and Application participant preparation together. Remove the old
`withPreparation` observation and repeated `requireInTransaction` choreography
after all named consumers move. These are private API and composition breaks;
framework Local API access, hooks, request/dataloader identity, native Scope,
transactions, stored formats, installed grants and durable data remain governed
by their existing owners. No new host lifetime, schema migration or data reset is
selected.

The CMS mutation reference consumes this same preparation and entry API rather
than retaining a setup-only target observation transaction or eager binding
acceptance. Keep its distinct reference business and settlement algorithms;
authority, cancellation and uncertain-COMMIT witnesses still act at the actual
request boundary. A reference fixture cannot reimplement the entry owner or
classify a construction failure as the intended request outcome.
Entry selects the original clock owner's explicit `snapshotRead`,
`ordinaryWrite` or `update` access, replacing the private update boolean.
Existing framework profiles retain their original lock mode; the CMS mutation
reference selects its existing ordinary-write lock. The sole entry probe owns
that lock, rather than a consumer acquiring it again in a setup callback.
The public update-lock data borrower must issue the existing exact attempt-clock
observation from its genuinely selected row, including checked scope/epoch UUIDs
and revocation epoch. Its stronger lock does not excuse missing original evidence.
This is a correction in `scopeClock`, with no extra query or new issuer registry.
The private update-row helper used to advance authorization revocation still
closes old observations before mutation and must not issue stale evidence there.

Prove stable entry, actual full-proof and managed CMS writes, compatible and
incompatible activation/ABA, candidate movement, wrong issuer/placement,
borrower retirement, construction/entry cancellation, original deadlines and
complete Causes. Preserve write exclusion, lending closure, source permissions,
replay-before-callback behavior, original dependencies, maintenance, final guards
and unknown-COMMIT recovery. Validate actual Product/workflow and Payload consumers
on PGlite and ordinary-role PostgreSQL, remove displaced paths, run both final
reviews and measure the connected final source against all five complete native
graphs. A reduced transaction count alone cannot complete the performance goal.

## Fixed Publication Acceptance And Application Stages

Status: connected implementation alongside ordinary entry replacement;
consumer migration and displaced-path removal remain in progress. Complete
native-relative performance acceptance remains open.
The remaining publication dispatch and proof transport is a substantial evidenced
multiplier, not a proven exclusive bottleneck or a prediction of passing latency.
Material writes already share one domain primitive; replace their preceding
acceptance pipeline at that same owner rather than create another write engine.

Move the complete scalar acceptance rules into two fixed installed domain stages
around the existing JavaScript canonical candidate boundary. Combining unrelated
queries and validating their rows afterward is rejected: later work must not run
past the first failed build, dependency, original, transition or target check.

The first stage accepts intrinsic and developer build state, fresh heads and
point/range/relation dependencies, post-wait deadline, original continuity,
developer transitions, original unique owners and relation targets in their
current order, then observes the locked candidate head. Preserve exact lifecycle,
maintenance correlation, identity/fence/epoch, timestamp, null, cardinality and
ordinal rules at the domain owner. Return bounded selected facts, transitions,
database time, the candidate row and any genuinely captured protected coverage observation;
do not transport whole build/catalog objects for JavaScript to accept again.

JavaScript still decodes the exact canonical candidate and runs its existing
compiled validator, including any atomic candidate-failure evidence write. Only
after candidate acceptance does it decode the captured canonical coverage
observation. The unprotected full-proof route keeps its actual activation/schema
reads and canonical coverage restoration at this post-candidate boundary. It
cannot claim a protected snapshot or move these reads before candidate acceptance.
A generic final-guard scope alone proves no captured coverage; protected reuse
requires the existing managed metadata guard issuer and exact original clock.
Prepared failures retain their original Cause and stop at their
original successful-prefix boundary; no exception serialization or arbitrary
operation-list interpreter is introduced.

The second stage consumes that genuine transaction-bound accepted result and
checked coverage, accepts selected unique/index coverage and intrinsic
memberships, invokes the existing materialization primitives, and proves immediate
and AFTER results. Keep phase-local definition/dependency/pair/target ordinals and
family/page/local offsets in bounded refusal evidence. Known refusal mappings
retain their exact original semantics; otherwise foreign SQL errors identify
the actual `acceptPublication` or `applyPublication` boundary and retain their
original cause. A refused borrowed operation poisons its owner;
stage success is provisional and never substitutes for COMMIT acknowledgement.

Ordinary Application prior-document canonical loads and profile-specific workflow
page boundaries remain before this shared lowering owner. CMS, source-bound
Payload, Product, workflow and mixed participants migrate together. Coverage
watermarks wait for complete batch lowering. Later relation/restrict operations,
the actual fact prefix, final strong references, clock advancement, lifecycle
reproof and protected final guards remain their explicit current obligations.
This design does not promise two queries for a complete request or silently fold
those later boundaries into submitted row intents.
Deferred coverage completion retains the existing native page bound of 32.
Advance index pages before unique-key pages and submit each family's complete
original proofs on that family's final page. Combining both proof families on
one final page can exceed the native verification bound; increasing that bound
or dropping proofs is not part of this replacement. All pages and their proofs
remain inside the original transaction and roll back together.
Ordinary Application's existing build-lock prelude remains before its
session/lease/journal acceptance; the stage consumes its genuine already locked
transaction evidence. Finite publication acquires those locks after its graph
checks, in its actual current order. A caller-authored flag cannot substitute
for either profile's established protection.

Extend the existing Application domain installation with fixed typed routines
generated from authoritative Drizzle tables/columns. Use `SECURITY INVOKER`,
`VOLATILE`, restricted search paths, exact body/signature and type attestation,
and current permission/grant inventories. Add the replacement migration after
0138 under existing maintenance quiescence/drain. Preserve populated application,
history, session, journal and outcome data. No new durable table, data reset,
privilege boundary or host lifetime is selected. New installed signatures require
stale-host refusal and current installation retirement, not a compatibility path.

Remove selected sequential dispatch, repeated scalar acceptance decoders and
planners after their actual callers migrate. Keep a shared installed primitive
only for a named remaining native/domain consumer; retire unreferenced helpers,
types, grants and fixtures in the same migration/cutover. Canonical codecs,
foreign restoration and the actual settlement/recovery owners remain.
The displaced JavaScript materialization splitter has no production consumer;
migrate its remaining native behavioral tests to the accepted stages and delete
the splitter, export and trace. Retain the installed materialization primitive
because the replacement second stage actually invokes it. Measurements expose
the submitted stage calls and genuine server aggregate counts, without inventing
JavaScript page events for internal database work.

Prove competing failures and no later work across every fused phase, canonical
candidate/coverage corruption order, post-clock-wait OCC and phantom conflicts,
unique concurrency and destination precedence, membership repair, limits,
same-page RETURNING and earlier-page AFTER corruption, source/Application
maintenance, final prefix/clock proofs and lost-COMMIT recovery. Run actual
ordinary/mixed Product, workflow and Payload consumers on both databases, update
installation/grant guards, remove displaced paths, run both final reviews and
assess the complete final-source native latency/CPU/SQL outcome. A reduced domain
dispatch count cannot replace the fixed complete-request gates.

## Generated insertion and observed read separation

Status: selected correctness correction within the connected publication cutover;
runtime replacement and native-relative acceptance are not yet complete.

The logical working set currently describes an optimistically generated identity
as an ordinary missing-row observation without performing that read. If the
identity already exists, genuine dependency verification rejects that invented
observation as corrupt evidence before publication can report an insertion
conflict. Delta preparation must also propagate the shared dependency validator's
typed failure. That validator returns `Result<void, Error>`: successful validation
has no nullable conflict value. Consume its failure channel directly and preserve
the original conflict cause; never turn successful `undefined` into a conflict.
Correct these contracts at their shared owners; adapters must not retry, hide
corruption or perform another transaction.

Generated insertion intent and actual observed absence are separate obligations.
Neither an insert event with `before = null` nor the presence of a final overlay
proves which kind of dependency originally existed. A genuine earlier missing
read can precede a later insertion on the same identity, including across durable
participant merges. Preserve both obligations in that case.

Use the existing journal point row's authenticated `dependencyKind` to distinguish
a generated-only point, with an explicit `generated_insertion` kind and null
revision. Extend the owning Schema, Drizzle type, CHECK and decoder together.
Carry generated insertion intents, including identity and effect ordinal, in the
canonical admitted logical receipt/source payload. Authenticate each against its
original source admission and verified insertion event. If a genuine observed
point already exists during durable merge, retain that point unchanged and carry
the insertion intent separately in the receipt. The root working set, closed
contribution, frozen finite graph and publication command preserve both roles;
public projections or caller-authored flags cannot mint either authority.

Resolve generated identity absence through the existing bounded fresh-head batch
under the original clock. Any existing revision, including a tombstone, refuses
with the original insertion conflict. Preserve actual read verification and its
typed changed-data conflict, malformed-evidence corruption, source ordering,
first failure and full Cause. Do not add a query per generated identity. The
native journal insertion path already captures a genuine historical identity
read and keeps that contract.

The existing stored-attempt authenticator also reconstructs admitted logical
participants. It must distinguish their authenticated insertion intents from
native historical reads when correlating journal points and planning the commit.
Extend the existing framework-neutral participant-correlation owner with the
typed insertion carrier parser and reuse it in persistence receipt decoding.
Stored authentication accepts a generated point only after its exact original
admitted receipt, first insertion event and source binding authenticate that
intent. It does not count that point as an observed read. Native-only commands,
forged markers and missing or mismatched carriers retain the original corruption
refusal. Carry the authenticated insertion obligation through commit planning
and publication; a projected physical empty original is not read evidence and
cannot grant origin authority. This replaces the existing correlation contract
at its owner rather than introduce a parallel authenticator or codec.

The persisted root point counter remains the physical journal-point count. The
loader verifies and carries that count unchanged. Authentication reconciles it
against genuine read points plus authenticated generated-only points; it must
neither compare it with genuine reads alone nor add generated points twice.
Preserve a same-ID genuine read as one physical point with a separately retained
insertion intent. Prove this contract from the actual persisted loader through
the executor authenticator, rather than constructing synthetic corrected counts.
Ordinary durable settlement and finite settlement must both separate genuine OCC
checks from generated identity guards in the original bounded head batch. A
collision is an insertion conflict even when the existing revision predates the
snapshot; it must not become fabricated read corruption or an OCC read conflict.

An authenticated insert followed by deletion retains its original insertion
obligation and journal events while producing no material row intent. Correlation
must require an exact row intent for a live final overlay and refuse a material
intent for a deleted final overlay. Do not confuse retained insertion evidence
with a surviving write. Preserve the generated identity collision guard and any
earlier genuine read in both cases. Validate the complete durable no-material-row
path through publication and replay on both drivers.

Keep the expanded participant-correlation operation in one composed Effect,
including canonical value validation. Its existing outer transaction runtime
boundary remains the only bridge; do not start another runtime for each generated
point. Stable stage-validation Schemas and their compilers belong at module
construction, with contextual ordinal, epoch, fence and membership checks in the
original accepting operation.

This breaks the private logical receipt payload and extends the existing journal
point-kind contract. Existing present, missing-no-visible-revision and
missing-tombstone records and old receipt bytes remain genuine observed evidence;
absence of the new intent field means no explicitly recorded generated intent.
Do not infer origin, rewrite old points, silently delete journals, or reinterpret
invalid old evidence as a conflict. No new table, fallback engine or dual writer
is selected. Update migration 0139 under the existing installation maintenance
interlock, preserving populated history, sessions, receipts and outcomes. Extend
the point-kind constraint and regenerate the exact attested stage body and
installation inventory; current host/schema identity must refuse stale use.

The existing installation writer-protection verifier must include the
schema-derived journal point-kind CHECK in its integrity inventory. It runs at
full installation construction and authorized maintenance publication, never as
a new warm-request check. Verify both the expected expression's boolean grouping
and its validated state; an authorized maintenance writer must not publish a
generation with the CHECK missing or weakened. Reuse the original interlock,
verifier and schema owner, retain populated rows, and prove refusal and restoration
on both drivers. This closes the managed writer inventory rather than introduce
arbitrary privileged-change monitoring or another request attestation roundtrip.

Replace the invented observation at logical insertion, migrate original durable
merge/hydration and private graph consumers, then remove displaced lowering and
origin inference. Prove generated insertion success, committed and pending ID
collision, tombstones, genuine earlier same-ID absence plus insertion across
durable merge/reconstruction, receipt/event mismatch and forged origin refusal.
Retain genuine native journal historical reads and invalid evidence corruption.
Prove a genuine snapshot read changed by another commit yields its precise write
conflict before predecessor loads or either publication stage. Run these proofs,
installation/grant/codec checks and affected standalone/mixed consumers on PGlite
and ordinary-role PostgreSQL. Both final reviews, coherent cleanup and complete
matched native latency/CPU/SQL acceptance still govern the connected deliverable.

## Issued ordered-index specification consumption

Status: **implemented, reviewed and component-validated.** Exact locally issued
specifications now avoid repeated static decoding and snapshotting in their three
consumers. Equivalent dynamic validation and current-membership behavior remain
supported on both database drivers. The retained-spec component uses less elapsed
and batch CPU time; this temporal result does not quantify complete workflow
savings or close the failed native latency gates. This protocol-only result is
retained historical diagnostic evidence. Its independent component delivery
cadence is superseded by the active connected redesign policy.

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
checks/lint/source guards and cleanup remain required. This historical component
experiment does not define future delivery size. Complete five-graph native
comparisons assess the connected redesign, without repetition after every internal
edit; the prior failed gates remain unmet.

## Breaking contracts, data and completion

### Executed readiness issuance

A genuine prepared Application relation binding entering an ordinary `fullProof`
CMS write must execute its ready-result issuer before consuming the registered
proof. Constructing an Effect description does not issue that proof. The
prepared acceptance branch omitted this execution after issuance became
effectful, so an authentic standalone Payload write deterministically refused
with `ApplicationRelationReadinessFoldIssue: invalidComposition` before business
execution. The correction belongs to the relation-readiness fold, not Payload or
the measurement fixture: sequence the existing issuer and type its accepted
result at that call. Keep all preceding fresh validation, token identity,
registry checks and refusal order.

The replacement witness exercises genuine preparation, full-proof CMS write,
durable verification, same-key replay without a second callback and a subsequent
read on PGlite and ordinary-role PostgreSQL. A failed graph supplies no valid
latency result. Complete final-source performance comparisons remain required
after correction; results from distinct source checkpoints cannot be combined
into one accepted cohort.

| Current contract | Disposition and cutover |
| --- | --- |
| CMS per-request definition construction and structurally transported preparations | Replace at definition/materialization issuers; migrate real CMS, commerce and finite callers, then delete the displaced constructors and duplicate fixtures. |
| Implicit common-bundle lookup and repeated detached head/closure reconstruction | Replace with genuine explicit accepting-basis consumption. Keep transaction-bound fresh heads and each source's own permission/readiness proof. |
| Repeated captures of already owned trusted values | Replace with private issued-value handoff and retained accounting. Foreign getters, mutable native values, durable decoding and escaping projections retain their actual validation/detachment. |
| Local binding capture round trip and repeated invocation of caller-supplied guards | Replace with direct immutable canonical issuance and pure canonical shape predicates. Migrate binding callers at the existing canonical owner; foreign stored restore retains its complete proof. |
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

### Complete protected admission and quiet owned execution

Status: **connected correction implemented, with complete native-relative
acceptance still unmet; the owner has resumed the connected CPU correction below.** Protected static
catalogue replay, source-generation lifetime and original finite handoff are
replaced at their actual owners. Selected standalone Payload uses the genuine
protected profile and one trusted settlement; explicit full-proof consumers keep
fresh complete validation. Initial finite entry, frozen replacement and cold
redispatch use their actual native paired metadata guards, and constructor
cancellation drains before generation release. Remaining complete-request CPU,
SQL and latency excess is not accepted or hidden in setup. The
[measurement ledger](../../packages/medusa-adapter/benchmarks/core-performance/native-business/connected-generation-results.md)
owns exact comparisons and unresolved measurement limits. Further redesign waits
for the owner's discussion rather than starting another implementation cycle.

The coherent outcome crosses original installation/preparation, Application
activation and relation readiness, logical source admission, finite root receipts,
bounded request lifetime, index evidence and settlement. Keep the existing SDK
and original transaction owners. No new host lifecycle, public capability,
compatibility engine, durable format reset or data deletion is selected.

Prepare immutable schema, bundle, source contracts, definitions and write
mechanics once in the original bounded generation. Retain the authentic
installation verification in its actual installation/session lifetime. For
unprotected full-proof consumers, generation retention does not authorize
omitting fresh physical catalog and readiness checks: an unchanged scope head is
insufficient protection against physical changes. Original entry still probes
the authentic current head and may refresh preparation once before invoking a
callback, within its original deadline. Never retry business execution.

Protected acceptance must replace complete proof replay at its original owner,
rather than merely store immutable templates. Before removing a validator,
inventory every writer of the corresponding fact and establish its maintenance,
grant and invalidation protection. The existing metadata epoch does not already
cover every control, physical, build or coverage fact. Extend its installed proof
only for immutable definitions and physical installation facts whose actual
writers are interlocked. Preserve fresh dynamic build, unique, search and
coverage verdicts under their original locks. Ordinary application commits must
not invalidate static preparation merely because publication progress advances.

Install the additional invalidation triggers through the original migration
owner. An already installed upgrade bumps the protected epoch within its actual
maintenance admission, invalidating prior preparations atomically. A fresh
unverified installation cannot issue a preparation and has no maintenance
admission yet: install its protections before the original outer initialization,
without guarded epoch DML or temporarily making it active. Test bootstrap and
populated installed upgrade separately; do not bypass the writer interlock.

The original fresh transaction admission then issues callback-local Application
and source readiness. Bind lending to the authentic installation/pair, scope and
target incarnation, preparation generation, source/binding heads, transaction,
clock and relevant mutation barriers. Structural lookalikes and caller flags are
not issued evidence. Each retained readiness owner captures its original issued
target/control pair and epoch anchors; a newly issued same-namespace pair cannot
lend protection to an older readiness after a control-only metadata change.
Enforce this at the package-private acceptance seam as well as its normal entry.
Metadata mutations, settlement and generation disposal close
lending. Preserve final guards, request exclusion, OCC, generated insertion
occupancy, relation/restrict checks, rollback-only latches and uncertain-outcome
recovery. Keep exact lazy first-failure order and complete Cause.

Logical source catalogs and source materialization templates belong to that same
replaceable generation. CMS and Commerce must construct their source admission
inside the existing current-preparation construction callback, with its actual
authority, and consume the source payload borrowed by the original entry. An
outer host closure must not retain the previous generation's catalog after a
legitimate target or control epoch refresh. Replace and retire the source graph
with its Application generation; keep the current borrower drain and disposal
owner, the one-before-business refresh limit and exact token matching. A host
restart or accepting replacement tokens against old evidence is not the cutover.
Prove actual logical SourceCms and Commerce business calls after covered metadata
writes on the same host, followed by warm reuse and replay, on both drivers.

The selected standalone Medusa AtomicCommerce workflow is included in this
immutable source-generation replacement. Its configuration and logical
participant source admissions currently form an outer retained closure beside
current Application preparation. Replace that staging with the original
generation's configuration payload and construct selected participant catalogues
using its genuine authority and construction-only binding loan. AtomicCommerce
host, configuration and participant owners must migrate together; a fixture or
Medusa adapter must not attach later proof to an older catalogue. Preserve its
independently committed full-live canonical workflow profile, native locking,
idempotency, receipt and settlement freshness, history, cancellation and
uncertain-outcome recovery. This replacement covers immutable metadata facts
under the installed writer interlock, not a CMS tail, finite guard or cached
workflow admission. Explicit full-proof participants keep fresh catalogue
validation. Prove the actual protected AtomicCommerce business graph after
target and control epoch changes, exact pre-business refresh and callback count,
warm absence of static catalogue SQL replay, cancellation and replay on both
drivers. Its complete standalone native-relative gate remains required.

The existing current-preparation registry owns the cold construction window.
Its private construction-only loan returns the original pair solely for its
genuine binding while that window and the original generation lifetime are open;
a genuine full-proof generation has no protected pair. Close that window on every
construction outcome before installing or rejecting the generation. Source
constructors consume the loan before performing their complete cold reads, then
retain only fixed token references and copied epoch scalars. An ordinary entry
borrow, an old source catalog or a structurally similar binding cannot mint this
cold loan later. Keep the original before/after preparation observation bracket;
do not introduce another registry, transaction or authority owner.

Finite active selection must carry the original staged generation's issued
target/control protection through its existing preparation issuer. Source
catalog acceptance may consume that original evidence only after both guards
are authenticated in the actual native admission; preserve namespace, epoch,
generation and scope correlation. The source catalog owner binds its own complete
cold schema, snapshot and unique validation to that original generation evidence;
an Application selection's pair cannot protect an unverified source catalog.
The finite activation projection's metadata
watermark is not a substitute for protected physical/catalog epochs. Do not
reuse a closed transaction marker, infer protection from a profile flag, or add
another proof authority. Unprotected callers continue the complete fresh catalog
proof. The protected finite handoff must eliminate repeated static catalog
reconstruction in the complete request while retaining all dynamic source checks
and fresh native read/publication guards. Validate the actual SDK driver ledger
and complete matched business graphs rather than raise a transaction-count
expectation to accommodate a missing handoff.

Finite consumers construct Application and the complete selected source graph
inside the original current-preparation bracket, replacing manual lifetime
staging that prepares unrelated catalogs beside that generation. Lend the
prepared Application capability through the original native finite entry and
its real fresh guard correlation; do not acquire an additional ordinary entry
transaction. Migrate affected private preparation callers and fixtures together
and remove the displaced standalone selection reconstruction. Test construction
must call this owner, not reproduce its preparation, refresh or acceptance
algorithm. Preserve the matched native business graph and expose all actual
request work to the existing SDK ledger.
At the fixture's existing Effect-to-Promise construction boundary, interruption
must drain the underlying constructor before consuming its cleanup list or
releasing the current-generation borrower. Construction may still acquire a
resource or start the original entry fiber after cancellation is requested.
Use the existing settlement drain owner for that boundary, preserve the complete
interruption and cleanup Cause, and retain ordinary cancellation during the
subsequent fixture lifetime. Do not make the whole request uninterruptible.
During interruption, a constructor's transported typed or compound Cause is
still a real failure to preserve, not an expected rejection merely because it
is a Cause object. The existing drain owner must combine such transported Cause
with the original interruptors; ordinary foreign throws remain defects. Only an
actually expected original interruption rejection may be omitted from the drain
result. Keep this classification at the existing bridge owner.

The finite readiness issuer derives its private preparation from the original
current binding's fully validated cold readiness. Authenticate the original
repository and issued result, complete cold profile, schema/control-read
provenance, original lifetime and exact retained protection references and
epochs. The existing readiness issuer may issue a finite derivative sharing
those immutable facts and the existing detached public result projection;
this is not a new proof authority. Partial finite-entry capture must not accept
complete generation protection by weakening its profile check. Do not repeat
the original static SQL capture or attach a fresh pair to an older result.
The original construction loan is required at Activation's derivation seam;
native entry still performs fresh dynamic, head, epoch and final-guard checks.
Closed, foreign and incomplete preparations refuse, and frozen contributions
retain their original semantic dependencies across later generation refreshes.
The lexical current-entry loan governs the initial pre-business generation
refresh, not a later replacement callback. The existing native replacement
certificate owner continues its full fresh acceptance of the authentic
complete-derived capability, including original pair, lifetime, head, dynamic
and final-guard checks. A stale replacement refuses; it does not trigger a
post-business cold refresh or rerun business through Current. Missing, closed or
invalid supplied loans must not fall back to that path. Keep the actual
replacement-certificate caller and explicit non-Current profiles identifiable;
generic optional fallback is not the replacement contract.
Cold exact-attempt redispatch also has a real durable recovered finite consumer:
its persisted recovery evidence carries no in-memory frozen entry certificate.
Keep that explicit recovery profile and its original fresh acceptance, request
identity and settlement checks. A supplied frozen certificate selects the
certificate-owned profile and must authenticate; rejection must not select cold
recovery instead. Both replacement profiles register the actual paired metadata
generations returned by the original native installation admission in their
existing final-guard scope. Reuse that admission observation rather than adding
a second query or accepting retained source catalogs without transaction guards.
The existing replacement port exposes these contracts directly: `replaceFinite`
requires the frozen commit command, while `replaceRecoveredFinite` accepts the
explicit recovered resolution command without a frozen certificate. Native
retry and cold exact redispatch migrate to their respective methods. Both use
the same authoritative replacement transaction; delete the ambiguous optional
certificate selection rather than retaining a fallback or a second engine.

Moving full-proof catalog validation into acceptance preserves native unique
closure and index/catalog typed failures through the original outward error
union. Do not classify stored corruption as a recoverable authority change.
The erased published-schema reader continues to use the readiness owner's
schemaBinding projection with its original cause; defects, interruption and
combined failures retain their complete Cause structure. Preparation refresh is
selected only by the original authentic head/key mismatch verdict, not by a
general catch-and-retry of catalog or business failures.

Migrate standalone Payload to the existing genuine protected deployment profile:
separate runtime login, restricted grants, maintenance owner and composite
installation. Its schema-owning fixture cannot simply be labelled managed.
Medusa already has a protected profile and must consume enhanced original
readiness directly. Update actual consumer construction and fixtures together;
keep explicit unprotected/full-proof correctness witnesses and the PGlite lane.
This is an original-owner contract replacement, not an adapter authorization
bypass or a copied finite engine.

For finite execution, the authentic closed root already avoids ordinary durable
seal/load/authentication. Replace its remaining request/receipt/result recapture
and freeze projections with the original issuer's owned handoff. Preserve exact
normalized replay equality, source/method admission, syscall order, event
ordinals, physical versus observed counts, counters and original byte limits.
Retain one required original canonical measurement where limits require it;
reference identity or approximate sizes cannot replace semantic equality or
budget accounting. Foreign durable bytes still undergo their complete decoder
and digest authentication. Capture foreign mutable input and detach escaping
public values at their actual boundary, rather than between trusted owners.

The original successful-result canonical constructor may retain a module-private
issuance lookup for its exact deeply immutable JSON and owned byte evidence.
Finite closure can consume that constructor-issued state after its original root
and outcome checks, avoiding verification of bytes just issued locally. This is
not a caller-authored marker, reference-based replay comparison or new wire field.
Structural lookalikes, restored foreign data and escaping byte copies retain full
canonical validation and digest checks. Mutation and forged-lookalike witnesses
must prove that the private handoff cannot alter canonical bytes, counters,
successful-outcome meaning or the ordinary recovery contract.

Compose selected repeated lifecycle, read, proof and settlement operations with
Effect.fnUntraced and the existing optional observeExecution policy. Preserve SDK
names at real owner boundaries without default quiet call-stack construction.
Retain every actual context/deadline check, including both checks around pending
ID suspension, cancellation, overlap protection, charging and drain ownership.
Do not blanket-remove unrelated Effect tracing or introduce another diagnostics
Layer, interpreter or runtime bridge. Reuse already verified transaction-bound
index key/spec evidence through its original issuer; foreign membership bytes
retain their actual hash checks. Duplicate publication checks may disappear only
when their original ordered acceptance and locked observations move intact to
the existing stage owner.

Private preparation, accepting readiness and finite projection interfaces may
break where this replacement requires it. Migrate their named consumers and
remove displaced replay, construction and transformation paths in this same
connected cutover. Stored journal formats, named durable histories and recovery
obligations remain unchanged. Required validation includes PGlite and ordinary
Postgres, writer/maintenance/invalidation races, exact issuer and transaction
refusal, physical tampering, fresh progress changes, lazy failure order,
generated-ID/read precedence, replay and limits, native hooks/workflows,
cancellation and cleanup, strict checks, guards, lint and both final reviews.
Complete final-source matched native latency, CPU and database measurements
across all five graphs govern delivery. Retain failed measurements and resolve
their responsible owners; do not weaken deadlines or acceptance targets.
## Saved Behavior Reconciliation

Status: **implemented behavioral reconciliation at the owner's request to bring
useful earlier uncommitted behavior into the current core.** This is a behavior
reconciliation, not resumption or completion of the paused native-relative
performance program. The retained source checkpoint and path/byte inventory
belong to the local reconciliation evidence; current runtime contracts remain
the baseline and earlier files are not applied wholesale.

### Outcome and boundaries

Preserve the current generation, readiness, fixed accepting/publication stages,
authentic value issuers and SDK diagnostic composition. Bring forward missing
installation, callback, measurement and acquisition guarantees at those owners.
The change runs in the original checkout and branch; no additional worktree is
needed. Postgres remains authoritative and only the existing outer owner
settles. No database transaction, preparation lifetime, fallback implementation,
public API, persistent format or framework capability is added.

| Earlier behavior | Baseline comparison | Reconciliation |
| --- | --- | --- |
| Metadata invalidation and source/readiness generation ownership | Replaced and extended. The current protected inventory includes all earlier covered relations and three additional readiness relations. | Retain the current inventory, migration and authentic generation consumers. |
| Reject inherited protected metadata in either direction | Missing. Ordinary nonpartitioned table checks and trigger checks do not establish absence of inheritance routes. | Implemented at protected attestation and installation reopen with one Drizzle-derived inventory and bidirectional topology refusal. An unsafe installation remains drained and its data is preserved. |
| Cold framework installation admission | The existing transaction bridge authenticates the actual current installation, but can issue a token for a graph naming a different, uninstalled namespace. | Implemented declared graph/actual installation agreement before graph reads through the existing transaction owner, retaining the full-proof profile and token disposal. |
| Root counters, complete Cause reporting, optional SDK observation, Promise drain and native request closure | Already present, sometimes through stronger current ownership. | Retain current Layers, diagnostics, physical callback parent propagation and request/lifetime owners. |
| Explicit caller tracing policy, annotations and links across independent runtimes | Partly missing. Diagnostic projection omitted annotation/link references; default policy must distinguish actual caller entries from Reference defaults. | Implemented at the existing execution-diagnostics owner and entry boundaries. Repeated production operations remain untraced and observation optional. |
| Only requested Drizzle view construction and failure before BEGIN | Missing acquisition/construction behavior. | Implemented lazy memoized checkout views and selected-view construction inside acquisition cleanup, retaining full-schema builders and existing transaction semantics. |
| Root lifetime/budget refusal before inspecting foreign workflow inputs | Missing. Workflow normalization could inspect input before entering the root capture operation. | Implemented normalization inside the existing ordinary or borrowed root capture gate, preserving sticky refusal, charging and exact Cause. |
| Native callback mutation isolation, own undefined fields, skip semantics and full compensation capture | Already equivalent through detached per-edge capture. | Retain current behavior and meaningful native witnesses; do not require the earlier immutable cache choreography. |
| Canonical result issuance, private JSON detachment/accounting and source preparation | Replaced or extended by authentic current issuers and explicit escaping/trusted-use boundaries. | Retain current owners; earlier identity-cache tests do not prescribe public escaping behavior. |
| Protected framework writer policy and replay bypass | Separate connected policy/optimization, not established by the current full-proof path. | Retain as pending. A successor migration, restricted grants, fenced maintenance writers, complete reopen proof and genuine protected-admission witnesses must precede any skipped replay or unlocked head read. |
| Joined physical materialization and publication-row tail | Alternative exchange optimization; current atomic rows/facts/outcomes and uncertain-outcome recovery are already preserved. | Retain as pending performance work. A current-stage successor, complete integrity inventory, predecessor migration and connected failure/performance witnesses are required. |
| Retained immutable workflow/JSON caches | Alternative internal reuse; no missing native result guarantee established. | Keep pending for an evidence-selected performance cutover rather than import the earlier pipeline. |

### Challenged alternatives and private contracts

Applying the earlier file set would overwrite current original-generation
correlation, three readiness protections, framework token disposal, physical
callback parent propagation and generated-insertion/publication contracts.
Renumbering the earlier migrations alone would duplicate guards and would not
reconcile their different settlement and runtime policy semantics. Neither is
a valid behavioral merge.

Use one current protected-relation inventory for inheritance verification. An
ancestor or descendant involving a covered relation is unsupported topology;
detect it at authentic attestation and every verified initialization/reopen.
Out-of-protocol privileged topology changes while serving retain their existing
stopped-service/reinstallation disposition. No per-request schema rescan or
new migration is required by this refusal.

The private capture operation accepts a normalization callback so the actual
ordinary/borrowed root can enter its existing operation gate before touching
foreign values. Migrate workflow callers and context fixtures together; keep
the callback internal and never expose raw settlement or a second lifetime.
Capture limits, first failure, interruption, omitted-value representation and
native mutation isolation remain unchanged. Cold framework preparation must
not be described as unauthenticated: its existing transaction bridge already
admits the actual current namespace. Any explicit graph-namespace correction
must reuse the existing settlement bridge with lexical admission cleanup,
rather than add a second transaction. A genuinely issued and stored graph naming
an uninstalled namespace is refused before canonical graph reads; a matching
active namespace continues through the original full-proof preparation.

Tracing projection carries only its actual optional diagnostic entries and
parent, including annotations and links. A foreign runtime bridge does not
inherit Scope, Clock or business authority merely to retain tracing. Resolve
root defaults at invocation, preserve explicit caller enable/disable/timing
choices and request isolation, and keep the current full-Cause observation
policy. Saved named-operation counts tied to displaced readiness choreography
are not compatibility requirements.

Lazy database/transaction views retain checkout identity and full schema. Read
selects the database view; initial/recovery selects the transaction view.
Construction failure is an acquisition failure: release/destroy that checkout
without BEGIN, callback or competing finalization. This is not a new transaction
profile or connection lifecycle.

### Validation, cleanup and completion

Adapt earlier behavioral witnesses to the current owners, including genuine
inherited writes with unchanged epoch and refused reopen, refused cold admission
before framework reads, tracing annotations/links/explicit false policy through
native bridges, concurrent roots, real root refusal before proxy reflection,
callback mutation/compensation semantics, selected-view memoization and
constructor-failure cleanup. Preserve existing generated-insertion, readiness
upgrade, publication, full-Cause and retained-generation proofs.

Run focused PGlite and ordinary-role PostgreSQL owner/consumer proofs for the
storage, installation and checkout claims, affected strict typechecks, standard
lint, Effect/source guards and both final project reviews. Correctness validation
does not establish a latency saving. Do not start a full diagnostic/benchmark
campaign or weaken native-relative targets for this reconciliation.

Migrate private callers and fixtures, remove displaced local assembly where the
replacement makes it unused, and keep a single current runtime implementation.
The complete earlier source checkpoint remains recoverable; it is evidence,
not a second runtime. Pending framework policy, row-tail and
immutable-cache work must remain named and cannot be reported as merged.

## Connected CPU execution correction

Status: **the selected capture, quiet composition, metadata routing and
publication transport replacements are implemented across standalone and mixed
mutations; complete native-relative acceptance remains unmet.** This resumes the existing
performance program after saved-behavior reconciliation. The separate
standalone-read tuning pause remains in place.

### Outcome, evidence and owners

Reduce complete-request CPU and latency in both existing Medusa workflow graphs
and preserve Application and Payload consumers of the shared owners. The retained
connected comparison reports 171 ms paired added thread CPU for mixed workflow
and 187 ms for standalone workflow. Fresh root-only profiles reproduce substantial
execution CPU and show recurring Effect invocation/Result machinery, descriptor
capture and Drizzle rendering/mapping. Sample shares identify investigation
targets; they neither allocate the complete excess to an owner nor prove that
all additional work is avoidable. The native reference omits Flarex authority,
atomic settlement, revision history and recovery work.

The existing generation already owns immutable schema/catalog preparation and
physical sessions already retain their extracted Drizzle schema and lazy views.
Replace repeated mechanics inside those owners rather than add another engine,
preparation registry or accepting cache. Persistence owns pure capture,
readiness/composition and installed SQL execution; Medusa owns omission and native
callback semantics. Native framework business logic retains its owner.

### Selected replacement and challenged alternatives

- Combine descriptor-safe Medusa normalization with the existing private JSON
  capture/accounting traversal where its contract permits one pass. Preserve
  exact issued provenance, immutable captured data, omitted own undefined
  properties, dense arrays, numerical policy, cycle/depth/byte/node limits and
  first failure. A mutable native callback still receives its detached input;
  structural similarity or caller object identity grants no reuse.
  Medusa's existing normalization reports a later descriptor/node refusal before
  a strict JSON byte or nonfinite-number refusal. Accumulate strict refusal during
  the native descriptor traversal and expose it only after normalization succeeds;
  ordinary strict capture retains its immediate first-byte-failure behavior. Only
  complete successful trees enter the existing private issuer registry.
- Extend the existing quiet execution diagnostic policy to hot readiness
  operations and replace pure per-member Effect composition with ordered Result
  calculations. Prepare invariant lookup/SQL structure with the existing bounded
  mechanics or installed materialization owner. Actual SQL, fresh acceptance,
  cancellation, retry, failure and cleanup remain Effect operations. Blanket
  removal of Effect or caller tracing is not selected.
  Quiet operations resolve the existing diagnostic policy per invocation; an
  explicitly enabled caller tracer retains named spans, annotations, links,
  parentage and complete failure observation. Pure metadata consumption stays
  ordered and checks its original root/projection on every consumption.
  Existing SDK-only operations remain opt-in; migrated named operations select
  caller tracing explicitly in the same diagnostic owner.
  Readiness may observe committed progress after admission under READ COMMITTED.
  Unique/search consumers must receive the coverage issuer's observation clock,
  while original snapshot coverage, dependencies and OCC retain the admission
  clock. Rejecting a future issuer observation against the older clock is a
  composition defect, not permission to relax the issuer guard or cache readiness.
- Replace demonstrated per-cell SQL AST assembly for installed publication
  tuple transport with a retained owner-local positional encoder. Bind fresh
  values and execute through the actual transaction session and its observation,
  decoder and error boundary. Preserve SQL casts, escaping, codecs and statement
  ordering. No cache of query results or readiness verdicts is introduced. A
  broad override of Drizzle row mapping without exact contract evidence is not
  selected.

These changes are one continuing connected execution correction, not separate
helper deliverables. Lower counts alone cannot close it. Further owner changes
must follow complete-request attribution and retain the accepted transaction
profiles; no competing lifetime or settlement capability is added.

### Contracts, cutover and removal

Replace private capture/composition/query-building contracts where required and
migrate their actual standalone and mixed callers and fixtures together. Delete
displaced traversals and SQL assembly in the same cutover. Keep existing foreign
detachment, installed server functions, canonical bytes and durable journal,
seal/result/history formats. No durable data migration or deletion is selected.
Any newly required durable disposition or host lifecycle needs its explicit gate.

Preserve complete fresh authentication/revocation, actual query readiness,
original snapshots/OCC, exact dependency accounting, native events/results,
mutation isolation, sticky first refusal, callback drain, generation release,
rollback-only state, replay/recovery and one authoritative atomic publication.
Compilation must not change when a failure becomes observable or execute later
foreign work after an earlier refusal.

### Validation and complete acceptance

Run affected owner/consumer witnesses on PGlite and ordinary-role PostgreSQL,
including invalid inputs, adversarial getters/proxies, own omissions, aliasing,
budget precedence, concurrent roots, cancellation and publication corruption or
conflict. Verify query SQL/parameter equivalence and codec edge cases at the
installed SQL owner. Run relevant strict typechecks, lint/source guards and both
project reviews against the stable complete diff, then remove obsolete code and
create one coherent commit only after successful verification.

Retain complete matched native graphs for Product, Payload create, standalone
Medusa, mixed Payload and mixed workflow. Use five warmups and at least 30
alternating pairs for quiet final acceptance, and separate complete root-counter
and database cohorts. Declare paired added median thread CPU allowance at one
Windows counter quantum (16 ms); report an unresolved sub-quantum result rather
than zero. Require lower complete added CPU without a connected-profile
regression, with calibration/resolution visible. The fixed paired latency gates
remain at most 5 ms added median and 10 ms added P95. Failed acceptance requires
correction of its actual owner and cannot be replaced by sample shares, isolated
helper speed, fewer SQL statements or a relaxed target.

### Remaining connected correction

The implemented mechanics do not finish this outcome. The
[CPU correction ledger](../../packages/medusa-adapter/benchmarks/core-performance/native-business/cpu-execution-results.md)
owns the complete measurements and their limits; both workflow graphs and the
other connected consumers still miss the fixed targets.

The connected candidate implements the selected outcome-value, pure acceptance
and native query-preparation replacements below. Complete final-source matched
measurements for all five selected graphs confirm that each still misses the fixed
CPU and latency gates. Repeated logical working-set/readiness reads and publication
remain concrete execution paths to investigate; current overlapping span evidence
does not establish exclusive owner CPU attribution. Correct the responsible core
owner before complete acceptance; fewer exchanges or helper savings cannot replace
the selected outcome.

The displaced JSON pipeline detached captured data, then validated and rebuilt it
again; command, borrowed workflow and canonicalization boundaries repeated that
work. Canonical number/Unicode evidence now belongs to safe capture, and trusted
consumers retain genuine immutable values. Independent ordered byte charges,
first refusal, escaping/native mutable copies and full foreign stored-outcome
verification remain. Canonical result bytes, hashes and persisted identities
are unchanged obligations.

Migrated readiness readers retain fixed native SQL/projection mechanics, bind
fresh parameters and execute through the current session. Ordered pure state and
coverage correlation belongs to the existing accepting operation; actual reads,
locks, hashes, frontier acquisition and lifecycle cleanup remain Effect work.
Existing scope observations, static preparation and finite capture maps retain
their sole ownership. These replacements introduce no duplicate cache or
acceptance reuse, and their source rationale is not an exclusive measured CPU
allocation or permission to relax complete acceptance.

### Selected outcome-value and readiness cutover

The owner authorizes continuation of this connected correction. The value owner
will normalize canonical numbers during descriptor-safe capture, issue its
existing immutable value facts, and retain exact issued values through trusted
command, borrowed workflow and result-accounting handoffs. Foreign objects still
undergo descriptor capture; a caller-created frozen object is not issued evidence.
The escaping capture operation continues to detach objects. Native workflow
callbacks continue to receive their existing mutable copies. Every handoff checks
its actual remaining byte/depth limit and retains the independently ordered charge;
issuance carries no authentication, admission, request or storage authority.

The protocol byte measurer intentionally accepts lone UTF-16 surrogates as JSON
escapes; outcome validity is stricter. Capture therefore records Unicode validity
alongside its existing issuer facts. Outcome policy refuses the first malformed
string/key only after the complete structural/byte capture succeeds, matching the
displaced normalizer's failure order. Its existing Schema decoder remains at that
failure boundary to preserve the cause; successful members need no separate decode
or reconstruction. Generic capture without outcome policy retains its contract.

Replace the duplicate outcome normalization traversal and migrate commerce's
trusted accounting entry point to the retaining operation. Canonical encoding may
consume issued canonical values without another detachment/normalization traversal;
foreign result and stored-outcome inputs still require complete capture. Preserve
negative-zero normalization, Unicode validation, descriptor/getter refusal,
alias isolation and first-failure order. The canonical text/bytes, domain-separated
identity preimages, result hashes and durable outcome formats do not change. No
persisted-data reset, migration or deletion is selected. Remove the displaced
normalizer and its sole-use decoder in the same cutover, retaining regression
coverage for foreign mutation, forged evidence, budget refusal and stored corruption.

Retain fixed ordinary scope-clock and readiness projections/joins at their existing
owner instead of rebuilding their invariant Drizzle structure per invocation.
Bind fresh parameters and execute through the exact current session. Fresh required
build reads/locks, clock observations, coverage eligibility and refresh after a miss
remain mandatory; query result or acceptance caching is excluded. Existing held-lock
observations and generation preparation remain their sole owners. This is ordinary
query mechanics within the approved correction, not a new lifecycle or readiness
authority.

The connected proof remains all five complete matched native business graphs,
affected standalone/mixed behavior and both storage drivers. Compare against the
committed CPU-correction baseline with separate quiet, root-counter and database
cohorts. Required strict checks, source guards, both final reviews and removal precede
the scoped commit. Component savings do not establish the fixed complete latency
or CPU gates, and any remaining excess stays an explicit unresolved delivery gate.

### Continuing native query preparation and accepting execution

The value cutover preserves correctness but does not resolve complete workflow
CPU. Fresh complete counter/profile evidence keeps this correction open. Remaining
samples include native Drizzle preparation/row mapping and repeated Effect
invocation around unique readiness, finite capture and publication slot acceptance.
These locations identify concrete mechanics to replace, not exclusive cost shares
or permission to remove fresh checks. Continue within their existing core owners.

Unique build-state decoding and successful coverage correlation are ordered pure
verdicts. Replace their per-field/per-row Effect construction with the authoritative
Result decoder and consume it at the existing accepting operation. Migrate finite
storage capture and other actual consumers to that decoder; delete displaced Effect
decoder exports. Keep lazy coverage/frontier acquisition, SQL, locks, genuine issuer
checks, mutation and asynchronous hashes in Effect. The same rule applies to pure
slot/envelope/ordinal correlation in the unique and ordered-index publication owners:
refuse earlier corruption before decoding or consuming a later row/body, and retain
the active publication clock, pending-fact provenance and final cleanup.

Private decoder return channels and per-member diagnostic names may break in this
cutover: pure validation moves under its named accepting operation rather than
requiring a runtime/span per datum. Actual operation observations retain explicit
caller tracing, annotations, links, parentage and the full outcome. No public
diagnostic contract or durable format is selected for change. Hoist demonstrably
repeated operation construction with explicit retained owner state, never a captured
acceptance verdict or another service/lifetime owner.

Complete native query preparation is also selected for source-grounded correction
where the installed Drizzle API can retain code-defined SQL and ordered projection
mechanics while binding the exact current session and fresh values. Retention must
benefit ordinary transactions and independent finite captures, preserve native
codecs and lazy execution, and retain every lock/check/refresh and refusal order.
Do not introduce a new query engine, accepting cache, database schema or connection
lifetime. Establish the exact preparation/binding contract and caller/removal
inventory before its runtime cutover. A per-checkout cache that merely repeats the
same compilation on the next checkout is insufficient evidence of this outcome.

The concrete bridge belongs to the existing physical-session Drizzle owner. A
compilation-only native session receives Drizzle's public `prepare` output once:
rendered query, ordered native fields and join-nullability metadata. It performs
no transport and retains no client. Each lazy execution binds that descriptor to
the actual current native session, with fresh placeholder values, and uses that
session's native prepared-query transport and codecs. Prepared statement names
are absent at execution, so this creates no server statement identity or lifetime.
The bridge must derive result types from the native select rather than accept an
independent row type, and detached observers must see current bound SQL parameters.

Migrate fixed authority/clock lock variants, required enabled-index builds and
fenced build reads. Variable definition lists replace private `IN` query shapes
with native `ANY(integer[])` placeholders; preserve empty-input short circuits,
existing duplicate/count bounds, ordering, limits and lock targets. This changes
private SQL text and observer parameter representation, not selected rows or
authority. Prove one/many definitions, missing/stale/disabled refusal order,
nullable joins and native timestamp/bigint decoding in both drivers. Migrate
unique selected-build queries after their accepting owner is stable. General
projection helpers remain only for actual unmigrated consumers, without a fallback
for migrated calls. Remove displaced fresh builder chains in this cutover. Native
row mapping still runs for each fresh response; query preparation retention does
not claim to remove it.

These are connected internal steps before complete final acceptance, not additional
performance deliverables. Retain the original witnesses and fixed gates, rerun both
reviews after substantive changes, and collect complete quiet/counter/database
evidence only after the connected source cutover is stable.

### Current workflow execution and row-evidence replacement

Status: the connected workflow execution, row-evidence and native query cutover
is implemented under the owner's explicit standalone/mixed core-correction
approval. Its affected owner and consumer correctness proofs pass. All five
complete final-source candidate graphs still miss the fixed CPU and latency
targets. Fresh whole-graph profiles identify surviving value capture,
normalization and Effect construction; actual standalone and finite read demands
remain substantial. Sample counts are investigation evidence, not exclusive
milliseconds or a prediction of success. Garbage collection is not established
as the dominant cost. The continuing correction must trace the genuine evidence
and its actual consumers before replacing another boundary.

The current mixed workflow's 26 index-row captures serve distinct snapshot range
or unique demands. Equal statement fingerprints do not imply equal arguments or
permission to cache acceptance across transactions. Standalone repeated readiness
clocks include post-build-wait observations and cannot reuse the older admission
clock. Preserve those actual guarantees while replacing the mechanics below.

#### Connected contract and challenged alternatives

- The prepared workflow owner compiles immutable member/reference-resolution
  mechanics once. Each execution keeps fresh input, step outputs and transform
  caches. Resolve constants, captured property selection and container assembly
  as ordered pure work until a real transform, callback, capture or checkpoint
  requires Effect. Retain definition ownership, the depth limit, left-to-right
  first failure, selected-branch laziness, once-per-frame transforms, child-frame
  isolation and final checkpoint. Preparation must not make a skipped branch's
  deferred error observable. Replace per-scalar named generators, without removing
  actual callback Promise/runtime or cancellation/drain boundaries. This changes
  private prepared execution mechanics and diagnostic span granularity, not the
  admitted Medusa graph, callback mutability or native result/event contract.
- The existing logical working-set and relational mechanics owners retain exact
  immutable normalized-row validation evidence tied to the actual table mechanics
  and canonical value provenance. Same-owner consumers may reuse that evidence;
  foreign, forged, changed or derived rows retain complete validation. Preserve
  batch-wide supplied-input validation before any mutation, normalized complete
  row validation before uniqueness, numeric/default/managed-field semantics,
  ordered independent byte charges, canonical bytes/digests and distinct input
  versus stored-corruption failures. A Boolean or structural match grants no
  reuse, and no validation evidence grants storage authority.
- The activity issuer/projection owns source selection before row detachment and
  retains immutable detached row projections by exact canonical value identity.
  Call cursors retain all required mutation/lifecycle/reference evidence and
  original relative ordinals. Validate source/table agreement and corruption in
  its established order, including shared activity obligations; omit unselected
  observed rows before cloning rather than cloning another source's rows only to
  discard them. Replace accumulated-row projection churn without shrinking native
  policy evidence, sharing mutable bytes or inventing adapter receipts.
- The scope-clock issuer may lend its protected native read identity only within
  the exact accepting transaction and its existing active scope/authority locks.
  Index readers consume that identity after their normal admission/lifetime checks
  instead of repeating the same scope-UUID lookup. It is neither a writer clock
  nor cached live readiness; post-lock/post-build clocks remain fresh. The actual
  native transaction owner may retain its transaction-stable timestamp for its
  original lifetime, while separate finite frontiers retain their own fresh time.
  Bind every observation to the original issuer and current transaction, and
  refuse forged, foreign, mismatched or ended borrowers. Native query-required
  admission selects the transaction timestamp with its existing accepting read;
  decode it only at the first managed-time demand. The ordinary full working-set
  profile remains a named consumer of its existing native transaction-time read.
  A missing or expired query-required observation refuses without falling back.
  The existing native writer-clock entry also owns its transaction-stable time
  for full Commerce working sets: project it with that same accepting statement,
  retain genuine ever-issued provenance after close solely to refuse ended
  borrowers, and decode only at managed-time demand. Truly unissued ordinary
  full working sets keep their original query. This lends a value, not the old
  writer clock or a readiness verdict; finite time remains fresh per frontier.
- Extend fixed native query preparation at the existing physical-session owner
  to the demonstrated index/unique reads. Compile only code-defined SQL shapes
  and projections; bind fresh current arguments through native prepared transport,
  codecs, observation and failure handling. Existing bounds, ordering, nullable
  joins, locking, lazy frontier/body consumption and readiness barriers remain.
  Dynamic predicates select explicit owner-local shapes, not a result cache,
  accepting cache, raw-driver fallback or a second execution engine. Native raw
  SQL descriptions use this same compilation owner and preserve synchronous
  native preparation defects, lazy transport and the driver's original envelope;
  native selected reads preserve their actual selection codecs and mapper.

An array/IN batching change alone cannot close the measured gap: most mixed range
calls are separate native query boundaries, and current exact-key caches already
serve genuinely repeated demands. Any later compiler-owned sibling-demand
replacement must inventory real call groups and preserve first-refusal, snapshot,
OCC and source-wide mutation closure at the accepting frontier. Holding a physical
transaction across native callbacks or weakening a fresh frontier is rejected.
New host/connection lifecycles, public capabilities, general evolution, installed
routine changes and durable format/data disposition are not selected here.

#### Owners, private breaks, cleanup and completion

The promoted workflow SDK owns prepared graph resolution; persistence owns row
mechanics, working-set evidence, source activity projection, protected read
identity and native storage query preparation. Framework business/default/coercion
and policy ownership remains with the actual adapter. Migrate the standalone and
borrowed mixed execution consumers together. Remove displaced recursive Effect
resolution, redundant same-row validators, repeat scope identity reads and full
activity-detachment choreography once their callers move. Retain foreign capture,
escaping mutable copies, post-wait readiness observations, authoritative stored
decoders, snapshot dependencies and all settlement/recovery tails for their actual
contracts; no compatibility wrapper or fallback is required. Canonical result,
history, journal, seal and workflow identity formats remain unchanged.

Prove skipped invalid branches and depth/order, transform caching and frame
isolation, mutable native copies and omissions, batch failure before mutation,
foreign/changed mechanics and canonical-byte refusal, source-local activity with
shared mutation evidence, ended/foreign transaction identity, lock/revocation and
post-build refresh, native SQL/parameter/codec equivalence, cancellation/drain,
rollback/OCC and one atomic publication. Run owner and actual standalone/mixed
consumer proofs on PGlite and ordinary-role PostgreSQL, affected strict checks,
lint/source guards and both final project reviews. Collect complete matched
quiet/counter/database cohorts only after the connected cutover is stable. Failed
fixed gates require further responsible-owner correction, not a smaller substitute
deliverable or an incomplete commit without an explicit checkpoint request.

### Native root admission and source-union publication

Status: selected as the connected correction for the demonstrated standalone
orchestration multiplier, including the shared publication consumers in mixed
execution. The measured graph performs three full logical-manifest inspections
and three independently prepared source publication plans within one already
atomic root. Each inspection loads all 121 index builds, 37 unique builds, 18
table frontiers and 10 search states. Prepared Application acceptance currently
does not lend logical readiness; wrapping existing checked-binding reuse alone
is insufficient and does not establish safe readiness lifetime.

The trusted root accepts the full declared logical source union once, then the
existing source issuer proves each source's correlation, table ownership,
permissions and initialization receipt. Keep the ordinary full-manifest refusal
contract, including unrelated definitions. Bind lending to the exact physical
transaction, accepting Application and heads, installation/protection and
preparation identities, schema/manifest, authority, original clock fingerprint,
unique owner and open admission phase. Foreign transactions, finite-only evidence,
changed selections and ended or closed issuers refuse. Close lending before
lowering and sanctioned lifecycle/readiness changes; no result survives a new
transaction or permits acceptance by structural equality.

This requires an explicit writer inventory in the existing readiness and
installation owners. Authority and binding SHARE locks protect their identities;
installation maintenance interlocks protect structural facts. Index/unique KEY
SHARE locks protect lifecycle but do not freeze coverage. Search state presently
has no row lock. Reuse only facts whose actual sanctioned writers preserve a
positive verdict monotonically or join the existing exclusion mechanism. Retain
each actual fresh post-lock clock, generation/epoch/fence and nondecreasing check;
do not lend the admission snapshot as a current readiness clock. If the writer
inventory cannot establish the contract, consolidate fresh ordered observation at
the correct readiness owner instead of caching the unsafe positive result.

At settlement, compile one bounded source-correlated publication plan from all
closed logical contributions. Keep framework validation/event policies and
source-first refusal order, exact source ordinal/schema maps, original point,
range, page and absent-unique observations, unique transfers, coalesced-write
dependencies, limits and final facts. Validate the original observations before
derived writes and consume one root publication prefix and outcome. The existing
source-bound materialization program accepts array row/build/unique inputs; use
that owner once where the complete schema/clock and source union are compatible.
Migrate its standalone and mixed consumers together rather than adding an adapter
combination or second settlement path. This is existing outer atomicity, not a
universal framework transaction profile.

The root union's original points are accepted before derived set-null or
replacement writes. A single native union lowering may precede those private
derived writes, whose transient state remains inside the same transaction and
whose final references remain checked by the prefix owner. Preserve the existing
durable fact/source order independently with bounded row-identity projection:
source-local set-null facts precede that source's native facts where they did
before, and replacement facts retain their existing order. This is a private
execution-order break, not permission to change revision/predecessor semantics,
feed ordinals, event identities, replay or result formats. Keep the actual source,
page, total buffer and publication budgets and their ordered refusal behavior.

Several bounded packets may be accepted before any lowering. Developer-index
membership evidence therefore belongs to its exact index/document position and
transaction clock, rather than a transaction-wide preparation generation.
Preparing an overlapping position consumes that position's evidence; preparing
a disjoint position must preserve earlier genuine evidence. Retain broader
generation fencing for range captures and SQL acceptance snapshots, exact issuer
authenticity, expired-clock refusal and one-use packet completion. This corrects
the shared index proof owner instead of serializing writes before all original
dependencies have been accepted.

Initially retain the full selected build union and all maintenance obligations.
Touched-table pruning needs a separate exact frontier/coverage proof and is not
an alternative deliverable. The mixed point profile already has its own accepted
source-union/touched-table frontier contract; retain that behavior and migrate
only consumers of the changed shared materialization contract. Preserve the fresh settlement writer clock and
publication `clock_timestamp()`, final reference checks, installation generation
guards, rollback, cancellation and uncertain-outcome recovery. No new installed
routine signature, durable table, journal/outcome identity or data deletion is
selected; any required change to those contracts must be explained in this
preflight before runtime edits.

The owning admission/readiness/accepted-binding and shared publication/
materialization modules own the replacement. Remove displaced per-source full
inspection and independent materialization preparation after every actual
consumer migrates; retain source-specific admission, policy and receipt rules.
Add both-driver witnesses for three-source correlation/initialization refusals,
foreign/changed/closed lending, post-wait concurrent clocks, maintenance/revocation
exclusion, late-source conflict before publication, unique transfers, tombstone
and absent-read dependencies, source limits and fact/event ordinals. Prove actual
Product/Pricing/Link standalone and mixed workflows with one publication/outcome,
then strict checks, lint, source guards, both final reviews and all five matched
native CPU/quiet/database graphs under the unchanged complete-request gates.

### Consumer-discovered freshness and exact scope corrections

The retained historical Product proof exposed a missing shared working-set
frontier after an Application root overlay. Shared retained rows already contain
the new value, but cached relational index/unique membership still requires a
checked read before selecting from that overlay. Track the root's accepted
external overlay generation per table and the nonfinite borrowed view's last
successfully checked generation. Membership selection must discharge that duty
even when no row hydration is needed. A failed read or settlement keeps the duty
and the original sticky rollback-only refusal. Checking one table must not clear
another table's duty. Cached point reuse and finite root-local proofs retain
their existing local contract; this does not add SQL to every cached operation
or a second lifetime. Preserve the historical read-frontier assertion and add a
refusal witness at the shared owner.

Shared current Application preparation also captured the repository's scope
instead of the trusted host's explicit selection. Require the captured trusted
deployment/scope selection at that existing preparation boundary, resolve its
authority and provisioning receipt first, then require exact correlation with
the repository before preparing its fixed graph. This restores the accepted
same-deployment scope contract, including the selected peer's missing-receipt
refusal. Migrate standalone Commerce, atomic Commerce, CMS, direct fixture and
test callers together. The required private option breaks omitted-selection
callers; it adds no authority resolver, adapter lookup, fallback, cache, host
lifecycle, durable format or schema. Keep first-failure order, genuine repository
identity and installed-placement protection. Validate both owners and actual
standalone/mixed consumers on both drivers before final measurement and review.

The complete PGlite consumer also exposes a build-target composition omission.
Full readiness enters catalog validation inside the actual Currency partial-index
transaction, but the native unique-build target has no exact target/database
registration. Validation therefore opens a global transaction on the same
PGlite client whose outer transaction already owns the exclusive lock. The
index-build factory has the same missing composition evidence. The shared
target constructors must issue the existing exact database evidence when they
create their own default runner. Opaque injected runners remain uncorrelated;
their function or declared database argument alone cannot establish where the
callback executes. The existing native Postgres constructors may issue evidence
only after exact native client/pool correlation. Reuse the existing identity
owner, without a second transaction path, new runner registry or public claimed
provenance option. Copied targets, foreign databases and mismatched native pairs
must not obtain this proof. Preserve separated-store catalog validation and
existing uncertain-settlement/custom fault seams. The complete readiness witness
must use its actual existing transaction and finish on both drivers; retain its
structural catalog, readiness and rollback assertions rather than bypassing the
inspection or raising its time limit. This changes private construction evidence,
without a host lifecycle, schema or durable-data change.

### Consumer witness cutover at the actual capture boundary

The approved finite contract and whole-mutation replacement select one implicit
installed statement per named capture, with command-local metadata correlation.
Tests of that profile must observe its fresh native session and actual capture
envelopes. Remove the displaced global explicit-transaction projection spy and
table-name dispatch predicates; compiled storage calls use the installed snapshot
readers. SQL text containing a gated reader does not prove that its business
branch ran. Preserve before-demand placement, policy, credential, namespace,
incarnation and maintenance refusals, absent business envelopes, first failure,
sticky root refusal and absence of durable receipts.

A metadata counter increment after the native query completes cannot establish
an in-flight protected-tail failure. Ordinary rows, index rows and time must not
regain an unchanged-since-entry epoch check or post-result query. Preserve exact
epoch correlation across the named multi-command ownership captures, and use the
actual interlocked installation or authority writer to prove security/serving
invalidation ordering. Completed captures may precede unrelated publication;
the next actual demand must still refuse a changed live policy. The genuine
physical callback view must reject escaped queries before transport after its
statement settles. Deliberately corrupted fixture metadata must be restored to
its exact original values before normal fixture cleanup, without suppressing
cleanup failures. Keep workflow cancellation, draining, closed capability and
the complete Effect Cause at the existing Promise bridge. This migrates witnesses
to the accepted owner and lifetime; it does not change runtime authority, schema,
durable data or acceptance gates.

### Connected canonical-value and read-acceptance handoff

Status: selected continuing correction under the standing standalone/mixed
performance approval. The implemented workflow/row/query candidate passes its
affected correctness proofs but fails complete native-relative acceptance for
all five graphs. Its actual call paths still reconstruct issued row views,
projections and normalized results; read acceptance also constructs separate
runtime boundaries for contiguous pure checks. Fresh profiles identify those
paths, without establishing exclusive CPU shares or predicting a passing gate.
Replace their connected producer/consumer handoffs rather than optimize the
descriptor walker alone. This advances the same complete standalone and mixed
business graphs, without starting the paused independent read-tuning goal.

#### Existing owners and concrete replacement

The existing relational mechanics issuer retains the exact captured full runtime
row and its native-field view with its canonical document verdict. Reuse requires
the same genuine document, actual mechanics, and protected canonical byte/digest
comparison. A structural copy or an arbitrary frozen object grants no verdict.
Foreign/restored rows retain complete stored-evidence and table-row validation.
The query owner consumes that genuine row view before predicates or projection;
complete validation cannot be hidden by selected fields. Extend the existing
canonical verdict and private JSON capture owner rather than introduce an adapter
registry, parallel validator or second authority channel.

Stored rows must enter this handoff too. AppRows' actual full canonical document
decoder currently drops its verified-reference provenance, so a downstream
structural canonical value cannot safely acquire the relational verdict. Add a
private decoder leaf within that existing storage owner: invoke the current
canonical AppDocument evidence verifier once, then retain only its exact returned
document and original runtime/policy references with protected bytes/digest.
There is no registration API, consumer Boolean or public package export. Copies,
changed references and changed buffers receive no proof. This necessary private
reference registry conveys no database, scope, admission or settlement authority.
It replaces no codec, hash or stored-evidence check and introduces no durable
format, schema or migration. AppRows and relational mechanics import this leaf;
the generic row reader does not depend on relational table metadata.

On the first existing output/capture boundary, relational mechanics may consume
that genuine decoder proof and retain its detached JSON runtime/native views in
the existing canonical verdict. The proof alone does not imply immutable JSON:
Value Codec permits binary leaves, and the existing full JSON capture must still
reject those at its original accepting boundary. Defer complete table semantics
until the original query/write validation position; only its success issues the
actual mechanics verdict. Hydration budgets, earlier consumer refusals, lazy
per-row SHA/interruption, foreign full validation and distinct policy JSON remain
in their original order. An owned detached copy carries the original protected
byte verdict, so copying corrupt buffers cannot launder corruption. No stored row
is trusted because its shape or frozen state resembles a decoder result.

Runtime native output continues to derive from `document.value`; activity policy
continues to use its defined `valueJson` representation. Finite negative zero and
Value Codec tags make those representations distinct. Preserve `_id`, creation
time, numeric companions, defaults and managed fields. Selected-field and trusted
return wrappers use the existing retaining capture operation, so genuine immutable
children survive enclosing captures and native serializers. Every document bound,
node/depth/Unicode verdict, source check, independent byte charge and first refusal
stays at its accepting owner. Native mutable callbacks and escaped mutable binary
leaves still receive copies and deliberately lose immutable evidence. Derived
numeric/serialization values receive new captured facts; unchanged values alone
may retain genuine facts.

The protocol's existing successful-result issuer retains the normalized runtime
value it already established during canonicalization. Its private frozen-attempt
handoff lends that value only after the existing exact frozen-origin, authority,
session, snapshot and execution-claim checks. Finite commit preparation no longer
re-normalizes the issued JSON merely to reconstruct the dropped runtime value.
Foreign or restored results still undergo full canonical evidence verification
before issuance. Public result projections, defensive byte copies, canonical
bytes/hashes and durable outcome formats remain unchanged. This is owned value
provenance, without admission, storage or settlement authority.

Carry this same owned runtime contract through the trusted executor's existing
frozen-value validation loan. That consumer currently normalizes row and result
policy JSON again before the real Application document/return validators. Replace
only that reconstruction with lazy canonical runtime values from the exact frozen
owner. Application-table selection and each row's original validation position
precede its value access; an earlier refusal must prevent later row/result access.
Keep every actual document and returns validator, ID policy, schema/function pin
and validation failure. Immutable branches can retain identity, while every
escaped binary-bearing branch receives defensive copies. Reuse the existing
successful-result projection and put any shared binary detachment mechanics with
the actual Value Codec owner, rather than add a serializer or validator engine.
The internal frozen validation projection changes; migrate its executor consumer
and remove the dropped JSON reconstruction fields. Public frozen inspection and
durable canonical/result formats remain unchanged.

Read and finite-capture owners fold contiguous pure input, header, ordinal,
identity, budget and metadata correlation into ordered Result stages consumed by
their existing operation. Keep SQL, required per-row asynchronous SHA, lazy
catalogue loading, callbacks, resource work and every interruption boundary in
Effect. The working set folds known-table selection and its metadata obligation
together, while preserving the actual lazy miss path. Its existing projection
issuer may retain validated immutable metadata key/observation templates; combine
them only with the genuine root's fixed watermark and retain exact issuer/key/
watermark checks at consumption. Foreign keys and supplied dependencies still use
the authoritative decoder. Root metadata consumption is already Result-based;
do not replace it with a duplicate owner or cached readiness.

Pure checks may collapse within one row's accepting boundary. Never decode a
whole independent-row page synchronously: interruption or an earlier consumer
failure must prevent access to the next row, including its getters. Missing and
tombstone rows retain an interruptible boundary even when no hash suspends.
Earlier header refusal precedes later layout/body corruption; `attemptReplaced`
still validates its required anchor before refusal. Preserve body-withheld
settlement stopping, trusted-hydration defects, original dependencies/history,
supplied-batch validation before mutation, ordered uniqueness/lifecycle changes,
live context/time checks around ID resolution, busy state, rollback-only and the
complete Cause. A Result return channel is not permission to move evaluation or
failure order.

An unexpected getter in a supplied snapshot row demonstrates a real boundary
constraint: Schema's Result adapter wraps a non-schema defect in its own Error
with a nested Cause. The expected read outcome retains the original defect and
never accesses the next row; receiving the adapter Error is insufficient even
though the operation still fails. Schema decoding at a foreign row/header
boundary must therefore remain in the existing lazy Effect operation when its
full failure channel is required. Fold only the subsequent pure checks into
Result. Preserve the authoritative Schema, exact typed parse issues and field
order; do not duplicate validators, catch arbitrary errors to unwrap presumed
adapter shapes, or weaken the original Cause witness. This is an in-scope read
owner correction with no new authority, format or compatibility channel.
The same boundary applies to reverse-publication membership envelopes: capture
each foreign envelope through Schema's Effect decoder before pure ordinal/group
correlation, retaining its eager envelope order and the later lazy body decoder.
A throwing getter must retain its exact defect, stop later envelope/body access
and prevent entry to the publication consumer; malformed fields still use the
existing typed corruption channel. This completes the connected decoder cutover
rather than creating a separate fallback or validator.

#### Contract inventory, alternatives and removal

| Owner and consumers | Disposition and private break |
| --- | --- |
| Relational canonical mechanics, working-set output/query/write/activity and Medusa projection/serialization | Extend the existing exact verdict with owned views; replace repeated genuine-row capture/validation and measurement-only projection wrappers. Migrate actual standalone and borrowed consumers together. |
| Protocol successful-result issuer, finite freeze and point preparation | Extend the existing issuer's private handoff; replace JSON-to-runtime reconstruction after exact frozen acceptance. No persisted format or public result change. |
| App rows, ordered indexes, finite storage capture and working-set selection/hydration | Replace pure Effect decoder/helper channels with ordered Result stages; migrate all callers and remove displaced exports. Keep lazy per-row hashes and consumers. |
| Finite metadata projection issuer and root evaluator | Extend existing retained templates only for genuine immutable provenance; retain foreign Schema decoding and exact root dependency obligations. |
| Scope observation owner, native AppRows/index identity reads and managed-field time | Extend the existing exact transaction observation with identity/time-only lending; migrate every actual immutable-identity borrower together while retaining fresh mutable clock, revocation and readiness checks. |
| Foreign/restored row/result decoders, callback copies, native transport, admission and settlement | Retain their real obligations and owner lifetimes; they have no replacement or retirement permission in this correction. |

Rejected alternatives are another JSON walker optimization without handoff
changes, structurally trusted frozen rows, activity/runtime representation
substitution, whole-page eager decoding, dropped budget charges, cached live
acceptance, raw-driver fallback and a transaction held across native callbacks.
New schema/routines, durable-data disposition, host lifecycle and developer APIs
remain outside this correction. No durable reset, migration or deletion is needed.
Remove replaced wrappers, exports, sole-use validators and stale tests in this
same connected cutover; temporary retention needs an actual unmigrated consumer
and removal gate.

#### Complete proof and delivery gates

The same connected cutover also closes the ordinary native transaction's
identity/time lending gap. Snapshot lifecycle locks already protect the immutable
scope key, and the captured database transaction timestamp is stable within that
transaction. Extend the existing scope observation owner with an identity-only
loan, rather than treating READ COMMITTED as a fixed clock snapshot. This loan
must not grant sequence, epoch, revocation, retained-floor or serving/readiness
acceptance: every existing mutable-state refresh still performs its actual SQL
checks. Native membership and managed-field consumers borrow only the exact live
transaction's protected scope identity and timestamp, retaining lazy timestamp
validation and timestamp refusal instead of falling back after a revoked issuer.
Closing the identity loan invalidates its exact borrowed evidence; an otherwise
live trusted index operation retains its existing fresh identity SQL path.
Keep lock order, strong-writer replacement and outer transaction cleanup. Prove
ordinary-role READ COMMITTED publication advancing the clock between refreshes
while the immutable identity remains reusable; prove mismatched transactions,
scope identities, changed lifetimes and closed loans fail. This replaces the
separate identity/time round trips without caching an earlier live verdict.

Retained canonical wrappers and their runtime containers are immutable. Replace
test-only post-freeze object assignment rather than reopening that displaced
mutable contract. Source-order corruption witnesses alter the genuine mutable
canonical byte buffer, so the existing protected verdict refuses at the original
source acceptance position; current-source closure still precedes that refusal
and later-source closure follows it. Keep the actual invalid native-write witness
at its before-close boundary. Predecessor-versus-index refusal witnesses use a
complete authentic Application write with an oversized developer-index value;
repairing the predecessor must reach the real index planner using the same frozen
command. Preserve exact failures, unchanged durable state and callback counts,
and absence of publication. No test issuer, mutable wrapper or runtime fault API
is added to recreate an impossible retained-object state.

Prove genuine versus copied/foreign/changed mechanics, mutable canonical buffer
refusal, runtime negative-zero versus tagged JSON, projected hidden corruption,
native numeric/default semantics, mutable callback isolation, exact frozen-result
origin and foreign result corruption. Preserve later-row getter laziness,
interrupted consumers, withheld bodies, first crossing budget, metadata watermark
and source provenance, cancellation/drain, rollback/OCC, event interleaving,
source-wide publication closure and one outer durable outcome. Run affected owner
and complete standalone/mixed consumer proofs on PGlite and ordinary-role
PostgreSQL, affected regular strict checks, guards and lint. Both reviewers inspect
the stable final connected diff. Then collect complete matched quiet, root-counter
and database cohorts for all five graphs; the fixed 16 ms CPU and 5/10 ms latency
gates remain unchanged. A failed gate requires the next responsible-owner
correction and is not a completed performance deliverable or commit permission.

### Connected prepared sources and guarded execution replacement

Status: implemented; the owner has resumed responsible-core correction. Affected owner and complete
standalone/mixed consumer proofs, source/compatibility guards, strict checks, lint
and both final reviews pass. Complete matched native performance still misses all
five graph gates; the connected candidate remains uncommitted. The
[CPU measurement owner](../../packages/medusa-adapter/benchmarks/core-performance/native-business/cpu-execution-results.md#measured-candidate-before-resumption)
records the measured excess and its comparison limits. The connected command and
admission continuation below now owns the next correction; the separate
standalone-read pause remains in force.

#### Selected outcome and evidence

Replace the remaining preparation and accepting-query choreography across the
actual Application, Payload and Medusa owners. This continues the authorized
complete performance outcome; it does not finish the preceding canonical handoff
as a separate performance deliverable. Complete matched native acceptance and
the unchanged CPU and latency gates remain the delivery boundary.

The canonical handoff leaves substantial complete excess. The fresh five-graph
measurement retains added median thread CPU of 94/31/78/79/110 ms and paired quiet
added median of 105.77/44.98/128.56/116.38/220.81 ms for mixed Product, standalone
Payload, standalone Medusa, mixed Payload and mixed workflow respectively. Every
graph still misses both gates. Standalone Medusa retains 90 driver exchanges;
mixed workflow retains 50, with 33 checkouts. The local measurement owner is
`work/validation/shared-execution-evidence/canonical-read-handoff/results.md`
and its adjacent summary and original reports. Independent cohorts and Windows
counter quantization do not establish exclusive causal milliseconds.

Challenge the apparent hydration bottleneck before selecting work. At the measured
starting point, finite selections used combined `indexRows`: 10 for mixed Product, 11 for
mixed Payload and 26 for mixed workflow. They use no separate finite page/row
captures. Already-hydrated bodies are excluded before transfer. The paginated
split remains a real API issue but is unused here and cannot substitute for this
outcome. Likewise, ordinary unique-owner reads already join the owner and exact
row; their twelve workflow exchanges are business demands rather than twelve
split lookups. Native query/capture mechanics already retain compiled statement
shapes, result mappers and named backend statements. Recompiling another cache
or treating template telemetry as wire bytes would address the wrong owner.

The remaining finite pipeline projects a broad raw frontier and repeats client
readiness acceptance for every demanded read. Ordinary admission and settlement
also reload and decode binding/schema/source observations. Payload separately
repeats complete field projection/table validation after successful writes and
again during finite or ordinary settlement, and its detached canonical documents
lose that semantic provenance. Warm finite entry composes complete metadata maps
and canonical table comparisons even though current-generation construction
already owns the immutable source contracts. These are connected replacement
seams; none individually proves a gate-closing magnitude.

#### Contract and authority

1. Move finite mutable readiness acceptance into its existing installed SQL
   capture owner. It must perform the complete checks in their original order:
   placement and installation, authentication, exact session/anchor/claim pins,
   authority/build exclusion, fresh post-wait time and clock, lifecycle, expiry,
   revocation, generation/history floor, maintenance and coverage. Compile genuine
   immutable expected definition/source inputs once with their current generation;
   bind each operation's actual dynamic values to the existing fresh command.
   Return a compact accepted frontier and demanded storage envelopes, or the
   precise refusal-specific evidence required by the failure owner. Remove the
   displaced finite client readiness algorithm after its consumers migrate.
   Genuine full-artifact consumers retain complete fresh artifact authentication
   in their explicit profile; an installed-profile refusal never switches to it.

2. Preserve membership/key authentication, lazy stored-document decoding/SHA,
   lookahead and EOF duties, point/index dependencies, withheld bodies, independent
   hydration and root charges, and stopping before later bodies or demands.
   Compact headers remain foreign data: their authoritative Schema decoder keeps
   the original full Cause, expected typed refusals and field order. A SQL success
   does not authenticate a fabricated client object. Do not prefetch future
   workflow operations, cache earlier live acceptance, or keep a database
   transaction across an untrusted callback. Batch only demands already owned by
   one actual native retrieval operation.

   A combined current-index capture must use the actual allowance after ordered
   membership retention and after earlier packets' real dependency, envelope and
   document charges. The per-packet transport ceiling remains independent. An
   initial allowance reused separately for every packet is insufficient: later
   refused bodies must remain in Postgres. Any single-command projection needs a
   genuine protected budget basis, including the effect of other possible root
   charges; predicting an opaque future limits callback cannot establish it.
   Preserve dense packet order after excluding already observed identities,
   including cached absences and removed rows. Decode the complete accepted
   packet before hydration charges, as the original AppRows operation does;
   per-row decode/charge interleaving would change corruption-versus-budget
   precedence. Keep current-packet refusal at its original owner and position,
   rather than reject the whole packet conservatively before its decoder.

   The current lifetime does not issue a protected byte-budget loan: trusted
   nested-command output and accepting callbacks may charge while a store query
   is pending. Select ordered membership acceptance followed by the existing
   sequential AppRows captures for dense unseen packets. Sample the real limits
   immediately before each packet's query, after membership retention and all
   preceding hydration charges. This is the selected current-read profile;
   remove unconditional fused body projection rather than retry a refused fused
   capture. A future single-command profile would require a coherent lifetime
   and command-output budget contract, justified by complete measurements.

   Extend that permission contract to retained finite indexed reads and historical
   unique lookup. Their fixed snapshot protects revision history, but it does not
   reserve the mutable request budget. The existing combined `indexRows` command
   can transport an unseen body that fits the initial allowance before membership
   retention or the actual point callback consumes it. The expected behavior is
   refusal before that body's transfer. Migrate these genuine consumers to the
   existing finite `indexPage` and `rows` captures: authenticate the complete page
   and lookahead, retain membership in its original order, perform the real point
   callback where applicable, then sample the actual allowance immediately before
   each dense unseen-row packet. Cached absences and removals remain excluded.
   Retain the historical AppRows decoder's ordinal decode-and-consume contract:
   actual hydration refusal precedes access to later body evidence. The current
   reader's complete-packet decoder is a distinct existing contract, not a reason
   to change historical corruption-versus-budget precedence. A failed membership
   charge or point callback issues no subsequent row query. A successful callback
   passes its actual remaining allowance to the original historical row owner,
   which retains its deliberate first-crossing evidence and independent transport
   ceiling before refusing hydration and stopping later body access. Do not claim
   that this profile withholds every first-crossing body. Remove the displaced combined
   operation, statement shapes and mapper layout after those consumers migrate.
   The extra accepting command is an explicit correctness cost to assess in the
   complete graphs, rather than a reason to retain premature body transfer.

   Apply the same permission rule to current unique ownership. Authenticate the
   slot and its canonical key through the existing slot-only owner first. An
   unseen positive owner then enters the existing point reader after its actual
   point callback and rows readiness, sampling the fresh allowance there.
   Cached positive or negative dependencies, completed scans, absent slots and
   omitted keys do not transfer another body. Preserve exact owner revision,
   live-row and canonical-key checks, and charge the unique observation at its
   original final position. A body fetched before that accepting position cannot
   become permitted by resampling after transport. Remove the unconditional
   combined slot/body path and migrate its actual consumers; do not retain it
   as a retry path or move the final unique charge earlier. Concurrent movement
   between slot and point observations retains the existing conflict refusal.

3. Extend the existing canonical document verdict and detachment owner for
   Payload's successful table semantics. Retain the exact canonical document,
   immutable table/validator/ID-policy owner and privately owned runtime projection
   at the original successful validation position. Preserve that provenance across
   genuine close/freeze detachment, with protected byte/digest comparisons and
   defensive mutable leaves. A verdict grants only semantic reuse. Both finite
   source acceptance and ordinary lowering retain their original live admission,
   identity/confinement, source closure, failure and independent budget positions.
   Foreign copies, changed table/policy/generation or altered evidence retain full
   validation or exact corruption refusal; they gain no write/settlement authority.
   Keep framework semantics with their adapter and reuse the existing validator.
   Canonical ownership issuance stays private to the successful codec. Exported
   runtime projection helpers cannot mint that provenance. Reusable validation
   covers the immutable table contract; every actual source write still checks
   its own document ID and creation time before borrowing the table verdict.

4. Compose the exact source/Application metadata union during genuine current
   generation construction. Entry authenticates that pairing and binds the actual
   root, watermark and authority instead of rebuilding complete maps or encoding
   both table catalogues again. Refresh and disposal revoke the pairing. Explicit
   unprepared construction retains its actual full proof; a changed retained
   generation never silently falls back. Every consumed/write-closure comparison
   still performs its actual fresh SQL at its accepting position.

   Native Application and logical-storage schema identities have distinct
   owners. Their identifiers need not match. A differing pair requires the
   genuine bound Application projection issued during that exact staged
   generation and complete existing table/index catalog equivalence. Preserve
   each catalog's own issuer and schema binding, exact lifetime, scope and
   deployment checks before semantic reuse. Unbound construction retains its
   actual same-schema contract; copied projections and mismatched native catalogs
   refuse before graph installation.

   Definition equivalence is exact in both directions after filtering to the
   Application-owned table identities. Equal tables plus native-to-bound index
   membership is insufficient: removing `users.by_name` from the native contract
   leaves an additional definition in a retained logical catalog. That genuine
   pair must refuse as `sourceMismatch` before attaching a graph. Compare both
   definition cardinalities and reuse the existing physical-definition matcher;
   framework-owned definitions on other tables remain independent.

5. Replace ordinary root admission and settlement projection choreography at the
   existing binding, source, publication and materialization owners. Capture the
   selected source/initialization set through a bounded ordered root observation,
   preserving installation/request protection, authority/clock, active binding,
   source and publication/build/unique lock order. An ordinary native root obtains
   its own full-live canonical proof and protection; it cannot borrow the finite
   guard or standalone direct-tail profile. Payload and Medusa remain distinct
   profiles over the same storage and publication mechanics.

   Under existing writer exclusion, compile the complete closed contribution once
   and capture current point heads/originals, unique and range observations and
   readiness through bounded ordinal acceptance stages. Preserve source order and
   every required intervening client verification before application. Feed the
   accepted plan into the existing installed publication/materialization owner;
   remove displaced per-source reload/application stages where the owning program
   can perform them coherently. Keep original observations, reference and unique
   obligations, coverage, one outer durable outcome and uncertain-result recovery.
   A workflow-specific SQL engine or callback-spanning batch is rejected.

   Owned head/original capture and its shared selection compose through typed
   Effect operations. The existing native statement adapter surrounds the driver
   call; Result acceptance, predecessor planning and lazy original state stay in
   the owned Effect flow. Migrate internal Effect consumers directly and use the
   existing transaction runtime boundary for its native Promise consumer. A new
   compatibility wrapper or second Promise rejection classifier is unnecessary.

   Native unique-build evidence uses its authoritative precompiled Effect Schema
   decoder before pure intrinsic/frontier/maintenance acceptance. A raw getter
   defect must retain its original Cause and identity; the synchronous Schema
   Result adapter can replace it with an adapter Error. Migrate connected native
   readiness, maintenance and publication callers at their existing acceptance
   positions, retaining pure Result policy evaluation on decoded state.

   The ordinary build owner has two genuine observation profiles. A retained
   coherent head/schema observation can select compact full readiness only under
   its exact current writer exclusion. Its native query locks selected builds in
   ascending identity order, performs the complete availability pass first, then
   accepts intrinsic state, maintenance pins, retained history and current source
   table coverage in input order. Fresh clock and the existing canonical coverage
   context owner remain mandatory. Changed authentic pairing refuses; it cannot
   switch profiles. Actual concurrent readers keep their full-progress profile:
   original ascending KEY SHARE locks and global availability, a separate fresh
   clock after those locks, the original canonical coverage context, ordered
   intrinsic/frontier/coverage acceptance, lazy table frontiers and at most three
   publication-progress refreshes. Compact successful intrinsic observations at
   the existing native build owner; retain only the fields that its later
   frontier and coverage owner actually consumes. An intrinsic refusal retains
   the original raw build and maintenance from that same capture for the full
   decoder at its original position. Construct the ordered decoded Results after
   the fresh clock and before the coverage context, preserving immediate foreign
   getter defects there; consume typed refusals later in the original ordered
   coverage loop. Keep all actually invalid captured rows required by that fold,
   rather than suppress a later defect behind an earlier typed failure. Complete
   the entire ascending lock set before returning global availability. Do not
   reconstruct a full record,
   requery refused evidence, cache a mutable observation or acquire the writer
   exclusion earlier. Native Medusa business entry remains a snapshot reader;
   its real refreshes cannot borrow the writer-only acceptance contract.
   Cold observations without the required authentic preparation and ordinary
   full build APIs retain their named full observation/decoder contract, alongside
   fenced build reads, activation/backfill and refusal-specific native evidence.
   The independent CE0 first-insert reference also retains its stronger full
   maintenance-state proof through the existing native build reader; it does
   not require successful production settlement to transport those records.

   Settlement uses its original SHARE exclusion and input acceptance order but
   returns one accepted record instead of all successfully validated build rows.
   The original decoder interprets the first native refusal, including its full
   corruption Cause. This is distinct from read readiness: it neither grants
   serving coverage nor consumes the finite workflow acceptor.

#### Breaks, migration and removal

The finite raw capture header, projection/result mapper and client readiness
contract break. Migrate all finite capture and participant consumers together.
Installed function/type signatures, grants, verification and restoration change
through the existing installation/maintenance owner. No application data table,
document/revision, journal/result format or public developer API changes are
selected. Dropping a displaced routine or unreferenced runtime composite type is
structural retirement, with no stored application data to delete. Inventory every
actual dependent before removal; retain only a named genuine consumer with its
explicit profile and retirement gate.

Payload's canonical table-verdict/close handoff, prepared source/Application
metadata pairing, and ordinary root admission/settlement projections also break
privately. Migrate ordinary and mixed consumers, source validation, detachment,
finite acceptance and lowering together. Generalize the existing responsible
canonical owner where necessary rather than introduce a Payload registry, adapter
cache, validator or universal transaction API. Retain public detached inspections,
native callback copies and supported explicit full-proof profiles. Remove unused
wrappers, exports, duplicated accepting logic, tests of displaced private shapes
and stale guidance in this connected cutover.

The structural cutover replaces `fx_accept_finite_storage_capture` and
`fx_finite_capture_frontier`, adds the immutable `fx_finite_read_expected` input,
and migrates routine grants, installation verification and maintenance restoration
through migration 0141. Ordinary compact acceptance remains invoker SQL over its
existing native tables and lock contract; it introduces no installed routine or
data migration. Successful settlement build records disappear from the private
locked model because no consumer uses them. The native composite scalar projection
is shared by the database owner rather than duplicated in index or publication
code. Native composite captures carry nullable/raw scalar evidence; the existing
lazy build, Application head/schema and candidate decoders own the validated
contracts at their original acceptance positions. A TypeScript native-row
annotation does not discharge that validation. Replacement-only raw frontier
envelopes enter the existing finite anchor owner before canonical acceptance;
parse failures retain its original stored-corruption error, while foreign getter
defects and prior driver scalar failures retain their original Cause. Healthy
captures do not transport that unused frontier. The test fixture must select an
alternate source inside original preparation;
swapping an unrelated loan after graph compilation is now an intentional refusal.

Ordinary captured-head preparation, including an empty head, must match the
finite guard's exact retained scope authority before decoding or issuing prepared
semantics. Issuer equality alone cannot establish the selected storage fence.
General guards without a retained selection preserve their actual
authority-resolution contract. Closing the retained guard removes its issuance;
subsequent preparation refuses as `notIssued` without retaining a tombstone or
adding a second lifetime owner. Final candidate acceptance still checks the fresh
clock and the exact current head.

Borrowed unique-slot and reverse-membership readers close when their callback
finishes, including a synchronous throw while constructing its Effect. The
initialization receipt callback uses the same construction boundary. Install the
existing cleanup before calling foreign callback code; preserve its original
defect rather than mapping it to a domain refusal. Raw native unique-slot
correlation and selected claim values enter the existing Schema Effect boundary
at their original acceptance positions. Pure decoded policy retains its Result
contract, while throwing getters retain their original Cause and ordinal order.

This selected correction extends the preceding no-routine canonical handoff into
the existing authoritative SQL routine/installation owners. The standing core
performance approval covers this connected private replacement. It does not
authorize new host lifecycle, hosted activation, framework expansion, advanced
schema evolution, durable reset/deletion or public capabilities.

#### Proof and completion

Preserve failing witnesses and validate both drivers: each fresh auth/pin/fence/
lifecycle/readiness refusal before body access; held builds followed by fresh
clock/expiry; actual concurrent publication and history movement; negative owners,
range gaps and EOF; lookahead/complete-selection limits before hydration; missing/
tombstone/corrupt originals; first crossing and independent charges; exact issuer
versus clone/spread/frozen wrappers, changed source/table/validator/bytes/digest and
disposed generation; invalid native documents before close; current closure before
document refusal and document refusal before later closure; predecessor corruption
before index failure; original unexpected getter Cause; interruption/drain and
escaped-reader closure; rollback-only, no publication prefix on refusal, event
isolation and durable-outcome-first recovery. Routine grants, installation integrity
and maintenance restoration require the ordinary-role PostgreSQL lane in addition
to PGlite.

Run affected strict checks, source/compatibility guards, core/diff lint and both
final reviews against a stable complete checkpoint. Then measure all five complete
matched native graphs with quiet, root-counter and database cohorts. Preserve the
fixed 16 ms added median thread CPU and 5/10 ms paired added median/P95 latency
gates. Component proofs, helper savings and lower SQL counts remain internal
steps. Continue correction at the responsible owner if a complete gate fails;
only the coherent verified outcome receives the scoped commit.

### Connected command and admission continuation

Status: the connected candidate is implemented but remains uncommitted because
all five complete performance gates fail. Work is paused at the owner's request
for discussion after validation and complete measurement. The corrections below
belong to that same connected outcome; they are not separate completed
performance deliverables.

#### Connected logical operation and readiness execution

##### Remaining operation ownership and readiness dispatch

Status: implemented and correctness-reviewed within the same uncommitted
connected outcome, now paused at the owner's request. Complete matched
measurements still fail every native-relative CPU and latency gate. Local
ordered readiness removes the preceding pure-RPC candidate's seven healthy
Medusa exchanges and two Payload exchanges; mixed workflow still performs 38
distinct implicit captures. Those captures are actual ordered observations,
not evidence of a redundant pool or permission to prefetch later business calls.
Current Medusa CPU is higher than in the preceding separate cohort; exchange
removal does not establish a complete CPU or latency improvement. The CPU ledger
owns the measured result and its attribution limits.

The selected client correction extends existing operation ownership across
generic document predicates, query-required relational interpretation and
authentic finite-root revision transfer. Generic predicates retain static field
and range-bound interpretation within one captured query, lowering each bound
only at its original first eligible comparison. Actual candidate encoding still
precedes bound encoding; empty or nonmatching selections gain no new failure.
Every candidate retains its original document integrity, dynamic values,
predicate order and charges. Query-required mechanics may retain immutable
selection interpretation at their authentic original generation, while each
execution still consumes metadata and establishes fresh storage acceptance.

Finite-root ingestion transfers canonical interpretation only from an authentic
existing canonical/decoder issuer into the root's owned detached revision. It
does not recognize arbitrary clones, structural equality or frozen foreign
rows. Root-private retained evidence and key derivation remain bounded and are
released with displaced current revisions and root closure. Public point,
activity and snapshot transfers remain detached. Preserve canonical bytes and
digest checks, exact existing copy charges, observed dependencies and failed
retention behavior. The canonical document and root owners define this private
transfer contract; framework adapters do not establish it.

For incoming stored revisions, the existing stored-document decoder also owns
the immutable live frame it constructs. Its existing document evidence record
retains weak membership of those exact frames. Root ingestion passes the
document reference captured at its original inspection cut, authenticates exact
frame membership without reflecting foreign properties, and performs the
original whole-revision copy at the post-budget frontier. Transfer only the
recorded decoder evidence to that owned copy. Foreign or synthetic frames get
their original whole copy and no evidence transfer, including proxies and
accessors that change or remove themselves during copying. This prevents a
changed frame from lending another document's provenance and preserves original
copy defects. No arbitrary-frame registration API or separate registry is added.

The selected readiness replacement removes RPCs whose only work is pure
calculation. Each existing index, unique and search owner decodes the minimal
intrinsic-valid progress from its original native capture once, at the original
pure-fold frontier, then consumes an ordered pure Result program locally.
Use named owner-local schemas and established sequence/identity codecs; compact
transport is data, never authority. Complete native capture remains the source
of every actual member and retains native invalid records for original decoders.
Keep all 121 index, 37 unique and ten search demands in the measured graph.

Index invalid getters still run before canonical context, and typed intrinsic
Results remain ordered data. Unique retains its own actual post-lock clock and
intrinsic refusal before maintenance context. Search retains state acceptance,
then conditional physical acceptance, then frontiers and conditional clock
refresh. Every actual mutable SQL observation, independent READ COMMITTED cut,
64-table batch decode boundary, exact clock/frontier lending identity, canonical
acceptance and original consumed frontier Result stays in its existing owner.
Each compact capture is interpreted once within that original transaction; no
captured row, absence, clock or accepted verdict is reused across transactions.
Foreign transport corruption fails through its owner before subsequent SQL;
defects and original native refused evidence keep their existing behavior.

The affected private contracts are the opaque progress continuations and their
pure-fold response envelopes. Replace them with owner-defined captured progress
and ordered Result consumption; remove pure-fold query factories, artificial
response decoders and their runtime installation inventory. Add managed additive
migration 0144 to drop only the three private 0143 pure routines after consumers
migrate. Preserve every table, row, history, session, journal and outcome. Keep
0143 as migration history, not a runtime fallback. Validate populated upgrade
and routine retirement with the installation maintenance interlock. There are
no supported external callers or durable outcomes owned by these routines.

The challenged alternative combines pure folds with clock/frontier commands.
Although bounded native stages could preserve many cuts, that route needs
additional cross-owner command and frontier-consumption envelopes, and cannot
combine multiple frontier batches across their original client decode boundary.
Local ordered interpretation removes the pure exchanges directly while keeping
the existing mutable-observation and authentication owners. Do not introduce
an installed mutable program or duplicate frontier/clock authority here.

These are connected core corrections, not separate completed performance
deliverables. Keep the physical native-store profile, framework business
lifecycle and finite admission/settlement owners. No adapter cache, universal
binder, new host lifetime, allowance increase, durable-data deletion, writer
exclusion or query-required substitute for full ordinary readiness is selected.
Consumer changes migrate actual native callers and remove displaced private
interpretation in the same correction. Validate predicate failure order,
canonical tampering, detached transfers, overlay/close/charge behavior and
affected standalone/mixed paths on PGlite and ordinary-role PostgreSQL. Both
reviews and complete matched five-graph measurements remain completion gates.

The connected mechanics cutover also replaces displaced original-table identity
checks in relational reference paging, set-null, delete and update effects.
The admission owner now issues each binding with its authentic detached mechanics
table, while the captured schema retains the original table identity. Requiring
the detached table to appear by identity in that schema rejects genuine native
collection cleanup before any SQL. These owners must instead require the binding
definition to be its exact mechanics table, and validate those mechanics through
the existing preparation issuer against the exact original local table and
capability identity. Keep these checks at their original pre-SQL frontiers; value
equality, arbitrary immutable clones and adapter reconstruction are insufficient.
Preserve the failing native managed Product scenario and strengthen foreign-key
witnesses for copied mechanics, changed definitions and wrong capabilities on
both drivers. This is consumer migration of the approved private mechanics
contract, with no new authority, SQL observation, durable format or public API.

The retained physical Commerce read profile must also validate its captured order
envelope through a named owner Schema with literal `asc`/`desc` directions.
String coercion currently accepts an array direction such as `["asc"]` and later
lowers it as descending; prepared reads retain that invalid interpretation.
Replace that coercion at its existing parsing frontier, preserving private
capture, charges, window and selected-field failure order, column resolution,
predicate validation, admission and request closure. Reject malformed direct and
prepared find/count inputs before dispatch, and retain valid ascending/descending
behavior on both drivers. The logical predicate compiler remains a separate
profile; no universal query envelope, compatibility coercion or allowance change
is required. This repairs an existing malformed-input contract consumed by the
approved prepared-read replacement.

##### Previous pure-RPC candidate and retained obligations

Status: implemented candidate superseded by the selected correction above within
the same uncommitted standalone/mixed mutation outcome. Its native capture,
resource, semantic and failure obligations remain; its three pure-RPC
continuations and runtime installation inventory are selected for replacement.
Complete native comparisons after the command,
admission and static-placement replacement still fail all five combined gates.
Standalone Medusa uses 87 exchanges and has 94 ms median pairwise added CPU;
mixed workflow retains 38 implicit captures within 58 exchanges and has 140 ms
added CPU. Sampled client leaves are distributed across Effect, logical working
sets, ordered keys, Schema, private JSON capture and native driver work. Samples
do not establish exclusive CPU milliseconds or predicted savings.

The next connected replacement crosses the existing logical query/mechanics,
working-set and full ordinary readiness owners. Fixed index-range SQL and finite
capture SQL are already compiled. Retain those native SQL and codec owners;
another SQL cache, mapper, immutable-anchor decoder or lookup-map adjustment
would duplicate existing mechanics and miss the repeated interpreter.

Replace query capture/validation followed by selection reconstruction and
reselection with source-bound logical operation programs. The existing query and
mechanics owners select genuine definitions, lower bounds and retain ordered
selection ordinals, metadata demands, predicates, ordering and projection.
Execution consumes that program directly. Reuse is limited to the original
mechanics generation and live request/preparation owner. Foreign, copied or
changed inputs still cross their complete original validation frontier; retained
structure never grants admission, readiness, clocks, body allowances or a
negative storage result.

`LogicalRelationalStore.prepareRead` issues an inert store-bound program whose
first guarded method captures the query. Its find/page/count methods retain
that immutable query interpretation while running their original independent
operation guards and fresh observations. A later caller mutation of the input
cannot redirect an already captured program; callers prepare a new program for
a changed query. Native physical Commerce retains its own real find/count/page
operations. Medusa's paired read/count consumer and typed fake stores migrate
to this private program contract; one-shot store methods remain for their actual
document and command consumers.

Prepared table mechanics own detached immutable table and capability views. The
existing issuer records their exact original source references and their owned
views; admission and row-value consumers authenticate that issuance instead of
requiring the detached view to equal the original reference. They then consume
the owned definition. Copied definitions or capability arrays do not qualify,
and mutable caller references cannot change the admitted immutable source.
Catalog lifetime checks retain their original authority.
Closing preparation revokes its catalog identity, so later catalog use fails
composition authentication. Test the actual preparation's closed lifetime
separately from this revoked-identity refusal, before any subsequent storage
observation.

Application readiness and generation preparation remain the owners of their
typed failures. Commerce projects their resource failures as resource failures
while preserving the exact owner wrapper and underlying preparation error as the cause
chain. Capacity exhaustion must not fall through to authority refusal. Defects,
interruption and full-Cause cleanup retain their original behavior; unrelated
readiness and activation failure classes keep their existing mapping.

The existing working set retains derived unique/index keys per canonical row
revision and preserves preimage evidence separately. Replace repeated lowering
of unchanged rows and per-row Effect execution in unique validation with an
ordered pure Result fold over retained interpretation. Preserve definition order,
the first conflicting pending row, canonical-byte integrity, each real storage
observation and every logical charge. The fold still visits preceding rows:
an unconditional constraint/key map shortcut would skip their required integrity
checks or move a later defect ahead of an earlier conflict. Quadratic row
visitation is therefore not claimed to be removed. Deriving a key must not move
a later encoder/getter failure ahead of an earlier storage or conflict refusal.

Retaining derived keys is an explicit private resource-contract break: charge
successfully retained key/projection bytes once at their original lowering
frontier, in addition to original per-call input, storage and logical charges.
Configured limits remain unchanged. Install retained evidence only after its
charge succeeds; a failed charge is never memoized. The existing retained-document
set scopes key identity and cleanup: finite children share their actual root's
set, while independent working sets retain their own. Keep only original preimage
and current revision key evidence per pending row, evict displaced current keys
on patch/replace/delete, and release the owner on close. Retained attempt history
does not retain every historical key set. Genuine canonical-byte/digest integrity
still precedes reuse. The replacement may exhaust the same bounded memory budget
earlier because it now accounts for retained interpretation; it does not enlarge
allowances or weaken body-transfer accounting.

At ordinary readiness, replace repeated full-source raw transport and healthy
client folds with an installed complete-source acceptance program where the
current coverage owners can establish the same proof. Keep all index, unique
and search members, ascending lock order, actual post-wait clocks, maintenance
and coverage checks, original canonical context and corruption/refusal order.
Retain ordered owner continuations for evidence that cannot be accepted in the
installed program. In particular, eager index intrinsic failures precede their
canonical-context acceptance; unique and search retain their own clocks and
first-failure positions. A query-required or compact writer proof cannot replace
this concurrent-reader contract. Record any required installed routine/type,
grant, integrity inventory and non-destructive migration before that edit.

Finite execution consumes the same prepared logical selections through its
existing capture owner. Reject an installed membership batching API in this
cutover: the retained complete mixed-workflow trace has 17 membership captures
across 16 relational reads, with only one two-selection query; the other nine
membership captures are separate selectors or ordered write/uniqueness checks.
Batching can remove at most one of 38 commands before failure-order constraints,
and upfront capture would access later selection SQL before an earlier body or
charge failure. Actual ordinal acceptance, lookahead/EOF, callback charge and
cache exclusion still finish before permission for unseen bodies. Native current
execution retains its actual READ COMMITTED observation cuts. Neither profile
prefetches future business calls or holds a transaction across untrusted
execution. Native prepared queries remain checkout-local; there is no new client
cache or host lifecycle.

The ordinary installed replacement uses three source-private pure captured-input
folds: index `(text,jsonb,bigint,bigint,text,jsonb)`, unique
`(text,jsonb,bigint,text,jsonb,jsonb)` and search
`(text,jsonb,bigint,jsonb,jsonb)`, each returning owner-defined JSON verdict data.
They are IMMUTABLE SECURITY INVOKER functions with `pg_catalog,pg_temp` search
path, no PUBLIC EXECUTE and exact restricted runtime grants. They read no mutable
database state and grant no admission. Existing native capture holds only the
minimal intrinsic-valid progress payload as opaque text in its owner-local
closure; invalid full native rows retain their original decoders and eager
Result/defect positions. Actual post-lock clock/context/frontier cuts remain
outside that payload. There is no later mutable reread substituted for the
original capture and no caller-issued payload authority.

Search-state capture keeps exact numeric table/index pairs selective through the
existing `(scope_uuid,table_id,logical_index_id)` primary key. A batch binds paired
integer arrays from the same ordered definitions; concatenated JSON keys remain
transport representation only. Retained states unrelated to the requested pairs
must not turn each bounded capture into a scope-wide expression scan. Validate
actual prepared statements and PostgreSQL plans with retained distractor states.

Additive migration 0143 uses installation quiescence and its existing managed
maintenance owner. The installation owner verifies exact routine signatures,
body hashes, invoker/volatility/search-path properties and restricted grants and
restores them through the existing maintenance path. Existing index/unique build,
search advance, publication coverage and maintenance writers remain the mutable
state owners. No type, table, application row, history, session, journal or outcome
is removed, reset or silently migrated. The new private continuation contracts
replace healthy full-state transport/folds while preserving detailed refused
evidence and original concurrent-reader proof; they are not a compact writer or
query-required compatibility route.

Connected consumer validation retains an intermittent PostgreSQL publication
timeout witness in the second-shop population fixture's 123-row Currency
initialization. The existing publication owner shares one 1,000 ms statement
budget across its installed stages. A complete successful row stage performs
123 revision and 123 current-pointer INSERT statements, each invoking the real
installation admission trigger; intrinsic transition acceptance also scans the
row packet per emitted transition. Cancellation at a revision INSERT does not
attribute the entire elapsed budget to that INSERT or prove that all later
statements ran. Isolated success and checkpoint overlap do not establish the
failure's cause. Preserve the scoped population witness and capture backend
waits, blockers and CPU before selecting a responsible correction. Keep the
existing limits, fresh guards and failure assertions; no adapter workaround or
timeout increase is selected.

Break and migrate the private logical preparation/execution contracts for
find/page/count/change, document commands and their Commerce/CMS consumers
together. Remove displaced where reconstruction, duplicate planning and obsolete
interpreter branches in this cutover. No durable key codec, application history,
journal or outcome format change is selected. Installed readiness changes, if
required, use managed maintenance and preserve named durable data.

Decisive proofs cover genuine reuse versus forged/foreign/disposed generations;
capture and getter/encoder failure order; membership before bodies; exact first
crossing budgets; cached absence/removal and overlays; unique conflicts,
composite points, UTF-8 order, EOF/overflow and negative dependencies; actual
concurrent readiness and corruption/refusal cases. Validate affected owners and
standalone/mixed consumers on PGlite and ordinary-role PostgreSQL, strict checks,
source guards and lint, followed by both final reviews. Complete matched native
five-graph CPU and quiet latency gates remain unchanged and own completion.
Neither a component gain nor reduced exchanges finishes this outcome. The
separate standalone-read tuning pause remains in force.

#### Evidence and challenged direction

The complete paused measurement has 89 exchanges for standalone Medusa and 58
for mixed workflow, including 38 implicit reads and 41 checkouts. Its diagnostic
checkout wait is small; the checkout count is not evidence that the pool is the
CPU bottleneck. Fresh current-source root-only inspector captures locate Effect,
Drizzle and value-contract work in both graphs, and physical-session admission
work in mixed workflow. Async ancestry, idle samples and inspector overhead keep
exclusive CPU milliseconds unresolved. Required membership and real point
permission before unseen bodies cannot be removed to improve these counts.

Source tracing identifies concrete unnecessary mechanics. Installed finite
commands already have fixed SQL, native fields and result mappers, but each read
constructs a full-schema database view and starts another Effect runtime to run
its fixed callback. Atomic Commerce acquires and decodes head, activation and
candidate evidence for physical-installation inventory even in the all-logical
workflow, before the selected source acquires its genuine binding evidence. CMS
replays binding candidate/lane structure after Application admission and prepares
preferences outside its actual current generation.

Reject a blanket switch of ordinary mutations to query-required readiness.
Standalone atomic workflow already shares one complete proof across its selected
source union and one initialization receipt batch. Later sources still require
their fresh revocation, correlation and actual index/unique clock observations.
The existing compact writer profile cannot replace the concurrent-reader proof.
Likewise, framework preferences have sixteen mutable evidence families outside
Application epoch protection; cached preference acceptance is insufficient.

#### Selected contract, owners and replacement

1. At the existing physical-session owner, replace the installed finite callback
   read API with a private fixed native command operation. Carry the existing
   compiled statement, ordered fields, mapper and native name; bind fresh values
   and prepare against the actual checkout's native NodePgSession. Acquire only
   that session and execute its Promise inside the existing bounded operation,
   without a full database view or nested Effect runtime. Keep the same fresh
   transport/startup admission, command fence, timeout, drain, release, cancellation,
   quarantine and complete Cause. Ordinary callback database/transaction consumers
   retain their views and lifetimes. Do not retain a connection or transaction
   across an untrusted callback, merge body permission stages or create a host
   lifecycle. Native placeholder codecs, parsers, array mode and backend statement
   preparation remain owned by the installed Drizzle driver.
   Preserve the original domain translation at the command's foreign rejection
   boundary: a native start throw or Promise rejection retains its native cause
   directly. The trusted physical composition supplies that translation; physical
   admission, deadline, drain, release and cleanup failures retain their existing
   phase evidence and complete Cause. Replacing the callback bridge must not add
   a physical phase wrapper to an already domain-owned native command failure.

2. At Atomic Commerce, shared source and binding owners, replace duplicate
   physical-inventory acquisition for logical roots with authentic selected
   evidence lent within the same transaction. Preserve the original required
   head/refusal frontier and physical-inventory validation for actual physical
   members. Borrow immutable validated binding/projection evidence only through
   its issuing owner and bounded scope; detach at escaping boundaries. Preserve
   complete initial source readiness, all actual live checks, source correlation,
   receipt order and outer settlement. Inventory callers before replacing clone
   contracts; ordinary TypeScript readonly alone does not prove immutability.

3. At CMS admission and current-generation construction, issue selected binding
   structure from the genuine Application target protection and lifetime. Warm
   admission retains the fresh head SHARE lock and uses that structure for
   candidate/activation/lane acceptance; explicit unprotected callers retain the
   complete canonical profile. Prepare preferences within the same genuine
   generation as the CMS schema and commit template. Preserve active-reference
   checks, refresh/disposal, content ownership and failure classification.
   Preference admission retains head-lock then fresh evidence command. Ordinary
   publication retains candidate:false acceptance, cleanup/hooks, authoritative
   database time and only then candidate locking/validation during lowering.

These corrections cross core command, admission and real standalone/mixed
consumers. No adapter-local cache, second authority, wider limit, new universal
query/transaction API or comparison engine is permitted. Their measurements
must decide the next responsible-owner correction or assess the complete
outcome, not end delivery after a few removed exchanges.

The ordinary publication command is another connected transport owner. The
standalone diagnostic expands one existing typed publication call to 659 scalar
parameters and observes about 25 ms for that dispatch; this does not isolate
parsing from execution. Replace row-by-row SQL expansion with native typed
column arrays and ordered unnest reconstruction of the same installed composite
arrays. Reuse Drizzle's native array encoder and the real column codecs; preserve
row-major encoder evaluation, expression-returning codecs, exact bigint/bytea/
JSON values, empty arrays, null composite positions and invocation-local values.
The installed function, typed tuple layout, acceptance stages, write/lock order,
refusal decoder and transaction remain unchanged. Remove the displaced scalar
tuple expansion, prove actual PostgreSQL/PGlite tuple equivalence and retain
real materialization/refusal proofs. Fewer parameters alone is not performance
acceptance; final complete native pairs assess this replacement together with
the command and admission cutover.

Quiet execution also requires completion at its existing diagnostic owner.
The current root-only profiles include Effect function construction, and the
installed Effect implementation allocates a call Error, stack closures and a
CurrentStackFrame update on every fn invocation even with tracing disabled.
Request-local fn definitions allocate a further definition Error. Replace only
the traced active Atomic Commerce/CMS and scope-clock wrappers with lazy
fnUntraced generators and the existing observeExecution policy using their
original names and caller tracing. Explicit SDK/caller spans, parents, annotations
and links remain; quiet calls construct no synthetic function stack. Original
typed errors, unexpected defects, interruption and complete cleanup Cause retain
their identities and order. Synthetic Effect function call/definition stack
frames are an intentional private diagnostic-contract break, not a claim of
stack-identical output. Cold preparation and unrelated maintenance wrappers
remain outside this correction. Do not invent a generic span for an existing
unnamed SQL adapter. The same correction covers the active shared binding
projection, selected-head/candidate/reference readers, canonical binding
restoration and source admission wrappers called by these requests. Protected
warm CMS admission still invokes at least nine of those named boundaries;
their module definitions are stable, but each invocation constructs another
synthetic call stack. Preserve their existing diagnostic names and all canonical
decode, native codec, revocation, charging and issuer failure positions. Leave
cold candidate/activation writers and backfill outside this request correction.
Validate diagnostics and actual consumer failure/lifetime
proofs as part of the connected cutover; sample counts do not establish exclusive
CPU or a performance saving.

#### Breaks, data disposition and cleanup

Replace the private implicit-read callback contract and migrate installed capture
and its lifecycle witnesses in the same cutover. Remove its displaced full-view
and runtime-bridge route. Change private binding evidence borrowing only after
actual caller and mutability inventory; do not preserve duplicate readers merely
for old internals. Move CMS preference construction into generation ownership and
remove the outer-host preparation. Retain explicit ordinary callback, unprotected,
full-readiness and physical-installation profiles because they have named active
consumers and different obligations. No application rows, revision/tombstone
history, journal/outcome formats, source identities or named durable data are
deleted or reset. Installed routine signatures, grants and migration integrity
do not change merely for the native command transport replacement; any later
necessary change must record its writer, post-wait snapshot and recovery contract
here before implementation.

#### Static installed placement composition

Status: owner-authorized connected replacement in progress; uncommitted.
The installed finite command is already prepared and named, but its placement
owner still formats a target command, resolves its routine and privileges, and
performs dynamic PL/pgSQL EXECUTE on every actual demand. Outer statement
preparation does not retain that inner parse/plan. The mixed trace contains 38
such implicit commands; its 1.574 ms checkout-await union does not establish a
pool-wait bottleneck. Removing this repeated program construction is a concrete
core correction. Its complete measured cohort still fails all five CPU and
latency gates and establishes no exclusive causal saving; the logical operation
and readiness correction above owns the next responsible-core work.

Replace the shared installedPlacementSource with one statically qualified
command compiled from the authentic existing paired installation issuer:

1. Check the actual control scope/deployment and its target namespace before any
   target invocation. Retain original login/role, endpoint/access profiles,
   distinct namespaces and actual positive bounded statement-timeout checks.
2. Invoke the target and control installation frontiers with their own local
   expected composite types in the existing namespace lock order. Materialized
   dependencies and conditional second invocation preserve each refusal and
   prevent a later helper from executing after an earlier refusal.
3. Only after both actual frontiers accept, invoke a narrow control-owned
   locked-placement helper. It independently authenticates its original caller
   and control runtime/installation policy, takes the scope and receipt SHARE
   locks, and rechecks placement after those waits. Reentrant control admission
   is allowed; no caller-supplied accepted boolean or serving verdict is trusted.
4. Apply the existing complete placement predicate and then the unchanged finite
   authority/session/readiness/body program. Separate VOLATILE database-time and
   serving-clock observations remain after session/build waits. Refused or
   missing stages must still produce the original refusal header and withhold
   every business body.

ControlRead intentionally lacks UPDATE; PostgreSQL SHARE locks require that
privilege. Therefore the narrow SECURITY DEFINER control helper remains the
lock owner. Do not grant raw control UPDATE, move privileged control locking into
outer SQL, add a target-specific routine registry, or accept a client-reported
installation gate. Reuse the existing paired static installation topology and
actual target helper grants. A missing static target helper/EXECUTE grant may
surface an earlier native backend failure; retain that failure and its full
Cause rather than inventing a second dispatcher to recreate the displaced
private dynamic-invocation frontier. Authentication, target selection and body
authorization remain fail closed.

The private dynamic placement routine is replaced and removed with RESTRICT.
Migrate placement observation, attempt entry/share/locking, renewal, settlement
and finite capture together through their existing shared source. Inventory the
new helper/type signatures, restricted grants, exact body/hash/volatility/
search-path verification and maintenance restoration in the installation owner.
Use the existing managed maintenance interlock for the structural migration;
retain all populated application rows, sessions, journals, revision/tombstone
history and durable outcomes. No host lifecycle or application-data migration
is introduced.

Writers remain scope creation, provisioning reservation/ready CAS, runtime-policy
and installation maintenance, and the existing guarded metadata-epoch writers.
Validate both namespace orders, original-role/grant refusal, missing/corrupt or
changed placement, provisioning CAS races, installation drain/replacement,
post-wait expiry/revocation/readiness, and bounded capture/permission ordering on
PGlite and ordinary-role PostgreSQL. The cancellation-probe Client constructor
remains per demand: it does not connect, and its configuration/foreign-failure
frontier has no approved host-lifetime replacement. Remove only the displaced
dynamic dispatcher; do not silently treat fewer statements as complete native
performance acceptance.

#### Approved correction: immutable metadata key reuse

The owner approves replacing repeated structural interpretation of internally
constructed metadata keys before further capture redesign. The exact demand
diagnostic distinguishes 26 different index ranges and eight different single-row
packets in the mixed workflow; an exact-demand SQL cache has no demonstrated
business-read removal there. Its client metadata comparison path repeatedly
constructs source-policy and index/unique keys even though their original
projection owns immutable semantic facts. Table and admitted access-family keys
already use that owner's retained templates.

Extend `finiteMetadataDependencies`' existing projection-issued key mechanism to
source policy selected through the table owner and to demanded index/unique
definitions. Migrate working-set consumption, native Application write/read
metadata selection and final participant validation together. Retain only present
finite admitted contracts; missing dynamic selectors remain fully decoded and do
not grow an unbounded prepared cache. Original projection disposal, root closure,
watermark agreement, dependency identity/semantic comparison and first-consumption
charging remain checked. Copied or foreign inputs retain complete structural
validation; immutable keys grant no live database capability.

Native Application selection carries each original projection with its issued
key into the existing root consumption owner. Keep the aggregate issuer validity
check and explicit entry/root watermark agreement after selection, before
consumption. Required-present refusal precedes recording or charging, including
an already recorded missing dependency. Preserve the original corruption error
mapping and table, closure, policy, index order; the aggregate remains entry
authentication evidence rather than a second immutable-key issuer.

Replace and remove the internal literal construction paths. Do not replace the
fresh capture/placement, authorization, post-wait clocks, readiness, retention,
rollback-only, final metadata/OCC or publication checks. This slice has no durable
data, schema, public API, transaction-lifetime or time-contract cutover. Compact
replacement-frontier responses, timestamp reuse, speculative body transfer and a
general capture cache are outside this approval.

Prove genuine/copy/foreign/missing/disposed key behavior, root closure and budget
first-crossing, distinct root/watermark isolation, activation rollback and
concurrent metadata change/ABA refusal. Run affected PGlite and ordinary-role
PostgreSQL owners and complete standalone/mixed consumers, lint/strict checks and
both final reviews. Repeat the complete matched native performance matrix with
sources stable across every lane. The existing CPU and latency acceptance gates
remain fixed; reduced interpretation counts do not establish complete acceptance.

#### Approved correction: fixed OCC demand-vector query

The owner approves replacing the current-index batch reader's repeated UNION
query structure with one fixed, bounded ordinal demand-vector statement. The
measured mixed workflow has 26 exact range demands in one query; PostgreSQL
planning dominates its execution. This correction removes repeated SQL structure
and permits physical-session plan reuse, without removing a demand or caching
storage results, authority, readiness or publication evidence.

Keep `consumeCurrentAppIndexPagesInTransactionEffect` as the owner of ordered
preparation and consumption. Preserve 32-demand and projected-output bounds,
scope resolution, empty sentinels, limit+1, key/row cursor ordering, exact
pointer/revision membership, envelope validation and per-ordinal body decoding.
Execute the successful prepared prefix before surfacing a later preparation
failure; an earlier consumer conflict must precede later malformed stored data.
All original transaction/freshness/metadata/authorization checks remain in place.

Compile the code-defined statement through the existing native read owner and
bind fresh typed scalar-record vectors to each actual checkout. The internal JSON
recordset representation keeps generic/custom cardinality estimates consistent;
array unnest permitted repeated custom planning in the default-planner witness.
Use eight static, one-time-gated predicate shapes inside that statement. A
nullable cursor filter discarded 10,001 memberships in the scale witness;
direct shape predicates preserve indexed end bounds and key/row cursors. The
seven fixed UNION separators do not grow with demand count. Nonselected shapes
must not scan memberships; do not substitute sentinel maxima or force planner
settings to obtain this proof.
Keep each selected pointer's revision lookup correlated and materialized using
all five existing keys. Unknown vector page limits otherwise allowed a generic
hash join to scan 12,004 revisions for one pointer. Preserve missing-revision
NULL evidence and all matching rows; do not mask corruption with an added LIMIT.
A content-derived prepared identity
retains no session or results and must not introduce another registry or host
lifecycle. Delete the displaced per-demand UNION builder; single-range readers
keep their existing shapes. No durable data, schema, public API or transaction
contract is replaced. Optional bounds must retain their original semantics,
including malformed stored membership, rather than assume sentinel maxima.

Prove parameter/ordinal isolation and failure ordering, bounded/empty/cursor
reads, rollback and concurrent range changes on PGlite and ordinary PostgreSQL.
Verify actual prepared execution and generic/custom plan counters with default
planner settings and representative index access, including variable demand
counts on one physical session. Run affected consumers, strict checks, lint and
both reviewers, then complete five-graph matched native CPU/quiet/database lanes
with stable sources and unchanged acceptance gates. Planning improvement alone
does not establish complete performance acceptance or resolve the remaining CPU.
The fixed-query candidate is implemented with bounded pointer/revision access
and reused physical-session planning. Complete native-relative CPU and latency
acceptance remains unmet on all five graphs. The owner explicitly requests this
correction be committed while the performance deliverable remains unfinished.
Retain all fresh
checks and measured demands; further work must follow demonstrated owner costs,
not assume that plan reuse resolves capture waits or client interpretation.

#### Approved refinement: shared demand-vector revision lookup

The owner requests further optimization of the fixed OCC statement. The eight
indexed predicate shapes currently duplicate the revision lookup and decoded-row
projection. Retain eight bounded, one-time-gated pointer selections, materialize
their selected union once per demand, then apply one shared correlated,
materialized five-key revision lookup and projection. Single-range and vector
readers reuse the same pointer and revision statement owners. No storage demand,
fresh check, public contract, durable format or schema changes; no result cache,
sentinel bounds, forced planner setting or database-function relocation.

Preserve ordered preparation/consumption, empty and missing-revision evidence,
all matching revisions, exact cursor/lookahead and first-failure ordering. Delete
the duplicated full-range branch construction within this refinement. Verify all
eight shapes, rollback and concurrent publication on PGlite and ordinary-role
PostgreSQL; prove default-planner reuse and selective large-range/history access.
Run both reviews and complete matched performance before reporting acceptance.
Smaller SQL text is a structural result, not evidence of lower client CPU.

The implemented refinement shares one revision lookup/projection across the
eight bounded pointer selections. Physical-session reuse and selective scale
access are proved for its 6,235-character statement. Overlapping genuine writer
commit/rollback and acquisition refusal preserve fresh validation and terminal
cleanup. The isolated complete native-relative CPU and latency gates remain
unmet for all five graphs. The owner explicitly authorizes committing this
correctness-proved refinement despite those failed gates; this exception does
not lower the gates or complete the performance deliverable. Active
commerce/relation changes are outside that measured baseline. Keep every fresh
check and demand; no complete CPU improvement follows from this structural cut.

#### Validation and complete delivery gate

Prove fixed commands execute through one physical lifecycle without exposing a
database view; preserve native results/codecs, synchronous preparation defects,
driver failure, cancellation, startup refusal, drain/release/quarantine failure,
escaped callback closure and original cleanup Cause. Prove binding/protection
authenticity, closed/wrong-generation refusal, legitimate CMS refresh, unprotected
corruption, physical inventory and complete source readiness. Run affected
PGlite and ordinary-role PostgreSQL owners and actual standalone/mixed Product,
Payload and workflow consumers. Keep budget first-crossing, packet decode order,
membership/point-before-body, liveness/revocation/maintenance, rollback-only,
concurrency, atomic publication and uncertain-outcome recovery witnesses.

After connected migration and removal, run affected regular strict checks,
source/compatibility guards, core/diff lint and both project reviews against the
stable owned checkpoint. Final-source complete native pairs for all five graphs
retain median added thread CPU <=16 ms and paired quiet median/P95 <=5/10 ms.
If these fail, continue correction at the real core owners; do not lower the
gates or commit an incomplete performance deliverable. Root owns final validation,
Git and resource cleanup; assigned workers own disjoint edits.

### Approved bounded client CPU corrections: row checks and relation factories

The owner evaluates two changes separately in the current checkout: repeated
canonical-buffer comparisons inside one synchronous row operation, and Medusa
relation helpers' named Effect definitions inside each population invocation.
The production choice retains every original row comparison. A future shortcut
must preserve mutable carrier and buffer getters, Proxy traps, complete foreign
capture, issuer/table identity, bounds and original failure/defect order, and
demonstrate a performance benefit. No unchecked entry point or cross-call
integrity cache is admitted.

Retain the relation helpers' named definitions outside population invocations.
Request maps, manager, filters and ordering remain invocation-local. Relation
reads, grouping, empty/null behavior, tracing, cancellation and cache lifetime
remain unchanged. Definition reuse establishes no measured CPU saving by itself.

Measure each correction independently against saved original implementations,
with native complete business roots, stable source/variant manifests and no CPU
profiler in counter comparisons. Retain actual pairs and uncertainty; structural
removal is not a promised CPU saving. Connected correctness, both database lanes,
strict checks, guards, lint and both reviews remain required. This bounded scope
does not establish complete native-relative performance acceptance; the existing
complete CPU/quiet gates and broader redesign remain open.
### Approved bounded client CPU corrections: query handoff and capture headers

The owner authorizes both corrections on the current checkout, measured
independently against saved originals. The production choice retains both
original implementations: neither isolated correction demonstrates a CPU
saving, and the combined observation does not separate from block variation.
Retain genuine header failure/defect-order regression coverage and the existing
resource/authority fixtures. A future handoff correction still needs complete
root CPU evidence. The existing source-bound read program
already retains immutable interpretation between find/count executions. Carry
its captured, charged, validated compiler through the trusted read frontier in
one synchronous Result preparation; consume fresh access metadata before every
selection compilation or reuse. Do not introduce a second predicate validator,
authority cache or early adapter validation. Foreign capture, budget crossing,
table checks, recursive query validation, pending overlays and complete row
validation retain their original order and checks.

Consolidate finite capture header acceptance using the same authoritative Schema
Result decoders, in their original order, followed by one Effect handoff. Keep
replacement-anchor validation, retirement branches, late timestamp decoding,
sequence/epoch comparisons and layout failure precedence. Every capture still
executes fresh database authorization. No stored result or serving verdict is
retained. Correctness in both database lanes, affected consumers, strict/lint
checks and both reviews precede retention. Complete matched native counter-only
roots determine each observed CPU difference; a structural dispatch reduction
does not prove a saving or satisfy the complete performance gates.
