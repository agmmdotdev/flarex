# File Cohesion And Readable Flows

## Status And Scope

**Owner-authorized organization goal; detailed owner inventory in progress.**
The owner requested continued organization, readable end-to-end flows, sensible
folder/file boundaries, file splitting, clean APIs and corresponding tests.
The [source/test layout](04-source-and-test-ownership.md) and admitted local
[construction cutover](03-consumer-construction-and-domain-apis.md) are complete.
Performance optimization remains paused until the organization goal closes.

This plan organizes existing admitted behavior. It does not start composed
Application queries, hosted activation, new framework support, schema evolution,
durable-data deletion or a new transaction contract. Necessary private import,
type and construction breaks are authorized with complete caller migration.

## Remaining Structural Problem

Domain folders expose the outer owners, but several files still hide multiple
responsibilities behind one large implementation. The current journal and
database schema each exceed ten thousand lines; point publication exceeds eight
thousand. Application activation/readiness and session activation also contain
substantial lifecycle and protocol work. These are evidence for an internal
ownership audit, not a rule to split at an arbitrary line count.

| Existing owner | Responsibilities to separate or verify |
| --- | --- |
| Database schema | Shared database primitives; control catalogs; scope/commit identity; execution journals; document/index/relation state; installation; Application metadata; tasks; sync and retained legacy tables. |
| Session journal | Consumer contracts; authentic attempt and capability state; point/index/relation evaluation; framework borrowing; finite capture and freeze; durable journal persistence; seal and recovery projections. |
| Point publication | Consumer commands/outcomes; authentic frozen-work handling; fresh authority and conflict validation; mutation/history/fact publication; retry replacement and uncertain-outcome recovery. |
| Application serving | Construction; active selection and admission; readiness/projection integrity; activation; relation-aware serving and explicit retained profiles. |
| Frameworks and adapters | Native lifecycle/semantics; trusted construction; direct operations; borrowed participant completion; finite workflow orchestration; explicit test-only inspection/fault profiles. |
| Tests and fixtures | Driver/resource construction; shared behavioral scenarios; owner-specific fault witnesses; connected consumers; measurement setup and reports. |

Before changing an owner, inspect its private state, exported contracts, actual
callers and decisive tests. A moved helper does not acquire new authority.

## Selected Direction

Use cohesive modules under the existing domain folders. The entry module should
make the actual operation and resource lifetime easy to follow. Move substantial
stages to named local owners when their responsibility and dependencies are clear;
keep short ordered composition visible at the entry point. Avoid a generic engine,
service locator, one-file folders or a web of forwarding barrels.

Pure contracts and error families should not load SQL construction, crypto or
driver initialization merely because a consumer imports a type or capability.
Separate runtime contracts from implementation where a real dependency/runtime
boundary requires it. Preserve exact capability identity and private registry
ownership; splitting must not create competing registries or settlement paths.

Table definitions remain typed Drizzle objects with one authoritative definition
per physical table. Organize by the real database/domain dependency graph and
retain exact names, columns, constraints, migration order and schema enumeration.
Do not replace typed definitions with hardcoded SQL or duplicate table objects.
Cross-domain foreign keys must remain explicit and cycle-safe.

The read-through guide should answer: which entry point receives the request,
which owner prepares and admits it, what readiness it requires, where native
behavior runs, who owns pending state, who settles, and how failure/closure or
uncertainty is handled. Keep direct, borrowed, finite atomic and durable task
lifecycles distinct.

Tests follow those owners. Split a large fixture or scenario only when setup,
driver lifecycle, behavioral cases or fault ownership has a distinct purpose.
Preserve one shared scenario for paired drivers and existing discovery/provenance
guards. Test support must not implement production orchestration.

## Connected Delivery And Removal

1. Finish construction/API migration and its validation, review and commit.
2. Record the concrete module/dependency and caller inventory for each substantial
   connected owner change, then implement it within this standing authorization.
3. Migrate consumer imports, package exports, guards, resource paths and tests;
   remove displaced bodies/paths in the same coherent change.
4. Audit connected flows for duplicate construction, accidental implementation
   imports, confusing names and stale guides. Correct the real owner.
5. Finish one accurate source/API/test map and validate the complete admitted flows.

The ordering follows dependencies and risk, not a per-file or per-turn size cap.
Existing retained formats and legacy consumers need named ownership and removal
gates. This plan does not authorize silent deletion of their durable data.

## Completion Gates

Completion requires clear source and test ownership, readable construction and
request orchestration, cohesive substantial modules, explicit internal exports,
no displaced forwarding/duplicate paths, and accurate flow guides. Folder moves,
line-count reductions and passing isolated helpers do not close the goal.

Validate affected typechecks, package/provenance/import and test-discovery guards,
core/diff lint and exact staged lint. Preserve connected native and mixed behavior,
failure order, cancellation/drainage, authentic authority, scoped liveness,
concurrency, recovery and outer-only settlement. Database/transaction/schema
claims require PGlite and focused ordinary-role PostgreSQL proof; browser/Worker
boundary claims require the actual runtime witness. Obtain both required reviews,
remove obsolete paths and commit each verified coherent outcome. Stop owned
validation resources. Structural cleanup makes no native-relative latency claim.
