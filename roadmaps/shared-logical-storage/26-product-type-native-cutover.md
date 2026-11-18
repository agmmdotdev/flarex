# Native Product Type on shared logical storage

Status: selected native Type path implemented under the standing shared-storage
completion goal. The broader Product compatibility runner remains physical for
unported Product methods.

## Decision and ownership

The pinned ProductType model declares a single text identity, an active unique
`value` index and a nullable Product `type_id` relationship. The current
selected logical Product source contains both tables and their derived indexes
and FK, but the native Type service still runs through the physical Product
compatibility runner. Move one connected native Type create/read/update/delete
path and Product reference onto the logical Product source. The Medusa service
keeps normalization, DTOs, events and reference-detachment behavior. The shared
row, unique, index, FK, transaction and publication owners remain authoritative.

Use the existing complete Product source and source-confined native commands.
Do not introduce Type-specific SQL, a second relationship policy or a special
physical table. A Type deletion with referencing Products must preserve the
pinned service's detach-before-delete behavior; a missing Type target must be
refused by shared FK enforcement. Authenticated native mutation/event receipts
must cover Type transitions and any Product detachment. If the current generic
profile cannot express a step, correct that owner rather than bypass it.

The private logical Product host command selection may break to admit these
Type commands. No public Medusa method, schema identity or durable data is
reset. The physical Product runner remains only for named unported Product
operations and upstream comparison; move the selected Type boundary checks to
the replacement and remove obsolete Type-only fixture assumptions in this
slice. This does not declare all Product workflows or physical Product tables
retired.

## Connected proof and gates

On PGlite and ordinary-role PostgreSQL, execute native Type creation, ID/value
list/retrieve/count, update, and deletion through the logical source. Create a
native Product referencing the Type, check missing-target refusal, and prove
delete detaches the reference or refuses according to the pinned service
contract. Include active-value uniqueness, replay, rollback, two-scope
isolation and complete event/outcome receipts. Run affected typechecks, native
source guards, lint and both read-only reviews; remove displaced Type-only
fixture logic, reconcile the owning roadmap and commit one connected slice.

## Current selected result

The native ProductType service creates, lists, counts, retrieves, updates and
hard-deletes against the same generic Product source used by native Product
creation. Its events are matched to complete logical row attempts. On Type
deletion the adapter authenticates only the pinned nullable Product reference
detachment and Type removal; the core validates final FK state. The existing
Type-only physical boundary check is displaced by the logical suite, including
read refusal and two-shop isolation on one generic row family. The pinned full
upstream Product runner remains a comparison/compatibility consumer of physical
Product storage until its other methods move. This selected path does not
retire physical Product installation or prove general Product readiness.

The selected delete now seals one declared nullable FK transition and lets
shared core select referencing Products by index after publication exclusion.
The core lowers bounded pages at one commit sequence with row, index, history
and fact maintenance. A 512-Product Type delete succeeds on both drivers;
exceeding the separate transition budget still refuses atomically. This is
bounded native parity, not arbitrary fan-out or a performance claim.

The [accepted core fan-out contract](../../design-notes/flarexdb-shared-logical-storage.md#bounded-high-fan-out-relationship-transitions)
assigns complete reverse selection, bounded batching, concurrency checks,
rollback and one publication to shared relation/transaction ownership. The
selected Type witness uses that core path; the physical Product runner remains
only for its named unported methods until their logical cutover.
