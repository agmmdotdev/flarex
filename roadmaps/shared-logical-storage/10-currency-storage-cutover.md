# Currency Through Shared Logical Storage

Status: in progress under the shared-storage goal's standing approval. The
native Currency live path, mixed atomic/workflow witnesses, and private
cross-framework announcement serve through shared logical storage. Other
physical commerce consumers still have separate cutover gates.

## Connected Outcome

Run the existing native Currency service, initialization and Category/Currency
atomic command over shared logical rows, indexes and constraints. Preserve the
framework's native code key, exact rounding/raw companion, defaults, timestamps,
soft deletion, query semantics and errors. Internal document identities remain
Flarex-owned; a native primary key resolves through a shared unique claim.

This is one implementation slice across the owning packages, even if its work
spans multiple sessions. Do not commit a helper-only prerequisite as completion
of Currency. Existing Product, Pricing, SalesChannel, ShippingProfile and Links
are named consumers of the retained physical commerce path; their removal gates
are their connected generic-storage cutovers in the completion plan.

## Evidence And Ownership

- The pinned Currency model is already checked and lowered by the Medusa schema
  owner. Its semantic relational schema needs no physical layout or deployment
  prefix. Keep that native metadata boundary.
- Logical candidate admission already authenticates definitions, namespaces,
  source ownership and stable table identities. It currently supplies metadata
  only. Build and activation must authenticate those same identities, rather than
  reconstruct an Application manifest or generate unused physical module tables.
- The existing index and unique catalogs own allocation, immutable definitions,
  builds and readiness. Their Application-only table assumptions must become
  exact source-bound table checks. A reserved namespace is not authority by itself.
- The CMS document working set already owns generic pending rows, point/index/
  unique dependencies and final materialization input. Separate those storage
  responsibilities from Payload configuration and admission. Preserve explicit
  CMS and commerce execution profiles and their own validation and error mapping.
- Commerce currently authenticates physical installation evidence and publishes
  relational facts. Move Currency's installation/readiness and initialization
  evidence to shared structural owners and contribute generic row changes to the
  existing finalizer. Neither its repository nor its seed loader may settle.

## Contract Changes

Replace Currency's physical layout/profile and installation-reference dependency
with an authenticated logical source and serving binding. Move every existing
Currency consumer, including the atomic participant and test composition. Keep
one Currency writer; do not retain a physical Currency fallback for atomic work.

Shared table preparation must carry the actual namespace and logical name from
verified schema evidence, and recheck them against the stable catalog before
writing definitions. Callers cannot substitute a table ID from another source.
Framework-specific admission must remain outside the reusable storage working
set, with transaction and lifetime identity checked at every entry and closure.

Intrinsic creation-time definitions remain table-owned constant metadata. Source
evidence is verified when preparing them; acceptance rechecks the stable table
identity, not the originating schema version. Unique bindings additionally pin
the schema artifact commitment. Neither preparation is fresh serving authority:
activation must separately verify the source, build and readiness requirements.

The native repository remains responsible for translating framework queries and
values. Core owns selective execution, pending visibility, constraints and
settlement. Do not silently narrow existing predicates, use an unbounded scan,
or put a second query/constraint/materialization engine in the adapter.

Catalog constraint names are shared definition identities, not Application
language identifiers or SQL names. Preserve native IDs without sanitizing,
truncating or hashing them; distinguish native key and index families in their
catalog names. Application retains its existing identifier and reserved-name
rules at schema compilation. Derive native unique specifications from verified
source columns/keys and preserve SQL null-distinct semantics. This replaces the
Application-only constraint descriptor type; existing names and canonical
physical specifications keep their meaning.

The initial native constraint compiler admits text/boolean unique selections.
Numeric spelling, timestamp-offset equivalence and integer signed zero need an
explicit shared canonical equality contract before their native unique keys can
be admitted. Ordered native selections admit text/boolean and the existing exact
decimal projection; unnormalized temporal/integer values are refused. A field
forced to actual null by its partial predicate is safe, including Currency's
active-row timestamp index. These refusals are capability boundaries, not reasons
to weaken native schemas or coerce values in an adapter.

