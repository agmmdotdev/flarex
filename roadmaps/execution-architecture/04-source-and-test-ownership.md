# Source And Test Ownership

## Status And Outcome

**Source and test organization complete for the existing local owners.** The owner requested a
readable core, an explanation of the complete execution flow and organized tests
before performance work resumes. This cutover makes existing responsibilities
visible in the persistence and executor source trees and their test trees. It
does not replace runtime behavior or claim a performance improvement.

The [consumer construction plan](03-consumer-construction-and-domain-apis.md)
remains the owner of the subsequent construction/API replacement. Its reviewed
core handoff prerequisite is satisfied. Structural organization does not complete
that replacement, composed Application queries or the native-relative performance
gates.

## Owners And Boundaries

`persistence-postgres` owns database mechanics and authoritative persistence.
Its source is grouped into `database`, `scope`, `installation`, `application`,
`storage`, `execution`, `commit`, `frameworks`, `tasks` and `sync`.
`values` retains persistence-owned capture/encoding helpers; it is not a new
generic utility package. `legacy` identifies existing displaced implementations
with retained consumers. `testing` exposes only already admitted test support.

`executor` owns Application orchestration. Its mutation tree separates
preparation, authentication, session activation, runtime invocation, journal,
claims, execution and recovery. Deployment, ordinary invocation, sync, task and
maintenance owners remain distinct. Framework-native behavior stays in its
adapter. Direct framework calls do not pass through Application orchestration.

The package entry points keep their existing contracts and exports. Their targets
move with the owners; no compatibility forwarding files, new barrels, execution
modes, services or registries are added. Import relocation does not change
authority, Effect requirements, evaluation order or resource lifetimes.

## Test Ownership

Tests follow their production owner. Owner-specific scenarios, fixtures and fault
support stay alongside that owner's tests. Shared driver/runtime support lives
under `test/support`. Payload integration witnesses and executor mixed-mutation
witnesses are distinct from owner tests. Measurement fixtures and probes live
under `test/performance`; existing accepted reports remain with their benchmark
owner.

Driver suffixes describe the actual lane. An unsuffixed test is not assumed to be
a unit test: many execute PGlite. Paired PostgreSQL and PGlite scenarios retain one
shared scenario and separate driver entry points. Worker companions remain with
the tests that bundle them. Exact lane selectors, source-map targets, package
exports and guard allowlists migrate with the files; guards are not loosened.

Historical migration witnesses seed their historical schema using explicit
historical fixtures. They upgrade to the current schema before invoking current
readers; current-schema construction must not be applied to an older staging
format. The JSON outcome backfill witness retains its exact before/after evidence
comparison and separately verifies current replay after the full migration chain.

## Alternatives And Replacement Inventory

A new umbrella package would add a dependency layer without moving authority.
A universal host would blur direct and borrowed execution. Splitting arbitrary
large files now would mix structural review with contract changes. These are not
part of this cutover.

Replace the flat source/test layout and its path references. Delete displaced
paths after migrating all callers. Retain existing schemas, migrations, journal
formats, behavioral tests, external export names and legacy consumers. Their
retirement remains governed by the relevant domain roadmap. No durable data is
removed or reset.

## Validation And Completion

Completion requires an exhaustive move inventory; import/export and filesystem
resource resolution; unchanged production executable tokens apart from relocated
paths; unchanged test discovery; exact lane/provenance/source guards; affected
package typechecks and lint; representative owner and connected-consumer tests;
both read-only project reviews; and one scoped commit in the original checkout.

Migration resources, crash/restart worker selectors and worker bundling need
explicit checks because moving a file can change `import.meta.url` behavior even
when TypeScript compiles. No transaction or schema semantics are being changed;
existing real-Postgres lane selectors must remain runnable. Tests must not gain a
second implementation of production mechanics.

The existing browser-target Workerd journal and exact-runner witnesses have a
baseline startup limitation. Their value imports reach `sessionJournalStore`,
`finiteStorageCapture` and installation/preparation SQL construction, which calls
Node crypto during module evaluation. The source organization preserves that
dependency graph and the failing witnesses. Changing runtime compatibility or
separating those value contracts requires its owning core/host boundary decision;
successful bundling alone does not establish these Workerd runtime capabilities.

The diff-lint launcher partitions large file lists within native command-line
limits and compares both sides of recognized renames. It retains the same
configuration, complete coverage and changed-line diagnostic selection. Unused
imports exposed on relocated lines are removed. Lint scope, rules and severity
remain unchanged.

The package guides and [execution map](architecture.md) identify the actual entry
points, trust/lifetime boundaries and corresponding tests. Remaining construction
leaks and large implementation bodies are stated separately instead of being
declared solved by a folder move. The owner's complete organization goal continues
through [construction](03-consumer-construction-and-domain-apis.md) and
[file cohesion](05-file-cohesion-and-readable-flows.md). Performance remains
paused until those organization gates close.
