# Installation Evidence Graph and Step Transition

Status: implementation in progress under approved preflight 76. Records 82/83
complete trusted construction; this phase addresses the remaining graph and
execution algorithm. The [protected normal command](./85-protected-normal-step-command.md)
now replaces full reconstruction during step execution and claim progress reads.
Opening, finalization, uncertain recovery and explicit verification retain full
evidence contracts. This does not revive proposal 75, which still performed a
growing history read before every step.

## Current evidence handoff

Head restoration retains its authenticated ordered receipt prefix. Explicit
verification consumes that prefix and separately checks the complete plan receipt
inventory and catalog; event membership cannot hide unlinked or future receipts.

Event restoration assembles one attempt lineage graph and supplies its producer
evidence to receipt restoration. Exact digest occupant cardinality remains
checked even when a predecessor supplied the attempt. A compact ancestry index
follows actual issued predecessor edges, preserving fork rejection and applicable
traversal limits. Independent or nonmonotone evidence retains the original walk.
The index retains one position per node rather than an ancestor map per node.
The head supplies its exact selected attempt reference to that assembly and
consumes the resulting issued attempt and admission. This preserves sparse
histories without an attempt-start event and lets receipt ancestry use the same
lineage positions as the live head. A head without an event still resolves its
attempt independently. Head fields and canonical commitments remain checked by
the existing head restorer.

Terminal subjects share one fence-bounded receipt inventory per plan. The latest
referenced terminal authenticates that inventory; earlier terminals must match
their exact tail and producer ancestry and cannot omit an eligible earlier-fence
receipt. Shared receipt sequences and prefix positions avoid copying or scanning
the full prefix for every terminal. Independent array-based restoration remains
available to repository owners. Materializing an array from a terminal exposes
only that terminal's prefix. Publication restoration receives the issued terminal
and installation evidence, and still decodes and validates each actual stored
publication row through its existing owner.

This preserves the independent event-reader contract: its terminal may reference
receipts beyond its explicit step-completion subjects, and terminal/installation/
readiness subjects may exist without prerequisite events. Missing graph nodes are
resolved from actual stored references through their existing owner. It does not invent a new
event-membership requirement or weaken the head verifier's inventory checks.

The [shared receipt read graph](./86-receipt-evidence-across-event-and-terminal-subjects.md)
now retains plan-local receipt and dependency evidence through event subjects and
terminal prefixes. Terminal root inventory remains independent and actual reread
bytes/digests must match any retained node. Independent publication prerequisites
and admission subjects can still enter separate owner reads. Full work accounting,
final graph consolidation and removal of
displaced assembly remain open. The protected normal transition below is
implemented by record 85; normal restart and cold opening remain separate gates.
This handoff alone does not establish the complete linear-verification or timing
acceptance gates.

## Repeated work that motivated this phase

Before the handoff above, the collision-head restorer authenticated its event
chain and derived an ordered receipt prefix, then discarded that prefix after
projecting count/tail. The explicit verifier reconstructed it through the receipt
repository. Event subjects separately entered attempt, terminal, installation and
readiness restorers. Receipt working graphs shared producers within one plan,
while other subject routes repeated their prerequisites. The optional read-pass
memo remains no algorithmic guarantee.

Normal step execution additionally repeats those graphs during claim loading,
receipt corroboration, event insertion, head-swap preparation and post-write
restoration. Removing only the final duplicate prefix, or improving a memo hit,
cannot eliminate cumulative growing-prefix work.

## Evidence graph

Keep canonical decoding and authority issuance with their existing domain
owners. A full verification operation must retain and explicitly hand off the
graph it has authenticated: definition/admission, attempt lineage, receipts and
dependencies, events, terminal and publication evidence, then head consistency
and catalog. An already authenticated ordered prefix must not be discarded and
reconstructed through another repository simply to return the same evidence.

Resolve each actual root and edge once within that bounded read operation.
Keep exact storage identity, canonical bytes/digest, collision, plan, producer,
fence, sidecar cardinality and applicable traversal limits. Distinguish observed
rows from issued evidence. Actual references still have to match the selected
node; an ID/digest alone is not authority. Shared evidence is an explicit output
of its owner, not a larger opportunistic cache, caller-supplied checked flag or
generic proof registry. Failures and missing roots cannot become successful
graph entries.

Attempt lineage must be accounted for independently of step count. Do not build
a complete copied ancestor map for every attempt or rescan all receipts for each
terminal. Reuse the authenticated lineage/prefix relations while retaining
producer provenance and rejecting forks, future fences and wrong admissions.
Root inventories must still detect unlinked/extra receipts; event membership
alone is not complete stored inventory. Retain bounded transport batches and
existing canonical, additive and binding limits.

## Protected step transition

Use the existing prepared definition and collision head as the only current
progress owner. A normal command locks fresh progress, authenticates its exact
definition/attempt/fence/lease, reads the chosen step's direct completion
dependencies, executes its fixed handler and checks actual structure. Its
receipt, complete sidecars, event and guarded head advance commit atomically.
Validate actual returned/selected occupants and exact conflict behavior; do not
fabricate rows or hide failures in an adapter.

Native acquired-connection protection remains mandatory. PGlite remains the
explicitly functional-only factory in test support. No protection bypass, global
verified flag, second transaction owner or new persistent checkpoint is added.
Immutable prepared evidence does not replace fresh head/lease/fence decisions.
Only the target session owns settlement, cancellation cleanup and the distinct
excluded recovery session.

Integrate normal progress, finalization and uncertain recovery together. Initial
readiness publication and explicit verification require the complete evidence
and catalog proof. Takeover/recovery may perform a bounded full pass where their
existing evidence contract requires one. Normal restart reauthenticates the
definition and current progress; it is not an implicit audit of every event.
Privileged repair still requires quiescence/fencing and full verification before
reopening; this phase adds no online repair API.

## Retention and completion

Retain persisted identities, sealing guards, original receipt producers,
dependency history, canonical codecs and distinct publication/binding owners.
Replace recursive aggregate assembly with the explicit evidence operation and
replace normal growing-prefix execution with the protected transition. Delete
displaced private loaders, memo slots and assembly after tracing their remaining
independent consumers. Keep no comparison implementation or activation flag.

Neutral witnesses must measure rows/bytes fetched and nodes/edges verified for
increasing steps, fan-out, attempts and lineage, with optional memo capacity
exhausted. Preserve malformed/missing/extra/reordered evidence, unchanged digests
with changed bytes, wrong target/fence, conflict occupants, altered write results,
unlinked receipts, takeover, cancellation and uncertain-COMMIT regressions.
Prove metadata/DDL atomicity and ordinary-role protection on native PostgreSQL
as well as the functional PGlite lane. Report normal, restart, takeover and audit
work separately; bound memory and inspect indexed native query plans.

The actual Medusa module/link and Payload preference/content/lifecycle/delete
consumers remain the end-to-end gates. Record 74's unchanged seventeen-table
suite, alternating frozen baseline/candidate samples and censored-baseline rules
remain the minimum timing acceptance. ShippingProfile activation stays paused.
Affected checks, both scoped reviews, cleanup and a coherent commit are required
before retaining the completed replacement. Passing an isolated graph witness
does not complete this phase or establish deployment/scaling readiness.
