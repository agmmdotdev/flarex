# Product Scale Preflight

## Status And Intended Outcome

Proposed after record 34; implementation is not admitted by this record.
Finish the two registered Product files by supporting the unchanged 1000-image
ordering case, bringing coverage to 56 originals with only the upstream
performance skip remaining. This is a shared-core resource-contract milestone,
not permission to remove limits or increase every existing profile's budget.

## Exact Source And Current Blockers

The pinned `products.spec.ts` test `should retrieve images in the correct order
consistently` creates one Product with 1000 images, retrieves its images twice,
compares complete results and asserts every URL and sequential rank. The
original `test update performance` is already skipped upstream and is separate.
The source authority remains fork `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

Current `commerceTransaction/model.ts` sets a 256-row catalog/fact bound,
64 calls/statements and local event messages, 64 KiB per row, 1 MiB retained
command bytes, a 10-second command deadline and a 1-second statement deadline.
The store checks total scoped table size, captured batch length, returned rows
and complete accumulated facts against that catalog bound. The Product value
and relation loaders use the same bound. Chunking a 1000-image input into four
writes alone cannot satisfy the existing contract: the final table, fact set,
event release and complete two retrieval results must also remain admissible.

## Proposed Coherent Slice

1. Measure the exact source scenario's input, hydrated rows, complete facts,
   result, local events, SQL count, retained bytes and elapsed phases on both
   drivers. Keep temporary measurement in test support and report each first
   rejected bound. Do not reduce the fixture or change the assertions.
2. Design an explicit trusted execution resource profile with independent
   per-statement batch, per-query result, transaction fact/event, catalog and
   retained-byte budgets. Hash any admitted resource contract while preserving
   existing profile identities and defaults. Capture concrete measured values
   and headroom before choosing the Product scale profile's ceilings.
3. Reuse the shared RETURNING envelope and transaction owner for bounded
   batches, complete facts and atomic publication. Keep one transaction and
   one acknowledged result; cancellation or a later batch failure rolls back
   every batch. No partial commits or adapter-side raw SQL.
4. Replace whole-table hydration only where measurement identifies it, using
   declared scoped parent/key selection and stable ordered relation batches.
   Preserve filtering/counting, rank order, complete serialization, deleted-row
   visibility and isolation. A bounded batch cursor is internal, never an
   undocumented truncation of the original service result.
5. Preserve actual Medusa message construction. Measure whether the unchanged
   subscriber emits scalar messages or an ID array, then budget its complete
   local release without suppressing events or activating durable dispatch.

The first implementation step after approval is the measurement and explicit
resource-contract design, followed by the shared kernel and adapter work in
the same milestone. A measured need to change deadlines requires its own
explicit decision; this proposal does not authorize an automatic increase.

## Acceptance And Test Cost

Prove the original 1000-image case and all 56 originals on PGlite and ordinary
PostgreSQL. Add focused boundary cases around the selected batch size, final
batch failure, cancellation, complete facts, stable repeated ordering,
cross-scope keys, oversized rows/results, and exact event release/replay.
Preserve lifecycle, Currency, old profile hashes and existing refusal tests.

Reuse one installed target per driver/process, serialize heavy setup and
validation, and run the expensive full suites only after focused changes pass.
Record setup and execution separately so fixture cost is distinguishable from
database command cost. Strict types, source/hash/browser guards, scoped lint
and both standing reviewers remain required.

No new business-specific core tables, migrations, stored Module Links, other
module suites, durable events, query sync, workflow execution, OCC migration or
public/production admission are included. This milestone closes the two-file
inventory, not all Medusa compatibility.