The index commitment must include every physical field projection. The previous
ordered-index encoder omitted `valueFormat: exactDecimal`, allowing ordinary and
decimal ordering to share canonical bytes. Correct the encoder without changing
ordinary definitions. Previously persisted decimal definitions with the omitted
field fail evidence verification; do not reinterpret them as valid generations.
Their affected builds/bindings require regeneration and rebuild or an explicitly
approved development reset. No durable catalog rows are silently rewritten.

Fresh test installations may use the new contract. Removal of named durable
physical tables or initialization records requires an explicit data disposition;
this slice must not silently delete or reinterpret retained production data.

## Structural Preparation And Owner Corrections

The source-bound catalogs and generic working set support the selected Currency
execution path. Shared preparation lowers the complete configured source set's
ordered-index and unique requirements. Native value validation and serving
readiness are checked separately; unsupported foreign-key relationships remain
refused by the scalar profile.

- `loadPublishedPhysicalRequirementSnapshotV1` reads authenticated logical-source
  requirements as well as Application manifests. The existing reconciliation
  owner requires exact catalog bindings and declares/replays the complete index
  set. Application activation still requires its actual Application validator;
  a logical candidate cannot stand in for that authority.
- Logical document sources require explicit `uniqueConstraints`, including an
  empty array when there are none. Payload's producer supplies these declarations
  using the same translation as current Application publication. Missing intent
  is rejected rather than inferred from policy evidence or existing catalog rows.
  This breaks older candidate artifacts: regenerate them through their producers;
  do not default missing requirements to empty or silently rewrite durable data.
- Readiness must cover the complete configured candidate, including declared
  absence and native dependencies. Never discard a Product requirement that
  remains unsupported to serve Currency under the same candidate. Product's
  ordered and unique definitions now prepare, but its relationship/row/query
  execution still has a separate cutover gate. Deployment composition may select
  an actually configured independent module set; it may not drop requirements
  inside an authenticated source. Existing physical Product consumers remain
  under their named cutover gate, not a generic-storage fallback.
- Private Medusa integration composition explicitly captures its configured module set.
  Currency-only and Product-containing candidates are distinct artifacts, even
  when their stable Currency table identity is shared. Unsupported requirements
  in any included source refuse preparation before catalog mutation. Completing
  Product index/unique preparation does not establish relationship or serving
  authority.
- Unique-set closure preparation verifies the complete logical source set,
  including stable descriptor identity and exact physical requirements. Missing,
  extra or contradictory bindings cannot be sealed as a complete set. Closure,
  build progress and eligibility retain their existing shared owners; there is
  no native-only constraint builder. The read path continues to verify the sealed
  member commitment without introducing full source hashing on every claim read.
  Serving activation must bind this structural evidence to the authenticated
  source and fresh execution authority.
- `prepareApplicationDocumentParticipant` retains Application schema, relation
  and candidate-write authority, then delegates to shared logical materialization.
  Native admission must still supply an equally exact source/table/value contract
  and fresh serving authorization before borrowing the publication transaction.
  The shared materialization kernel receives mandatory semantic admission
  and write-validation gates from its trusted participant; it issues no serving
  grant itself. Admission is required at entry, contribution preparation and
  lowering. The Application-named internal participant error is replaced by
  the shared materialization error, including CMS/composite catches and fixtures. No optional
  Application guard, fake manifest or compatibility error alias is introduced.
- Row-local value validation is prepared from authenticated relational sources
  and their stable table bindings. The retained physical Commerce store and
  generic logical documents share scalar/JSON value rules; complete logical
  rows also require every declared column, reject extra fields, enforce local
  check constraints and compare declared exact numeric companions. The same
  complete-row validator serves native reads, writes and materialization admission.
  It does not substitute for foreign keys, framework input precision,
  lifecycle normalization, defaults or fresh serving admission. Source-bound
  validation replaces placeholder semantic gates in the native storage witness.
  Numeric inputs use the existing exact-decimal range contract while retaining
  their original representation. Out-of-range exponents and trailing line
  terminators now fail typed value validation before either storage path; no
  durable row is normalized or rewritten by this preparation.
  Canonical timestamp transport is restricted to ISO years 0001 through 9999:
  year zero and JavaScript's signed expanded-year strings previously passed the
  lexical check but were rejected by PostgreSQL casts. Logical storage now refuses
  them at the same shared value boundary instead of depending on a physical column.
