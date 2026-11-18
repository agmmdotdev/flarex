# First-Insert Request Reference

Status: bounded first-insert request reference implemented under standing core
approval; complete-request CE0 acceptance remains open.

## Outcome And Boundary

Extend the existing request reference to the measured scalar first-insert command
at zero, one, eight and thirty-two rows. Keep one request identity, outcome,
physical settlement and publication reference. Remove the zero-only reference
name and migrate its consumers rather than retaining a second engine or wrapper.

The reference must independently apply row revisions/current pointers, intrinsic
and developer memberships, and title claims. Read back through the real host,
compare exact stored canonical evidence and replay in both directions. Preserve
dense publication, immutable enabled-build evidence and complete rollback.

Common components remain inside the request: trusted admission and preparation,
canonical codecs, schema validation, bounded row/unique-slot readers, lifetime,
candidate-schema validation, build/coverage authority and physical settlement.
The [first-insert executor](./52-ce0-first-insert-execution.md) replaces the shared
document working set and closure with internally derived pending inserts and
sorted changes. It preserves write ownership, eager uniqueness, collision
refusal and successful-attempt accounting; the receipt budget remains charged
after lowering. No caller-supplied receipts or nested commands enter this profile.
The production delta planner and materialization writers do not implement its
inserts. The [standalone read reference](./53-ce0-standalone-read-reference.md) now
covers empty and bounded point readback. Broader document operations, updates,
unique swaps, relations and native OCC remain acceptance work. Common-owner
costs are not independently compared and no timing gate is relaxed.

## Design Challenge And Owners

Using the production materializer with a different publisher would miss the
nonempty storage contract. Concatenating the existing bare-row and publication
benchmarks would omit current admission, uniqueness and enabled-build authority.
Use a test-only first-insert writer borrowing the already-owned transaction and
the existing authenticated definition and coverage readers. Require active
maintenance certificates; reject unsupported lifecycle profiles instead of
reimplementing backfill or activation. Do not mutate enabled-build progress.

Only authenticated, sorted first-revision changes may enter this writer. Enforce
the profile's row and definition bounds; preserve candidate validation and exact
affected-set checks. Use shared canonical key lowering and digest recipes, then
explicit writes to the same generic physical families. Never create a second
transaction, scope clock or recovery path. SQL failures and stored corruption
must retain their existing request-level distinction; unexpected hook failures
remain defects.

Decode returned identities with protocol primitives before exact-set comparison.
Unique writes compare every canonical claim field, including bytes and codec;
altered or suppressed write evidence is corruption, not a business uniqueness
conflict. Direct DML uses the persistence owner's Drizzle rejection adapter;
kernel/publication bridges retain their existing error projection. A missing
SQLSTATE must not turn a driver rejection into a defect.

No production API, schema or durable-data cutover changes are proposed. Test-only
reference naming and imports change together. Keep the scalar fixture and its
inventory owner shared, and remove displaced zero-only assertions while retaining
all zero-row authority, cancellation and recovery witnesses.

## Validation And Completion

Run PGlite and ordinary-role PostgreSQL differential cases for one/eight/thirty-two
inserts, actual core readback, exact row/index/claim evidence, cross replay,
duplicate committed titles and unchanged enabled-build state. Exercise late write
failure with full rollback and reuse of the key after confirmed rollback. Rerun
the zero-row reference's authority/absence and settlement witnesses against the
renamed owner. Real altered/suppressed-claim triggers must cause complete rollback
on both drivers. PostgreSQL driver-result fault injection additionally covers a
rejection without SQLSTATE and malformed returned row/index/claim identities.
Run affected types and lint, both read-only reviews, clean up owned resources and
commit. The [nonempty settlement matrix](./51-ce0-nonempty-settlement.md) now
extends uncertainty, cancellation, duplicate/disjoint/unique contention and
cross-scope progress to eight-row requests. Broader stored-corruption, lifecycle
and workload witnesses remain open. The
[explicit title-list extension](./55-ce0-pending-unique-equivalence.md) exercises
same-request duplicate titles through the same fixed insertion owner; generated
measurement inputs continue to generate distinct titles.
