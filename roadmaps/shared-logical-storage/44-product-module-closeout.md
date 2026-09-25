# Product-module logical-storage closeout

Status: active implementation under the shared-storage completion goal. This is a
connected Product-module package, not a declaration that the wider shared
storage goal or arbitrary Product scale is complete.

## Outcome and owners

Run the remaining pinned native Product, Variant, Option, Collection, Tag,
public Category and event-bus cases against the one generic logical Product
source. Keep the pinned test bodies and their assertions. Replace physical-only
boundary witnesses with equivalent logical-row, fact, event, rollback, replay,
isolation and resource witnesses. Retire the displaced generated Product
profile, installer, physical event policy, reset SQL, fixture runner and exports
after their last consumers move.

Medusa's Product service continues to own business changes, graph shape and
event semantics. The shared logical relation, transaction and publication
owners validate scope, constraints, resource use, complete relationship effects
and settlement. The adapter translates the native call and authenticates its
per-call result, attempts and events; it must not create a second transaction,
private SQL path or physical fallback.

This package advances native Product parity and closes a real physical storage
consumer. It does not add developer APIs, hosted activation, arbitrary Medusa
modules, advanced populated-data conversion or structural migration behavior.
Calculated Pricing and cross-framework relationship policy retain their own
gates in the completion plan.

## Current evidence and displacement inventory

The canonical pinned Product runner now uses the generic logical source for
Product events, Products, Tags, Collections, Options, Variants and internal
Product service calls. Its exact admitted-case reporter covers the unchanged
native suite, including the 1,000-Image case. Trusted resource allowances are
selected by outer host identity. The temporary logical probe configuration is
removed. The physical runner is named `legacy-product-runner` and is selected
only by the still-unmigrated physical boundary configurations; it is not the
canonical Product test path.

Named physical consumers include Product local, fixture-reset,
installation and exact-numeric tests; Category boundary checks; and the remaining mixed physical binding,
link, population and persistence-core fixtures found by the reference inventory.
The explicit legacy runner configurations are `product-categories`,
`product-fixture`, `product-internal-deleted-search` and
`product-variants`. The failure and scale boundary suites
now select the logical runner: SQLSTATE cancellation targets generic row or
outcome storage, while graph pages, ordered facts, native events, replay,
late-page rollback, cancellation and capacity refusal use the same logical
Product source as the canonical native suite. Their physical test selection
and fixture dependencies are removed.
The Collection and internal Product boundary suites now also select the logical
runner. Their native cases already execute in the canonical logical suite, so
the duplicate physical registrations are removed. Collection rollback and
input refusal remain direct logical witnesses; the existing two-shop logical
membership witness now covers colliding IDs, local projection, foreign-only
membership refusal and selector isolation. Internal Product's active search,
bulk update, silent facts/replay and lifecycle rollback are logical witnesses.
The bulk-update receipt matches each native result to its selected Product ID;
the native DAL may return a different order from its input array.
The Tag boundary suite also selects the logical runner: it covers two shops
with colliding Tag, Collection and Product IDs, an empty inverse projection,
DTO-echo and input refusals, and upsert rollback. Its duplicate physical native
registration is removed. The stale physical Option configuration listed four
boundary cases that were no longer registered; the canonical native Option
suite and the dedicated logical Option/Value scope, cascade, rollback, replay
and refusal witnesses remain.

The one retained physical internal-Product search witness covers `q` together
with `withDeleted: true`. The shared logical query planner currently refuses
that unanchored text search: active queries have an admitted null-index anchor,
but including deleted rows removes it. Preserve the physical witness until a
generic, scope-confined indexed text-search contract supports the pinned
case, including its wildcard/case-folding semantics, bounded reads, readiness,
update/restore maintenance and two-driver proof. Do not allow a whole-catalog
scan or an adapter-local search map to make the test pass. Remove this named
legacy configuration when the logical replacement passes.
For each, either migrate the same behavioral claim to generic storage or
identify the framework-neutral core claim that already replaces it. A physical
fixture is not retained merely to repeat a migrated claim. The physical
Product profile and DDL compiler are private development/test contracts; their
exports and test aliases may break. Native public Product methods, DTOs and
event identities must keep their admitted semantics.

The test fixtures create disposable installations, but that does not prove
that every external database has no physical Product rows. This package does
not execute a drop or silent reset of any named database. Before deleting an
installer or issuing any table-removal operation, inventory its repository
callers and named durable installations. For disposable development fixtures,
recreate from the logical schema; for a discovered named durable installation,
record its explicit data conversion or reset decision and retain only the
smallest necessary recovery obligation with a removal gate. Do not dual-write
to avoid that decision.

## Challenged alternatives and replacement

- Raising a physical statement budget would mask native update failures
  without moving Product to the accepted storage owner. Diagnose statement
  amplification and correct the responsible query, materialization or
  admission contract; retain an explicit bounded refusal above measured work.