- Structural readiness reuses the shared required-index gate also called by
  Application revision readiness and the existing closed-unique eligibility owner.
  It prepares the complete authenticated logical candidate, then inspects current
  build fences, lifecycle and snapshot coverage under the accepting transaction's
  scope clock. A missing or stale Application/Payload member blocks the candidate,
  even when Currency's own members are ready. This is structural evidence only:
  the existing binding owner must still select the exact schema/digest and enforce
  framework capabilities, Application analysis correlation and initialization.
  No second activation head, readiness receipt store or framework builder is added.
- The shared binding host now pins an explicit logical
  schema ID and artifact digest in its existing canonical candidate. Its configured
  preparation authenticates catalog requirements once on first use; prepare, activation and
  current admission inspect live structural readiness under the existing scope
  lock and compare the candidate's full Application analysis commitment with the
  accepted active selection. Recovery retains the original activation receipt
  while reporting current unavailability separately, including after restart
  when logical catalog preparation fails. Only successful immutable preparation
  is cached; a failed preparation can recover without rebuilding the host.
  There is no second head,
  activation request, transaction owner or native-only readiness store.
  The internal binding format now requires `logicalSchema`, explicitly null for
  retained physical consumers. Old development-only binding frames must be
  regenerated; there is no default reader, data rewrite or implicit selection.
  A logical selection does not grant a framework execution profile, initialize
  native data, or authorize candidate relationship semantics. Those gates stay
  with the accepting execution owner and must land before native generic serving.
- The native Currency live fixture, Category/Currency atomic cases, and
  Currency/Payload/Application announcement select the shared logical source.
  Preserve the existing request outcome and outer settlement owners throughout
  their cutover.
- The existing commerce host now has a source-bound logical selection. It uses
  the current logical binding, shared participant and same request outcome and
  finalizer as physical consumers. A generic scope/source/step initialization
  receipt is written with the 123 seeded rows and outcome; normal commands
  require that exact source, contract and dataset. A changed source refuses
  automatic reseeding. The connected native Currency host path proves refusal
  before seeding, replay, reads, writes and late receipt-conflict rollback.
  Standalone physical/logical and retained atomic Commerce requests acquire the
  same exact-key exclusion before scope admission; a held-callback PostgreSQL
  witness observes the matching advisory waiter and proves one callback for
  concurrent replay. Logical host preparation charges its captured source,
  structural requirements and hidden unique preparation to the retained-host
  budget. Initialization metadata is captured immutably before hashing and
  remains the same data used for receipt validation and publication.
  Retained physical Commerce consumers and durable data disposition still
  govern physical profile retirement. The
  source receipt is a durable first-data contract, not a second structural
  migration engine.
- Native relational source selection borrows the root transaction and existing
  binding head. The source contract supplies its actual compiled schema, write
  profile and provenance; these must exactly match the selected candidate before
  callback-scoped source admission is issued. Application projection and analysis
  correlation share the same validator with binding activation. The admission
  confines row-local validation and pending work to that source's stable table
  bindings and expires on callback completion or failure. It grants no separate
  transaction, publication, lifecycle or initialization authority. The scalar
  execution owners below supply row/query behavior; the remaining native
  consumers must use this admission and finalizer before Currency's physical
  path can be removed.
