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
canonical codecs, document validation and pending-state semantics, bounded
lifetime, candidate-schema validation, build/coverage authority and physical
settlement/recovery. Reuse the real document owner for this incremental profile;
do not present it as independently validated document-API cost. The production
delta planner and materialization writers must not implement reference inserts.
Independent document execution, standalone reads, updates, unique swaps,
relations and native OCC remain complete-request acceptance work. No timing gate
is relaxed and this slice cannot close CE0.

The shared document closure and contribution validator also remain authoritative
for write ownership and attempt accounting. The reference charges the same
successful-attempt receipt budget after lowering, while its fixed operation
does not expose caller-supplied receipts or nested commands.

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
commit. Broader nonempty stored-corruption, concurrency, cancellation and
uncertain-settlement witnesses remain open; zero-row witnesses do not establish
those nonempty cases. Same-request duplicate-title behavior requires a different
command profile because the measured command generates distinct titles.
