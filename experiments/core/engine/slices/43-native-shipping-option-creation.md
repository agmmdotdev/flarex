# Native Shipping Option creation through Core

Status **Implemented for the bounded ordinary creation profile. Paired database acceptance complete; wider native and hosted gates remain open.**

Flarex baseline `cb5eac43ed3b8c091547c8ec30c8bc354d19ae10`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`. Executing Medusa fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

## Independent challenge

- Current Core. All seven source compilers already exist: eight Fulfillment
  tables, six Pricing tables, two Region tables, two Stock Location tables and
  three stored Link tables. Reuse their Core schema bundle, native Store,
  dependencies, history and sole settlement owner. The existing creation test
  initializer installs twelve Fulfillment tables even for its ordinary branch;
  that convenience does not grant the ordinary workflow the wider graph.
- Accepted direction. Replace the complete ordinary
  [creation profile](../../../../roadmaps/flarexdb-framework-integration/preflight/138-native-shipping-option-creation.md),
  including validators, generated Type/Option/Rule writes, Region-aware Pricing,
  stored Links, pending-event cancellation and all four genuine retained
  callbacks. Prove the existing Core Location/Set deletion compositions' complete
  Link and Pricing closure. Their larger installed-deletion envelope remains
  distinct from the four-Option creation bound.
- Pinned Convex. Reuse first-original/final-write coalescing (`writes.rs:313–355`),
  pending index/tombstone overlay (`transaction_index.rs:277`), exact point/miss
  and consumed range/EOF dependencies (`transaction.rs:1188–1248`,
  `query/index_range.rs:218–252`), published/pending conflict validation
  (`committer.rs:959–975,1035–1046`) and durable revision predecessors
  (`committer.rs:1092–1097`). Ordinary recreation must allocate a fresh internal
  identity rather than reuse a deleted identity (`committer.rs:1640`). Stored
  outcome recovery precedes native callbacks. Convex ID validation does not
  assert target existence (`common/src/schemas/validator.rs:121–148`); required
  native FK timing belongs to the shared native constraint owner.

Cross-challenge corrected an important assumption: the public service is named
`upsertShippingOptions`, but this admitted generated-ID branch calls
`insertGraphRows` and ordinary Store `insert`, in Type/Option/Rule table order.
The selected grammar refuses supplied Option, Type and Rule identities. Rule
Batch's refusal of Store upsert modes therefore does not itself determine this
profile's statement-check policy.

## Semantic prerequisite

The pre-change portable root rejected missing Shipping Profile and scalar Type
only at final settlement. Following either creation with all four actual
retained callbacks instead succeeded and published internal facts. The genuine
native creation step and scheduler rejected both at the SQLite INSERT, before
returning a retained creation packet or entering the later inverse probe.
The pre-change portable creation call had no Profile lookup; its later
active-only Type hydration was not an existence assertion. Its receipt admitted
observed Type/Option/Rule rows without complete FK-target evidence.

Run valid forward/inverse controls, missing-parent forward and inverse cases,
reversed missing-target inputs, earlier missing Profile versus later invalid
Rule, and historical-but-physically-present parent controls. Preserve complete
Causes, native validation/SQL origin, actual callback inputs and publication.
Keep the original Drizzle undefined-relation refusal separate from the narrowly
corrected reference candidate already admitted by preflight 138. A native step
witness alone does not establish execution of the full seven-participant root.

Select the existing
[native reference checkpoint owner](../divergences/native-reference-checkpoints.md).
Authenticate complete actual same-call parent observations against actual
normalized write afterimages; accepting extra table names or earlier validation
reads is insufficient. Preserve business-validation precedence, sticky refusal,
final integrity, resource accounting and one settlement. Do not add adapter FK
logic, SQL, another transaction or native callback replay.

Native SQL also establishes Type0/Option0/Rules0 before Type1/Option1/Rules1.
The shared graph capture already traverses in this order but discards it into
table cohorts. Retain the captured insertion sequence in the shared graph owner
and select it for this native construction through the existing executor.
Do not introduce a module-name branch or alter other admitted graph and
reconstitution profiles without their connected challenge. Complete native Rule
validation must still precede every graph INSERT. The pre-change authenticated
portable FK evidence identified the first Option in either input order, with
origin `close`; do not claim a more precise SQLite within-row descriptor order
from its generic FK message.

The native step/scheduler traces prove the changed constraint and graph phases.
The full native SQLite composition loads all seven resources and executes an
empty root, but nonempty Link setup reaches the genuine MikroORM repository's
manager mismatch. This is a reference-harness limitation, not a successful
nonempty seven-participant native-root proof. Preserve that witness separately
and prove the complete translated root on both required database lanes.

## Ownership and retirement

The ordinary Core facade now requires the seven authentic source selections
and exact eight-table Fulfillment definition. The generic ordinary construction
and shared initializer are replaced. Explicit `Legacy...` construction retains
only these named consumers until their owning cutovers:

- Shipping Option update and deletion, and Fulfillment creation.
- Fulfillment creation's return and reference-detachment consumers.
- Reference detachment's cancellation, shipment and update descendants.
- Shipment's Delivery setup and Delivery translation descendants.

Keep reusable native commands, deterministic fixture data, input schemas and
resource/event helpers with their existing owner. Extract fixture data where
needed so the new Core proof does not import a retained Legacy runtime merely
for constants. Retain the already explicit Legacy Service Zone detachment
entry point with its named wider obligation.

The twelve-table detachment profile requires eager, operation-visible nullable
reference changes and causal target-deletion evidence. Existing terminal
set-null intent intentionally seals further source use and is not that
operation. Keep this wider mechanism with its Shipping Option/Shipment/Delivery
cutover; Task-backed Delivery remains paused. A fresh eight-table source has no
Fulfillment-to-Option edge and receives no authority for that wider behavior.

Implementation ownership:

- Policy worker: the creation command factory, contracts and receipt owner, plus
  their focused receipt tests. Select statement checks only for native Core
  construction and retain an explicit Legacy constructor for current consumers.
- Graph worker: shared graph capture/model/insertion and its focused owner tests.
  Preserve existing default/reconstitution behavior and use one executor.
- Fixture worker: shared deterministic creation fixture data, the new Core
  fixture and complete ordinary workflow suite, including the failing witnesses.
- Coordinator: exact Core/Legacy facade boundaries, retained initializer and
  caller migration, native resolver provenance, configuration, plan/divergence
  notes, promotion, final validation, reviews and scoped staging.

No Core transaction changes are required by this slice: the native construction
selects its existing statement checkpoint and dependency owner. The shared graph
owner retains and authenticates captured insertion coordinates, while its default
cohort and reconstitution paths retain their existing consumers. A newly
demonstrated shared-owner gap still requires coordinated correction there.

## Implemented behavior and limits

The complete creation root and all four actual inverse callbacks use the seven
Core sources on PGlite and ordinary-role PostgreSQL. Complete-array native Rule
validation precedes graph writes. Actual captured Type/Option/Rule insertion
order is retained; each selected statement authenticates its exact physical FK
targets against normalized afterimages. Missing parents fail before the native
call returns, including when later compensation would erase the temporary row.
Historical physical targets remain distinct from active relation hydration.

Coverage includes the maximum four-Option graph, retained inline Types, dismissed
Link history, native Rule/price/Region normalization, Manual-provider refusal,
scope and source authenticity, overflow, caught failure, pending cancellation,
callback lifetime, complete rollback, replay and uncertain-outcome recovery.
The retained creation packet contains actual created IDs and empty
`updatedPreviousData`; a forged packet cannot enter retained reconstitution.
The concurrent native price-refusal assertions preserve the complete original
failure, sibling/drain interruptions and rollback seal. The retained deletion
cascade case preserves the original unexpected Pricing defect by identity even
after native Link catches it; assertions inspect its full Cause, the exact Link
tuple and complete rollback rather than a lossy typed-failure projection.

Connected proofs cover Profile changes after observation and before the first
probe, complete installed Location/Set deletion with Link/Pricing closure,
retained Option update/deletion/detachment, the Rule Batch control and shared
graph/receipt contracts. Five pre-existing PGlite omissions are PostgreSQL-only
Location/Set race tests; all five execute on ordinary-role PostgreSQL. No new
case is skipped. Affected candidate typechecks, source/provenance/portability
checks, configured lint and both independent project reviews are required for
this checkpoint. Medusa adapter sources are outside configured Oxlint roots.

The wider twelve-table detachment/Fulfillment families and Task-backed Delivery
retain the named Legacy obligations above. This bounded cutover does not close
hosted activation, general providers/external effects, populated upgrades or the
complete core rewrite.

## Supplementary native reference

A separate genuine hybrid reference now reaches the complete nonempty seven-participant native root: four unchanged local Drizzle/SQLite modules and three native MikroORM/PostgreSQL Link services under dedicated ordinary roles. The unchanged control reproduces the known Query refusal. With only the already approved process-local recognized-undefined-relation correction, all thirteen full-root cases pass, including valid forward and all four retained inverses, inline Types, missing Profile/scalar Type before any retained packet or later inverse probe, reversed inputs, complete-array Rule validation precedence and historical physical parents. Native source/build files remain unchanged and no promoted Flarex implementation is imported. Per-case native handles and Link schemas close, both disposable databases/roles are removed and PostgreSQL stops. This supplements the preserved SQLite-only limitation and independent step/SQL-order witnesses; it establishes native behavior, without claiming cross-module atomicity between SQLite and PostgreSQL.