- Native text-primary-key reads reuse the same working-set dependency, unique
  slot and ordered-index owners as document reads. The shared relational profile
  admits key membership, AND/OR, null checks, primary-key ordering, projection
  and pre-pagination counts. Finite key domains use unique/index selections;
  unrestricted domains require a declared ordered key index. It never substitutes
  a catalog scan when the declared access path is unavailable. Pending updates
  participate before filtering, ordering and counting, and projection cannot hide
  an invalid complete native row. Native Currency's existing read-plan compiler
  supplies the actual contract; the adapter does not aggregate document queries.
  Complete membership/count still consumes the shared identity budget. A small
  page over an oversized unrestricted result fails rather than truncating its
  count; this is not arbitrary-cardinality pagination or a scalability claim.
  Other relational predicate families remain gated until their indexed semantics
  are implemented. Native Currency lifecycle, publication and initialization now
  use this selected path; the bounded read alone grants no physical fallback.
- Scalar relational execution replaces scalar-table SQL defaults and
  key-based mutations with operations on the existing shared working set. The
  source supplies its authenticated table and persistence capabilities. Defaults,
  managed timestamps, complete values and exact numeric companion consistency
  belong to the shared relational owner; native input coercion and precision
  remain with Medusa. Database time is read from the borrowed transaction, not
  supplied by the adapter. Insert/update/upsert/delete and soft-delete/restore
  preserve pending reads, unique-key reuse and one closed pending change set.
  The existing command context depends on the row-operation contract rather than
  the physical store factory. The actual Currency service and DAL execute through
  this contract, including caught invalid-batch refusal and rollback-only closure.
  Missing update targets do not bypass supplied-field validation; projections
  validate complete values and exact companions. Native table and capability
  selections are captured before admission yields, so caller mutation cannot
  change the request's rules.
  Initialization and publication use the existing host and finalizer. Tables
  requiring foreign-key/cascade enforcement remain refused by
  this scalar write profile until their existing relationship owners are wired.
- The shared document participant admits at most 128 aggregate unique transitions,
  aligned with the core material-row ceiling, and at most 256 release/claim actions.
  Multiple constraints consume that same budget; 65 rows with two constraints
  exceed it. Ownership authentication and mutation use bounded 32-position
  statements within the borrowed transaction. The complete 123-row Currency seed
  fits this storage contract, including index maintenance and late-failure rollback.
  This kernel proof does not establish native initialization admission, outcomes
  or recovery. Preserve atomic initialization rather than splitting it into
  separately committed chunks or bypassing shared limits inside the adapter.

The remaining execution corrections belong inside this open slice. They do not authorize a parallel
framework installer, per-source settlement engine or metadata-only completion.

### Native Contribution And Publication

Connect the actual Currency command to a source-confined logical participant and
the existing commerce finalizer. The participant owns pending row operations,
one-shot closure and dependency/value validation. The outer root alone acquires
publication exclusion, allocates the commit and publishes rows with the retained
request outcome. Source admission, transaction and lifetime must remain valid
through lowering. Do not put a settlement helper in the native adapter or tests.

The finalizer input explicitly distinguishes generic row contributions from the
physical facts still required by named remaining commerce consumers. Update its
callers directly; this is not automatic fallback or a second Currency writer.
Mixed participant capabilities require the combined owner and a joint binding;
the atomic owner now accepts logical and physical members under one request.
The connected witness exposed an Application-only coverage assumption: native
definitions can be ready under the logical binding while the independent
Application head maintains a different definition set. Shared materialization
selects an explicit publication profile. Application publication keeps its
required maintenance suffix. Source-bound publication refuses any borrowed
Application maintenance claim, checks exact enabled coverage and advances its
own selected build frontiers under the publication transaction. It never erases
the real Application head or substitutes a no-head context after refusal.
Concurrent admission must retain only lifecycle-compatible key-share locks on
mutable build rows. Read each build frontier before refreshing the clock used
to validate that frontier; retain the original admitted snapshot for coverage.
Application readiness validation reuses the accepting transaction's already
locked clock instead of acquiring a stronger share lock while a command may
later enter publication. The root still rechecks the scope clock before
allocating one commit. Two disjoint native commands must both pass admission
before either settles and then commit on ordinary-role PostgreSQL without a
lock-upgrade cycle. This is a correctness gate, not a throughput claim.
A separate tracer-at-entry overlap can let publication race with unfinished
source admission; a root-parallel run timed out during row-revision insertion.
The current barrier proves two fully admitted commands settle, but does not
identify that timeout's cause or establish the incomplete-admission race.
Investigate that interleaving before claiming general concurrent-admission
capacity.
Committed native reads, caught failure refusal, late publication rollback and
retained outcome lookup are covered on both database engines. Currency
initialization and its named host/atomic consumers now use the selected source.