- Moving individual pinned files to separate ad hoc hosts would duplicate
  command and event wiring. Use one native Product logical runner for the
  remaining compatible families, with authenticated operation-specific calls
  and bounded cleanup through admitted commands.
- A whole-catalog cleanup query or direct SQL reset would make test success
  depend on a small fixture. Use bounded, scope-confined logical cleanup and
  preserve installation, history, outcomes and recovery evidence.
- A fixed affected-row page is not a complete Type or Collection deletion.
  The accepted core `set null` transition already replaces that old 128-row
  boundary; its at-most-2,016-reference, 4 MiB read and 30-second limits remain
  operational safety budgets. Page size and the effective total now follow
  admitted source index and unique-key cost. A higher synchronous budget needs ordinary-role
  PostgreSQL measurements of row/index/fact amplification, lock time and
  recovery cost. If a required fan-out cannot safely fit one atomic operation,
  decide a durable resumable operation and visibility contract separately;
  independently committed pages cannot impersonate one native delete.

## Native large-graph create capacity

The pinned Product service admits a single create with 1,000 owned Images.
The ordinary shared-commerce defaults allow 256 graph facts and 128 logical
request identities. The selected native logical host now uses a trusted,
identity-bound resource profile with a 2,048-row/fact ceiling, 8 MiB command
bytes and a 30-second command-plus-settlement deadline. Untrusted command
arguments cannot select that profile. The default for other hosts remains
unchanged.

The core now pages homogeneous new-row and delete-row graphs under one
transaction, commit sequence and publication outcome. Each page retains the
128-row point limit and the shared developer-index and unique-transition
budgets; total rows, pages and bytes remain bounded. Mixed cross-page
transitions still refuse until their complete uniqueness semantics are
designed. The native 1,000-Image create and following graph cleanup pass on
both PGlite and ordinary-role PostgreSQL, but this does not establish hot-shop
throughput or unrestricted graph size. Add explicit over-budget rollback,
event replay/pump, lock-time and concurrency evidence before claiming the
larger profile as a general capacity contract. The Type/Collection core-owned
reverse fan-out has a separate bounded transition contract in
[core relational fan-out](./28-core-relational-fanout-transition.md).

Logical commerce materialization also enforces the trusted host's selected
`facts` limit across root and derived row pages, within the global 2,048-row
ceiling. An event-free 65-row Product graph against a 64-fact host is refused
atomically; native over-budget Product graphs are separately refused through
the shared request boundary. These are capacity-safety proofs, not throughput
measurements.

The shared event owner now admits at most 2,048 messages and 8 MiB of
canonical event evidence for the selected native profile, with matching
header and ordinal constraints. Stored verification retains the former
256-envelope byte budget for older committed families; new publication uses
the 8 MiB ceiling. The pump verifies an immutable family once per active
repair pass and claims eligible deliveries through keyset pages of eight,
keeping each claim transaction short and fenced. A 257-message family crosses
the former publication ceiling and exercises replay and delivery on both
drivers. The core skips an avoidable current-row lookup
for a newly generated logical document ID and validates the observed-missing
dependency at settlement. The measured 1,000-Image transaction is roughly
15.5 seconds on ordinary-role PostgreSQL and 19 seconds on PGlite in this
development fixture; these numbers justify the explicit 30-second safety
envelope for conformance, not a scalability claim. Statement amplification
and publication lock time remain performance gates. The selected logical
1,000-Image create currently observes about 4,300 awaited Drizzle queries in
both development drivers; its functional success is not a throughput claim.
Measure a full 2,048-event
family with eight subscribers, retries and interrupted repair before claiming
scalable delivery at the raised ceiling. A new pump instance revalidates the
family before claiming; the direct store claim path retains its per-call
integrity check for explicit repair users.

## Delivery and completion gates

1. Capture the exact baseline failures and the physical caller inventory.
   Establish a connected logical native runner and retain all original
   assertions. Add missing logical receipts or core query/transaction behavior
   at their actual owners as cases expose them.
2. Move the remaining native families and event-bus path together, preserving
   result and event order, managed timestamps, graph relations, not-found and
   rollback behavior. Correct statement amplification at its owner and show
   bounded success plus atomic refusal outside the admitted budget.
3. Migrate physical-only boundary witnesses, remove displaced physical profile,
   installer, DDL generation, policy, reset helper, runner, aliases and stale
   exports, and reconcile the source guard and coverage inventories. Record
   any proven durable-data obligation and its exact removal gate.
4. Validate affected native suites, source guards, focused core tests,
   typechecks, build and lint. Use both PGlite and ordinary-role PostgreSQL for
   storage, relationship and transaction claims. Obtain both required read-only
   reviews on each significant checkpoint, fix findings, and make coherent
   scoped commits. Do not claim hot-shop throughput or unlimited fan-out from
   these functional tests.

The canonical native runner and exact admitted-case coverage gate have moved
to logical storage. Gate 3 remains open for physical-only witnesses, the
Product profile/DDL compiler and the named durable-installation decision.
