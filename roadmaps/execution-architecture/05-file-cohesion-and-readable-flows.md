# File Cohesion And Readable Flows

## Status And Scope

**Owner-authorized organization goal active; journal consumer boundary complete.**
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

### Selected Journal Consumer Boundary

The journal boundary separates its process-local consumer surface
from database composition. It preserves existing execution, admission, settlement,
canonical formats, table definitions and durable rows. The current store mixes
operation contracts, opaque handles, errors, query-port issuance, per-store
evaluation and SQL persistence. Its finite entry/freeze helpers also combine
registry identity with accepting transactions and closed-root construction.
Executor value imports for errors and frozen projections consequently load the
concrete store and can reach Node crypto before a Worker request runs.

The replacement stays in the existing execution and storage owners:

| Module | Responsibility and dependency limit |
| --- | --- |
| journal/contracts.ts | Operation/outcome, borrowed-participant and store-port contracts; exact opaque handles. Lower owner references are type-only. Issuer symbols are absent from the consumer export. |
| journal/errors.ts | Existing journal error classes and precise error unions. External error types are type-only; existing external error values come from their owner's error leaf. |
| journal/state.ts | Trusted attempt, pinned table/index/relation and resolved target types. No SQL construction or registries. |
| journal/indexQueryPort.ts | One query-port issuer registry, authenticated construction and internal lookup. Invalid composition retains its current unregistered-handle behavior. |
| journal/finiteEntry.ts | One private prepared/confirmed registry, authentic issuance, status/capture transitions, once-only abandonment/release, COMMIT-confirmed installation and detached reads. No mutable-map export. |
| journal/finiteEntryActivation.ts | Existing control preparation, Application selection, candidate planning, continuation and replacement accepting transaction. |
| journal/finiteEntryPublication.ts | Original confirmed-session projection using the actual Drizzle table columns and existing byte/date/bigint/null encoding. |
| journal/frozenAttempt.ts | One private frozen registry, origin/owned lookup and borrowed or detached consumer projections. No root evaluator or metadata construction dependency. |
| journal/freezeClosedRoot.ts | Existing closed-root authentication, pin verification, canonical adoption, issuance and consumption through that same registry. |
| journal/api.ts | Explicit consumer export boundary for contracts, errors and read-only projections. Excludes constructors, issuer symbols, registry mutation and raw SQL capabilities. |
| sessionJournalStore.ts | Concrete resource/options assembly, per-store state, receipt codecs, evaluation, persistence, replay and seal/recovery until their next coherent decomposition. |

Move the original pinned-table/developer-index error classes to a storage-owned
error leaf. Move the original Application syscall-validator and logical
participant errors to their owning error leaves as well, then route error-only
consumers to them. Preserve each single class identity and exact failure payload;
do not define equivalent new classes or load construction through error exports.
The concrete implementations consume those same definitions. Executor journal
errors have their own leaf too: Worker RPC error imports must not load journal
construction and session activation through the executor implementation.

Finite registry operations replace direct map access with explicit issuance,
authenticated control retention, running capture and confirmed-attempt claims.
Tests inspect a read-only lifecycle projection and inject failures at the actual
accepting/source boundary. They must not receive a mutable registry/state handle
or gain another settlement path. The store retains its strong exact-claim map,
capacity reservation, evaluator and receipt accounting in this change: moving
those together requires the subsequent state/codec/evaluation decomposition.
A weak registry or generic state service is not a substitute.

Break and migrate all private consumer imports. The concrete store route becomes
construction-only; its consumer types/errors/projection reexports move to the
explicit journal API. Replace the old finite entry/freeze files after all value,
type, test, export, source inventory and documentation consumers migrate. No old
forwarding files, competing registry or compatibility path remains. No stored
journal codec, durable identity or named data needs conversion or deletion.

Preserve first-failure and cleanup order: profile refusal, optional authoritative
retirement observation, synchronous capacity reservation and cleanup acquisition,
tentative capture, acknowledged-COMMIT installation and once-only release.
Record a running capture before later planning SQL can fail. Abort/uncertainty
discards tentative values but retains the exact-claim tombstone; authoritative
retirement alone removes it. Freeze registers canonical closed-root ownership
and consumes the root in the existing order. Detached projections keep mutable
bytes separate while issued authority handles retain object identity.

The nearest proof is the existing journal capability/RPC in actual Workerd,
paired with finite-entry and frozen-attempt owner/consumer proofs in PGlite and
ordinary-role Postgres. Check the consumer runtime import/bundle graph: contracts,
errors and frozen projections must not pull in schema/SQL, driver construction,
root evaluation or Node crypto. A graph check alone does not prove a runtime;
execute the Worker witnesses too. Exact execution may expose separate publication
or activation imports; retain those gaps explicitly until their real owners are
organized. No polyfill, host compatibility expansion or guard bypass is selected.

Validate current finite provenance, capacity, cancellation/drainage, full Cause,
control identity, mixed entry ordering, delayed/uncertain acknowledgement,
detachment, replay origin, publication bytes and metadata ABA witnesses. Run
affected typechecks, package/boundary/source/discovery checks and lint, obtain
both reviews, remove displaced paths and commit the connected cutover. Update
the reading guide with the actual sequence and test ownership. This does not
claim native-relative performance acceptance.

### Remaining Concrete Journal Decomposition

The consumer boundary does not finish journal organization. The concrete store
still owns receipt schemas/codecs, counters, input capture, SQL persistence,
point/index/relation execution, borrowed participant orchestration, finite root
construction and seal projection/settlement. Separate those substantial stages
under the same `journal/` domain while retaining readable target resolution,
admission and request dispatch in the store entry.

The required dependency direction is input/codecs/accounting, then receipt
evidence and persistence, then operation execution and journal projection, then
participant/seal orchestration and store assembly. Participant preflight and
seal preparation both authenticate generated insertions through the same lower
journal projection owner. Relation-page and stored-range correlation belong
below their executors so receipt authentication does not create a cycle.

One per-store attempt owner retains all issued capabilities, admitted-operation
exclusion, finite roots, strong exact claims and capacity reservations. It offers
specific issuance, lookup, installation, consumption and retirement operations,
not mutable maps or a generic context carrying every port and callback. Finite
root state moves out of the concrete store only with its real capture/discard/
freeze owners. Preserve current finite relation refusal; this does not add a
profile. All canonical codecs, transaction boundaries, acknowledgement and
release rules remain exact. Migrate internal callers and remove the displaced
bodies together, with the same paired driver and connected consumer proofs.

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
