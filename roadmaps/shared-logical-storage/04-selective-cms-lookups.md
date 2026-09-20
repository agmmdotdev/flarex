# Selective CMS And Payload Lookups

Status: implemented for CMS ID and complete flat unique-key equality and the
existing Payload ID/unique-text API. Ordinary indexes and commerce cutover remain
separate connected work in the active completion plan.

## Outcome And Preflight

Make supported ID and complete unique-key equality lookups independent of total
collection cardinality through actual CMS/Payload execution. The displaced
`find` only validated an ID before scanning the collection; even a declared unique
equality used the bounded whole-collection reader. Small results could fail
because unrelated rows exceeded the request budget.

Reuse the row point reader and authoritative unique slot/owner reader. Reuse
authenticated closed unique-definition preparation and fresh readiness, including
standalone reads; do not prepare a write participant merely to read. Definitions
are immutable host data, charged to its existing budget, never a readiness verdict.
Retained definitions use the shared closed-schema member bound; per-command
mutation-transition limits remain at materialization, not read-host preparation.

The document owner selects ID, complete supported unique-key equality, or the
existing explicit bounded scan for requests without a selective path. Once a
selective path is chosen, an error never falls back to a scan. No new planner
registry, adapter SQL, duplicated key codec or second transaction/lifetime owner.

Preserve current scalar equality, ID ordering, pagination/count, sparse key
meaning and full pending state. Unique lookup merges the committed slot's owner
with locally changed rows. Cached slot/point observations protect decisions,
including absence, and settlement validates them even if no final write remains.
An observed key keeps its decision after a subsequent scan. A key first queried
after a scan uses that captured working set, including local edits.
Concurrent slot/row capture disagreement refuses rather than accepting torn data.
Standalone reads remain repeatable-read snapshots. Broad scans retain their
existing bounds and table dependency; this slice does not admit ordinary or
compound Payload index declarations, generic commerce or new query operators.

## Breaking Changes And Cleanup

Supported ID/unique lookups no longer fail solely because unrelated collection
rows exceed the scan limit. Their dependencies narrow from whole-table scans to
the exact row and unique slot. Independent unrelated writes may therefore settle
without a false scan conflict; genuine key/row conflicts must still refuse.
Remove the unconditional scan from these paths and share slot/owner validation
with eager uniqueness. No physical schema, durable format, reset or public API
change is required. Retain the bounded scan only for named broad/unindexed inputs.

## Validation And Completion

- Real Payload Local API lookup/count/create/update on a collection larger than
  the CMS identity limit, with witnessed point access and no collection scan.
- Pending rename/delete/reuse, old/new key queries, pagination and exact counts;
  rollback and replay preserve rows, indexes, claims, facts and outcomes.
- Distinct-connection PostgreSQL absent/present unique decisions versus competing
  claims, owner changes and unrelated writes, with no hidden callback retry.
- Intervening scans cannot replace earlier key observations; first-time key
  queries after a scan preserve its view. Read-only preparation supports a schema
  containing more unique definitions than one mutation may change.
- Equivalent fast-driver behavior and existing CMS/Payload/reference regressions;
  current authority, prepared metadata and request-budget refusal stay enforced.
- Affected types, lint, both reviewers, roadmap reconciliation and one scoped commit.
