# Task Integration With The Translated Core

Status: **revised connected slice proposed; checkpoint reconciliation complete;
target contract requires coordinated source challenge before implementation**.
The [full Task goal](../GOAL.md) remains paused with its finish line unchanged. Trigger supplies
actual lifecycle/scheduling code; the accepted
[Convex TypeScript and physical-persistence translation](../../../experiments/core/engine/REFACTOR.md#core-and-physical-schema-translation-plan)
supplies shared database mechanisms. This supersedes expansion of the
[current-code installation experiment](./03-system-schema-installation.md).

Active Convex pin: `db914cf06e2b06ee985646611b9e12ed7a770318`. The
[source map](../../../experiments/core/REFERENCES.md) and
[upgrade assessment](../../../experiments/core/engine/CONVEX-REFERENCE-UPGRADE.md)
own its mechanisms. Earlier source challenges retain their original revision;
this design reconciliation does not establish new-pin runtime conformance.

## Keep, Adapt And Replace

| Current work | Disposition against the target |
| --- | --- |
| Adopted Trigger attempt start, snapshot and reached failure methods, source map/licenses and meaningful assertions | Keep actual source and behavior. Adapt only the finite store/time/coordination seam required by the translated owner; continue promoting the remaining real engine closure. |
| Private Task run/snapshot/intent definitions and producer isolation | Adapt into the shared system-schema producer/metadata model. Preserve needed stored fields and private access, without requiring the current producer factory or candidate format. |
| Candidate V2/V3, read-source V1/V2 and installed-envelope experiment | Reassess against the translated catalog/bootstrap. Preserve any demonstrated stored bytes/data through an explicit migration/reset disposition; versions and private preparation APIs are not permanent compatibility duties. |
| Neutral scalar validation and source operation requirements | Reuse where they fit the pin and required native behavior; move responsibility into the actual translated owner rather than retaining an old command pipeline. |
| Current catalog-session command, scope-clock publication, generation flags and immutable artifact pins | Replace or rebind to shared translated transaction-to-persistence, bootstrap, retention and outcome owners. They are checkpoint evidence, not required execution choreography. |
| Fresh provisioning and proposed namespace lease column/SQL guards | Do not expand by default. Keep actual orphan/racing-writer counterexamples; first decide which old writer/data obligations really coexist with the selected physical cutover. Any necessary temporary fence belongs to common persistence with a removal/translation gate. |
| Proposed cooperative PGlite catalog adapter | Unimplemented. Select its transport boundary from the translated persistence contract; do not build a dedicated compatibility layer around a superseded catalog API. |

No existing layout, installer, migration contract or helper export justifies a
divergence on its own. Required Task/native behavior, durable outcomes, fencing
and named data retain their guarantees. No data reset or removal is implied.

## Revised Connected Boundary

Before assigning runtime workers, coordinate one boundary with the core owner:

1. Derive bootstrap, schema metadata and the operation-to-persistence batch
   together from the pin. Begin with its five-table persistence layout
   (`documents`, `indexes`, `leases`, `read_only`, `persistence_globals`) and map
   current framework/catalog/installation/progress records to logical metadata
   or genuine external deployment/artifact authority. Drizzle/SQL stays below
   the portable engine. Do not create a parallel Task backend.
   Table/index/schema definitions and install/build/migration/outcome progress
   are private logical records by default, as the
   [five-table storage owner](../../../design-notes/flarexdb-shared-logical-storage.md#five-table-physical-starting-point)
   specifies; existing physical catalog/projection families are not retained
   automatically.
2. Install real private Task logical tables and index requirements through that
   common lifecycle, before Task execution and without fabricated App analysis.
   Application, Payload and Medusa compilers consume the same mechanism.
   Physical upgrades, per-scope logical changes and producer-defined conversions
   retain distinct meaning with shared progress/recovery.
3. Connect retained Trigger methods through finite store capabilities to the
   translated operation, snapshot/index and single commit/outcome owner. Derive
   fresh claims, capacity, request correlation, fencing and wait winners from
   required semantics; current SQL lock/generation/time fields do not constrain
   their implementation. Handler execution, pauses and remote effects remain
   outside transactions; native callbacks do not gain automatic replay.
4. Prove actual nonempty writes and indexed reads, publication, response loss,
   ownership replacement and cold reconstruction through that connected path.
   Then connect the retained creation/start/completion/wait closure required by
   the first engine milestone. A schema-only or primitive-port test does not
   complete that milestone.
5. Migrate supported consumers and remove displaced code/exports/installer and
   storage paths with concrete named-data disposition. All Task-owned durable
   rows stay logical, including platform routing/discovery/repair. Indexes and
   eligible DO caches use shared core publication and freshness owners.

The [core transaction/persistence slice](../../../experiments/core/engine/slices/06-convex-persistence-translation.md)
and this consumer slice must agree actual ownership and interfaces before either
creates a competing owner. Current
`packages/` and `apps/` are the destination; the old runnable
`experiments/core/src` is reference evidence, not the engine to extend.

## Current-Pin Challenge And Proof Requirements

Before runtime dispatch, independently challenge current callers, accepted
direction and the active pin, then coordinate workers with explicit ownership.
Resolve these cases with the shared core slice rather than adding Task owners:

- Staged prevalidation records `validated_through`; final acceptance checks the
  residual published suffix and all accepted pending writes. Preserve bounded
  stages, indexed conflict history and FIFO pending overlap/cleanup/publication.
- Bounded group commit retains every logical operation's timestamp, required
  outcome and conflict result. Unknown COMMIT responses require whole-batch
  reconciliation before replay. Empty user writes cannot bypass required Task
  outcome/system writes, and native effects do not gain automatic replay.
- Preserve `IndexRef`, write modes and predecessor evidence, metadata-revision
  identity, idempotent backfill/reconciliation and document-pair retention.
  Prove short-page merges with pending inserts/deletes/key moves and bounded
  dependencies; metadata changes and readiness withdrawal must not admit stale
  Task access or cache fills.
- Reuse shared cache eligibility, row/index-metadata fill validation and cold
  recovery. The pin serves eligible cached pages with persistence verification
  defaulting to 100%; neither reduced SQL nor Task performance is established.
- Keep the core persistence lease's read-only-aware acquisition and freshness
  ordering distinct from Task execution leases/fences. Race read-only changes,
  owner replacement and lost responses without exposing an unpublished prefix.
- Document necessary DO scheduling and data-structure adaptations. JavaScript
  promises do not provide Rust-style CPU parallelism; preserve bounded work and
  required visibility/recovery without unbounded scans or invented SQL stages.

## Preserved Evidence And Unresolved Gates

The [legacy namespace closure](../baseline/legacy-namespace-writer-closure.md)
records a genuine counterexample: deployment metadata absence does not establish
an empty data namespace, and current legacy writers do not share the proposed
provisioner's locks. Do not conceal it with fixture SQL, an unlocked emptiness
check or an untrusted mode flag. Decide actual coexistence/retirement and the
translated bootstrap fence together; a lease-column proposal is not selected DDL.

Retain source-origin tests, real legacy/native consumer assertions, App-free
bootstrap and private-schema access witnesses. Existing internal callbacks,
tokens, fixtures and raw helper signatures can change. A test proving old
plumbing is not by itself a compatibility obligation.

Required validation remains both PGlite and ordinary-role PostgreSQL for data,
index, schema, transaction, isolation and outcome claims; actual Cloudflare/DO
proof for host/cache claims; scoped Oxc `tsrs --fast --noEmit`, source guards,
lint and both mandatory code reviews. Record completed checks in Git only when
a coherent passing implementation is ready. The checkpoint has no connected
database, Task runtime, cache or host completion claim.