## Remaining Connected Cutover Preflight

The real Currency service suite uses the authenticated logical candidate,
closed index/unique catalogs, selected binding and logical host. Its native
and upstream-compatible cases inspect generic rows, derived index/unique
state, logical source receipt and the same commit/outcome/wake authority.
The private announcement has completed its selected-source replacement proof;
remaining physical consumers and durable data disposition govern retirement.

Atomic Commerce now accepts an explicit logical-source member in participant
preparation, request identity, admission traversal, event capture, working
stores and the shared finalizer. Its focused joint-binding witness runs logical
Currency beside a retained physical Product profile on both database lanes.
The member's exact source, write profile, schema version and initialization
receipt are checked before a callback, with the same prepared logical admission
and row working set as standalone Currency. Configuration owns participant,
source and event selections before its first authority lookup. The request
identity includes the logical source and contract commitments, and all members
authenticate one scope, binding head, transaction and request lifetime. Acquire logical
structural readiness before physical installation publication locks in one
deterministic order. A single root finalizer lowers logical changes alongside
retained Product facts and admitted events, then publishes one outcome, commit
and clock advance. The joint-binding witness proves replay, unused logical
participants, event-only publication and rollback after the mixed publisher
  writes its outcome. If a command catches a participant refusal or defect while
  another logical member is unused, the root still seals the request and retains
  the original full failure cause; no physical write or outcome survives. The
  live Currency fixture and native Product/Currency workflow cases have moved
  to logical Currency. The broad atomic suite has been replaced by connected
  logical Currency witnesses; the announcement also uses the logical source.
  Product's physical profile remains until its own cutover.

The logical host also proves lost-COMMIT acknowledgment recovery and native
Medusa list/count calls on both database lanes. These and the generic atomic
owner are connected evidence, not completion of all Currency consumers.

The native Currency live runner now composes the real joint candidate, builds
its shared indexes and unique set, activates the existing binding and initializes
the 123 rows through the logical host. The upstream-compatible service cases
and live lifecycle, replay, boundary, rollback and lost-acknowledgment checks
execute against generic rows on both database engines without installing a
physical Currency table. The displaced live physical fixture and its single-use
physical storage/publication scenarios are removed. A connected native
Category/Currency command suite now extends that logical binding with the
retained physical Product profile. It proves one commit, generic Currency row
changes, actual Product rows, replay and late cross-participant rollback;
captured native calls, pending cross-module graph reads, caught refusal,
shared query limits and cancellation also run on that mixed binding. The
displaced broad atomic suite's fact-projection, native Application journal and
Product layout checks have moved to neutral core and logical Currency/Product
witnesses. The private announcement now selects logical Currency. Remove the
physical profile and installation path only after their other consumers and
durable data disposition are verified.
The shared native workflow host now accepts a module's logical source selection
and passes it to the existing atomic owner. A native Product-tag workflow uses
logical Currency and retained physical Product in one binding: its hook reads
Currency and pending Product tags, publishes one outcome and ordered events,
and replays without repeating the hook on both database engines. The full
Product-tag workflow suite now uses the same joint binding for its native
hooks, pending graph reads, event admission and delivery recovery, rollback,
replay, concurrency, cancellation and retained-history compaction. Its checks
read generic Currency rows and actual retained physical Product rows on both
database engines.
The Product-tag composition suite now uses that same selection for its real
create, update and delete child workflows. Its graph, event, rollback,
cancellation, replay, resource-budget, concurrent-root and core event-selection
cases run over generic Currency with physical Product. The replacement reads
authoritative logical rows and actual Product rows while retaining the event
and outcome checks; its old physical Currency fixture and installation
selection have no remaining consumer in that suite.
The Product-tag update and delete suites remain Product-only for their native
service behavior and no longer install physical Currency. Their shared binding
transition witness runs the real update and delete workflows across a
Product-only binding, the joint Product/logical-Currency binding and a
logical-Currency-only binding. It verifies request conflict after adding the
logical selection, Product refusal after removal, Currency availability,
restored binding state and unchanged generic Currency rows. A physical-only
binding preparer authorizes the temporary `logicalSchema: null` frame; the
logical-aware preparer authorizes reactivation. Neither is a serving fallback
or second settlement path. Retained Product tables remain the named physical
consumer.

