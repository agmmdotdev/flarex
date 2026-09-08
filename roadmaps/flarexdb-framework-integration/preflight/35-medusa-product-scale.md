# Product Scale Preflight

## Status And Intended Outcome

Approved for measurement and bounded resource-contract implementation by the
owner's 2026-09-08 continuation after the shared transaction/committer work.
Implemented privately: the two registered Product files now support the unchanged
1000-image ordering case, with 56 originals passing and only the upstream
performance skip remaining. This is a shared-core resource-contract milestone,
not permission to remove limits or increase every existing profile's budget.

## Exact Source And Initial Blockers

The pinned `products.spec.ts` test `should retrieve images in the correct order
consistently` creates one Product with 1000 images, retrieves its images twice,
compares complete results and asserts every URL and sequential rank. The
original `test update performance` is already skipped upstream and is separate.
The source authority remains fork `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

The original `commerceTransaction/model.ts` sets a 256-row catalog/fact bound,
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

## Post-Transaction Baseline (2026-09-08)

The unchanged admitted suites were rerun from `6d689569` with the concurrent
installation-acceptance worktree changes present. Currency passed 19 PGlite
checks and 18 PostgreSQL checks with one PGlite-only skip. Product passed all
55 admitted originals on each driver; the unadmitted scale case and original
upstream performance skip account for the other two registered cases.
Runner elapsed seconds: Currency 34.592 / 26.894 and Product 264.197 / 203.016
(PGlite / PostgreSQL). These include setup and are not command latency figures.
Receipts: `C:/Users/Admin/Documents/Codex/2026-09-08/ok-n/work/validation/`
`modules-baseline-{currency,product}-{pglite,postgres}.log`.

The pinned Product inventory additionally has eight unregistered integration
files: module-service categories (21 test declarations), collections (18),
options (13), tags (15), types (13), variants (15), plus internal product (23)
and product-category (31). These are static declaration counts, not executed
coverage or compatibility claims. Admission needs a separate method/assertion
inventory against the actual adapter. The two registered files have 22 event
and 35 Product declarations; this milestone remains limited to those files.

## Implemented Resource Contract And Measurements

`prepareLocalProductScaleProfile` opts into a captured, hashed resource contract.
The original Product and Currency profiles retain their exact contract encodings,
hashes and defaults. The explicit contract uses encoding version 6; command data
cannot select it. Authenticated contexts expose the frozen limits to adapters.
The write-envelope compiler is retained per authenticated profile descriptor.

| Dimension | Original profile | Explicit Product scale profile |
| --- | ---: | ---: |
| Scoped catalog rows / complete query rows | 256 / 256 | 2048 / 2048 |
| Insert/update rows per SQL statement | 256 | 256 |
| Transaction facts | 256 | 2048 |
| Local event messages / IDs in one message | 64 / 256 | 1024 / 256 |
| Lifetime calls / store SQL statements | 64 / 64 | 2048 / 64 |
| Retained command bytes | 1 MiB | 4 MiB |
| Foreign value traversal nodes | 8192 | 32768 |

Row size remains 64 KiB. Command/statement/lock/cleanup deadlines remain
10 s / 1 s / 500 ms / 2 s. Filter complexity and operand ceilings are unchanged.
Delete/lifecycle operation inputs and relation predicate operands remain bounded
at 256; no truncation substitutes for a refused larger operation. This milestone
proves the two-file inventory, not unrestricted operations on 2048-row graphs.

Both initial driver runs refused the same complete graph: 1005 rows comprising
one Product, option, option value, variant and variant/value pivot plus 1000
images. The first refusal was the original 256 graph-row limit. The first
candidate then exposed the event/call ceiling. The actual pinned subscriber
emits **1004 scalar-ID messages**, not one grouped 1000-ID event. The new contract
admits those exact messages without regrouping, dropping or durable dispatch.

The unchanged PGlite case's observed request lifetimes were approximately
1090 ms for create, then 182 ms and 159 ms for the two reads, with respective
retained-byte ledgers of 951622, 462176 and 462176 bytes. These are bounded-owner
measurements, not process RSS or complete service-call latency. The deterministic
matching 1005-row receipt fixture measured 20030 input bytes, 231517 result bytes
and 233784 bytes for the stored image-row JSON. Its exact 1005 facts and 1004
events are asserted. Faker text and timestamps make original-case byte counts
vary slightly. The selected byte/node ceilings leave headroom for complete
capture/serialization while preserving independent row, event and call refusal.

The final telemetry pass resolved Drizzle from the persistence package so it
observes the same pnpm peer instance as the executing store. Both drivers recorded
25 awaited Drizzle queries during create and four during each ordered read.
These counts cover the request lifetime, not transaction setup/settlement SQL
or schema installation. The PGlite pass measured 1571 / 177 / 177 ms and
951768 / 462228 / 462228 retained bytes; PostgreSQL measured 1211 / 180 / 147 ms
and 951798 / 462274 / 462274 retained bytes. Installation plus cold open was
72823 ms / 54639 ms (PGlite / PostgreSQL). These are diagnostic observations,
not a performance admission or controlled benchmark. Receipts:
`modules-scale-measured-pglite.log` and
`modules-scale-measured-postgres-serial.log`.

A PostgreSQL measurement attempt overlapped final compiler checks and failed
in fixture setup with SQLSTATE 53200 (`CachedPlan` allocation); both compilers
also reported out of memory. No test ran in that attempt. The isolated
PostgreSQL retry passed unchanged; final compiler checks were rerun serially.

Insert/update groups execute in bounded consecutive SQL batches and retain the
complete ordered result and fact set under the same root transaction. Each
RETURNING envelope measures the actual post-write scoped catalog. A later batch
failure or cancellation rolls back all earlier batches. No shared publisher,
journal, schema, migration, durable dispatch or deadline was changed.

## Validation And Follow-on Scope

Full Product gate: 56 passed, one original upstream skip on each driver.
Runner elapsed seconds were 248.888 PGlite / 202.340 PostgreSQL, including
installation. The focused scale gate also passed the unchanged original plus
eight checks: complete facts/events and replay; 255/256/257-image boundaries;
final-batch rollback; cancellation; oversized result; oversized row/graph.
The final-batch fixture proves one SQL batch completed before the second failed
and then compares all business/publication state with the pre-command inventory.
A separate SQL-envelope test proves a 1001-row scoped catalog is unaffected by
3000 rows in another scope. Resource tests preserve old hashes and reject invalid
ceilings or unknown deadline fields.

Currency's final live lane also includes the unchanged Currency/CMS/Application
composite assertion body: 20 passed on PGlite; 19 passed and one PGlite-only skip
on ordinary PostgreSQL 18.3. This relocation repaired an existing source-owner
violation from `e334261d`: the test now resides with its Medusa adapter imports,
retains its original persistence compiler project, and is checked explicitly by
adapter build/typecheck. Production adapter strict indexed-access checks remain.
Its test driver follows the selected comparison configuration before the generic
fixture environment. The promotion manifest's stale Currency composite hash was
also corrected against the exact already-committed source, without changing it.

Other checks: 7 resource/profile tests; 47 adapter query/value/schema tests;
7 PostgreSQL envelope tests and 6 PGlite tests plus one native-only skip;
38 source guard tests; strict package typechecks; source/hash/browser gates;
scoped lint and both standing reviewers. No original Medusa assertion was edited.
The concurrent installation-acceptance changes were committed separately as
`95ecc2f3`; they are not part of this resource-contract change.

Receipts use the validation directory above with labels `modules-product-full-*`,
`modules-scale-final-*`, `modules-currency-final-*`, `modules-resource-*`,
`modules-adapter-*` and `modules-source-*`. Setup is intentionally reported
separately from command lifetimes; this is not a performance admission.

Next work is a separate method/assertion preflight for the eight unregistered
Product integration files, then individually selected module/workflow or Payload
compatibility slices. Stored Module Links, arbitrary category trees, complete
Medusa workflow parity and general Payload parity remain outside this closure.
