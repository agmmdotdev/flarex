# Medusa Design Quality Refactor

Status: Q1/Q2/Q3 is complete for its approved refactor and bounded acceptance
gates. The separate [organization and reuse follow-on](02-organization-and-reuse.md)
is prepared; implementation waits for the completed Product workflow integration.

## Scope And Continuation

This plan owns the design-quality work from the seven-point architecture review.
It is distinct from [shared-storage completion](../shared-logical-storage/03-completion-plan.md).
Refactor progress means the construction, semantic ownership, composition and
query gates below. Module migration, structural migration retirement and hosted
activation belong to their separate plans. Do not resume the separately paused
shared-storage goal merely because these efforts share code.

The owner approved the connected Q1/Q2/Q3 refactor, required consumer migration
and cleanup, coordinated GPT-6 Sol reviewers at high reasoning, and completion
through validation, review and one scoped commit. The main thread owns edits and
Git; reviewers remain read-only. The [focused preflight](01-construction-semantics-and-queries.md)
records contract breaks, challenged alternatives and settlement corrections.

The owner requested the [follow-on cleanup plan](02-organization-and-reuse.md)
for simpler organization and reusable logic across existing and future modules
and workflows. It reuses the completed construction and receipt owners, groups
module-local responsibilities, reduces repeated adapter wiring and closes caller
migration/removal as one connected outcome. Its first gate is the other session's
completed, validated Product workflow handoff; no implementation starts from
partially integrated working-tree code. It does not reopen Q1/Q2/Q3 or the
separately scoped storage/performance work.

## Authority And Invariants

The [accepted design](../../design-notes/flarex-db-accepted-design.md),
[package boundaries](../16-package-boundaries.md) and local Medusa/Effect skills
govern this work. Postgres and the trusted outer execution owner retain
settlement, scoped authority, replay, recovery and publication. Native framework
semantics stay with their real owner. Necessary private API breaks are accepted;
affected consumers migrate without compatibility wrappers. No durable schema,
codec, identity or data-retention change is part of this refactor.

## Design Concerns And Implemented Disposition

| Concern | Current owner and behavior |
| --- | --- |
| Supported operations fail to compose | Native calls validate their own activity. Product, Pricing and Link no longer depend on singleton aggregate transcripts. Repeated calls and native child workflows share one atomic owner. |
| Receipts duplicate native business logic | Native Category service owns tree admission, rank and path behavior. Receipts enforce admitted footprint, selected identities, scalar results and events; shared core enforces storage authority and settlement. |
| Construction exposes internal assembly | Authenticated module construction binds exact commands, receipts and required capabilities. Installed instances contain only module and scoped logical storage; workflows select methods and compose business steps. |
| Queries assume small complete sets | Shared storage exposes separate indexed ascending pages, complete bounded selections and exact finite count/sum. Currency uses pages for its supported global ascending list; membership and count retain complete-set semantics. |
| Unsupported methods refuse inconsistently | The common scoped binder keeps omitted/unselected invocation sticky, including caught failures. Property inspection alone is inert. |
| Atomic subset grows into a universal engine | Atomic workflows remain finite database work. Terminal replacement seals subsequent calls/events. Durable pauses and external effects remain outside this host. |
| Compatibility is clearer than extension cost | Pricing, SalesChannel, ShippingProfile and Links use common construction without Product-specific host branches. Composite-key page tests exercise the shared query contract without another module integration. |

## Completed Delivery Packages

### Q1: Module-Owned Construction And Composition

`defineWorkflowModule` snapshots module policy in its existing authenticated
registry. The host admits exact selected command tokens and declared events;
callers cannot supply a parallel policy bag. Product's direct atomic policy also
binds exact native tokens, rejecting same-name counterfeit commands.

The common workflow host carries Collection replacement and derived Product
updates. Category work and its output snapshot precede terminal Collection work.
The private result explicitly reports requested membership, including requested
IDs absent from storage; it does not claim a post-settlement membership graph.
Committed membership is independently checked after execution.

Pending source inserts, updates and deletions compose with replacement. Shared
settlement validates original observations, coalesces overlapping pending rows
into one final change and streams untouched rows in bounded pages. Native event
attempts remain distinct from final row facts. Replay and rollback retain the
same outer owner.

### Q2: Native Semantics And Receipt Ownership

Category tree admission lives in the executing native fork before writes, with
sequential batch-parent semantics and fresh ancestry fields. The old adapter
input guard and receipt reconstruction of sibling rank/descendant paths are
removed. Native errors retain their Medusa cause through the existing framework
bridge; callers catching them cannot make the transaction committable.

Relation-only Product upsert has its own runtime-checked native command. Product,
Pricing and Link receipts consume call-local activity; the aggregate membership
transcript, relationship splitter and unused transcript schemas are removed.
The preflight contains the trust and rule inventory.

### Q3: Page, Complete Selection And Aggregate Contracts

A page requires an aligned declared index and ascending order. Its work includes
examined candidates and lookahead, not just returned rows. Pending rekeys and
deletions overlay committed entries; captured index windows and row observations
are rechecked before settlement, including empty ranges and pending frontiers.
Creation time and core row identity break equal business-key ties.

Complete reads still require exhaustion within resource limits before slicing
or returning a count. Aggregates require an explicit finite selection and use
exact decimal arithmetic with SQL null semantics. They share the complete-read
owner and cannot silently aggregate a truncated page.

This is a bounded contract, not arbitrary SQL support. Descending or unaligned
pages, multiple disjoint page selections, unrestricted aggregates, sparse
residual scans and excessive offsets may refuse. No budgets were raised. The
retained physical Commerce store implements its page port but explicitly refuses
logical aggregate support; the unused physical workflow-host branch is deleted.

## Extension Cost And Remaining Boundaries

For another supported native operation, its module owner supplies the command,
checked method inputs/outputs, event declarations and genuine receipt rules.
The workflow chooses methods and provides business composition. It does not
select a transcript validator, transaction, settlement callback or alternate
storage engine. An intrinsic business rule belongs in native code; a missing
shared invariant requires correcting its core owner.

Pricing's repeated native create calls and Link lifecycle composition exercise
this separation. Currency and a neutral composite-key fixture exercise shared
page behavior; bounded count/sum covers exact numeric aggregation. Inventory
reservations, pricing calculations, arbitrary aggregates and new module
capabilities remain separately approved work, not implied by these witnesses.

The affected consumers use the replacement contracts; displaced policy bags,
transcript algorithms and the unused physical workflow branch are removed.
PGlite and ordinary-role PostgreSQL proofs, both reviewer roles, affected
typechecks, source/provenance guards and lint govern this completed boundary.
Verification receipts belong in Git, not this roadmap. No Q1/Q2/Q3 delivery
package remains open; the broader integration and activation gates above remain
separate work.