The variant-images suite's shared graph-step case now uses the existing
Product/logical-Currency binding. The Currency graph and native Product variant
workflow run as separate roots in the same scope. The workflow changes real
Product image assignments while generic Currency rows remain stable; replay
preserves the exact inventory. The suite's native Product-only rollback,
cancellation, event and isolation cases remain on retained physical Product.
The physical Currency installation reference has no consumer in this suite.
Product's physical installation remains until Product's own cutover. Both
PGlite and ordinary-role PostgreSQL pass the native suite.

### Atomic Consumer Cutover And Remaining Cross-Domain Gate

The Category/Currency atomic suite now uses authenticated logical Currency
and retained physical Product under one outer settlement and publication
owner. Its connected proofs cover graph ordering/population, participant and
table authority, shared call/byte budgets, Product's physical statement cap,
overlap and cancellation, lost-acknowledgement recovery, publication-stage
rollback, original Product facts after binding movement, and real-PostgreSQL
new-connection recovery and scope-lock contention. Generic Currency changes
are inspected through shared row/change/index/outcome families; physical
installation facts remain Product-only. The 64-statement counter belongs to
physical commerce stores and does not count generic logical storage SQL.

The two-installation neutral core fixture validates every physical fact,
including one from a non-selected installation, before projection. The mixed
suite separately verifies Product's historical layout after binding movement.
The native Application overlap proof uses the Application fixture already
provisioning the same logical Currency scope: an admitted empty index-range
read is sealed and entered into finishing before the mixed Commerce commit,
then the real point-commit publisher settles the read-only native outcome at
the next scope sequence. The range dependency and terminal session payload
cleanup are asserted. The displaced physical-Currency atomic suite and its fixture
assembly are removed. Both database lanes must continue to pass these owners.

The private Currency/Payload/Application announcement now uses logical Currency
with selected Payload and Application contributions under one outer settlement
owner. The displaced physical announcement host and fixtures are removed.
Retire any remaining physical Currency profile/installer only after its other
consumers and durable-data disposition are verified. Product's physical profile
remains until its own generic-storage cutover.

### Private Announcement And Payload Admission Preflight

The retired announcement fixture built Payload `posts` and Application
`audit` through an embedded V3 Application write-policy manifest. The private
schema composer intentionally refuses that mixed manifest: it accepts an
authenticated Application analysis and independently compiled Payload and
Medusa sources. `prepareCmsApplication`, `withCmsAdmission`, CMS document
validation and the composite binding proof still derive Payload authority
from the embedded V3 policy and a physical Commerce admission. Merely changing
the announcement host's Currency profile to a logical selection would leave
its Payload side outside the selected joint candidate. This is a core-owned
contract gap, not a Medusa adapter mismatch.

The connected outcome is one selected logical candidate containing Application
`audit`, Payload `posts` and Medusa Currency; a private announcement must
borrow source-confined CMS and Currency participants, lower their changes under
one transaction and publish one commit, outcome and recovery decision. The
Payload owner must authenticate its compiled configuration/provenance, stable
table bindings, write policy and current readiness through the shared logical
catalog. The CMS document owner must validate against that selected source,
while retaining native Payload lifecycle and error projection. The opaque
composite proof must check the same transaction, clock and binding head for
both participants, without requiring a physical Commerce installation.

