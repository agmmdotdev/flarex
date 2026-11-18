# Construction, Native Semantics And Query Contracts

Status: implemented preflight for completed Q1/Q2/Q3 in the
[design-quality refactor](README.md).

## Connected Outcome

Existing native operations compose through authenticated module definitions.
The module owner binds commands, receipts, event declarations and required
capabilities. Callers supply scoped storage and select methods. The common host
carries the existing terminal Collection replacement and its derived events.
Shared reads distinguish bounded ordered pages from complete selections and
aggregates, preserving pending visibility and settlement dependencies.

This advances existing child-workflow composition and future module reuse. It
does not integrate another commerce module, introduce a durable workflow engine,
activate a hosted deployment or change durable data retention.

## Evidence And Challenged Alternatives

The authenticated command registry permits distinct tokens with the same name.
A name-only receipt policy therefore cannot establish that native code ran.
The core call boundary will supply the actual executed token; Product construction
binds receipts to its own exact tokens. The existing module registry owns method
admission. Another global registry or a caller-supplied provenance flag is not
needed.

Category receipt logic duplicates native rank/path calculations, but its current
input guard also fills a real native cycle-admission gap. Intrinsic tree input
constraints move into the executing ProductCategoryService before writes; scoped
resource admission remains at the command boundary. Receipts retain mutation
footprints, selected identities, unchanged unrelated fields and event/fact
correlation. Exact command identity alone does not establish those invariants.

Collection/Category membership transcript policies repeat pinned child-workflow
read/normalize/write algorithms. Replace them with native execution, explicit
complete reads and per-call receipts. Give relation-only Product upsert its own
runtime-guarded command; a workflow argument decoder alone must not narrow the
broad upsert command. Core continues to own lifetime, terminal intents, sticky
refusal, replay, rollback and publication.

Current logical reads fetch a complete bounded index range before sorting and
slicing. A smaller returned array is not evidence of bounded page work. An
ordered-page contract must use an aligned declared index, account for examined
candidates, merge pending entries and recheck its examined window at settlement.
Complete selection/count must prove exhaustion separately. Unsupported order or
aggregation fails closed; raising limits or adapter-side SQL is not a solution.

## Contract Replacement And Cleanup

| Existing contract | Disposition and cutover |
| --- | --- |
| Caller-installed workflow event/policy bags | Replace with module-owned admission; migrate all existing callers. |
| Physical workflow-host branch | Delete: no installed workflow consumer exists; lower-level physical Commerce hosts remain separately owned. |
| Name-only Product call policy | Replace with exact runtime command binding; same-name substitute commands refuse. |
| Category tree receipt reconstruction | Delete once native preflight and footprint/event proofs cover the trusted seam. |
| Membership transcript replay and relationships splitter | Delete after relation-only command and complete-set read proofs migrate their consumers. |
| Implicit complete-set query assumptions | Replace with explicit page/complete/aggregate contracts and migrate affected readers. |
| Collection child workflow `void` result | Return its native update DTO; only the two private adapter facades consume this executing fork entry. |
| Private membership graph results | Return a tagged skipped/requested-membership result; combined output names its Category snapshot explicitly. Actual persisted membership is verified after commit, with no read after sealing. |

These are private API and implementation breaks. There is no durable schema,
codec or stored identity cutover in this refactor. Any discovered change to that
assessment must be documented before proceeding; no silent data deletion is
authorized.

The unified Product module activates replacement admission only when its exact
Collection-update command is selected. There is no retained nonsealed membership
engine. Category work and its output snapshot precede Collection replacement.
Native Category admission now owns invalid tree errors; they follow the existing
foreign Medusa error bridge and remain sticky in the surrounding transaction.

## Trust And Rule Inventory

| Rule | Owner |
| --- | --- |
| Method selection, exact command identity and immutable module declarations | Authenticated adapter construction; the shared call boundary passes the executed token. |
| Category ID/rank/ancestry admission, sequential moves, sibling ranks and paths | Executing native ProductCategoryService, using the caller's pending repository view. |
| Product membership normalization and framework lifecycle behavior | Native module services and child workflows. |
| Admitted tables, selected roots, unchanged unrelated scalar fields, result identity and event correlation | Adapter call-local receipts, after native provenance has been established. |
| Scoped data access, indexed dependencies, resource bounds, atomic settlement, revision/fact uniqueness and durable replay | Shared persistence/execution core. |
| Membership completeness and aggregate exhaustion | Explicit shared complete-selection contract. |
| Terminal Collection replacement selection, pending-row coalescing and derived facts/events | Shared replacement and settlement owners. |

Native command implementations and their module constructors are trusted local
code. Workflow hooks and business inputs receive only selected scoped resources;
they cannot present a same-name substitute command or raw manager. Command-token
authentication is necessary but does not replace footprint and publication checks.
Synthetic receipt tests call the raw validator only to test its mechanics; actual
hosts bind the module's authenticated policy.

Before this refactor, callers assembled `module`, scoped storage, capture and
validation callbacks, event names and capability flags separately. They now
install `{ module: runtime.workflow, logicalStorage }`, select supported methods
through `prepareWorkflowResources`, and compose native steps. The module constructor
owns the exact-command policy and required replacement/set-null capability. The
existing registry carries these declarations; no new global policy registry exists.

## Connected Core Correction

Deferred replacement originally refuses any prior observation or write of a
source Product. Native membership children necessarily read existing Products;
the combined Category child also writes them. Simply removing that refusal would
make settlement validate a read against its own derived write or materialize one
row twice. Correct the shared settlement owner: validate original point and
range dependencies before derived lowering, overlay pending source rows during
replacement selection, coalesce each overlapping pending row into its one final
root change, and stream untouched derived rows through the existing bounded
pages. Preserve the native attempt transcript and ordered native/derived events.
Replacement remains terminal across the atomic request. This is required core
composition work within Q1/Q2, with no adapter bypass or second transaction.

## Completion Gates

Prove exact-token refusal, native Category batch/pending ancestry, mixed and
repeated calls, child workflows, terminal replacement, exact publication, late
rollback and replay. Prove page work independently of total table size, pending
re-keying, tied index keys, concurrent changes before the page boundary, complete
selection overflow and exact aggregate behavior. Exercise another existing
module through common construction without Product-specific host branches.

Run affected typechecks, source/provenance guards, core/diff lint, focused PGlite
and ordinary-role PostgreSQL tests. Both project reviewers challenge the final
stable diff. Migrate consumers, remove displaced paths, reconcile owning roadmaps
and commit only after the connected implementation passes these gates.
