# Executed Relational Read Evidence

## Status And Scope

Status: implemented for private logical call evidence.
This owns inert working-set activity for actual successful relational selections,
including empty results. Query planning, committed dependencies, transaction
profiles, settlement and native framework business behavior keep their existing
owners. [Call-local row observations](./62-call-local-row-observations.md) remains
the authority for which candidate row bodies a call used.

## Current Sources Of Truth

The accepted shared logical storage design governs authority. Implementation
owners are `logicalDocuments/workingSet.ts`, `rootEvaluator.ts` and the Commerce
activity projection in `commerceTransaction/logicalParticipant.ts`.
`finiteRootLocalWorkingSet.test.ts` and
`logicalRelationalReadEvidenceScenario.ts` own neutral evidence contracts.
The connected consumer is [Shipping Profile deletion](../flarexdb-framework-integration/preflight/127-native-shipping-profile-delete-workflow.md).

## Failure And Correct Owner

Deletion must query active Product Links for the requested Shipping Profiles.
Redirecting its genuine native repository call to an unrelated empty selector
produces no observed row bodies. An observation-only receipt cannot distinguish
that execution from a correct empty selection, and can miss the native blocker.
The same gap exists when a protected relation read is skipped entirely.

The working-set query owner now retains its admitted captured query, table
identity, total matched count and returned window count after actual successful
selection. A genuine empty query still issues evidence. Invalid or incomplete
execution does not issue success evidence. Existing charged input capture,
query preparation, indexed coverage and execution lifetime remain authoritative.
No second query, adapter SQL or synthetic empty rows repair this gap.

## Invariants And Trust Boundaries

Required `relationalReads` activity travels through authentic per-call cursors,
source filtering, aggregate snapshots and existing Commerce projection. Query
data is detached and immutable when exposed; it grants no storage, manager,
writer, finalizer or settlement capability. Counts are finite nonnegative safe
integers and returned rows cannot exceed the matched count. Root closure clears
retained observations. Existing call and charged-input limits bound issuance.

Consumers derive expected queries from the existing executing query compiler or
relation-selection helper and authenticate exact evidence before accepting
business results. Candidate row-body decoding and output/event correlation
remain necessary. Evidence of execution alone does not establish native result
membership or authorize mutation.

This includes endpoint Link lifecycle receipts: the same executing lifecycle
planner supplies the expected query, and complete history totals must agree with
the authenticated selected row cohort. Empty output without the required
selection cannot silently discard a native historical restore. Existing
Inventory Item and Shipping Profile Link consumers share this contract.

This replaces explicit internal activity shapes in connected callers and test
fixtures; no optional evidence default or parallel compatibility path remains.
The field is in memory. Durable dependency serialization, journals, schemas,
installation identities and existing committed outcomes retain their formats.
Application OCC and its Convex-facing developer model remain unchanged; this is
private framework call evidence, not a new Application transaction API.

## Correctness Gates And Limits

Neutral PGlite and ordinary-role PostgreSQL proofs cover matched, true empty,
zero-window and reused prepared queries, exact count/projection, multiple calls,
cursor/source isolation, replay, failure and detached query ownership. Native
deletion must refuse redirected or skipped Product-Link/Option reads while
retaining real inverse behavior. Regress other row-receipt and relation consumers.
No performance, arbitrary framework compatibility, populated schema evolution
or hosted activation claim follows from this correction.