The existing Application participant cannot authorize the joint write by
including Payload and Currency table IDs in its Application-only schema guard.
The current native Application fixture exposes a legacy active selection even
though the selected joint candidate contains an authenticated Application
source. `readApplicationBindingPreparationInputs` refuses that selection, so
the announcement must not depend on the V3/CMS schema-preparation path to get
its Application validator. Prepare an Application source-bound semantic insert
capability from the active analysis and the selected Application table binding;
retain native document validation and confine its output to Application-owned
tables. The selected Application, Payload and Currency admissions must agree on
one head and schema version inside the request transaction.
Prepare one combined materialization delta from the three separately admitted
source table sets and their exact index/unique definitions. Each source retains
its own semantic write validator and source-confinement check; the shared
materializer applies all relevant gates before writing the combined row set.
The root publishes that row set and its single outcome after the combined
delta lowers. Reject duplicate table ownership and mismatched schema versions
before opening the request transaction. Do not publish independent deltas or
weaken the Application guard to accept framework-owned rows.

Break the current private `CurrencyAnnouncementHostInput.commerce` physical
profile/installation contract and the CMS admission assumption that Payload
write authority only comes from V3 Application policy. Migrate the affected
CMS and announcement callers to the shared source contract. The named V3
consumers are the Payload adapter composition/Local API conformance suites,
standalone CMS host scenarios and this announcement; each must move before
the embedded-policy admission and related fixtures are removed. Their current
behavior is regression evidence, not a reason to preserve a second serving
contract after cutover. Do not admit V3 as a second
logical-schema source, forge a Payload write policy from the adapter, or
introduce a second transaction/finalizer. Preserve the existing announcement
assertions for replay, rollback after each publication step, rejected
cross-owner writes, native Application overlap, PostgreSQL contention and
lost-COMMIT recovery. Add the selected-source and generic Currency row/index/
unique evidence, then run both database lanes, affected typechecks and the
required reviews. Remove displaced Currency physical fixture/profile/installer
code only after its last consumer and any named durable-data disposition are
verified; Product remains a separate physical consumer.

`logicalSchemaAdmission` currently refuses a fresh candidate over an active
V3 ownership baseline (`unsupportedOwnershipBaseline`), as the composition
test demonstrates. Use a fresh, independently compiled source fixture for the
new connected proof. The displaced V3 fixtures and runtime callers still need
an explicit cutover; neither reinterpret an active V3 binding as a logical one
nor silently delete its rows. Populated baseline conversion remains under the
separate migration gate. A development reset may be chosen only after its data
disposition is recorded, and the old V3 serving path can be removed only after
its named callers have moved.

Source identity, complete-candidate structural readiness, selected binding,
table bindings and index/unique location now have one shared preparation owner.
Relational Currency still supplies its own value semantics. The Payload compiler
now supplies one source contract to composition and admission. Payload source
admission authenticates its configuration and policy, while the CMS document
owner uses selected Payload tables for pending operations, contribution checks
and source-bound delta preparation. Until the relation owner is connected,
Payload source admission refuses native relationship declarations and any
cross-source extension touching its tables; scalar writes cannot silently skip
edge, target-liveness or delete-policy enforcement. A selected Payload source
now lowers a scalar pending delta into generic rows inside the transaction, and
a deliberate late failure proves the row rolls back on both database lanes.
The pending-delta witness does not publish a CMS outcome. The standalone CMS
host now has a selected-source path that uses its existing request, lifetime,
transaction and publication owners. Its scalar news proof commits a generic
row, reads and replays the outcome, and rolls a late materialization failure back
on PGlite and ordinary-role PostgreSQL. Legacy V3 CMS consumers retain their
own cutover gate; the private announcement has moved to the selected source.

The selected Application source now has a callback-confined scalar admission
and a source-bound insert participant that reuses Application's existing insert,
pending-read and closure mechanics. A joint-candidate witness checks its
binding head and schema version against the admitted Payload source, creates a
native `users` pending insert, and refuses a Payload table through the
Application capability. Preparation captures its authority coordinates before
asynchronous catalog work, and the participant refuses pending reads, closure
and consumption after its source admission ends. The witness runs on PGlite and
ordinary-role PostgreSQL. That participant witness alone does not publish a
combined cross-domain delta; the selected-source announcement now combines
the three admitted contributions under one publication lock.

The shared row/index materializer now accepts a selected mixed coverage profile:
Application-owned tables prove their active-maintenance suffix against the
active Application revision, while Payload and Currency tables prove explicit
source-bound build progress. The profile is derived from the admitted
Application table set, not a framework-provided table name. A native Currency
command, Payload document insert and Application insert now form one combined
delta in the same transaction. A late failure rolls all three rows and their
index/unique effects back on PGlite and ordinary-role
PostgreSQL. A private selected-source announcement now borrows one root lifetime,
closes the three source-owned contributions and uses the existing publication
owner. Its PGlite witness commits one three-row change, one outcome and wake,
with no physical Currency fact; exact replay does not rerun the command. Faults
at every publication step, forged receipts, refused source ownership, a caught
unadmitted event and a lost COMMIT reply leave or recover the exact durable
inventory on PGlite and ordinary-role PostgreSQL. The PostgreSQL witness also
checks scope-clock contention and a lost physical COMMIT acknowledgement on a
different backend connection; cancellation leaves no partial publication.
The displaced V3/physical announcement test has moved to the selected-source
host. Its native Payload Local API and Application OCC overlap witnesses join
the replay, rollback, contention, cancellation and physical-COMMIT recovery
checks. The old private host and its binding/participant scaffolding are
removed. Remaining V3 CMS callers retain their separate migration gate.

### Existing Logical Currency Fixture Evidence

The replacement fixture uses the established interruptible PGlite relational
session for cancellation tests and captures the shared row, index, unique,
build, app-row-change, outcome and initialization families for replay and
rollback comparisons. Native boundary assertions now exercise bounded generic
reads, caught refusal, cancellation and publication rollback. The live suite
also advances the retention floor, runs the shared commit/index/app-row history
maintenance owner, and verifies logical rows, unique claims and source receipt
survive initialization replay without another publication.

The native numeric-conversion boundary remains with Medusa. Generic exact
decimal storage admits compact decimal text up to its declared numeric range;
it does not apply Currency's finite JavaScript DTO rule. The live boundary
witness therefore submits extreme rounding through the actual Currency
repository and expects its native input refusal. Direct store access remains a
trusted adapter capability, not a user-facing Currency write path.

The first native caught-refusal witness exposed an outer Commerce lifetime
ordering defect: after a nested Currency write was refused and its error was
caught by the command, root output charging returned `closed` before the root
could seal and report its latched `rollbackOnly` plus original `invalidInput`
cause. The Commerce host now seals after the root command callback and before
capturing its returned value; nested callbacks continue charging within their
parent lifetime. The refused request must leave the complete logical inventory
unchanged on both database engines.

## Validation And Completion Gates

- Authentic native Currency definitions prepare shared catalogs without generated
  Currency DDL. Namespace/name mismatches, forged bindings and changed source
  commitments fail closed. Application/Payload catalog regressions still pass.
- The 123-row native initialization is atomic, idempotent and recoverable. Native
  list/retrieve/count, admitted repository writes, exact values, defaults and
  soft-delete/restore execute against generic rows and derived state.
- Pending reads and unique-key reuse agree with final settlement. A late error
  leaves no rows, claims, indexes, initialization evidence, events or outcome.
- Two shops remain isolated; indexed key work is independent of unrelated stored
  rows. Ordinary-role PostgreSQL proves contention and uncertain-outcome recovery
  separately from the fast PGlite lane.
- Category/Currency atomic execution retains one transaction and publication
  owner while Product remains a named physical consumer. There is no duplicate
  Currency storage path.
- Migrate fixtures and affected callers, remove displaced Currency exports and
  installation code, reconcile living roadmaps, run focused checks and both
  required reviewers, then make one coherent commit.

Advanced populated-data conversion, general framework upgrades, new Medusa
modules, developer APIs and hosted activation remain under their existing gates.
